import base58 from 'bs58';
import React, { FC, useEffect, useState } from 'react';
import type { InspectRequest } from '../../background/requests';
import { useAccounts } from '../hooks/useAccounts';
import { timeAgo } from '../inspect/format';
import { ChevronRight } from '../kit/icons';
import { Button, Collapse, LetterAvatar, Row } from '../kit/kit';
import { rpc } from '../rpc';

// A transaction signature: 64 bytes in base58 (also accepted inside an explorer URL).
function signatureIn(text: string): string | undefined {
  const candidate = text.trim().match(/(?:\/tx\/)?([1-9A-HJ-NP-Za-km-z]{86,88})(?:[?#].*)?$/)?.[1];
  if (!candidate) return undefined;
  try {
    return base58.decode(candidate).length === 64 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

// Accepts a serialized transaction as base64 or base58 (what explorers, logs and APIs hand out).
function decodeTransaction(text: string): string {
  const trimmed = text.trim().replace(/^"|"$/g, '');
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed) && !/[+/=]/.test(trimmed)) {
    try {
      return Buffer.from(base58.decode(trimmed)).toString('base64');
    } catch {
      // Fall through to base64.
    }
  }
  const bytes = Buffer.from(trimmed, 'base64');
  if (!bytes.length) throw new Error('Not a base64 or base58 transaction');
  return bytes.toString('base64');
}

export const PasteTransaction: FC = () => {
  const { accounts, connectedAddress } = useAccounts();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const user = connectedAddress || accounts[0]?.address.toBase58() || '';
  const label = accounts.find((a) => a.address.toBase58() === user)?.label;

  return (
    <div className="rounded-card border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Inspect a transaction</div>
          <div className="text-xs text-ink-2">
            Paste a serialized transaction, or a signature to replay a landed one
          </div>
        </div>
        <ChevronRight size={18} className={`shrink-0 text-ink-2 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Collapse open={open}>
        <div className="space-y-3 px-4 pb-4">
          <textarea
            className="field mono h-24 resize-none text-xs"
            placeholder="Base64 / base58 transaction, or a signature"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error ? <p className="text-xs text-neg">{error}</p> : null}
          <Button
            kind="dark"
            className="w-full"
            disabled={!text.trim() || !user}
            onClick={async () => {
              try {
                setError(undefined);
                const signature = signatureIn(text);
                if (signature) {
                  await rpc.callMethod('inspectSignature', [{ address: user, signature }]);
                  return;
                }
                const transaction = decodeTransaction(text);
                await rpc.callMethod('inspectPasted', [{ address: user, transactions: [transaction] }]);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Simulate{label ? ` as ${label}` : ''}
          </Button>
        </div>
      </Collapse>
    </div>
  );
};

const METHOD: Record<InspectRequest['method'], string> = {
  signTransaction: 'Transaction',
  signAndSendTransaction: 'Sign and send',
  signMessage: 'Message',
  paste: 'Pasted',
  replay: 'Replay',
};

export const RequestHistory: FC = () => {
  const [history, setHistory] = useState<InspectRequest[]>();
  useEffect(() => {
    rpc.callMethod('getHistory').then((h) => setHistory(h ?? []));
  }, []);
  if (!history) return null;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent</h2>
        {history.length ? (
          <button
            type="button"
            className="text-xs font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            onClick={async () => {
              await rpc.callMethod('clearHistory');
              setHistory([]);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {history.length ? (
        <div className="-mx-3">
          {history.slice(0, 12).map((r) => (
            <Row key={r.id} onClick={() => rpc.callMethod('openRequest', [r.id])}>
              <LetterAvatar text={r.origin ?? 'p'} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {r.origin?.replace(/^https?:\/\//, '') ?? 'Pasted transaction'}
                </div>
                <div className="truncate text-xs text-ink-2">
                  {METHOD[r.method]}
                  {r.transactions && r.transactions.length > 1 ? ` · ${r.transactions.length} transactions` : ''} ·{' '}
                  {timeAgo(r.createdAt)}
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-ink-3" />
            </Row>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-2">Requests from dapps appear here, ready to simulate again.</p>
      )}
    </div>
  );
};
