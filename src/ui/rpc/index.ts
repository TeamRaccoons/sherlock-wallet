import { createPortTransport, createRPC, POPUP_PORT_NAME } from '../../messages';

const port = chrome.runtime.connect({ name: POPUP_PORT_NAME });

const transport = createPortTransport(port);

export const rpc = createRPC(transport);

// export const rpc = { callMethod: (...a: any[]) => {}, exposeMethod: (...a: any[]) => {}, end: (...a: any[]) => {} };
