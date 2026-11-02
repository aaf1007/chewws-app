// Ticket 16: Cook Logs and the Saved/Cooked filter (decisions 16), through the data layer as real
// signed-in users. A user logs each time they cook one of their Recipes: the day, notes, photos
// (their own images, uploaded first) and the Friends they cooked with; edits and deletes logs. A
// Recipe with a log is Cooked, one with none Saved. Friends read each other's logs; strangers and
// unfriended users don't. Races hold one side in a second database session (CODING_STANDARDS.md).
import { expect, test } from 'vitest';

import type { CookLog, CookLogId, CookLogInput, RecipeId, RecipeInput } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import {
  holdCookLogAdd,
  signInOnPhones,
  holdCookLogCompanionsAdd,
  holdCookLogDelete,
  signInWithUsername,
  storedCookLogPhotos,
  type TestUser,
} from './harness';
import { SCREENSHOT_BASE64, screenshotBytes } from './screenshot-fixture';

type Named = TestUser & { username: string };

async function befriend(a: Named, b: Named) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

const shakshuka: RecipeInput = {
  title: 'Shakshuka',
  lines: [{ originalText: '4 eggs', amountText: '4', ingredientName: 'egg' }],
  steps: ['Simmer the sauce.', 'Crack in the eggs.'],
};

/** A second, different photo (one byte changed), as another picture would be. */
function otherPhoto(): ArrayBuffer {
  const bytes = new Uint8Array(screenshotBytes());
  bytes[bytes.length - 3] ^= 0xff;
  return bytes.buffer;
}
const OTHER_BASE64 = Buffer.from(otherPhoto()).toString('base64');

/** The image behind a Cook Log photo's link, base64; null when it can't be fetched. */
async function fetched(url: string | null): Promise<string | null> {
  if (!url) return null;
  const response = await fetch(url);
  return response.ok ? Buffer.from(await response.arrayBuffer()).toString('base64') : null;
}

/** A log as a screen shows it, with each photo as the image its link gives. */
async function shown(log: CookLog) {
  return { ...log, photos: await Promise.all(log.photos.map(async (p) => ({ id: p.id, image: await fetched(p.url) }))) };
}

/** The day `days` after today on this machine, `YYYY-MM-DD`. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function added(user: TestUser, recipeId: RecipeId, input: CookLogInput): Promise<CookLogId> {
  const result = await user.data.addCookLog(recipeId, input);
  if (result.status !== 'added') throw new Error(`Couldn't add a Cook Log: ${result.status}`);
  return result.cookLogId;
}

/** The user's one log of the Recipe. */
async function onlyLog(user: TestUser, recipeId: RecipeId): Promise<CookLog> {
  const logs = await user.data.listCookLogs(recipeId);
  expect(logs).toHaveLength(1);
  return logs[0];
}

const titles = (recipes: { title: string }[]) => recipes.map((r) => r.title);

