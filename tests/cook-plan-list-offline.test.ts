// Ticket 15: a Cook Plan's list with no signal (decisions 15 and 10). Claims and checks made
// offline show on the phone, wait in the same queue as the Shopping List's changes, in the order
// made, and sync; each goes to its own list, only as the user who made it, and only while they're
// in the plan. Claims and checks keep separate times, so neither beats the other. A plan the user
// isn't in any more comes back gone: its changes are dropped, the phone says so and forgets the list.
import { expect, test, vi } from 'vitest';

import type { CookPlanId, CookPlanList, CookPlanListView, DataLayer, ShoppingList, UserId } from '../src/data';
import { signInOnPhones, signInWithUsername, uniqueUsername, type TestPhone } from './harness';

type Someone = { userId: UserId; data: DataLayer };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** One user signed in on `count` phones, with a username (so they can be Friends). */
async function phonesWithUsername(label: string, count = 1): Promise<TestPhone[]> {
  const phones = await signInOnPhones(label, count);
  const chosen = await phones[0].data.setUsername(uniqueUsername(label));
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  return phones;
}

/** sam's plan with `members`, all his Friends, holding his garlic bread: butter, garlic and parsley. */
async function planWith(...members: Someone[]) {
  const sam = await signInWithUsername('sam');
  for (const member of members) await befriend(sam, member);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: members.map((m) => m.userId) });
  const bread = await sam.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
      { originalText: 'Parsley', amountText: null, ingredientName: 'parsley' },
    ],
    steps: [],
  });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  const list = await sam.data.getCookPlanList(planId);
  const line = (name: string) => {
    const found = list.items.find((i) => i.ingredient.name === name);
    if (!found) throw new Error(`${name} is not on the list`);
    return found.id;
  };
  return { sam, planId, line };
}

/** The list as a member reads it: each line, who Claimed it and who checked it off. */
const view = (list: CookPlanList) =>
  list.items.map((item) => ({
    line: item.ingredient.name,
    claimedBy: item.claim.status === 'claimed' ? item.claim.claimedBy : null,
    checkedBy: item.check.status === 'checked' ? item.check.checkedBy : null,
  }));

const untouched = [
  { line: 'butter', claimedBy: null, checkedBy: null },
  { line: 'garlic', claimedBy: null, checkedBy: null },
  { line: 'parsley', claimedBy: null, checkedBy: null },
];

const pantryNames = async (user: Someone) => (await user.data.getPantry()).ingredients.map((i) => i.name);

/** Every view a phone's Cook Plan list screen would get, while watching it. */
function watch(phone: TestPhone, planId: CookPlanId) {
  const views: CookPlanListView[] = [];
  const stop = phone.data.watchCookPlanList(planId, (v) => views.push(v));
  return { views, last: () => views[views.length - 1], stop };
}

const LIST_CHANGE = /\/rpc\/(check_off|uncheck|add_manual_item|claim_cook_plan_item|unclaim_cook_plan_item|cook_plan_check_off|cook_plan_uncheck)$/;

/** Requests that change a list, sent from a phone after the first `from` it made. */
const listChangesSent = (phone: TestPhone, from: number) =>
  phone
    .requestsMade()
    .slice(from)
    .filter((sent) => LIST_CHANGE.test(sent.path));

