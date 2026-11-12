import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import bs58 from 'bs58';
import { BUILTIN_PROGRAMS, decodeBuiltin } from './builtin';
import { analyzeJupiter, JupiterSwap } from './jupiter';
import { getAmmLabels, getTokenInfos, TokenInfo } from './jupApi';
import {
  decodeIdlEvent,
  decodeIdlInstruction,
  DecodedEvent,
  DecodedInstruction,
  fetchIdls,
  isEventInstruction,
  NormalizedIdl,
} from './idl';
import { InvokeNode, matchGroups, parseInvokeTree, parseLogs } from './logs';
import { Movement, movementsOf, RouterHops, routerHops } from './flows';
import { safetyChecks } from './safety';
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  DEFAULT_CU_PER_INSTRUCTION,
  DEFAULT_LOADED_ACCOUNTS_DATA_LIMIT,
  JITO_TIP_ACCOUNTS,
  JUPITER_V6,
  isTokenProgram,
  KNOWN_PROGRAMS,
  LAMPORTS_PER_SIGNATURE,
  MAX_CU_LIMIT,
  maxTransactionSize,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  TxVersion,
  WSOL_MINT,
} from './programs';
import { getMultipleAccounts, rpcCall } from './rpc';
import { isWritable, ParsedTransaction, parseTransaction, patchInstructionData, V1_VERSION_BYTE, V1Config } from './tx';
import { describeError, ErrorDescription } from './errors';

export const SOL = 'SOL';

export type AccountMeta = { address: string; writable: boolean; signer: boolean; name?: string };

// Everything known about one account of the transaction, as a block explorer would list it.
export type AccountDetail = AccountMeta & {
  index: number;
  feePayer: boolean;
  fromLookupTable: boolean;
  preLamports?: number;
  postLamports?: number;
  token?: { mint: string; owner: string; decimals: number; pre: bigint; post: bigint };
  owner?: string; // program owning the account (on-chain, cached for a minute)
  executable?: boolean;
  dataSize?: number;
  exists?: boolean;
};

export type Instr = {
  path: string; // "2" for a top-level instruction, "2.3" for its third inner instruction
  programId: string;
  accounts: AccountMeta[];
  data?: Uint8Array;
  decoded?: DecodedInstruction;
  parsed?: { type: string; info: Record<string, unknown> };
  event?: DecodedEvent;
  stackHeight: number;
  computeUnits?: number;
  logs?: string[];
  failed?: string;
  returnData?: string; // base64, top-level only
  // What this instruction moved, its CPIs included (top-level only).
  movements?: Movement[];
  inner: Instr[];
};

// Jupiter Lend Vaults' one `operate` instruction deposits, withdraws, borrows and repays: the signs
// of `new_col` and `new_debt` say which (i128::MIN means the whole position).
const LEND_VAULTS = 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi';
const I128_MIN = -(1n << 127n);

function describeLend(programId: string, decoded: DecodedInstruction | undefined) {
  if (programId !== LEND_VAULTS || decoded?.name !== 'operate' || !decoded.args) return decoded;
  const { new_col: col, new_debt: debt } = decoded.args as { new_col?: unknown; new_debt?: unknown };
  if (typeof col !== 'bigint' || typeof debt !== 'bigint') return decoded;
  const all = (v: bigint) => (v === I128_MIN ? ' all' : '');
  const actions = [
    col > 0n ? 'deposit' : col < 0n ? `withdraw${all(col)}` : '',
    debt > 0n ? 'borrow' : debt < 0n ? `repay${all(debt)}` : '',
  ].filter(Boolean);
  return actions.length ? { ...decoded, name: `operate · ${actions.join(', ')}` } : decoded;
}

export type AssetDelta = { mint: string; decimals: number; pre: bigint; post: bigint; delta: bigint };
export type OwnerChanges = { owner: string; assets: AssetDelta[] };

export type Check = { level: 'ok' | 'info' | 'warn' | 'error'; title: string; detail?: string };

export type GenericSwap = {
  sold: AssetDelta;
  bought: AssetDelta;
  soldUsd?: number;
  boughtUsd?: number;
  vsMarketBps?: number;
};

// An RFQ fill (JupiterZ order engine and alike): the market maker's signed quote, with its expiry.
export type RfqFill = {
  path: string;
  maker?: string;
  inputMint?: string;
  outputMint?: string;
  inputAmount?: bigint;
  outputAmount?: bigint;
  expireAt?: number;
  // Seconds left at simulation time (negative once expired).
  secondsLeft?: number;
};

export type PriorityFeeStats = { p25: number; p50: number; p75: number; p90: number; max: number; samples: number };

