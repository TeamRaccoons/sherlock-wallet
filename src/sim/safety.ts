import bs58 from 'bs58';
import type { Analysis, Check, Instr } from './analyze';
import type { TokenInfo } from './jupApi';
import { getMultipleAccounts } from './rpc';
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, isTokenProgram } from './programs';

// What a transaction could do to the signer beyond the balance changes: delegations, authority
// changes, closing accounts to someone else, wallet reassignment, never-expiring nonces, and tokens
// that can be frozen, clawed back or taxed.

type Flat = Instr & { top: Instr };

const flatten = (instructions: Instr[]): Flat[] =>
  instructions.flatMap((ix) => [{ ...ix, top: ix }, ...ix.inner.map((inner) => ({ ...inner, top: ix }))]);

// Instruction kind and its accounts/args, from either our decoder or the RPC's parsed form.
function kind(ix: Instr): { name?: string; info: Record<string, any> } {
  if (ix.parsed) return { name: ix.parsed.type, info: ix.parsed.info as Record<string, any> };
  const d = ix.decoded;
  if (!d) return { info: {} };
  const info: Record<string, any> = { ...(d.args ?? {}) };
  ix.accounts.forEach((a, i) => {
    const n = d.accountNames?.[i];
    if (n) info[n] = a.address;
  });
  const name = d.name.charAt(0).toLowerCase() + d.name.slice(1);
  return { name, info };
}

// Token-2022 extension types (spl-token-2022 ExtensionType) worth knowing about on a received token.
const RISKY_EXTENSIONS: Record<number, string> = {
  1: 'transfer fee',
  9: 'non-transferable',
  12: 'permanent delegate (can move anyone’s balance)',
  14: 'transfer hook (runs a program on every transfer)',
};

function mintRisks(data: Uint8Array, owner: string) {
  const risks: string[] = [];
  // Mint layout: mint authority COption (36), supply (8), decimals (1), initialized (1), freeze authority COption (36).
  if (data.length >= 82 && new DataView(data.buffer, data.byteOffset).getUint32(46, true) === 1) {
    risks.push(`freeze authority ${bs58.encode(data.subarray(50, 82)).slice(0, 4)}…`);
  }
  if (owner === TOKEN_2022_PROGRAM && data.length > 166) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let o = 166; o + 4 <= data.length;) {
      const type = view.getUint16(o, true);
      const len = view.getUint16(o + 2, true);
      if (RISKY_EXTENSIONS[type]) risks.push(RISKY_EXTENSIONS[type]);
      o += 4 + len;
    }
  }
  return risks;
}

// Mint settings change rarely; checked again after 10 minutes.
const mintCache = new Map<string, { at: number; risks: string[] }>();

