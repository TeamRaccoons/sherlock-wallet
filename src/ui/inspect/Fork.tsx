import clsx from 'clsx';
import React, { FC, useEffect, useState } from 'react';
import type { Analysis } from '../../sim/analyze';
import { WSOL_MINT } from '../../sim/programs';
import { CheckIcon, XIcon } from '../kit/icons';
import { Button, IconButton, Pill, TokenIcon } from '../kit/kit';
import { formatAmount, iconOf, shortAddress, symbolOf } from './format';

// One change to the forked state: set the viewing address's SOL or token balance (UI units).
export type ForkChange = { mint: 'SOL' | string; amount: number };

export type ForkStats = { fetchedBytes: number; vmMs: number; memoryBytes: number; features: number };

type BalanceRow = { mint: string; decimals: number; real: bigint };

const kb = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
const ui = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

// The target wallet's real SOL and token balances, for SOL and every token the transaction touches.
export function balanceRows(a: Analysis | undefined, target: string): BalanceRow[] {
  if (!a) return [];
  const rows = new Map<string, BalanceRow>();
  const self = a.accounts.find((x) => x.address === target);
  rows.set('SOL', { mint: 'SOL', decimals: 9, real: BigInt(self?.preLamports ?? 0) });
  for (const acc of a.accounts) {
    if (acc.token && acc.token.owner === target) {
      const prev = rows.get(acc.token.mint);
      rows.set(acc.token.mint, {
        mint: acc.token.mint,
        decimals: acc.token.decimals,
        real: (prev?.real ?? 0n) + acc.token.pre,
      });
    }
  }
  const traded = [
    ...a.jupiter.flatMap((j) => [
      [j.inputMint, j.inputDecimals],
      [j.outputMint, j.outputDecimals],
    ]),
    [a.rfq?.inputMint, a.rfq?.inputMint ? a.tokens[a.rfq.inputMint]?.decimals : undefined],
    [a.rfq?.outputMint, a.rfq?.outputMint ? a.tokens[a.rfq.outputMint]?.decimals : undefined],
  ] as [string | undefined, number | undefined][];
  for (const [mint, decimals] of traded) {
    if (!mint || rows.has(mint) || mint === WSOL_MINT) continue;
    const d = decimals ?? a.tokens[mint]?.decimals;
    if (d !== undefined) rows.set(mint, { mint, decimals: d, real: 0n });
  }
  return [...rows.values()];
}

// What the wallet needs for the trade to have a chance: SOL for fees and rent, and the amount of
// the token it spends. Only proposes amounts above what the wallet already has.
export function fundingSuggestion(a: Analysis | undefined, target: string): ForkChange[] {
  if (!a) return [];
  const rows = new Map(balanceRows(a, target).map((r) => [r.mint, r]));
  const out: ForkChange[] = [];
  const sol = rows.get('SOL');
  if (!sol || ui(sol.real, 9) < 0.05) out.push({ mint: 'SOL', amount: 1 });
  const spend: [string | undefined, bigint | undefined, number | undefined][] = [
    [
      a.jupiter[0]?.inputMint,
      a.jupiter[0]?.exactOut ? a.jupiter[0]?.maxInAmount : a.jupiter[0]?.inAmount,
      a.jupiter[0]?.inputDecimals,
    ],
    [a.rfq?.inputMint, a.rfq?.inputAmount, a.rfq?.inputMint ? a.tokens[a.rfq.inputMint]?.decimals : undefined],
  ];
  for (const [mint, amount, decimals] of spend) {
    if (!mint || amount === undefined || decimals === undefined) continue;
    const key = mint === WSOL_MINT ? 'SOL' : mint;
    const have = rows.get(key)?.real ?? 0n;
    if (have >= amount) continue;
    const need = Math.ceil(ui(amount, decimals) * 1.01 * 100) / 100;
    const i = out.findIndex((c) => c.mint === key);
    if (i >= 0) out[i] = { mint: key, amount: Math.max(out[i].amount, need) };
    else out.push({ mint: key, amount: need });
  }
  return out;
}

// Whether a failure looks like missing funds (so a funded fork is worth suggesting).
export const looksUnfunded = (a?: Analysis) =>
  !!a?.err &&
  /insufficient|AccountNotFound|no SOL account|0x1\b/i.test(`${a.error?.name ?? ''} ${a.error?.text ?? ''}`);

