import { data, supabaseUrl } from '@/data/app';
import { Button } from '@/ui';

// Seeded by supabase/seed.sql so the signed-in flow can be checked without Apple or Google credentials.
const DEV_USER = { email: 'dev@example.com', password: 'password123' };

const isLocalSupabase = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(supabaseUrl);

export function DevSignInButton({ onError }: { onError: (error: unknown) => void }) {
  if (!__DEV__ || !isLocalSupabase) return null;
  return (
    <Button
      label="Sign in as test user (dev)"
      variant="plain"
      icon="construct-outline"
      onPress={() => data.signInWithPassword(DEV_USER).catch(onError)}
    />
  );
}
