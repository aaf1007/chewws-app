import pg from 'pg';
import { inject } from 'vitest';

import { createDataLayer, type DataLayer, type IngredientId, type KeyValueStorage, type UserId } from '../src/data';
import { createTestAccount, createTestClient, signInAttacker } from './access-harness';

export type TestUser = { userId: UserId; data: DataLayer };

/** A fresh signed-in user. Behaviour tests reach the app only through `data`, its data-layer actions. */
export async function signInTestUser(label = 'user'): Promise<TestUser> {
  const { userId, data } = await signInAttacker(label);
  return { userId, data };
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

/**
 * For race tests only: a second database session that starts making the user's Shopping List line
 * for an Ingredient and doesn't commit. Until `release()`, anything of theirs that writes that line
 * waits at it, so a test can run another action while the first is stopped there.
 */
export async function holdShoppingListLine(user: TestUser, ingredientId: IngredientId): Promise<HeldLine> {
  const session = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await session.connect();
  await session.query('begin');
  await session.query(
    `insert into public.shopping_list_items (list_id, ingredient_id)
     select l.id, $2 from public.shopping_lists l where l.owner_id = $1`,
    [user.userId, ingredientId],
  );
  const { rows } = await session.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0].pid;
  let released = false;

  return {
    async waitForWaiting(count) {
      const deadline = Date.now() + 10_000;
      while (!released) {
        const waiting = await session.query<{ count: number }>(WAITING_ON, [pid]);
        if (waiting.rows[0].count >= count) return;
        if (Date.now() > deadline) throw new Error(`Fewer than ${count} sessions waited on the held line.`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async release() {
      released = true;
      await session.query('rollback');
      await session.end();
    },
  };
}

/** What a phone's app has saved: its storage's keys and values. */
export type SavedOnPhone = ReadonlyMap<string, string>;

export type TestPhone = TestUser & {
  /** No signal: every request fails as it would in the app. */
  goOffline(): void;
  goOnline(): void;
  /** Sets the phone's clock; list changes made from now on are stamped from it. */
  setClock(at: Date): void;
  /** A copy of what the app has saved on this phone. */
  saved(): SavedOnPhone;
  /** Writes into the app's storage, as an older app version or a cut-short write might have. */
  overwriteSaved(key: string, value: string): void;
  /** The app started again on this phone, still signed in, from what it saved (or from `saved`). */
  relaunch(saved?: SavedOnPhone): TestPhone;
};

/**
 * The same new user signed in on `count` phones. Each phone has its own app (data layer), storage,
 * clock and signal. Behaviour tests reach the app only through `data`, as with `signInTestUser`.
 */
export async function signInOnPhones(label: string, count: number): Promise<TestPhone[]> {
  const account = await createTestAccount(label);
  return Promise.all(
    Array.from({ length: count }, async () => {
      let offline = false;
      const fetchThroughSignal: typeof fetch = (input, init) =>
        offline ? Promise.reject(new TypeError('Network request failed')) : fetch(input, init);
      const client = createTestClient(fetchThroughSignal);
      const network = { goOffline: () => void (offline = true), goOnline: () => void (offline = false) };
      const first = createPhone(client, network, new Map());
      await first.data.signInWithPassword(account);
      const userId = (await first.data.getMyProfile()).id;

      function createPhone(
        phoneClient: typeof client,
        signal: typeof network,
        items: Map<string, string>,
      ): Omit<TestPhone, 'userId'> {
        let clock: number | null = null;
        const storage: KeyValueStorage = {
          getItem: async (key) => items.get(key) ?? null,
          setItem: async (key, value) => void items.set(key, value),
        };
        const data = createDataLayer(phoneClient, {
          storage,
          now: () => (clock === null ? Date.now() : clock),
        });
        return {
          data,
          ...signal,
          setClock: (at) => void (clock = at.getTime()),
          saved: () => new Map(items),
          overwriteSaved: (key, value) => void items.set(key, value),
          relaunch: (saved) => ({ userId, ...createPhone(phoneClient, signal, new Map(saved ?? items)) }),
        };
      }
      return { userId, ...first };
    }),
  );
}
