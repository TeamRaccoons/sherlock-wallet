import React, { FC, useEffect, useState } from 'react';
import { rpcCall } from '../../sim/rpc';
import { PUBLIC_RPC, useConnection } from '../context/ConnectionContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Button } from '../kit/kit';

type Probe = 'checking' | 'refused' | 'ok';

// Whether the public RPC serves this browser: it answers 403 to any request with an Origin.
async function probePublic(): Promise<Probe> {
  try {
    await rpcCall(PUBLIC_RPC, 'getSlot');
    return 'ok';
  } catch (e) {
    return (e as { code?: number }).code === 403 ? 'refused' : 'ok';
  }
}

// Shown on the home screen while Sherlock still uses the public RPC: asks for an RPC URL and
// checks it answers before saving it.
export const RpcSetupCard: FC = () => {
  const { rpcUrl, setRPCUrl } = useConnection();
  const [dismissed, setDismissed] = useLocalStorage<boolean>('Sherlock-rpc-setup-dismissed', false);
  const [probe, setProbe] = useState<Probe>('checking');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const onPublic = rpcUrl === PUBLIC_RPC;

  useEffect(() => {
    if (onPublic) probePublic().then(setProbe);
  }, [onPublic]);

  if (!onPublic || probe === 'checking' || (probe === 'ok' && dismissed)) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = draft.trim();
    if (!/^https?:\/\//.test(url)) return setError('Enter an http(s) URL.');
    setTesting(true);
    setError(undefined);
    try {
      await rpcCall(url, 'getSlot');
      setRPCUrl(url);
    } catch (err) {
      setError(`This RPC did not answer: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-card border bg-raised px-5 py-4" style={{ borderColor: 'var(--accent)' }}>
      <h2 className="text-[15px] font-semibold">Set up an RPC</h2>
      <p className="mt-1 text-xs text-ink-2">
        {probe === 'refused'
          ? 'The public Solana RPC refuses requests from browsers, so Sherlock cannot simulate anything with it.'
          : 'Sherlock is on the public Solana RPC, which is heavily rate-limited.'}{' '}
        Paste your own mainnet RPC URL (Helius, Triton, QuickNode… all have free tiers). It is stored only in this
        browser.
      </p>
      <form className="mt-3 flex gap-2" onSubmit={submit}>
        <input
          className="field mono text-xs"
          placeholder="https://your-rpc…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <Button type="submit" kind="dark" disabled={!draft.trim() || testing}>
          {testing ? 'Checking…' : 'Use'}
        </Button>
      </form>
      {error ? <p className="mt-2 text-xs text-neg">{error}</p> : null}
      {probe === 'ok' ? (
        <Button kind="ghost" size="sm" className="mt-2" onClick={() => setDismissed(true)}>
          Keep the public RPC
        </Button>
      ) : null}
    </section>
  );
};
