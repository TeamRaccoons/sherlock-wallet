import type { Instr } from './analyze';
import type { TokenInfo } from './jupApi';
import { isTokenProgram, JUPITER_V6 } from './programs';

export type JupiterHop = {
  amm: string;
  program?: string;
  label: string;
  inputMint: string;
  inputAmount: bigint;
  outputMint: string;
  outputAmount: bigint;
};

export type JupiterSwap = {
  path: string;
  instruction: string;
  exactOut: boolean;
  failed: boolean;
  inputMint?: string;
  outputMint?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  // Amounts the simulation actually produced (exact-in: in is fixed, out is simulated; exact-out:
  // out is fixed, in is simulated). Undefined when the simulation failed.
  inAmount?: bigint;
  outAmount?: bigint;
  quotedOutAmount?: bigint;
  quotedInAmount?: bigint;
  minOutAmount?: bigint;
  maxInAmount?: bigint;
  slippageBps: number;
  platformFeeBps: number;
  positiveSlippageBps?: number;
  // Positive: better than quoted.
  vsQuoteBps?: number;
  // Distance to the slippage limit: how much worse the fill could get before the swap reverts —
  // also the most a sandwich could extract.
  headroom?: bigint;
  headroomUsd?: number;
  inUsd?: number;
  outUsd?: number;
  vsMarketBps?: number;
  // Set when the swap reverted on slippage: the fill the route would have given without the limit
  // (out amount for exact-in, in amount for exact-out) and how far past the limit it was.
  unbounded?: { amount: bigint; vsQuoteBps: number; vsLimitBps: number };
  route: { label: string; pct: number; inputIndex: number; outputIndex: number }[];
  hops: JupiterHop[];
  fee?: { mint: string; amount: bigint; account: string };
};

const ROUTE_IX = /route/;

const accountByName = (ix: Instr, ...names: string[]) =>
  ix.accounts.find((a) => a.name && names.includes(a.name))?.address;

function readU64(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length < 8) return undefined;
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

const toBig = (v: unknown) =>
  typeof v === 'bigint' ? v : v === undefined || v === null ? undefined : BigInt(v as number);

const toUi = (amount: bigint, decimals?: number) => Number(amount) / 10 ** (decimals ?? 0);

