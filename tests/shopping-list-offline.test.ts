// Ticket 10: the Shopping List with no signal. Each test signs one user in on one or two phones,
// each with its own app, storage, clock and signal (tests/harness.ts), turns the signal off, makes
// list changes through the data layer, turns it on again and checks what every phone, and the
// server, ends up with.
import { expect, test, vi } from 'vitest';

import type { ShoppingList, ShoppingListView } from '../src/data';
import { holdShoppingListRemoval, signInOnPhones, type TestPhone, type TestUser } from './harness';

/** The list as the user reads it: each line's name, its Recipes' amounts, and whether it's checked. */
const view = (list: ShoppingList) =>
  list.items.map((item) =>
    item.kind === 'ingredient'
      ? {
          ingredient: item.ingredient.name,
          recipes: item.recipes.map((r) => [r.recipe.title, ...r.amountTexts]),
          checked: item.check.status === 'checked',
        }
      : { handAdded: item.text, ingredient: item.ingredient?.name ?? null, checked: item.check.status === 'checked' },
  );

const pantryNames = async (user: TestUser) => (await user.data.getPantry()).ingredients.map((i) => i.name);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The server failed on the oldest of `waiting` changes: they're tried again at `at` (ms). */
const retryingAt = (at: number, waiting: number) => ({
  status: 'waitingToRetry',
  waiting,
  retryAt: new Date(at).toISOString(),
});

/** An item on the list, by its Ingredient's name or its hand-added text. */
async function itemNamed(user: TestUser, name: string) {
  const found = (await user.data.getShoppingList()).items.find((i) =>
    i.kind === 'ingredient' ? i.ingredient.name === name : i.text === name,
  );
  if (!found) throw new Error(`${name} is not on the Shopping List`);
  return found;
}

/**
 * Garlic bread on the user's Shopping List (garlic and butter), with butter checked off (so in the
 * Pantry), and "hellmann" made an Ingredient but not had. Every phone has seen the list.
 */
async function listWithGarlicAndButter(phones: TestPhone[]) {
  const [phone] = phones;
  const bread = await phone.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: [],
  });
  await phone.data.addRecipeToShoppingList(bread);
  const mayo = await phone.data.addToPantry("Hellmann's");
  await phone.data.markUsedUp(mayo.id);
  const butter = await itemNamed(phone, 'butter');
  await phone.data.checkOff(butter.id);
  const garlic = await itemNamed(phone, 'garlic');
  for (const p of phones) await p.data.getShoppingList();
  return { garlic, butter };
}

const garlicBread = (checked: boolean) => ({ ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked });
const butterLine = (checked: boolean) => ({ ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked });

/** Every view a phone's Shopping List screen would get, while watching. */
function watch(phone: TestPhone) {
  const views: ShoppingListView[] = [];
  const stop = phone.data.watchShoppingList((v) => views.push(v));
  return { views, last: () => views[views.length - 1], stop };
}

test('with no signal, checking off, unchecking and adding by hand change the list on the phone and wait to sync', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic, butter } = await listWithGarlicAndButter([phone, other]);
  phone.goOffline();

  await phone.data.checkOff(garlic.id);
  await phone.data.uncheck(butter.id);
  const towels = await phone.data.addManualItem('  Paper towels ');
  await phone.data.addManualItem('Crème fraîche');

  const onPhone = await phone.data.getShoppingList();
  expect(view(onPhone)).toEqual([
    butterLine(false),
    { handAdded: 'Crème fraîche', ingredient: null, checked: false },
    garlicBread(true),
    { handAdded: 'Paper towels', ingredient: null, checked: false },
  ]);
  expect(onPhone.items.find((i) => i.id === garlic.id)?.check).toMatchObject({
    status: 'checked',
    checkedBy: phone.userId,
  });
  expect(await phone.data.getListSync()).toEqual({ status: 'offline', waiting: 4 });

  // None of it has reached the server yet.
  expect(view(await other.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
  expect(await pantryNames(other)).toEqual(['butter']);

  // Removing needs a connection.
  await expect(phone.data.removeFromShoppingList(towels)).rejects.toMatchObject({ code: 'offline' });
  await expect(phone.data.removeFromShoppingList(garlic.id)).rejects.toMatchObject({ code: 'offline' });
  expect(view(await phone.data.getShoppingList())).toHaveLength(4);
});

