import { createRPC, POPUP_PORT_NAME } from '../../messages';
import type { Transport } from '../../messages';

type Callback = (...args: any[]) => void;

const connectHooks = new Set<() => void>();
// Runs after the port (re)connects: the restarted worker lost what it knew about this page.
export const onConnect = (hook: () => void) => connectHooks.add(hook);

// A port that reconnects when the service worker restarts, keeping its listeners, so an open
// approval or inspector window stays usable (the restarted worker re-sends it pending requests).
function createReconnectingTransport(name: string): Transport {
  const listeners = new Set<Callback>();
  let port: chrome.runtime.Port | undefined;

  const connect = () => {
    try {
      port = chrome.runtime.connect({ name });
    } catch {
      port = undefined; // extension reloaded: this page is orphaned
      return;
    }
    for (const listener of listeners) port.onMessage.addListener(listener);
    port.onDisconnect.addListener(() => setTimeout(connect, 50));
    // After the caller's listeners are attached: a hook may call a method straight away.
    setTimeout(() => connectHooks.forEach((hook) => hook()));
  };
  connect();

  return {
    addListener: (listener) => {
      listeners.add(listener);
      port?.onMessage.addListener(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
      port?.onMessage.removeListener(listener);
    },
    write: (data) => {
      try {
        port?.postMessage(data);
      } catch {
        // Reconnecting.
      }
    },
  };
}

export const rpc = createRPC(createReconnectingTransport(POPUP_PORT_NAME));
