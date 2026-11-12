// Usage: RPC_URL(_FILE)=... npx tsx scripts/wasm-svm-sequence.ts [tx1.b64 tx2.b64 ...]
// Runs transaction sequences in the WASM VM (simulateSequenceInWasm) and with the RPC's
// simulateBundle, and compares them transaction by transaction: error, compute units, logs, and
// every account's lamports and data before and after (simulateBundle's pre/post execution
// accounts against the VM's pre/post state).
//  - the files given on the command line, as one sequence (e.g. tx_swap.b64 tx_sol.b64);
//  - a built-in dependent sequence: the whale funds an empty wallet with SOL and 100 USDC, then
//    the wallet sends the USDC back (only possible after the first), and the reverse order, which
//    must fail at the first transaction.
import { readFileSync, existsSync } from 'fs';
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { rpcCall } from '../src/sim/rpc';
import { parseTransaction } from '../src/sim/tx';
import { setWasmSource, simulateInWasm, simulateSequenceInWasm } from '../src/sim/wasmSvm';

setWasmSource(readFileSync(new URL('../src/sim/svm.wasm', import.meta.url)));
const rpc =
  process.env.RPC_URL ??
  (process.env.RPC_URL_FILE
    ? readFileSync(process.env.RPC_URL_FILE, 'utf8').trim()
    : 'https://api.mainnet-beta.solana.com');

const WHALE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';
const enc = getAddressEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

const ata = async (owner: string) =>
  (
    await getProgramDerivedAddress({
      programAddress: ATA as Address,
      seeds: [enc.encode(owner as Address), enc.encode(TOKEN as Address), enc.encode(USDC as Address)],
    })
  )[0] as string;

const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
};

// Legacy transaction, one signer (the first key), random signature bytes so two transactions in
// a bundle never collide (signatures are not verified).
function legacy(
  keys: string[],
  readonlyUnsigned: number,
  ixs: { program: number; accounts: number[]; data: number[] }[]
) {
  const msg = [
    1,
    0,
    readonlyUnsigned,
    keys.length,
    ...keys.flatMap((k) => [...enc.encode(k as Address)]),
    ...new Uint8Array(32),
    ixs.length,
    ...ixs.flatMap((ix) => [ix.program, ix.accounts.length, ...ix.accounts, ix.data.length, ...ix.data]),
  ];
  return Uint8Array.from([1, ...crypto.getRandomValues(new Uint8Array(64)), ...msg]);
}

async function fundAndReturn(wallet: string) {
  const [walletAta, whaleAta] = [await ata(wallet), await ata(WHALE)];
  // whale: 0.01 SOL to wallet, create wallet's USDC account, send it 100 USDC
  const fund = legacy([WHALE, wallet, walletAta, whaleAta, USDC, SYSTEM, TOKEN, ATA], 4, [
    { program: 5, accounts: [0, 1], data: [2, 0, 0, 0, ...u64(10_000_000n)] },
    { program: 7, accounts: [0, 2, 1, 4, 5, 6], data: [1] }, // CreateIdempotent
    { program: 6, accounts: [3, 4, 2, 0], data: [12, ...u64(100_000_000n), 6] }, // TransferChecked
  ]);
  // wallet: send the 100 USDC back
  // simulateBundle rejects identical messages, so each copy can send a different amount.
  const back = (amount = 100_000_000n) =>
    legacy([wallet, walletAta, whaleAta, USDC, TOKEN], 2, [
      { program: 4, accounts: [1, 3, 2, 0], data: [12, ...u64(amount), 6] },
    ]);
  return { fund, back };
}

