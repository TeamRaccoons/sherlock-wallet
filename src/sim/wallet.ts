import { apiKey, getJson, JUP_API } from './jupApi';
import { WSOL_MINT } from './programs';
import { rpcCall } from './rpc';

// What an address holds and did on Jupiter, from the public APIs (no key needed, CORS-open) and
// the RPC. Every source is fetched on its own, so one failing API leaves the others standing.

const PERPS_API = 'https://perps-api.jup.ag/v1';

// Without a key api.jup.ag allows about one request every two seconds, and a wallet asks for five
// at once: queue them, spaced out, and wait out a 429 a couple of times before giving up.
let jupQueue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jup(url: string): Promise<any> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getJson(url);
      } catch (e) {
        if (attempt >= 2 || !/rate limit/.test((e as Error).message)) throw e;
        await sleep(2500 * (attempt + 1));
      }
    }
  };
  const result = jupQueue.then(run);
  jupQueue = result.catch(() => undefined).then(() => sleep(apiKey() ? 0 : 1100));
  return result;
}

// Predict reports USD and prices in micro-dollars; Perps' plain fields are already in USD.
const micro = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v) / 1e6);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const seconds = (v: unknown) => (v ? Number(v) * 1000 : undefined);
const isoTime = (v: unknown) => (typeof v === 'string' && v ? Date.parse(v) : undefined);

export const PERP_MARKETS: Record<string, string> = {
  [WSOL_MINT]: 'SOL',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'ETH',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh': 'BTC',
};

// ---- RPC activity -------------------------------------------------------------------------------

export type Activity = { signature: string; slot: number; time?: number; failed: boolean };

export async function getActivity(rpcUrl: string, address: string, before?: string): Promise<Activity[]> {
  const list = await rpcCall<any[]>(rpcUrl, 'getSignaturesForAddress', [
    address,
    { limit: 25, ...(before ? { before } : {}) },
  ]);
  return list.map((s) => ({ signature: s.signature, slot: s.slot, time: seconds(s.blockTime), failed: !!s.err }));
}

export async function getSolBalance(rpcUrl: string, address: string): Promise<number> {
  const { value } = await rpcCall<{ value: number }>(rpcUrl, 'getBalance', [address]);
  return value / 1e9;
}

// ---- Perps --------------------------------------------------------------------------------------

export type PerpPosition = {
  pubkey: string;
  market: string;
  side: 'long' | 'short';
  leverage?: number;
  sizeUsd?: number;
  collateralUsd?: number;
  valueUsd?: number;
  entryPrice?: number;
  markPrice?: number;
  liquidationPrice?: number;
  pnlUsd?: number;
  pnlPct?: number;
  feesUsd?: number;
  openedAt?: number;
};

export async function getPerpPositions(address: string): Promise<PerpPosition[]> {
  const { dataList } = await getPlain(`${PERPS_API}/positions?walletAddress=${address}`);
  return (dataList ?? []).map((p: any) => ({
    pubkey: p.positionPubkey,
    market: PERP_MARKETS[p.marketMint] ?? p.marketMint,
    side: p.side,
    leverage: num(p.leverage),
    sizeUsd: num(p.size),
    collateralUsd: num(p.collateral),
    valueUsd: num(p.value),
    entryPrice: num(p.entryPrice),
    markPrice: num(p.markPrice),
    liquidationPrice: num(p.liquidationPrice),
    pnlUsd: num(p.pnlAfterFeesUsd),
    pnlPct: num(p.pnlChangePctAfterFees),
    feesUsd: num(p.totalFeesUsd),
    openedAt: seconds(p.createdTime),
  }));
}

export type PerpTrade = {
  signature?: string;
  market: string;
  side: string;
  action: string;
  orderType?: string;
  price?: number;
  sizeUsd?: number;
  collateralUsd?: number;
  pnlUsd?: number;
  feeUsd?: number;
  time?: number;
};

export async function getPerpTrades(address: string): Promise<PerpTrade[]> {
  const { dataList } = await getPlain(`${PERPS_API}/trades?walletAddress=${address}`);
  return (dataList ?? []).map((t: any) => ({
    signature: t.txHash || undefined,
    market: t.positionName ?? PERP_MARKETS[t.mint] ?? t.mint,
    side: t.side,
    action: t.action,
    orderType: t.orderType,
    price: num(t.price),
    sizeUsd: num(t.size),
    collateralUsd: num(t.collateralUsdDelta),
    pnlUsd: num(t.pnl),
    feeUsd: num(t.fee),
    time: seconds(t.createdTime),
  }));
}

