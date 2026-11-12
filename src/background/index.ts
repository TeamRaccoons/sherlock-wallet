import type { RPC } from '../messages';
import { CONTENT_PORT_NAME, createPortTransport, createRPC, POPUP_PORT_NAME } from '../messages';
import { toBase64 } from '../messages/bytes';
import { asyncState } from '../utils/asyncState';
import { DisplayMode, getDisplayMode, onDisplayModeChange, uiPagePath } from '../utils/displayMode';
import { openPopup, PopupHandle, trackPopup } from '../utils/popup';
import { clearHistory, getHistory, getRequest, saveRequest } from './requests';
import { addAccount, getAccounts, removeAccount } from './storage';

// Popup pages by tab, so a request is answered by the window opened for it and not by whichever
// Sherlock page connected last (the toolbar popup, the home page in a tab, another request).
const popupRPCs = new Map<number, ReturnType<typeof asyncState<RPC>>>();
const popupRPC = (tabId: number) => {
  let state = popupRPCs.get(tabId);
  if (!state) popupRPCs.set(tabId, (state = asyncState<RPC>()));
  return state;
};
// Connected content scripts (one per tab), with the site's origin as Chrome reports it.
const contentRPCs = new Map<RPC, string | undefined>();

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    addAccount({ label: 'Coinbase 2', address: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm' });
  }
});

// ---- Surviving service worker restarts --------------------------------------------------------
// Chrome stops an idle worker after ~30 s, which used to drop a dapp's pending request while its
// window was still open. Calling an extension API resets the idle timer, so do that while any
// request is pending; and should the worker restart anyway, the content script replays the
// request and the window recorded below is reused instead of opening a second one.

let pending = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

async function keepAlive<T>(work: () => Promise<T>): Promise<T> {
  pending++;
  keepAliveTimer ??= setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try {
    return await work();
  } finally {
    if (--pending === 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
  }
}

// ---- Side panel -------------------------------------------------------------------------------
// The toolbar icon opens Sherlock in Chrome's side panel, and dapp requests show there as views
// (src/ui/view.ts) rather than in windows. A panel registers itself for its browser window; a
// view counts as closed when the panel closes it (Reject, Done, back) or the panel goes away.

// The toolbar icon follows the display mode setting: no popup and the panel opening on click, or
// the popup. Read once at start, then on every change.
let displayMode: DisplayMode = 'panel';

async function applyDisplayMode(mode: DisplayMode) {
  displayMode = mode;
  await chrome.action.setPopup({ popup: mode === 'popup' ? uiPagePath() : '' });
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: mode === 'panel' }).catch(() => undefined);
}
getDisplayMode().then(applyDisplayMode);
onDisplayModeChange(applyDisplayMode);

const panels = new Map<number, { rpc: RPC; viewIds: string[] }>();
const panelWaiters = new Map<number, (() => void)[]>();
const views = new Map<string, { windowId: number; closed: () => void }>();

function registerPanel(windowId: number, rpc: RPC, viewIds: string[]) {
  panels.set(windowId, { rpc, viewIds });
  panelWaiters.get(windowId)?.forEach((wake) => wake());
  panelWaiters.delete(windowId);
}

function panelGone(windowId: number, rpc: RPC) {
  if (panels.get(windowId)?.rpc !== rpc) return;
  panels.delete(windowId);
  for (const view of [...views.values()]) if (view.windowId === windowId) view.closed();
}

async function panelFor(windowId: number, waitMs: number): Promise<RPC | undefined> {
  if (!panels.has(windowId) && waitMs > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      panelWaiters.set(windowId, [
        ...(panelWaiters.get(windowId) ?? []),
        () => {
          clearTimeout(timer);
          resolve();
        },
      ]);
    });
  }
  return panels.get(windowId)?.rpc;
}

// Chrome lets sidePanel.open() run only in response to a user action, so it is tried first thing
// in a request's handler, before anything is awaited; a refusal falls back to a window.
const tryOpenPanel = (windowId: number | undefined): Promise<boolean> =>
  displayMode !== 'panel' || windowId === undefined || panels.has(windowId) || !chrome.sidePanel?.open
    ? Promise.resolve(false)
    : chrome.sidePanel.open({ windowId }).then(
        () => true,
        () => false
      );

function trackView(windowId: number, viewId: string, rpc: RPC): PopupHandle {
  let closed!: () => void;
  const popupClosed = new Promise<null>((resolve) => {
    closed = () => {
      views.delete(viewId);
      resolve(null);
    };
  });
  views.set(viewId, { windowId, closed });
  return {
    popupClosed,
    rpc,
    closePopup: async () => {
      views.get(viewId)?.closed();
      panels.get(windowId)?.rpc.callMethod('closeView', [viewId]);
    },
  };
}

