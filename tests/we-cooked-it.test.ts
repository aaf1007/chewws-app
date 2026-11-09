// Ticket 18: "We cooked it" (decisions 18), through the data layer as real signed-in users. Any
// member marks a Cook Plan cooked, once, for everyone: it moves to the archive, read-only apart from
// checking lines off. Each member is then prompted to log each of its Recipes (their own as it is,
// someone else's on their own copy), with the plan's day and everyone else in it filled in, and to
// rank it, until they've logged them all or tapped "Not now", which is theirs alone. Races hold one
// side in a second database session (CODING_STANDARDS.md).
import { expect, test } from 'vitest';

import type { CookPlan, CookPlanId, CookPlanPrompt, DataLayer, RecipeId } from '../src/data';
import {
  holdCookPlanClaim,
  holdCookPlanMarkCooked,
  holdCookPlanRecipeAddWithLines,
  holdRecipeDelete,
  signInOnPhones,
  signInWithUsername,
  uniqueUsername,
  type TestUser,
} from './harness';

type Named = TestUser & { username: string };

async function befriend(a: Named, b: Named) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** Today on this machine, as `YYYY-MM-DD` (the phone's local day). */
function today(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * sam's plan on `cookOn` with jo and kim (his Friends; jo and kim aren't each other's), holding
 * sam's shakshuka (eggs, butter) and jo's dal.
 */
async function plan(cookOn: string | null = '2026-11-01') {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  const kim = await signInWithUsername('kim');
  await befriend(sam, jo);
  await befriend(sam, kim);
  const { planId } = await sam.data.createCookPlan({ cookOn, friends: [jo.userId, kim.userId] });
  const shakshuka = await sam.data.createRecipe({
    title: 'Shakshuka',
    lines: [
      { originalText: '4 eggs', amountText: '4', ingredientName: 'egg' },
      { originalText: '1 tbsp butter', amountText: '1 tbsp', ingredientName: 'butter' },
    ],
    steps: ['Crack the eggs into the sauce.'],
  });
  const dal = await jo.data.createRecipe({ title: 'Dal', lines: [], steps: ['Simmer.'] });
  expect(await sam.data.addRecipeToCookPlan(planId, shakshuka)).toEqual({ status: 'added' });
  expect(await jo.data.addRecipeToCookPlan(planId, dal)).toEqual({ status: 'added' });
  return { sam, jo, kim, planId, shakshuka, dal };
}

async function cookedPlan(of: Named, planId: CookPlanId): Promise<CookPlan> {
  const found = await of.data.getCookPlan(planId);
  if (!found) throw new Error('No plan.');
  return found;
}

/** The user's prompt for the plan, as the plan screen reads it; null for none. */
async function promptOf(user: Named, planId: CookPlanId): Promise<CookPlanPrompt | null> {
  const [prompt] = await user.data.cookPlanPrompts([await cookedPlan(user, planId)]);
  return prompt ?? null;
}

/** What each Recipe of a prompt offers, by title: `{ Shakshuka: 'saveYourCopy' }`. */
const steps = (prompt: CookPlanPrompt | null) =>
  Object.fromEntries((prompt?.recipes ?? []).map(({ recipe, step }) => [recipe.title, step.kind]));

/** Logs `recipe` as the prompt fills the form in: its day, everyone else in the plan, and the plan. */
async function logFromPrompt(user: Named, prompt: CookPlanPrompt, recipe: RecipeId) {
  return user.data.addCookLog(
    recipe,
    { cookedOn: prompt.cookedOn, companions: prompt.companions.map((c) => c.id) },
    { cookPlanId: prompt.planId },
  );
}

const statusOf = async (data: DataLayer, planId: CookPlanId) => (await data.getCookPlan(planId))?.status;

test('"We cooked it" marks the plan cooked for every member at once; marking it again changes nothing; a stranger can’t', async () => {
  const { sam, jo, kim, planId } = await plan();
  const stranger = await signInWithUsername('stranger');

  expect(await stranger.data.markCookPlanCooked(planId)).toEqual({ status: 'notFound' });
  expect(await statusOf(sam.data, planId)).toBe('active');

  expect(await jo.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });
  const forSam = await cookedPlan(sam, planId);
  expect(forSam).toMatchObject({ status: 'cooked', cookedBy: jo.userId, cookedAt: expect.any(String) });
  expect(await cookedPlan(kim, planId)).toEqual(forSam);
  expect(await cookedPlan(jo, planId)).toEqual(forSam);

  // Twice is once: still jo's, still when jo marked it.
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'alreadyCooked' });
  expect(await jo.data.markCookPlanCooked(planId)).toEqual({ status: 'alreadyCooked' });
  expect(await cookedPlan(kim, planId)).toEqual(forSam);
});

