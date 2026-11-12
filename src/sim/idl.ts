import { address, createAddressWithSeed, getProgramDerivedAddress } from '@solana/kit';
import { Reader } from './borsh';
import { cacheGet, cacheSet } from './cache';
import { BUNDLED_IDLS } from './idls';
import { getMultipleAccounts } from './rpc';

// Anchor IDLs come in two shapes: the legacy one (< 0.30: camelCase, `publicKey`, `defined: "Name"`,
// no discriminators) and the current one (`pubkey`, `defined: { name }`, explicit discriminators).
// Both are normalised into this structure so the decoder only handles one.
export type IdlType =
  | string
  | { vec: IdlType }
  | { option: IdlType }
  | { coption: IdlType }
  | { array: [IdlType, number | { generic: string }] }
  | { defined: string | { name: string } };

type Field = { name: string; type: IdlType };
type TypeDef =
  | { kind: 'struct'; fields?: (Field | IdlType)[] }
  | { kind: 'enum'; variants: { name: string; fields?: (Field | IdlType)[] }[] }
  | { kind: 'type'; alias: IdlType };

export type NormalizedIdl = {
  programId: string;
  name: string;
  instructions: { name: string; discriminator: Uint8Array; args: Field[]; accounts: string[] }[];
  events: { name: string; discriminator: Uint8Array; type: TypeDef }[];
  errors: Map<number, { name: string; msg?: string }>;
  types: Map<string, TypeDef>;
};

export type DecodedInstruction = {
  name: string;
  args?: Record<string, unknown>;
  // Byte offset of each top-level argument within the instruction data.
  argOffsets?: Record<string, number>;
  accountNames?: string[];
  decodeError?: string;
};

export const EVENT_IX_TAG = Uint8Array.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

async function sighash(preimage: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage));
  return new Uint8Array(digest).slice(0, 8);
}

function flattenAccounts(accounts: any[] = []): string[] {
  return accounts.flatMap((a) => (a.accounts ? flattenAccounts(a.accounts) : [a.name]));
}

function definedName(d: string | { name: string }) {
  return typeof d === 'string' ? d : d.name;
}

export async function normalizeIdl(raw: any, programId: string): Promise<NormalizedIdl> {
  const legacy = !raw.instructions?.some((ix: any) => Array.isArray(ix.discriminator));
  const types = new Map<string, TypeDef>();
  for (const t of raw.types ?? []) types.set(t.name, t.type);
  // Legacy IDLs keep event layouts inline; current ones reference `types`.
  for (const ev of raw.events ?? []) {
    if (ev.fields) types.set(ev.name, { kind: 'struct', fields: ev.fields });
  }

  const instructions = await Promise.all(
    (raw.instructions ?? []).map(async (ix: any) => ({
      name: ix.name as string,
      discriminator: legacy ? await sighash(`global:${snake(ix.name)}`) : Uint8Array.from(ix.discriminator),
      args: (ix.args ?? []) as Field[],
      accounts: flattenAccounts(ix.accounts),
    }))
  );
  const events = await Promise.all(
    (raw.events ?? []).map(async (ev: any) => ({
      name: ev.name as string,
      discriminator: Array.isArray(ev.discriminator)
        ? Uint8Array.from(ev.discriminator)
        : await sighash(`event:${ev.name}`),
      type: types.get(ev.name) ?? { kind: 'struct', fields: [] },
    }))
  );
  const errors = new Map<number, { name: string; msg?: string }>();
  for (const e of raw.errors ?? []) errors.set(e.code, { name: e.name, msg: e.msg });

  return {
    programId,
    name: raw.metadata?.name ?? raw.name ?? programId,
    instructions,
    events,
    errors,
    types,
  };
}

function decodeType(r: Reader, type: IdlType, idl: NormalizedIdl): unknown {
  if (typeof type === 'string') {
    switch (type) {
      case 'bool':
        return r.bool();
      case 'u8':
        return r.u8();
      case 'i8':
        return r.i8();
      case 'u16':
        return r.u16();
      case 'i16':
        return r.i16();
      case 'u32':
        return r.u32();
      case 'i32':
        return r.i32();
      case 'f32':
        return r.f32();
      case 'f64':
        return r.f64();
      case 'u64':
        return r.u64();
      case 'i64':
        return r.i64();
      case 'u128':
        return r.u128();
      case 'i128':
        return r.i128();
      case 'string':
        return r.string();
      case 'bytes':
        return r.bytesN(r.u32());
      case 'pubkey':
      case 'publicKey':
        return r.pubkey();
      default:
        throw new Error(`unsupported type ${type}`);
    }
  }
  if ('vec' in type) {
    const n = r.u32();
    if (n > r.remaining) throw new RangeError(`vec length ${n} too large`);
    return Array.from({ length: n }, () => decodeType(r, type.vec, idl));
  }
  if ('option' in type) return r.u8() ? decodeType(r, type.option, idl) : null;
  if ('coption' in type) return r.u32() ? decodeType(r, type.coption, idl) : null;
  if ('array' in type) {
    const [inner, len] = type.array;
    if (typeof len !== 'number') throw new Error('generic array length');
    if (inner === 'u8') return r.bytesN(len);
    return Array.from({ length: len }, () => decodeType(r, inner, idl));
  }
  if ('defined' in type) {
    const name = definedName(type.defined);
    const def = idl.types.get(name);
    if (!def) throw new Error(`unknown type ${name}`);
    return decodeTypeDef(r, def, idl);
  }
  throw new Error(`unsupported type ${JSON.stringify(type)}`);
}

