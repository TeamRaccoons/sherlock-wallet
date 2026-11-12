import { parse, stringify } from './serialization';
import type { Transport } from './transport';

type Callback = (...args: any[]) => void;

type MethodCallback = (params: any[]) => Promise<any>;

export interface RPC {
  callMethod: (method: string, params?: any[]) => Promise<any>;
  exposeMethod: (method: string, listener: MethodCallback) => void;
  end: () => void;
}

// A minimal JSON-RPC 2.0 over the page / extension transports. It runs in every page the wallet
// is injected into, so it stays dependency-free.
type Message = { jsonrpc?: string; id?: string | number; method?: string; params?: any[]; result?: any; error?: any };

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function read(dataOrEvent: any): Message | undefined {
  const wire = dataOrEvent instanceof MessageEvent ? dataOrEvent.data : dataOrEvent;
  if (typeof wire !== 'string') return undefined;
  try {
    const message = parse(wire);
    return message && typeof message === 'object' && message.jsonrpc === '2.0' ? message : undefined;
  } catch {
    // The message is not for us.
    return undefined;
  }
}

export function createRPC(transport: Transport): RPC {
  const listeners: Callback[] = [];

  function callMethod(method: string, params: any[] = []) {
    return new Promise((resolve) => {
      const id = newId();
      const handleResponse = (dataOrEvent: any) => {
        const response = read(dataOrEvent);
        if (
          !response ||
          response.id !== id ||
          response.method !== undefined ||
          !('result' in response || 'error' in response)
        )
          return;
        transport.removeListener(handleResponse);
        resolve(response.result);
      };
      transport.addListener(handleResponse);
      transport.write(stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  function exposeMethod(method: string, listener: MethodCallback) {
    const handleRequest = async (dataOrEvent: any) => {
      const request = read(dataOrEvent);
      if (!request || request.method !== method || request.id === undefined) return;
      const result = await listener(request.params ?? []);
      transport.write(stringify({ jsonrpc: '2.0', id: request.id, result: result ?? null }));
    };

    transport.addListener(handleRequest);

    listeners.push(handleRequest);
  }

  function end() {
    for (const listener of listeners) {
      transport.removeListener(listener);
    }
  }

  return { callMethod, exposeMethod, end };
}