test('the archive: the Cook Plans list shows active plans newest first, then cooked ones, the most recently cooked first', async () => {
  const sam = await signInWithUsername('sam');
  const first = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  const second = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  const third = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  const fourth = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  expect(await sam.data.markCookPlanCooked(second.planId)).toEqual({ status: 'cooked' });
  expect(await sam.data.markCookPlanCooked(first.planId)).toEqual({ status: 'cooked' });

  const plans = await sam.data.listCookPlans();
  expect(plans.map((p) => [p.id, p.status])).toEqual([
    [fourth.planId, 'active'],
    [third.planId, 'active'],
    [first.planId, 'cooked'],
    [second.planId, 'cooked'],
  ]);
});

test('a cooked plan is read-only: invites, Recipes added or removed, a new day, Claims and unclaims are refused; check-offs still work; members may still leave', async () => {
  const { sam, jo, kim, planId, shakshuka } = await plan();
  const alex = await signInWithUsername('alex');
  await befriend(sam, alex);
  const toast = await sam.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const list = await sam.data.getCookPlanList(planId);
  const [butter, egg] = ['butter', 'egg'].map((name) => {
    const found = list.items.find((i) => i.ingredient.name === name);
    if (!found) throw new Error(`No ${name} line.`);
    return found;
  });
  await sam.data.claim(planId, egg.id);
  expect(await kim.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });
  const before = await cookedPlan(sam, planId);

  expect(await sam.data.inviteToCookPlan(planId, alex.userId)).toEqual({ status: 'notActive' });
  expect(await sam.data.addRecipeToCookPlan(planId, toast)).toEqual({ status: 'notActive' });
  expect(await jo.data.removeRecipeFromCookPlan(planId, shakshuka)).toEqual({ status: 'notActive' });
  expect(await jo.data.setCookPlanDate(planId, '2026-12-24')).toEqual({ status: 'notActive' });
  await expect(jo.data.claim(planId, egg.id)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  await expect(sam.data.unclaim(planId, egg.id)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  expect(await cookedPlan(sam, planId)).toEqual(before);

  await jo.data.checkOffCookPlanItem(planId, butter.id);
  const after = await sam.data.getCookPlanList(planId);
  expect(after.items.map((i) => [i.ingredient.name, i.claim.status, i.check.status])).toEqual([
    ['butter', 'unclaimed', 'checked'],
    ['egg', 'claimed', 'unchecked'],
  ]);
  expect((await jo.data.getPantry()).ingredients.map((i) => i.name)).toEqual(['butter']);

  // Leaving is still allowed (decisions 14: members can always leave); the others keep the archive.
  expect(await kim.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: false });
  expect(await statusOf(kim.data, planId)).toBeUndefined();
  expect((await cookedPlan(sam, planId)).members.map((m) => m.id)).toEqual([sam.userId, jo.userId]);
});

