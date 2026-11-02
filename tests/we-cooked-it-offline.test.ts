// Ticket 18: a Cook Plan list's offline changes across "We cooked it" (decisions 15, 18). A
// check-off made with no signal before the plan was marked cooked still applies once it's sent, and
// fills the buyer's Pantry. A Claim made the same way comes back gone: it's dropped, and the list
// tells the user it wasn't saved, until they've seen it; gone for any other reason, it's dropped
// with no such notice. A cooked plan opens with no signal as last read, open only to checking off.
import { expect, test, vi } from 'vitest';

import type { CookPlanId, CookPlanListView, DataLayer, UserId } from '../src/data';
import { signInOnPhones, signInWithUsername, uniqueUsername, type TestPhone } from './harness';

type Someone = { userId: UserId; data: DataLayer };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** jo, on `phones` phones, in sam's plan holding sam's shakshuka (eggs, butter, parsley). */
async function planOnPhone(phones = 1) {
  const [jo, ...josOthers] = await signInOnPhones('jo', phones);
  const chosen = await jo.data.setUsername(uniqueUsername('jo'));
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  const sam = await signInWithUsername('sam');
  await befriend(sam, jo);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  const shakshuka = await sam.data.createRecipe({
    title: 'Shakshuka',
    lines: [
      { originalText: '4 eggs', amountText: '4', ingredientName: 'egg' },
      { originalText: '1 tbsp butter', amountText: '1 tbsp', ingredientName: 'butter' },
      { originalText: 'Parsley', amountText: null, ingredientName: 'parsley' },
    ],
    steps: [],
  });
  expect(await sam.data.addRecipeToCookPlan(planId, shakshuka)).toEqual({ status: 'added' });
  const list = await jo.data.getCookPlanList(planId);
  const line = (name: string) => {
    const found = list.items.find((i) => i.ingredient.name === name);
    if (!found) throw new Error(`${name} is not on the list`);
    return found.id;
  };
  return { jo, josOthers, sam, planId, shakshuka, line };
}

function watch(phone: TestPhone, planId: CookPlanId) {
  const views: CookPlanListView[] = [];
  const stop = phone.data.watchCookPlanList(planId, (v) => views.push(v));
  return { last: () => views[views.length - 1], stop };
}

/** Each line as the server has it: who Claimed it and who checked it off. */
async function server(sam: Someone, planId: CookPlanId) {
  return (await sam.data.getCookPlanList(planId)).items.map((item) => ({
    line: item.ingredient.name,
    claimedBy: item.claim.status === 'claimed' ? item.claim.claimedBy : null,
    checkedBy: item.check.status === 'checked' ? item.check.checkedBy : null,
  }));
}

test('a check-off queued before the plan was marked cooked still applies after, and fills the buyer’s Pantry', async () => {
  const { jo, sam, planId, line } = await planOnPhone();
  jo.goOffline();
  await jo.data.checkOffCookPlanItem(planId, line('butter'));
  expect(await jo.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });

  jo.goOnline();
  expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(await server(sam, planId)).toEqual([
    { line: 'butter', claimedBy: null, checkedBy: jo.userId },
    { line: 'egg', claimedBy: null, checkedBy: null },
    { line: 'parsley', claimedBy: null, checkedBy: null },
  ]);
  expect((await jo.data.getPantry()).ingredients.map((i) => i.name)).toEqual(['butter']);
  const screen = watch(jo, planId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', list: { status: 'cooked' }, notSaved: [] }));
  screen.stop();
});

test('a Claim queued before the plan was marked cooked comes back gone: dropped, and the list says it wasn’t saved until seen; the check-off behind it still goes', async () => {
  const { jo, sam, planId, line } = await planOnPhone();
  const screen = watch(jo, planId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));
  jo.goOffline();
  await jo.data.claim(planId, line('egg'));
  await jo.data.checkOffCookPlanItem(planId, line('parsley'));
  expect(await jo.data.syncListChanges()).toEqual({ status: 'offline', waiting: 2 });
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });

  jo.goOnline();
  expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(await server(sam, planId)).toEqual([
    { line: 'butter', claimedBy: null, checkedBy: null },
    { line: 'egg', claimedBy: null, checkedBy: null },
    { line: 'parsley', claimedBy: null, checkedBy: jo.userId },
  ]);
  await vi.waitFor(() =>
    expect(screen.last()).toMatchObject({
      status: 'loaded',
      list: { status: 'cooked' },
      notSaved: [{ kind: 'claim', itemName: 'egg' }],
    }),
  );
  const shown = screen.last();
  expect(shown.status === 'loaded' && shown.list.items.map((i) => [i.ingredient.name, i.claim.status, i.check.status])).toEqual([
    ['butter', 'unclaimed', 'unchecked'],
    ['egg', 'unclaimed', 'unchecked'],
    ['parsley', 'unclaimed', 'checked'],
  ]);

  // Seen: the notice goes, and stays gone after a restart.
  await jo.data.dismissNotSavedListChanges();
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ notSaved: [] }));
  screen.stop();
  const after = watch(jo.relaunch(), planId);
  await vi.waitFor(() => expect(after.last()).toMatchObject({ status: 'loaded', notSaved: [] }));
  after.stop();
});

