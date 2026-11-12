export class RpcError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
  }
}

let nextId = 1;

export async function rpcCall<T = any>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body = await response.json().catch(() => undefined);
  const code = body?.error?.code ?? (response.ok ? undefined : response.status);
  // The public mainnet RPC refuses every request that comes from a browser (it has an Origin).
  if (code === 403 && /api\.mainnet-beta\.solana\.com/.test(url)) {
    throw new RpcError(
      403,
      `${method}: the public Solana RPC refuses requests from browsers. Set your own RPC in Settings (Helius, Triton, QuickNode… all have free tiers).`
    );
  }
  if (!response.ok && !body?.error) throw new RpcError(response.status, `${method}: HTTP ${response.status}`);
  if (body.error) throw new RpcError(body.error.code, `${method}: ${body.error.message}`);
  return body.result as T;
}

export type RawAccount = { lamports: number; owner: string; data: [string, string]; executable: boolean } | null;

export async function getMultipleAccounts(url: string, addresses: string[]): Promise<RawAccount[]> {
  const out: RawAccount[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const result = await rpcCall<{ value: RawAccount[] }>(url, 'getMultipleAccounts', [chunk, { encoding: 'base64' }]);
    out.push(...result.value);
  }
  return out;
}