test.each(['leaves on another phone', 'and sam leave, deleting the plan'] as const)(
  'changes queued while the member %s come back gone: dropped, the list forgotten, and the member told how many weren’t saved',
  async (how) => {
    const [jo, josOther] = await phonesWithUsername('jo', 2);
    const { sam, planId, line } = await planWith(jo);
    const screen = watch(jo, planId);
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));

    jo.goOffline();
    await jo.data.claim(planId, line('butter'));
    await jo.data.checkOffCookPlanItem(planId, line('garlic'));
    expect(await jo.data.syncListChanges()).toEqual({ status: 'offline', waiting: 2 });
    const shown = screen.last();
    expect(shown?.status === 'loaded' && view(shown.list)).toEqual([
      { line: 'butter', claimedBy: jo.userId, checkedBy: null },
      { line: 'garlic', claimedBy: null, checkedBy: jo.userId },
      { line: 'parsley', claimedBy: null, checkedBy: null },
    ]);
    if (how === 'and sam leave, deleting the plan') await sam.data.leaveCookPlan(planId);
    expect(await josOther.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: how !== 'leaves on another phone' });

    jo.goOnline();
    expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'gone', changesNotSaved: 2 }));
    expect(await pantryNames(jo)).toEqual([]);
    if (how === 'leaves on another phone') expect(view(await sam.data.getCookPlanList(planId))).toEqual(untouched);
    // Nothing of it is kept on the phone, nor shown again, even after a restart with no signal.
    expect([...jo.saved().entries()].filter(([key, value]) => key.includes(planId) || value.includes(line('butter')))).toEqual([]);
    jo.goOffline();
    const reopened = jo.relaunch();
    await expect(reopened.data.getCookPlanList(planId)).rejects.toMatchObject({ code: 'cook_plan_not_found' });
    const after = watch(reopened, planId);
    await vi.waitFor(() => expect(after.last()).toMatchObject({ status: 'gone', changesNotSaved: 2 }));
    expect(after.views.filter((v) => v.status === 'loaded')).toEqual([]);

    // Seen: the notice goes.
    await reopened.data.dismissCookPlanGone(planId);
    await vi.waitFor(() => expect(after.last()?.status).not.toBe('gone'));
    screen.stop();
    after.stop();
  },
);

test('once a read finds the user isn’t in the plan, the phone never shows its list again: not from its copy, not after a restart', async () => {
  const [jo, josOther] = await phonesWithUsername('jo', 2);
  const { planId } = await planWith(jo);
  await jo.data.getCookPlanList(planId);
  expect([...jo.saved().keys()]).toContain(`recipeapp.cookPlanList.${jo.userId}.${planId}`);
  // A phone that hasn't heard yet: what it saved before jo left.
  const unaware = jo.saved();

  await josOther.data.leaveCookPlan(planId);
  await expect(jo.data.getCookPlanList(planId)).rejects.toMatchObject({ code: 'cook_plan_not_found' });
  expect([...jo.saved().keys()].filter((key) => key.includes(planId))).toEqual([]);
  const screen = watch(jo, planId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'gone', changesNotSaved: 0 }));
  expect(screen.views.filter((v) => v.status === 'loaded')).toEqual([]);
  screen.stop();

  jo.goOffline();
  await expect(jo.relaunch().data.getCookPlanList(planId)).rejects.toMatchObject({ code: 'cook_plan_not_found' });

  // The phone that hadn't heard shows its copy only until its first read, which forgets it.
  const late = jo.relaunch(unaware);
  late.goOnline();
  const lateScreen = watch(late, planId);
  await vi.waitFor(() => expect(lateScreen.last()).toMatchObject({ status: 'gone' }));
  expect([...late.saved().keys()].filter((key) => key.includes(planId))).toEqual([]);
  late.goOffline();
  await expect(late.relaunch().data.getCookPlanList(planId)).rejects.toMatchObject({ code: 'cook_plan_not_found' });
  lateScreen.stop();
});

