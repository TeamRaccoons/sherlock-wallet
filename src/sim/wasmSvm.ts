// Runs a transaction in LiteSVM compiled to WebAssembly (svm-wasm/, memory64), against mainnet
// state fetched lazily over RPC, with optional overrides (fake balances, replaced accounts).
// No backend, no local process: the VM lives in the page/worker that calls this.
//
// The result has the shape of simulateTransaction's `value`, so analyze() can take it as a
// precomputed execution.
//
// Extension pages need `'wasm-unsafe-eval'` in their CSP to instantiate the module. The module
// uses memory64 (Chrome 133+, Node 24+): Solana's runtime assumes 64-bit host pointers.
//
// Weight: import this module only from the inspector window, with a dynamic `import()` when fork
// mode is turned on, never from the content script, the injected script or the service worker.
// The module instance (and the VM in it) is per JS realm, so each inspector window gets its own,
// reused across re-simulations; call releaseWasmSvm() when the window closes (closing the page
// frees it anyway).
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { createDefaultProgramCache, type ProgramCache } from './programCache';
import { getMultipleAccounts, rpcCall, type RawAccount } from './rpc';
import { parseTransaction } from './tx';

export type { ProgramCache } from './programCache';

export type AccountOverride = {
  lamports?: bigint | number;
  data?: Uint8Array;
  owner?: string;
  executable?: boolean;
};

// Sets `owner`'s associated token account for `mint` to `amount` raw units, or `uiAmount` in
// the mint's decimals (creating the account if needed).
export type TokenBalanceOverride = { owner: string; mint: string; amount?: bigint | number; uiAmount?: number };

export type Overrides = {
  overrides?: Record<string, AccountOverride>;
  tokenBalances?: TokenBalanceOverride[];
};

export type WasmSimOptions = Overrides & {
  // Program code cache. Defaults to IndexedDB (64 MB, LRU) in pages, memory in Node.
  programCache?: ProgramCache;
};

export type WasmSimTimings = { loadWasmMs: number; fetchMs: number; setAccountsMs: number; simulateMs: number };

export type WasmSimResult = {
  value: any; // simulateTransaction's value
  slot: number;
  timings: WasmSimTimings;
  fetchedBytes: number;
  accountCount: number;
  memoryBytes: number; // WASM linear memory after the run (it only grows, so this is the peak)
  activeFeatures: number;
};

// ---------------------------------------------------------------- override helpers

const LAMPORTS_PER_SOL = 1_000_000_000;

// "Give address X N SOL": sets its balance to N SOL (creating a system account if missing).
export function giveSol(address: string, sol: number): Overrides {
  return { overrides: { [address]: { lamports: BigInt(Math.round(sol * LAMPORTS_PER_SOL)) } } };
}

// "Give address X N tokens of mint M": sets X's associated token account balance (creating the
// account if missing). `amount` is in UI units (decimals read from the mint), or pass
// { raw: bigint } for base units.
export function giveTokens(owner: string, mint: string, amount: number | { raw: bigint }): Overrides {
  return {
    tokenBalances: [
      typeof amount === 'number' ? { owner, mint, uiAmount: amount } : { owner, mint, amount: amount.raw },
    ],
  };
}

export function mergeOverrides(...list: Overrides[]): Overrides {
  return {
    overrides: Object.assign({}, ...list.map((o) => o.overrides ?? {})),
    tokenBalances: list.flatMap((o) => o.tokenBalances ?? []),
  };
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const LOADER_V4 = 'LoaderV411111111111111111111111111111111111';
const IMMUTABLE_LOADERS = [
  'BPFLoader2111111111111111111111111111111111',
  'BPFLoader1111111111111111111111111111111111',
];
const FEATURE_PROGRAM = 'Feature111111111111111111111111111111111111';
const FEATURES_TTL_MS = 60 * 60 * 1000;
const NATIVE_LOADER = 'NativeLoader1111111111111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const SYSVARS = [
  'SysvarC1ock11111111111111111111111111111111',
  'SysvarRent111111111111111111111111111111111',
  'SysvarEpochSchedu1e111111111111111111111111',
  'SysvarEpochRewards1111111111111111111111111',
  'SysvarLastRestartS1ot1111111111111111111111',
  'SysvarS1otHashes111111111111111111111111111',
];
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const TOKEN_ACCOUNT_RENT = 2_039_280n;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const encodeAddress = (a: string) => addressEncoder.encode(a as Address) as Uint8Array;
const decodeAddress = (b: Uint8Array) => addressDecoder.decode(b) as string;
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const readU64 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true);

