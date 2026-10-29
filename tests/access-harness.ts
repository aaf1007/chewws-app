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
import { notify, type NotifierRpc, type NotifyRequest } from '../supabase/functions/_shared/notifier';
import { recordingPushSender, type PushMessage, type PushSender } from '../supabase/functions/_shared/push-sender';
import { screenshotLoader } from '../supabase/functions/_shared/screenshot';
import { refreshSourceVideo } from '../supabase/functions/_shared/source-refresher';
import { createSourceReader, type SourceAdapters } from '../supabase/functions/_shared/source-reader';

const { url, anonKey, serviceRoleKey } = inject('supabase');

const nodeAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const admin = createClient<Database>(url, serviceRoleKey, { auth: nodeAuth });

/** A database call as the Edge Functions make them: as the service role. */
async function asServiceRole(fn: string, args: Record<string, unknown>): Promise<unknown> {
  // Untyped, as the builder's `Rpc` is: it names its functions and checks what they return itself.
  const service = createClient(url, serviceRoleKey, { auth: nodeAuth });
  const { data, error } = await service.rpc(fn, args);
  if (error) throw error;
  return data;
}

/** The Draft builder's database calls, as the build-draft function makes them. */
const serviceRpc: Rpc = asServiceRole;

/**
 * The fake boundary for Draft builds (spec, Testing Decisions): the source adapters (TikTok,
 * YouTube, web pages) and the Claude call. By default, the canned videos, pages and answers in
 * supabase/functions/_shared/draft-fixtures.ts. Refreshing a Source Video reads the same fakes.
 */
export type DraftFakes = {
  tiktok?: SourceAdapters['tiktok'];
  youtube?: SourceAdapters['youtube'];
  page?: SourceAdapters['page'];
  extract?: Extract;
  /** This many of the app's kicks are lost on the way (no signal), starting no build. */
  loseKicks?: number;
  /** For race tests only: a build waits for this before it downloads the user's screenshot. */
  beforeScreenshotDownload?: () => Promise<void>;
  /** Push tokens the fake push service reports as no longer registered (DeviceNotRegistered). */
  unregisteredPushTokens?: string[];
  /** The push service can't be reached: every push fails to send. */
  pushFails?: boolean;
  /** This many of the app's notify kicks are lost on the way (no signal), sending nothing. */
  loseNotifyKicks?: number;
};

/** The Draft builds a user's app started, run in-process with the fakes instead of build-draft. */
export type DraftBuilds = {
  /** Resolves once every build started so far (and any they lead to) has finished. */
  settled(): Promise<void>;
  /** Runs another build of `recipeId` now, as a second kick of build-draft would. */
  build(recipeId: string): Promise<BuildOutcome>;
  /** Every push these builds sent, in order, through the recording push sender (none really goes). */
  pushesSent(): PushMessage[];
};

/** The fake adapters: the fixtures, with any of `fakes` in their place. */
const fakeAdapters = (fakes: DraftFakes): SourceAdapters => ({
  tiktok: fakes.tiktok ?? fixtureAdapters.tiktok,
  youtube: fakes.youtube ?? fixtureAdapters.youtube,
  page: fakes.page ?? fixtureAdapters.page,
});

/**
 * What the refresh-source-video function does, in-process with the fakes: it claims the refresh
 * as the user (`client`, their session), and stores what it read as the service role.
 */
export function inProcessSourceRefresh(client: SupabaseClient<Database>, fakes: DraftFakes = {}) {
  return async (recipeId: string) => {
    await refreshSourceVideo(recipeId, {
      claim: async (id) => {
        const { data, error } = await client.rpc('claim_source_refresh', { recipe_id: id });
        if (error) throw error;
        return data;
      },
      rpc: serviceRpc,
      adapters: fakeAdapters(fakes),
      signal: new AbortController().signal,
    });
  };
}

/** A screenshot the user added, downloaded as the build-draft function does: as the service role. */
const screenshotLoaderFor = (fakes: DraftFakes) =>
  screenshotLoader(async (path) => {
    await fakes.beforeScreenshotDownload?.();
    const { data, error } = await admin.storage.from('recipe-images').download(path);
    if (error) throw error;
    return data.arrayBuffer();
  });

export function inProcessDraftBuilds(fakes: DraftFakes = {}) {
  const readSource = createSourceReader(fakeAdapters(fakes)).read;
  const extract = fakes.extract ?? fixtureExtract;
  const loadScreenshot = screenshotLoaderFor(fakes);
  const push = recordingPushSender({ unregistered: fakes.unregisteredPushTokens });
  const sendPush: PushSender = fakes.pushFails
    ? async () => {
        throw new TypeError('fetch failed');
      }
    : push.send;
  const running = new Set<Promise<unknown>>();
  const build = (recipeId: string) => {
    const done = buildDraft(recipeId, { rpc: serviceRpc, readSource, extract, loadScreenshot, sendPush });
    running.add(done);
    void done.finally(() => running.delete(done)).catch(() => {});
    return done;
  };
  const drafts: DraftBuilds = {
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
    build,
    pushesSent: push.sent,
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

/** The pushes a user's actions sent other people (a "Friend request"), run in-process instead of notify. */
export type Notifications = {
  /** Every push sent, in order, through the recording push sender (none really goes). */
  pushesSent(): PushMessage[];
  /**
   * Kicks the notify function as this user, for anything, as a tampered app could; the server
   * decides whether a push is due.
   */
  kick(request: NotifyRequest): Promise<void>;
};

/**
 * What the notify function does, in-process with the recording push sender: it checks who is
 * asking from their session (`client`'s), and claims and sends the push as the service role.
 */
export function inProcessNotifications(client: SupabaseClient<Database>, fakes: DraftFakes = {}) {
  const push = recordingPushSender({ unregistered: fakes.unregisteredPushTokens });
  const sendPush: PushSender = fakes.pushFails
    ? async () => {
        throw new TypeError('fetch failed');
      }
    : push.send;
  const rpc: NotifierRpc = asServiceRole;
  let kicksToLose = fakes.loseNotifyKicks ?? 0;
  const sendNotification = async (request: NotifyRequest) => {
    if (kicksToLose > 0) {
      kicksToLose -= 1;
      throw new TypeError('Network request failed');
    }
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    await notify(data.user.id, request, { rpc, sendPush });
  };
  const notifications: Notifications = { pushesSent: push.sent, kick: sendNotification };
  return { notifications, sendNotification };
}

export type Attacker = {
  userId: UserId;
  data: DataLayer;
  /** The Draft builds this user's saves started, run in-process. */
  drafts: DraftBuilds;
  /** The pushes this user's actions sent others, run in-process. */
  notifications: Notifications;
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
  const { notifications, sendNotification } = inProcessNotifications(client, fakes);
  const data = createDataLayer(client, {
    sessionStorage,
    startDraftBuild,
    refreshSourceVideo: inProcessSourceRefresh(client, fakes),
    sendNotification,
  });
  const userId = await data.signInWithPassword(account);
  return { userId, data, drafts, notifications, client };
}
