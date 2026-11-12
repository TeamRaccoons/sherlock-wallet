import { CONTENT_PORT_NAME } from '../messages';
import { inject } from './utils';

const windowScript = new URL('./window.ts', import.meta.url);
inject(windowScript.href);

// Requests from the dapp that open a Sherlock window. They are kept until answered so that, if the
// extension's service worker restarts meanwhile, they can be sent again to the new one (which
// reattaches to the window already open for them).
const REPLAYABLE = new Set(['connect', 'inspectTransactions', 'inspectMessage']);
const pending = new Map<string | number, unknown>();

function parse(
  wire: unknown
): { id?: string | number; method?: string; result?: unknown; error?: unknown } | undefined {
  if (typeof wire !== 'string') return undefined;
  try {
    const message = JSON.parse(wire);
    return message && typeof message === 'object' ? message : undefined;
  } catch {
    return undefined;
  }
}

const isResponse = (m: ReturnType<typeof parse>) =>
  !!m && m.id !== undefined && !m.method && ('result' in m || 'error' in m);

let port: chrome.runtime.Port | undefined;

function connect() {
  try {
    port = chrome.runtime.connect({ name: CONTENT_PORT_NAME });
  } catch {
    // The extension was reloaded or removed: this page keeps a dead copy of the content script.
    port = undefined;
    return;
  }
  port.onMessage.addListener((message) => {
    const parsed = parse(message);
    if (isResponse(parsed)) pending.delete(parsed!.id!);
    window.postMessage(message);
  });
  port.onDisconnect.addListener(() => {
    connect();
    for (const message of pending.values()) port?.postMessage(message);
  });
}

// Proxy messages between website and background process.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const parsed = parse(event.data);
  if (parsed?.method && REPLAYABLE.has(parsed.method) && parsed.id !== undefined) pending.set(parsed.id, event.data);
  try {
    port?.postMessage(event.data);
  } catch {
    // Disconnected: the reconnect replays what matters.
  }
});

connect();
