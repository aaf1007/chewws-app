// Access-rule tests for ticket 15: the Cook Plan list (decisions 15). A stranger, a Friend of a
// member who isn't in the plan, and a member who has left skip the data layer and call PostgREST
// and Realtime directly with their own session, as an attacker would. The table grants, the
// policies on the lines, amounts and Realtime topic, and the checks inside the list functions, each
// asking private.is_cook_plan_member, are what have to stop them. Who has it never shows more of a
// member's Pantry than the plan's own Ingredients.
import { expect, inject, test } from 'vitest';

import type { CookPlanList } from '../src/data';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  cookPlanListFunctionsNotAskingMembership,
  cookPlanListPolicies,
  functionsReadingPantries,
  uniqueUsername,
} from './harness';

const permissionDenied = { code: '42501' };

/** Joining a Realtime channel takes a round trip or two over its socket, each time. */
const REALTIME_TEST_TIMEOUT_MS = 30_000;

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

const lineId = (list: CookPlanList, name: string) => {
  const found = list.items.find((i) => i.ingredient.name === name);
  if (!found) throw new Error(`${name} is not on the list`);
  return found.id;
};

/**
 * sam's plan with jo, holding his garlic bread: garlic, butter and salt. jo has butter and caviar
 * in her Pantry; lee, who was in it and claimed the salt, has garlic in his, and left. jo claimed
 * the butter; sam checked the garlic off (so it's in his Pantry). kim is sam's Friend, not in the
 * plan; stranger is nobody to them.
 */
async function plan() {
  const sam = await named('sam');
  const jo = await named('jo');
  const lee = await named('lee');
  const kim = await named('kim');
  const stranger = await named('stranger');
  for (const friend of [jo, lee, kim]) await befriend(sam, friend);
  await jo.data.addToPantry('butter');
  await jo.data.addToPantry('caviar');
  await lee.data.addToPantry('garlic');
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId, lee.userId] });
  const bread = await sam.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
      { originalText: 'Salt', amountText: 'a pinch', ingredientName: 'salt' },
    ],
    steps: [],
  });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  const list = await sam.data.getCookPlanList(planId);
  const ids = { garlic: lineId(list, 'garlic'), butter: lineId(list, 'butter'), salt: lineId(list, 'salt') };
  await lee.data.claim(planId, ids.salt);
  expect(await lee.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: false });
  await jo.data.claim(planId, ids.butter);
  await sam.data.checkOffCookPlanItem(planId, ids.garlic);

  const pantries = async () =>
    Promise.all([sam, jo, lee, kim, stranger].map(async (u) => (await u.data.getPantry()).ingredients.map((i) => i.name)));
  const before = { list: await sam.data.getCookPlanList(planId), pantries: await pantries() };
  expect(before.pantries).toEqual([['garlic'], ['butter', 'caviar'], ['garlic'], [], []]);
  /** The plan's list, and everyone's Pantry, are as they were. */
  async function expectUnchanged() {
    expect(await sam.data.getCookPlanList(planId)).toEqual(before.list);
    expect(await pantries()).toEqual(before.pantries);
  }
  return { sam, jo, lee, kim, stranger, planId, bread, ids, expectUnchanged };
}

/** Everything `user` could read of the plan's list straight from the API. */
async function readsOf(user: Attacker, planId: string, itemIds: string[]) {
  const [items, amounts, byItem, whoHas] = await Promise.all([
    user.client.from('cook_plan_items').select('id').eq('plan_id', planId),
    user.client.from('cook_plan_amounts').select('item_id').eq('plan_id', planId),
    user.client.from('cook_plan_amounts').select('item_id').in('item_id', itemIds),
    user.client.rpc('cook_plan_who_has', { plan_id: planId }),
  ]);
  return { items: items.data, amounts: amounts.data, byItem: byItem.data, whoHas: whoHas.data };
}

const nothing = { items: [], amounts: [], byItem: [], whoHas: [] };