test('the Shopping List screen is told when changes are waiting to sync, and when they have', async () => {
  const [phone] = await signInOnPhones('shopper', 1);
  const { garlic } = await listWithGarlicAndButter([phone]);
  const screen = watch(phone);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', sync: { status: 'idle', waiting: 0 } }));

  phone.goOffline();
  await phone.data.checkOff(garlic.id);

  await vi.waitFor(() => expect(screen.last()).toMatchObject({ sync: { status: 'offline', waiting: 1 } }));
  const offline = screen.last();
  if (offline.status !== 'loaded') throw new Error('expected the list');
  expect(view(offline.list)).toEqual([butterLine(true), garlicBread(true)]);

  phone.goOnline();
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', sync: { status: 'idle', waiting: 0 } }));
  const synced = screen.last();
  if (synced.status !== 'loaded') throw new Error('expected the list');
  expect(view(synced.list)).toEqual([butterLine(true), garlicBread(true)]);
  screen.stop();
});

test('on reconnect the queued changes are sent in the order they were made, and the server matches the phone', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic, butter } = await listWithGarlicAndButter([phone, other]);
  phone.goOffline();

  // Checked, unchecked, checked again: it ends checked only if they arrive in order.
  await phone.data.checkOff(garlic.id);
  await phone.data.uncheck(garlic.id);
  await phone.data.checkOff(garlic.id);
  await phone.data.uncheck(butter.id);
  // Checking off an item added offline only works if the add arrives first.
  const mayo = await phone.data.addManualItem('HELLMANN’S');
  await phone.data.checkOff(mayo);
  const towels = await phone.data.addManualItem('Paper towels');
  await phone.data.checkOff(towels);
  await phone.data.uncheck(towels);

  phone.goOnline();
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  const expected = [
    butterLine(false),
    garlicBread(true),
    { handAdded: 'HELLMANN’S', ingredient: 'hellmann', checked: true },
    { handAdded: 'Paper towels', ingredient: null, checked: false },
  ];
  expect(view(await other.data.getShoppingList())).toEqual(expected);
  expect(view(await phone.data.getShoppingList())).toEqual(expected);
  expect(await phone.data.getShoppingList()).toEqual(await other.data.getShoppingList());
  expect(await pantryNames(other)).toEqual(['butter', 'garlic', 'hellmann']);
  expect((await itemNamed(other, 'Paper towels')).id).toBe(towels);
});

