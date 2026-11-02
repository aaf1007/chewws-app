// Ticket 18: a Cook Plan list's offline changes across "We cooked it" (decisions 15, 18). A
// check-off made with no signal before the plan was marked cooked still applies once it's sent, and
// fills the buyer's Pantry. A Claim made the same way comes back gone: it's dropped, and the list
// tells the user it wasn't saved, until they've seen it.
import { expect, test, vi } from 'vitest';

import type { CookPlanId, CookPlanListView, DataLayer, UserId } from '../src/data';
import { signInOnPhones, signInWithUsername, uniqueUsername, type TestPhone } from './harness';

type Someone = { userId: UserId; data: DataLayer };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** jo, on a phone, in sam's plan holding sam's shakshuka (eggs, butter, parsley). */
async function planOnPhone() {
  const [jo] = await signInOnPhones('jo', 1);
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
  return { jo, sam, planId, line };
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
