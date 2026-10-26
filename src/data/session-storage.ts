/**
 * Where the auth client keeps its session on the phone, wrapped so the data layer can end that
 * session on this phone by itself. Signing out can't wait on the auth client for that: it first
 * refreshes a session that ran out, which with no signal retries for about 25 seconds and then
 * keeps the session. Give the same `SessionStorage` to the auth client (`auth.storage`) and to
 * `createDataLayer` (`sessionStorage`).
 */
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SessionStorage = AuthStorage & {
  /** Removes everything the auth client has kept here: its session is gone from the phone. */
  clear(): Promise<void>;
};

export function createSessionStorage(storage: AuthStorage): SessionStorage {
  // Every key the auth client has used. It reads its own when it starts, so after a restart too.
  const keys = new Set<string>();
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
    async clear() {
      await Promise.all([...keys].map((key) => storage.removeItem(key)));
    },
  };
}
