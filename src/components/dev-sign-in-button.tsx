import { Pressable, StyleSheet, Text } from 'react-native';

import { data, supabaseUrl } from '@/data/app';

// Seeded by supabase/seed.sql so the signed-in flow can be checked without Apple or Google credentials.
const DEV_USER = { email: 'dev@example.com', password: 'password123' };

const isLocalSupabase = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(supabaseUrl);

export function DevSignInButton({ onError }: { onError: (error: unknown) => void }) {
  if (!__DEV__ || !isLocalSupabase) return null;
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.button}
      onPress={() => data.signInWithPassword(DEV_USER).catch(onError)}>
      <Text style={styles.label}>Sign in as test user (dev)</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#8a8a8a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, color: '#555' },
});