test('each member is prompted to log every Recipe: their own as it is, someone else’s after saving their copy, with the day and everyone else filled in', async () => {
  const { sam, jo, kim, planId, shakshuka, dal } = await plan('2026-11-01');
  // No prompt while the plan is active.
  expect(await jo.data.cookPlanPrompts([await cookedPlan(jo, planId)])).toEqual([]);
  await sam.data.markCookPlanCooked(planId);

  const forJo = await promptOf(jo, planId);
  expect(forJo).toEqual({
    planId,
    cookedOn: '2026-11-01',
    companions: [
      { id: sam.userId, username: sam.username },
      { id: kim.userId, username: kim.username },
    ],
    recipes: [
      { recipe: expect.objectContaining({ id: shakshuka, title: 'Shakshuka' }), step: { kind: 'saveYourCopy' } },
      { recipe: expect.objectContaining({ id: dal, title: 'Dal' }), step: { kind: 'logYours' } },
    ],
  });
  expect(steps(await promptOf(sam, planId))).toEqual({ Shakshuka: 'logYours', Dal: 'saveYourCopy' });
  expect(steps(await promptOf(kim, planId))).toEqual({ Shakshuka: 'saveYourCopy', Dal: 'saveYourCopy' });
  if (!forJo) throw new Error('No prompt.');

  // jo logs his own dal from the prompt: the Cook Log lists the other members, and the plan.
  expect(await logFromPrompt(jo, forJo, dal)).toMatchObject({ status: 'added' });
  const [dalLog] = await jo.data.listCookLogs(dal);
  expect(dalLog).toMatchObject({
    cookedOn: '2026-11-01',
    cookPlanId: planId,
    companions: [
      { id: kim.userId, username: kim.username },
      { id: sam.userId, username: sam.username },
    ],
  });
  expect(steps(await promptOf(jo, planId))).toEqual({ Shakshuka: 'saveYourCopy', Dal: 'logged' });

  // sam's shakshuka: jo saves his own copy first, which the prompt then offers ("Use your copy").
  const copied = await jo.data.copyRecipe(shakshuka);
  if (copied.status !== 'copied') throw new Error('No copy.');
  const withCopy = await promptOf(jo, planId);
  expect(withCopy?.recipes.map((r) => r.step)).toEqual([{ kind: 'useYourCopy', copyId: copied.recipeId }, { kind: 'logged' }]);
  if (!withCopy) throw new Error('No prompt.');

  // The log goes on jo's copy, never on sam's Recipe; logging it is the last, so jo's prompt goes.
  expect(await logFromPrompt(jo, withCopy, shakshuka)).toEqual({ status: 'noSuchRecipe' });
  expect(await logFromPrompt(jo, withCopy, copied.recipeId)).toMatchObject({ status: 'added' });
  expect(await promptOf(jo, planId)).toBeNull();
  expect(await sam.data.listCookLogs(shakshuka)).toEqual([]);
  const [copyLog] = await jo.data.listCookLogs(copied.recipeId);
  expect(copyLog.companions.map((c) => c.id).sort()).toEqual([sam.userId, kim.userId].sort());

  // ... and so does the Ranking: jo ranks his copy, now Cooked.
  const session = await jo.data.startRanking(copied.recipeId, 'liked');
  expect(await jo.data.placeInRanking(session)).toEqual({ status: 'placed', band: 'liked', position: 1, score: 8.4 });
  expect((await jo.data.getRanking()).liked.map((r) => [r.recipeId, r.title])).toEqual([[copied.recipeId, 'Shakshuka']]);

  // The others' prompts are their own: still as they were.
  expect(steps(await promptOf(sam, planId))).toEqual({ Shakshuka: 'logYours', Dal: 'saveYourCopy' });
  expect(steps(await promptOf(kim, planId))).toEqual({ Shakshuka: 'saveYourCopy', Dal: 'saveYourCopy' });
});

test('a Cook Log only counts for the prompt when it came from this plan, on the Recipe or any copy of it', async () => {
  const { sam, jo, planId, shakshuka } = await plan();
  const older = await jo.data.copyRecipe(shakshuka);
  const newer = await jo.data.copyRecipe(shakshuka);
  if (older.status !== 'copied' || newer.status !== 'copied') throw new Error('No copies.');
  await sam.data.markCookPlanCooked(planId);

  // "Use your copy" offers the newest.
  expect((await promptOf(jo, planId))?.recipes[0].step).toEqual({ kind: 'useYourCopy', copyId: newer.recipeId });
  // A log of the copy that didn't come from the plan doesn't count.
  expect((await jo.data.addCookLog(older.recipeId, { cookedOn: today() })).status).toBe('added');
  expect(steps(await promptOf(jo, planId))).toEqual({ Shakshuka: 'useYourCopy', Dal: 'logYours' });
  // One from the plan on the older copy does.
  expect((await jo.data.addCookLog(older.recipeId, { cookedOn: today() }, { cookPlanId: planId })).status).toBe('added');
  expect(steps(await promptOf(jo, planId))).toEqual({ Shakshuka: 'logged', Dal: 'logYours' });
});

