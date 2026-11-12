// Usage: RPC_URL=... npx tsx scripts/wasm-svm-check.ts <tx.b64>...
// Simulates each transaction in the WASM SVM and with the RPC's simulateTransaction, and prints
// both side by side (error, compute units, fee, balance changes, logs that differ) plus timings.
import { readFileSync, existsSync } from 'fs';
import { setWasmSource, simulateInWasm, type WasmSimOptions } from '../src/sim/wasmSvm';
import { rpcCall } from '../src/sim/rpc';

setWasmSource(readFileSync(new URL('../src/sim/svm.wasm', import.meta.url)));

// RPC_URL, or RPC_URL_FILE (a file holding the URL, to keep API keys out of shell history).
export const rpc =
  process.env.RPC_URL ??
  (process.env.RPC_URL_FILE
    ? readFileSync(process.env.RPC_URL_FILE, 'utf8').trim()
    : 'https://api.mainnet-beta.solana.com');

export async function rpcSimulate(bytes: Uint8Array) {
  const r = await rpcCall<any>(rpc, 'simulateTransaction', [
    Buffer.from(bytes).toString('base64'),
    {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      innerInstructions: true,
      commitment: 'confirmed',
    },
  ]);
  return { slot: r.context.slot, value: r.value };
}

const tokenDelta = (v: any) => {
  const out: Record<string, string> = {};
  const pre = new Map<number, any>(v.preTokenBalances?.map((b: any) => [b.accountIndex, b]) ?? []);
  for (const b of v.postTokenBalances ?? []) {
    const d = BigInt(b.uiTokenAmount.amount) - BigInt(pre.get(b.accountIndex)?.uiTokenAmount.amount ?? 0);
    if (d) out[`${b.owner.slice(0, 6)}/${b.mint.slice(0, 6)}`] = d.toString();
  }
  return out;
};

const lamportDelta = (v: any) =>
  Object.fromEntries(
    (v.preBalances ?? [])
      .map((p: number, i: number) => [i, (v.postBalances?.[i] ?? p) - p])
      .filter(([, d]: number[]) => d !== 0)
  );

export async function compare(label: string, bytes: Uint8Array, options?: WasmSimOptions) {
  const [wasm, node] = await Promise.all([
    simulateInWasm(rpc, bytes, options),
    options ? undefined : rpcSimulate(bytes),
  ]);
  const w = wasm.value;
  console.log(`\n=== ${label}`);
  console.log(
    `wasm: err=${JSON.stringify(w.err)} cu=${w.unitsConsumed} fee=${w.fee} slot=${wasm.slot} accounts=${wasm.accountCount} fetched=${(wasm.fetchedBytes / 1024).toFixed(0)}KiB memory=${(wasm.memoryBytes / 2 ** 20).toFixed(0)}MiB features=${wasm.activeFeatures}`
  );
  console.log(
    `      timings ms: ${Object.entries(wasm.timings)
      .map(([k, v]) => `${k}=${v.toFixed(0)}`)
      .join(' ')}`
  );
  console.log(`      lamports Δ ${JSON.stringify(lamportDelta(w))} tokens Δ ${JSON.stringify(tokenDelta(w))}`);
  if (node) {
    const n = node.value;
    console.log(`rpc:  err=${JSON.stringify(n.err)} cu=${n.unitsConsumed} fee=${n.fee ?? '-'} slot=${node.slot}`);
    console.log(`      lamports Δ ${JSON.stringify(lamportDelta(n))} tokens Δ ${JSON.stringify(tokenDelta(n))}`);
    const wl: string[] = w.logs ?? [];
    const nl: string[] = n.logs ?? [];
    const diff = wl.map((l, i) => (l !== nl[i] ? i : -1)).filter((i) => i >= 0);
    console.log(`      logs: wasm ${wl.length} rpc ${nl.length}, ${diff.length} differ`);
    for (const i of diff.slice(0, 6)) console.log(`        [${i}] wasm: ${wl[i]}\n        [${i}] rpc:  ${nl[i]}`);
    const wi = (w.innerInstructions ?? []).reduce((s: number, x: any) => s + x.instructions.length, 0);
    const ni = (n.innerInstructions ?? []).reduce((s: number, x: any) => s + x.instructions.length, 0);
    console.log(`      inner instructions: wasm ${wi} rpc ${ni}`);
  } else {
    for (const l of (w.logs ?? []).slice(-6)) console.log(`      ${l}`);
  }
  return wasm;
}

if (process.argv[1]?.endsWith('wasm-svm-check.ts')) {
  (async () => {
    for (const input of process.argv.slice(2)) {
      const b64 = existsSync(input) ? readFileSync(input, 'utf8').trim() : input;
      await compare(input.split('/').pop()!, Uint8Array.from(Buffer.from(b64, 'base64')));
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
