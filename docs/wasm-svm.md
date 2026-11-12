# Solana VM in WebAssembly, inside the extension

**Status: works, integration-ready on the engine side.** LiteSVM 0.16 (Agave 4.2 runtime, sBPF
interpreter) compiles to **wasm64** (memory64) and runs in Chrome and Node with no backend and no
local process. It gives the same results as mainnet `simulateTransaction` on legacy, v0 (lookup
tables) and v1 transactions, Jupiter swaps and the three signature precompiles included: same
error, compute units, fee, logs, inner instructions and balance changes. Overrides work: an empty
wallet given SOL and USDC runs a swap that fails without them.

The main constraint: it needs **memory64** (Chrome 133+, Firefox 134+, Node 24+; not Safari),
because `wasm32` is blocked by the runtime's 64-bit pointer assumptions (below), and memory64 needs
a nightly Rust toolchain to build (pinned in `svm-wasm/rust-toolchain.toml`).

## Integration contract (for the inspector)

- **Where it loads.** Only the inspector window (an extension page) may load it, and only with a
  dynamic import when fork mode is turned on:
  ```ts
  const { simulateInWasm, giveSol, giveTokens, mergeOverrides, releaseWasmSvm } = await import('../sim/wasmSvm');
  ```
  Never import `src/sim/wasmSvm.ts` or `src/sim/programCache.ts` statically, and never from the
  content script, the injected script or the service worker. With the dynamic import Parcel puts
  the engine in its own chunk (`wasmSvm.*.js`, 70 KB incl. its share of @solana/kit;
  `programCache.*.js`, 2 KB) and emits `svm.*.wasm` as an asset; nothing is added to the page's own
  bundle (checked with a webextension-config build of a test page: page bundle 2.1 KB).
- **The .wasm ships in the extension.** `src/sim/svm.wasm` is committed (built by
  `svm-wasm/build.sh`); `wasmSvm.ts` loads it with `new URL('./svm.wasm', import.meta.url)`, which
  Parcel rewrites to the packaged asset (a `chrome-extension://` URL at run time). Nothing is
  downloaded at run time.
- **Manifest.** Added (and nothing else changed):
  `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }`.
  The inspector also needs host permission for the RPC it calls (as for RPC simulation).
- **API** (`src/sim/wasmSvm.ts`):
  ```ts
  simulateInWasm(rpcUrl, txBytes, { overrides?, tokenBalances?, programCache? })
    → Promise<{ value, slot, timings, fetchedBytes, accountCount, memoryBytes, activeFeatures }>
  giveSol(address, sol)                       // set X's balance to N SOL (creates the account)
  giveTokens(owner, mint, uiAmount | { raw }) // set X's ATA for mint M (creates it if missing)
  mergeOverrides(...overrides)                // combine helpers into one options object
  releaseWasmSvm()                            // free the VM; call on window close (pagehide)
  ```
  `value` has the `simulateTransaction` shape (`err, logs, fee, unitsConsumed, returnData,
  preBalances, postBalances, preTokenBalances, postTokenBalances, innerInstructions (programIdIndex,
  accounts, base58 data, stackHeight), loadedAddresses, loadedAccountsDataSize`). Feed it to
  `analyze({ ..., execution: { value, slot, source: 'wasm' } })`: **`Execution['source']` in
  `src/sim/analyze.ts` needs a `'wasm'` member** (today `'landed' | 'bundle'`).
- **One VM per window.** The module instance lives in the page's JS realm, so each inspector window
  has its own VM, reused across re-simulations (programs stay compiled; calls are queued so they
  never interleave). `releaseWasmSvm()` drops it; closing the window frees it regardless.

## Sequences (bundles without simulateBundle)

```ts
simulateSequenceInWasm(rpcUrl, txs: Uint8Array[], { overrides?, tokenBalances?, programCache? })
  → Promise<{
      results: Array<{ value, slot } | undefined>, // value: simulateTransaction's shape, per tx
      failedIndex?: number,                         // first failing tx; later entries undefined
      slot, timings, fetchedBytes, accountCount, memoryBytes,
    }>
```

- Accounts of **all** transactions (each one's lookup tables resolved, programs through the
  program cache) are fetched up front in the same consistent round as a single simulation, and
  the overrides are applied once.
- Each transaction then runs with `svm_execute` (LiteSVM `send_transaction` semantics): success
  commits every account change in the VM; failure charges only the fee (when the transaction got
  as far as being included) and leaves everything else as it was, as on chain. Sigverify and
  blockhash checks stay off.