type Acc = { lamports: bigint; owner: string; data: Uint8Array; executable: boolean; rentEpoch: bigint };

// ---------------------------------------------------------------- module loading

type Exports = {
  memory: WebAssembly.Memory;
  svm_alloc(len: bigint): bigint;
  svm_free(ptr: bigint, len: bigint): void;
  svm_out_ptr(): bigint;
  svm_out_len(): bigint;
  svm_reset(): void;
  svm_drop(): void;
  svm_feature_ids(): void;
  svm_reset_with_features(ptr: bigint, len: bigint): void;
  svm_set_account(ptr: bigint, len: bigint): number;
  svm_simulate(ptr: bigint, len: bigint): number;
  svm_execute(ptr: bigint, len: bigint): number;
  svm_get_accounts(ptr: bigint, len: bigint): void;
};

let wasmSource: string | URL | Uint8Array | undefined;
let instance: Promise<Exports> | undefined;

// Override where the module comes from (bytes, or a URL). Defaults to the bundled svm.wasm.
export function setWasmSource(source: string | URL | Uint8Array) {
  wasmSource = source;
  instance = undefined;
}

async function loadBytes(): Promise<Uint8Array | Response> {
  // Parcel turns `new URL('./svm.wasm', import.meta.url)` into a bundled asset URL. Node scripts
  // pass the bytes with setWasmSource (fetch cannot read file: URLs).
  const source = wasmSource ?? new URL('./svm.wasm', import.meta.url);
  if (source instanceof Uint8Array) return source;
  return fetch(source);
}

function loadModule(): Promise<Exports> {
  instance ??= (async () => {
    const bytes = await loadBytes();
    const result: WebAssembly.WebAssemblyInstantiatedSource =
      bytes instanceof Uint8Array
        ? await WebAssembly.instantiate(bytes as unknown as ArrayBuffer, {})
        : await WebAssembly.instantiateStreaming(bytes, {});
    return result.instance.exports as unknown as Exports;
  })();
  return instance;
}

// Frees the VM and the module instance (its linear memory is released with the last reference).
export async function releaseWasmSvm() {
  const current = instance;
  instance = undefined;
  vmPrograms.clear();
  vmFeatures = undefined;
  if (current) (await current.catch(() => undefined))?.svm_drop();
}

function call(
  wasm: Exports,
  fn: 'svm_set_account' | 'svm_simulate' | 'svm_execute' | 'svm_get_accounts' | 'svm_reset_with_features',
  bytes: Uint8Array
) {
  const len = BigInt(bytes.length);
  const ptr = wasm.svm_alloc(len);
  new Uint8Array(wasm.memory.buffer, Number(ptr), bytes.length).set(bytes);
  const code = wasm[fn](ptr, len);
  wasm.svm_free(ptr, len);
  return code as number | void;
}

function readOut(wasm: Exports) {
  const ptr = Number(wasm.svm_out_ptr());
  const len = Number(wasm.svm_out_len());
  return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len)));
}

function setAccount(wasm: Exports, address: string, acc: Acc) {
  const buf = new Uint8Array(81 + acc.data.length);
  const view = new DataView(buf.buffer);
  buf.set(encodeAddress(address), 0);
  buf.set(encodeAddress(acc.owner), 32);
  view.setBigUint64(64, acc.lamports, true);
  view.setBigUint64(72, acc.rentEpoch, true);
  buf[80] = acc.executable ? 1 : 0;
  buf.set(acc.data, 81);
  if (call(wasm, 'svm_set_account', buf) !== 0) throw new Error(readOut(wasm).error);
}

// ---------------------------------------------------------------- account loading

