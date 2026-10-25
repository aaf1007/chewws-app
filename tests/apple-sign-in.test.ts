import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInAsync: vi.fn(),
  signInWithIdToken: vi.fn(),
}));

vi.mock('expo-apple-authentication', () => ({
  signInAsync: mocks.signInAsync,
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async () => 'hashed-nonce',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

vi.mock('@/data/app', () => ({
  data: { signInWithIdToken: mocks.signInWithIdToken },
}));

import { signInWithApple } from '@/auth/apple';

beforeEach(() => {
  mocks.signInAsync.mockReset();
  mocks.signInWithIdToken.mockReset().mockResolvedValue(undefined);
});

// expo-apple-authentication maps ASAuthorizationError.unknown (1000) to RequestUnknownException,
// which iOS raises when the user closes the "Sign in to your Apple Account" sheet.
test('closing the Apple Account sheet is a cancel, not an error', async () => {
  mocks.signInAsync.mockRejectedValue(
    Object.assign(new Error('The authorization attempt failed for an unknown reason'), {
      code: 'ERR_REQUEST_UNKNOWN',
    }),
  );

  await expect(signInWithApple()).resolves.toBe('cancelled');
  expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
});

test('a successful Apple sign-in hands the token and raw nonce to the data layer', async () => {
  mocks.signInAsync.mockResolvedValue({ identityToken: 'apple-id-token' });

  await expect(signInWithApple()).resolves.toBe('signedIn');
  expect(mocks.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
  expect(mocks.signInWithIdToken).toHaveBeenCalledWith({
    provider: 'apple',
    token: 'apple-id-token',
    nonce: 'raw-nonce',
  });
});
