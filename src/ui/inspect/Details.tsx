import clsx from 'clsx';
import React, { FC, useState } from 'react';
import type { AccountDetail, Analysis, Instr } from '../../sim/analyze';
import { signatureSlots } from '../../sim/tx';
import { ChevronDown, DownloadIcon, ExternalIcon } from '../kit/icons';
import { Button, Collapse, CopyButton, Pill } from '../kit/kit';
import { explorerAddress, formatAmount, lamportsToSol, shortAddress, symbolOf, toneOf } from './format';

export const AddressLink: FC<{
  address: string;
  labels?: Record<string, string>;
  chars?: number;
  className?: string;
}> = ({ address, labels, chars = 4, className }) => {
  const label = labels?.[address];
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className={clsx('truncate hover:underline', label ? 'text-ink' : 'mono text-ink-2', className)}
    >
      {label ?? shortAddress(address, chars)}
    </a>
  );
};

const argsReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? value.length <= 64
        ? `0x${Buffer.from(value).toString('hex')}`
        : `<${value.length} bytes>`
      : value;

const Code: FC<{ value: unknown }> = ({ value }) => (
  <pre className="mono max-h-72 overflow-auto rounded-xl bg-hover p-3 text-[11px] leading-relaxed text-ink-2">
    {JSON.stringify(value, argsReplacer, 2)}
  </pre>
);

const InnerRow: FC<{ ix: Instr; a: Analysis }> = ({ ix, a }) => {
  const [open, setOpen] = useState(false);
  const detail = ix.event?.data ?? ix.parsed?.info ?? ix.decoded?.args;
  return (
    <div style={{ paddingLeft: (ix.stackHeight - 2) * 16 }}>
      <button
        type="button"
        onClick={() => detail && setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] hover:bg-hover"
      >
        <span className="w-9 shrink-0 text-ink-3">{ix.path}</span>
        <span className="truncate font-medium">{a.labels[ix.programId] ?? shortAddress(ix.programId)}</span>
        <span className={clsx('truncate', ix.event ? 'text-info' : 'text-ink-2')}>
          {ix.decoded?.name ?? ix.parsed?.type ?? 'unknown'}
        </span>
      </button>
      {detail ? (
        <Collapse open={open}>
          <div className="px-2 pb-2">
            <Code value={detail} />
          </div>
        </Collapse>
      ) : null}
    </div>
  );
};

// The change of one account over the whole transaction, compact: token first, then SOL.
const AccountChange: FC<{ acc?: AccountDetail; a: Analysis }> = ({ acc, a }) => {
  if (!acc) return null;
  const parts: React.ReactNode[] = [];
  if (acc.token && acc.token.post !== acc.token.pre) {
    const d = acc.token.post - acc.token.pre;
    parts.push(
      <span key="t" className={toneOf(d)}>
        {formatAmount(d, acc.token.decimals, { signed: true, maxFraction: 4 })} {symbolOf(acc.token.mint, a.tokens)}
      </span>
    );
  }
  const sol =
    acc.preLamports !== undefined && acc.postLamports !== undefined ? BigInt(acc.postLamports - acc.preLamports) : 0n;
  // Token accounts' lamports are rent; only show SOL moves of other accounts, or account creation/closing.
  if (sol && (!acc.token || acc.preLamports === 0 || acc.postLamports === 0)) {
    parts.push(
      <span key="s" className={toneOf(sol)}>
        {formatAmount(sol, 9, { signed: true, maxFraction: 6 })} SOL
      </span>
    );
  }
  if (!parts.length) return null;
  return <span className="flex flex-col items-end leading-tight">{parts}</span>;
};