function toAcc(raw: RawAccount): Acc | undefined {
  if (!raw) return undefined;
  const epoch = (raw as { rentEpoch?: number }).rentEpoch; // u64::MAX does not survive JSON numbers
  const rentEpoch = epoch !== undefined && Number.isSafeInteger(epoch) ? BigInt(epoch) : 2n ** 64n - 1n;
  return {
    lamports: BigInt(raw.lamports),
    owner: raw.owner,
    data: fromBase64(raw.data[0]),
    executable: raw.executable,
    rentEpoch,
  };
}

// Account packed for the cache: owner[32] lamports:u64le executable:u8 data.
function packAcc(acc: Acc) {
  const buf = new Uint8Array(41 + acc.data.length);
  buf.set(encodeAddress(acc.owner), 0);
  new DataView(buf.buffer).setBigUint64(32, acc.lamports, true);
  buf[40] = acc.executable ? 1 : 0;
  buf.set(acc.data, 41);
  return buf;
}

function unpackAcc(buf: Uint8Array): Acc {
  return {
    owner: decodeAddress(buf.subarray(0, 32)),
    lamports: readU64(buf, 32),
    executable: buf[40] === 1,
    data: buf.subarray(41),
    rentEpoch: 2n ** 64n - 1n,
  };
}

class Loader {
  accounts = new Map<string, Acc | undefined>();
  fetchedBytes = 0;
  private fetched = new Set<string>();
  constructor(
    private rpcUrl: string,
    private programCache: ProgramCache
  ) {}

  // Programs owned by the immutable loaders (v1/v2: SPL Token, Memo...) never change: reuse their
  // cached bytes instead of refetching them with the rest of the transaction's accounts.
  async useCachedImmutable(addresses: string[]) {
    await Promise.all(
      [...new Set(addresses)].map(async (a) => {
        const cached = await this.programCache.get(`immutable:${a}`);
        if (cached) this.accounts.set(a, unpackAcc(cached));
      })
    );
  }

  async cacheImmutable(addresses: string[]) {
    for (const a of new Set(addresses)) {
      const acc = this.accounts.get(a);
      if (acc?.executable && IMMUTABLE_LOADERS.includes(acc.owner) && this.fetched.has(a)) {
        await this.programCache.set(`immutable:${a}`, packAcc(acc));
      }
    }
  }

  async load(addresses: string[]) {
    const missing = [...new Set(addresses)].filter((a) => !this.accounts.has(a));
    if (!missing.length) return;
    const raws = await getMultipleAccounts(this.rpcUrl, missing);
    raws.forEach((raw, i) => {
      if (raw) this.fetchedBytes += Math.floor((raw.data[0].length * 3) / 4);
      this.accounts.set(missing[i], toAcc(raw));
      this.fetched.add(missing[i]);
    });
  }

  // Program data accounts are big (often allocated at the 10 MiB maximum, mostly zero padding)
  // and change only on upgrade. Fetch the 45-byte loader header plus the ELF header first, then
  // only the ELF's own bytes; with the cache, reuse the bytes stored for that program and deploy
  // slot (an upgrade changes the slot, so it misses and refetches).
  async loadProgramData(programs: Map<string, string>) {
    // programs: program data address -> program address
    const missing = [...programs.keys()].filter((a) => !this.accounts.has(a));
    if (!missing.length) return;
    const headers = await rpcCall<{ value: (RawAccount & { rentEpoch?: number })[] }>(
      this.rpcUrl,
      'getMultipleAccounts',
      [missing, { encoding: 'base64', dataSlice: { offset: 0, length: PROGRAMDATA_HEADER + ELF_HEAD } }]
    );
    await Promise.all(
      headers.value.map(async (raw, i) => {
        const address = missing[i];
        if (!raw) return this.accounts.set(address, undefined);
        const head = fromBase64(raw.data[0]);
        const key = `program:${programs.get(address)}:${readU64(head, 4)}`;
        this.fetchedBytes += head.length;
        const cached = await this.programCache.get(key);
        if (cached) return this.accounts.set(address, { ...toAcc(raw)!, data: cached });
        const elfLength = elfSize(head.subarray(PROGRAMDATA_HEADER));
        const result = await rpcCall<{ value: (RawAccount & { rentEpoch?: number })[] }>(
          this.rpcUrl,
          'getMultipleAccounts',
          [
            [address],
            elfLength
              ? { encoding: 'base64', dataSlice: { offset: 0, length: PROGRAMDATA_HEADER + elfLength } }
              : { encoding: 'base64' },
          ]
        );
        const acc = toAcc(result.value[0]);
        if (acc) this.fetchedBytes += acc.data.length;
        this.accounts.set(address, acc);
        if (acc) await this.programCache.set(key, acc.data);
      })
    );
  }
}

