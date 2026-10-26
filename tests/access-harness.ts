// Only for access-rule tests (`tests/*.access.test.ts`; lint enforces it): signs a user in and hands
// back their raw Supabase client, as an attacker would hold it, to call PostgREST directly.
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { inject, onTestFinished } from 'vitest';

import { createDataLayer, createSessionStorage, type AuthStorage, type DataLayer, type UserId } from '../src/data';
import type { Database } from '../src/data/database.types';

const { url, anonKey, serviceRoleKey } = inject('supabase');

const nodeAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const admin = createClient<Database>(url, serviceRoleKey, { auth: nodeAuth });

export type Attacker = {
  userId: UserId;
  data: DataLayer;
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

export async function signInAttacker(label = 'user'): Promise<Attacker> {
  const account = await createTestAccount(label);
  const sessionStorage = createSessionStorage(memoryAuthStorage());
  const client = createTestClient(undefined, sessionStorage);
  const data = createDataLayer(client, { sessionStorage });
  const userId = await data.signInWithPassword(account);
  return { userId, data, client };
}