export type Analysis = {
  simulatedAt: number;
  // Where the result comes from: a simulation now, the chain (a landed transaction) or a bundle.
  source: 'simulation' | 'landed' | 'bundle' | 'wasm';
  landed?: { signature?: string; slot?: number; blockTime?: number };
  slot?: number;
  version: TxVersion;
  size: number;
  maxSize: number;
  feePayer?: string;
  signers: string[];
  user: string;
  recentBlockhash?: string;
  blockhashValid?: boolean;
  err: unknown;
  error?: ErrorDescription;
  compute: { consumed?: number; limit: number; explicitLimit: boolean; microLamportsPerCu: bigint };
  fees: { total?: bigint; base: bigint; priority: bigint; jitoTip: bigint };
  rent: { created: { address: string; lamports: bigint }[]; closed: { address: string; lamports: bigint }[] };
  loadedAccountsDataSize?: number;
  loadedAccountsDataLimit: number;
  accountKeys: AccountMeta[];
  accounts: AccountDetail[];
  instructions: Instr[];
  logs: string[];
  logsTruncated: boolean;
  userChanges: AssetDelta[];
  others: OwnerChanges[];
  swap?: GenericSwap;
  jupiter: JupiterSwap[];
  // Swap legs of other routers (OKX, DFlow, Titan…), read from the token movements of each venue call.
  routers: RouterHops[];
  rfq?: RfqFill;
  invokeTree: InvokeNode[];
  priorityFees?: PriorityFeeStats;
  // Programs called at the top level, other than the runtime's own (compute budget, system, token…).
  programs: string[];
  // The v1 header's compute budget (SIMD-0385), when the transaction is v1.
  v1Config?: V1Config;
  tokens: Record<string, TokenInfo>;
  labels: Record<string, string>;
  checks: Check[];
};

// An execution result in simulateTransaction's shape. Given one (a landed transaction's meta, a
// bundle simulation's entry), the analysis reads it instead of simulating.
export type Execution = {
  value: any;
  slot?: number;
  source: 'landed' | 'bundle' | 'wasm';
  blockTime?: number;
  signature?: string;
};