export function analyzeJupiter(ctx: {
  instructions: Instr[];
  tokens: Record<string, TokenInfo>;
  labels: Record<string, string>;
  tokenAccountOwner: Map<string, { owner: string; mint: string }>;
  decimals: Map<string, number>;
  ammLabels: Record<string, string>;
  simulationFailed: boolean;
}): JupiterSwap[] {
  const out: JupiterSwap[] = [];
  for (const ix of ctx.instructions) {
    if (ix.programId !== JUPITER_V6 || !ix.decoded || !ROUTE_IX.test(ix.decoded.name)) continue;
    const args = ix.decoded.args ?? {};
    const exactOut = ix.decoded.name.includes('exact_out');

    const hops: JupiterHop[] = [];
    let fee: JupiterSwap['fee'];
    for (const inner of ix.inner) {
      const ev = inner.event;
      if (!ev) continue;
      const events = ev.name === 'SwapsEvent' ? ev.data.swap_events : ev.name === 'SwapEvent' ? [ev.data] : [];
      for (const e of events) {
        // `amm` is the AMM program id in current events, a pool address in older ones.
        const program =
          ctx.ammLabels[e.amm] || ix.inner.some((c) => c.programId === e.amm)
            ? e.amm
            : ix.inner.find(
                (c) =>
                  c.programId !== JUPITER_V6 &&
                  !isTokenProgram(c.programId) &&
                  c.accounts.some((a) => a.address === e.amm)
              )?.programId;
        hops.push({
          amm: e.amm,
          program,
          label: (program && (ctx.ammLabels[program] ?? ctx.labels[program])) ?? `${e.amm.slice(0, 4)}…`,
          inputMint: e.input_mint,
          inputAmount: toBig(e.input_amount)!,
          outputMint: e.output_mint,
          outputAmount: toBig(e.output_amount)!,
        });
      }
      if (ev.name === 'FeeEvent')
        fee = { mint: ev.data.mint, amount: toBig(ev.data.amount)!, account: ev.data.account };
    }

    const mintOf = (account?: string) => (account ? ctx.tokenAccountOwner.get(account)?.mint : undefined);
    const inputMint =
      accountByName(ix, 'source_mint') ??
      mintOf(accountByName(ix, 'user_source_token_account', 'source_token_account')) ??
      hops[0]?.inputMint;
    const outputMint =
      accountByName(ix, 'destination_mint') ??
      mintOf(accountByName(ix, 'user_destination_token_account', 'destination_token_account')) ??
      hops[hops.length - 1]?.outputMint;
    const decimalsOf = (mint?: string) => (mint ? (ctx.decimals.get(mint) ?? ctx.tokens[mint]?.decimals) : undefined);

    const slippageBps = Number(args.slippage_bps ?? 0);
    const route = ((args.route_plan as any[]) ?? []).map((step) => ({
      label: typeof step.swap === 'string' ? step.swap : (Object.keys(step.swap ?? {})[0] ?? '?'),
      pct: step.percent !== undefined ? Number(step.percent) : Number(step.bps ?? 0) / 100,
      inputIndex: Number(step.input_index),
      outputIndex: Number(step.output_index),
    }));

    const returned = ix.returnData ? readU64(ix.returnData) : undefined;
    const swap: JupiterSwap = {
      path: ix.path,
      instruction: ix.decoded.name,
      exactOut,
      // A transaction-level failure means nothing ran, so nothing was filled either.
      failed: !!ix.failed || (ctx.simulationFailed && !ix.computeUnits),
      inputMint,
      outputMint,
      inputDecimals: decimalsOf(inputMint),
      outputDecimals: decimalsOf(outputMint),
      slippageBps,
      platformFeeBps: Number(args.platform_fee_bps ?? 0),
      positiveSlippageBps: args.positive_slippage_bps !== undefined ? Number(args.positive_slippage_bps) : undefined,
      route,
      hops,
      fee,
    };

    const sumHops = (mint: string | undefined, side: 'input' | 'output') =>
      hops
        .filter((h) => (side === 'input' ? h.inputMint : h.outputMint) === mint)
        .reduce((s, h) => s + (side === 'input' ? h.inputAmount : h.outputAmount), 0n);

    if (!exactOut) {
      swap.inAmount = toBig(args.in_amount) ?? (hops.length ? sumHops(inputMint, 'input') : undefined);
      swap.quotedOutAmount = toBig(args.quoted_out_amount);
      if (swap.quotedOutAmount !== undefined) {
        swap.minOutAmount = (swap.quotedOutAmount * BigInt(10_000 - slippageBps) + 9_999n) / 10_000n;
      }
      if (!swap.failed)
        swap.outAmount = returned ?? (hops.length ? sumHops(outputMint, 'output') - (fee?.amount ?? 0n) : undefined);
      if (swap.outAmount !== undefined && swap.quotedOutAmount) {
        swap.vsQuoteBps = (Number(swap.outAmount - swap.quotedOutAmount) / Number(swap.quotedOutAmount)) * 10_000;
        swap.headroom = swap.outAmount - (swap.minOutAmount ?? 0n);
      }
    } else {
      swap.outAmount = toBig(args.out_amount);
      swap.quotedInAmount = toBig(args.quoted_in_amount);
      if (swap.quotedInAmount !== undefined) {
        swap.maxInAmount = (swap.quotedInAmount * BigInt(10_000 + slippageBps)) / 10_000n;
      }
      if (!swap.failed) swap.inAmount = returned ?? (hops.length ? sumHops(inputMint, 'input') : undefined);
      if (swap.inAmount !== undefined && swap.quotedInAmount) {
        swap.vsQuoteBps = (Number(swap.quotedInAmount - swap.inAmount) / Number(swap.quotedInAmount)) * 10_000;
        swap.headroom = (swap.maxInAmount ?? 0n) - swap.inAmount;
      }
    }

    const priceIn = inputMint ? ctx.tokens[inputMint]?.usdPrice : undefined;
    const priceOut = outputMint ? ctx.tokens[outputMint]?.usdPrice : undefined;
    if (priceIn !== undefined && swap.inAmount !== undefined)
      swap.inUsd = toUi(swap.inAmount, swap.inputDecimals) * priceIn;
    if (priceOut !== undefined && swap.outAmount !== undefined)
      swap.outUsd = toUi(swap.outAmount, swap.outputDecimals) * priceOut;
    if (swap.inUsd && swap.outUsd !== undefined) swap.vsMarketBps = ((swap.outUsd - swap.inUsd) / swap.inUsd) * 10_000;
    if (swap.headroom !== undefined) {
      const [price, decimals] = exactOut ? [priceIn, swap.inputDecimals] : [priceOut, swap.outputDecimals];
      if (price !== undefined) swap.headroomUsd = toUi(swap.headroom, decimals) * price;
    }
    out.push(swap);
  }
  return out;
}