test('the user adds a Cook Log with the day, notes, photos and the Friends they cooked with', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(me, sam);
  await befriend(me, jo);
  const recipe = await me.data.createRecipe(shakshuka);

  const result = await me.data.addCookLog(recipe, {
    cookedOn: '2026-10-31',
    notes: "  Too much cumin — Rosa's trick: less. Crème fraîche on top.  ",
    companions: [sam.userId, jo.userId, sam.userId],
    photos: [
      { kind: 'new', jpeg: screenshotBytes() },
      { kind: 'new', jpeg: otherPhoto() },
    ],
  });
  expect(result).toEqual({ status: 'added', cookLogId: expect.any(String) });
  const log = await onlyLog(me, recipe);
  expect(await shown(log)).toEqual({
    id: result.status === 'added' ? result.cookLogId : null,
    recipeId: recipe,
    userId: me.userId,
    cookedOn: '2026-10-31',
    notes: "Too much cumin — Rosa's trick: less. Crème fraîche on top.",
    companions: [
      { id: jo.userId, username: jo.username },
      { id: sam.userId, username: sam.username },
    ].sort((a, b) => a.username.localeCompare(b.username)),
    photos: [
      { id: expect.any(String), image: SCREENSHOT_BASE64 },
      { id: expect.any(String), image: OTHER_BASE64 },
    ],
    cookPlanId: null,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });

  // The photos are the user's own images, in their own folder, under the log.
  expect(await storedCookLogPhotos(me)).toEqual(
    log.photos.map((p) => `${log.id}/${p.id}.jpg`).sort(),
  );

  // Notes are optional; blank is none, and so are companions and photos.
  await added(me, recipe, { cookedOn: '2026-10-01', notes: ' \n\t ' });
  const logs = await me.data.listCookLogs(recipe);
  expect(logs.map((l) => [l.cookedOn, l.notes, l.companions, l.photos])).toEqual([
    ['2026-10-31', "Too much cumin — Rosa's trick: less. Crème fraîche on top.", log.companions, log.photos.map(() => expect.anything())],
    ['2026-10-01', null, [], []],
  ]);
});

test('a Cook Log is dated no later than tomorrow, with notes of at most 2000 characters and at most 4 photos', async () => {
  const me = await signInWithUsername('cook');
  const recipe = await me.data.createRecipe(shakshuka);

  for (const cookedOn of [dayFromToday(2), '2026-02-30', '31/10/2026', '', 'yesterday']) {
    await expect(me.data.addCookLog(recipe, { cookedOn })).rejects.toMatchObject({ code: 'invalid_date' });
  }
  await expect(me.data.addCookLog(recipe, { cookedOn: '2026-10-31', notes: 'é'.repeat(2001) })).rejects.toMatchObject({
    code: 'notes_too_long',
  });
  const five = Array.from({ length: 5 }, () => ({ kind: 'new' as const, jpeg: screenshotBytes() }));
  await expect(me.data.addCookLog(recipe, { cookedOn: '2026-10-31', photos: five })).rejects.toMatchObject({
    code: 'too_many_photos',
  });
  expect(await me.data.listCookLogs(recipe)).toEqual([]);
  expect(await storedCookLogPhotos(me)).toEqual([]);

  // Tomorrow is fine (a late dinner logged past midnight somewhere), and so is a day long ago, and
  // exactly 2000 characters, and 4 photos. A day typed with spaces around it is the day.
  await added(me, recipe, { cookedOn: dayFromToday(1) });
  await added(me, recipe, { cookedOn: ' 2019-02-28 ', notes: 'é'.repeat(2000), photos: five.slice(0, 4) });
  expect((await me.data.listCookLogs(recipe)).map((l) => [l.cookedOn, l.notes?.length ?? 0, l.photos.length])).toEqual([
    [dayFromToday(1), 0, 0],
    ['2019-02-28', 2000, 4],
  ]);
});

test('only Friends can be cooked with, and logging needs one of your own reviewed Recipes', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const stranger = await signInWithUsername('stranger');
  await befriend(me, sam);
  const recipe = await me.data.createRecipe(shakshuka);

  expect(await me.data.addCookLog(recipe, { cookedOn: '2026-10-31', companions: [sam.userId, stranger.userId] })).toEqual({
    status: 'notCompanion',
    userId: stranger.userId,
  });
  expect(await me.data.addCookLog(recipe, { cookedOn: '2026-10-31', companions: [me.userId] })).toEqual({
    status: 'notCompanion',
    userId: me.userId,
  });
  // Someone else's Recipe, and a Draft, can't be logged.
  const samsRecipe = await sam.data.createRecipe(shakshuka);
  expect(await me.data.addCookLog(samsRecipe, { cookedOn: '2026-10-31' })).toEqual({ status: 'noSuchRecipe' });
  const { recipeId: draft } = await me.data.saveFromLink({ url: FULL_RECIPE.url });
  await me.drafts.settled();
  expect(await me.data.addCookLog(draft, { cookedOn: '2026-10-31', photos: [{ kind: 'new', jpeg: screenshotBytes() }] })).toEqual({
    status: 'notReviewed',
  });
  // Nothing was saved, and the photo uploaded for the refused log went again.
  expect(await me.data.listCookLogs(recipe)).toEqual([]);
  expect(await me.data.listCookLogs(draft)).toEqual([]);
  expect(await sam.data.listCookLogs(samsRecipe)).toEqual([]);
  expect(await storedCookLogPhotos(me)).toEqual([]);
});