test.each([
  ['the plan’s day, when it has passed', -3, -3],
  ['the plan’s day, when it is today', 0, 0],
  ['the day it was cooked, when the plan’s day is still to come', 5, 0],
  ['the day it was cooked, when the plan has no day', null, 0],
] as const)('a Cook Log from the prompt starts on %s', async (_, planDay, logDay) => {
  const { sam, planId } = await plan(planDay === null ? null : today(planDay));
  await sam.data.markCookPlanCooked(planId);
  expect((await promptOf(sam, planId))?.cookedOn).toBe(today(logDay));
});

test('a prompt opened days later starts on the day it was cooked when the plan’s day came after the cook, though that day has passed by now', async () => {
  const [jo] = await signInOnPhones('jo', 1);
  const chosen = await jo.data.setUsername(uniqueUsername('jo'));
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  const sam = await signInWithUsername('sam');
  expect(await sam.data.sendFriendRequest(jo.userId)).toEqual({ status: 'requested' });
  expect(await jo.data.respondToFriendRequest(sam.userId, true)).toEqual({ status: 'accepted' });
  // Planned for the day after tomorrow, cooked today, and the prompt opened five days from now.
  const { planId } = await sam.data.createCookPlan({ cookOn: today(2), friends: [jo.userId] });
  await sam.data.addRecipeToCookPlan(planId, await sam.data.createRecipe({ title: 'Soup', lines: [], steps: [] }));
  expect(await sam.data.markCookPlanCooked(planId)).toEqual({ status: 'cooked' });
  const later = new Date();
  later.setDate(later.getDate() + 5);
  jo.setClock(later);

  const plan = await jo.data.getCookPlan(planId);
  if (!plan) throw new Error('No plan.');
  expect((await jo.data.cookPlanPrompts([plan]))[0]?.cookedOn).toBe(today(0));
});

test('"Not now" takes the prompt away for the member who tapped it only; there is none to dismiss before the plan is cooked', async () => {
  const { sam, jo, kim, planId } = await plan();
  expect(await jo.data.dismissCookPlanPrompt(planId)).toEqual({ status: 'notCooked' });
  await sam.data.markCookPlanCooked(planId);

  expect(await jo.data.dismissCookPlanPrompt(planId)).toEqual({ status: 'dismissed' });
  expect(await jo.data.dismissCookPlanPrompt(planId)).toEqual({ status: 'dismissed' });
  expect(await promptOf(jo, planId)).toBeNull();
  expect(steps(await promptOf(sam, planId))).toEqual({ Shakshuka: 'logYours', Dal: 'saveYourCopy' });
  expect(steps(await promptOf(kim, planId))).toEqual({ Shakshuka: 'saveYourCopy', Dal: 'saveYourCopy' });
  // The plan is still in jo's archive; only the prompt went.
  expect(await statusOf(jo.data, planId)).toBe('cooked');
});

test('the prompt names every other member as cooked with, Friends or not, and the log keeps them after an unfriend', async () => {
  const { sam, jo, kim, planId, dal } = await plan();
  await sam.data.markCookPlanCooked(planId);
  // jo and kim were never Friends; sam and jo stop being Friends now.
  await sam.data.unfriend(jo.userId);

  const prompt = await promptOf(jo, planId);
  if (!prompt) throw new Error('No prompt.');
  expect(prompt.companions.map((c) => c.id)).toEqual([sam.userId, kim.userId]);
  expect(await logFromPrompt(jo, prompt, dal)).toMatchObject({ status: 'added' });
  expect((await jo.data.listCookLogs(dal))[0].companions.map((c) => c.id).sort()).toEqual([sam.userId, kim.userId].sort());
  // Without the plan they're not his to name.
  expect(await jo.data.addCookLog(dal, { cookedOn: today(), companions: [kim.userId] })).toEqual({
    status: 'notCompanion',
    userId: kim.userId,
  });
});