async function showView(
  windowId: number,
  page: string,
  params: Record<string, string>,
  waitMs = 0
): Promise<(PopupHandle & { viewId: string }) | undefined> {
  const rpc = await panelFor(windowId, waitMs);
  if (!rpc) return undefined;
  const viewId = crypto.randomUUID();
  const handle = trackView(windowId, viewId, rpc);
  rpc.callMethod('showView', [{ viewId, page, params }]);
  return { ...handle, viewId };
}

// ---- Request windows ------------------------------------------------------------------------

const windowKey = (key: string) => `window:${key}`;
type StoredView = number | { windowId: number; viewId: string };

// Shows a dapp request: in the side panel of the dapp's window when there is one (or it could be
// opened), otherwise in a window. A request replayed after a worker restart (same key) finds the
// view or window already showing it.
async function requestWindow(
  key: string | undefined,
  target: { windowId?: number; panelOpening: Promise<boolean> },
  page: string,
  params: () => Promise<Record<string, string>>
): Promise<PopupHandle> {
  if (key) {
    const stored = (await chrome.storage.session.get(windowKey(key)))[windowKey(key)] as StoredView | undefined;
    if (typeof stored === 'number') {
      try {
        await chrome.tabs.get(stored);
        return trackPopup(stored);
      } catch {
        // The window is gone: open a new one.
      }
    } else if (stored) {
      // The panel re-registers when its port reconnects to the restarted worker.
      const rpc = await panelFor(stored.windowId, 2000);
      if (rpc && panels.get(stored.windowId)?.viewIds.includes(stored.viewId)) {
        return trackView(stored.windowId, stored.viewId, rpc);
      }
    }
  }
  const remember = (value: StoredView) => (key ? chrome.storage.session.set({ [windowKey(key)]: value }) : undefined);
  if (target.windowId !== undefined && displayMode === 'panel') {
    const waitMs = (await target.panelOpening) ? 5000 : 0;
    const view = await showView(target.windowId, page, await params(), waitMs);
    if (view) {
      await remember({ windowId: target.windowId, viewId: view.viewId });
      return view;
    }
  }
  const handle = await openPopup(page, await params());
  if (handle.tabId !== undefined) await remember(handle.tabId);
  return handle;
}

const forgetWindow = (key?: string) => (key ? chrome.storage.session.remove(windowKey(key)) : Promise.resolve());

type StoredAccount = { publicKey: number[] };

async function getConnectedAccounts() {
  const { connectedAccounts } = await chrome.storage.session.get('connectedAccounts');
  return (connectedAccounts as StoredAccount[] | undefined)?.map((a) => ({ publicKey: Uint8Array.from(a.publicKey) }));
}

async function setConnectedAccounts(accounts: { publicKey: Uint8Array }[] | null | undefined) {
  if (!accounts) return;
  await chrome.storage.session.set({
    connectedAccounts: accounts.map((a) => ({ publicKey: Array.from(a.publicKey) })),
  });
}

// Sites the user approved: they reconnect without a window, like a trusted site in other wallets,
// until they disconnect.
async function approvedOrigins(): Promise<string[]> {
  const { approvedOrigins } = await chrome.storage.local.get('approvedOrigins');
  return (approvedOrigins as string[] | undefined) ?? [];
}

async function setApproved(origin: string, approved: boolean) {
  const origins = (await approvedOrigins()).filter((o) => o !== origin);
  await chrome.storage.local.set({ approvedOrigins: approved ? [...origins, origin] : origins });
}

// One approval window at a time: a second connect (another tab, a double click) waits for it.
let approvalInFlight: Promise<{ publicKey: Uint8Array }[] | null> | undefined;

