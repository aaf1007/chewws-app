/**
 * Where the auth client keeps its session on the phone, wrapped so the data layer can end that
 * session on this phone by itself. Signing out can't wait on the auth client for that: it first
 * refreshes a session that ran out, which with no signal retries for about 25 seconds and then
 * keeps the session, and once it's done it would end whichever session it holds by then, maybe a
 * newer one. Give the same `SessionStorage` to the auth client (`auth.storage`) and to
 * `createDataLayer` (`sessionStorage`).
 *
 * A session cleared here has ended on this phone, and is never saved here again: a refresh of it
 * that lands late (it was under way as the user signed out) is dropped, so it can't sign them back
 * in, now or after a restart.
 */
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SessionStorage = AuthStorage & {
  /** What the auth client keeps here now, as it saved it. */
  saved(): Promise<string[]>;
  /**
   * Removes everything the auth client has kept here: its session is gone from the phone, and
   * ended (`hasEnded`), so it's never saved here again. Returns what was there.
   */
  clear(): Promise<string[]>;
  /** Whether the session with this id (`sessionIdOf`) was ended on this phone. */
  hasEnded(sessionId: string): boolean;
};

/**
 * Which session a session the auth client holds is: its access token's `session_id` claim, the
 * same across refreshes, so a refresh that lands after the session ended is still that session.
 * The refresh token (new on each refresh) if the claim can't be read.
 */
export function sessionIdOf({ access_token, refresh_token }: { access_token: string; refresh_token: string }): string {
  try {
    const payload = access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    if (typeof claims === 'object' && claims !== null && 'session_id' in claims && typeof claims.session_id === 'string') {
      return claims.session_id;
    }
  } catch {
    // Not a token this app can read.
  }
  return refresh_token;
}

/** Which session `raw`, as the auth client saves one, is; null if it isn't a session. */
function sessionIdIn(raw: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const accessToken = 'access_token' in value ? value.access_token : null;
  const refreshToken = 'refresh_token' in value ? value.refresh_token : null;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;
  return sessionIdOf({ access_token: accessToken, refresh_token: refreshToken });
}

export function createSessionStorage(storage: AuthStorage): SessionStorage {
  // Every key the auth client has used. It reads its own when it starts, so after a restart too.
  const keys = new Set<string>();
  const ended = new Set<string>();
  const values = async () => (await Promise.all([...keys].map((key) => storage.getItem(key)))).filter((v) => v !== null);
  return {
    getItem(key) {
      keys.add(key);
      return storage.getItem(key);
    },
    async setItem(key, value) {
      keys.add(key);
      const sessionId = sessionIdIn(value);
      if (sessionId !== null && ended.has(sessionId)) return;
      await storage.setItem(key, value);
    },
    removeItem(key) {
      keys.add(key);
      return storage.removeItem(key);
    },
    saved: values,
    async clear() {
      const removed = await values();
      for (const raw of removed) {
        const sessionId = sessionIdIn(raw);
        if (sessionId !== null) ended.add(sessionId);
      }
      await Promise.all([...keys].map((key) => storage.removeItem(key)));
      return removed;
    },
    hasEnded: (sessionId) => ended.has(sessionId),
  };
}
