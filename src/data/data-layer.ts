import type { AuthError, PostgrestError, Session, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import {
  DataError,
  parseUserId,
  type IdTokenProvider,
  type Profile,
  type SessionState,
  type UserId,
} from './types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

function toProfile(row: ProfileRow): Profile {
  return { id: parseUserId(row.id), username: row.username, createdAt: row.created_at };
}

function toSessionState(session: Session | null): SessionState {
  return session ? { status: 'signedIn', userId: parseUserId(session.user.id) } : { status: 'signedOut' };
}

function fail(error: AuthError | PostgrestError): never {
  throw new DataError(error.code ?? 'unknown', error.message, { cause: error });
}

export function createDataLayer(client: SupabaseClient<Database>) {
  async function currentUserId(): Promise<UserId> {
    const { data, error } = await client.auth.getSession();
    if (error) fail(error);
    if (!data.session) throw new DataError('not_signed_in', 'No user is signed in.');
    return parseUserId(data.session.user.id);
  }

  async function signInWithIdToken(input: {
    provider: IdTokenProvider;
    token: string;
    nonce?: string;
  }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithIdToken(input);
    if (error) fail(error);
    return parseUserId(data.user.id);
  }

  async function signInWithPassword(input: { email: string; password: string }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithPassword(input);
    if (error) fail(error);
    return parseUserId(data.user.id);
  }

  async function signOut(): Promise<void> {
    const { error } = await client.auth.signOut();
    if (error) fail(error);
  }

  function onSessionChange(cb: (state: SessionState) => void): () => void {
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(toSessionState(session)));
    return () => data.subscription.unsubscribe();
  }

  async function getProfile(id: UserId): Promise<Profile | null> {
    const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) fail(error);
    return data ? toProfile(data) : null;
  }

  async function getMyProfile(): Promise<Profile> {
    const id = await currentUserId();
    const profile = await getProfile(id);
    if (!profile) throw new DataError('profile_missing', `No Profile for user ${id}.`);
    return profile;
  }

  return {
    signInWithIdToken,
    signInWithPassword,
    signOut,
    onSessionChange,
    getMyProfile,
    getProfile,
  };
}

export type DataLayer = ReturnType<typeof createDataLayer>;
