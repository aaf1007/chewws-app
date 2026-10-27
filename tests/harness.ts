import pg from 'pg';
import { inject } from 'vitest';

import {
  createDataLayer,
  createSessionStorage,
  type DataLayer,
  type IngredientId,
  type KeyValueStorage,
  type ShoppingListItemId,
  type UserId,
} from '../src/data';
import {
  createTestAccount,
  createTestClient,
  inProcessDraftBuilds,
  signInAttacker,
  type DraftBuilds,
  type DraftFakes,
  type TestAccount,
} from './access-harness';

export type { DraftBuilds, DraftFakes };

export type TestUser = { userId: UserId; data: DataLayer; drafts: DraftBuilds };

/**
 * A fresh signed-in user. Behaviour tests reach the app only through `data`, its data-layer
 * actions. Their saved links build in-process with `fakes` (canned TikTok videos and Claude
 * answers by default), with no network; `drafts.settled()` waits for those builds.
 */
export async function signInTestUser(label = 'user', fakes: DraftFakes = {}): Promise<TestUser> {
  const { userId, data, drafts } = await signInAttacker(label, fakes);
  return { userId, data, drafts };
}

/** Sessions waiting, directly or through others, on the session with this pid. Live, never cached. */
const WAITING_ON = `
  with recursive waiting (pid) as (
    select l.pid from pg_locks l where not l.granted and $1::int = any (pg_blocking_pids(l.pid))
    union
    select l.pid from pg_locks l join waiting w on w.pid = any (pg_blocking_pids(l.pid)) where not l.granted
  )
  select count(distinct pid)::int as count from waiting`;

export type HeldLine = {
  /** Resolves once `count` database sessions are waiting on the held line (or on sessions that are). */
  waitForWaiting(count: number): Promise<void>;
  /** Rolls the held line back, so whoever waited on it carries on as if it had never been there. */
  release(): Promise<void>;
};

export type HeldRemoval = Omit<HeldLine, 'release'> & {
  /** Commits the removal, so whoever waited on it carries on with the item gone. */
  commit(): Promise<void>;
};