function keysOf(bytes: Uint8Array, loaded?: { writable: string[]; readonly: string[] }) {
  const tx = parseTransaction(bytes)!;
  return [...tx.staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
}

async function bundle(txs: Uint8Array[], keys: string[][]) {
  const cfg = (i: number) => ({ accountsEncoding: 'base64', addresses: keys[i] });
  const r = await rpcCall<any>(rpc, 'simulateBundle', [
    { encodedTransactions: txs.map(b64) },
    {
      skipSigVerify: true,
      replaceRecentBlockhash: true,
      transactionEncoding: 'base64',
      preExecutionAccountsConfigs: txs.map((_, i) => cfg(i)),
      postExecutionAccountsConfigs: txs.map((_, i) => cfg(i)),
    },
  ]);
  return { slot: r.context.slot, ...r.value };
}

const lamports = (a: any) => (a ? BigInt(a.lamports) : 0n);
const data = (a: any) => (a ? a.data[0] : '');

async function run(label: string, txs: Uint8Array[]) {
  console.log(`\n##### ${label}`);
  let wasmMs = 0;
  let rpcMs = 0;
  // A first run warms the program cache and resolves lookup tables (for the RPC's account lists);
  // the measured run and simulateBundle then start together, so they read about the same slot.
  const warm = await simulateSequenceInWasm(rpc, txs);
  const keys = txs.map((tx, i) => keysOf(tx, warm.results[i]?.value.loadedAddresses));
  const t = performance.now();
  const [wasm, node] = await Promise.all([
    simulateSequenceInWasm(rpc, txs).then((r) => ((wasmMs = performance.now() - t), r)),
    bundle(txs, keys).then((r) => ((rpcMs = performance.now() - t), r)),
  ]);
  console.log(
    `wasm: failedIndex=${wasm.failedIndex ?? '-'} slot=${wasm.slot} total=${wasmMs.toFixed(0)}ms (${Object.entries(
      wasm.timings
    )
      .map(([k, v]) => `${k}=${v.toFixed(0)}`)
      .join(' ')}) fetched=${(wasm.fetchedBytes / 1024).toFixed(0)}KiB accounts=${wasm.accountCount}`
  );
  console.log(`rpc simulateBundle: summary=${JSON.stringify(node.summary)} slot=${node.slot} ${rpcMs.toFixed(0)}ms`);
  for (let i = 0; i < txs.length; i++) {
    const w = wasm.results[i]?.value;
    const n = node.transactionResults?.[i];
    console.log(
      `  tx ${i}: wasm err=${w ? JSON.stringify(w.err) : 'not run'} cu=${w?.unitsConsumed ?? '-'} | rpc err=${n ? JSON.stringify(n.err) : 'not run'} cu=${n?.unitsConsumed ?? '-'}`
    );
    if (!w || !n) continue;
    // simulateBundle cuts logs short ("Log truncated"); compare what it returned.
    const rpcLogs: string[] = n.logs ?? [];
    const cut = rpcLogs.indexOf('Log truncated');
    const shared = cut >= 0 ? cut : rpcLogs.length;
    const logsDiffer = rpcLogs.slice(0, shared).filter((l, j) => l !== w.logs[j]).length;
    console.log(
      `        logs: wasm ${w.logs.length}, rpc ${rpcLogs.length}${cut >= 0 ? ` (truncated after ${cut})` : ''}; ${logsDiffer} of the first ${shared} differ`
    );
    if (process.env.SHOW_LOGS) console.log({ wasm: w.logs, rpc: n.logs });
    let diffs = 0;
    keys[i].forEach((k, j) => {
      const pre = n.preExecutionAccounts?.[j];
      const post = n.postExecutionAccounts?.[j];
      const okPre = BigInt(w.preBalances[j]) === lamports(pre);
      const okPost = BigInt(w.postBalances[j]) === lamports(post);
      if (!okPre || !okPost) {
        diffs++;
        if (diffs <= 4)
          console.log(
            `        ${k.slice(0, 8)} lamports pre wasm ${w.preBalances[j]} rpc ${lamports(pre)} post wasm ${w.postBalances[j]} rpc ${lamports(post)}`
          );
      }
    });
    const tokenDiff = (side: 'pre' | 'post') => {
      const list = side === 'pre' ? w.preTokenBalances : w.postTokenBalances;
      const accs = side === 'pre' ? n.preExecutionAccounts : n.postExecutionAccounts;
      return list.filter((b: any) => {
        const raw = data(accs?.[b.accountIndex]);
        if (!raw) return true;
        const amount = Buffer.from(raw, 'base64').readBigUInt64LE(64);
        return amount.toString() !== b.uiTokenAmount.amount;
      }).length;
    };
    console.log(
      `        accounts: ${keys[i].length}, lamports differ on ${diffs}; token amounts differ pre ${tokenDiff('pre')} post ${tokenDiff('post')}`
    );
  }
}

(async () => {
  const files = process.argv.slice(2);
  if (files.length) {
    const txs = files.map((f) =>
      Uint8Array.from(Buffer.from(existsSync(f) ? readFileSync(f, 'utf8').trim() : f, 'base64'))
    );
    await run(files.map((f) => f.split('/').pop()).join(' then '), txs);
  }
  const wallet = getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32))) as string;
  const { fund, back } = await fundAndReturn(wallet);
  await run(`fund empty wallet ${wallet.slice(0, 8)} then send the USDC back`, [fund, back()]);
  await run('reverse order (send back first): must fail at tx 0', [back(), fund]);
  await run('fund, send 100 USDC back, then 1 more: must fail at tx 2 (no USDC left)', [
    fund,
    back(),
    back(1_000_000n),
  ]);
  // The VM committed the funding above; a single simulation afterwards must see chain state again.
  const after = await simulateInWasm(rpc, back());
  console.log(
    `\nsingle simulateInWasm of "send back" after the sequences: err=${JSON.stringify(after.value.err)} (expected AccountNotFound: committed state does not leak)`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
