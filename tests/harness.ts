import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

import { createDataLayer, type DataLayer, type UserId } from '../src/data';
import type { Database } from '../src/data/database.types';

const { url, anonKey, serviceRoleKey } = inject('supabase');

const nodeAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const admin = createClient<Database>(url, serviceRoleKey, { auth: nodeAuth });

export async function signInTestUser(label = 'user'): Promise<{ userId: UserId; data: DataLayer }> {
  const email = `${label}-${randomUUID()}@test.local`;
  const password = randomUUID();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const data = createDataLayer(createClient<Database>(url, anonKey, { auth: nodeAuth }));
  const userId = await data.signInWithPassword({ email, password });
  return { userId, data };
}
