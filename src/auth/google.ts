import { GoogleSignin, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';

import { data } from '@/data/app';

import { hasCode } from './errors';

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const googleNotConfiguredMessage =
  'Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.local, then rebuild the app.';

export const isGoogleConfigured = Boolean(iosClientId && webClientId);

if (iosClientId && webClientId) {
  GoogleSignin.configure({ iosClientId, webClientId });
}

export async function signInWithGoogle(): Promise<'signedIn' | 'cancelled'> {
  if (!isGoogleConfigured) throw new Error(googleNotConfiguredMessage);

  let response: Awaited<ReturnType<typeof GoogleSignin.signIn>>;
  try {
    response = await GoogleSignin.signIn();
  } catch (error) {
    if (hasCode(error, statusCodes.IN_PROGRESS)) return 'cancelled';
    throw error;
  }
  if (!isSuccessResponse(response)) return 'cancelled';
  if (!response.data.idToken) throw new Error('Google did not return an ID token.');

  await data.signInWithIdToken({ provider: 'google', token: response.data.idToken });
  return 'signedIn';
}
