import type { Instr } from './analyze';
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, SYSTEM_PROGRAM, isTokenProgram } from './programs';

export const NATIVE_SOL = 'SOL';

export type Transfer = { mint: string; amount: bigint; source?: string; destination?: string };

// A swap leg seen from the outside: the venue program a router called, and what went in and out of
// that call. Built from token movements, so it works for any router, IDL or not.
export type FlowHop = {
  path: string;
  program: string;
  label: string;
  inputMint?: string;
  inputAmount?: bigint;
  outputMint?: string;
  outputAmount?: bigint;
};

export type RouterHops = { path: string; router: string; label: string; hops: FlowHop[] };

const isWrappedSol = (mint: string) => mint === NATIVE_SOL || mint === 'So11111111111111111111111111111111111111112';

const PLUMBING = new Set([SYSTEM_PROGRAM, ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM]);

export function transferOf(ix: Instr, mintOf: (account?: string) => string | undefined): Transfer | undefined {
  const info = ix.parsed?.info as any;
  if (isTokenProgram(ix.programId)) {
    if (ix.parsed && (ix.parsed.type === 'transfer' || ix.parsed.type === 'transferChecked')) {
      const raw = info.amount ?? info.tokenAmount?.amount;
      const mint = info.mint ?? mintOf(info.source) ?? mintOf(info.destination);
      return mint && raw !== undefined
        ? { mint, amount: BigInt(raw), source: info.source, destination: info.destination }
        : undefined;
    }
    const name = ix.decoded?.name;
    if (name === 'Transfer' || name === 'TransferChecked') {
      const source = ix.accounts[0]?.address;
      const destination = ix.accounts[name === 'Transfer' ? 1 : 2]?.address;
      const mint = name === 'TransferChecked' ? ix.accounts[1]?.address : (mintOf(source) ?? mintOf(destination));
      const amount = ix.decoded?.args?.amount as bigint | undefined;
      return mint && amount !== undefined ? { mint, amount, source, destination } : undefined;
    }
  }
  if (ix.programId === SYSTEM_PROGRAM) {
    if (ix.parsed?.type === 'transfer') {
      return { mint: NATIVE_SOL, amount: BigInt(info.lamports), source: info.source, destination: info.destination };
    }
    if (ix.decoded?.name === 'Transfer') {
      return {
        mint: NATIVE_SOL,
        amount: ix.decoded.args?.lamports as bigint,
        source: ix.accounts[0]?.address,
        destination: ix.accounts[1]?.address,
      };
    }
  }
  return undefined;
}

// For each call a top-level instruction makes into another (non-plumbing) program, the token
// movements inside that call: the first mint moved is what went in, the other one what came out.
export function routerHops(
  ix: Instr,
  mintOf: (account?: string) => string | undefined,
  label: (program: string) => string,
  // The user's overall trade, to tell a leg's input from its output when both mints move.
  direction: { sold?: string; bought?: string } = {}
): RouterHops | undefined {
  const inner = ix.inner;
  const hops: FlowHop[] = [];
  for (let i = 0; i < inner.length; i++) {
    const call = inner[i];
    if (call.stackHeight !== 2 || call.programId === ix.programId) continue;
    if (PLUMBING.has(call.programId) || isTokenProgram(call.programId) || call.event) continue;
    const transfers: Transfer[] = [];
    for (let j = i + 1; j < inner.length && inner[j].stackHeight > call.stackHeight; j++) {
      const t = transferOf(inner[j], mintOf);
      if (t && t.amount > 0n) transfers.push(t);
    }
    // Token movements describe the trade; native SOL inside a venue call is usually rent for an
    // account it creates, so it only counts when tokens alone do not show two sides.
    const tokenMints = [...new Set(transfers.filter((t) => t.mint !== NATIVE_SOL).map((t) => t.mint))];
    const mints = tokenMints.length >= 2 ? tokenMints : [...new Set(transfers.map((t) => t.mint))];
    if (mints.length < 2) continue;
    const used = transfers.filter((t) => mints.includes(t.mint));
    const sum = (mint: string) => used.filter((t) => t.mint === mint).reduce((s, t) => s + t.amount, 0n);
    let [inputMint, outputMint] = [mints[0], mints[mints.length - 1]];
    const same = (a: string, b?: string) => !!b && (a === b || (isWrappedSol(a) && isWrappedSol(b)));
    if (same(outputMint, direction.sold) || same(inputMint, direction.bought))
      [inputMint, outputMint] = [outputMint, inputMint];
    hops.push({
      path: call.path,
      program: call.programId,
      label: label(call.programId),
      inputMint,
      inputAmount: sum(inputMint),
      outputMint,
      outputAmount: sum(outputMint),
    });
  }
  return hops.length ? { path: ix.path, router: ix.programId, label: label(ix.programId), hops } : undefined;
}

export type Movement = Transfer & { kind: 'transfer' | 'rent'; path: string };

// Everything an instruction moves, its CPIs included: token and SOL transfers, and the SOL paid
// to create accounts (rent).
export function movementsOf(ix: Instr, mintOf: (account?: string) => string | undefined): Movement[] {
  const out: Movement[] = [];
  for (const each of [ix, ...ix.inner]) {
    const t = transferOf(each, mintOf);
    if (t && t.amount > 0n) {
      out.push({ ...t, kind: 'transfer', path: each.path });
      continue;
    }
    if (each.programId !== SYSTEM_PROGRAM) continue;
    const info = each.parsed?.info as any;
    if (each.parsed?.type === 'createAccount' && info?.lamports) {
      out.push({
        kind: 'rent',
        path: each.path,
        mint: NATIVE_SOL,
        amount: BigInt(info.lamports),
        source: info.source,
        destination: info.newAccount,
      });
    } else if (each.decoded?.name === 'CreateAccount') {
      out.push({
        kind: 'rent',
        path: each.path,
        mint: NATIVE_SOL,
        amount: each.decoded.args?.lamports as bigint,
        source: each.accounts[0]?.address,
        destination: each.accounts[1]?.address,
      });
    }
  }
  return out;
}
