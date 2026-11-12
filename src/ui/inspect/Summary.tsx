import clsx from 'clsx';
import React, { FC, ReactNode, useState } from 'react';
import { Analysis, AssetDelta, Check, SOL, usdValue } from '../../sim/analyze';
import type { FreshQuote } from '../../sim/jupApi';
import type { JupiterSwap } from '../../sim/jupiter';
import { WSOL_MINT } from '../../sim/programs';
import { ChevronDown, RefreshIcon } from '../kit/icons';
import { Button, Collapse, Dot, Pill, Section, TokenIcon, Tone, toneText } from '../kit/kit';
import {
  formatAmount,
  formatBps,
  formatPct,
  formatUsd,
  iconOf,
  lamportsToSol,
  shortAddress,
  symbolOf,
  toneOf,
} from './format';

export type QuoteState = { loading: boolean; quote?: FreshQuote; error?: string };
export type SeriesPoint = { t: number; amount?: bigint; failed: boolean };

// Signed values: negative red, positive green, zero in the normal colour. Tiny bps moves count as zero.
const bpsTone = (bps?: number): Tone | undefined =>
  bps === undefined ? undefined : bps > 0.05 ? 'pos' : bps < -0.05 ? 'neg' : undefined;

const totalFee = (a: Analysis) => (a.fees.total ?? a.fees.base + a.fees.priority) + a.fees.jitoTip;
const solUsd = (a: Analysis, lamports: bigint) => formatUsd(usdValue({ mint: SOL, decimals: 9 }, lamports, a.tokens));

// Unix timestamps in error values and quotes read better as times.
const looksLikeTimestamp = (v: number) => v > 1_500_000_000 && v < 2_500_000_000;
const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString([], { hour12: false });
function relative(seconds: number) {
  const abs = Math.abs(seconds);
  const text = abs < 120 ? `${abs}s` : abs < 7200 ? `${Math.round(abs / 60)} min` : `${Math.round(abs / 3600)} h`;
  return seconds < 0 ? `${text} ago` : `in ${text}`;
}

// ---- Building blocks ------------------------------------------------------------------------------