// Phone B checks garlic off and then unchecks it (its last word: still to buy); phone A checks it
// off, either after both of B's changes or before them. Both are offline, then each reconnects.
test.each([
  { a: 'after', arrivesFirst: 'A', checked: true },
  { a: 'after', arrivesFirst: 'B', checked: true },
  { a: 'before', arrivesFirst: 'A', checked: false },
  { a: 'before', arrivesFirst: 'B', checked: false },
] as const)(
  'two phones changing one item: the change made later wins (A checks $a B, $arrivesFirst arrives first)',
  async ({ a, arrivesFirst, checked }) => {
    const [phoneA, phoneB] = await signInOnPhones('shopper', 2);
    const { garlic } = await listWithGarlicAndButter([phoneA, phoneB]);
    const t = Date.now();
    await sleep(100); // so every change below was made before it arrives
    phoneA.goOffline();
    phoneB.goOffline();

    phoneB.setClock(new Date(t + 10));
    await phoneB.data.checkOff(garlic.id);
    phoneB.setClock(new Date(t + 20));
    await phoneB.data.uncheck(garlic.id);
    phoneA.setClock(new Date(a === 'after' ? t + 30 : t + 5));
    await phoneA.data.checkOff(garlic.id);

    const [first, second] = arrivesFirst === 'A' ? [phoneA, phoneB] : [phoneB, phoneA];
    first.goOnline();
    expect(await first.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    second.goOnline();
    expect(await second.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

    for (const phone of [phoneA, phoneB]) {
      expect(view(await phone.data.getShoppingList())).toEqual([butterLine(true), garlicBread(checked)]);
    }
    // Garlic was checked off at some point either way, so it's in the Pantry.
    expect(await pantryNames(phoneA)).toEqual(['butter', 'garlic']);
  },
);

test('sending the same queue again (an answer lost on the way back) changes nothing', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic, butter } = await listWithGarlicAndButter([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(garlic.id);
  await phone.data.uncheck(butter.id);
  const towels = await phone.data.addManualItem('Paper towels');
  await phone.data.checkOff(towels);
  const queued = phone.saved();

  phone.goOnline();
  await phone.data.syncListChanges();
  const expected = [
    butterLine(false),
    garlicBread(true),
    { handAdded: 'Paper towels', ingredient: null, checked: true },
  ];
  expect(view(await other.data.getShoppingList())).toEqual(expected);

  // The same phone as it was before it synced, sending all four again, twice at once.
  const again = phone.relaunch(queued);
  expect(await again.data.getListSync()).toEqual({ status: 'idle', waiting: 4 });
  await Promise.all([again.data.syncListChanges(), again.data.syncListChanges()]);
  expect(await again.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual(expected);

  // After a later change elsewhere, sending the old queue once more doesn't undo it.
  await other.data.uncheck(garlic.id);
  await phone.relaunch(queued).data.syncListChanges();
  expect(view(await other.data.getShoppingList())).toEqual([
    butterLine(false),
    garlicBread(false),
    { handAdded: 'Paper towels', ingredient: null, checked: true },
  ]);
  expect(await pantryNames(other)).toEqual(['butter', 'garlic']);
});

test('an offline change to an item removed meanwhile is dropped without an error', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic, butter } = await listWithGarlicAndButter([phone, other]);
  const towels = await other.data.addManualItem('Paper towels');
  await phone.data.getShoppingList();
  phone.goOffline();
  await phone.data.checkOff(garlic.id);
  await phone.data.checkOff(towels);
  await phone.data.uncheck(butter.id);

  await other.data.removeFromShoppingList(garlic.id);
  await other.data.removeFromShoppingList(towels);
  phone.goOnline();

  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([butterLine(false)]);
  expect(view(await phone.data.getShoppingList())).toEqual([butterLine(false)]);
  expect(await pantryNames(other)).toEqual(['butter']);
});

test('an add sent again after its item was removed elsewhere (its answer lost) leaves the item removed', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  await listWithGarlicAndButter([phone, other]);
  phone.goOffline();
  const foil = await phone.data.addManualItem('Foil');
  const queued = phone.saved();

  // The add reaches the server, but its answer never reaches the phone: it's still queued there.
  phone.goOnline();
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const lost = phone.relaunch(queued);
  expect(await lost.data.getListSync()).toEqual({ status: 'idle', waiting: 1 });

  // Removed on the other phone, then the add is sent again.
  await other.data.getShoppingList();
  await other.data.removeFromShoppingList(foil);
  expect(await lost.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  expect(view(await other.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
  expect(view(await lost.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
  // Adding it by its id once more is reported as dropped: the item is gone.
  await expect(phone.data.addManualItem('Foil', { id: foil })).rejects.toMatchObject({
    code: 'shopping_list_item_not_found',
  });
  expect(view(await other.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
});

test('an add sent again while its item is being removed elsewhere waits for the removal, and leaves the item removed', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  await listWithGarlicAndButter([phone, other]);
  phone.goOffline();
  const foil = await phone.data.addManualItem('Foil');
  const queued = phone.saved();

  // The add reaches the server, but its answer never reaches the phone: it's still queued there.
  phone.goOnline();
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const lost = phone.relaunch(queued);
  expect(await lost.data.getListSync()).toEqual({ status: 'idle', waiting: 1 });

  // Another phone's removal is under way, not yet committed, when the add is sent again.
  const removal = await holdShoppingListRemoval(foil);
  const resent = lost.data.syncListChanges();
  await removal.waitForWaiting(1);
  await removal.commit();
  expect(await resent).toEqual({ status: 'idle', waiting: 0 });

  expect(view(await other.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
  expect(view(await lost.data.getShoppingList())).toEqual([butterLine(true), garlicBread(false)]);
});

test.each([500, 520, 524])(
  'changes sent while the server fails with %i stay queued, and land on the next sync',
  async (status) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { garlic } = await listWithGarlicAndButter([phone, other]);
    phone.goOffline();
    await phone.data.checkOff(garlic.id);
    const foil = await phone.data.addManualItem('Foil');

    phone.goOnline();
    phone.serverAnswers(status);
    const t0 = Date.now();
    phone.setClock(new Date(t0));
    expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 2));
    // Made while it fails, a change waits too.
    await phone.data.checkOff(foil);
    expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 3));

    phone.serverAnswers(null);
    phone.setClock(new Date(t0 + 10 * SECOND));
    expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    expect(view(await other.data.getShoppingList())).toEqual([
      butterLine(true),
      { handAdded: 'Foil', ingredient: null, checked: true },
      garlicBread(true),
    ]);
  },
);

test('a change the server fails on for about 21 minutes, its first try and 5 more across the backoff, is given up, even across a restart; the changes behind it land, and the user is told', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  const towels = await other.data.addManualItem('Paper towels');
  await phone.data.getShoppingList();
  phone.goOffline();
  await phone.data.checkOff(foil);
  await phone.data.checkOff(towels);

  // Every request to change Foil fails on the server; the rest get through.
  phone.goOnline();
  phone.serverAnswersFor(foil, 500);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 2));
  // Tried again 10 s, 30 s, 1 min, 5 min and 15 min after each failure.
  for (const [at, next] of [
    [10, 40],
    [40, 100],
    [100, 400],
  ]) {
    phone.setClock(new Date(t0 + at * SECOND));
    expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + next * SECOND, 2));
  }
  const reopened = phone.relaunch();
  reopened.setClock(new Date(t0 + 400 * SECOND));
  expect(await reopened.data.syncListChanges()).toEqual(retryingAt(t0 + 1300 * SECOND, 2));
  // The fifth try after the first fails too: Foil's change is given up, and Paper towels' is sent.
  reopened.setClock(new Date(t0 + 1300 * SECOND));
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  const unchanged = { handAdded: 'Foil', ingredient: null, checked: false };
  const sent = { handAdded: 'Paper towels', ingredient: null, checked: true };
  expect(view(await other.data.getShoppingList())).toEqual([unchanged, sent]);
  expect(view(await reopened.data.getShoppingList())).toEqual([unchanged, sent]);
  const screen = watch(reopened);
  await vi.waitFor(() =>
    expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [{ kind: 'checkOff', itemName: 'Foil' }] }),
  );
  screen.stop();
});