export type AnalyzeInput = {
  rpcUrl: string;
  transaction: Uint8Array;
  user?: string;
  addressBook?: Record<string, string>;
  execution?: Execution;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function resolveLookups(rpcUrl: string, tx: ParsedTransaction) {
  const lookups = tx.lookups;
  if (!lookups.length) return { writable: [] as string[], readonly: [] as string[] };
  const accounts = await getMultipleAccounts(
    rpcUrl,
    lookups.map((l) => l.accountKey)
  );
  const writable: string[] = [];
  const readonly: string[] = [];
  lookups.forEach((l, i) => {
    const raw = accounts[i];
    if (!raw) throw new Error(`lookup table ${l.accountKey} not found`);
    // Lookup table layout: a 56-byte header, then the addresses back to back.
    const data = Buffer.from(raw.data[0], 'base64');
    const addressAt = (j: number) => bs58.encode(data.subarray(56 + j * 32, 88 + j * 32));
    writable.push(...l.writableIndexes.map(addressAt));
    readonly.push(...l.readonlyIndexes.map(addressAt));
  });
  return { writable, readonly };
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// Live re-simulation runs every few seconds; only the simulation itself needs to be fresh each time.
const blockhashCache = new Map<string, { valid: boolean; at: number }>();

async function blockhashValidity(rpcUrl: string, blockhash: string) {
  const cached = blockhashCache.get(blockhash);
  // An expired blockhash stays expired; a valid one is checked again after 30 s.
  if (cached && (!cached.valid || Date.now() - cached.at < 30_000)) return cached.valid;
  try {
    const { value } = await rpcCall<{ value: boolean }>(rpcUrl, 'isBlockhashValid', [
      blockhash,
      { commitment: 'confirmed' },
    ]);
    blockhashCache.set(blockhash, { valid: value, at: Date.now() });
    return value;
  } catch {
    return undefined;
  }
}

const priorityCache = new Map<string, { stats?: PriorityFeeStats; at: number }>();

async function priorityFeeStats(rpcUrl: string, writable: string[]): Promise<PriorityFeeStats | undefined> {
  const key = writable.slice(0, 128).join(',');
  const cached = priorityCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.stats;
  const stats = await fetchPriorityFeeStats(rpcUrl, writable);
  priorityCache.set(key, { stats, at: Date.now() });
  return stats;
}

async function fetchPriorityFeeStats(rpcUrl: string, writable: string[]): Promise<PriorityFeeStats | undefined> {
  try {
    const fees = await rpcCall<{ slot: number; prioritizationFee: number }[]>(rpcUrl, 'getRecentPrioritizationFees', [
      writable.slice(0, 128),
    ]);
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    return {
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      max: sorted[sorted.length - 1] ?? 0,
      samples: sorted.length,
    };
  } catch {
    return undefined;
  }
}

function addDelta(map: Map<string, AssetDelta>, mint: string, decimals: number, pre: bigint, post: bigint) {
  const existing = map.get(mint);
  if (existing) {
    existing.pre += pre;
    existing.post += post;
    existing.delta = existing.post - existing.pre;
  } else {
    map.set(mint, { mint, decimals, pre, post, delta: post - pre });
  }
}

export function usdValue(asset: { mint: string; decimals: number }, amount: bigint, tokens: Record<string, TokenInfo>) {
  const price = tokens[asset.mint === SOL ? WSOL_MINT : asset.mint]?.usdPrice;
  if (price === undefined) return undefined;
  return (Number(amount) / 10 ** asset.decimals) * price;
}

export async function analyze(input: AnalyzeInput): Promise<Analysis> {
  const { rpcUrl, transaction } = input;
  const tx = parseTransaction(transaction);
  const version: TxVersion = tx?.version ?? (transaction[0] === V1_VERSION_BYTE ? 1 : 'unknown');
  const staticKeys = tx?.staticKeys ?? [];
  const numSigners = tx?.header.numRequiredSignatures ?? 0;
  const signers = staticKeys.slice(0, numSigners);
  const feePayer = staticKeys[0];
  const user = input.user ?? feePayer ?? '';
  const recentBlockhash = tx?.recentBlockhash;

  const simPromise = input.execution
    ? Promise.resolve({ context: { slot: input.execution.slot }, value: input.execution.value })
    : rpcCall<any>(rpcUrl, 'simulateTransaction', [
        toBase64(transaction),
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
          innerInstructions: true,
          commitment: 'confirmed',
        },
      ]);
  const blockhashPromise =
    recentBlockhash && !input.execution ? blockhashValidity(rpcUrl, recentBlockhash) : Promise.resolve(undefined);

  // An RPC that cannot simulate the transaction (e.g. a format it does not support yet) still
  // leaves everything that can be read from the transaction itself.
  let sim: any;
  let rpcRefusal: string | undefined;
  try {
    sim = await simPromise;
  } catch (e) {
    rpcRefusal = (e as Error).message;
    sim = { value: { err: 'SimulationRefused', logs: [] } };
  }
  const value = sim.value;

  let loaded: { writable: string[]; readonly: string[] } = value.loadedAddresses ?? { writable: [], readonly: [] };
  if (tx && !value.loadedAddresses && tx.lookups.length) {
    loaded = await resolveLookups(rpcUrl, tx).catch(() => ({ writable: [], readonly: [] }));
  }
  const keys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const accountKeys: AccountMeta[] = keys.map((address, i) => ({
    address,
    writable: tx ? isWritable(tx, i) : false,
    signer: i < numSigners,
  }));
  const writableKeys = accountKeys.filter((a) => a.writable).map((a) => a.address);

  const priorityPromise = priorityFeeStats(rpcUrl, writableKeys);

  // ---- Instructions ------------------------------------------------------------------------
  const compiled = tx?.instructions ?? [];
  const innerByIndex = new Map<number, any[]>();
  for (const group of value.innerInstructions ?? []) innerByIndex.set(group.index, group.instructions);

  const programIds = new Set<string>();
  compiled.forEach((ix) => programIds.add(keys[ix.programIdIndex]));
  for (const list of innerByIndex.values())
    for (const ix of list) programIds.add(ix.programId ?? keys[ix.programIdIndex]);
  const nonBuiltin = [...programIds].filter((id) => !BUILTIN_PROGRAMS.has(id));
  const [idls, ammLabels] = await Promise.all([
    fetchIdls(rpcUrl, nonBuiltin).catch(() => new Map<string, NormalizedIdl | null>()),
    getAmmLabels(),
  ]);

  const decode = (programId: string, data: Uint8Array): { decoded?: DecodedInstruction; event?: DecodedEvent } => {
    const builtin = decodeBuiltin(programId, data);
    if (builtin) return { decoded: builtin };
    const idl = idls.get(programId);
    if (!idl) return {};
    if (isEventInstruction(data)) {
      const event = decodeIdlEvent(idl, data);
      return { event, decoded: { name: event ? `emit ${event.name}` : 'emit event' } };
    }
    return { decoded: describeLend(programId, decodeIdlInstruction(idl, data)) };
  };

  const parsedLogs = parseLogs(value.logs ?? []);
  const groupIndex = matchGroups(
    compiled.map((ix) => keys[ix.programIdIndex]),
    parsedLogs.groups
  );

  const instructions: Instr[] = compiled.map((ix, i) => {
    const programId = keys[ix.programIdIndex];
    const data = Uint8Array.from(ix.data);
    const { decoded, event } = decode(programId, data);
    const group = parsedLogs.groups[groupIndex[i]];
    const accounts = ix.accountKeyIndexes.map((k, j) => ({ ...accountKeys[k], name: decoded?.accountNames?.[j] }));
    const top: Instr = {
      path: String(i + 1),
      programId,
      accounts,
      data,
      decoded,
      event,
      stackHeight: 1,
      computeUnits: group?.computeUnits,
      logs: group?.logs,
      failed: group?.failed,
      returnData: group?.returnData?.programId === programId ? group.returnData.data : undefined,
      inner: [],
    };
    top.inner = (innerByIndex.get(i) ?? []).map((inner, j) => {
      const innerProgram: string = inner.programId ?? keys[inner.programIdIndex];
      const innerAccounts: string[] = inner.accounts
        ? inner.accounts.map((a: string | number) => (typeof a === 'number' ? keys[a] : a))
        : [];
      const innerData = inner.data !== undefined ? bs58.decode(inner.data) : undefined;
      const dec = innerData ? decode(innerProgram, innerData) : {};
      const metas = innerAccounts.map((address, k) => {
        const known = accountKeys.find((a) => a.address === address);
        return {
          address,
          writable: known?.writable ?? false,
          signer: known?.signer ?? false,
          name: dec.decoded?.accountNames?.[k],
        };
      });
      return {
        path: `${i + 1}.${j + 1}`,
        programId: innerProgram,
        accounts: metas,
        data: innerData,
        decoded: dec.decoded,
        event: dec.event,
        parsed: inner.parsed && typeof inner.parsed === 'object' ? inner.parsed : undefined,
        stackHeight: inner.stackHeight ?? 2,
        inner: [],
      };
    });
    return top;
  });

  // ---- Compute budget & fees ---------------------------------------------------------------
  let cuLimit: number | undefined;
  let microLamports = 0n;
  let loadedLimit = DEFAULT_LOADED_ACCOUNTS_DATA_LIMIT;
  let priorityLamports: bigint | undefined;
  const v1Config = tx?.config;
  if (v1Config) {
    // v1: the header is the only source; compute budget instructions are ignored (they still run
    // as no-ops). Unset values are the minimum: no fee, a 0 CU limit, a 0 (32 KiB) data limit.
    cuLimit = v1Config.computeUnitLimit ?? 0;
    priorityLamports = v1Config.priorityFeeLamports ?? 0n;
    microLamports = cuLimit > 0 ? (priorityLamports * 1_000_000n) / BigInt(cuLimit) : 0n;
    loadedLimit = v1Config.loadedAccountsDataSizeLimit ?? 0;
  }
  for (const ix of v1Config ? [] : instructions) {
    if (ix.programId !== COMPUTE_BUDGET_PROGRAM || !ix.decoded?.args) continue;
    if (ix.decoded.name === 'SetComputeUnitLimit') cuLimit = Number(ix.decoded.args.units);
    if (ix.decoded.name === 'SetComputeUnitPrice') microLamports = ix.decoded.args.microLamports as bigint;
    if (ix.decoded.name === 'SetLoadedAccountsDataSizeLimit') loadedLimit = Number(ix.decoded.args.bytes);
  }
  const nonBudget = instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM).length;
  const limit = cuLimit ?? Math.min(MAX_CU_LIMIT, nonBudget * DEFAULT_CU_PER_INSTRUCTION);
  const base = BigInt(numSigners * LAMPORTS_PER_SIGNATURE);
  const priority = priorityLamports ?? (microLamports * BigInt(limit) + 999_999n) / 1_000_000n;

  let jitoTip = 0n;
  const visit = (ix: Instr) => {
    if (ix.programId === SYSTEM_PROGRAM) {
      const to = ix.decoded?.name === 'Transfer' ? ix.accounts[1]?.address : (ix.parsed?.info?.destination as string);
      const lamports =
        ix.decoded?.name === 'Transfer'
          ? (ix.decoded.args?.lamports as bigint)
          : ix.parsed?.type === 'transfer'
            ? BigInt(ix.parsed.info.lamports as number)
            : 0n;
      if (to && JITO_TIP_ACCOUNTS.has(to)) jitoTip += lamports;
    }
    ix.inner.forEach(visit);
  };
  instructions.forEach(visit);

  // ---- Balance changes --------------------------------------------------------------------
  const preBalances: number[] = value.preBalances ?? [];
  const postBalances: number[] = value.postBalances ?? [];
  const tokenByIndex = new Map<number, { pre?: any; post?: any }>();
  for (const t of value.preTokenBalances ?? []) tokenByIndex.set(t.accountIndex, { pre: t });
  for (const t of value.postTokenBalances ?? []) {
    const entry = tokenByIndex.get(t.accountIndex) ?? {};
    entry.post = t;
    tokenByIndex.set(t.accountIndex, entry);
  }

  const byOwner = new Map<string, Map<string, AssetDelta>>();
  const ownerMap = (owner: string) => {
    let m = byOwner.get(owner);
    if (!m) byOwner.set(owner, (m = new Map()));
    return m;
  };
  const created: { address: string; lamports: bigint }[] = [];
  const closed: { address: string; lamports: bigint }[] = [];
  const tokenAccountOwner = new Map<string, { owner: string; mint: string }>();
  const decimals = new Map<string, number>();

  for (const [index, { pre, post }] of tokenByIndex) {
    const t = post ?? pre;
    const owner: string = t.owner ?? keys[index];
    tokenAccountOwner.set(keys[index], { owner, mint: t.mint });
    decimals.set(t.mint, t.uiTokenAmount.decimals);
    addDelta(
      ownerMap(owner),
      t.mint,
      t.uiTokenAmount.decimals,
      BigInt(pre?.uiTokenAmount.amount ?? 0),
      BigInt(post?.uiTokenAmount.amount ?? 0)
    );
  }
  preBalances.forEach((preLamports, i) => {
    const postLamports = postBalances[i] ?? preLamports;
    const address = keys[i];
    // Wrapped SOL accounts hold their balance as lamports; only the remainder is rent.
    const token = tokenByIndex.get(i);
    const wrapped = (t: any) => (t?.mint === WSOL_MINT ? BigInt(t.uiTokenAmount.amount) : 0n);
    if (preLamports === 0 && postLamports > 0)
      created.push({ address, lamports: BigInt(postLamports) - wrapped(token?.post) });
    if (preLamports > 0 && postLamports === 0)
      closed.push({ address, lamports: BigInt(preLamports) - wrapped(token?.pre) });
    // Lamports of token accounts are rent, already explained by created/closed.
    if (tokenByIndex.has(i) || preLamports === postLamports) return;
    addDelta(ownerMap(address), SOL, 9, BigInt(preLamports), BigInt(postLamports));
  });

  const nonZero = (m?: Map<string, AssetDelta>) => [...(m?.values() ?? [])].filter((a) => a.delta !== 0n);
  const userChanges = nonZero(byOwner.get(user)).sort((a, b) => (a.mint === SOL ? -1 : b.mint === SOL ? 1 : 0));
  const others = [...byOwner.entries()]
    .filter(([owner]) => owner !== user)
    .map(([owner, m]) => ({ owner, assets: nonZero(m) }))
    .filter((o) => o.assets.length);

  // ---- Token metadata & labels ------------------------------------------------------------
  // When the transaction fails before running, the RPC reports no token balances and swap
  // instructions may not name their input mint. The user's associated token accounts still give
  // it away: find which mint in the transaction derives to each of them.
  const userAtaMints = value.err && user ? await associatedTokenMints(user, keys) : new Map<string, string>();
  for (const [account, mint] of userAtaMints) {
    if (!tokenAccountOwner.has(account)) tokenAccountOwner.set(account, { owner: user, mint });
  }

  const mints = new Set<string>([WSOL_MINT, ...userAtaMints.values()]);
  for (const m of byOwner.values()) for (const a of m.keys()) if (a !== SOL) mints.add(a);
  for (const ix of instructions) {
    for (const a of ix.accounts) if (a.name?.includes('mint')) mints.add(a.address);
  }
  const [tokenInfos, onChain] = await Promise.all([getTokenInfos([...mints]), accountInfos(rpcUrl, keys)]);
  const tokens: Record<string, TokenInfo> = Object.fromEntries(tokenInfos);

  const labels: Record<string, string> = {};
  for (const [id, name] of Object.entries(ammLabels)) labels[id] = name;
  Object.assign(labels, KNOWN_PROGRAMS);
  for (const [id, idl] of idls) if (idl && !labels[id]) labels[id] = idl.name;
  for (const [mint, info] of tokenInfos) if (info.symbol) labels[mint] = info.symbol;
  Object.assign(labels, input.addressBook ?? {});
  if (user) labels[user] = labels[user] ? `${labels[user]} (you)` : 'You';
  for (const [account, { owner, mint }] of tokenAccountOwner) {
    if (labels[account]) continue;
    const ownerLabel = labels[owner];
    labels[account] = `${ownerLabel ?? owner.slice(0, 4) + '…'} ${labels[mint] ?? mint.slice(0, 4) + '…'} account`;
  }

  // ---- Error ---------------------------------------------------------------------------------
  const error = rpcRefusal
    ? { text: `The RPC would not simulate this transaction: ${rpcRefusal}`, name: 'Simulation refused by the RPC' }
    : value.err
      ? describeError(value.err, parsedLogs.failure, idls, instructions, labels)
      : undefined;

  // ---- Jupiter & generic swap ---------------------------------------------------------------
  const jupiter = analyzeJupiter({
    instructions,
    tokens,
    labels,
    tokenAccountOwner,
    decimals,
    ammLabels,
    simulationFailed: !!value.err,
  });
  if (error?.name === 'SlippageToleranceExceeded' && !input.execution) {
    await Promise.all(jupiter.map((j) => measureShortfall(rpcUrl, transaction, instructions, j)));
  }

  const swap = detectSwap(
    userChanges,
    user === feePayer,
    value.fee != null ? BigInt(value.fee) : base + priority,
    jitoTip,
    created,
    closed,
    tokens
  );

  const rfq = detectRfq(instructions);
  const extraMints = await resolveTransferMints(rpcUrl, instructions, tokenAccountOwner);
  const mintOf = (account?: string) =>
    account ? (tokenAccountOwner.get(account)?.mint ?? extraMints.get(account)) : undefined;
  const labelOf = (program: string) => labels[program] ?? `${program.slice(0, 4)}…${program.slice(-4)}`;
  for (const ix of instructions) ix.movements = movementsOf(ix, mintOf);
  const routers = instructions
    .filter((ix) => ix.programId !== JUPITER_V6)
    .map((ix) => routerHops(ix, mintOf, labelOf, { sold: swap?.sold.mint, bought: swap?.bought.mint }))
    .filter((r): r is RouterHops => !!r);

  const [blockhashValid, priorityFees] = await Promise.all([blockhashPromise, priorityPromise]);

  const analysis: Analysis = {
    simulatedAt: Date.now(),
    source: input.execution?.source ?? 'simulation',
    landed:
      input.execution?.source === 'landed'
        ? { signature: input.execution.signature, slot: input.execution.slot, blockTime: input.execution.blockTime }
        : undefined,
    slot: sim.context?.slot,
    v1Config,
    version,
    size: transaction.length,
    maxSize: maxTransactionSize(version),
    feePayer,
    signers,
    user,
    recentBlockhash,
    blockhashValid,
    err: value.err,
    error,
    compute: {
      consumed: value.unitsConsumed,
      limit,
      explicitLimit: cuLimit !== undefined,
      microLamportsPerCu: microLamports,
    },
    fees: { total: value.fee != null ? BigInt(value.fee) : undefined, base, priority, jitoTip },
    rent: { created, closed },
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    loadedAccountsDataLimit: loadedLimit,
    accountKeys,
    accounts: accountKeys.map((meta, i) => {
      const token = tokenByIndex.get(i);
      const t = token?.post ?? token?.pre;
      const info = onChain.get(meta.address);
      return {
        ...meta,
        index: i,
        feePayer: i === 0,
        fromLookupTable: i >= staticKeys.length,
        preLamports: preBalances[i],
        postLamports: postBalances[i],
        token: t
          ? {
              mint: t.mint,
              owner: t.owner ?? '',
              decimals: t.uiTokenAmount.decimals,
              pre: BigInt(token?.pre?.uiTokenAmount.amount ?? 0),
              post: BigInt(token?.post?.uiTokenAmount.amount ?? 0),
            }
          : undefined,
        owner: info?.owner,
        executable: info?.executable,
        dataSize: info?.dataSize,
        exists: info ? info.exists : undefined,
      };
    }),
    instructions,
    logs: value.logs ?? [],
    logsTruncated: parsedLogs.truncated,
    userChanges,
    others,
    swap,
    jupiter,
    routers,
    rfq,
    invokeTree: parseInvokeTree(value.logs ?? []),
    priorityFees,
    programs: [...new Set(instructions.map((ix) => ix.programId).filter((id) => !BUILTIN_PROGRAMS.has(id)))],
    tokens,
    labels,
    checks: [],
  };
  analysis.checks = buildChecks(analysis, !!tx);
  const idlPrograms = new Set([...idls.entries()].filter(([, idl]) => idl).map(([id]) => id));
  analysis.checks.push(
    ...(await safetyChecks(
      rpcUrl,
      analysis,
      idlPrograms,
      mintOf,
      (mint) => decimals.get(mint) ?? tokens[mint]?.decimals
    ))
  );
  return analysis;
}