const PROGRAMDATA_HEADER = 45; // UpgradeableLoaderState::ProgramData: tag, slot, Option<authority>

const ELF_HEAD = 512; // ELF64 header + up to 8 program headers

// Size of an ELF64 image from its first bytes: the end of the section header table (classic
// SBPF ELFs put it last) or of the furthest segment (SBPFv3 ELFs have no section headers).
// Undefined when it cannot be told, and the whole account is fetched.
function elfSize(h: Uint8Array): number | undefined {
  if (h.length < 64 || h[0] !== 0x7f || h[1] !== 0x45 || h[2] !== 0x4c || h[3] !== 0x46 || h[4] !== 2) return undefined;
  const v = new DataView(h.buffer, h.byteOffset, h.length);
  const phoff = Number(v.getBigUint64(0x20, true));
  const phentsize = v.getUint16(0x36, true);
  const phnum = v.getUint16(0x38, true);
  let end = Math.max(64, Number(v.getBigUint64(0x28, true)) + v.getUint16(0x3a, true) * v.getUint16(0x3c, true));
  if (phoff + phentsize * phnum > h.length || phentsize < 56) return undefined;
  end = Math.max(end, phoff + phentsize * phnum);
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    end = Math.max(end, Number(v.getBigUint64(o + 8, true)) + Number(v.getBigUint64(o + 32, true)));
  }
  return end;
}

function programDataAddress(acc: Acc | undefined): string | undefined {
  // UpgradeableLoaderState::Program { programdata_address }: u32 tag 2, then 32 bytes.
  if (!acc || acc.owner !== UPGRADEABLE_LOADER || acc.data.length < 36) return undefined;
  if (new DataView(acc.data.buffer, acc.data.byteOffset).getUint32(0, true) !== 2) return undefined;
  return decodeAddress(acc.data.subarray(4, 36));
}

function lookupTableAddresses(acc: Acc | undefined, address: string): string[] {
  if (!acc) throw new Error(`lookup table ${address} not found`);
  const out: string[] = [];
  for (let o = 56; o + 32 <= acc.data.length; o += 32) out.push(decodeAddress(acc.data.subarray(o, o + 32)));
  return out;
}

async function ataAddress(owner: string, mint: string, tokenProgram: string) {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM as Address,
    seeds: [encodeAddress(owner), encodeAddress(tokenProgram), encodeAddress(mint)],
  });
  return pda as string;
}