export async function safetyChecks(
  rpcUrl: string,
  a: Pick<Analysis, 'user' | 'instructions' | 'labels' | 'userChanges' | 'tokens'>,
  idlPrograms: Set<string>,
  mintOf: (account?: string) => string | undefined = () => undefined,
  decimalsOf: (mint: string) => number | undefined = () => undefined
): Promise<Check[]> {
  const checks: Check[] = [];
  const name = (address?: string) =>
    address ? (a.labels[address] ?? `${address.slice(0, 4)}…${address.slice(-4)}`) : '?';
  const userOwned = (account?: string) =>
    !!account && (account === a.user || (a.labels[account] ?? '').startsWith(a.labels[a.user] ?? '\u0000'));

  const delegated = (info: Record<string, any>) => {
    const raw = info.amount ?? info.tokenAmount?.amount;
    if (raw === undefined) return 'an unknown amount';
    const mint = info.mint ?? mintOf(info.source);
    const decimals = info.decimals ?? info.tokenAmount?.decimals ?? (mint ? decimalsOf(mint) : undefined);
    if (decimals === undefined) return `${String(raw)} base units`;
    const amount = (Number(raw) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: decimals });
    return `${amount} ${mint ? (a.tokens[mint]?.symbol ?? name(mint)) : ''}`.trim();
  };

  for (const ix of flatten(a.instructions)) {
    const { name: k, info } = kind(ix);
    if (!k) continue;
    if (isTokenProgram(ix.programId)) {
      if ((k === 'approve' || k === 'approveChecked') && (info.owner === a.user || userOwned(info.source))) {
        checks.push({
          level: 'warn',
          title: `Grants ${name(info.delegate)} a token delegation`,
          detail: `On ${name(info.source)}: the delegate can move up to ${delegated(info)} without asking again.`,
        });
      }
      if (
        k === 'setAuthority' &&
        (info.authority === a.user || info.currentAuthority === a.user || info.multisigAuthority === a.user)
      ) {
        checks.push({
          level: 'warn',
          title: `Changes the ${info.authorityType ?? ''} authority of ${name(info.account ?? info.mint)}`,
          detail: `New authority: ${info.newAuthority ? name(info.newAuthority) : 'none (removed)'}`,
        });
      }
      if (
        k === 'closeAccount' &&
        (info.owner === a.user || userOwned(info.account)) &&
        info.destination &&
        info.destination !== a.user
      ) {
        checks.push({
          level: 'warn',
          title: `Closes ${name(info.account)} and sends its rent elsewhere`,
          detail: `Rent goes to ${name(info.destination)}, not to you.`,
        });
      }
    }
    if (ix.programId === SYSTEM_PROGRAM) {
      if (k === 'assign' && info.account === a.user) {
        checks.push({
          level: 'error',
          title: `Reassigns your wallet to ${name(info.owner)}`,
          detail: 'Your account would then belong to that program: the pattern wallet drainers use.',
        });
      }
      if (k === 'advanceNonce' || k === 'advanceNonceAccount') {
        checks.push({
          level: 'warn',
          title: 'Uses a durable nonce',
          detail: 'Once signed, this transaction never expires and can be sent at any later time.',
        });
      }
    }
  }

  // Programs with neither a name nor a published IDL.
  const unknown = [...new Set(a.instructions.map((ix) => ix.programId))].filter(
    (id) => !a.labels[id] && !idlPrograms.has(id)
  );
  if (unknown.length) {
    checks.push({
      level: 'info',
      title: `Calls ${unknown.length} unlabelled program${unknown.length > 1 ? 's' : ''}`,
      detail: `${unknown.map((id) => name(id)).join(', ')}: no known name and no published IDL.`,
    });
  }

  // Tokens you receive that can be frozen, clawed back or taxed.
  const received = a.userChanges.filter((c) => c.delta > 0n && c.mint !== 'SOL').map((c) => c.mint);
  if (received.length) {
    try {
      const stale = received.filter((mint) => (mintCache.get(mint)?.at ?? 0) < Date.now() - 600_000);
      if (stale.length) {
        const fetched = await getMultipleAccounts(rpcUrl, stale);
        stale.forEach((mint, i) => {
          const account = fetched[i];
          mintCache.set(mint, {
            at: Date.now(),
            risks: account ? mintRisks(Uint8Array.from(Buffer.from(account.data[0], 'base64')), account.owner) : [],
          });
        });
      }
      received.forEach((mint) => {
        const risks = mintCache.get(mint)?.risks ?? [];
        if (!risks.length) return;
        const info: TokenInfo | undefined = a.tokens[mint];
        const verified = info?.verified;
        const serious = risks.some((r) => !r.startsWith('freeze'));
        if (verified && !serious) return; // a verified stablecoin's freeze authority is expected
        checks.push({
          level: verified ? 'info' : 'warn',
          title: `${info?.symbol ?? name(mint)} you receive has ${risks.length > 1 ? 'risky settings' : risks[0].split(' (')[0]}`,
          detail: `${risks.join(' · ')}${verified ? ' (verified token)' : ' · unverified token'}`,
        });
      });
    } catch {
      // Best effort.
    }
  }
  return checks;
}
