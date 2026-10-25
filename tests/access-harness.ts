// Only for access-rule tests (`tests/*.access.test.ts`; lint enforces it): signs a user in and hands
// back their raw Supabase client, as an attacker would hold it, to call PostgREST directly.
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

import { createDataLayer, type DataLayer, type UserId } from '../src/data';
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

export async function signInAttacker(label = 'user'): Promise<Attacker> {
  const email = `${label}-${randomUUID()}@test.local`;
  const password = randomUUID();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const client = createClient<Database>(url, anonKey, { auth: nodeAuth });
  const data = createDataLayer(client);
  const userId = await data.signInWithPassword({ email, password });
  return { userId, data, client };
}