// When a Jupiter swap reverts on slippage, simulate it again with the tolerance opened up to see
// what the route would actually have filled at, and so how far outside the limit it was.
async function measureShortfall(rpcUrl: string, transaction: Uint8Array, instructions: Instr[], swap: JupiterSwap) {
  if (!swap.failed) return;
  const index = Number(swap.path) - 1;
  const offset = instructions[index]?.decoded?.argOffsets?.slippage_bps;
  if (offset === undefined) return;
  try {
    const tx = parseTransaction(transaction);
    if (!tx) return;
    const data = Uint8Array.from(tx.instructions[index].data);
    new DataView(data.buffer).setUint16(offset, 9_999, true);
    const sim = await rpcCall<any>(rpcUrl, 'simulateTransaction', [
      toBase64(patchInstructionData(transaction, tx, index, data)),
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' },
    ]);
    const { groups } = parseLogs(sim.value.logs ?? []);
    const group =
      groups[
        matchGroups(
          instructions.map((i) => i.programId),
          groups
        )[index]
      ];
    if (!group?.returnData || group.failed) return;
    const amount = new DataView(
      Uint8Array.from(atob(group.returnData.data), (c) => c.charCodeAt(0)).buffer
    ).getBigUint64(0, true);
    const quoted = swap.exactOut ? swap.quotedInAmount : swap.quotedOutAmount;
    const limit = swap.exactOut ? swap.maxInAmount : swap.minOutAmount;
    if (!quoted || limit === undefined) return;
    const sign = swap.exactOut ? -1 : 1;
    swap.unbounded = {
      amount,
      vsQuoteBps: ((sign * Number(amount - quoted)) / Number(quoted)) * 10_000,
      vsLimitBps: ((sign * Number(amount - limit)) / Number(quoted)) * 10_000,
    };
  } catch {
    // Best effort: the failure is already reported.
  }
}

