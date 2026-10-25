import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

import { createDataLayer, type DataLayer, type UserId } from '../src/data';
import type { Database } from '../src/data/database.types';

const { url, anonKey, serviceRoleKey } = inject('supabase');

const nodeAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const admin = createClient<Database>(url, serviceRoleKey, { auth: nodeAuth });

export type TestUser = {
  userId: UserId;
  data: DataLayer;
  /**
   * The user's own signed-in Supabase client (anon key + their session), as an attacker would
   * hold it. Only for access-rule tests in `tests/*.access.test.ts`; behaviour tests use `data`.
   */
  attackerClient: SupabaseClient<Database>;
};

export async function signInTestUser(label = 'user'): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@test.local`;
  const password = randomUUID();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const client = createClient<Database>(url, anonKey, { auth: nodeAuth });
  const data = createDataLayer(client);
  const userId = await data.signInWithPassword({ email, password });
  return { userId, data, attackerClient: client };
}