- `preBalances` / `preTokenBalances` of transaction N are read from the VM after N-1 ran (its
  post-state), `post*` after N ran (`svm_get_accounts`). Mints first met mid-sequence get their
  decimals from the VM.
- The run stops at the first failure, like a Jito bundle; `failedIndex` says where.
- Same VM instance and queue as `simulateInWasm` (unchanged). Committed state never leaks into
  later runs: every run re-pushes all of its accounts from fresh RPC state (absent ones as empty);
  the script checks it.
- **Difference from Jito:** for the failing transaction simulateBundle reports `unitsConsumed: 0`,
  no logs and post = pre (the bundle does not land), while the VM reports what the transaction
  did before failing and charges its fee, as a standalone transaction on chain would.
- simulateBundle truncates logs (`Log truncated` after ~15 lines); the VM keeps Agave's 10 KB cap.

Parity (`scripts/wasm-svm-sequence.ts`: simulateBundle with pre/post execution accounts for
every key, both started together):

| Sequence | simulateBundle | VM |
| --- | --- | --- |
| tx_swap then tx_sol (whale, Jupiter) | succeeded, CU 722 154 / 189 067 | same CU; lamports and token amounts identical on all 51 / 33 accounts, pre and post; logs identical up to the RPC's truncation |
| fund an empty wallet (SOL + ATA + 100 USDC), then it sends the USDC back | succeeded, CU 13 771 / 105 | identical (8 / 5 accounts) |
| the same, reversed | fails at tx 0, `AccountNotFound` | `failedIndex: 0`, `AccountNotFound` |
| fund, send 100 back, send 1 more | fails at tx 2, `Custom 1` (insufficient funds) | `failedIndex: 2`, `{"InstructionError":[0,{"Custom":1}]}`; tx 0 and 1 identical |

