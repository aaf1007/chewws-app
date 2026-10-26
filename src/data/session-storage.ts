/**
 * Where the auth client keeps its session on the phone, wrapped so the data layer can end that
 * session on this phone by itself. Signing out can't wait on the auth client for that: it first
 * refreshes a session that ran out, which with no signal retries for about 25 seconds and then
 * keeps the session, and once it's done it would end whichever session it holds by then, maybe a
 * newer one. Give the same `SessionStorage` to the auth client (`auth.storage`) and to
 * `createDataLayer` (`sessionStorage`).
 */
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SessionStorage = AuthStorage & {
  /** What the auth client keeps here now, as it saved it. */
  saved(): Promise<string[]>;
  /** Removes everything the auth client has kept here: its session is gone from the phone. Returns what was there. */
  clear(): Promise<string[]>;
};

export function createSessionStorage(storage: AuthStorage): SessionStorage {
  // Every key the auth client has used. It reads its own when it starts, so after a restart too.
  const keys = new Set<string>();
  const values = async () => (await Promise.all([...keys].map((key) => storage.getItem(key)))).filter((v) => v !== null);
  return {
    getItem(key) {
      keys.add(key);
      return storage.getItem(key);
    },
    setItem(key, value) {
      keys.add(key);
      return storage.setItem(key, value);
    },
    removeItem(key) {
      keys.add(key);
      return storage.removeItem(key);
    },
    saved: values,
    async clear() {
      const removed = await values();
      await Promise.all([...keys].map((key) => storage.removeItem(key)));
      return removed;
    },
  };
}