/** A second database session that runs `sql` in a transaction it doesn't end until told to. */
async function holdInTransaction(sql: string, params: unknown[]) {
  const session = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await session.connect();
  await session.query('begin');
  await session.query(sql, params);
  const { rows } = await session.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0].pid;
  let ended = false;

  async function end(how: 'commit' | 'rollback') {
    ended = true;
    await session.query(how);
    await session.end();
  }
  return {
    async waitForWaiting(count: number) {
      const deadline = Date.now() + 10_000;
      while (!ended) {
        const waiting = await session.query<{ count: number }>(WAITING_ON, [pid]);
        if (waiting.rows[0].count >= count) return;
        if (Date.now() > deadline) throw new Error(`Fewer than ${count} sessions waited on the held transaction.`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    commit: () => end('commit'),
    release: () => end('rollback'),
  };
}

/**
 * For race tests only: a second database session that starts making the user's Shopping List line
 * for an Ingredient and doesn't commit. Until `release()`, anything of theirs that writes that line
 * waits at it, so a test can run another action while the first is stopped there.
 */
export async function holdShoppingListLine(user: TestUser, ingredientId: IngredientId): Promise<HeldLine> {
  const { waitForWaiting, release } = await holdInTransaction(
    `insert into public.shopping_list_items (list_id, ingredient_id)
     select l.id, $2 from public.shopping_lists l where l.owner_id = $1`,
    [user.userId, ingredientId],
  );
  return { waitForWaiting, release };
}

/**
 * For race tests only: a second database session that removes a Shopping List item, as another
 * phone does, and doesn't commit yet. Until `commit()`, anything that writes that item waits at it.
 */
export async function holdShoppingListRemoval(itemId: ShoppingListItemId): Promise<HeldRemoval> {
  const { waitForWaiting, commit } = await holdInTransaction(
    'delete from public.shopping_list_items where id = $1',
    [itemId],
  );
  return { waitForWaiting, commit };
}

/**
 * A request that left a phone: whose session it carried (the `sub` of its `Authorization` bearer
 * token, read without checking it; null for none, as with the anon key) and its path, such as
 * `/rest/v1/rpc/add_manual_item`.
 */
export type SentRequest = { user: string | null; path: string };

/** Whose session a request's `Authorization` header carries, if any. */
function userOfBearer(authorization: string | null): string | null {
  const payload = authorization?.match(/^Bearer [^.]+\.([^.]+)\./)?.[1];
  if (!payload) return null;
  const { sub }: { sub?: unknown } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return typeof sub === 'string' ? sub : null;
}

/** What a phone's app has saved: its storage's keys and values. */
export type SavedOnPhone = ReadonlyMap<string, string>;

export type TestPhone = TestUser & {
  /** The user's email and password, to sign them in again (on any phone). */
  account: TestAccount;
  /** No signal: every request fails as it would in the app. */
  goOffline(): void;
  goOnline(): void;
  /**
   * The server, or a gateway in front of it, answers every request from this phone with this
   * HTTP status (a fault, not an answer to the request), until it's set back to null.
   */
  serverAnswers(status: number | null): void;
  /**
   * As `serverAnswers`, but only for requests that name `text` (in their URL or body), such as
   * every request to change one item. Other requests get through. With `json`, the answer is that
   * JSON body, as the auth server sends it (with its API version header), instead of plain text.
   */
  serverAnswersFor(text: string, status: number | null, json?: object): void;
  /**
   * For race tests only: the phone's next request that names `text` (in its URL or body) waits
   * before it goes out until `release()` is called; `reached` resolves when it's waiting.
   */
  holdNextRequest(text: string): { reached: Promise<void>; release(): void };
  /** Every request that has left this phone (with a signal), in order, faulted ones included. */
  requestsMade(): SentRequest[];
  /** Sets the phone's clock; list changes made from now on are stamped from it. */
  setClock(at: Date): void;
  /** A copy of what the app has saved on this phone. */
  saved(): SavedOnPhone;
  /** A copy of what the auth client has saved on this phone: its session, if any. */
  savedAuth(): SavedOnPhone;
  /** Writes into the app's storage, as an older app version or a cut-short write might have. */
  overwriteSaved(key: string, value: string): void;
  /**
   * The access token the phone holds runs out, as after an hour in a pocket: the next request
   * first has to refresh it, which takes a signal. The refresh token still works.
   */
  expireAccessToken(): void;
  /** The server revokes the user's sessions (signed out everywhere): refreshing is refused. */
  revokeSessions(): Promise<void>;
  /**
   * For race tests only: the auth client's next read of the session it saved is slow, as
   * AsyncStorage on a phone can be. It reads what is saved then, but gets the answer only once
   * `release()` is called; `reached` resolves when it has read.
   */
  slowNextSessionRead(): { reached: Promise<void>; release(): void };
  /**
   * For race tests only: the auth client's first read of its session after it next saves one (as
   * a refresh does) waits before it reads, until `release()` is called; `reached` resolves when
   * it's waiting. It reads what is saved once released.
   */
  holdSessionReadAfterNextSave(): { reached: Promise<void>; release(): void };
  /**
   * The app started again on this phone (a cold start: a new auth client too), from what it saved
   * (or from `saved`) and the session the auth client saved (or `savedAuth`).
   */
  relaunch(saved?: SavedOnPhone, savedAuth?: SavedOnPhone): TestPhone;
};

/** Storage for the auth client's session on a phone, kept apart from what the app saves. */
function authStorageOn(items: Map<string, string>) {
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => void items.set(key, value),
    removeItem: async (key: string) => void items.delete(key),
  };
}

/** Rewrites the saved session so its access token expired a minute ago. */
function expireSavedSession(items: Map<string, string>) {
  for (const [key, value] of items) {
    const saved: unknown = JSON.parse(value);
    if (typeof saved === 'object' && saved !== null && 'expires_at' in saved) {
      items.set(key, JSON.stringify({ ...saved, expires_at: Math.floor(Date.now() / 1000) - 60 }));
    }
  }
}

export type PhoneOptions = {
  /**
   * The auth client refreshes its session when the app starts and on a timer, as the app's does.
   * Off by default: tests then decide when a session is refreshed.
   */
  autoRefreshToken?: boolean;
  /** The fakes the phone's Draft builds use (see `signInTestUser`). */
  fakes?: DraftFakes;
};

/**
 * The same new user signed in on `count` phones. Each phone has its own app (data layer), storage,
 * clock and signal, and its own auth client, which keeps its session in the phone's storage.
 * Behaviour tests reach the app only through `data`, as with `signInTestUser`.
 */
export async function signInOnPhones(
  label: string,
  count: number,
  { autoRefreshToken = false, fakes = {} }: PhoneOptions = {},
): Promise<TestPhone[]> {
  const account = await createTestAccount(label);
  return Promise.all(
    Array.from({ length: count }, async () => {
      let offline = false;
      type Fault = { status: number; json?: object };
      let fault: Fault | null = null;
      const faultsFor = new Map<string, Fault>();
      const faultFor = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = `${input instanceof Request ? input.url : String(input)} ${typeof init?.body === 'string' ? init.body : ''}`;
        for (const [text, f] of faultsFor) if (request.includes(text)) return f;
        return fault;
      };
      const holds = new Map<string, { reached(): void; released: Promise<void> }>();
      const sent: SentRequest[] = [];
      const fetchThroughSignal: typeof fetch = async (input, init) => {
        const request = `${input instanceof Request ? input.url : String(input)} ${typeof init?.body === 'string' ? init.body : ''}`;
        for (const [text, hold] of holds) {
          if (!request.includes(text)) continue;
          holds.delete(text);
          hold.reached();
          await hold.released;
        }
        if (offline) return Promise.reject(new TypeError('Network request failed'));
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        sent.push({
          user: userOfBearer(headers.get('Authorization')),
          path: new URL(input instanceof Request ? input.url : String(input)).pathname,
        });
        const f = faultFor(input, init);
        if (f?.json) {
          const headers = { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' };
          return Promise.resolve(new Response(JSON.stringify(f.json), { status: f.status, headers }));
        }
        if (f) return Promise.resolve(new Response(`Server error ${f.status}`, { status: f.status }));
        return fetch(input, init);
      };
      const network = {
        goOffline: () => void (offline = true),
        goOnline: () => void (offline = false),
        serverAnswers: (status: number | null) => void (fault = status === null ? null : { status }),
        serverAnswersFor: (text: string, status: number | null, json?: object) =>
          void (status === null ? faultsFor.delete(text) : faultsFor.set(text, { status, json })),
        holdNextRequest(text: string) {
          const reached = Promise.withResolvers<void>();
          const released = Promise.withResolvers<void>();
          holds.set(text, { reached: reached.resolve, released: released.promise });
          return { reached: reached.promise, release: released.resolve };
        },
        requestsMade: () => [...sent],
      };
      const first = createPhone(new Map(), new Map());
      await first.data.signInWithPassword(account);
      const userId = (await first.data.getMyProfile()).id;

      async function revokeSessions() {
        const db = new pg.Client({ connectionString: inject('supabase').dbUrl });
        await db.connect();
        try {
          await db.query('delete from auth.sessions where user_id = $1', [userId]);
        } finally {
          await db.end();
        }
      }

      function createPhone(
        items: Map<string, string>,
        authItems: Map<string, string>,
      ): Omit<TestPhone, 'userId' | 'account'> {
        let clock: number | null = null;
        const storage: KeyValueStorage = {
          getItem: async (key) => items.get(key) ?? null,
          setItem: async (key, value) => void items.set(key, value),
          removeItem: async (key) => void items.delete(key),
        };
        const sessionStorage = createSessionStorage(authStorageOn(authItems));
        let slowRead: { reached(): void; released: Promise<void> } | null = null;
        let readAfterSave: { saved: boolean; reached(): void; released: Promise<void> } | null = null;
        const authClientStorage = {
          ...sessionStorage,
          async setItem(key: string, value: string) {
            await sessionStorage.setItem(key, value);
            if (key.endsWith('-auth-token') && readAfterSave) readAfterSave.saved = true;
          },
          async getItem(key: string) {
            const held = key.endsWith('-auth-token') && readAfterSave?.saved ? readAfterSave : null;
            if (held) {
              readAfterSave = null;
              held.reached();
              await held.released;
            }
            const value = await sessionStorage.getItem(key);
            const slow = key.endsWith('-auth-token') ? slowRead : null;
            if (slow) {
              slowRead = null;
              slow.reached();
              await slow.released;
            }
            return value;
          },
        };
        const client = createTestClient(fetchThroughSignal, authClientStorage, { autoRefreshToken });
        const { drafts, startDraftBuild } = inProcessDraftBuilds(fakes);
        const data = createDataLayer(client, {
          storage,
          sessionStorage,
          now: () => (clock === null ? Date.now() : clock),
          startDraftBuild,
        });
        return {
          data,
          drafts,
          ...network,
          setClock: (at) => void (clock = at.getTime()),
          saved: () => new Map(items),
          savedAuth: () => new Map(authItems),
          overwriteSaved: (key, value) => void items.set(key, value),
          expireAccessToken: () => expireSavedSession(authItems),
          revokeSessions,
          slowNextSessionRead() {
            const reached = Promise.withResolvers<void>();
            const released = Promise.withResolvers<void>();
            slowRead = { reached: reached.resolve, released: released.promise };
            return { reached: reached.promise, release: released.resolve };
          },
          holdSessionReadAfterNextSave() {
            const reached = Promise.withResolvers<void>();
            const released = Promise.withResolvers<void>();
            readAfterSave = { saved: false, reached: reached.resolve, released: released.promise };
            return { reached: reached.promise, release: released.resolve };
          },
          relaunch: (saved, savedAuth) => ({
            userId,
            account,
            ...createPhone(new Map(saved ?? items), new Map(savedAuth ?? authItems)),
          }),
        };
      }
      return { userId, account, ...first };
    }),
  );
}