test('the notice about a change given up outlives a restart, named as it was even once the item is gone, until the user dismisses it', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  await phone.data.getShoppingList();
  phone.serverAnswersFor(foil, 502);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);
  for (const at of [10, 40, 100, 400, 1300]) {
    phone.setClock(new Date(t0 + at * SECOND));
    await phone.data.syncListChanges();
  }
  expect(await phone.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  await other.data.removeFromShoppingList(foil);

  const reopened = phone.relaunch();
  const screen = watch(reopened);
  await vi.waitFor(() =>
    expect(screen.last()).toMatchObject({
      status: 'loaded',
      list: { items: [] },
      notSaved: [{ kind: 'checkOff', itemName: 'Foil' }],
    }),
  );
  await reopened.data.dismissNotSavedListChanges();
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [] }));
  screen.stop();

  const again = reopened.relaunch();
  const after = watch(again);
  await vi.waitFor(() => expect(after.last()).toMatchObject({ status: 'loaded', list: { items: [] } }));
  expect(after.last()).toMatchObject({ notSaved: [] });
  after.stop();
});

test("a change the server failed on isn't tried again before its next try, whoever asks: a sync, a new change or a restart", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  const towels = await other.data.addManualItem('Paper towels');
  await phone.data.getShoppingList();
  phone.serverAnswersFor(foil, 503);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);
  expect(await phone.data.getListSync()).toEqual(retryingAt(t0 + 10 * SECOND, 1));

  // The server would take it now, but its next try is 10 s after it failed.
  phone.serverAnswersFor(foil, null);
  phone.setClock(new Date(t0 + 5 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 1));
  await phone.data.checkOff(towels);
  const reopened = phone.relaunch();
  reopened.setClock(new Date(t0 + 9 * SECOND));
  expect(await reopened.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 2));
  const neither = [
    { handAdded: 'Foil', ingredient: null, checked: false },
    { handAdded: 'Paper towels', ingredient: null, checked: false },
  ];
  expect(view(await other.data.getShoppingList())).toEqual(neither);

  reopened.setClock(new Date(t0 + 10 * SECOND));
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([
    { handAdded: 'Foil', ingredient: null, checked: true },
    { handAdded: 'Paper towels', ingredient: null, checked: true },
  ]);
});

