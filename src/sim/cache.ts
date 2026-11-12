// Small TTL cache backed by chrome.storage.local inside the extension, and by memory elsewhere
// (Node test scripts). Values must be JSON-serialisable.
type Entry = { value: unknown; expires: number };

const memory = new Map<string, Entry>();
const storage = (globalThis as any).chrome?.storage?.local as chrome.storage.LocalStorageArea | undefined;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  let entry = memory.get(key);
  if (!entry && storage) {
    try {
      entry = (await storage.get(`cache:${key}`))[`cache:${key}`] as Entry | undefined;
    } catch {
      entry = undefined;
    }
  }
  if (!entry || entry.expires < Date.now()) return undefined;
  memory.set(key, entry);
  return entry.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlMs: number) {
  const entry = { value, expires: Date.now() + ttlMs };
  memory.set(key, entry);
  if (storage) {
    try {
      await storage.set({ [`cache:${key}`]: entry });
    } catch {
      // Quota or serialisation errors only cost a refetch.
    }
  }
}