test('a Cook Plan change queued under one user never goes out as the next one signed in on the phone', async () => {
  const [a] = await phonesWithUsername('a');
  const [b] = await phonesWithUsername('b');
  const { sam, planId, line } = await planWith(a, b);
  await a.data.getCookPlanList(planId);

  a.goOffline();
  await a.data.claim(planId, line('butter'));
  await a.data.checkOffCookPlanItem(planId, line('garlic'));
  expect(await a.data.syncListChanges()).toEqual({ status: 'offline', waiting: 2 });
  const sentBefore = a.requestsMade().length;
  await a.data.signOut();
  // Nothing of A's lists is left on the phone: not their queue, nor their copy of the plan's list.
  expect([...a.saved().keys()].filter((key) => /cookPlanList|listChanges|signedInUser/.test(key))).toEqual([]);

  // B, who is in the same plan, signs in on A's phone with a signal and uses it.
  a.goOnline();
  expect(await a.data.signInWithPassword(b.account)).toEqual(b.userId);
  expect(await a.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await a.data.getCookPlanList(planId))).toEqual(untouched);
  expect(listChangesSent(a, sentBefore)).toEqual([]);
  await a.data.signOut();

  // A again: nothing of theirs is waiting, and the server never had it.
  expect(await a.data.signInWithPassword(a.account)).toEqual(a.userId);
  expect(await a.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(listChangesSent(a, sentBefore)).toEqual([]);
  expect(view(await sam.data.getCookPlanList(planId))).toEqual(untouched);
  expect(await pantryNames(a)).toEqual([]);
  expect(await pantryNames(b)).toEqual([]);
});

test('a Claim whose retry after a 401 would read the next user’s session: nothing goes out as them', async () => {
  const [a] = await phonesWithUsername('a');
  const [b] = await phonesWithUsername('b');
  const { sam, planId, line } = await planWith(a, b);
  await a.data.getCookPlanList(planId);
  a.goOffline();
  await a.data.claim(planId, line('butter'));
  const sentBefore = a.requestsMade().length;

  // Back online, the server refuses the access token the Claim goes out with, so the phone
  // refreshes the session and sends it again. The retry reads the session the auth client just
  // saved, slowly, and B signs in on the phone before it has read.
  a.goOnline();
  a.serverAnswersFor('claim_cook_plan_item', 401);
  const send = a.holdNextRequest('claim_cook_plan_item');
  const syncing = a.data.syncListChanges();
  await send.reached;
  const read = a.holdSessionReadAfterNextSave();
  send.release();
  await read.reached;
  a.serverAnswersFor('claim_cook_plan_item', null);
  a.goOffline();
  await a.data.signOut();
  a.goOnline();
  expect(await a.data.signInWithPassword(b.account)).toEqual(b.userId);
  read.release();
  await syncing;

  expect(
    a
      .requestsMade()
      .slice(sentBefore)
      .filter((sent) => sent.user === b.userId && sent.path.startsWith('/rest/v1/rpc/')),
  ).toEqual([]);
  expect(listChangesSent(a, sentBefore)).toEqual([{ user: a.userId, path: '/rest/v1/rpc/claim_cook_plan_item' }]);
  expect(view(await sam.data.getCookPlanList(planId))).toEqual(untouched);
});

/** The user's own Shopping List as they read it: each item and whether it's checked. */
const shopping = (list: ShoppingList) =>
  list.items.map((item) => [item.kind === 'ingredient' ? item.ingredient.name : item.text, item.check.status]);