async function inspect(
  key: string | undefined,
  target: { windowId?: number; panelOpening: Promise<boolean> },
  request: Parameters<typeof saveRequest>[0]
) {
  return keepAlive(async () => {
    const { popupClosed } = await requestWindow(key, target, 'inspect', async () => ({
      request: (await saveRequest(request)).id,
    }));
    await popupClosed;
    await forgetWindow(key);
    // Sherlock never signs: closing the inspector always rejects.
    return null;
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === POPUP_PORT_NAME) {
    const transport = createPortTransport(port);
    const rpc = createRPC(transport);

    rpc.exposeMethod('getAccounts', getAccounts);
    rpc.exposeMethod('addAccount', async (params) => {
      const account = params[0];
      await addAccount(account);
    });
    rpc.exposeMethod('removeAccount', async (params) => {
      const account = params[0];
      await removeAccount(account);
    });
    rpc.exposeMethod('changeAccounts', async (params) => {
      await setConnectedAccounts(params);
      // Only sites the user connected learn the new address; other tabs never see it.
      const approved = await approvedOrigins();
      for (const [content, origin] of contentRPCs) {
        if (origin && approved.includes(origin)) content.callMethod('changeAccounts', params);
      }
    });
    rpc.exposeMethod('connectedAccounts', getConnectedAccounts);

    rpc.exposeMethod('getRequest', async ([id]) => (await getRequest(id)) ?? null);
    rpc.exposeMethod('getHistory', getHistory);
    rpc.exposeMethod('clearHistory', clearHistory);
    // A side panel opens what it asks for as a view inside itself; other pages open windows.
    let panelWindow: number | undefined;
    rpc.exposeMethod('registerPanel', async ([windowId, viewIds]) => {
      panelWindow = windowId;
      registerPanel(windowId, rpc, viewIds ?? []);
    });
    rpc.exposeMethod('viewClosed', async ([viewId]) => views.get(viewId)?.closed());
    const open = async (page: string, params: Record<string, string>) => {
      if (panelWindow === undefined || !(await showView(panelWindow, page, params))) await openPopup(page, params);
    };

    rpc.exposeMethod('inspectPasted', async ([{ address, transactions }]) => {
      const saved = await saveRequest({ kind: 'transactions', method: 'paste', address, transactions });
      await open('inspect', { request: saved.id });
      return saved.id;
    });
    rpc.exposeMethod('inspectSignature', async ([{ address, signature }]) => {
      const saved = await saveRequest({ kind: 'transactions', method: 'replay', address, signature, transactions: [] });
      await open('inspect', { request: saved.id });
      return saved.id;
    });
    rpc.exposeMethod('openRequest', async ([id]) => {
      await open('inspect', { request: id });
    });
    rpc.exposeMethod('openWallet', async ([address]) => {
      await open('wallet', { address });
    });

    const tabId = port.sender?.tab?.id;
    port.onDisconnect.addListener(() => {
      if (tabId !== undefined) popupRPCs.delete(tabId);
      if (panelWindow !== undefined) panelGone(panelWindow, rpc);
      rpc.end();
    });

    if (tabId !== undefined) popupRPC(tabId).set(rpc);
  }

  if (port.name === CONTENT_PORT_NAME) {
    const transport = createPortTransport(port);
    const rpc = createRPC(transport);
    // The dapp's browser window: its side panel shows the dapp's requests.
    const dappWindow = port.sender?.tab?.windowId;
    // The site's origin from Chrome, never from the page: the wallet object runs in the page, so
    // any site could claim to be jup.ag. Origins the page sends are ignored.
    const senderUrl = port.sender?.url;
    const origin = port.sender?.origin ?? (senderUrl ? new URL(senderUrl).origin : undefined);

    rpc.exposeMethod('connect', async ([{ key, silent } = {} as { key?: string; silent?: boolean }]) => {
      const panelOpening = silent ? Promise.resolve(false) : tryOpenPanel(dappWindow);
      const current = await getConnectedAccounts();
      const trusted = !!origin && (await approvedOrigins()).includes(origin) && !!current?.length;
      if (trusted) return current;
      if (silent) return null;

      approvalInFlight ??= keepAlive(async () => {
        const handle = await requestWindow(
          key,
          { windowId: dappWindow, panelOpening },
          'approveConnection',
          async (): Promise<Record<string, string>> => (origin ? { origin } : {})
        );
        const { closePopup, popupClosed, tabId } = handle;
        if (!handle.rpc && tabId === undefined) throw new Error('approval window has no tab');

        // A reused window reconnects its port after a restart; wait for it (or for it to close).
        const approval = handle.rpc ?? (await Promise.race([popupRPC(tabId!).get(), popupClosed]));
        const response = approval ? await Promise.race([approval.callMethod('connect'), popupClosed]) : null;

        await setConnectedAccounts(response);
        await forgetWindow(key);
        closePopup();
        return response;
      }).finally(() => {
        approvalInFlight = undefined;
      });
      const response = await approvalInFlight;
      if (response && origin) await setApproved(origin, true);
      return response;
    });

    rpc.exposeMethod('disconnect', async () => {
      if (origin) await setApproved(origin, false);
    });

    rpc.exposeMethod('inspectTransactions', async ([{ method, address, transactions, chain, key }]) =>
      inspect(
        key,
        { windowId: dappWindow, panelOpening: tryOpenPanel(dappWindow) },
        {
          kind: 'transactions',
          method,
          address,
          chain,
          origin,
          transactions: (transactions as Uint8Array[]).map(toBase64),
        }
      )
    );

    rpc.exposeMethod('inspectMessage', async ([{ address, message, key }]) =>
      inspect(
        key,
        { windowId: dappWindow, panelOpening: tryOpenPanel(dappWindow) },
        { kind: 'message', method: 'signMessage', address, origin, message: toBase64(message) }
      )
    );

    port.onDisconnect.addListener(() => {
      contentRPCs.delete(rpc);
      rpc.end();
    });

    contentRPCs.set(rpc, origin);
  }
});
