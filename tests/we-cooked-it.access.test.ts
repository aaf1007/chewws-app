// Access-rule tests for ticket 18: "We cooked it" (decisions 18). A stranger, a co-member and an
// unfriended co-member skip the data layer and call PostgREST directly with their own session, as an
// attacker would. The membership rule (private.is_cook_plan_member), the companion rule
// (private.can_be_cook_log_companion), the table grants and the checks inside the functions are
// what have to stop them.
import { expect, test } from 'vitest';

import type { CookPlanId, RecipeId } from '../src/data';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  cookLogCompanionWriters,
  cookPlanRowWriters,
  functionsRestatingTheActivityRule,
  functionsRestatingTheCompanionRule,
  functionsRestatingTheFriendRule,
  functionsRestatingTheMembershipRule,
  functionsRestatingTheRecipeReadRule,
  friendshipReadersNotAllowed,
  policiesRestatingTheMembershipRule,
  promptDismissalWriters,
  uniqueUsername,
} from './harness';

const permissionDenied = { code: '42501' };

async function named(label: string): Promise<Attacker> {
  const user = await signInAttacker(label);
  const result = await user.data.setUsername(uniqueUsername(label));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return user;
}

async function befriend(a: Attacker, b: Attacker) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/**
 * sam's plan with jo (his Friend) holding sam's shakshuka and jo's dal. kim is sam's Friend but not
 * in the plan; stranger is nobody to anyone.
 */
async function plan() {
  const sam = await named('sam');
  const jo = await named('jo');
  const kim = await named('kim');
  const stranger = await named('stranger');
  await befriend(sam, jo);
  await befriend(sam, kim);
  const { planId } = await sam.data.createCookPlan({ cookOn: '2026-11-01', friends: [jo.userId] });
  const shakshuka = await sam.data.createRecipe({ title: 'Shakshuka', lines: [], steps: [] });
  const dal = await jo.data.createRecipe({ title: 'Dal', lines: [], steps: [] });
  expect(await sam.data.addRecipeToCookPlan(planId, shakshuka)).toEqual({ status: 'added' });
  expect(await jo.data.addRecipeToCookPlan(planId, dal)).toEqual({ status: 'added' });
  return { sam, jo, kim, stranger, planId, shakshuka, dal };
}

const statusFor = async (member: Attacker, planId: CookPlanId) => (await member.data.getCookPlan(planId))?.status;

/** Whether `member` still has a prompt for the plan. */
async function prompted(member: Attacker, planId: CookPlanId): Promise<boolean> {
  const plan = await member.data.getCookPlan(planId);
  return plan !== null && (await member.data.cookPlanPrompts([plan])).length > 0;
}

/** A Cook Log straight through the API, as `who`, from the plan, with `companions`. */
const logDirectly = (who: Attacker, recipe: RecipeId, planId: CookPlanId | null, companions: string[] = []) =>
  who.client.rpc('add_cook_log', {
    id: crypto.randomUUID(),
    recipe_id: recipe,
    cooked_on: '2026-11-01',
    companions,
    ...(planId ? { cook_plan_id: planId } : {}),
  });

test('a stranger can’t mark someone’s Cook Plan cooked, through the function or the table', async () => {
  const { sam, jo, stranger, planId } = await plan();

  expect((await stranger.client.rpc('mark_cook_plan_cooked', { plan_id: planId })).data).toEqual({ status: 'notFound' });
  const direct = await stranger.client
    .from('cook_plans')
    .update({ status: 'cooked', cooked_at: new Date().toISOString(), cooked_by: stranger.userId })
    .eq('id', planId);
  expect(direct.error).toMatchObject(permissionDenied);
  // Not even a member writes the row itself; marking is the function's.
  expect(
    (await jo.client.from('cook_plans').update({ status: 'cooked', cooked_at: new Date().toISOString() }).eq('id', planId)).error,
  ).toMatchObject(permissionDenied);
  expect(await statusFor(sam, planId)).toBe('active');
  expect(await statusFor(jo, planId)).toBe('active');
});

test('nobody dismisses another member’s prompt: a stranger’s or a co-member’s "Not now" leaves it, and the table can’t be written', async () => {
  const { sam, jo, stranger, planId } = await plan();
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });

  expect((await stranger.client.rpc('dismiss_cook_plan_prompt', { plan_id: planId })).data).toEqual({ status: 'notFound' });
  expect(await prompted(sam, planId)).toBe(true);
  expect(await prompted(jo, planId)).toBe(true);

  // jo's own "Not now" is his alone.
  expect((await jo.client.rpc('dismiss_cook_plan_prompt', { plan_id: planId })).data).toEqual({ status: 'dismissed' });
  expect(await prompted(jo, planId)).toBe(false);
  expect(await prompted(sam, planId)).toBe(true);

  // Straight at the table, for sam's row or his own: no grant.
  for (const [who, whose] of [
    [jo, sam],
    [stranger, sam],
    [sam, sam],
  ] as const) {
    const direct = await who.client
      .from('cook_plan_members')
      .update({ prompt_dismissed_at: new Date().toISOString() })
      .eq('plan_id', planId)
      .eq('user_id', whose.userId);
    expect(direct.error).toMatchObject(permissionDenied);
  }
  expect(await prompted(sam, planId)).toBe(true);
});

