// Browser bench for the WASM SVM: `npx parcel build scripts/wasm-bench/index.html --dist-dir <dir>`
// then serve <dir> and open index.html?tx=<file.b64>[&rpc=<url>][&clear=1]. Runs the transaction
// twice in the same VM and prints timings, bytes fetched, linear memory and active features.
// The program cache is the real one (IndexedDB, 64 MB LRU): ?clear=1 empties it first (cold),
// a plain reload measures a fresh VM with a warm cache.
// Loaded the way the inspector should load it: dynamically, so the page's own bundle stays tiny
// and the VM (JS + .wasm) is fetched only when a simulation is asked for.
const engine = () => Promise.all([import('../../src/sim/wasmSvm'), import('../../src/sim/programCache')]);

const params = new URLSearchParams(location.search);
// ?rpc=<url>, else an rpc.txt served next to the page (keeps API keys out of the URL bar).
let rpc = params.get('rpc') ?? 'https://api.mainnet-beta.solana.com';
const rpcReady = params.get('rpc')
  ? Promise.resolve()
  : fetch('rpc.txt')
      .then((r) => (r.ok ? r.text() : undefined))
      .then((t) => void (t?.startsWith('http') && (rpc = t.trim())))
      .catch(() => undefined);
const out = document.getElementById('out')!;
const input = document.getElementById('tx') as HTMLTextAreaElement;
const log = (s: string) => (out.textContent += s + '\n');
const results: unknown[] = [];

async function run() {
  await rpcReady;
  const t0 = performance.now();
  const [{ simulateInWasm }, { createIdbProgramCache }] = await engine();
  log(`engine chunk import: ${(performance.now() - t0).toFixed(0)}ms`);
  if (params.get('clear')) await createIdbProgramCache().clear();
  const bytes = Uint8Array.from(atob(input.value.trim()), (c) => c.charCodeAt(0));
  for (const label of ['first run in this page', 'second run, same VM']) {
    const t = performance.now();
    const r = await simulateInWasm(rpc, bytes);
    const v = r.value;
    const total = performance.now() - t;
    results.push({
      label,
      total,
      ...r.timings,
      fetchedBytes: r.fetchedBytes,
      memoryBytes: r.memoryBytes,
      err: v.err,
      cu: v.unitsConsumed,
    });
    log(
      `${label}: total=${total.toFixed(0)}ms ${Object.entries(r.timings)
        .map(([k, x]) => `${k}=${x.toFixed(0)}`)
        .join(
          ' '
        )} fetched=${(r.fetchedBytes / 1024).toFixed(0)}KiB memory=${(r.memoryBytes / 2 ** 20).toFixed(0)}MiB features=${r.activeFeatures} err=${JSON.stringify(v.err)} cu=${v.unitsConsumed} logs=${v.logs.length}`
    );
  }
  (window as any).results = results;
  (window as any).done = true;
}

document.getElementById('run')!.onclick = () => run().catch((e) => log(String(e?.stack ?? e)));
const fixture = params.get('tx');
if (fixture)
  fetch(fixture)
    .then((r) => r.text())
    .then((t) => {
      input.value = t.trim();
      return run();
    })
    .catch((e) => log(String(e?.stack ?? e)));
