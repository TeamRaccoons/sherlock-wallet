// Byte cache for program code used by the WASM VM (src/sim/wasmSvm.ts). Only program code goes
// here (upgradeable program data keyed by deploy slot, immutable loader-v2 programs), never
// mutable account state: every simulation reads fresh state from the RPC.
//
// In extension pages it is IndexedDB with a total size cap and least-recently-used eviction; in
// Node (scripts) or wherever IndexedDB is missing, a memory map with the same cap.

export type ProgramCache = {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  clear(): Promise<void>;
};

export const DEFAULT_PROGRAM_CACHE_BYTES = 64 * 1024 * 1024;

export function createMemoryProgramCache(maxBytes = DEFAULT_PROGRAM_CACHE_BYTES): ProgramCache {
  const map = new Map<string, Uint8Array>(); // insertion order = recency
  let total = 0;
  return {
    async get(key) {
      const value = map.get(key);
      if (value) {
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    async set(key, value) {
      if (value.length > maxBytes) return;
      const old = map.get(key);
      if (old) total -= old.length;
      map.delete(key);
      map.set(key, value);
      total += value.length;
      for (const [k, v] of map) {
        if (total <= maxBytes) break;
        map.delete(k);
        total -= v.length;
      }
    },
    async clear() {
      map.clear();
      total = 0;
    },
  };
}

const DB_NAME = 'sherlock-svm';
const BLOBS = 'blobs'; // key -> Uint8Array
const META = 'meta'; // key -> { key, size, used }, indexed by `used`

type Meta = { key: string; size: number; used: number };

function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export function createIdbProgramCache(maxBytes = DEFAULT_PROGRAM_CACHE_BYTES): ProgramCache {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(BLOBS);
        r.result.createObjectStore(META, { keyPath: 'key' }).createIndex('used', 'used');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));

  async function evict(d: IDBDatabase) {
    const tx = d.transaction([BLOBS, META], 'readwrite');
    const metas = (await request(tx.objectStore(META).getAll())) as Meta[];
    let total = metas.reduce((n, m) => n + m.size, 0);
    for (const m of metas.sort((a, b) => a.used - b.used)) {
      if (total <= maxBytes) break;
      tx.objectStore(BLOBS).delete(m.key);
      tx.objectStore(META).delete(m.key);
      total -= m.size;
    }
    await done(tx);
  }

  return {
    async get(key) {
      try {
        const d = await open();
        const tx = d.transaction([BLOBS, META], 'readwrite');
        const value = (await request(tx.objectStore(BLOBS).get(key))) as Uint8Array | undefined;
        if (value) tx.objectStore(META).put({ key, size: value.length, used: Date.now() } satisfies Meta);
        await done(tx);
        return value;
      } catch {
        return undefined; // a broken cache only costs a refetch
      }
    },
    async set(key, value) {
      if (value.length > maxBytes) return;
      try {
        const d = await open();
        const tx = d.transaction([BLOBS, META], 'readwrite');
        tx.objectStore(BLOBS).put(value, key);
        tx.objectStore(META).put({ key, size: value.length, used: Date.now() } satisfies Meta);
        await done(tx);
        await evict(d);
      } catch {
        // Quota errors and the like: the program is simply fetched again next time.
      }
    },
    async clear() {
      try {
        const d = await open();
        const tx = d.transaction([BLOBS, META], 'readwrite');
        tx.objectStore(BLOBS).clear();
        tx.objectStore(META).clear();
        await done(tx);
      } catch {
        // ignore
      }
    },
  };
}

export function createDefaultProgramCache(maxBytes = DEFAULT_PROGRAM_CACHE_BYTES): ProgramCache {
  return typeof indexedDB === 'undefined' ? createMemoryProgramCache(maxBytes) : createIdbProgramCache(maxBytes);
}