test('several Cook Logs per Recipe, newest day first; each can be edited or deleted', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(me, sam);
  await befriend(me, jo);
  const recipe = await me.data.createRecipe(shakshuka);
  const first = await added(me, recipe, { cookedOn: '2026-09-01', notes: 'First go', companions: [sam.userId] });
  const second = await added(me, recipe, {
    cookedOn: '2026-10-15',
    notes: 'Second go',
    photos: [{ kind: 'new', jpeg: screenshotBytes() }],
  });
  const third = await added(me, recipe, { cookedOn: '2026-10-15', notes: 'Same day, later' });
  expect((await me.data.listCookLogs(recipe)).map((l) => l.notes)).toEqual(['Same day, later', 'Second go', 'First go']);

  // Edit the first: a new day and notes, jo in place of sam, a photo added.
  const [before] = (await me.data.listCookLogs(recipe)).filter((l) => l.id === first);
  expect(
    await me.data.editCookLog(before, {
      cookedOn: '2026-09-02',
      notes: '  First go: burnt the edges ',
      companions: [jo.userId],
      photos: [{ kind: 'new', jpeg: otherPhoto() }],
    }),
  ).toEqual({ status: 'edited' });
  const [after] = (await me.data.listCookLogs(recipe)).filter((l) => l.id === first);
  expect(await shown(after)).toEqual({
    ...before,
    cookedOn: '2026-09-02',
    notes: 'First go: burnt the edges',
    companions: [{ id: jo.userId, username: jo.username }],
    photos: [{ id: expect.any(String), image: OTHER_BASE64 }],
    updatedAt: expect.any(String),
  });

  // Clearing the notes, and removing the photo, which goes from Storage too.
  const [withPhoto] = (await me.data.listCookLogs(recipe)).filter((l) => l.id === second);
  const photo = withPhoto.photos[0].id;
  expect(await storedCookLogPhotos(me)).toContain(`${second}/${photo}.jpg`);
  expect(await me.data.editCookLog(withPhoto, { cookedOn: withPhoto.cookedOn, notes: '', photos: [] })).toEqual({
    status: 'edited',
  });
  const [cleared] = (await me.data.listCookLogs(recipe)).filter((l) => l.id === second);
  expect([cleared.notes, cleared.photos]).toEqual([null, []]);
  expect(await storedCookLogPhotos(me)).toEqual([`${first}/${after.photos[0].id}.jpg`]);

  // Delete one: the others stay, and the Recipe is still Cooked.
  expect(await me.data.deleteCookLog(third)).toEqual({ status: 'deleted', recipe: 'cooked' });
  expect((await me.data.listCookLogs(recipe)).map((l) => l.id)).toEqual([second, first]);
  // Deleting it again, or editing it, changes nothing and says so.
  expect(await me.data.deleteCookLog(third)).toEqual({ status: 'notFound' });
  expect(await me.data.editCookLog({ ...cleared, id: third }, { cookedOn: '2026-10-16' })).toEqual({ status: 'notFound' });
  // Deleting a log takes its photos with it.
  expect(await me.data.deleteCookLog(first)).toEqual({ status: 'deleted', recipe: 'cooked' });
  expect(await storedCookLogPhotos(me)).toEqual([]);
});

