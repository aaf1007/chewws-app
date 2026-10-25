import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';

import { createDataLayer } from './data-layer';
import type { Database } from './database.types';

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !anonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.',
  );
}

/**
 * A request with no answer after this long counts as no signal. With no signal at all a request
 * usually fails at once; this covers a connection that goes nowhere.
 */
const REQUEST_TIMEOUT_MS = 8_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  init?.signal?.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const client = createClient<Database>(supabaseUrl, anonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const data = createDataLayer(client, { storage: AsyncStorage, newId: Crypto.randomUUID });

// Refreshing tokens on a timer only makes sense while the app is in the foreground. Coming back to
// it is also when list changes made with no signal get another try.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    client.auth.startAutoRefresh();
    void data.syncListChanges();
  } else {
    client.auth.stopAutoRefresh();
  }
});

/** How often list changes waiting on the phone are tried again. Does nothing online with none waiting. */
const LIST_SYNC_INTERVAL_MS = 10_000;
setInterval(() => {
  if (AppState.currentState === 'active') void data.syncListChanges();
}, LIST_SYNC_INTERVAL_MS);