const Movements: FC<{ ix: Instr; a: Analysis }> = ({ ix, a }) => {
  const [all, setAll] = useState(false);
  const moves = ix.movements ?? [];
  if (!moves.length) return null;
  const shown = all ? moves : moves.slice(0, 6);
  const decimalsOf = (mint: string) =>
    mint === 'SOL' ? 9 : (a.tokens[mint]?.decimals ?? a.accounts.find((x) => x.token?.mint === mint)?.token?.decimals);
  return (
    <div>
      <div className="caps mb-1.5">Moves · {moves.length}</div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {shown.map((m, i) => {
          const d = decimalsOf(m.mint);
          return (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
              <span className="w-9 shrink-0 text-[11px] text-ink-3">{m.path}</span>
              <span className="min-w-0 flex-1 truncate">
                <AddressLink address={m.source ?? '?'} labels={a.labels} />
                <span className="px-1.5 text-ink-3">→</span>
                <AddressLink address={m.destination ?? '?'} labels={a.labels} />
              </span>
              {m.kind === 'rent' ? <Pill className="px-1.5 py-0.5 text-[10px]">rent</Pill> : null}
              <span className="shrink-0 font-semibold">
                {d !== undefined ? formatAmount(m.amount, d, { maxFraction: d > 6 ? 6 : 4 }) : m.amount.toString()}{' '}
                {symbolOf(m.mint === 'SOL' ? 'SOL' : m.mint, a.tokens)}
              </span>
            </div>
          );
        })}
      </div>
      {moves.length > 6 ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-1 text-xs font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${moves.length}`}
        </button>
      ) : null}
    </div>
  );
};

const InstructionCard: FC<{ ix: Instr; a: Analysis }> = ({ ix, a }) => {
  // The failing instruction opens by itself.
  const [open, setOpen] = useState(!!ix.failed);
  const [showData, setShowData] = useState(false);
  const details = new Map(a.accounts.map((acc) => [acc.address, acc]));
  const named = ix.decoded?.accountNames?.length ?? 0;
  let extra = 0;
  return (
    <div className={clsx('rounded-card border bg-raised', ix.failed ? 'border-neg' : 'border-line')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left max-[560px]:px-3"
      >
        <span className="text-sm text-ink-3">{ix.path}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{ix.decoded?.name ?? 'Unknown instruction'}</div>
          <div className="truncate text-xs text-ink-2">
            {a.labels[ix.programId] ?? ix.programId}
            {ix.movements?.length ? ` · ${ix.movements.length} move${ix.movements.length > 1 ? 's' : ''}` : ''}
          </div>
        </div>
        {ix.failed ? <Pill tone="neg">Failed</Pill> : null}
        {ix.decoded?.decodeError ? <Pill tone="warn">Partial</Pill> : null}
        {ix.computeUnits !== undefined ? (
          <span className="text-xs text-ink-3">{ix.computeUnits.toLocaleString()} CU</span>
        ) : null}
        <ChevronDown size={16} className={clsx('shrink-0 text-ink-2 transition-transform', open && 'rotate-180')} />
      </button>
      <Collapse open={open}>
        <div className="space-y-4 border-t border-line px-4 py-4 max-[560px]:px-3">
          <Movements ix={ix} a={a} />

          <div>
            <div className="caps mb-1.5">Accounts · {ix.accounts.length}</div>
            <div className="divide-y divide-line">
              {ix.accounts.map((acc, i) => {
                // Anchor passes the program itself for an optional account that is not provided.
                const placeholder = acc.address === ix.programId && i < named;
                const role = acc.name ?? (i >= named && named ? `extra account #${++extra}` : '');
                const flags = placeholder ? [] : [acc.writable && 'writable', acc.signer && 'signer'].filter(Boolean);
                // One row in a window; narrow (side panel), two lines: role and flags, then address
                // and change.
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[20px_160px_minmax(0,1fr)_auto_144px] items-center gap-x-3 py-1.5 text-[13px] max-[560px]:grid-cols-[20px_minmax(0,1fr)_auto] max-[560px]:gap-y-0.5"
                  >
                    <span className="text-right text-ink-3">{i}</span>
                    <span className="truncate text-ink-2" title={role}>
                      {role}
                    </span>
                    <span className="min-w-0 truncate max-[560px]:col-start-2 max-[560px]:row-start-2">
                      {placeholder ? (
                        <span className="text-ink-3">none (optional account not provided)</span>
                      ) : (
                        <AddressLink address={acc.address} labels={a.labels} />
                      )}
                    </span>
                    <span
                      className="whitespace-nowrap text-[11px] text-ink-3 max-[560px]:col-start-3 max-[560px]:row-start-1 max-[560px]:text-right"
                      title={flags.join(' · ')}
                    >
                      <span className="max-[560px]:hidden">{flags.join(' · ')}</span>
                      <span className="min-[561px]:hidden">{flags.map((f) => (f as string)[0]).join(' · ')}</span>
                    </span>
                    <span className="whitespace-nowrap text-right text-[12px] max-[560px]:col-start-3 max-[560px]:row-start-2">
                      {placeholder ? null : <AccountChange acc={details.get(acc.address)} a={a} />}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Right column: each account's change over the whole transaction
              <span className="min-[561px]:hidden">; w writable, s signer</span>.
            </p>
          </div>

          {ix.decoded?.args && Object.keys(ix.decoded.args).length ? (
            <div>
              <div className="caps mb-1.5">Arguments</div>
              <Code value={ix.decoded.args} />
            </div>
          ) : null}
          {ix.decoded?.decodeError ? (
            <p className="text-xs text-warn">Decoding stopped: {ix.decoded.decodeError}</p>
          ) : null}
          {ix.data ? (
            <div>
              <button
                type="button"
                onClick={() => setShowData(!showData)}
                className="text-xs font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                {showData || !ix.decoded ? 'Raw data' : 'Show raw data'} · {ix.data.length} bytes
              </button>
              {showData || !ix.decoded ? (
                <div className="mono mt-1 break-all text-[11px] text-ink-2">
                  0x{Buffer.from(ix.data).toString('hex')}
                </div>
              ) : null}
            </div>
          ) : null}

          {ix.inner.length ? (
            <div>
              <div className="caps mb-1.5">Inner instructions · {ix.inner.length}</div>
              {ix.inner.map((inner) => (
                <InnerRow key={inner.path} ix={inner} a={a} />
              ))}
            </div>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
};

export const InstructionsTab: FC<{ a: Analysis }> = ({ a }) =>
  a.instructions.length ? (
    <div className="space-y-2">
      {a.instructions.map((ix) => (
        <InstructionCard key={ix.path} ix={ix} a={a} />
      ))}
    </div>
  ) : (
    <p className="text-sm text-ink-2">This transaction format could not be decoded locally.</p>
  );

const logTone = (line: string) =>
  / failed: /.test(line)
    ? 'text-neg'
    : / invoke \[\d+\]$/.test(line)
      ? 'text-info'
      : / success$| consumed \d+ of /.test(line)
        ? 'text-ink-3'
        : line.startsWith('Program return:')
          ? 'text-pos'
          : 'text-ink';

export const LogsTab: FC<{ a: Analysis }> = ({ a }) => (
  <div>
    <div className="mb-3 flex items-center justify-between">
      <span className="text-sm text-ink-2">
        {a.logs.length} lines{a.logsTruncated ? ' · truncated by the RPC' : ''}
      </span>
      <CopyButton text={a.logs.join('\n')} label="Copy logs" />
    </div>
    <div className="mono rounded-card bg-hover p-3 text-[11px] leading-relaxed">
      {a.logs.map((line, i) => {
        const depth = Number(/ invoke \[(\d+)\]$/.exec(line)?.[1] ?? 0);
        return (
          <div
            key={i}
            className={clsx('whitespace-pre-wrap break-all', logTone(line))}
            style={{ paddingLeft: depth > 1 ? (depth - 1) * 12 : 0 }}
          >
            {line}
          </div>
        );
      })}
    </div>
  </div>
);

export const RawTab: FC<{ a: Analysis; base64: string; explorerUrl?: string; onExport: () => void }> = ({
  a,
  base64,
  explorerUrl,
  onExport,
}) => (
  <div className="space-y-6">
    <div className="flex flex-wrap gap-2">
      <Button kind="outline" size="sm" onClick={() => navigator.clipboard.writeText(base64)}>
        Copy base64
      </Button>
      {explorerUrl ? (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
          <Button kind="outline" size="sm">
            Explorer <ExternalIcon size={13} />
          </Button>
        </a>
      ) : null}
      <Button kind="outline" size="sm" onClick={onExport}>
        <DownloadIcon size={13} /> Report
      </Button>
    </div>

    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <span className="text-ink-2">Version</span>
      <span>{a.version === 'legacy' ? 'Legacy' : `v${String(a.version)}`}</span>
      <span className="text-ink-2">Size</span>
      <span>
        {a.size} / {a.maxSize} bytes
      </span>
      <span className="text-ink-2">Fee payer</span>
      {a.feePayer ? <AddressLink address={a.feePayer} labels={a.labels} /> : <span>—</span>}
      <span className="text-ink-2">Blockhash</span>
      <span className="mono truncate text-ink-2">{a.recentBlockhash ?? '—'}</span>
    </div>

    <textarea readOnly value={base64} className="field mono h-28 resize-none text-[11px] text-ink-2" />

    <Signatures a={a} base64={base64} />
  </div>
);

// Which required signatures the transaction carries. A dapp asking you to sign usually leaves only
// yours empty; co-signed flows (RFQ market makers, relayers) may have signed already.
export const Signatures: FC<{ a: Analysis; base64: string }> = ({ a, base64 }) => {
  const slots = signatureSlots(Uint8Array.from(Buffer.from(base64, 'base64')));
  if (!slots.length) return null;
  return (
    <div>
      <div className="caps mb-2">
        Signatures · {slots.filter((s) => s.present).length} of {slots.length} present
      </div>
      {slots.map((s) => (
        <div key={s.signer} className="flex items-center gap-3 py-1 text-[13px]">
          <Pill tone={s.present ? 'pos' : 'muted'}>{s.present ? 'Signed' : 'Missing'}</Pill>
          <AddressLink address={s.signer} labels={a.labels} chars={6} />
          {s.signature ? (
            <span className="mono ml-auto truncate text-[11px] text-ink-3">{shortAddress(s.signature, 8)}</span>
          ) : null}
        </div>
      ))}
      <p className="mt-1 text-xs text-ink-3">
        Simulation skips signature checks, so missing ones do not change the result.
      </p>
    </div>
  );
};

const Flag: FC<{ children: React.ReactNode; tone?: 'pos' | 'neg' | 'warn' | 'info' | 'muted' }> = ({
  children,
  tone = 'muted',
}) => (
  <Pill tone={tone} className="px-1.5 py-0.5 text-[10px]">
    {children}
  </Pill>
);

const AccountRow: FC<{ acc: AccountDetail; a: Analysis }> = ({ acc, a }) => {
  const solDelta =
    acc.preLamports !== undefined && acc.postLamports !== undefined ? BigInt(acc.postLamports - acc.preLamports) : 0n;
  const tokenDelta = acc.token ? acc.token.post - acc.token.pre : 0n;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="py-2 pr-2 text-right text-ink-3">{acc.index}</td>
      <td className="max-w-0 py-2 pr-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <AddressLink address={acc.address} labels={a.labels} chars={6} className="text-[13px]" />
          <CopyButton text={acc.address} label="Copy address" className="h-6 w-6" />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {acc.feePayer ? <Flag tone="info">fee payer</Flag> : null}
          {acc.signer ? <Flag tone="info">signer</Flag> : null}
          {acc.writable ? <Flag tone="warn">writable</Flag> : null}
          {acc.executable ? <Flag>program</Flag> : null}
          {acc.fromLookupTable ? <Flag>lookup table</Flag> : null}
          {acc.preLamports === 0 && (acc.postLamports ?? 0) > 0 ? <Flag tone="pos">created</Flag> : null}
          {(acc.preLamports ?? 0) > 0 && acc.postLamports === 0 ? <Flag tone="neg">closed</Flag> : null}
        </div>
      </td>
      <td className="max-w-0 py-2 pr-3 text-[12px] text-ink-2 max-[560px]:hidden">
        <div className="truncate">{acc.owner ? (a.labels[acc.owner] ?? shortAddress(acc.owner)) : '—'}</div>
        {acc.dataSize !== undefined ? <div className="text-ink-3">{acc.dataSize.toLocaleString()} B</div> : null}
      </td>
      <td className="py-2 pr-3 text-right text-[12px]">
        {acc.postLamports !== undefined ? <div>{lamportsToSol(BigInt(acc.postLamports))}</div> : '—'}
        {solDelta ? (
          <div className={toneOf(solDelta)}>{formatAmount(solDelta, 9, { signed: true, maxFraction: 9 })}</div>
        ) : null}
      </td>
      <td className="py-2 text-right text-[12px]">
        {acc.token ? (
          <>
            <div>
              {formatAmount(acc.token.post, acc.token.decimals, { maxFraction: 4 })}{' '}
              {symbolOf(acc.token.mint, a.tokens)}
            </div>
            {tokenDelta ? (
              <div className={toneOf(tokenDelta)}>
                {formatAmount(tokenDelta, acc.token.decimals, { signed: true, maxFraction: 6 })}
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
    </tr>
  );
};

// Every account the transaction touches, with roles, owner and balances before/after, as a block
// explorer lists them.
export const AccountsTab: FC<{ a: Analysis }> = ({ a }) => (
  <div>
    <div className="mb-2 text-sm text-ink-2">
      {a.accounts.length} accounts · {a.accounts.filter((x) => x.writable).length} writable ·{' '}
      {a.accounts.filter((x) => x.signer).length} signer{a.accounts.filter((x) => x.signer).length > 1 ? 's' : ''} ·{' '}
      {a.accounts.filter((x) => x.fromLookupTable).length} from lookup tables
    </div>
    {/* Wider than the side panel: it scrolls sideways in its own box, without the Owner column. */}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] table-fixed text-left">
        <colgroup>
          <col className="w-8" />
          <col className="min-w-[120px]" />
          <col className="w-32 max-[560px]:hidden" />
          <col className="w-28" />
          <col className="w-36" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-[11px] text-ink-3">
            <th className="py-1.5 pr-2 text-right font-medium">#</th>
            <th className="py-1.5 pr-3 font-medium">Account</th>
            <th className="py-1.5 pr-3 font-medium max-[560px]:hidden">Owner</th>
            <th className="py-1.5 pr-3 text-right font-medium">SOL after</th>
            <th className="py-1.5 text-right font-medium">Token after</th>
          </tr>
        </thead>
        <tbody>
          {a.accounts.map((acc) => (
            <AccountRow key={acc.index} acc={acc} a={a} />
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