/** Every change `user` could try on the plan's list straight from the API, and what each answered. */
async function writesOf(user: Attacker, planId: string, ids: { garlic: string; butter: string; salt: string }) {
  const answer = async (fn: 'claim_cook_plan_item' | 'unclaim_cook_plan_item' | 'cook_plan_check_off' | 'cook_plan_uncheck', itemId: string) =>
    (await user.client.rpc(fn, { plan_id: planId, item_id: itemId })).data;
  return {
    claim: await answer('claim_cook_plan_item', ids.butter),
    // lee's own Claim, from before he left.
    unclaim: await answer('unclaim_cook_plan_item', ids.salt),
    checkOff: await answer('cook_plan_check_off', ids.butter),
    uncheck: await answer('cook_plan_uncheck', ids.garlic),
  };
}

const refused = { claim: 'gone', unclaim: 'gone', checkOff: 'gone', uncheck: 'gone' };

/** How a Realtime subscription to a plan's private topic ends: joined, or refused. */
function subscribe(user: Attacker, planId: string): Promise<'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'> {
  return new Promise((resolve) => {
    const channel = user.client.channel(`cook_plan:${planId}`, { config: { private: true } });
    let answered = false;
    channel.subscribe((status) => {
      if (answered) return;
      answered = true;
      resolve(status);
      void user.client.removeChannel(channel);
    });
  });
}

test(
  'a stranger, a Friend of a member, and a member who left read nothing of the list, change nothing on it, and cannot subscribe to it',
  async () => {
    const { jo, lee, kim, stranger, planId, ids, expectUnchanged } = await plan();
    const itemIds = Object.values(ids);

    for (const outsider of [stranger, kim, lee]) {
      expect(await readsOf(outsider, planId, itemIds)).toEqual(nothing);
      expect(await writesOf(outsider, planId, ids)).toEqual(refused);
      expect(await subscribe(outsider, planId)).toBe('CHANNEL_ERROR');
      await expect(outsider.data.getCookPlanList(planId)).rejects.toMatchObject({ code: 'cook_plan_not_found' });
    }
    await expectUnchanged();

    // A member reads all of it and may subscribe: the same calls aren't refused for everyone.
    const joReads = await readsOf(jo, planId, itemIds);
    expect(joReads.items).toHaveLength(3);
    expect(joReads.amounts).toHaveLength(3);
    expect(joReads.byItem).toHaveLength(3);
    // butter (jo), garlic (sam), and salt, a Staple, for both.
    expect(joReads.whoHas).toHaveLength(4);
    expect(await subscribe(jo, planId)).toBe('SUBSCRIBED');
  },
  REALTIME_TEST_TIMEOUT_MS,
);

test("who has it shows members' Pantries and Staples only for the plan's Ingredients, and only to members", async () => {
  const { sam, jo, lee, planId, ids } = await plan();
  const names = new Map([
    [ids.garlic, 'garlic'],
    [ids.butter, 'butter'],
    [ids.salt, 'salt'],
  ]);
  const ingredientNames = new Map(
    (await jo.data.getCookPlanList(planId)).items.map((i) => [String(i.ingredient.id), names.get(i.id) ?? '?']),
  );
  const who = new Map([
    [String(sam.userId), 'sam'],
    [String(jo.userId), 'jo'],
    [String(lee.userId), 'lee'],
  ]);

  const { data, error } = await jo.client.rpc('cook_plan_who_has', { plan_id: planId });
  expect(error).toBeNull();
  // Not jo's caviar, nor her pepper and oil (Staples not on the plan), nor lee's anything (he left).
  expect((data ?? []).map((row) => [ingredientNames.get(row.ingredient_id) ?? row.ingredient_id, who.get(row.user_id) ?? row.user_id]).sort()).toEqual([
    ['butter', 'jo'],
    ['garlic', 'sam'],
    ['salt', 'jo'],
    ['salt', 'sam'],
  ]);

  // jo's own plan, which sam isn't in, says nothing to sam about it.
  const { planId: josPlan } = await jo.data.createCookPlan({ cookOn: null, friends: [] });
  expect((await sam.client.rpc('cook_plan_who_has', { plan_id: josPlan })).data).toEqual([]);
});

