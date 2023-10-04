import { CONTENT_PORT_NAME } from '../messages';
import { inject } from './utils';

const windowScript = new URL('./window.ts', import.meta.url);
inject(windowScript.href);
console.log('Script injected');

function connect() {
  console.log('Connecting port');
  const newPort = chrome.runtime.connect({ name: CONTENT_PORT_NAME });

  window.addEventListener('message', (event) => {
    console.log(event);
    newPort.postMessage(event.data);
  });
  newPort.onMessage.addListener((message) => {
    window.postMessage(message);
  });
  newPort.onDisconnect.addListener((p) => {
    console.log('Port disconnected', p);
    port = connect();
  });
  return newPort;
}

// Proxy messages between website and background process.
let port: chrome.runtime.Port | null = connect();