test('after a 2-minute server outage, tried every 10 s, every change lands once the server is back', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  const towels = await other.data.addManualItem('Paper towels');
  await phone.data.getShoppingList();
  phone.goOffline();
  await phone.data.checkOff(foil);
  await phone.data.checkOff(towels);

  phone.goOnline();
  phone.serverAnswers(500);
  const t0 = Date.now();
  for (let at = 0; at <= 2 * MINUTE; at += 10 * SECOND) {
    phone.setClock(new Date(t0 + at));
    expect(await phone.data.syncListChanges()).toMatchObject({ status: 'waitingToRetry', waiting: 2 });
  }
  phone.serverAnswers(null);
  for (let at = 2 * MINUTE + 10 * SECOND; at <= 7 * MINUTE; at += 10 * SECOND) {
    phone.setClock(new Date(t0 + at));
    await phone.data.syncListChanges();
  }

  expect(await phone.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  const both = [
    { handAdded: 'Foil', ingredient: null, checked: true },
    { handAdded: 'Paper towels', ingredient: null, checked: true },
  ];
  expect(view(await other.data.getShoppingList())).toEqual(both);
  const screen = watch(phone);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [] }));
  screen.stop();
});

test("no signal at a change's next try doesn't count toward giving it up", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  await phone.data.getShoppingList();
  phone.serverAnswersFor(foil, 500);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);
  for (const at of [10, 40, 100, 400]) {
    phone.setClock(new Date(t0 + at * SECOND));
    await phone.data.syncListChanges();
  }
  // Five server errors so far. Then no signal for an hour, tried every 10 minutes.
  phone.goOffline();
  for (let at = 1300 * SECOND; at <= 1300 * SECOND + 60 * MINUTE; at += 10 * MINUTE) {
    phone.setClock(new Date(t0 + at));
    expect(await phone.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
  }
  phone.goOnline();
  phone.serverAnswersFor(foil, null);
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([{ handAdded: 'Foil', ingredient: null, checked: true }]);
});

