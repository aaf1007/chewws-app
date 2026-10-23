import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
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

const client = createClient<Database>(supabaseUrl, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refreshing tokens on a timer only makes sense while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    client.auth.startAutoRefresh();
  } else {
    client.auth.stopAutoRefresh();
  }
});

export const data = createDataLayer(client);