test('a non-member can’t log a Cook Log against a plan they’re not in, even of their own Recipe', async () => {
  const { sam, kim, stranger, planId } = await plan();
  await sam.data.markCookPlanCooked(planId);
  const kimsOwn = await kim.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const strangersOwn = await stranger.data.createRecipe({ title: 'Soup', lines: [], steps: [] });

  // kim is sam's Friend but not in the plan; she can't claim it to log sam as a co-member, or at all.
  expect((await logDirectly(kim, kimsOwn, planId)).data).toEqual({ status: 'noSuchCookPlan' });
  expect((await logDirectly(stranger, strangersOwn, planId, [sam.userId])).data).toEqual({ status: 'noSuchCookPlan' });
  expect(await kim.data.listCookLogs(kimsOwn)).toEqual([]);
  expect(await stranger.data.listCookLogs(strangersOwn)).toEqual([]);
});

test('a member can’t log someone else’s Recipe directly: only their own copy of it', async () => {
  const { sam, jo, planId, shakshuka } = await plan();
  await sam.data.markCookPlanCooked(planId);

  expect((await logDirectly(jo, shakshuka, planId, [sam.userId])).data).toEqual({ status: 'noSuchRecipe' });
  expect(await sam.data.listCookLogs(shakshuka)).toEqual([]);
  const copy = await jo.data.copyRecipe(shakshuka);
  if (copy.status !== 'copied') throw new Error('No copy.');
  expect((await logDirectly(jo, copy.recipeId, planId, [sam.userId])).data).toEqual({ status: 'added' });
});

test('companions from the plan are accepted after an unfriend; someone not in the plan (a Friend’s Friend, or nobody) is refused', async () => {
  const { sam, jo, kim, stranger, planId, dal } = await plan();
  await sam.data.markCookPlanCooked(planId);
  await sam.data.unfriend(jo.userId);

  // sam is no longer jo's Friend, but they were in the plan together.
  expect((await logDirectly(jo, dal, planId, [sam.userId])).data).toEqual({ status: 'added' });
  // kim is sam's Friend, not jo's, and not in the plan; the stranger is nobody.
  for (const outsider of [kim, stranger]) {
    expect((await logDirectly(jo, dal, planId, [sam.userId, outsider.userId])).data).toEqual({
      status: 'notCompanion',
      userId: outsider.userId,
    });
  }
  // Without the plan, sam isn't his to name any more.
  expect((await logDirectly(jo, dal, null, [sam.userId])).data).toEqual({ status: 'notCompanion', userId: sam.userId });
  expect((await jo.data.listCookLogs(dal)).map((l) => l.companions.map((c) => c.id))).toEqual([[sam.userId]]);
});

test('signed out, nothing about "We cooked it" answers', async () => {
  const { planId } = await plan();
  const anon = createTestClient();
  for (const fn of ['mark_cook_plan_cooked', 'dismiss_cook_plan_prompt'] as const) {
    expect((await anon.rpc(fn, { plan_id: planId })).error, fn).toMatchObject(permissionDenied);
  }
});

test('membership, Friends, activity and who may read a Recipe are still each asked of their one rule; only the plan’s lock changes a plan, and a "Not now" is only ever the caller’s', async () => {
  expect(await functionsRestatingTheMembershipRule()).toEqual([]);
  expect(await policiesRestatingTheMembershipRule()).toEqual([]);
  expect(await functionsRestatingTheFriendRule()).toEqual([]);
  expect(await friendshipReadersNotAllowed()).toEqual([]);
  expect(await functionsRestatingTheActivityRule()).toEqual([]);
  expect(await functionsRestatingTheRecipeReadRule()).toEqual([]);
  expect(await functionsRestatingTheCompanionRule()).toEqual([]);
  expect(await cookLogCompanionWriters()).toEqual(['public.add_cook_log: asks', 'public.edit_cook_log: asks']);
  expect(await cookPlanRowWriters()).toEqual(['public.mark_cook_plan_cooked: locks', 'public.set_cook_plan_date: locks']);
  expect(await promptDismissalWriters()).toEqual(['public.dismiss_cook_plan_prompt: own row']);
});
