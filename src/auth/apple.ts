import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { data } from '@/data/app';

import { hasCode } from './errors';

export async function signInWithApple(): Promise<'signedIn' | 'cancelled'> {
  // Apple embeds the hashed nonce in the ID token; Supabase hashes the raw one and compares.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    if (hasCode(error, 'ERR_REQUEST_CANCELED')) return 'cancelled';
    throw error;
  }

  if (!credential.identityToken) throw new Error('Apple did not return an identity token.');
  await data.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  return 'signedIn';
}