test("the phone's clock going back a second as a change's last pause starts doesn't send it early; going back more than 15 minutes does", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  await phone.data.getShoppingList();
  phone.serverAnswersFor(foil, 500);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);
  for (const at of [10, 40, 100, 400]) {
    phone.setClock(new Date(t0 + at * SECOND));
    await phone.data.syncListChanges();
  }
  // Five server errors: its last pause, 15 minutes, starts now. The server would take it.
  phone.serverAnswersFor(foil, null);
  phone.setClock(new Date(t0 + 399 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 1300 * SECOND, 1));
  expect(view(await other.data.getShoppingList())).toEqual([{ handAdded: 'Foil', ingredient: null, checked: false }]);

  phone.setClock(new Date(t0 + 400 * SECOND - 16 * MINUTE));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([{ handAdded: 'Foil', ingredient: null, checked: true }]);
});

test("while a change waits out a server error, the list says it will be tried again, not that the phone is offline, and removing another item works", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  const towels = await other.data.addManualItem('Paper towels');
  await phone.data.getShoppingList();
  phone.serverAnswersFor('check_off', 500);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);

  const waiting = retryingAt(t0 + 10 * SECOND, 1);
  expect(await phone.data.getListSync()).toEqual(waiting);
  const screen = watch(phone);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', sync: waiting }));
  await phone.data.removeFromShoppingList(towels);
  expect(await phone.data.getListSync()).toEqual(waiting);
  expect(view(await other.data.getShoppingList())).toEqual([{ handAdded: 'Foil', ingredient: null, checked: false }]);

  // At its next try the server takes it.
  phone.serverAnswersFor('check_off', null);
  phone.setClock(new Date(t0 + 10 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([{ handAdded: 'Foil', ingredient: null, checked: true }]);
  screen.stop();
});

test('removing an item whose change waits out a server error removes it, and the change waiting goes with it', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  await phone.data.getShoppingList();
  phone.serverAnswersFor('check_off', 500);
  phone.serverAnswersFor('add_manual_item', 500);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  await phone.data.checkOff(foil);
  const snacks = await phone.data.addManualItem('Snacks');
  expect(await phone.data.getListSync()).toMatchObject({ status: 'waitingToRetry', waiting: 2 });

  await phone.data.removeFromShoppingList(snacks);
  expect(await phone.data.getListSync()).toMatchObject({ status: 'waitingToRetry', waiting: 1 });
  await phone.data.removeFromShoppingList(foil);
  expect(await phone.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  expect((await phone.data.getShoppingList()).items).toEqual([]);
  expect((await other.data.getShoppingList()).items).toEqual([]);

  // Nothing is sent at their next try, and nothing is given up.
  phone.serverAnswersFor('check_off', null);
  phone.serverAnswersFor('add_manual_item', null);
  phone.setClock(new Date(t0 + 10 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect((await other.data.getShoppingList()).items).toEqual([]);
  const screen = watch(phone);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', list: { items: [] }, notSaved: [] }));
  screen.stop();
});

test('a change the server fails on twice, then takes, lands as usual', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const foil = await other.data.addManualItem('Foil');
  await phone.data.getShoppingList();
  phone.goOffline();
  await phone.data.checkOff(foil);

  phone.goOnline();
  phone.serverAnswersFor(foil, 503);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 10 * SECOND, 1));
  phone.setClock(new Date(t0 + 10 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(t0 + 40 * SECOND, 1));
  phone.serverAnswersFor(foil, null);
  phone.setClock(new Date(t0 + 40 * SECOND));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  const checked = [{ handAdded: 'Foil', ingredient: null, checked: true }];
  expect(view(await other.data.getShoppingList())).toEqual(checked);
  const screen = watch(phone);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [] }));
  expect(view(await phone.data.getShoppingList())).toEqual(checked);
  screen.stop();
});