async function associatedTokenMints(owner: string, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const inTx = new Set(keys);
  const encoder = getAddressEncoder();
  const ownerBytes = encoder.encode(address(owner));
  try {
    for (const candidate of new Set(keys)) {
      if (candidate === owner) continue;
      for (const tokenProgram of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
        const [ata] = await getProgramDerivedAddress({
          programAddress: address(ATA_PROGRAM),
          seeds: [ownerBytes, encoder.encode(address(tokenProgram)), encoder.encode(address(candidate))],
        });
        if (inTx.has(ata)) out.set(ata, candidate);
      }
    }
  } catch {
    // Best effort.
  }
  return out;
}

const tokenMintCache = new Map<string, string>();

// Token accounts moved inside venue calls are not always in the RPC's token balance lists; their
// mint is the first 32 bytes of their data.
async function resolveTransferMints(
  rpcUrl: string,
  instructions: Instr[],
  known: Map<string, { owner: string; mint: string }>
): Promise<Map<string, string>> {
  const unknown = new Set<string>();
  const out = new Map<string, string>();
  for (const ix of instructions) {
    for (const inner of ix.inner) {
      const info = inner.parsed?.info as any;
      if (inner.parsed?.type !== 'transfer' || !info?.source || info.mint) continue;
      if (!isTokenProgram(inner.programId)) continue;
      for (const account of [info.source, info.destination]) {
        if (known.has(account)) continue;
        const cached = tokenMintCache.get(account);
        if (cached) out.set(account, cached);
        else unknown.add(account);
      }
    }
  }
  if (!unknown.size) return out;
  try {
    const list = [...unknown];
    const accounts = await getMultipleAccounts(rpcUrl, list);
    list.forEach((address, i) => {
      const data = accounts[i]?.data?.[0];
      if (!data) return;
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length >= 165) {
        const mint = bs58.encode(bytes.subarray(0, 32));
        out.set(address, mint);
        tokenMintCache.set(address, mint); // a token account's mint never changes
      }
    });
  } catch {
    // Unresolved legs are simply left out.
  }
  return out;
}