test('a Recipe with a Cook Log is Cooked; deleting its last one makes it Saved again', async () => {
  const me = await signInWithUsername('cook');
  const soup = await me.data.createRecipe({ title: 'Tomato soup', lines: [], steps: [] });
  const bread = await me.data.createRecipe({ title: 'Garlic bread', lines: [], steps: [] });
  await me.data.createRecipe({ title: 'Garlic pasta', lines: [], steps: [] });

  // Nothing cooked yet: all three are Saved, none Cooked.
  expect(titles(await me.data.searchRecipes('', { cooked: false }))).toEqual(['Garlic pasta', 'Garlic bread', 'Tomato soup']);
  expect(await me.data.searchRecipes('', { cooked: true })).toEqual([]);

  const first = await added(me, bread, { cookedOn: '2026-10-01' });
  const second = await added(me, bread, { cookedOn: '2026-10-20' });
  await added(me, soup, { cookedOn: '2026-09-12' });
  expect(await me.data.searchRecipes('', { cooked: true })).toEqual([
    {
      id: bread,
      title: 'Garlic bread',
      lineCount: 0,
      stepCount: 0,
      createdAt: expect.any(String),
      cooked: { count: 2, lastCookedOn: '2026-10-20' },
    },
    {
      id: soup,
      title: 'Tomato soup',
      lineCount: 0,
      stepCount: 0,
      createdAt: expect.any(String),
      cooked: { count: 1, lastCookedOn: '2026-09-12' },
    },
  ]);
  expect(titles(await me.data.searchRecipes('', { cooked: false }))).toEqual(['Garlic pasta']);
  // Searching searches within the tile; all of them, as before, when no tile is given.
  expect(titles(await me.data.searchRecipes('garlic', { cooked: true }))).toEqual(['Garlic bread']);
  expect(titles(await me.data.searchRecipes('garlic', { cooked: false }))).toEqual(['Garlic pasta']);
  expect(titles(await me.data.searchRecipes('garlic'))).toEqual(['Garlic pasta', 'Garlic bread']);
  expect(titles(await me.data.listMyRecipes())).toEqual(['Garlic pasta', 'Garlic bread', 'Tomato soup']);
  expect((await me.data.listMyRecipes()).map((r) => r.cooked)).toEqual([
    undefined,
    { count: 2, lastCookedOn: '2026-10-20' },
    { count: 1, lastCookedOn: '2026-09-12' },
  ]);

  // Want to Cook stays its own list, cooked or not.
  await me.data.setWantToCook(bread, true);
  expect(titles(await me.data.listWantToCook())).toEqual(['Garlic bread']);

  expect(await me.data.deleteCookLog(second)).toEqual({ status: 'deleted', recipe: 'cooked' });
  expect((await me.data.searchRecipes('bread', { cooked: true }))[0]?.cooked).toEqual({ count: 1, lastCookedOn: '2026-10-01' });
  expect(await me.data.deleteCookLog(first)).toEqual({ status: 'deleted', recipe: 'saved' });
  expect(titles(await me.data.searchRecipes('', { cooked: true }))).toEqual(['Tomato soup']);
  expect(titles(await me.data.searchRecipes('', { cooked: false }))).toEqual(['Garlic pasta', 'Garlic bread']);
  expect(titles(await me.data.listWantToCook())).toEqual(['Garlic bread']);
});

test('deleting the last Cook Log while another phone adds one leaves the Recipe Cooked, and the delete says so', async () => {
  const me = await signInWithUsername('cook');
  const recipe = await me.data.createRecipe(shakshuka);
  const last = await added(me, recipe, { cookedOn: '2026-10-01' });

  // The other phone's add is under way (not committed) when this phone deletes the last log.
  const newer = me.data.newCookLogId();
  const add = await holdCookLogAdd(me, newer, recipe, '2026-10-30');
  const deleting = me.data.deleteCookLog(last);
  await add.waitForWaiting(1);
  await add.commit();

  expect(await deleting).toEqual({ status: 'deleted', recipe: 'cooked' });
  expect((await me.data.listCookLogs(recipe)).map((l) => l.id)).toEqual([newer]);
  expect(titles(await me.data.searchRecipes('', { cooked: true }))).toEqual(['Shakshuka']);
  expect(await me.data.searchRecipes('', { cooked: false })).toEqual([]);
});