function tokenAccountData(mint: string, owner: string, amount: bigint) {
  // spl-token Account: mint, owner, amount, delegate (COption), state, is_native (COption),
  // delegated_amount, close_authority (COption). 165 bytes.
  const data = new Uint8Array(165);
  data.set(encodeAddress(mint), 0);
  data.set(encodeAddress(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1; // Initialized
  return data;
}

// ---------------------------------------------------------------- token balances

function tokenBalance(index: number, acc: Acc | undefined, mints: Map<string, Acc | undefined>) {
  if (!acc || (acc.owner !== TOKEN_PROGRAM && acc.owner !== TOKEN_2022_PROGRAM) || acc.data.length < 165) return;
  if (acc.data.length > 165 && acc.data[165] !== 2) return; // Token-2022: AccountType::Account
  if (acc.data[108] === 0) return; // uninitialized
  const mint = decodeAddress(acc.data.subarray(0, 32));
  const decimals = mints.get(mint)?.data[44] ?? 0;
  const amount = readU64(acc.data, 64);
  const ui = Number(amount) / 10 ** decimals;
  return {
    accountIndex: index,
    mint,
    owner: decodeAddress(acc.data.subarray(32, 64)),
    programId: acc.owner,
    uiTokenAmount: {
      amount: amount.toString(),
      decimals,
      uiAmount: ui,
      uiAmountString: decimals
        ? (Number(amount) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, '')
        : amount.toString(),
    },
  };
}

// ---------------------------------------------------------------- feature set

// Active features read from the chain's feature accounts (owned by the Feature program, data is
// bincode Option<u64>: 1 then the activation slot). Packed as id[32] slot:u64le, cached for an
// hour in memory and in the program cache (so it survives the window).
let features: { packed: Uint8Array; fetchedAt: number; count: number } | undefined;

async function activeFeatures(wasm: Exports, rpcUrl: string, cache: ProgramCache) {
  const now = Date.now();
  if (features && now - features.fetchedAt < FEATURES_TTL_MS) return features;
  const stored = await cache.get('features:mainnet');
  if (stored && stored.length >= 8 && now - Number(readU64(stored, 0)) < FEATURES_TTL_MS) {
    const packed = stored.slice(8);
    return (features = { packed, fetchedAt: Number(readU64(stored, 0)), count: packed.length / 40 });
  }
  wasm.svm_feature_ids();
  const ids: string[] = readOut(wasm);
  const chunks = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
      getMultipleAccounts(rpcUrl, ids.slice(i * 100, i * 100 + 100))
    )
  );
  const active: [string, bigint][] = [];
  chunks.flat().forEach((raw, i) => {
    const acc = toAcc(raw);
    if (acc?.owner === FEATURE_PROGRAM && acc.data.length >= 9 && acc.data[0] === 1) {
      active.push([ids[i], readU64(acc.data, 1)]);
    }
  });
  const record = new Uint8Array(8 + active.length * 40);
  const view = new DataView(record.buffer);
  view.setBigUint64(0, BigInt(now), true);
  active.forEach(([id, slot], i) => {
    record.set(encodeAddress(id), 8 + i * 40);
    view.setBigUint64(8 + i * 40 + 32, slot, true);
  });
  await cache.set('features:mainnet', record);
  return (features = { packed: record.slice(8), fetchedAt: now, count: active.length });
}

// ---------------------------------------------------------------- simulate

// Tracks what the long-lived VM holds, so programs are only recompiled after an upgrade.
const vmPrograms = new Map<string, string>(); // program address -> version (deploy slot...)
let vmFeatures: Uint8Array | undefined; // feature set the VM was built with
let defaultCache: ProgramCache | undefined;
let queue: Promise<unknown> = Promise.resolve();

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// Simulations share one VM, so they run one at a time.
export function simulateInWasm(
  rpcUrl: string,
  txBytes: Uint8Array,
  options: WasmSimOptions = {}
): Promise<WasmSimResult> {
  const run = queue.then(() => simulateOnce(rpcUrl, txBytes, options));
  queue = run.catch(() => undefined);
  return run;
}

// Everything a run needs, fetched in one consistent round and pushed into the VM.
type Prepared = {
  wasm: Exports;
  loader: Loader;
  state: Map<string, Acc | undefined>;
  txs: { keys: string[]; loaded: { writable: string[]; readonly: string[] } }[];
  programData: string[];
  mints: Map<string, Acc | undefined>;
  feat: { packed: Uint8Array; count: number };
  timings: { loadWasmMs: number; fetchMs: number; setAccountsMs: number };
};