const accountInfoCache = new Map<
  string,
  { at: number; owner?: string; executable?: boolean; dataSize?: number; exists: boolean }
>();

// Owner, size and executable flag of every account, for the accounts table. These rarely change,
// so they are cached for a minute (re-simulations then cost no extra request).
async function accountInfos(rpcUrl: string, addresses: string[]) {
  const now = Date.now();
  const missing = addresses.filter((a) => (accountInfoCache.get(a)?.at ?? 0) < now - 60_000);
  if (missing.length) {
    try {
      const results: any[] = [];
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const r = await rpcCall<{ value: any[] }>(rpcUrl, 'getMultipleAccounts', [
          chunk,
          { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
        ]);
        results.push(...r.value);
      }
      missing.forEach((address, i) => {
        const v = results[i];
        accountInfoCache.set(address, {
          at: now,
          owner: v?.owner,
          executable: v?.executable,
          dataSize: v?.space,
          exists: !!v,
        });
      });
    } catch {
      // The table just shows less.
    }
  }
  return new Map(addresses.map((a) => [a, accountInfoCache.get(a)]));
}

function detectRfq(instructions: Instr[]): RfqFill | undefined {
  const ix = instructions.find((i) => i.decoded?.name === 'fill' && i.decoded.args?.expire_at !== undefined);
  if (!ix) return undefined;
  const args = ix.decoded!.args!;
  const account = (name: string) => ix.accounts.find((a) => a.name === name)?.address;
  const expireAt = Number(args.expire_at);
  return {
    path: ix.path,
    maker: account('maker'),
    inputMint: account('input_mint'),
    outputMint: account('output_mint'),
    inputAmount: args.input_amount !== undefined ? BigInt(args.input_amount as bigint) : undefined,
    outputAmount: args.output_amount !== undefined ? BigInt(args.output_amount as bigint) : undefined,
    expireAt,
    secondsLeft: Number.isFinite(expireAt) ? expireAt - Math.floor(Date.now() / 1000) : undefined,
  };
}