test('nobody writes lines or amounts directly, not even a member', async () => {
  const { sam, jo, planId, bread, ids } = await plan();
  const ingredientId = (await jo.data.getCookPlanList(planId)).items[0].ingredient.id;

  const results = [
    await jo.client.from('cook_plan_items').insert({ plan_id: planId, ingredient_id: ingredientId }),
    await jo.client.from('cook_plan_items').update({ claimed_by: jo.userId, claimed_at: new Date().toISOString() }).eq('id', ids.salt),
    await jo.client.from('cook_plan_items').delete().eq('id', ids.butter),
    await sam.client.from('cook_plan_amounts').insert({ item_id: ids.butter, plan_id: planId, recipe_id: bread, recipe_title: 'Mine', amount_texts: ['9 tbsp'] }),
    await sam.client.from('cook_plan_amounts').update({ amount_texts: ['9 tbsp'] }).eq('item_id', ids.butter),
    await sam.client.from('cook_plan_amounts').delete().eq('item_id', ids.butter),
  ];
  expect(results.map((r) => r.error?.code)).toEqual(Array(6).fill(permissionDenied.code));
});

test("adding a Recipe with Ingredients that aren't its own, or one of them twice, is refused and changes nothing", async () => {
  const { sam, jo, planId, expectUnchanged } = await plan();
  const toast = await sam.data.createRecipe({
    title: 'Toast',
    lines: [{ originalText: 'Bread', amountText: '2 slices', ingredientName: 'bread' }],
    steps: [],
  });
  const bread = (await sam.data.getRecipe(toast))?.lines[0].ingredient.id ?? '';
  const caviar = (await jo.data.getPantry()).ingredients.find((i) => i.name === 'caviar')?.id ?? '';
  const add = (lines: { ingredient_id: string; amount_texts: string[] }[]) =>
    sam.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: toast, lines });

  expect((await add([{ ingredient_id: caviar, amount_texts: ['1 tin'] }])).error).toMatchObject({ code: '22023' });
  expect(
    (
      await add([
        { ingredient_id: bread, amount_texts: ['2 slices'] },
        { ingredient_id: bread, amount_texts: ['9 slices'] },
      ])
    ).error,
  ).toMatchObject({ code: '22023' });
  expect((await sam.data.getCookPlan(planId))?.recipes.map((r) => r.title)).toEqual(['Garlic bread']);
  await expectUnchanged();
});

test("adding a Recipe with only some of its Ingredients, or with none named, is refused and changes nothing", async () => {
  const { sam, planId, expectUnchanged } = await plan();
  const toast = await sam.data.createRecipe({
    title: 'Toast',
    lines: [
      { originalText: 'Bread', amountText: '2 slices', ingredientName: 'bread' },
      { originalText: 'Jam', amountText: '1 tbsp', ingredientName: 'jam' },
    ],
    steps: [],
  });
  const bread = (await sam.data.getRecipe(toast))?.lines[0].ingredient.id ?? '';

  const partial = await sam.client.rpc('add_recipe_to_cook_plan', {
    plan_id: planId,
    recipe_id: toast,
    lines: [{ ingredient_id: bread, amount_texts: ['2 slices'] }],
  });
  expect(partial.error).toMatchObject({ code: '22023' });
  const missing = await sam.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: toast });
  expect(missing.error).toMatchObject({ code: '22023' });
  expect((await sam.data.getCookPlan(planId))?.recipes.map((r) => r.title)).toEqual(['Garlic bread']);
  await expectUnchanged();

  // A Recipe with no Ingredients is added with none.
  const water = await sam.data.createRecipe({ title: 'Water', lines: [], steps: [] });
  expect((await sam.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: water })).data).toEqual({ status: 'added' });
});

