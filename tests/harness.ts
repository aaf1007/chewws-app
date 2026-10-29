import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import {
  createDataLayer,
  createSessionStorage,
  parseUserId,
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
  inProcessNotifications,
  inProcessSourceRefresh,
  signInAttacker,
  type DraftBuilds,
  type DraftFakes,
  type Notifications,
  type TestAccount,
} from './access-harness';

export type { DraftBuilds, DraftFakes, Notifications };

export type TestUser = { userId: UserId; data: DataLayer; drafts: DraftBuilds; notifications: Notifications };

/**
 * A fresh signed-in user. Behaviour tests reach the app only through `data`, its data-layer
 * actions. Their saved links build in-process with `fakes` (canned TikTok videos and Claude
 * answers by default), with no network; `drafts.settled()` waits for those builds.
 */
export async function signInTestUser(label = 'user', fakes: DraftFakes = {}): Promise<TestUser> {
  const { userId, data, drafts, notifications } = await signInAttacker(label, fakes);
  return { userId, data, drafts, notifications };
}

/**
 * A username no other test, nor an earlier run on the same database, has: `stem` (at most 10
 * characters, lowercase letters, digits or _) and 9 random hex digits.
 */
export function uniqueUsername(stem = 'user'): string {
  return `${stem.slice(0, 10)}_${randomUUID().replaceAll('-', '').slice(0, 9)}`;
}