function detectSwap(
  changes: AssetDelta[],
  userPaysFees: boolean,
  fee: bigint,
  tip: bigint,
  created: { lamports: bigint }[],
  closed: { lamports: bigint }[],
  tokens: Record<string, TokenInfo>
): GenericSwap | undefined {
  // Fold wSOL into SOL and strip what the fee payer spends on fees, tips and rent, so that a swap
  // into SOL reads as a swap and not as noise.
  const assets = new Map<string, AssetDelta>();
  for (const c of changes) {
    const mint = c.mint === WSOL_MINT ? SOL : c.mint;
    addDelta(assets, mint, c.decimals, c.pre, c.post);
  }
  const sol = assets.get(SOL);
  if (sol && userPaysFees) {
    const rent = created.reduce((s, c) => s + c.lamports, 0n) - closed.reduce((s, c) => s + c.lamports, 0n);
    sol.delta += fee + tip + rent;
    if (sol.delta < 0n && -sol.delta < 10_000n) sol.delta = 0n;
  }
  const moved = [...assets.values()].filter((a) => a.delta !== 0n);
  if (moved.length !== 2) return undefined;
  const sold = moved.find((a) => a.delta < 0n);
  const bought = moved.find((a) => a.delta > 0n);
  if (!sold || !bought) return undefined;
  const soldUsd = usdValue(sold, -sold.delta, tokens);
  const boughtUsd = usdValue(bought, bought.delta, tokens);
  const vsMarketBps = soldUsd && boughtUsd !== undefined ? ((boughtUsd - soldUsd) / soldUsd) * 10_000 : undefined;
  return { sold, bought, soldUsd, boughtUsd, vsMarketBps };
}