test('a change that changes nothing answers gone or superseded, never applied, and a change names the plan it is for', async () => {
  const { sam, jo, planId, ids, expectUnchanged } = await plan();
  const rpc = (fn: 'claim_cook_plan_item' | 'unclaim_cook_plan_item' | 'cook_plan_check_off' | 'cook_plan_uncheck', user: Attacker, itemId: string, extra = {}) =>
    user.client.rpc(fn, { plan_id: planId, item_id: itemId, ...extra });
  const anHourAgo = { changed_at: new Date(Date.now() - 3_600_000).toISOString() };

  // jo's Claim on the butter isn't sam's to unclaim; nobody has claimed the garlic.
  expect((await rpc('unclaim_cook_plan_item', sam, ids.butter)).data).toBe('gone');
  expect((await rpc('unclaim_cook_plan_item', sam, ids.garlic)).data).toBe('gone');
  // Made before the last Claim or check of the line.
  expect((await rpc('claim_cook_plan_item', sam, ids.butter, anHourAgo)).data).toBe('superseded');
  expect((await rpc('unclaim_cook_plan_item', jo, ids.butter, anHourAgo)).data).toBe('superseded');
  expect((await rpc('cook_plan_uncheck', jo, ids.garlic, anHourAgo)).data).toBe('superseded');
  // jo's own other plan, with the line of this one.
  const { planId: josPlan } = await jo.data.createCookPlan({ cookOn: null, friends: [] });
  for (const fn of ['claim_cook_plan_item', 'unclaim_cook_plan_item', 'cook_plan_check_off', 'cook_plan_uncheck'] as const) {
    expect((await jo.client.rpc(fn, { plan_id: josPlan, item_id: ids.salt })).data, fn).toBe('gone');
    expect((await jo.client.rpc(fn, { plan_id: josPlan, item_id: ids.butter })).data, fn).toBe('gone');
  }
  await expectUnchanged();
});

test('the private list functions are not exposed through the Data API, and signed out nothing answers', async () => {
  const { jo, planId, ids } = await plan();
  const { url, anonKey } = inject('supabase');
  const { data } = await jo.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['cook_plan_of_topic', { topic: `cook_plan:${planId}` }],
    ['announce_cook_plans', { plan_ids: [planId] }],
    ['remove_cook_plan_recipe_lines', {}],
    ['ingredients_had', { who: jo.userId }],
  ] as const) {
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'private',
      },
      body: JSON.stringify(args),
    });
    expect(response.status, fn).toBe(406);
  }

  const anon = createTestClient();
  const change = { plan_id: planId, item_id: ids.butter };
  const signedOut = [
    await anon.rpc('cook_plan_who_has', { plan_id: planId }),
    await anon.rpc('claim_cook_plan_item', change),
    await anon.rpc('unclaim_cook_plan_item', change),
    await anon.rpc('cook_plan_check_off', change),
    await anon.rpc('cook_plan_uncheck', change),
    await anon.from('cook_plan_items').select('*'),
    await anon.from('cook_plan_amounts').select('*'),
  ];
  for (const { error } of signedOut) expect(error).toMatchObject(permissionDenied);
});

test('every read and write of a Cook Plan list asks private.is_cook_plan_member, and who has it asks private.ingredients_had', async () => {
  expect(await cookPlanListFunctionsNotAskingMembership()).toEqual([]);
  expect(await functionsReadingPantries()).toEqual(['private.ingredients_had']);
  expect(await cookPlanListPolicies()).toEqual([
    'public.cook_plan_amounts SELECT: private.is_cook_plan_member(plan_id)',
    'public.cook_plan_items SELECT: private.is_cook_plan_member(plan_id)',
    "realtime.messages SELECT: ((extension = 'broadcast'::text) AND private.can_use_shopping_list(private.shopping_list_of_topic(( SELECT realtime.topic() AS topic))))",
    "realtime.messages SELECT: ((extension = 'broadcast'::text) AND private.is_cook_plan_member(private.cook_plan_of_topic(( SELECT realtime.topic() AS topic))))",
  ]);
});
