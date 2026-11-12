import { cacheGet, cacheSet } from './cache';

// lite-api.jup.ag is deprecated; api.jup.ag works without a key at a low rate limit, and with one
// (x-api-key, from portal.jup.ag) at the key's limit.
export const JUP_API = 'https://api.jup.ag';
export const JUP_KEY_STORAGE = 'Sherlock-jup-key';

export function apiKey(): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(JUP_KEY_STORAGE);
    if (stored) return JSON.parse(stored) || undefined;
  } catch {
    // No storage (Node scripts) or unreadable value.
  }
  return (globalThis as any).process?.env?.JUP_API_KEY || undefined;
}

export type TokenInfo = {
  mint: string;
  symbol?: string;
  name?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  verified?: boolean;
};

export async function getJson(url: string) {
  const key = apiKey();
  const response = await fetch(url, key ? { headers: { 'x-api-key': key } } : undefined);
  if (response.status === 429) throw new Error('Jupiter rate limit hit, try again in a minute');
  if (!response.ok) throw new Error(`Jupiter API answered HTTP ${response.status}`);
  return response.json();
}

// Token metadata and USD prices from Jupiter's token API. Missing tokens are simply absent; network
// failures return what is cached, never throw.
export async function getTokenInfos(mints: string[]): Promise<Map<string, TokenInfo>> {
  const out = new Map<string, TokenInfo>();
  const missing: string[] = [];
  for (const mint of new Set(mints)) {
    const cached = await cacheGet<TokenInfo>(`token:${mint}`);
    if (cached) {
      // Entries with only a mint mean "not listed": cached too, so they are not asked for again.
      if (cached.symbol !== undefined || cached.decimals !== undefined) out.set(mint, cached);
    } else missing.push(mint);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const list = await getJson(`${JUP_API}/tokens/v2/search?query=${chunk.join(',')}`);
      for (const t of list) {
        if (!chunk.includes(t.id)) continue;
        const info: TokenInfo = {
          mint: t.id,
          symbol: t.symbol,
          name: t.name,
          icon: t.icon,
          decimals: t.decimals,
          usdPrice: t.usdPrice,
          verified: t.isVerified,
        };
        out.set(t.id, info);
        // Prices go stale quickly; metadata does not, but one TTL keeps it simple.
        await cacheSet(`token:${t.id}`, info, 60_000);
      }
      for (const mint of chunk) {
        if (!out.has(mint)) await cacheSet(`token:${mint}`, { mint }, 600_000);
      }
    } catch {
      // Token metadata is decoration; the simulation stands without it. Back off for 30 s so a
      // rate-limited API is not asked again on every re-simulation.
      for (const mint of chunk) await cacheSet(`token:${mint}`, { mint }, 30_000);
    }
  }
  return out;
}

export async function getAmmLabels(): Promise<Record<string, string>> {
  const cached = await cacheGet<Record<string, string>>('jup:amm-labels');
  if (cached) return cached;
  try {
    const labels = await getJson(`${JUP_API}/swap/v2/program-id-to-label`);
    await cacheSet('jup:amm-labels', labels, 24 * 3600_000);
    return labels;
  } catch {
    return {};
  }
}

export type FreshQuote = {
  inAmount: bigint;
  outAmount: bigint;
  otherAmountThreshold: bigint;
  priceImpactPct: number;
  route: string[];
  fetchedAt: number;
};

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  exactOut?: boolean;
}): Promise<FreshQuote> {
  // An order without a taker is a quote.
  const url = new URL(`${JUP_API}/swap/v2/order`);
  url.searchParams.set('inputMint', params.inputMint);
  url.searchParams.set('outputMint', params.outputMint);
  url.searchParams.set('amount', params.amount.toString());
  url.searchParams.set('slippageBps', String(params.slippageBps));
  if (params.exactOut) url.searchParams.set('swapMode', 'ExactOut');
  const q = await getJson(url.toString());
  if (q.error) throw new Error(q.error);
  return {
    inAmount: BigInt(q.inAmount),
    outAmount: BigInt(q.outAmount),
    otherAmountThreshold: BigInt(q.otherAmountThreshold),
    priceImpactPct: Number(q.priceImpactPct),
    route: q.routePlan.map((r: any) => `${r.swapInfo.label} ${r.percent ?? Math.round((r.bps ?? 0) / 100)}%`),
    fetchedAt: Date.now(),
  };
}