test('Shopping List and Cook Plan changes made offline wait in one queue and each go to their own list, in the order made', async () => {
  const [jo] = await phonesWithUsername('jo');
  const { sam, planId, line } = await planWith(jo);
  const lemonade = await jo.data.createRecipe({
    title: 'Lemonade',
    lines: [{ originalText: '3 lemons', amountText: '3', ingredientName: 'lemon' }],
    steps: [],
  });
  await jo.data.addRecipeToShoppingList(lemonade);
  const lemon = (await jo.data.getShoppingList()).items[0].id;
  await jo.data.getCookPlanList(planId);

  jo.goOffline();
  await jo.data.checkOff(lemon);
  await jo.data.claim(planId, line('butter'));
  await jo.data.checkOffCookPlanItem(planId, line('garlic'));
  await jo.data.addManualItem('Foil');
  await jo.data.unclaim(planId, line('butter'));
  await jo.data.claim(planId, line('parsley'));
  expect(await jo.data.syncListChanges()).toEqual({ status: 'offline', waiting: 6 });
  // Saved in one queue: a Shopping List's change with its `listId`, a Cook Plan's with its `list`.
  const saved: { queue: { change: Record<string, unknown> }[] } = JSON.parse(jo.saved().get(`recipeapp.listChanges.${jo.userId}`) ?? '');
  expect(saved.queue.map(({ change }) => [change.kind, change.listId === undefined ? change.list : 'shoppingList'])).toEqual([
    ['checkOff', 'shoppingList'],
    ['claim', { kind: 'cookPlan', id: planId }],
    ['checkOff', { kind: 'cookPlan', id: planId }],
    ['addManualItem', 'shoppingList'],
    ['unclaim', { kind: 'cookPlan', id: planId }],
    ['claim', { kind: 'cookPlan', id: planId }],
  ]);

  // Closed and opened again with no signal: both lists show the changes.
  const reopened = jo.relaunch();
  const offlinePlan = [
    { line: 'butter', claimedBy: null, checkedBy: null },
    { line: 'garlic', claimedBy: null, checkedBy: jo.userId },
    { line: 'parsley', claimedBy: jo.userId, checkedBy: null },
  ];
  expect(view(await reopened.data.getCookPlanList(planId))).toEqual(offlinePlan);
  expect(shopping(await reopened.data.getShoppingList())).toEqual([
    ['Foil', 'unchecked'],
    ['lemon', 'checked'],
  ]);
  const sentBefore = reopened.requestsMade().length;

  reopened.goOnline();
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(listChangesSent(reopened, sentBefore).map((s) => s.path.replace('/rest/v1/rpc/', ''))).toEqual([
    'check_off',
    'claim_cook_plan_item',
    'cook_plan_check_off',
    'add_manual_item',
    'unclaim_cook_plan_item',
    'claim_cook_plan_item',
  ]);
  expect(view(await sam.data.getCookPlanList(planId))).toEqual(offlinePlan);
  expect(shopping(await reopened.data.getShoppingList())).toEqual([
    ['Foil', 'unchecked'],
    ['lemon', 'checked'],
  ]);
  // Each check-off went to its own list's Pantry rule: jo's own list, and jo as the buyer.
  expect(await pantryNames(reopened)).toEqual(['garlic', 'lemon']);
  expect(await pantryNames(sam)).toEqual([]);
});

test('a Claim made earlier never beats someone’s later check-off, nor a check-off made earlier someone’s later Claim; within each, the later wins', async () => {
  const [jo] = await phonesWithUsername('jo');
  const { sam, planId, line } = await planWith(jo);
  await jo.data.getCookPlanList(planId);

  // In the shop with no signal, a minute ago, jo claimed butter and parsley and checked garlic off.
  jo.goOffline();
  jo.setClock(new Date(Date.now() - 60_000));
  await jo.data.claim(planId, line('butter'));
  await jo.data.claim(planId, line('parsley'));
  await jo.data.checkOffCookPlanItem(planId, line('garlic'));
  // Since then sam checked butter off, and claimed garlic and parsley.
  await sam.data.checkOffCookPlanItem(planId, line('butter'));
  await sam.data.claim(planId, line('garlic'));
  await sam.data.claim(planId, line('parsley'));

  jo.goOnline();
  expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  const expected = [
    { line: 'butter', claimedBy: jo.userId, checkedBy: sam.userId },
    { line: 'garlic', claimedBy: sam.userId, checkedBy: jo.userId },
    // Both claimed parsley: sam's Claim is the later one.
    { line: 'parsley', claimedBy: sam.userId, checkedBy: null },
  ];
  expect(view(await sam.data.getCookPlanList(planId))).toEqual(expected);
  expect(view(await jo.data.getCookPlanList(planId))).toEqual(expected);
  expect(await pantryNames(jo)).toEqual(['garlic']);
  expect(await pantryNames(sam)).toEqual(['butter']);
});
