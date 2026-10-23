import { expect, test } from 'vitest';

import { signInTestUser } from './harness';

test('a new user has a Profile and can read only their own', async () => {
  const a = await signInTestUser('a');
  const b = await signInTestUser('b');

  const mine = await a.data.getMyProfile();
  expect(mine.id).toBe(a.userId);
  expect(mine.username).toBeNull();
  expect(Date.now() - Date.parse(mine.createdAt)).toBeLessThan(60_000);

  expect(await a.data.getProfile(a.userId)).toEqual(mine);
  expect(await a.data.getProfile(b.userId)).toBeNull();
});
