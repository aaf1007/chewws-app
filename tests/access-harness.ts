// Only for access-rule tests (`tests/*.access.test.ts`; lint enforces it): signs a user in and hands
// back their raw Supabase client, as an attacker would hold it, to call PostgREST directly.
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { inject, onTestFinished } from 'vitest';

import { createDataLayer, createSessionStorage, type AuthStorage, type DataLayer, type UserId } from '../src/data';
import type { Database } from '../src/data/database.types';
import type { Extract } from '../supabase/functions/_shared/claude-extractor';
import { buildDraft, type BuildOutcome, type Rpc } from '../supabase/functions/_shared/draft-builder';
import { fixtureAdapters, fixtureExtract } from '../supabase/functions/_shared/draft-fixtures';
import { createSourceReader, type SourceAdapters } from '../supabase/functions/_shared/source-reader';

const { url, anonKey, serviceRoleKey } = inject('supabase');

const nodeAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const admin = createClient<Database>(url, serviceRoleKey, { auth: nodeAuth });

/** The Draft builder's database calls, as the build-draft function makes them: as the service role. */
const serviceRpc: Rpc = async (fn, args) => {
  // Untyped, as the builder's `Rpc` is: it names its functions and checks what they return itself.
  const service = createClient(url, serviceRoleKey, { auth: nodeAuth });
  const { data, error } = await service.rpc(fn, args);
  if (error) throw error;
  return data;
};

/**
 * The fake boundary for Draft builds (spec, Testing Decisions): the TikTok adapter and the Claude
 * call. By default, the canned videos and answers in supabase/functions/_shared/draft-fixtures.ts.
 */
export type DraftFakes = {
  tiktok?: SourceAdapters['tiktok'];
  extract?: Extract;
  /** This many of the app's kicks are lost on the way (no signal), starting no build. */
  loseKicks?: number;
};

/** The Draft builds a user's app started, run in-process with the fakes instead of build-draft. */
export type DraftBuilds = {
  /** Resolves once every build started so far (and any they lead to) has finished. */
  settled(): Promise<void>;
  /** Runs another build of `recipeId` now, as a second kick of build-draft would. */
  build(recipeId: string): Promise<BuildOutcome>;
};

export function inProcessDraftBuilds(fakes: DraftFakes = {}) {
  const readSource = createSourceReader({ tiktok: fakes.tiktok ?? fixtureAdapters.tiktok }).read;
  const extract = fakes.extract ?? fixtureExtract;
  const running = new Set<Promise<unknown>>();
  const build = (recipeId: string) => {
    const done = buildDraft(recipeId, { rpc: serviceRpc, readSource, extract });
    running.add(done);
    void done.finally(() => running.delete(done)).catch(() => {});
    return done;
  };
  const drafts: DraftBuilds = {
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
    build,
  };
  // The app's kick settles once the build has started; the build goes on in the background.
  let kicksToLose = fakes.loseKicks ?? 0;
  const startDraftBuild = async (recipeId: string) => {
    if (kicksToLose > 0) {
      kicksToLose -= 1;
      throw new TypeError('Network request failed');
    }
    void build(recipeId);
  };
  return { drafts, startDraftBuild };
}

export type Attacker = {
  userId: UserId;
  data: DataLayer;
  /** The Draft builds this user's saves started, run in-process. */
  drafts: DraftBuilds;
  /** The user's own signed-in client (anon key + their session). */
  client: SupabaseClient<Database>;
};

export type TestAccount = { email: string; password: string };

/** A fresh confirmed account, not yet signed in anywhere. */
export async function createTestAccount(label = 'user'): Promise<TestAccount> {
  const email = `${label}-${randomUUID()}@test.local`;
  const password = randomUUID();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { email, password };
}

/**
 * A raw client for the local stack whose requests go through `fetch`. With `authStorage`, it keeps
 * its session there, as the app does in AsyncStorage, so a new client on the same storage starts
 * signed in from it. With `autoRefreshToken`, it refreshes its session when it starts and on a
 * timer, as the app's does; the timer stops when the test ends.
 */
export function createTestClient(
  fetch?: typeof globalThis.fetch,
  authStorage?: SupportedStorage,
  { autoRefreshToken = false }: { autoRefreshToken?: boolean } = {},
): SupabaseClient<Database> {
  const auth = authStorage ? { ...nodeAuth, persistSession: true, storage: authStorage, autoRefreshToken } : nodeAuth;
  const client = createClient<Database>(url, anonKey, { auth, global: fetch ? { fetch } : {} });
  if (autoRefreshToken) onTestFinished(() => client.auth.stopAutoRefresh());
  return client;
}

/** Where a client that isn't on a phone keeps its session: in memory, for as long as the test. */
function memoryAuthStorage(): AuthStorage {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
}

export async function signInAttacker(label = 'user', fakes: DraftFakes = {}): Promise<Attacker> {
  const account = await createTestAccount(label);
  const sessionStorage = createSessionStorage(memoryAuthStorage());
  const client = createTestClient(undefined, sessionStorage);
  const { drafts, startDraftBuild } = inProcessDraftBuilds(fakes);
  const data = createDataLayer(client, { sessionStorage, startDraftBuild });
  const userId = await data.signInWithPassword(account);
  return { userId, data, drafts, client };
}