async function prepare(rpcUrl: string, txList: Uint8Array[], options: WasmSimOptions): Promise<Prepared> {
  const t0 = performance.now();
  const wasm = await loadModule();
  const t1 = performance.now();

  const parsed = txList.map((bytes, i) => {
    const tx = parseTransaction(bytes);
    if (!tx) throw new Error(`could not decode transaction${txList.length > 1 ? ` ${i}` : ''}`);
    return tx;
  });
  const cache = options.programCache ?? (defaultCache ??= createDefaultProgramCache());
  const loader = new Loader(rpcUrl, cache);
  const featuresPromise = activeFeatures(wasm, rpcUrl, cache);
  featuresPromise.catch(() => undefined); // awaited below; don't leave it unhandled if a fetch before fails

  // Round 1: lookup tables (of every transaction).
  const tables = [...new Set(parsed.flatMap((tx) => tx.lookups.map((l) => l.accountKey)))];
  await loader.load(tables);
  const txs = parsed.map((tx) => {
    const loaded = { writable: [] as string[], readonly: [] as string[] };
    for (const l of tx.lookups) {
      const table = lookupTableAddresses(loader.accounts.get(l.accountKey), l.accountKey);
      loaded.writable.push(...l.writableIndexes.map((i) => table[i]));
      loaded.readonly.push(...l.readonlyIndexes.map((i) => table[i]));
    }
    return { keys: [...tx.staticKeys, ...loaded.writable, ...loaded.readonly], loaded };
  });
  const keys = [...new Set(txs.flatMap((t) => t.keys))];

  // Token balance overrides: resolve the mint's program and the ATA, so the ATA is fetched too.
  const tokenOverrides: { address: string; mint: string; owner: string; amount: bigint; program: string }[] = [];
  if (options.tokenBalances?.length) {
    await loader.load(options.tokenBalances.map((t) => t.mint));
    for (const t of options.tokenBalances) {
      const mint = loader.accounts.get(t.mint);
      if (!mint) throw new Error(`mint ${t.mint} not found`);
      const address = await ataAddress(t.owner, t.mint, mint.owner);
      const amount =
        t.amount !== undefined ? BigInt(t.amount) : BigInt(Math.round((t.uiAmount ?? 0) * 10 ** mint.data[44])); // Mint.decimals
      tokenOverrides.push({ address, mint: t.mint, owner: t.owner, amount, program: mint.owner });
    }
  }
  await loader.useCachedImmutable(keys);

  // Round 2, one batch so the state and the clock come from about the same slot (prop AMMs
  // reject quotes whose oracle update looks newer than the clock): every account of every
  // transaction, the sysvars, and override targets.
  await loader.load([...keys, ...SYSVARS, ...tokenOverrides.map((t) => t.address)]);
  await loader.cacheImmutable(keys);
  // Round 3: program data of upgradeable programs, and mints of token accounts (for decimals).
  const programDataOf = new Map<string, string>(); // program data address -> program address
  for (const k of keys) {
    const pd = programDataAddress(loader.accounts.get(k));
    if (pd) programDataOf.set(pd, k);
  }
  const programData = [...programDataOf.keys()];
  const mintKeys = [...keys, ...tokenOverrides.map((t) => t.address)]
    .map((k) => loader.accounts.get(k))
    .filter((a) => a && (a.owner === TOKEN_PROGRAM || a.owner === TOKEN_2022_PROGRAM) && a.data.length >= 165)
    .map((a) => decodeAddress(a!.data.subarray(0, 32)));
  const [feat] = await Promise.all([
    featuresPromise,
    loader.loadProgramData(programDataOf),
    loader.load([...mintKeys, ...tokenOverrides.map((t) => t.mint)]),
  ]);
  const t2 = performance.now();

  // A new feature set means a new VM (program runtime environments depend on it).
  if (!vmFeatures || !sameBytes(vmFeatures, feat.packed)) {
    call(wasm, 'svm_reset_with_features', feat.packed);
    vmFeatures = feat.packed;
    vmPrograms.clear();
  }

  // Apply overrides.
  const state = new Map(loader.accounts);
  for (const t of tokenOverrides) {
    const existing = state.get(t.address);
    const data = existing ? Uint8Array.from(existing.data) : tokenAccountData(t.mint, t.owner, t.amount);
    new DataView(data.buffer).setBigUint64(64, t.amount, true);
    state.set(t.address, {
      lamports: existing?.lamports ?? TOKEN_ACCOUNT_RENT,
      owner: t.program,
      data,
      executable: false,
      rentEpoch: existing?.rentEpoch ?? 2n ** 64n - 1n,
    });
  }
  for (const [address, o] of Object.entries(options.overrides ?? {})) {
    const base = state.get(address) ?? {
      lamports: 0n,
      owner: SYSTEM_PROGRAM,
      data: new Uint8Array(),
      executable: false,
      rentEpoch: 2n ** 64n - 1n,
    };
    state.set(address, {
      lamports: o.lamports !== undefined ? BigInt(o.lamports) : base.lamports,
      owner: o.owner ?? base.owner,
      data: o.data ?? base.data,
      executable: o.executable ?? base.executable,
      rentEpoch: base.rentEpoch,
    });
  }

  // Push into the VM: sysvars, then plain accounts and program data, then programs (they need
  // their program data present to compile). Absent accounts are pushed as empty, which removes
  // whatever an earlier run left (including state committed by a sequence).
  const empty: Acc = { lamports: 0n, owner: SYSTEM_PROGRAM, data: new Uint8Array(), executable: false, rentEpoch: 0n };
  const programs: string[] = [];
  for (const address of [...SYSVARS, ...tables, ...programData, ...keys, ...tokenOverrides.map((t) => t.address)]) {
    const acc = state.get(address);
    if (address === INSTRUCTIONS_SYSVAR || acc?.owner === NATIVE_LOADER) continue;
    if (acc?.executable) {
      programs.push(address);
      continue;
    }
    setAccount(wasm, address, acc ?? empty);
  }
  for (const address of new Set(programs)) {
    const acc = state.get(address)!;
    const pd = programDataAddress(acc);
    const version = pd
      ? `${pd}:${readU64(state.get(pd)?.data ?? new Uint8Array(12), 4)}`
      : acc.owner === LOADER_V4
        ? `v4:${readU64(acc.data, 0)}` // LoaderV4State.slot
        : `immutable:${acc.data.length}`;
    if (vmPrograms.get(address) === version && !options.overrides?.[address]) continue;
    setAccount(wasm, address, acc);
    vmPrograms.set(address, version);
  }
  const t3 = performance.now();

  const mints = new Map([...state].filter(([k]) => mintKeys.includes(k) || tokenOverrides.some((t) => t.mint === k)));
  return {
    wasm,
    loader,
    state,
    txs,
    programData,
    mints,
    feat,
    timings: { loadWasmMs: t1 - t0, fetchMs: t2 - t1, setAccountsMs: t3 - t2 },
  };
}