// perps-api.jup.ag is not api.jup.ag: it takes no key, so none is sent.
async function getPlain(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Perps API answered HTTP ${response.status}`);
  return response.json();
}

// ---- Predict ------------------------------------------------------------------------------------

export type PredictPosition = {
  pubkey: string;
  event?: string;
  market?: string;
  yes: boolean;
  contracts?: number;
  avgPrice?: number;
  markPrice?: number;
  costUsd?: number;
  valueUsd?: number;
  pnlUsd?: number;
  pnlPct?: number;
  claimable: boolean;
  openedAt?: number;
};

export async function getPredictPositions(address: string): Promise<PredictPosition[]> {
  const { data } = await jup(`${JUP_API}/prediction/v1/positions?ownerPubkey=${address}`);
  return (data ?? []).map((p: any) => ({
    pubkey: p.pubkey,
    event: p.eventMetadata?.title,
    market: p.marketMetadata?.title,
    yes: !!p.isYes,
    contracts: num(p.contractsDecimal),
    avgPrice: micro(p.avgPriceUsd),
    markPrice: micro(p.markPriceUsd),
    costUsd: micro(p.totalCostUsd),
    valueUsd: micro(p.valueUsd),
    pnlUsd: micro(p.pnlUsdAfterFees),
    pnlPct: num(p.pnlUsdAfterFeesPercent),
    claimable: !!p.claimable && !p.claimed,
    openedAt: seconds(p.openedAt),
  }));
}

export type PredictEventKind =
  'order_created' | 'order_filled' | 'order_failed' | 'order_closed' | 'payout_claimed' | (string & {});

export type PredictEvent = {
  id: string;
  kind: PredictEventKind;
  signature?: string;
  event?: string;
  market?: string;
  buy: boolean;
  yes: boolean;
  contracts?: number;
  filled?: number;
  avgPrice?: number;
  maxPrice?: number;
  costUsd?: number;
  proceedsUsd?: number;
  payoutUsd?: number;
  pnlUsd?: number;
  time?: number;
};

export async function getPredictHistory(
  address: string,
  start = 0
): Promise<{ events: PredictEvent[]; next?: number; total?: number }> {
  const { data, pagination } = await jup(
    `${JUP_API}/prediction/v1/history?ownerPubkey=${address}&start=${start}&end=${start + 40}`
  );
  const events = (data ?? []).map((e: any) => ({
    id: String(e.id),
    kind: e.eventType,
    signature: e.signature || undefined,
    event: e.eventMetadata?.title,
    market: e.marketMetadata?.title,
    buy: !!e.isBuy,
    yes: !!e.isYes,
    contracts: num(e.contractsDecimal),
    filled: num(e.filledContractsDecimal),
    avgPrice: micro(e.avgFillPriceUsd),
    maxPrice: micro(e.isBuy ? e.maxBuyPriceUsd : e.minSellPriceUsd),
    costUsd: micro(e.totalCostUsd),
    proceedsUsd: micro(e.netProceedsUsd),
    payoutUsd: micro(e.payoutAmountUsd),
    pnlUsd: micro(e.realizedPnl),
    time: seconds(e.timestamp),
  }));
  return { events, next: pagination?.hasNext ? pagination.end : undefined, total: pagination?.total };
}

// ---- Lend ---------------------------------------------------------------------------------------

export type LendPosition = {
  symbol: string;
  mint: string;
  icon?: string;
  amount: number;
  usd?: number;
  apyPct?: number;
};

export async function getLendPositions(address: string): Promise<LendPosition[]> {
  const list = await jup(`${JUP_API}/lend/v1/earn/positions?users=${address}`);
  return (list ?? [])
    .filter((p: any) => BigInt(p.underlyingAssets ?? '0') > 0n)
    .map((p: any) => {
      const asset = p.token?.asset ?? {};
      const amount = Number(p.underlyingAssets) / 10 ** (asset.decimals ?? p.token?.decimals ?? 0);
      const price = num(asset.price);
      return {
        symbol: asset.uiSymbol ?? asset.symbol ?? p.token?.symbol ?? '?',
        mint: p.token?.assetAddress ?? asset.address,
        icon: asset.logoUrl,
        amount,
        usd: price === undefined ? undefined : amount * price,
        // Rates are in basis points.
        apyPct: num(p.token?.totalRate) === undefined ? undefined : Number(p.token.totalRate) / 100,
      };
    });
}

// ---- Limit orders and DCA -----------------------------------------------------------------------

export type TriggerOrder = {
  key: string;
  inputMint: string;
  outputMint: string;
  making?: number;
  taking?: number;
  remaining?: number;
  createdAt?: number;
  expiresAt?: number;
  openTx?: string;
};

export async function getTriggerOrders(address: string): Promise<TriggerOrder[]> {
  const { orders } = await jup(`${JUP_API}/trigger/v1/getTriggerOrders?user=${address}&orderStatus=active`);
  return (orders ?? []).map((o: any) => ({
    key: o.orderKey,
    inputMint: o.inputMint,
    outputMint: o.outputMint,
    making: num(o.makingAmount),
    taking: num(o.takingAmount),
    remaining: num(o.remainingMakingAmount),
    createdAt: isoTime(o.createdAt),
    expiresAt: isoTime(o.expiredAt),
    openTx: o.openTx || undefined,
  }));
}

export type RecurringOrder = {
  key: string;
  inputMint: string;
  outputMint: string;
  deposited?: number;
  used?: number;
  received?: number;
  perCycle?: number;
  everySeconds?: number;
  createdAt?: number;
  openTx?: string;
};

export async function getRecurringOrders(address: string): Promise<RecurringOrder[]> {
  const body = await jup(
    `${JUP_API}/recurring/v1/getRecurringOrders?user=${address}&orderStatus=active&recurringType=all&includeFailedTx=false`
  );
  return (body.all ?? [...(body.time ?? []), ...(body.price ?? [])]).map((o: any) => ({
    key: o.orderKey,
    inputMint: o.inputMint,
    outputMint: o.outputMint,
    deposited: num(o.inDeposited),
    used: num(o.inUsed),
    received: num(o.outReceived),
    perCycle: num(o.inAmountPerCycle),
    everySeconds: num(o.cycleFrequency),
    createdAt: isoTime(o.createdAt),
    openTx: o.openTx || undefined,
  }));
}
