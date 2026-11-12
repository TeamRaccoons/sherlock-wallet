import clsx from 'clsx';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { BundleSimulation, SequenceEngine, simulateSequence } from '../../sim/bundle';
import { RefreshIcon } from '../kit/icons';
import { Dot, IconButton, Pill, Segmented } from '../kit/kit';
import { formatAmount, lamportsToSol, symbolOf, timeAgo, toneOf } from './format';
import { AssetRow } from './Summary';

const ENGINE: Record<BundleSimulation['mode'], string> = {
  bundle: 'Jito simulateBundle',
  vm: 'Sherlock VM',
  independent: 'one by one',
};

// The transactions of one request run in order, as a Jito bundle would land them: through the RPC's
// simulateBundle when it has one, otherwise in the in-browser VM.
export const BundleView: FC<{
  rpcUrl: string;
  transactions: Uint8Array[];
  user?: string;
  addressBook?: Record<string, string>;
  onOpen: (index: number) => void;
}> = ({ rpcUrl, transactions, user, addressBook, onOpen }) => {
  const [sim, setSim] = useState<BundleSimulation>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [at, setAt] = useState<number>();
  const [engine, setEngine] = useState<SequenceEngine>('auto');

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setSim(await simulateSequence(rpcUrl, transactions, user, addressBook, engine));
      setError(undefined);
      setAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [rpcUrl, transactions, user, addressBook, engine]);

  useEffect(() => {
    run();
  }, [run]);

  const first = sim?.results[0];
  return (
    <div className="space-y-3">
      <section className="rounded-card border border-line bg-raised px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="whitespace-nowrap text-[15px] font-semibold">
            Bundle{' '}
            <span className="font-normal text-ink-2">
              · {transactions.length} transactions {sim?.mode === 'independent' ? 'simulated separately' : 'in order'}
            </span>
          </h2>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-2">
            <Segmented<SequenceEngine>
              value={engine}
              onChange={setEngine}
              items={[
                { id: 'auto', label: 'Auto' },
                { id: 'rpc', label: 'RPC bundle' },
                { id: 'vm', label: 'Sherlock VM' },
              ]}
            />
            <Dot tone={!sim ? 'muted' : sim.succeeded ? 'pos' : 'neg'} pulse={running} />
            <span className="whitespace-nowrap">
              {at ? timeAgo(at) : running ? 'Simulating…' : ''}
              {sim && !running ? ` · ${ENGINE[sim.mode]}` : ''}
              {sim?.slot ? ` · slot ${sim.slot.toLocaleString()}` : ''}
            </span>
            <IconButton label="Simulate the bundle again" onClick={run} disabled={running} className="h-7 w-7">
              <RefreshIcon size={13} className={running ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        </div>
        {sim?.mode === 'independent' ? (
          <div className="mb-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px]">
            <div className="font-semibold text-warn">
              Simulated one by one:{' '}
              {engine === 'rpc' ? 'this RPC has no bundle simulation' : 'the in-browser VM could not run them'}
            </div>
            <div className="text-ink-2">
              Each transaction starts from the same state, so one that depends on an earlier one (a token account it
              creates, funds it receives) may fail here yet succeed in a real bundle.{' '}
              {engine === 'rpc' ? 'Switch to Sherlock VM, or use a Jito-enabled RPC (e.g. Triton).' : ''}
            </div>
          </div>
        ) : null}
        {sim?.mode === 'vm' && sim.unsupportedReason ? (
          <p className="mb-2 text-xs text-ink-3">
            This RPC has no bundle simulation, so the transactions ran in order in Sherlock's VM on live mainnet
            accounts.
          </p>
        ) : null}
        {error ? <p className="text-sm text-neg">{error}</p> : null}
        {sim ? (
          sim.succeeded ? (
            <p className="text-sm text-pos">
              {sim.mode === 'independent'
                ? 'Every transaction succeeds on its own.'
                : 'Every transaction succeeds in sequence.'}
            </p>
          ) : (
            <p className="text-sm text-neg">
              Fails at transaction {sim.failedIndex !== undefined ? sim.failedIndex + 1 : '?'}
              {sim.failedIndex !== undefined && sim.results[sim.failedIndex]?.error
                ? `: ${sim.results[sim.failedIndex].error!.text}`
                : sim.failure
                  ? `: ${sim.failure}`
                  : ''}
            </p>
          )
        ) : null}
        {sim && first ? (
          <div className="mt-3">
            <div className="mb-1 text-xs text-ink-2">
              Net change over the bundle · {first.labels[first.user] ?? 'you'}
            </div>
            {sim.net.length ? (
              <div className="divide-y divide-line">
                {sim.net.map((c) => (
                  <AssetRow key={c.mint} asset={c} a={first} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-2">No net change for this address.</p>
            )}
          </div>
        ) : null}
      </section>

      {sim ? (
        <section className="rounded-card border border-line bg-raised px-2 py-2">
          {transactions.map((_, i) => {
            const r = sim.results[i];
            return (
              <button
                key={i}
                type="button"
                onClick={() => onOpen(i)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover"
              >
                <span className="w-6 shrink-0 text-sm text-ink-3">{i + 1}</span>
                {r ? r.err ? <Pill tone="neg">Fails</Pill> : <Pill tone="pos">OK</Pill> : <Pill>Not run</Pill>}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                  {r
                    ? r.err
                      ? (r.error?.name ?? r.error?.text)
                      : r.userChanges
                          .map(
                            (c) =>
                              `${formatAmount(c.delta, c.decimals, { signed: true, maxFraction: 4 })} ${symbolOf(c.mint, r.tokens)}`
                          )
                          .join(' · ') || 'no change for this address'
                    : 'skipped after an earlier failure'}
                </span>
                {r ? (
                  <span className="shrink-0 text-xs text-ink-3">
                    {r.compute.consumed?.toLocaleString() ?? '—'} CU · {lamportsToSol(r.fees.total ?? 0n)} SOL
                  </span>
                ) : null}
              </button>
            );
          })}
        </section>
      ) : null}
      <p className={clsx('text-xs text-ink-3', toneOf(0))}>
        Open a transaction for its full detail (simulated on its own).
      </p>
    </div>
  );
};