/** A fresh signed-in user who has chosen a username (`uniqueUsername(stem)`). */
export async function signInWithUsername(
  stem: string,
  fakes: DraftFakes = {},
): Promise<TestUser & { username: string }> {
  const user = await signInTestUser(stem, fakes);
  const result = await user.data.setUsername(uniqueUsername(stem));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return { ...user, username: result.username };
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
async function holdInTransaction(sql: string, params: unknown[], before: [string, unknown[]][] = []) {
  const session = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await session.connect();
  await session.query('begin');
  for (const [first, firstParams] of before) await session.query(first, firstParams);
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
 * For race tests only: a second database session that saves a link as the user, through
 * save_from_link as the app calls it, and doesn't commit yet. Until `commit()`, another save of
 * theirs that waits for it shows up in `waitForWaiting`; one that doesn't wait doesn't.
 */
export async function holdLinkSave(user: Pick<TestUser, 'userId'>, url: string): Promise<HeldRemoval> {
  const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' });
  const { waitForWaiting, commit } = await holdInTransaction(
    `select public.save_from_link(gen_random_uuid(), $1, 'tiktok')`,
    [url],
    [
      ["select set_config('request.jwt.claims', $1, true)", [claims]],
      ['set local role authenticated', []],
    ],
  );
  return { waitForWaiting, commit };
}

/**
 * For race tests only: a second database session that makes one call as the user, signed in, as
 * the app would, and doesn't commit yet. Until `commit()`, whatever waits on what it holds (a row,
 * a lock) shows up in `waitForWaiting`.
 */
async function holdCallAs(user: Pick<TestUser, 'userId'>, sql: string, params: unknown[]): Promise<HeldRemoval> {
  const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' });
  const { waitForWaiting, commit } = await holdInTransaction(sql, params, [
    ["select set_config('request.jwt.claims', $1, true)", [claims]],
    ['set local role authenticated', []],
  ]);
  return { waitForWaiting, commit };
}

type Someone = Pick<TestUser, 'userId'>;

/** For race tests only: `user` choosing `username` on another phone, not committed yet. */
export const holdUsernameChoice = (user: Someone, username: string) =>
  holdCallAs(user, 'select public.set_username($1)', [username]);

/** For race tests only: `user` asking `other` to be Friends on another phone, not committed yet. */
export const holdFriendRequest = (user: Someone, other: Someone) =>
  holdCallAs(user, 'select public.send_friend_request($1)', [other.userId]);

/** For race tests only: `user` answering `requester`'s request on another phone, not committed yet. */
export const holdFriendRequestAnswer = (user: Someone, requester: Someone, accept: boolean) =>
  holdCallAs(user, 'select public.respond_to_friend_request($1, $2)', [requester.userId, accept]);

/** For race tests only: `user` withdrawing their request to `other` on another phone, not committed yet. */
export const holdFriendRequestCancel = (user: Someone, other: Someone) =>
  holdCallAs(user, 'select public.cancel_friend_request($1)', [other.userId]);

/** For race tests only: `user` unfriending `other` on another phone, not committed yet. */
export const holdUnfriend = (user: Someone, other: Someone) =>
  holdCallAs(user, 'select public.unfriend($1)', [other.userId]);

/** For race tests only: `owner` sharing their Shopping List with `friend` on another phone, not committed yet. */
export const holdShare = (owner: Someone, friend: Someone) =>
  holdCallAs(owner, 'select public.share_shopping_list($1)', [friend.userId]);

/** For race tests only: `owner` stopping sharing with `friend` on another phone, not committed yet. */
export const holdStopSharing = (owner: Someone, friend: Someone) =>
  holdCallAs(owner, 'select public.stop_sharing_shopping_list($1)', [friend.userId]);

/** For race tests only: `friend` leaving a list shared with them on another phone, not committed yet. */
export const holdLeave = (friend: Someone, listId: string) =>
  holdCallAs(friend, 'select public.leave_shared_shopping_list($1)', [listId]);

/** For race tests only: `user` checking an item off on another phone, not committed yet. */
export const holdCheckOff = (user: Someone, itemId: string) =>
  holdCallAs(user, 'select public.check_off($1)', [itemId]);

/**
 * The two stop being Friends, as `unfriend` does, but with the database's own triggers held back,
 * as if the one that ends their Shopping List shares hadn't run yet: the share rows are still
 * there. For proving access ends with the Friendship itself.
 */
export async function endFriendshipBeforeCleanup(a: Someone, b: Someone): Promise<void> {
  const db = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await db.connect();
  try {
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    const { rowCount } = await db.query(
      `delete from public.friendships
       where least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
         and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
      [a.userId, b.userId],
    );
    if (rowCount !== 1) throw new Error(`No Friendship between ${a.userId} and ${b.userId} to end.`);
    await db.query('commit');
  } finally {
    await db.end();
  }
}

/** How many share rows a Shopping List has, whatever the rules say about them. */
export async function countShares(owner: Someone): Promise<number> {
  const rows = await asDatabaseOwner<{ count: number }>(
    `select count(*)::int as count from public.shopping_list_shares s
     join public.shopping_lists l on l.id = s.list_id where l.owner_id = $1`,
    [owner.userId],
  );
  return rows[0].count;
}

/** Runs one statement on the database as its owner, for the few things no action can reach. */
async function asDatabaseOwner<T extends pg.QueryResultRow>(sql: string, params: unknown[]) {
  const db = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.end();
  }
}

/** How many link saves a user has made (ticket 07 counts them for the daily limit). */
export async function countLinkSaves(user: Pick<TestUser, 'userId'>): Promise<number> {
  const rows = await asDatabaseOwner<{ count: number }>(
    'select count(*)::int as count from public.link_saves where user_id = $1',
    [user.userId],
  );
  return rows[0].count;
}

/**
 * Link saves the user made at these times, as if they had saved links then (ticket 07's daily
 * limit counts them), with no Draft for them: quicker than saving each one.
 */
export async function seedLinkSaves(user: Pick<TestUser, 'userId'>, times: Date[]): Promise<void> {
  await asDatabaseOwner(
    'insert into public.link_saves (user_id, saved_at) select $1, unnest($2::timestamptz[])',
    [user.userId, times.map((t) => t.toISOString())],
  );
}

/** Every link save the user has made happened `hours` earlier than it did, as if that time had passed. */
export async function backdateLinkSaves(user: Pick<TestUser, 'userId'>, hours: number): Promise<void> {
  await asDatabaseOwner(
    'update public.link_saves set saved_at = saved_at - make_interval(hours => $2) where user_id = $1',
    [user.userId, hours],
  );
}

/** The Draft's current build was claimed `minutes` ago, as if it had been running that long. */
export async function backdateDraftBuild(recipeId: string, minutes: number): Promise<void> {
  await asDatabaseOwner(
    `update public.recipes set build_started_at = now() - make_interval(mins => $2)
     where id = $1 and build_started_at is not null`,
    [recipeId, minutes],
  );
}

/** The Recipe's Source Video was last read from its platform `days` ago. */
export async function backdateSourceVideo(recipeId: string, days: number): Promise<void> {
  await asDatabaseOwner(
    `update public.source_videos set fetched_at = now() - make_interval(days => $2) where recipe_id = $1`,
    [recipeId, days],
  );
}

/** The last refresh of the Recipe's Source Video was asked for `minutes` ago. */
export async function backdateSourceRefresh(recipeId: string, minutes: number): Promise<void> {
  await asDatabaseOwner(
    `update public.source_videos set refresh_requested_at = now() - make_interval(mins => $2) where recipe_id = $1`,
    [recipeId, minutes],
  );
}

/**
 * `count` fresh users, not signed in anywhere, who have chosen usernames starting with `stem`
 * (`uniqueUsername`); quicker than signing each in. For tests that need many people to ask.
 */
export async function seedUsersWithUsernames(
  stem: string,
  count: number,
): Promise<{ userId: UserId; username: string; account: TestAccount }[]> {
  const accounts = await Promise.all(Array.from({ length: count }, () => createTestAccount(stem)));
  const rows = await asDatabaseOwner<{ id: string; username: string; email: string }>(
    `update public.profiles p set username = n.username
     from unnest($1::text[], $2::text[]) as n (email, username)
     join auth.users u on u.email = n.email
     where p.id = u.id
     returning p.id, p.username, u.email`,
    [accounts.map((a) => a.email), accounts.map(() => uniqueUsername(stem))],
  );
  return accounts.map((account) => {
    const row = rows.find((r) => r.email === account.email);
    if (!row) throw new Error(`No Profile for ${account.email}`);
    return { userId: parseUserId(row.id), username: row.username, account };
  });
}

/** Every "Friend request" push between the two (either way) was sent `days` earlier than it was. */
export async function backdateFriendRequestPushes(
  a: Pick<TestUser, 'userId'>,
  b: Pick<TestUser, 'userId'>,
  days: number,
): Promise<void> {
  await asDatabaseOwner(
    `update private.friend_request_pushes set sent_at = sent_at - make_interval(days => $3)
     where (requester_id, addressee_id) in (($1, $2), ($2, $1))`,
    [a.userId, b.userId, days],
  );
}

/**
 * The database functions (public and private) that decide for themselves whether a friendship is
 * accepted, comparing its status with 'accepted' instead of asking private.are_friends or
 * private.friend_ids (decisions 11: one Friend rule). Setting a status is not deciding.
 */
export async function functionsRestatingTheFriendRule(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname <> 'are_friends'
       and p.prosrc ~* $1
     order by 1`,
    ["(?<!set )status\\s*(=\\s*'accepted'|in\\s*\\([^)]*'accepted')"],
  );
  return rows.map((r) => r.name);
}

/**
 * The database functions (public and private) that decide for themselves who may use a shared
 * Shopping List, reading `shopping_list_shares` and calling private.are_friends, instead of asking
 * private.can_use_shopping_list (decisions 13: one rule for who may use a list).
 */
export async function functionsRestatingTheShareRule(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname <> 'can_use_shopping_list'
       and p.prosrc ~* $1
       and p.prosrc ~* 'are_friends'
     order by 1`,
    ['(from|join)\\s+(public\\.)?shopping_list_shares'],
  );
  return rows.map((r) => r.name);
}

/** Runs the daily job that drops YouTube data over 30 days old, now (pg_cron runs it at 03:17). */
export async function runYouTubeExpiryJob(): Promise<void> {
  await asDatabaseOwner('select private.expire_youtube_source_data()', []);
}

/** The jobs pg_cron runs. */
export async function scheduledJobs(): Promise<{ jobname: string; schedule: string; command: string }[]> {
  return asDatabaseOwner('select jobname, schedule, command from cron.job order by jobname', []);
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
  /**
   * The phone's next request that names `text` reaches the server and is carried out, but its
   * answer is lost on the way back (the signal drops): the phone sees a network failure.
   */
  loseNextAnswer(text: string): void;
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
      const answersToLose = new Set<string>();
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
        const lost = [...answersToLose].find((text) => request.includes(text));
        if (lost !== undefined) {
          answersToLose.delete(lost);
          await fetch(input, init);
          throw new TypeError('Network request failed');
        }
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
        loseNextAnswer: (text: string) => void answersToLose.add(text),
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
        const { notifications, sendNotification } = inProcessNotifications(client, fakes);
        const data = createDataLayer(client, {
          storage,
          sessionStorage,
          now: () => (clock === null ? Date.now() : clock),
          startDraftBuild,
          refreshSourceVideo: inProcessSourceRefresh(client, fakes),
          sendNotification,
        });
        return {
          data,
          drafts,
          notifications,
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

/** For race tests only: `user` inviting `friend` into a Cook Plan on another phone, not committed yet. */
export const holdCookPlanInvite = (user: Someone, planId: string, friend: Someone) =>
  holdCallAs(user, 'select public.invite_to_cook_plan($1, $2)', [planId, friend.userId]);

/** For race tests only: `user` adding their Recipe to a Cook Plan on another phone, not committed yet. */
export const holdCookPlanRecipeAdd = (user: Someone, planId: string, recipeId: string) =>
  holdCallAs(user, 'select public.add_recipe_to_cook_plan($1, $2)', [planId, recipeId]);

/** For race tests only: `user` leaving a Cook Plan on another phone, not committed yet. */
export const holdCookPlanLeave = (user: Someone, planId: string) =>
  holdCallAs(user, 'select public.leave_cook_plan($1)', [planId]);

/**
 * `user` and each of `others` are Friends, as if each had asked and been accepted; quicker than
 * asking each. For tests that need many Friends (a Cook Plan's 8 members).
 */
export async function seedFriendships(user: Someone, others: Someone[]): Promise<void> {
  await asDatabaseOwner(
    `insert into public.friendships (requester_id, addressee_id, status, responded_at)
     select $1, other, 'accepted', now() from unnest($2::uuid[]) as other`,
    [user.userId, others.map((o) => o.userId)],
  );
}

/** Whether a Cook Plan still exists, whoever may see it. */
export async function cookPlanExists(planId: string): Promise<boolean> {
  const rows = await asDatabaseOwner<{ found: boolean }>(
    'select exists (select 1 from public.cook_plans where id = $1) as found',
    [planId],
  );
  return rows[0].found;
}

/**
 * A Recipe's Source Video as stored, whoever may see it: when it was last read from its platform
 * (decisions 04), and two of the things the 30-day YouTube job clears.
 */
export async function sourceVideoOf(
  recipeId: string,
): Promise<{ fetchedAt: string | null; creatorName: string | null; caption: string | null }> {
  const rows = await asDatabaseOwner<{ fetched_at: Date | null; creator_name: string | null; caption: string | null }>(
    'select fetched_at, creator_name, caption from public.source_videos where recipe_id = $1',
    [recipeId],
  );
  if (rows.length === 0) throw new Error(`Recipe ${recipeId} has no Source Video.`);
  const [row] = rows;
  return { fetchedAt: row.fetched_at?.toISOString() ?? null, creatorName: row.creator_name, caption: row.caption };
}

/**
 * The membership rule itself (decisions 14): private.is_cook_plan_member, and cook_plan_ids, its
 * list form. Only these may match a user against `cook_plan_members`.
 */
const MEMBERSHIP_RULE = ['is_cook_plan_member', 'cook_plan_ids'];

/**
 * The database functions (public and private), other than the membership rule's own, that match a
 * user against `cook_plan_members` themselves (decisions 14: one membership rule), whatever else
 * they ask. Removing your own row (`delete from`) is not deciding.
 */
export async function functionsRestatingTheMembershipRule(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and not (n.nspname = 'private' and p.proname = any ($2))
       and p.prosrc ~* $1
       and p.prosrc ~* 'user_id\\s*='
     order by 1`,
    ['(?<!delete )(from|join)\\s+(public\\.)?cook_plan_members', MEMBERSHIP_RULE],
  );
  return rows.map((r) => r.name);
}

/**
 * The functions allowed to read which Cook Plans a Recipe is in and compare its owner: the Recipe
 * read rule itself, and adding a Recipe to a plan, which compares the owner to decide who may add
 * it (only its owner), not who may read it.
 */
const RECIPE_READ_RULE = ['private.can_read_recipe', 'public.add_recipe_to_cook_plan'];

/**
 * The database functions (public and private), other than those above, that read which Cook Plans
 * a Recipe is in and compare its owner, so deciding for themselves who may read it, instead of
 * asking private.can_read_recipe (decisions 14: one rule for reading another user's Recipe).
 */
export async function functionsRestatingTheRecipeReadRule(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and not (n.nspname || '.' || p.proname = any ($2))
       and p.prosrc ~* $1
       and p.prosrc ~* 'owner_id\\s*='
     order by 1`,
    ['(from|join)\\s+(public\\.)?cook_plan_recipes', RECIPE_READ_RULE],
  );
  return rows.map((r) => r.name);
}

/**
 * Every row-level policy that reads `cook_plan_members` itself instead of asking
 * private.is_cook_plan_member, as `table: policy name`.
 */
export async function policiesRestatingTheMembershipRule(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select schemaname || '.' || tablename || ': ' || policyname as name from pg_policies
     where coalesce(qual, '') ~* 'cook_plan_members' or coalesce(with_check, '') ~* 'cook_plan_members'
     order by 1`,
    [],
  );
  return rows.map((r) => r.name);
}

/** The select policies on a Recipe's lines and Source Video, as `table: using` (on one line). */
export async function recipePartReadPolicies(): Promise<string[]> {
  const rows = await asDatabaseOwner<{ name: string }>(
    `select tablename || ': ' || regexp_replace(qual, '\\s+', ' ', 'g') as name from pg_policies
     where schemaname = 'public' and tablename in ('recipe_lines', 'source_videos') and cmd in ('SELECT', 'ALL')
     order by 1`,
    [],
  );
  return rows.map((r) => r.name);
}