test('a save sent twice at once makes one Cook Log', async () => {
  const me = await signInWithUsername('cook');
  const recipe = await me.data.createRecipe(shakshuka);
  const id = me.data.newCookLogId();

  const first = await holdCookLogAdd(me, id, recipe, '2026-10-30');
  const again = me.data.addCookLog(recipe, { cookedOn: '2026-10-30' }, { cookLogId: id });
  await first.waitForWaiting(1);
  await first.commit();

  expect(await again).toEqual({ status: 'added', cookLogId: id });
  expect((await me.data.listCookLogs(recipe)).map((l) => [l.id, l.cookedOn])).toEqual([[id, '2026-10-30']]);
  // Sent again later (its answer lost): the same log.
  expect(await me.data.addCookLog(recipe, { cookedOn: '2026-10-30' }, { cookLogId: id })).toEqual({ status: 'added', cookLogId: id });
  expect(await me.data.listCookLogs(recipe)).toHaveLength(1);
});

test('two phones editing one Cook Log at once each keep their change: edits send only what changed', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(me, sam);
  await befriend(me, jo);
  const recipe = await me.data.createRecipe(shakshuka);
  const id = await added(me, recipe, { cookedOn: '2026-10-30', notes: 'Good' });
  const log = await onlyLog(me, recipe);

  // One phone adds sam (not committed yet); this one, from the same log as read, adds jo and
  // changes the notes.
  const other = await holdCookLogCompanionsAdd(me, id, [sam.userId]);
  const editing = me.data.editCookLog(log, { cookedOn: log.cookedOn, notes: 'Great', companions: [jo.userId] });
  await other.waitForWaiting(1);
  await other.commit();

  expect(await editing).toEqual({ status: 'edited' });
  const both = await onlyLog(me, recipe);
  expect([both.notes, both.companions]).toEqual([
    'Great',
    [
      { id: jo.userId, username: jo.username },
      { id: sam.userId, username: sam.username },
    ].sort((a, b) => a.username.localeCompare(b.username)),
  ]);
});

test('two phones deleting one Cook Log at once: one deletes it, the other is told it was not there', async () => {
  const me = await signInWithUsername('cook');
  const recipe = await me.data.createRecipe(shakshuka);
  const id = await added(me, recipe, { cookedOn: '2026-10-30' });

  const other = await holdCookLogDelete(me, id);
  const deleting = me.data.deleteCookLog(id);
  await other.waitForWaiting(1);
  await other.commit();

  expect(await deleting).toEqual({ status: 'notFound' });
  expect(await me.data.listCookLogs(recipe)).toEqual([]);
  expect(await me.data.searchRecipes('', { cooked: true })).toEqual([]);
});

test('a delete sent again after its answer was lost still removes the photos', async () => {
  const [phone] = await signInOnPhones('cook', 1);
  const recipe = await phone.data.createRecipe(shakshuka);
  const id = await added(phone, recipe, { cookedOn: '2026-10-30', photos: [{ kind: 'new', jpeg: screenshotBytes() }] });
  expect(await storedCookLogPhotos(phone)).toHaveLength(1);

  // The delete reaches the server, but the signal drops before its answer comes back.
  phone.loseNextAnswer('delete_cook_log');
  await expect(phone.data.deleteCookLog(id)).rejects.toMatchObject({ code: 'offline' });
  expect(await phone.data.listCookLogs(recipe)).toEqual([]);
  expect(await storedCookLogPhotos(phone)).toHaveLength(1);

  // Sent again: the log is gone already, and its photo goes now.
  expect(await phone.data.deleteCookLog(id)).toEqual({ status: 'notFound' });
  expect(await storedCookLogPhotos(phone)).toEqual([]);
});