const Card: FC<{ title?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }> = ({
  title,
  right,
  className,
  children,
}) => (
  <section className={clsx('rounded-card border border-line bg-raised px-5 py-4 max-[560px]:px-4', className)}>
    {title || right ? (
      <div className="mb-2 flex min-h-[28px] items-center gap-3">
        <h2 className="truncate text-[15px] font-semibold">{title}</h2>
        {right ? <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

const Stat: FC<{
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}> = ({ label, value, sub, tone, className, title }) => (
  <div className={clsx('min-w-0', className)} title={title}>
    <div className="truncate text-xs text-ink-2">{label}</div>
    <div className={clsx('mt-0.5 truncate text-[15px] font-semibold', tone && toneText[tone])}>{value}</div>
    {sub ? <div className="truncate text-xs text-ink-3">{sub}</div> : null}
  </div>
);

const Meter: FC<{ label: ReactNode; value: number; max: number; text: ReactNode }> = ({ label, value, max, text }) => {
  const ratio = max ? Math.min(1, value / max) : 0;
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate text-ink-2">{label}</span>
        <span className="shrink-0 text-ink-3">{text}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint">
        <div
          className={clsx('h-full rounded-full', ratio > 0.9 ? 'bg-warn' : 'bg-accent')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
};

// ---- Error ------------------------------------------------------------------------------------------

const ErrorValue: FC<{ side: string; value: string }> = ({ side, value }) => {
  const n = Number(value);
  return (
    <span>
      <span className="text-ink-3">{side}</span> <span className="font-semibold text-ink">{value}</span>
      {Number.isFinite(n) && looksLikeTimestamp(n) ? <span className="text-ink-3"> ({clock(n)})</span> : null}
    </span>
  );
};

export const ErrorBanner: FC<{ a: Analysis }> = ({ a }) => {
  const e = a.error;
  if (!e) return null;
  const swap = a.jupiter[0];
  const rfqExpired = a.rfq?.secondsLeft !== undefined && a.rfq.secondsLeft < 0;
  const left = Number(e.left);
  const right = Number(e.right);
  const timeGap = looksLikeTimestamp(left) && looksLikeTimestamp(right) ? right - left : undefined;
  return (
    <div className="rounded-card bg-neg-soft px-5 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[15px] font-semibold text-neg">{e.name ?? 'Simulation failed'}</span>
        {e.customCode !== undefined ? <span className="text-xs text-ink-3">#{e.customCode}</span> : null}
      </div>
      <div className="mt-0.5 break-words text-[13px] text-ink-2">
        {e.msg ? `${e.msg} · ` : ''}
        {a.labels[e.programId ?? ''] ?? e.programId ?? ''}
        {e.location ? <span className="mono text-ink-3"> · {e.location.split('/').slice(-2).join('/')}</span> : null}
        {e.account ? <span> · account {e.account}</span> : null}
        {!e.msg && !e.name ? e.text : null}
      </div>
      {e.left !== undefined || e.right !== undefined ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 text-[13px]">
          {e.left !== undefined ? <ErrorValue side="Left" value={e.left} /> : null}
          {e.right !== undefined ? <ErrorValue side="Right" value={e.right} /> : null}
          {timeGap !== undefined ? <span className="text-ink-2">{Math.abs(timeGap)}s apart</span> : null}
        </div>
      ) : null}
      {rfqExpired ? (
        <div className="mt-1.5 text-[13px]">
          The market maker's quote expired <b className="text-neg">{relative(a.rfq!.secondsLeft!)}</b> (at{' '}
          {clock(a.rfq!.expireAt!)}). RFQ quotes only live a few seconds: ask the dapp for a new one.
        </div>
      ) : null}
      {swap?.unbounded ? (
        <div className="mt-1.5 text-[13px]">
          Without the limit the route fills {formatBps(swap.unbounded.vsQuoteBps)} vs quote, which is{' '}
          <b className="text-neg">{formatBps(Math.abs(swap.unbounded.vsLimitBps)).replace(/^[+−]/, '')}</b> past your{' '}
          {swap.exactOut ? 'maximum input' : 'minimum output'}.
        </div>
      ) : null}
    </div>
  );
};

// ---- Balance changes ------------------------------------------------------------------------------

function displayChanges(a: Analysis) {
  const cost = a.user === a.feePayer ? totalFee(a) : 0n;
  // SOL and wSOL moving in opposite directions is wrapping or unwrapping, not two trades.
  let changes = a.userChanges;
  const sol = changes.find((c) => c.mint === SOL);
  const wsol = changes.find((c) => c.mint === WSOL_MINT);
  const notes: Record<string, string> = {};
  if (sol && wsol && sol.delta > 0n !== wsol.delta > 0n) {
    notes[SOL] =
      `incl. ${formatAmount(wsol.delta < 0n ? -wsol.delta : wsol.delta, 9, { maxFraction: 4 })} ${wsol.delta < 0n ? 'unwrapped' : 'wrapped'}`;
    changes = [{ ...sol, delta: sol.delta + wsol.delta }, ...changes.filter((c) => c !== sol && c !== wsol)];
  }
  // A SOL change that is only fees and tips shows as the fee line instead.
  changes = changes.filter((c) => c.delta !== 0n && !(c.mint === SOL && cost > 0n && c.delta === -cost));
  return { changes, notes, cost };
}

function assetName(asset: AssetDelta, a: Analysis) {
  if (asset.mint === SOL) return 'Solana';
  if (asset.mint === WSOL_MINT) return 'Wrapped SOL';
  const info = a.tokens[asset.mint];
  if (info?.name) return info.name;
  // Unlisted tokens moving by exactly one whole unit with no decimals are positions or NFTs
  // (lending positions, LP NFTs…), not fungible tokens.
  if (asset.decimals === 0 && (asset.delta === 1n || asset.delta === -1n)) return 'Position or NFT · unlisted';
  return 'Unlisted token';
}

export const AssetRow: FC<{ asset: AssetDelta; a: Analysis; note?: string }> = ({ asset, a, note }) => {
  const usd = usdValue(asset, asset.delta, a.tokens);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <TokenIcon src={iconOf(asset.mint, a.tokens)} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{symbolOf(asset.mint, a.tokens)}</div>
        <div className="truncate text-xs text-ink-3">{note ?? assetName(asset, a)}</div>
      </div>
      <div className="text-right">
        <div className={clsx('text-[17px] font-semibold', toneOf(asset.delta))}>
          {formatAmount(asset.delta, asset.decimals, { signed: true, maxFraction: asset.decimals > 6 ? 6 : 4 })}
        </div>
        <div className={clsx('text-xs', toneOf(usd))}>{formatUsd(usd, { signed: true }) || ' '}</div>
      </div>
    </div>
  );
};

// "1 SOL = 103.62 USDC" for what was bought, and the same at Jupiter's market prices.
function prices(a: Analysis) {
  const swap = a.swap;
  if (!swap) return undefined;
  const bought = Number(swap.bought.delta) / 10 ** swap.bought.decimals;
  const sold = Number(-swap.sold.delta) / 10 ** swap.sold.decimals;
  if (!bought || !sold) return undefined;
  const priceOf = (mint: string) => a.tokens[mint === SOL ? WSOL_MINT : mint]?.usdPrice;
  const pb = priceOf(swap.bought.mint);
  const ps = priceOf(swap.sold.mint);
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumSignificantDigits: 6 });
  const quote = symbolOf(swap.sold.mint, a.tokens);
  return {
    unit: `1 ${symbolOf(swap.bought.mint, a.tokens)}`,
    effective: `${fmt(sold / bought)} ${quote}`,
    market: pb && ps ? `${fmt(pb / ps)} ${quote}` : undefined,
  };
}

export const BalanceCard: FC<{ a: Analysis }> = ({ a }) => {
  const { changes, notes, cost } = displayChanges(a);
  const ordered = [...changes.filter((c) => c.delta < 0n), ...changes.filter((c) => c.delta > 0n)];
  const p = prices(a);
  const fee = totalFee(a);
  const payer = a.feePayer && a.feePayer !== a.user ? (a.labels[a.feePayer] ?? shortAddress(a.feePayer)) : undefined;
  return (
    <Card
      title={
        <>
          Balance changes <span className="font-normal text-ink-2">· {a.labels[a.user] ?? shortAddress(a.user)}</span>
        </>
      }
    >
      {ordered.length ? (
        <div className="-my-1 divide-y divide-line">
          {ordered.map((asset) => (
            <AssetRow key={asset.mint} asset={asset} a={a} note={notes[asset.mint]} />
          ))}
        </div>
      ) : (
        <p className="py-1 text-sm text-ink-2">
          {a.err ? 'Nothing moves: the transaction reverts.' : 'Nothing moves in or out of this address.'}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5 text-xs text-ink-2">
        <span className="truncate">
          {p ? (
            <>
              {p.unit} = <span className="font-semibold text-ink">{p.effective}</span>
              {p.market ? <span className="text-ink-3"> · market {p.market}</span> : null}
            </>
          ) : null}
        </span>
        <span className="truncate">
          Network fee{' '}
          <span className={clsx('font-semibold', cost > 0n ? 'text-neg' : 'text-ink')}>
            {cost > 0n ? '−' : ''}
            {lamportsToSol(fee)} SOL
          </span>
          {solUsd(a, fee) ? <span className="text-ink-3"> · {solUsd(a, fee)}</span> : null}
          {payer ? <span className="text-ink-3"> · paid by {payer}</span> : null}
        </span>
      </div>
    </Card>
  );
};

// ---- Execution --------------------------------------------------------------------------------------

export const ExecutionCard: FC<{ a: Analysis; quote?: QuoteState; onRequote: () => void }> = ({
  a,
  quote,
  onRequote,
}) => {
  const j = a.jupiter[0];
  const rfq = a.rfq;
  const otherSigners = a.signers.filter((s) => s !== a.user);
  const via = a.programs.map((id) => a.labels[id] ?? shortAddress(id));

  if (j) {
    const decimals = (j.exactOut ? j.inputDecimals : j.outputDecimals) ?? 0;
    const sym = symbolOf((j.exactOut ? j.inputMint : j.outputMint) ?? '', a.tokens);
    const simulated = j.exactOut ? j.inAmount : j.outAmount;
    const fresh = quote?.quote;
    const freshAmount = fresh ? (j.exactOut ? fresh.inAmount : fresh.outAmount) : undefined;
    const freshVsTx =
      freshAmount !== undefined && simulated
        ? (((j.exactOut ? -1 : 1) * Number(freshAmount - simulated)) / Number(simulated)) * 10_000
        : undefined;
    return (
      <Card
        title={
          <>
            Execution <span className="font-normal text-ink-2">· Jupiter {j.exactOut ? 'exact out' : 'route'}</span>
          </>
        }
        right={
          <Button
            kind="outline"
            size="sm"
            onClick={onRequote}
            disabled={quote?.loading || !j.inputMint || !j.outputMint}
          >
            <RefreshIcon size={12} className={quote?.loading ? 'animate-spin' : ''} />
            {fresh ? 'Re-quote' : 'Fresh quote'}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[520px]:grid-cols-4">
          {j.failed ? (
            <Stat
              label="Short of limit"
              value={j.unbounded ? `−${formatBps(Math.abs(j.unbounded.vsLimitBps)).replace(/^[+−]/, '')}` : 'Reverts'}
              tone="neg"
              sub={j.unbounded ? `fills ${formatBps(j.unbounded.vsQuoteBps)} vs quote` : undefined}
            />
          ) : (
            <Stat
              label="vs quote"
              value={formatBps(j.vsQuoteBps) || '—'}
              tone={bpsTone(j.vsQuoteBps)}
              sub="simulated fill"
            />
          )}
          <Stat
            label="vs market"
            value={formatBps(j.vsMarketBps) || '—'}
            tone={bpsTone(j.vsMarketBps)}
            sub={j.inUsd !== undefined ? `${formatUsd(j.inUsd)} → ${formatUsd(j.outUsd) || '—'}` : 'no price'}
          />
          <Stat
            label={j.exactOut ? 'Room to max in' : 'Room to min out'}
            value={
              j.headroomUsd !== undefined
                ? formatUsd(j.headroomUsd)
                : j.headroom !== undefined
                  ? formatAmount(j.headroom, decimals)
                  : '—'
            }
            sub={j.headroom !== undefined ? `${formatAmount(j.headroom, decimals)} ${sym}` : undefined}
            title="How much worse the fill can get before the swap reverts; also what a sandwich could take."
          />
          <Stat label="Slippage" value={formatPct(j.slippageBps)} sub={`platform fee ${formatPct(j.platformFeeBps)}`} />
        </div>
        {fresh || quote?.error ? (
          <div className="mt-3 rounded-xl bg-tint px-3.5 py-2 text-[13px]">
            {fresh ? (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink-2">Fresh quote now</span>
                <span className="font-semibold">
                  {formatAmount(freshAmount!, decimals)} {sym}
                </span>
                {freshVsTx !== undefined ? (
                  <span className={toneText[bpsTone(freshVsTx) ?? 'muted']}>
                    {formatBps(freshVsTx)} vs this transaction
                  </span>
                ) : null}
                <span className="w-full truncate text-xs text-ink-3">
                  {fresh.route.join(' · ')} · impact {(fresh.priceImpactPct * 100).toFixed(3)}%
                </span>
              </div>
            ) : (
              <span className="text-neg">Quote failed: {quote?.error}</span>
            )}
          </div>
        ) : null}
      </Card>
    );
  }

  if (rfq) {
    const inDec = rfq.inputMint ? a.tokens[rfq.inputMint]?.decimals : undefined;
    const outDec = rfq.outputMint
      ? (a.tokens[rfq.outputMint]?.decimals ?? (rfq.outputMint === WSOL_MINT ? 9 : undefined))
      : undefined;
    const amount = (v: bigint | undefined, d: number | undefined, mint?: string) =>
      v === undefined
        ? '—'
        : `${d !== undefined ? formatAmount(v, d, { maxFraction: 2 }) : v.toString()} ${mint ? symbolOf(mint, a.tokens) : ''}`;
    const expired = rfq.secondsLeft !== undefined && rfq.secondsLeft < 0;
    return (
      <Card
        title={
          <>
            Execution <span className="font-normal text-ink-2">· RFQ quote from a market maker</span>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[520px]:grid-cols-4">
          <Stat label="You pay" value={amount(rfq.inputAmount, inDec, rfq.inputMint)} />
          <Stat label="You receive" value={amount(rfq.outputAmount, outDec, rfq.outputMint)} />
          <Stat
            label="Quote expires"
            value={rfq.secondsLeft !== undefined ? relative(rfq.secondsLeft) : '—'}
            tone={expired ? 'neg' : rfq.secondsLeft !== undefined && rfq.secondsLeft < 10 ? 'warn' : undefined}
            sub={rfq.expireAt ? `at ${clock(rfq.expireAt)}` : undefined}
          />
          <Stat
            label="Market maker"
            value={rfq.maker ? (a.labels[rfq.maker] ?? shortAddress(rfq.maker)) : '—'}
            sub={
              a.swap?.vsMarketBps !== undefined ? (
                <span className={toneText[bpsTone(a.swap.vsMarketBps) ?? 'muted']}>
                  {formatBps(a.swap.vsMarketBps)} vs market
                </span>
              ) : (
                'pays the network fee'
              )
            }
          />
        </div>
      </Card>
    );
  }

  const p = prices(a);
  return (
    <Card title={a.swap ? 'Execution' : 'Programs'}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[520px]:grid-cols-4">
        {a.swap ? (
          <>
            <Stat
              label="vs market"
              value={formatBps(a.swap.vsMarketBps) || '—'}
              tone={bpsTone(a.swap.vsMarketBps)}
              sub={
                a.swap.soldUsd !== undefined
                  ? `${formatUsd(a.swap.soldUsd)} → ${formatUsd(a.swap.boughtUsd) || '—'}`
                  : 'no price'
              }
            />
            <Stat
              label={`Price · ${p?.unit ?? ''}`}
              value={p?.effective ?? '—'}
              sub={p?.market ? `market ${p.market}` : undefined}
            />
          </>
        ) : null}
        <Stat
          className={a.swap ? '' : 'col-span-2'}
          label="Route via"
          value={via.length ? via.join(' · ') : 'Built-in programs only'}
        />
        <Stat
          label={a.swap ? 'Filled by' : 'Also signed by'}
          value={otherSigners.length ? otherSigners.map((s) => a.labels[s] ?? shortAddress(s)).join(', ') : '—'}
        />
      </div>
    </Card>
  );
};

// ---- Accordions -------------------------------------------------------------------------------------

const Sparkline: FC<{ series: SeriesPoint[]; quoted?: bigint; limit?: bigint }> = ({ series, quoted, limit }) => {
  const points = series.filter((p) => p.amount !== undefined) as { t: number; amount: bigint }[];
  if (points.length < 2)
    return <div className="flex h-10 items-center text-xs text-ink-3">Fills in as it re-simulates…</div>;
  const values = [
    ...points.map((p) => Number(p.amount)),
    ...(quoted ? [Number(quoted)] : []),
    ...(limit ? [Number(limit)] : []),
  ];
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const w = 480;
  const h = 40;
  const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p.amount)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      {quoted ? (
        <line
          x1={0}
          x2={w}
          y1={y(Number(quoted))}
          y2={y(Number(quoted))}
          stroke="var(--ink-3)"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {limit ? (
        <line
          x1={0}
          x2={w}
          y1={y(Number(limit))}
          y2={y(Number(limit))}
          stroke="var(--neg)"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const RouteSection: FC<{ a: Analysis; swap: JupiterSwap; series: SeriesPoint[] }> = ({ a, swap, series }) => {
  const [showHops, setShowHops] = useState(false);
  const inSym = swap.inputMint ? symbolOf(swap.inputMint, a.tokens) : '?';
  const outSym = swap.outputMint ? symbolOf(swap.outputMint, a.tokens) : '?';
  const fmt = (v: bigint | undefined, side: 'in' | 'out') =>
    v === undefined
      ? '—'
      : `${formatAmount(v, (side === 'in' ? swap.inputDecimals : swap.outputDecimals) ?? 0)} ${side === 'in' ? inSym : outSym}`;
  const side = swap.exactOut ? 'in' : 'out';
  const quoted = swap.exactOut ? swap.quotedInAmount : swap.quotedOutAmount;
  const limit = swap.exactOut ? swap.maxInAmount : swap.minOutAmount;
  const simulated = swap.exactOut ? swap.inAmount : swap.outAmount;
  const venues = [...new Set(swap.hops.map((h) => h.label))];

  return (
    <Section
      title="Jupiter route"
      summary={`${swap.instruction} · ${venues.length ? venues.slice(0, 3).join(', ') + (venues.length > 3 ? '…' : '') : `${swap.route.length} steps`}`}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[520px]:grid-cols-4">
        <Stat label={`Quoted ${side}`} value={fmt(quoted, side)} />
        <Stat
          label={`Simulated ${side}`}
          value={swap.failed ? <span className="text-neg">Reverts</span> : fmt(simulated, side)}
          sub={
            swap.vsQuoteBps !== undefined ? (
              <span className={toneText[bpsTone(swap.vsQuoteBps) ?? 'muted']}>{formatBps(swap.vsQuoteBps)}</span>
            ) : undefined
          }
        />
        <Stat
          label={`${swap.exactOut ? 'Max in' : 'Min out'} (${formatPct(swap.slippageBps)})`}
          value={fmt(limit, side)}
        />
        <Stat
          label="Fees"
          value={`Platform ${formatPct(swap.platformFeeBps)}`}
          sub={
            swap.positiveSlippageBps !== undefined
              ? `pos. slippage cap ${formatPct(swap.positiveSlippageBps)}`
              : undefined
          }
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 min-[560px]:grid-cols-[1fr_220px] min-[560px]:gap-6">
        <div className="space-y-1.5">
          {swap.route.map((step, i) => (
            <div key={i} className="flex items-center gap-2.5 text-[13px]">
              <span className="w-32 shrink-0 truncate" title={step.label}>
                {step.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, step.pct)}%` }} />
              </div>
              <span className="w-11 shrink-0 text-right text-ink-2">{Number(step.pct.toFixed(1))}%</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs text-ink-2">Simulated {side} · live</div>
          <Sparkline series={series} quoted={quoted} limit={limit} />
        </div>
      </div>
      {swap.hops.length ? (
        <>
          <button
            type="button"
            onClick={() => setShowHops(!showHops)}
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {showHops ? 'Hide' : 'Show'} the {swap.hops.length} simulated hops
            <ChevronDown size={14} className={clsx('transition-transform', showHops && 'rotate-180')} />
          </button>
          <Collapse open={showHops}>
            <div className="mt-2 grid grid-cols-2 gap-x-6">
              {swap.hops.map((hop, i) => {
                const inDec = a.tokens[hop.inputMint]?.decimals ?? (hop.inputMint === WSOL_MINT ? 9 : undefined);
                const outDec = a.tokens[hop.outputMint]?.decimals ?? (hop.outputMint === WSOL_MINT ? 9 : undefined);
                const amt = (v: bigint, d?: number) =>
                  d !== undefined ? formatAmount(v, d, { maxFraction: 2 }) : v.toString();
                return (
                  <div key={i} className="flex items-center gap-2.5 border-b border-line py-1.5 text-[13px]">
                    <span className="w-24 shrink-0 truncate font-semibold" title={hop.program ?? hop.amm}>
                      {hop.label}
                    </span>
                    <span className="truncate text-ink-2">
                      {amt(hop.inputAmount, inDec)} {symbolOf(hop.inputMint, a.tokens)} →{' '}
                      {amt(hop.outputAmount, outDec)} {symbolOf(hop.outputMint, a.tokens)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Collapse>
        </>
      ) : null}
    </Section>
  );
};

function priorityRank(a: Analysis) {
  const pf = a.priorityFees;
  if (!pf || !pf.samples) return undefined;
  const p = Number(a.compute.microLamportsPerCu);
  return p >= pf.p90 ? '≥ p90' : p >= pf.p75 ? 'p75–p90' : p >= pf.p50 ? 'p50–p75' : p >= pf.p25 ? 'p25–p50' : '< p25';
}

export const FeesSection: FC<{ a: Analysis; defaultOpen?: boolean; withBreakdown?: boolean }> = ({
  a,
  defaultOpen,
  withBreakdown,
}) => {
  const { fees, rent, compute } = a;
  const rentPaid = rent.created.reduce((s, c) => s + c.lamports, 0n);
  const rentBack = rent.closed.reduce((s, c) => s + c.lamports, 0n);
  const rentNet = rentBack - rentPaid;
  const rank = priorityRank(a);
  const mib = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MiB`;
  return (
    <Section
      defaultOpen={defaultOpen}
      title="Fees & compute"
      summary={`${lamportsToSol(totalFee(a))} SOL · ${compute.consumed?.toLocaleString() ?? '—'} / ${compute.limit.toLocaleString()} CU · ${a.size} B`}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[520px]:grid-cols-4">
        <Stat
          label="Base"
          value={lamportsToSol(fees.base)}
          sub={`${a.signers.length} signature${a.signers.length > 1 ? 's' : ''}`}
        />
        <Stat
          label={a.v1Config ? 'Priority · v1 header' : 'Priority'}
          value={lamportsToSol(fees.priority)}
          sub={
            a.v1Config
              ? `${(a.v1Config.priorityFeeLamports ?? 0n).toLocaleString()} lamports flat`
              : `${Number(compute.microLamportsPerCu).toLocaleString()} µL/CU${rank ? ` · ${rank}` : ''}`
          }
        />
        <Stat label="Jito tip" value={fees.jitoTip ? lamportsToSol(fees.jitoTip) : 'None'} />
        <Stat
          label="Rent"
          value={rentNet ? formatAmount(rentNet, 9, { signed: true, maxFraction: 6 }) : 'None'}
          tone={rentNet > 0n ? 'pos' : rentNet < 0n ? 'neg' : undefined}
          sub={rentPaid || rentBack ? `${rent.created.length} opened · ${rent.closed.length} closed` : undefined}
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-5">
        <Meter
          label={compute.explicitLimit ? 'Compute' : 'CU · default'}
          value={compute.consumed ?? 0}
          max={compute.limit}
          text={`${compute.consumed?.toLocaleString() ?? '—'} / ${compute.limit.toLocaleString()}`}
        />
        <Meter
          label={`Size · ${a.version === 'legacy' ? 'legacy' : `v${String(a.version)}`}`}
          value={a.size}
          max={a.maxSize}
          text={`${a.size} / ${a.maxSize} B`}
        />
        {a.loadedAccountsDataSize !== undefined ? (
          <Meter
            label="Data"
            value={a.loadedAccountsDataSize}
            max={a.loadedAccountsDataLimit}
            text={`${mib(a.loadedAccountsDataSize)} / ${mib(a.loadedAccountsDataLimit)}`}
          />
        ) : null}
      </div>
      {a.priorityFees ? (
        <p className="mt-3 text-xs text-ink-3">
          Recent priority fees on these accounts: p50 {a.priorityFees.p50.toLocaleString()} · p75{' '}
          {a.priorityFees.p75.toLocaleString()} · p90 {a.priorityFees.p90.toLocaleString()} µL/CU
        </p>
      ) : null}
      {withBreakdown && a.invokeTree.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1 text-[13px] font-semibold">Compute breakdown</div>
          <ComputeTree a={a} />
        </div>
      ) : null}
    </Section>
  );
};

const CheckRow: FC<{ check: Check }> = ({ check }) => (
  <div className="flex gap-2.5 py-1.5">
    <Dot tone={check.level === 'ok' ? 'pos' : check.level === 'error' ? 'neg' : check.level} className="mt-[7px]" />
    <div className="min-w-0">
      <div className="text-[13px] font-semibold">{check.title}</div>
      {check.detail ? <div className="break-words text-xs text-ink-2">{check.detail}</div> : null}
    </div>
  </div>
);

export const ChecksSection: FC<{ a: Analysis; defaultOpen?: boolean }> = ({ a, defaultOpen }) => {
  const passed = a.checks.filter((c) => c.level === 'ok').length;
  const warnings = a.checks.filter((c) => c.level === 'warn' || c.level === 'error').length;
  const notes = a.checks.filter((c) => c.level === 'info').length;
  // Problems first, then notes, then what passed.
  const order = { error: 0, warn: 1, info: 2, ok: 3 } as const;
  const sorted = [...a.checks].sort((x, y) => order[x.level] - order[y.level]);
  return (
    <Section
      defaultOpen={defaultOpen}
      title="Checks"
      summary={
        <span className="inline-flex items-center gap-1.5">
          {passed} passed
          {warnings ? (
            <Pill tone={a.checks.some((c) => c.level === 'error') ? 'neg' : 'warn'}>{warnings} to look at</Pill>
          ) : null}
          {notes ? (
            <Pill tone="info">
              {notes} note{notes > 1 ? 's' : ''}
            </Pill>
          ) : null}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-x-6">
        {sorted.map((c, i) => (
          <CheckRow key={i} check={c} />
        ))}
      </div>
    </Section>
  );
};

export const OthersSection: FC<{ a: Analysis; renderAddress: (address: string) => ReactNode }> = ({
  a,
  renderAddress,
}) => {
  if (!a.others.length) return null;
  return (
    <Section title="Other accounts" summary={`${a.others.length} touched · pools, vaults, other owners`}>
      <div className="grid grid-cols-2 gap-x-6">
        {a.others.map((o) => (
          <div key={o.owner} className="border-b border-line py-2">
            <div className="text-[13px] font-semibold">{renderAddress(o.owner)}</div>
            {o.assets.map((asset) => (
              <div key={asset.mint} className="flex justify-between text-[13px]">
                <span className="text-ink-2">{symbolOf(asset.mint, a.tokens)}</span>
                <span className={toneOf(asset.delta)}>
                  {formatAmount(asset.delta, asset.decimals, { signed: true })}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
};

// ---- Compute breakdown --------------------------------------------------------------------------------

type InvokeNode = Analysis['invokeTree'][number];

const ComputeRow: FC<{ node: InvokeNode; a: Analysis; total: number; depth: number }> = ({ node, a, total, depth }) => {
  const cu = node.computeUnits ?? 0;
  const share = total ? cu / total : 0;
  // Calls under 1% of the transaction are folded into one line per parent.
  const big = node.children.filter((c) => (c.computeUnits ?? 0) / total >= 0.01);
  const small = node.children.filter((c) => (c.computeUnits ?? 0) / total < 0.01);
  const smallCu = small.reduce((s, c) => s + (c.computeUnits ?? 0), 0);
  return (
    <>
      {/* Narrow (side panel): the name takes the free width and the bar goes. */}
      <div className="flex items-center gap-3 py-1 text-[13px]" style={{ paddingLeft: depth * 12 }}>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate min-[520px]:w-44 min-[520px]:flex-none min-[520px]:shrink-0',
            depth === 0 && 'font-semibold',
            node.failed && 'text-neg'
          )}
          title={node.programId}
        >
          {a.labels[node.programId] ?? shortAddress(node.programId)}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint max-[519px]:hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, cu ? 0.5 : 0)}%` }} />
        </div>
        <span className="w-16 shrink-0 text-right text-ink-2 min-[520px]:w-28">
          {node.computeUnits !== undefined ? cu.toLocaleString() : '—'}
        </span>
        <span className="w-10 shrink-0 text-right text-ink-3">
          {cu ? `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%` : ''}
        </span>
      </div>
      {big.map((child, i) => (
        <ComputeRow key={i} node={child} a={a} total={total} depth={depth + 1} />
      ))}
      {small.length ? (
        <div className="py-0.5 text-xs text-ink-3" style={{ paddingLeft: (depth + 1) * 16 }}>
          + {small.length} small call{small.length > 1 ? 's' : ''} · {smallCu.toLocaleString()} CU
        </div>
      ) : null}
    </>
  );
};

export const ComputeTree: FC<{ a: Analysis }> = ({ a }) => {
  const total = a.compute.consumed ?? a.invokeTree.reduce((s, n) => s + (n.computeUnits ?? 0), 0);
  if (!a.invokeTree.length || !total) return null;
  return (
    <div>
      <p className="mb-2 text-xs text-ink-3">
        Each call counts its own work and its callees'. Runtime overhead outside programs is not attributed.
      </p>
      {a.invokeTree.map((node, i) => (
        <ComputeRow key={i} node={node} a={a} total={total} depth={0} />
      ))}
    </div>
  );
};

export const ComputeSection: FC<{ a: Analysis; defaultOpen?: boolean }> = ({ a, defaultOpen }) => {
  const total = a.compute.consumed ?? a.invokeTree.reduce((s, n) => s + (n.computeUnits ?? 0), 0);
  if (!a.invokeTree.length || !total) return null;
  const heaviest = [...a.invokeTree].sort((x, y) => (y.computeUnits ?? 0) - (x.computeUnits ?? 0))[0];
  return (
    <Section
      defaultOpen={defaultOpen}
      title="Compute breakdown"
      summary={`${a.labels[heaviest.programId] ?? shortAddress(heaviest.programId)} ${Math.round(((heaviest.computeUnits ?? 0) / total) * 100)}% of ${total.toLocaleString()} CU`}
    >
      <ComputeTree a={a} />
    </Section>
  );
};

// ---- Other routers ------------------------------------------------------------------------------------

export const RoutersSection: FC<{ a: Analysis }> = ({ a }) => {
  if (!a.routers.length) return null;
  const amount = (mint: string | undefined, v: bigint | undefined) => {
    if (!mint || v === undefined) return '—';
    const decimals = mint === SOL || mint === WSOL_MINT ? 9 : a.tokens[mint]?.decimals;
    return `${decimals !== undefined ? formatAmount(v, decimals, { maxFraction: 2 }) : v.toString()} ${symbolOf(mint, a.tokens)}`;
  };
  return (
    <>
      {a.routers.map((r) => (
        <Section
          key={r.path}
          title={`Route · ${r.label}`}
          summary={`${r.hops.length} hop${r.hops.length > 1 ? 's' : ''} · ${[...new Set(r.hops.map((h) => h.label))].slice(0, 3).join(', ')}`}
        >
          <p className="mb-2 text-xs text-ink-3">Read from the tokens moved inside each venue call.</p>
          <div className="divide-y divide-line">
            {r.hops.map((h) => (
              <div key={h.path} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="w-10 shrink-0 text-ink-3">{h.path}</span>
                <span className="w-36 shrink-0 truncate font-semibold" title={h.program}>
                  {h.label}
                </span>
                <span className="truncate text-ink-2">
                  {amount(h.inputMint, h.inputAmount)} → {amount(h.outputMint, h.outputAmount)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
};