test('a Claim made online on a cooked plan is refused at once, with no notice left behind', async () => {
  const { jo, sam, planId, line } = await planOnPhone();
  const screen = watch(jo, planId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));
  await sam.data.markCookPlanCooked(planId);

  await expect(jo.data.claim(planId, line('egg'))).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', list: { status: 'cooked' } }));
  expect(screen.last()).toMatchObject({ notSaved: [] });
  screen.stop();
});

test.each(['sam took the Recipe out', 'jo left the plan on another phone'] as const)(
  'a Claim queued offline that comes back gone because %s is dropped with no "Couldn’t claim" notice: only a cooked plan gives one',
  async (why) => {
    const { jo, josOthers, sam, planId, shakshuka, line } = await planOnPhone(2);
    const screen = watch(jo, planId);
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));
    jo.goOffline();
    await jo.data.claim(planId, line('egg'));
    expect(await jo.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
    if (why === 'sam took the Recipe out') {
      expect(await sam.data.removeRecipeFromCookPlan(planId, shakshuka)).toEqual({ status: 'removed' });
    } else {
      expect(await josOthers[0].data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: false });
    }

    jo.goOnline();
    expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    if (why === 'sam took the Recipe out') {
      await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', list: { status: 'active', items: [] } }));
      expect(screen.last()).toMatchObject({ notSaved: [] });
    } else {
      // Leaving has its own notice (ticket 15): the list is gone, with how many changes weren't saved.
      await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'gone', changesNotSaved: 1 }));
      expect(screen.last()).toMatchObject({ notSaved: [] });
    }
    screen.stop();
    const after = watch(jo.relaunch(), planId);
    await vi.waitFor(() => expect(after.last()?.status).toMatch(/loaded|gone/));
    expect(after.last()).toMatchObject({ notSaved: [] });
    after.stop();
  },
);

test('with no signal, a cooked plan opens as last read: cooked, the plan itself unchangeable, its list open only to checking off, which syncs later', { timeout: 20_000 }, async () => {
  const { jo, sam, planId, shakshuka, line } = await planOnPhone();
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });
  const toast = await sam.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const plans = await jo.data.listCookPlans();
  const plan = await jo.data.getCookPlan(planId);
  expect(plan).toMatchObject({ status: 'cooked', cookedBy: sam.userId });
  await jo.data.getCookPlanList(planId);
  await vi.waitFor(() => expect([...jo.saved().keys()]).toContain(`recipeapp.cookPlanLists.${jo.userId}`));

  // Nothing about the plan itself can change with no signal, and nothing is left waiting to.
  jo.goOffline();
  const offline = { code: 'offline' };
  await expect(jo.data.addRecipeToCookPlan(planId, toast)).rejects.toMatchObject(offline);
  await expect(jo.data.removeRecipeFromCookPlan(planId, shakshuka)).rejects.toMatchObject(offline);
  await expect(jo.data.setCookPlanDate(planId, null)).rejects.toMatchObject(offline);
  await expect(jo.data.markCookPlanCooked(planId)).rejects.toMatchObject(offline);
  expect(await jo.data.syncListChanges()).toMatchObject({ waiting: 0 });

  const phone = jo.relaunch();
  expect(await phone.data.readCookPlans()).toEqual({ plans, offline: true });
  expect(await phone.data.readCookPlan(planId)).toEqual({ plan, offline: true });
  expect(await phone.data.getCookPlanList(planId)).toMatchObject({ status: 'cooked' });

  // Checking off still works, and goes once there's a signal.
  await phone.data.checkOffCookPlanItem(planId, line('butter'));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
  phone.goOnline();
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(await server(sam, planId)).toEqual([
    { line: 'butter', claimedBy: null, checkedBy: jo.userId },
    { line: 'egg', claimedBy: null, checkedBy: null },
    { line: 'parsley', claimedBy: null, checkedBy: null },
  ]);
  expect(await sam.data.getCookPlan(planId)).toMatchObject({ status: 'cooked', cookOn: null, recipes: [{ id: shakshuka }] });
});