test('a Cook Log can have at most 4 photos, however they are added', async () => {
  const me = await signInWithUsername('cook');
  const recipe = await me.data.createRecipe(shakshuka);
  const photos = (n: number) => Array.from({ length: n }, () => ({ kind: 'new' as const, jpeg: screenshotBytes() }));
  await added(me, recipe, { cookedOn: '2026-10-30', photos: photos(3) });
  const log = await onlyLog(me, recipe);
  const saved = log.photos.map((p) => ({ kind: 'saved' as const, id: p.id }));

  await expect(me.data.editCookLog(log, { cookedOn: log.cookedOn, photos: [...saved, ...photos(2)] })).rejects.toMatchObject({
    code: 'too_many_photos',
  });
  // From a copy read before another phone added a fourth: the server counts what's there.
  expect(await me.data.editCookLog(log, { cookedOn: log.cookedOn, photos: [...saved, ...photos(1)] })).toEqual({ status: 'edited' });
  expect(await me.data.editCookLog(log, { cookedOn: log.cookedOn, photos: [...saved, ...photos(1)] })).toEqual({
    status: 'tooManyPhotos',
  });
  const now = await onlyLog(me, recipe);
  expect(now.photos).toHaveLength(4);
  // The refused photo went again; the four on the log stay.
  expect(await storedCookLogPhotos(me)).toEqual(now.photos.map((p) => `${log.id}/${p.id}.jpg`).sort());
  // Swapping one for another keeps it at 4.
  expect(
    await me.data.editCookLog(now, {
      cookedOn: now.cookedOn,
      photos: [...now.photos.slice(1).map((p) => ({ kind: 'saved' as const, id: p.id })), { kind: 'new', jpeg: otherPhoto() }],
    }),
  ).toEqual({ status: 'edited' });
  const swapped = await onlyLog(me, recipe);
  expect(swapped.photos.map((p) => p.id).slice(0, 3)).toEqual(now.photos.slice(1).map((p) => p.id));
  expect(await fetched(swapped.photos[3].url)).toBe(OTHER_BASE64);
});

test('a Friend reads the user’s Cook Logs, photos and companions; a stranger can’t, and an unfriended user no longer can', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  const stranger = await signInWithUsername('stranger');
  await befriend(me, sam);
  await befriend(me, jo);
  const recipe = await me.data.createRecipe(shakshuka);
  await added(me, recipe, {
    cookedOn: '2026-10-30',
    notes: 'With jo',
    companions: [jo.userId],
    photos: [{ kind: 'new', jpeg: screenshotBytes() }],
  });
  const mine = await shown(await onlyLog(me, recipe));
  expect(mine.photos).toEqual([{ id: expect.any(String), image: SCREENSHOT_BASE64 }]);

  // sam, a Friend, reads it all: jo's username though jo isn't his Friend, and the photo.
  expect(await Promise.all((await sam.data.listCookLogs(recipe)).map(shown))).toEqual([mine]);
  expect(await stranger.data.listCookLogs(recipe)).toEqual([]);

  // Unfriended, sam reads nothing of it, and his old link to the photo no longer gives a new one.
  await me.data.unfriend(sam.userId);
  expect(await sam.data.listCookLogs(recipe)).toEqual([]);
  // jo, the companion, still a Friend, reads it.
  expect((await jo.data.listCookLogs(recipe)).map((l) => l.notes)).toEqual(['With jo']);
});

