import pg from 'pg';
import { inject } from 'vitest';

import type { IngredientId, DataLayer, UserId } from '../src/data';
import { signInAttacker } from './access-harness';

export type TestUser = { userId: UserId; data: DataLayer };

/** A fresh signed-in user. Behaviour tests reach the app only through `data`, its data-layer actions. */
export async function signInTestUser(label = 'user'): Promise<TestUser> {
  const { userId, data } = await signInAttacker(label);
  return { userId, data };
}

/** Sessions waiting, directly or through others, on the session with this pid. Live, never cached. */
const WAITING_ON = `
  with recursive waiting (pid) as (
    select l.pid from pg_locks l where not l.granted and $1::int = any (pg_blocking_pids(l.pid))
    union
    select l.pid from pg_locks l join waiting w on w.pid = any (pg_blocking_pids(l.pid)) where not l.granted
  )
  select count(distinct pid)::int as count from waiting`;

export type HeldLine = {
  /** Resolves once `count` database sessions are waiting on the held line (or on sessions that are). */
  waitForWaiting(count: number): Promise<void>;
  /** Rolls the held line back, so whoever waited on it carries on as if it had never been there. */
  release(): Promise<void>;
};

/**
 * For race tests only: a second database session that starts making the user's Shopping List line
 * for an Ingredient and doesn't commit. Until `release()`, anything of theirs that writes that line
 * waits at it, so a test can run another action while the first is stopped there.
 */
export async function holdShoppingListLine(user: TestUser, ingredientId: IngredientId): Promise<HeldLine> {
  const session = new pg.Client({ connectionString: inject('supabase').dbUrl });
  await session.connect();
  await session.query('begin');
  await session.query(
    `insert into public.shopping_list_items (list_id, ingredient_id)
     select l.id, $2 from public.shopping_lists l where l.owner_id = $1`,
    [user.userId, ingredientId],
  );
  const { rows } = await session.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0].pid;
  let released = false;

  return {
    async waitForWaiting(count) {
      const deadline = Date.now() + 10_000;
      while (!released) {
        const waiting = await session.query<{ count: number }>(WAITING_ON, [pid]);
        if (waiting.rows[0].count >= count) return;
        if (Date.now() > deadline) throw new Error(`Fewer than ${count} sessions waited on the held line.`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async release() {
      released = true;
      await session.query('rollback');
      await session.end();
    },
  };
}