const clockSlot = (state: Map<string, Acc | undefined>) => {
  const clock = state.get(SYSVARS[0]);
  return clock ? Number(readU64(clock.data, 0)) : 0;
};

// simulateTransaction's `value` from the VM's output and the accounts before/after.
function toValue(
  out: any,
  preAcc: (Acc | undefined)[],
  postAcc: (Acc | undefined)[],
  mints: Map<string, Acc | undefined>,
  loaded: { writable: string[]; readonly: string[] },
  loadedAccountsDataSize: number
) {
  return {
    err: out.err,
    logs: out.logs,
    fee: out.fee,
    unitsConsumed: out.unitsConsumed,
    returnData: out.returnData,
    preBalances: preAcc.map((a) => Number(a?.lamports ?? 0n)),
    postBalances: postAcc.map((a) => Number(a?.lamports ?? 0n)),
    preTokenBalances: preAcc.map((a, i) => tokenBalance(i, a, mints)).filter(Boolean),
    postTokenBalances: postAcc.map((a, i) => tokenBalance(i, a, mints)).filter(Boolean),
    innerInstructions: out.innerInstructions,
    loadedAddresses: loaded,
    loadedAccountsDataSize,
    accounts: null,
  };
}

async function simulateOnce(rpcUrl: string, txBytes: Uint8Array, options: WasmSimOptions): Promise<WasmSimResult> {
  const p = await prepare(rpcUrl, [txBytes], options);
  const { wasm, state, mints, feat } = p;
  const { keys, loaded } = p.txs[0];
  const t3 = performance.now();

  // The VM takes the raw wire bytes (legacy/v0/v1).
  if (call(wasm, 'svm_simulate', txBytes) !== 0) throw new Error(readOut(wasm).error);
  const out = readOut(wasm);
  const t4 = performance.now();

  const post = new Map<string, Acc>();
  for (const a of out.postAccounts as any[]) post.set(a.pubkey, jsonAcc(a)!);
  const preAcc = keys.map((k) => state.get(k));
  const postAcc = keys.map((k, i) => post.get(k) ?? preAcc[i]);
  const value = toValue(
    out,
    preAcc,
    postAcc,
    mints,
    loaded,
    [...keys, ...p.programData].reduce((n, k) => n + (state.get(k)?.data.length ?? 0), 0)
  );
  // A failed simulation returns no post accounts: only the fee leaves the payer.
  if (out.err && post.size === 0 && value.postBalances.length) {
    value.postBalances[0] = Math.max(0, value.postBalances[0] - out.fee);
  }
  return {
    value,
    slot: clockSlot(state),
    timings: { ...p.timings, simulateMs: t4 - t3 },
    fetchedBytes: p.loader.fetchedBytes,
    accountCount: keys.length,
    memoryBytes: wasm.memory.buffer.byteLength,
    activeFeatures: feat.count,
  };
}