test('two members marking the plan cooked at once mark it once: the second waits, then hears it is already cooked', async () => {
  const { sam, jo, kim, planId } = await plan();
  const held = await holdCookPlanMarkCooked(sam, planId);
  const second = jo.data.markCookPlanCooked(planId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await second).toEqual({ status: 'alreadyCooked' });
  expect(await cookedPlan(kim, planId)).toMatchObject({ status: 'cooked', cookedBy: sam.userId });
});

test('a Recipe added, removed or Claimed while the plan is being marked cooked waits for it, then is refused', async () => {
  const { sam, jo, planId, shakshuka } = await plan();
  const toast = await jo.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const egg = (await jo.data.getCookPlanList(planId)).items.find((i) => i.ingredient.name === 'egg');
  if (!egg) throw new Error('No egg line.');

  const held = await holdCookPlanMarkCooked(sam, planId);
  const added = jo.data.addRecipeToCookPlan(planId, toast);
  const removed = jo.data.removeRecipeFromCookPlan(planId, shakshuka);
  // Caught at once: it's refused before the others are awaited.
  const claimed = jo.data.claim(planId, egg.id).then(
    () => 'claimed',
    (e: unknown) => e,
  );
  await held.waitForWaiting(3);
  await held.commit();

  expect(await added).toEqual({ status: 'notActive' });
  expect(await removed).toEqual({ status: 'notActive' });
  expect(await claimed).toMatchObject({ code: 'cook_plan_item_gone' });
  const after = await cookedPlan(sam, planId);
  expect(after.recipes.map((r) => r.title)).toEqual(['Shakshuka', 'Dal']);
  expect((await sam.data.getCookPlanList(planId)).items.map((i) => [i.ingredient.name, i.claim.status])).toEqual([
    ['butter', 'unclaimed'],
    ['egg', 'unclaimed'],
  ]);
});

test('marking the plan cooked while a Recipe is being added or a line Claimed waits for them: they are in the cooked plan, and the Recipe is in the prompt', async () => {
  const { sam, jo, kim, planId } = await plan();
  const toast = await kim.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const egg = (await jo.data.getCookPlanList(planId)).items.find((i) => i.ingredient.name === 'egg');
  if (!egg) throw new Error('No egg line.');

  const adding = await holdCookPlanRecipeAddWithLines(kim, planId, toast, []);
  const marked = sam.data.markCookPlanCooked(planId);
  await adding.waitForWaiting(1);
  await adding.commit();
  expect(await marked).toEqual({ status: 'cooked' });
  expect(steps(await promptOf(kim, planId))).toEqual({ Shakshuka: 'saveYourCopy', Dal: 'saveYourCopy', Toast: 'logYours' });

  // A Claim, the same way, on another plan.
  const other = await plan();
  const otherEgg = (await other.jo.data.getCookPlanList(other.planId)).items.find((i) => i.ingredient.name === 'egg');
  if (!otherEgg) throw new Error('No egg line.');
  const claiming = await holdCookPlanClaim(other.jo, other.planId, otherEgg.id, new Date());
  const markedToo = other.sam.data.markCookPlanCooked(other.planId);
  await claiming.waitForWaiting(1);
  await claiming.commit();
  expect(await markedToo).toEqual({ status: 'cooked' });
  const claim = (await other.sam.data.getCookPlanList(other.planId)).items.find((i) => i.id === otherEgg.id)?.claim;
  expect(claim).toMatchObject({ status: 'claimed', claimedBy: other.jo.userId });
});

test('saving a copy for the prompt while its owner deletes the Recipe waits for the delete, then finds nothing to copy; the Recipe leaves the prompt', async () => {
  const { sam, jo, planId, shakshuka } = await plan();
  await sam.data.markCookPlanCooked(planId);

  const deleting = await holdRecipeDelete(sam, shakshuka);
  const copying = jo.data.copyRecipe(shakshuka);
  await deleting.waitForWaiting(1);
  await deleting.commit();

  expect(await copying).toEqual({ status: 'notFound' });
  expect(steps(await promptOf(jo, planId))).toEqual({ Dal: 'logYours' });
  expect((await jo.data.listMyRecipes()).map((r) => r.title)).toEqual(['Dal']);
});