const Outcome: FC<{ label: string; a?: Analysis }> = ({ label, a }) =>
  a ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ink-3">{label}</span>
      {a.err ? (
        <Pill tone="neg">fails · {a.error?.name ?? (typeof a.err === 'string' ? a.err : 'error')}</Pill>
      ) : (
        <Pill tone="pos">
          <CheckIcon size={11} /> succeeds
        </Pill>
      )}
    </span>
  ) : null;

const BalanceInput: FC<{ row: BalanceRow; value?: number; onSet: (v?: number) => void }> = ({ row, value, onSet }) => {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : '');
  useEffect(() => setDraft(value !== undefined ? String(value) : ''), [value]);
  const commit = () => {
    const text = draft.replace(/,/g, '').trim();
    if (!text) return onSet(undefined);
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) onSet(n);
  };
  return (
    <input
      className={clsx('field py-1.5 text-right text-sm', value !== undefined && 'border-accent')}
      style={value !== undefined ? { borderColor: 'var(--accent)' } : undefined}
      inputMode="decimal"
      placeholder={formatAmount(row.real, row.decimals, { maxFraction: 4 })}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
};

export const ForkPanel: FC<{
  a?: Analysis; // result in the fork
  mainnet?: Analysis; // last result against real state
  target: string;
  changes: ForkChange[];
  setChanges: (c: ForkChange[]) => void;
  stats?: ForkStats;
  error?: string;
}> = ({ a, mainnet, target, changes, setChanges, stats, error }) => {
  const rows = balanceRows(mainnet ?? a, target);
  const tokens = (mainnet ?? a)?.tokens ?? {};
  const rawLabel = (mainnet ?? a)?.labels[target] ?? shortAddress(target);
  const label = rawLabel === 'You' || rawLabel.endsWith('(you)') ? 'you' : rawLabel;
  const suggestion = fundingSuggestion(mainnet ?? a, target);
  const valueOf = (mint: string) => changes.find((c) => c.mint === mint)?.amount;
  const set = (mint: string, v?: number) =>
    setChanges(
      v === undefined
        ? changes.filter((c) => c.mint !== mint)
        : [...changes.filter((c) => c.mint !== mint), { mint, amount: v }]
    );

  return (
    <section className="rounded-card border bg-raised px-5 py-4" style={{ borderColor: 'var(--accent)' }}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold">Fork</h2>
        <span className="text-[13px] text-ink-2">· what if {label} had other balances?</span>
        {stats ? (
          <span className="ml-auto text-[11px] text-ink-3" title={`${stats.features} active runtime features`}>
            fetched {kb(stats.fetchedBytes)} · VM {Math.round(stats.vmMs)} ms
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-2">
        Change a balance and the transaction runs again in a Solana VM inside Sherlock, on live mainnet accounts.
        Nothing is sent: it only reads from your RPC.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Outcome label="Mainnet" a={mainnet} />
        <Outcome label="Fork" a={a?.source === 'wasm' ? a : undefined} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] text-ink-3">Token</span>
        <span className="text-right text-[11px] text-ink-3">Real balance</span>
        <span className="text-right text-[11px] text-ink-3">Balance in the fork</span>
        <span />
        {rows.map((row) => {
          const value = valueOf(row.mint);
          return (
            <React.Fragment key={row.mint}>
              <span className="flex min-w-0 items-center gap-2">
                <TokenIcon src={iconOf(row.mint, tokens)} size={22} />
                <span className="truncate text-sm font-semibold">{symbolOf(row.mint, tokens)}</span>
              </span>
              <span className="truncate text-right text-sm text-ink-2">
                {formatAmount(row.real, row.decimals, { maxFraction: 4 })}
              </span>
              <BalanceInput row={row} value={value} onSet={(v) => set(row.mint, v)} />
              {value !== undefined ? (
                <IconButton
                  label={`Reset ${symbolOf(row.mint, tokens)}`}
                  className="h-7 w-7"
                  onClick={() => set(row.mint, undefined)}
                >
                  <XIcon size={12} />
                </IconButton>
              ) : (
                <span />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestion.length ? (
          <Button kind="outline" size="sm" onClick={() => setChanges(suggestion)}>
            Fill in what it needs:{' '}
            {suggestion.map((c) => `${c.amount.toLocaleString('en-US')} ${symbolOf(c.mint, tokens)}`).join(' + ')}
          </Button>
        ) : null}
        {changes.length ? (
          <Button kind="ghost" size="sm" onClick={() => setChanges([])}>
            Reset to real balances
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-neg">The VM could not run this: {error}</p> : null}
    </section>
  );
};