test('a companion stays on the Cook Log after an unfriend, and a Cook Plan co-member can be one without being a Friend', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  const kim = await signInWithUsername('kim');
  await befriend(me, sam);
  await befriend(sam, kim);
  const recipe = await me.data.createRecipe(shakshuka);
  await added(me, recipe, { cookedOn: '2026-10-30', companions: [sam.userId] });
  await me.data.unfriend(sam.userId);

  const log = await onlyLog(me, recipe);
  expect(log.companions).toEqual([{ id: sam.userId, username: sam.username }]);
  // Editing something else keeps him; he can't be added again to another log.
  expect(await me.data.editCookLog(log, { cookedOn: log.cookedOn, notes: 'Still with sam', companions: [sam.userId] })).toEqual({
    status: 'edited',
  });
  expect((await onlyLog(me, recipe)).companions).toEqual([{ id: sam.userId, username: sam.username }]);
  expect(await me.data.addCookLog(recipe, { cookedOn: '2026-10-31', companions: [sam.userId] })).toEqual({
    status: 'notCompanion',
    userId: sam.userId,
  });

  // A plan sam started with kim and the dev user (sam's Friends then): kim, not my Friend, can be
  // logged as cooked with on a log from that plan (ticket 18), but not on any other.
  await befriend(me, sam);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [me.userId, kim.userId] });
  expect(await me.data.addCookLog(recipe, { cookedOn: '2026-10-31', companions: [kim.userId] })).toEqual({
    status: 'notCompanion',
    userId: kim.userId,
  });
  const fromPlan = await me.data.addCookLog(recipe, { cookedOn: '2026-10-31', companions: [kim.userId, sam.userId] }, { cookPlanId: planId });
  expect(fromPlan).toEqual({ status: 'added', cookLogId: expect.any(String) });
  const [planLog] = await me.data.listCookLogs(recipe);
  expect([planLog.cookPlanId, planLog.companions.map((c) => c.id).sort()]).toEqual([planId, [kim.userId, sam.userId].sort()]);
  // Someone who isn't in the plan can't log from it.
  const outsider = await signInWithUsername('outsider');
  const outsiders = await outsider.data.createRecipe(shakshuka);
  expect(await outsider.data.addCookLog(outsiders, { cookedOn: '2026-10-31' }, { cookPlanId: planId })).toEqual({
    status: 'noSuchCookPlan',
  });
});

test('deleting a Recipe deletes its Cook Logs and their photos; a copy of a Recipe has none of its Cook Logs', async () => {
  const me = await signInWithUsername('cook');
  const sam = await signInWithUsername('sam');
  await befriend(me, sam);
  const recipe = await me.data.createRecipe(shakshuka);
  const other = await me.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  await added(me, recipe, { cookedOn: '2026-10-30', photos: [{ kind: 'new', jpeg: screenshotBytes() }] });
  await added(me, recipe, { cookedOn: '2026-10-31', photos: [{ kind: 'new', jpeg: otherPhoto() }] });
  const kept = await added(me, other, { cookedOn: '2026-10-31', photos: [{ kind: 'new', jpeg: otherPhoto() }] });
  const keptPhoto = (await onlyLog(me, other)).photos[0].id;

  // sam copies it from a plan: his copy is Saved, with no Cook Logs (decisions 14).
  const { planId } = await me.data.createCookPlan({ cookOn: null, friends: [sam.userId] });
  expect(await me.data.addRecipeToCookPlan(planId, recipe)).toEqual({ status: 'added' });
  const copy = await sam.data.copyRecipe(recipe);
  if (copy.status !== 'copied') throw new Error('No copy.');
  expect(await sam.data.listCookLogs(copy.recipeId)).toEqual([]);
  expect(titles(await sam.data.searchRecipes('', { cooked: false }))).toEqual(['Shakshuka']);

  await me.data.deleteRecipe(recipe);
  expect(await me.data.listCookLogs(recipe)).toEqual([]);
  expect(await storedCookLogPhotos(me)).toEqual([`${kept}/${keptPhoto}.jpg`]);
  expect(titles(await me.data.searchRecipes('', { cooked: true }))).toEqual(['Toast']);
});
