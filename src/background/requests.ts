// Every sign request a dapp makes is recorded here so the inspector can load it by id and so it
// can be reopened later from the history list. Bytes are stored base64-encoded.
export type InspectRequest = {
  id: string;
  kind: 'transactions' | 'message';
  method: 'signTransaction' | 'signAndSendTransaction' | 'signMessage' | 'paste' | 'replay';
  // For replays: the landed transaction to fetch (its bytes are loaded by the inspector).
  signature?: string;
  address: string;
  origin?: string;
  chain?: string;
  createdAt: number;
  transactions?: string[];
  message?: string;
};

const HISTORY_KEY = 'requests';
const HISTORY_LIMIT = 50;

export async function getHistory(): Promise<InspectRequest[]> {
  const { [HISTORY_KEY]: history } = await chrome.storage.local.get(HISTORY_KEY);
  return (history as InspectRequest[] | undefined) ?? [];
}

export async function saveRequest(request: Omit<InspectRequest, 'id' | 'createdAt'>): Promise<InspectRequest> {
  const saved: InspectRequest = { ...request, id: crypto.randomUUID(), createdAt: Date.now() };
  const history = await getHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: [saved, ...history].slice(0, HISTORY_LIMIT) });
  return saved;
}

export async function getRequest(id: string): Promise<InspectRequest | undefined> {
  return (await getHistory()).find((r) => r.id === id);
}

export async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}