When the two sides read different slots, hot pool accounts differ in pre and post alike; within a
run, tx 1's pre equals tx 0's post on both sides. tx_swap then tx_sol no longer fails with
`InvalidTokenAccount` on mainnet: simulateBundle and the VM both say it succeeds today (the
whale's accounts changed since that observation).

Timings (Node, warm program cache): swap + sol 435 ms total (fetch 285 ms, 1.66 MB; set 3 ms;
execute both + read state back 146 ms, mostly base64 JSON of the large accounts read between
transactions); the 3-transaction USDC sequence 71–88 ms (fetch 60–75 ms).

## What changed in round 2

- **Feature set from chain.** The VM is built with the features active on mainnet, read from the
  feature accounts (`svm_feature_ids` lists the 285 ids this runtime knows; 251 are active on mainnet today),
  cached for one hour in memory and in IndexedDB. LiteSVM's hard-coded snapshot is no longer used.
  A changed feature set rebuilds the VM.
- **Precompiles: ed25519, secp256k1 and secp256r1 all work, without OpenSSL.**
  `svm-wasm/vendor/agave-precompiles` is agave-precompiles 4.2.2 with only `secp256r1.rs`
  rewritten on the pure-Rust `p256` crate (same checks in the same order: offsets, r in [1, n-1],
  low-S s in [1, n/2], SEC1 compressed key, ECDSA-SHA256). ed25519 (ed25519-dalek 1.0.1, as Agave)
  and secp256k1 (libsecp256k1) are upstream code; ed25519-dalek's rand 0.7 needs getrandom 0.1's
  `dummy` backend, never called when verifying. `scripts/wasm-svm-precompiles.ts` signs a valid and
  a tampered message for each and compares with the RPC: valid → `err: null`, tampered →
  `{"InstructionError":[0,{"Custom":2}]}`, identical on both sides for all three.
- **Program-code cache in IndexedDB** (`src/sim/programCache.ts`): 64 MB cap, LRU eviction
  (a `meta` store with last-use times next to the `blobs` store). Keys:
  `program:<program address>:<deploy slot>` for upgradeable programs (the slot comes from the
  45-byte ProgramData header fetched each run, so an upgrade misses and refetches),
  `immutable:<address>` for loader-v1/v2 programs (SPL Token, Memo…, never change). Non-program
  accounts are never cached: every simulation reads fresh state. Node gets a memory cache with the
  same cap.
- **wasm-opt** in `build.sh` (binaryen 133); `-Oz` in round 2, `-O3` behind `OPTIMIZE=1` since round 3.
- **Pinned toolchain**: `svm-wasm/rust-toolchain.toml` → `nightly-2026-04-24`
  (rustc 1.97.0-nightly 36ba2c771), with `rust-src` and `llvm-tools`; `cargo build --locked`.
- Override helpers `giveSol` / `giveTokens` (UI amounts use the mint's decimals) / `mergeOverrides`.
- `releaseWasmSvm()`, `memoryBytes` and `activeFeatures` in the result.

## Numbers

Sizes (`svm-wasm/build.sh`, with precompiles):

| | bytes | gzip |
| --- | --- | --- |
| raw `cargo build --release` | 6 858 860 | — |
| `wasm-opt -O3` | 5 739 630 | 2 696 213 |
| `wasm-opt -Oz` (round 2) | 5 694 110 | 2 687 680 |

Run time is the same for all three (Node 24, swap fixture, medians of 3 fresh VMs × 4 runs:
instantiate 3.4 ms, load + compile 15 ms, simulate 8.8 ms for -O3 and -Oz, 9.3 ms raw), so `-Oz`
shipped in round 2; since round 3 the artifact is `-O3` (cheaper to build, see caveat 5).

Chromium 152, the swap fixture (Jupiter v6, 51 accounts, 7 upgradeable programs, ~700k CU), the
extension's own Parcel build (webextension config) of a test page served locally, real IndexedDB
cache:

| Scenario | Total | Fetch | Load + compile | Simulate | Fetched |
| --- | --- | --- | --- | --- | --- |
| Cold: empty IndexedDB, fresh VM | 821 ms | 762 ms | 21 ms | 23 ms | 7.35 MB |
| Warm cache, fresh VM (page reloaded) | 573 ms | 526 ms | 16 ms | 7 ms | 852 KB |
| Same VM, re-simulation | 182–1 700 ms | 168–1 680 ms | 4–7 ms | 7–9 ms | 852 KB |

Engine chunk import: 4–8 ms. WASM instantiate: 11–22 ms. The VM's own work is ~15–50 ms; the rest
is RPC latency, which varied 0.17–3 s run to run on the keyed RPC. The 852 KB left on warm runs is
mostly one 719 KB GoonFi pool account (mutable state, has to be fresh).

**Memory** (swap fixture, Chromium): WASM linear memory **30 MiB after the first run, 38 MiB after
the second, then flat at 40 MiB** over 12 runs (it never shrinks; `releaseWasmSvm()` frees it). JS
heap 17 MiB for the whole page.

## Results against mainnet `simulateTransaction`

`scripts/wasm-svm-check.ts`, `sigVerify: false`, `replaceRecentBlockhash: true`, chain feature set:

| Fixture | Format | Result |
| --- | --- | --- |
| tx_transfer | v0 | identical (CU 300) |
| tx_v1 | v1 (SIMD-0385) | identical (CU 150, fee 17 345) |
| tx_swap | v0 + ALTs, Jupiter v6 | identical when both run in the same slot (CU ~697k, 88 logs, 24 inner ixs, SOL and SPL changes); one slot apart, pool state moves |
| tx_exactout | v0, Jupiter | identical |
| tx_ultra | v0, Jupiter Ultra | identical in the same slot |
| tx_user_rfq | v0, failing RFQ | identical (`Custom 2506`) |
| tx_hostile | legacy | identical |
| ed25519 / secp256k1 / secp256r1 | legacy, precompile | identical, valid and tampered |

Override demos (`scripts/wasm-svm-override.ts`), for a fresh random wallet; RPC and wasm both
fail with `AccountNotFound` without overrides:
- SPL `TransferChecked` of 100 USDC to another holder, with
  `mergeOverrides(giveSol(wallet, 0.01), giveTokens(wallet, USDC, 100))`: succeeds (CU 105), the
  wallet's USDC account is created by the override, 100 → 0, recipient +100, fee 5 000 lamports;
- Jupiter 100 USDC → SOL swap (round 1; Jupiter's public swap API was rate-limiting during round 2,
  the script skips it then): succeeds, ~85–93k CU, wallet 0.05 → ~1.015 SOL, USDC 100 → 0.

## What compiled, what did not

| Target | Result |
| --- | --- |
| `wasm32-unknown-unknown` | **Blocked.** `solana-program-runtime` 4.2.2 `src/memory.rs:49`: `error[E0512]: cannot transmute between types of different sizes … source type: u64 (64 bits), target type: &mut T (32 bits)`. Patching that line would compile but be wrong: CPI and syscalls read guest structs with host layouts (`translate_type::<&[u8]>`, `StableInstruction`, `AccountInfo` in `cpi.rs`), which only match SBF's 64-bit layout on a 64-bit host. |
| `wasm64-unknown-unknown` (tier 3, `-Zbuild-std`) | **Compiles and runs**, runtime unmodified. |

Patches, all outside the runtime:

- **getrandom** 0.1/0.2/0.3: `compile_error!` on wasm-unknown → deterministic custom backends /
  `dummy`. No wasm-bindgen; the module has **zero imports**.
- **`std::time::Instant::now()`** panics at run time → `svm-wasm/vendor/solana-svm-measure` reads
  timings as zero on wasm.
- **blst** (C): Apple `ar` writes no wasm symbol index (`undefined symbol: blst_fp_cneg`) →
  `build.sh` uses `llvm-ar` from `llvm-tools`.
- **OpenSSL** (secp256r1 precompile) → `svm-wasm/vendor/agave-precompiles` with `p256`.
- **v1 decoding**: bincode cannot read v1 → `wincode`.
- LiteSVM pinned to 0.16.0 (0.18 needs rustc 1.97.1; the pinned nightly is 1.97.0).

## How it works

- `svm-wasm/` — Rust crate, LiteSVM with a C-style ABI: `svm_alloc/svm_free`,
  `svm_feature_ids`, `svm_reset_with_features(packed)`, `svm_set_account(packed)`,
  `svm_simulate(tx wire bytes)`, `svm_out_ptr/len` (JSON), `svm_drop`. VM = chain features,
  builtins, sysvars, precompiles, no bundled SPL ELFs (real programs come from the RPC), sigverify
  and blockhash checks off, Agave's 10 KB log cap.
- Account loading, 4 round trips: (1) lookup tables; (2) every transaction account + sysvars
  (clock, rent, epoch schedule, epoch rewards, last restart slot, slot hashes) + override targets
  in one batch, so state and clock are from about the same slot (a prop AMM rejected an oracle
  update newer than the clock when the clock came a round earlier); (3) ProgramData headers
  (557-byte slices: loader header + ELF header + program headers) and token mints (decimals);
  (4) only on a cache miss, each program's ELF bytes trimmed to the ELF's own length (one program
  in the swap is allocated at 10 MiB, mostly padding: 17.7 MB stored → 7.35 MB fetched).
  Feature accounts (3 calls of ≤100) run in parallel, once an hour.
- Programs are recompiled in the VM only when their deploy slot changes; every other account is
  re-pushed each run, and missing accounts are pushed empty so nothing leaks between simulations.
- Token balances are computed in TS from pre/post account data (Token and Token-2022).

## Build and run

```sh
svm-wasm/build.sh             # iterate: raw cargo output -> src/sim/svm.wasm, no wasm-opt
OPTIMIZE=1 svm-wasm/build.sh  # release artifact: + wasm-opt -O3 (brew install binaryen)
# both run at nice 19, 4 cargo jobs, BINARYEN_CORES=2; rustup installs the pinned nightly on first use
RPC_URL_FILE=path/to/rpc.txt npx tsx scripts/wasm-svm-check.ts tx_transfer.b64 tx_v1.b64 tx_swap.b64
RPC_URL_FILE=path/to/rpc.txt npx tsx scripts/wasm-svm-override.ts
RPC_URL_FILE=path/to/rpc.txt npx tsx scripts/wasm-svm-precompiles.ts
RPC_URL_FILE=path/to/rpc.txt npx tsx scripts/wasm-svm-sequence.ts [tx1.b64 tx2.b64 ...]
# browser bench: build scripts/wasm-bench as an extension page (or with --public-url ./ for a plain
# page), serve it with rpc.txt and a fixture next to it, open ?tx=tx_swap.b64[&clear=1]
```

## Caveats

1. **memory64 only.** Chrome 133+ / Firefox 134+ / Node 24+. No Safari.
2. **State consistency.** Batches over 100 accounts come from several calls; a live pool can move
   between the RPC's slot and ours. Same as any client-side fork.
3. **Not modelled:** epoch stakes (`sol_get_epoch_stake` returns 0); stake history, recent
   blockhashes and fees sysvars use LiteSVM defaults; `loadedAccountsDataSize` counts program
   data at ELF length, so a transaction right at its loaded-data limit could pass here and fail on
   chain.
4. **Precompile parity** rests on `p256` matching OpenSSL for secp256r1 (range checks are explicit
   and identical; tested on valid and tampered signatures, not fuzzed).
5. The shipped artifact is `wasm-opt -O3` (since round 3: 5 754 061 bytes, gzip 2 701 607;
   `OPTIMIZE=1` build 211 s at nice 19 with 2 binaryen threads, cargo cached). It is committed so
   UI work never needs Rust; `-Oz` saves under 1 % for several more minutes of CPU.
