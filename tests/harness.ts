import type { DataLayer, UserId } from '../src/data';
import { signInAttacker } from './access-harness';

export type TestUser = { userId: UserId; data: DataLayer };

/** A fresh signed-in user. Behaviour tests reach the app only through `data`, its data-layer actions. */
export async function signInTestUser(label = 'user'): Promise<TestUser> {
  const { userId, data } = await signInAttacker(label);
  return { userId, data };
}