function buildChecks(a: Analysis, decoded: boolean): Check[] {
  const checks: Check[] = [];
  if (!decoded) {
    checks.push({
      level: 'warn',
      title: `Transaction format ${String(a.version)} not decoded`,
      detail: 'The simulation ran, but instructions and accounts could not be parsed locally.',
    });
  }
  checks.push(
    a.err
      ? { level: 'error', title: 'Simulation failed', detail: a.error?.text }
      : { level: 'ok', title: 'Simulation succeeded', detail: a.slot ? `slot ${a.slot.toLocaleString()}` : undefined }
  );

  if (a.v1Config) {
    const c = a.v1Config;
    if (c.computeUnitLimit === undefined || c.computeUnitLimit === 0) {
      checks.push({
        level: 'error',
        title: 'v1 header sets no compute unit limit',
        detail: 'Unset means 0 compute units for a v1 transaction: it fails at execution.',
      });
    }
    if (!c.loadedAccountsDataSizeLimit) {
      checks.push({
        level: 'error',
        title: 'v1 header sets no loaded account data limit',
        detail: 'Unset means 0 bytes for a v1 transaction: any account load fails.',
      });
    }
    if (a.instructions.some((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM)) {
      checks.push({
        level: 'warn',
        title: 'Compute budget instructions are ignored in v1',
        detail: 'v1 takes limits and priority fee from the header only; these instructions just cost compute.',
      });
    }
    checks.push({
      level: 'ok',
      title: `v1 header: ${c.priorityFeeLamports !== undefined ? `${c.priorityFeeLamports.toLocaleString()} lamports priority` : 'no priority fee'}`,
      detail: [
        c.computeUnitLimit !== undefined ? `CU limit ${c.computeUnitLimit.toLocaleString()}` : undefined,
        c.loadedAccountsDataSizeLimit !== undefined
          ? `data limit ${c.loadedAccountsDataSizeLimit.toLocaleString()} B`
          : undefined,
        c.heapSize !== undefined ? `heap ${c.heapSize.toLocaleString()} B` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (a.accountKeys.length > 64) {
    checks.push({
      level: 'error',
      title: `${a.accountKeys.length} accounts, over the 64-account limit`,
      detail: a.version === 1 ? 'SIMD-0596 (draft) would raise the v1 limit to 96.' : undefined,
    });
  }

  const sizePct = (a.size / a.maxSize) * 100;
  checks.push({
    level: a.size > a.maxSize ? 'error' : sizePct > 90 ? 'warn' : 'ok',
    title: `Size ${a.size} / ${a.maxSize} bytes`,
    detail: `${a.version === 'legacy' ? 'Legacy' : `v${String(a.version)}`} transaction${a.version === 1 ? '' : ' (v1 transactions may use up to 4096 bytes)'}`,
  });

  if (a.compute.consumed != null && !a.err) {
    const used = a.compute.consumed / a.compute.limit;
    const cu = `${a.compute.consumed.toLocaleString()} / ${a.compute.limit.toLocaleString()} CU`;
    if (used > 1) checks.push({ level: 'error', title: `Compute exceeds limit: ${cu}` });
    else if (used > 0.95)
      checks.push({
        level: 'warn',
        title: `Compute limit is tight: ${cu}`,
        detail: 'Less than 5% headroom; state changes before landing could push it over.',
      });
    else if (!a.compute.explicitLimit)
      checks.push({
        level: 'info',
        title: `No compute limit set: ${cu}`,
        detail: 'Default limits make the transaction harder to schedule.',
      });
    // v1 pays a flat priority fee, so an oversized limit costs nothing extra there.
    else if (used < 0.5 && a.compute.microLamportsPerCu > 0n && a.version !== 1)
      checks.push({
        level: 'info',
        title: `Compute limit is ${Math.round(1 / used)}× usage: ${cu}`,
        detail: 'Priority fees are charged on the requested limit, not on usage.',
      });
    else checks.push({ level: 'ok', title: `Compute ${cu}` });
  }

  if (a.priorityFees && a.priorityFees.samples) {
    const p = Number(a.compute.microLamportsPerCu);
    const pf = a.priorityFees;
    const rank =
      p >= pf.p90 ? '≥ p90' : p >= pf.p75 ? 'p75–p90' : p >= pf.p50 ? 'p50–p75' : p >= pf.p25 ? 'p25–p50' : '< p25';
    checks.push({
      level: p < pf.p25 ? 'warn' : 'ok',
      title: `Priority fee ${p.toLocaleString()} µlamports/CU (${rank})`,
      detail: `Recent fees on these accounts: p50 ${pf.p50.toLocaleString()}, p75 ${pf.p75.toLocaleString()}, p90 ${pf.p90.toLocaleString()}`,
    });
  }

  if (a.fees.jitoTip > 0n)
    checks.push({ level: 'info', title: `Jito tip ${(Number(a.fees.jitoTip) / 1e9).toFixed(6)} SOL` });

  if (a.blockhashValid === false) {
    checks.push({
      level: 'warn',
      title: 'Blockhash expired',
      detail: 'The dapp built this transaction with a stale blockhash; the simulation replaced it.',
    });
  }

  if (a.loadedAccountsDataSize !== undefined && a.loadedAccountsDataLimit > 0) {
    const pct = a.loadedAccountsDataSize / a.loadedAccountsDataLimit;
    checks.push({
      level: pct > 1 ? 'error' : pct > 0.9 ? 'warn' : 'ok',
      title: `Loaded account data ${(a.loadedAccountsDataSize / 1024 / 1024).toFixed(1)} / ${(a.loadedAccountsDataLimit / 1024 / 1024).toFixed(1)} MiB`,
    });
  }

  const otherSigners = a.signers.filter((s) => s !== a.user);
  if (otherSigners.length) {
    checks.push({
      level: 'info',
      title: `Needs ${otherSigners.length} other signature${otherSigners.length > 1 ? 's' : ''}`,
      detail: otherSigners.map((s) => a.labels[s] ?? s).join(', '),
    });
  }

  for (const j of a.jupiter) {
    if (j.slippageBps >= 300)
      checks.push({ level: 'warn', title: `Jupiter slippage tolerance ${j.slippageBps / 100}%` });
  }
  return checks;
}
