import { onConnect, rpc } from './rpc';

// Sherlock runs in Chrome's side panel: dapp requests, the inspector and the wallet view open
// inside it as a stack of views over the home screen, instead of in windows of their own. Closing
// a view goes back to the one under it; the background treats it like a closed window (a pending
// dapp request is rejected). Pages opened as windows keep closing their window.

export type View = { viewId: string; page: string; params: Record<string, string> };

// Where this page runs: the side panel, the toolbar popup, or a window or tab of its own.
export type Surface = 'panel' | 'popup' | 'page';
let surface: Surface = 'page';
export const currentSurface = () => surface;
export const setSurface = (s: Surface) => {
  surface = s;
};

let panel = false;
let stack: View[] = [];
const listeners = new Set<(stack: View[]) => void>();

export const isPanel = () => panel;
export const viewStack = () => stack;

export function subscribe(listener: (stack: View[]) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStack(next: View[]) {
  stack = next;
  // Pages read their parameters from the URL, so the top view's become the page's.
  const top = next[next.length - 1];
  const search = top ? `?${new URLSearchParams({ page: top.page, ...top.params })}` : '';
  history.replaceState(null, '', `${location.pathname}${search}`);
  listeners.forEach((l) => l(next));
}

function removeView(viewId: string, notify: boolean) {
  if (!stack.some((v) => v.viewId === viewId)) return;
  setStack(stack.filter((v) => v.viewId !== viewId));
  if (notify) rpc.callMethod('viewClosed', [viewId]);
}

// Closes what the user is looking at: the window, or in the panel the top view.
export function closeView() {
  if (!panel) return window.close();
  const top = stack[stack.length - 1];
  if (top) removeView(top.viewId, true);
}

export async function startPanel() {
  panel = true;
  surface = 'panel';
  const { id: windowId } = await chrome.windows.getCurrent();
  rpc.exposeMethod('showView', async ([view]) => {
    setStack([...stack.filter((v) => v.viewId !== (view as View).viewId), view as View]);
  });
  rpc.exposeMethod('closeView', async ([viewId]) => removeView(viewId, false));
  const register = () => rpc.callMethod('registerPanel', [windowId, stack.map((v) => v.viewId)]);
  onConnect(register);
  register();
}