function decodeFields(r: Reader, fields: (Field | IdlType)[] | undefined, idl: NormalizedIdl) {
  if (!fields?.length) return undefined;
  const named =
    typeof fields[0] === 'object' && fields[0] !== null && 'name' in (fields[0] as any) && 'type' in (fields[0] as any);
  if (named) {
    const out: Record<string, unknown> = {};
    for (const f of fields as Field[]) out[f.name] = decodeType(r, f.type, idl);
    return out;
  }
  return (fields as IdlType[]).map((t) => decodeType(r, t, idl));
}

function decodeTypeDef(r: Reader, def: TypeDef, idl: NormalizedIdl): unknown {
  if (def.kind === 'struct') return decodeFields(r, def.fields, idl) ?? {};
  if (def.kind === 'enum') {
    const index = r.u8();
    const variant = def.variants[index];
    if (!variant) throw new Error(`enum variant ${index} out of range`);
    const fields = decodeFields(r, variant.fields, idl);
    return fields === undefined ? variant.name : { [variant.name]: fields };
  }
  return decodeType(r, def.alias, idl);
}

const startsWith = (data: Uint8Array, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((b, i) => data[i] === b);

export function decodeIdlInstruction(idl: NormalizedIdl, data: Uint8Array): DecodedInstruction | undefined {
  const ix = idl.instructions.find((i) => startsWith(data, i.discriminator));
  if (!ix) return undefined;
  const r = new Reader(data.subarray(ix.discriminator.length));
  const args: Record<string, unknown> = {};
  const argOffsets: Record<string, number> = {};
  try {
    for (const a of ix.args) {
      argOffsets[a.name] = ix.discriminator.length + r.offset;
      args[a.name] = decodeType(r, a.type, idl);
    }
    return { name: ix.name, args, argOffsets, accountNames: ix.accounts };
  } catch (e) {
    return { name: ix.name, args, argOffsets, accountNames: ix.accounts, decodeError: (e as Error).message };
  }
}

export type DecodedEvent = { name: string; data: any };

// Anchor events arrive either as a self-CPI (`emit_cpi!`, tagged with EVENT_IX_TAG) or as a
// `Program data:` log line (`emit!`). `data` here is the payload after the optional tag.
export function decodeIdlEvent(idl: NormalizedIdl, data: Uint8Array): DecodedEvent | undefined {
  const payload = startsWith(data, EVENT_IX_TAG) ? data.subarray(8) : data;
  const ev = idl.events.find((e) => startsWith(payload, e.discriminator));
  if (!ev) return undefined;
  try {
    return { name: ev.name, data: decodeTypeDef(new Reader(payload.subarray(ev.discriminator.length)), ev.type, idl) };
  } catch {
    return undefined;
  }
}

export const isEventInstruction = (data: Uint8Array) => startsWith(data, EVENT_IX_TAG);

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

async function anchorIdlAddress(programId: string) {
  const program = address(programId);
  const [base] = await getProgramDerivedAddress({ programAddress: program, seeds: [] });
  return createAddressWithSeed({ baseAddress: base, programAddress: program, seed: 'anchor:idl' });
}

const IDL_TTL = 24 * 3600_000;
const MISSING_TTL = 6 * 3600_000;
const memory = new Map<string, NormalizedIdl | null>();

const bundled = new Map<string, Promise<NormalizedIdl | null>>();

function bundledIdl(programId: string): Promise<NormalizedIdl | null> {
  const entry = BUNDLED_IDLS[programId];
  if (!entry) return Promise.resolve(null);
  if (!bundled.has(programId)) {
    bundled.set(
      programId,
      entry
        .load()
        .then((m: any) => normalizeIdl(m.default ?? m, programId))
        .catch(() => null)
    );
  }
  return bundled.get(programId)!;
}

// IDLs for the given programs: the one stored on-chain, else one shipped with Sherlock (see
// idls/index.ts). Programs with neither map to null.
export async function fetchIdls(rpcUrl: string, programIds: string[]): Promise<Map<string, NormalizedIdl | null>> {
  const result = await fetchOnChainIdls(rpcUrl, programIds).catch(() => new Map<string, NormalizedIdl | null>());
  await Promise.all(
    [...new Set(programIds)].map(async (id) => {
      if (!result.get(id)) result.set(id, await bundledIdl(id));
    })
  );
  return result;
}

// Fetches Anchor IDLs stored on-chain for the given programs. Programs without one map to null.
async function fetchOnChainIdls(rpcUrl: string, programIds: string[]): Promise<Map<string, NormalizedIdl | null>> {
  const result = new Map<string, NormalizedIdl | null>();
  const toFetch: string[] = [];
  for (const id of new Set(programIds)) {
    if (memory.has(id)) {
      result.set(id, memory.get(id)!);
      continue;
    }
    const cached = await cacheGet<any>(`idl:${id}`);
    if (cached !== undefined) {
      const idl = cached ? await normalizeIdl(cached, id) : null;
      memory.set(id, idl);
      result.set(id, idl);
    } else {
      toFetch.push(id);
    }
  }
  if (!toFetch.length) return result;

  const addresses = await Promise.all(toFetch.map(anchorIdlAddress));
  const accounts = await getMultipleAccounts(rpcUrl, addresses);
  await Promise.all(
    toFetch.map(async (id, i) => {
      let idl: NormalizedIdl | null = null;
      let raw: any = null;
      try {
        const account = accounts[i];
        if (account) {
          const data = Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0));
          const len = new DataView(data.buffer).getUint32(40, true);
          raw = JSON.parse(await inflate(data.subarray(44, 44 + len)));
          idl = await normalizeIdl(raw, id);
        }
      } catch {
        raw = null;
        idl = null;
      }
      memory.set(id, idl);
      result.set(id, idl);
      await cacheSet(`idl:${id}`, raw, raw ? IDL_TTL : MISSING_TTL);
    })
  );
  return result;
}