test('queued changes and the last list seen outlive the app being closed with no signal', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic } = await listWithGarlicAndButter([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(garlic.id);
  await phone.data.addManualItem("Crème fraîche, l'originale");

  const reopened = phone.relaunch();
  expect(view(await reopened.data.getShoppingList())).toEqual([
    butterLine(true),
    { handAdded: "Crème fraîche, l'originale", ingredient: null, checked: false },
    garlicBread(true),
  ]);
  expect(await reopened.data.getListSync()).toEqual({ status: 'offline', waiting: 2 });

  reopened.goOnline();
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([
    butterLine(true),
    { handAdded: "Crème fraîche, l'originale", ingredient: null, checked: false },
    garlicBread(true),
  ]);
});

test('with no signal, a list this phone has never seen fails as offline', async () => {
  const [phone] = await signInOnPhones('shopper', 1);
  phone.goOffline();

  await expect(phone.data.getShoppingList()).rejects.toMatchObject({ code: 'offline' });
  const screen = watch(phone);
  await vi.waitFor(() =>
    expect(screen.last()).toMatchObject({ status: 'failed', error: { code: 'offline' }, sync: { status: 'offline' } }),
  );
  screen.stop();

  phone.goOnline();
  expect((await phone.data.getShoppingList()).items).toEqual([]);
});

test('saved data the app cannot read is ignored: unreadable changes are skipped, the rest still sync', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { garlic } = await listWithGarlicAndButter([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(garlic.id);
  await phone.data.addManualItem('  Ünïcödé snacks ');

  // Corrupt what was saved: the list becomes junk, and junk changes join the queue and those given up.
  const saved = new Map(phone.saved());
  for (const [key, value] of saved) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && 'queue' in parsed && Array.isArray(parsed.queue)) {
      const now = new Date().toISOString();
      saved.set(
        key,
        JSON.stringify({
          queue: [
            { id: 'x', madeAt: 'not a date', change: { kind: 'checkOff', itemId: garlic.id } },
            ...parsed.queue,
            { id: 'y', madeAt: now, change: { kind: 'checkOff', itemId: 'not-a-uuid' } },
            { id: 'z', madeAt: now, change: { kind: 'addManualItem', itemId: garlic.id, text: '   ' } },
            { id: 'w', madeAt: now, change: { kind: 'removeEverything' } },
            null,
            'checkOff',
          ],
          gaveUp: [null, { id: 'v', madeAt: now, change: { kind: 'checkOff', itemId: garlic.id } }, 'Foil'],
        }),
      );
    } else {
      saved.set(key, '{"id": "cut short');
    }
  }
  const reopened = phone.relaunch(saved);
  await expect(reopened.data.getShoppingList()).rejects.toMatchObject({ code: 'offline' });
  expect(await reopened.data.getListSync()).toEqual({ status: 'offline', waiting: 2 });

  reopened.goOnline();
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([
    butterLine(true),
    garlicBread(true),
    { handAdded: 'Ünïcödé snacks', ingredient: null, checked: false },
  ]);
  const screen = watch(reopened);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [] }));
  screen.stop();
});

test('two phones syncing at once, each twice, send every change once', async () => {
  const [phoneA, phoneB] = await signInOnPhones('shopper', 2);
  const { garlic, butter } = await listWithGarlicAndButter([phoneA, phoneB]);
  phoneA.goOffline();
  phoneB.goOffline();
  await Promise.all([phoneA.data.checkOff(garlic.id), phoneA.data.checkOff(garlic.id)]);
  await Promise.all([phoneB.data.uncheck(butter.id), phoneB.data.addManualItem('Foil')]);

  phoneA.goOnline();
  phoneB.goOnline();
  const results = await Promise.all([
    phoneA.data.syncListChanges(),
    phoneA.data.syncListChanges(),
    phoneB.data.syncListChanges(),
    phoneB.data.syncListChanges(),
  ]);

  expect(results).toEqual(Array(4).fill({ status: 'idle', waiting: 0 }));
  expect(view(await phoneA.data.getShoppingList())).toEqual([
    butterLine(false),
    { handAdded: 'Foil', ingredient: null, checked: false },
    garlicBread(true),
  ]);
  expect(await pantryNames(phoneA)).toEqual(['butter', 'garlic']);
});