function jsonAcc(a: any): Acc | undefined {
  if (!a) return undefined;
  return {
    lamports: BigInt(a.lamports),
    owner: a.owner,
    data: fromBase64(a.data),
    executable: a.executable,
    rentEpoch: 0n,
  };
}

// Reads accounts as the VM holds them now (null when absent or closed).
function vmAccounts(wasm: Exports, addresses: string[]): (Acc | undefined)[] {
  const packed = new Uint8Array(addresses.length * 32);
  addresses.forEach((a, i) => packed.set(encodeAddress(a), i * 32));
  call(wasm, 'svm_get_accounts', packed);
  return (readOut(wasm) as any[]).map(jsonAcc);
}

// ---------------------------------------------------------------- sequences (bundles)

export type WasmSequenceResult = {
  // One entry per transaction, in order; undefined for those after the first failure.
  results: Array<{ value: any; slot: number } | undefined>;
  // Index of the first failing transaction (the sequence stops there, like a Jito bundle).
  failedIndex?: number;
  slot: number;
  timings: WasmSimTimings;
  fetchedBytes: number;
  accountCount: number;
  memoryBytes: number;
};

// Runs transactions one after the other, each against the state the previous one left: a bundle
// simulation that needs no simulateBundle on the RPC. Accounts for all of them are fetched up
// front in one round and overrides applied once; each transaction is executed and committed in
// the VM (a failed one only pays its fee), and the run stops at the first failure.
export function simulateSequenceInWasm(
  rpcUrl: string,
  txs: Uint8Array[],
  options: WasmSimOptions = {}
): Promise<WasmSequenceResult> {
  const run = queue.then(() => sequenceOnce(rpcUrl, txs, options));
  queue = run.catch(() => undefined);
  return run;
}

async function sequenceOnce(
  rpcUrl: string,
  txList: Uint8Array[],
  options: WasmSimOptions
): Promise<WasmSequenceResult> {
  const p = await prepare(rpcUrl, txList, options);
  const { wasm, state, mints } = p;
  const slot = clockSlot(state);
  const t3 = performance.now();

  // Decimals of mints first met mid-sequence (a token account created by an earlier transaction).
  const mintsFor = (accs: (Acc | undefined)[]) => {
    const missing = accs
      .filter((a) => a && (a.owner === TOKEN_PROGRAM || a.owner === TOKEN_2022_PROGRAM) && a.data.length >= 165)
      .map((a) => decodeAddress(a!.data.subarray(0, 32)))
      .filter((m) => !mints.has(m));
    if (missing.length) vmAccounts(wasm, missing).forEach((a, i) => mints.set(missing[i], a));
  };

  const results: WasmSequenceResult['results'] = txList.map(() => undefined);
  let failedIndex: number | undefined;
  for (let i = 0; i < txList.length; i++) {
    const { keys, loaded } = p.txs[i];
    const preAcc = vmAccounts(wasm, keys);
    if (call(wasm, 'svm_execute', txList[i]) !== 0) throw new Error(readOut(wasm).error);
    const out = readOut(wasm);
    const postAcc = vmAccounts(wasm, keys);
    mintsFor([...preAcc, ...postAcc]);
    const dataSize = [...keys, ...p.programData].reduce((n, k) => n + (state.get(k)?.data.length ?? 0), 0);
    results[i] = { value: toValue(out, preAcc, postAcc, mints, loaded, dataSize), slot };
    if (out.err) {
      failedIndex = i;
      break;
    }
  }
  const t4 = performance.now();
  return {
    results,
    failedIndex,
    slot,
    timings: { ...p.timings, simulateMs: t4 - t3 },
    fetchedBytes: p.loader.fetchedBytes,
    accountCount: new Set(p.txs.flatMap((t) => t.keys)).size,
    memoryBytes: wasm.memory.buffer.byteLength,
  };
}
