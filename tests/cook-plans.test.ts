// Ticket 14: Cook Plans (decisions 14), through the data layer as real signed-in users. A user
// starts a plan, with or without a day, and invites their Friends, who are in it at once and get a
// push. Members add their own Recipes and remove any; every member reads every Recipe in the plan
// and saves their own, independent copy (ADR-0002). Unfriended co-members stay, but can't invite
// each other again. Races hold one side in a second database session (CODING_STANDARDS.md).
import { expect, test } from 'vitest';

import type { CookPlanId, Recipe, RecipeId, RecipeInput, UserId } from '../src/data';
import { FULL_RECIPE, YOUTUBE_SHORT } from '../supabase/functions/_shared/draft-fixtures';
import {
  backdateSourceVideo,
  cookPlanExists,
  holdCookPlanInvite,
  holdCookPlanLeave,
  holdCookPlanRecipeAdd,
  holdRecipeEdit,
  holdUnfriend,
  runYouTubeExpiryJob,
  seedFriendships,
  seedUsersWithUsernames,
  signInWithUsername,
  sourceVideoOf,
  type TestUser,
} from './harness';

type Named = TestUser & { username: string };

const TOKEN = 'ExponentPushToken[cookplaninvite000001]';

async function befriend(a: Named, b: Named) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

const garlicBread: RecipeInput = {
  title: 'Garlic bread',
  lines: [
    { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
    { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
  ],
  steps: ['Mash the garlic into the butter.', 'Spread and bake.'],
};

const lemonade: RecipeInput = { title: 'Lemonade', lines: [], steps: [] };

/** A Recipe as its owner sees it, as the input that would make it again. */
function asInput(recipe: Recipe | null): RecipeInput {
  if (!recipe) throw new Error('No Recipe.');
  return {
    title: recipe.title,
    lines: recipe.lines.map((l) => ({ originalText: l.originalText, amountText: l.amountText, ingredientName: l.ingredient.name })),
    steps: recipe.steps,
  };
}

/** A TikTok saved, built and reviewed: a Recipe of `user`'s with a Source Video, Tagged and marked Want to Cook. */
async function savedTikTok(user: Named): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink({ url: FULL_RECIPE.url });
  await user.drafts.settled();
  await user.data.reviewDraft(recipeId, asInput(await user.data.getRecipe(recipeId)), ['Italian']);
  await user.data.setWantToCook(recipeId, true);
  return recipeId;
}

/** sam starts a plan on 2 Nov 2026 and invites jo, a Friend. */
async function samAndJo() {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  const { planId, invites } = await sam.data.createCookPlan({ cookOn: '2026-11-02', friends: [jo.userId] });
  expect(invites).toEqual([{ friendId: jo.userId, status: 'invited' }]);
  return { sam, jo, planId };
}

const titles = (recipes: { title: string }[]) => recipes.map((r) => r.title);

test('a user starts a Cook Plan on a day and invites a Friend: it appears for both, with everyone in it', async () => {
  const { sam, jo, planId } = await samAndJo();

  const forSam = await sam.data.listCookPlans();
  const forJo = await jo.data.listCookPlans();

  const plan = {
    id: planId,
    status: 'active',
    creatorId: sam.userId,
    cookOn: '2026-11-02',
    createdAt: expect.any(String),
    members: [
      { id: sam.userId, username: sam.username, invitedBy: null, joinedAt: expect.any(String) },
      { id: jo.userId, username: jo.username, invitedBy: sam.userId, joinedAt: expect.any(String) },
    ],
    recipes: [],
  };
  expect(forSam).toEqual([plan]);
  expect(forJo).toEqual([plan]);
  expect(await jo.data.getCookPlan(planId)).toEqual(plan);
});

test('a Cook Plan needs no day; any member sets, changes or clears it, past days too; a day that is not one is refused', async () => {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  const dayOf = async () => (await sam.data.getCookPlan(planId))?.cookOn;

  expect(await dayOf()).toBeNull();
  expect(await jo.data.setCookPlanDate(planId, '2026-12-24')).toEqual({ status: 'set' });
  expect(await dayOf()).toBe('2026-12-24');
  expect(await sam.data.setCookPlanDate(planId, '2020-02-29')).toEqual({ status: 'set' });
  expect(await dayOf()).toBe('2020-02-29');
  expect(await jo.data.setCookPlanDate(planId, null)).toEqual({ status: 'set' });
  expect(await dayOf()).toBeNull();

  for (const day of ['2026-02-30', '2026-13-01', '24/12/2026', '', ' ', '2026-12-24T10:00']) {
    await expect(sam.data.setCookPlanDate(planId, day), day).rejects.toMatchObject({ code: 'invalid_date' });
    await expect(sam.data.createCookPlan({ cookOn: day, friends: [] }), day).rejects.toMatchObject({ code: 'invalid_date' });
  }
  expect(await dayOf()).toBeNull();
  expect((await sam.data.listCookPlans()).map((p) => p.id)).toEqual([planId]);
});

test('only Friends are invited: a stranger, yourself and someone already in it are refused and change nothing', async () => {
  const { sam, jo, planId } = await samAndJo();
  const stranger = await signInWithUsername('stranger');
  const before = await sam.data.getCookPlan(planId);

  expect(await sam.data.inviteToCookPlan(planId, stranger.userId)).toEqual({ status: 'notFriends' });
  expect(await sam.data.inviteToCookPlan(planId, sam.userId)).toEqual({ status: 'notFriends' });
  expect(await sam.data.inviteToCookPlan(planId, jo.userId)).toEqual({ status: 'alreadyMember' });
  // A plan the inviter isn't in.
  expect(await stranger.data.inviteToCookPlan(planId, stranger.userId)).toEqual({ status: 'notFound' });

  expect(await sam.data.getCookPlan(planId)).toEqual(before);
  expect(await stranger.data.listCookPlans()).toEqual([]);
  expect(sam.notifications.pushesSent()).toEqual([]);
});

test('any member invites their own Friends, who need not be Friends with the others', async () => {
  const { sam, jo, planId } = await samAndJo();
  const kim = await signInWithUsername('kim');
  await befriend(jo, kim);

  expect(await sam.data.inviteToCookPlan(planId, kim.userId)).toEqual({ status: 'notFriends' });
  expect(await jo.data.inviteToCookPlan(planId, kim.userId)).toEqual({ status: 'invited' });

  // sam and kim aren't Friends, but each sees the other in the plan, and whose its Recipes are.
  const kims = await kim.data.createRecipe(lemonade);
  await kim.data.addRecipeToCookPlan(planId, kims);
  const plan = await sam.data.getCookPlan(planId);
  expect(plan?.members.map((m) => [m.username, m.invitedBy])).toEqual([
    [sam.username, null],
    [jo.username, sam.userId],
    [kim.username, jo.userId],
  ]);
  expect(plan?.recipes.map((r) => r.owner)).toEqual([{ id: kim.userId, username: kim.username }]);
  expect(await sam.data.getRecipe(kims)).toMatchObject({ owner: { id: kim.userId, username: kim.username } });
  expect(await sam.data.getProfile(kim.userId)).toEqual({ id: kim.userId, username: kim.username });

  // Once kim leaves, her Recipe stays in the plan, but sam no longer sees who she is.
  await kim.data.leaveCookPlan(planId);
  expect((await sam.data.getCookPlan(planId))?.recipes.map((r) => r.owner)).toEqual([{ id: kim.userId, username: null }]);
  expect(await sam.data.getRecipe(kims)).toMatchObject({ owner: { id: kim.userId, username: null } });
  expect(await sam.data.getProfile(kim.userId)).toBeNull();
});

test('an invited Friend gets one "Cook Plan invite" push naming the plan; leaving and being invited again sends none', async () => {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  await jo.data.registerPushToken(TOKEN);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  await sam.data.addRecipeToCookPlan(planId, await sam.data.createRecipe(garlicBread));
  await sam.data.addRecipeToCookPlan(planId, await sam.data.createRecipe(lemonade));

  expect(await sam.data.inviteToCookPlan(planId, jo.userId)).toEqual({ status: 'invited' });
  expect(await jo.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: false });
  expect(await sam.data.inviteToCookPlan(planId, jo.userId)).toEqual({ status: 'invited' });

  expect(sam.notifications.pushesSent()).toEqual([
    {
      to: TOKEN,
      title: 'Cook Plan invite',
      body: `@${sam.username} invited you to cook: Garlic bread, Lemonade`,
      data: { kind: 'cookPlanInvite', cookPlanId: planId },
    },
  ]);
});

test("a co-member can't send the invite push for someone they didn't invite; it stays due for the one who did", async () => {
  // sam's kick for his invite never arrives, so kim's push is still due.
  const sam = await signInWithUsername('sam', { loseNotifyKicks: 1 });
  const jo = await signInWithUsername('jo');
  const kim = await signInWithUsername('kim');
  await befriend(jo, sam);
  await befriend(kim, sam);
  await kim.data.registerPushToken(TOKEN);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  expect(await sam.data.inviteToCookPlan(planId, kim.userId)).toEqual({ status: 'invited' });
  expect(await sam.data.inviteToCookPlan(planId, jo.userId)).toEqual({ status: 'invited' });
  expect(sam.notifications.pushesSent()).toEqual([]);

  await jo.notifications.kick({ kind: 'cookPlanInvite', cookPlanId: planId, toUserId: kim.userId });
  expect(jo.notifications.pushesSent()).toEqual([]);

  await sam.notifications.kick({ kind: 'cookPlanInvite', cookPlanId: planId, toUserId: kim.userId });
  expect(sam.notifications.pushesSent()).toEqual([
    {
      to: TOKEN,
      title: 'Cook Plan invite',
      body: `@${sam.username} invited you to cook`,
      data: { kind: 'cookPlanInvite', cookPlanId: planId },
    },
  ]);
});

test('a plan with no Recipes yet: the push says only who invited you', async () => {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  await jo.data.registerPushToken(TOKEN);

  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });

  expect(sam.notifications.pushesSent()).toEqual([
    {
      to: TOKEN,
      title: 'Cook Plan invite',
      body: `@${sam.username} invited you to cook`,
      data: { kind: 'cookPlanInvite', cookPlanId: planId },
    },
  ]);
});

test('a kick that never arrives, or a push that fails, never fails the invite', async () => {
  const sam = await signInWithUsername('sam', { pushFails: true, loseNotifyKicks: 1 });
  const jo = await signInWithUsername('jo');
  const kim = await signInWithUsername('kim');
  await befriend(jo, sam);
  await befriend(kim, sam);
  await jo.data.registerPushToken(TOKEN);
  await kim.data.registerPushToken('ExponentPushToken[cookplaninvite000002]');
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [] });

  expect(await sam.data.inviteToCookPlan(planId, jo.userId)).toEqual({ status: 'invited' });
  expect(await sam.data.inviteToCookPlan(planId, kim.userId)).toEqual({ status: 'invited' });
  expect((await jo.data.listCookPlans()).map((p) => p.id)).toEqual([planId]);
  expect((await kim.data.listCookPlans()).map((p) => p.id)).toEqual([planId]);
});

test('any member adds their own reviewed Recipes and removes any Recipe, with no voting; everyone sees the same', async () => {
  const { sam, jo, planId } = await samAndJo();
  const bread = await sam.data.createRecipe(garlicBread);
  const drink = await jo.data.createRecipe(lemonade);

  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  expect(await jo.data.addRecipeToCookPlan(planId, drink)).toEqual({ status: 'added' });
  const both = await jo.data.getCookPlan(planId);
  expect(both?.recipes).toEqual([
    { id: bread, title: 'Garlic bread', owner: { id: sam.userId, username: sam.username }, addedBy: sam.userId, addedAt: expect.any(String) },
    { id: drink, title: 'Lemonade', owner: { id: jo.userId, username: jo.username }, addedBy: jo.userId, addedAt: expect.any(String) },
  ]);
  expect((await sam.data.getCookPlan(planId))?.recipes).toEqual(both?.recipes);

  // jo takes off sam's Recipe; sam takes off jo's.
  expect(await jo.data.removeRecipeFromCookPlan(planId, bread)).toEqual({ status: 'removed' });
  expect(titles((await sam.data.getCookPlan(planId))?.recipes ?? [])).toEqual(['Lemonade']);
  expect(await sam.data.removeRecipeFromCookPlan(planId, drink)).toEqual({ status: 'removed' });
  expect((await jo.data.getCookPlan(planId))?.recipes).toEqual([]);
  // The Recipes themselves stay their owners'.
  expect((await sam.data.getRecipe(bread))?.title).toBe('Garlic bread');
  expect((await jo.data.getRecipe(drink))?.title).toBe('Lemonade');
});

test("adding someone else's Recipe or a Draft, adding twice and removing what isn't there change nothing and say so", async () => {
  const { sam, jo, planId } = await samAndJo();
  const bread = await sam.data.createRecipe(garlicBread);
  const { recipeId: draft } = await jo.data.saveFromLink({ url: FULL_RECIPE.url });
  await jo.drafts.settled();
  const drink = await jo.data.createRecipe(lemonade);
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  const before = await sam.data.getCookPlan(planId);

  expect(await jo.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'noSuchRecipe' });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'alreadyAdded' });
  expect(await sam.data.addRecipeToCookPlan(planId, drink)).toEqual({ status: 'noSuchRecipe' });
  expect(await jo.data.addRecipeToCookPlan(planId, draft)).toEqual({ status: 'noSuchRecipe' });
  expect(await jo.data.removeRecipeFromCookPlan(planId, drink)).toEqual({ status: 'notInPlan' });

  expect(await sam.data.getCookPlan(planId)).toEqual(before);
});

test("every member reads every Recipe in the plan, with its lines, steps and Source Video, but never its Tags or Want to Cook", async () => {
  const { sam, jo, planId } = await samAndJo();
  const pasta = await savedTikTok(sam);
  await sam.data.addRecipeToCookPlan(planId, pasta);
  const samSees = await sam.data.getRecipe(pasta);
  if (samSees?.status !== 'reviewed') throw new Error('sam should see his own reviewed Recipe.');

  const joSees = await jo.data.getRecipe(pasta);

  expect(joSees).toEqual({
    status: 'someoneElses',
    id: pasta,
    ownerId: sam.userId,
    owner: { id: sam.userId, username: sam.username },
    title: 'Creamy garlic pasta',
    recipeFound: true,
    lines: samSees.lines,
    steps: samSees.steps,
    sourceVideo: samSees.sourceVideo,
    createdAt: samSees.createdAt,
    updatedAt: samSees.updatedAt,
    yourCopy: null,
  });
  expect(samSees.tags.map((t) => t.name)).toEqual(['Italian']);
  expect(samSees.wantToCookSince).not.toBeNull();
});

test('saving your own copy: a reviewed Recipe of yours, read when the original was, with none of its Tags or Want to Cook', async () => {
  const { sam, jo, planId } = await samAndJo();
  const pasta = await savedTikTok(sam);
  await sam.data.addRecipeToCookPlan(planId, pasta);
  const original = await sam.data.getRecipe(pasta);
  if (original?.status !== 'reviewed') throw new Error('No Recipe.');

  const copied = await jo.data.copyRecipe(pasta);
  if (copied.status !== 'copied') throw new Error(`Not copied: ${copied.status}`);

  expect(await jo.data.getRecipe(copied.recipeId)).toEqual({
    status: 'reviewed',
    id: copied.recipeId,
    ownerId: jo.userId,
    title: 'Creamy garlic pasta',
    recipeFound: true,
    lines: original.lines,
    steps: original.steps,
    sourceVideo: original.sourceVideo,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    tags: [],
    wantToCookSince: null,
    savedFrom: { username: sam.username },
  });
  expect(await sourceVideoOf(copied.recipeId)).toEqual(await sourceVideoOf(pasta));
  expect((await jo.data.listMyRecipes()).map((r) => r.id)).toEqual([copied.recipeId]);
  expect(await jo.data.listWantToCook()).toEqual([]);
  expect(await jo.data.listTags()).toEqual([]);
  expect((await jo.data.getRecipe(pasta))?.status === 'someoneElses' && (await jo.data.getRecipe(pasta))).toMatchObject({
    yourCopy: copied.recipeId,
  });
});

test("a copied YouTube Source Video was read when the original's was, so the 30-day job clears it on time", async () => {
  const { sam, jo, planId } = await samAndJo();
  const { recipeId: lemon } = await sam.data.saveFromLink({ url: YOUTUBE_SHORT.url });
  await sam.drafts.settled();
  await sam.data.reviewDraft(lemon, asInput(await sam.data.getRecipe(lemon)), []);
  await sam.data.addRecipeToCookPlan(planId, lemon);
  // Read from YouTube 31 days ago: due to be cleared, and the copy with it, however new the copy is.
  await backdateSourceVideo(lemon, 31);

  const copied = await jo.data.copyRecipe(lemon);
  if (copied.status !== 'copied') throw new Error(copied.status);
  const original = await sourceVideoOf(lemon);
  expect(await sourceVideoOf(copied.recipeId)).toEqual(original);
  expect(original.creatorName).toBe('Lemon Kitchen');

  await runYouTubeExpiryJob();
  expect(await sourceVideoOf(copied.recipeId)).toMatchObject({ creatorName: null, caption: null });
});

test('the copy is independent: editing or deleting either never changes the other', async () => {
  const { sam, jo, planId } = await samAndJo();
  const bread = await sam.data.createRecipe(garlicBread);
  await sam.data.addRecipeToCookPlan(planId, bread);
  const copied = await jo.data.copyRecipe(bread);
  if (copied.status !== 'copied') throw new Error(copied.status);
  const copy = copied.recipeId;

  await jo.data.editRecipe(copy, { ...garlicBread, title: "Jo's garlic bread", steps: ['Toast it.'] });
  expect(asInput(await sam.data.getRecipe(bread))).toEqual(garlicBread);

  await sam.data.editRecipe(bread, { ...garlicBread, title: 'Cheesy garlic bread', lines: [] });
  expect(asInput(await jo.data.getRecipe(copy))).toEqual({ ...garlicBread, title: "Jo's garlic bread", steps: ['Toast it.'] });

  await jo.data.addTag(copy, 'Snack');
  await jo.data.setWantToCook(copy, true);
  const samsNow = await sam.data.getRecipe(bread);
  expect(samsNow?.status === 'reviewed' && [samsNow.tags, samsNow.wantToCookSince]).toEqual([[], null]);

  await sam.data.deleteRecipe(bread);
  expect((await jo.data.getRecipe(copy))?.title).toBe("Jo's garlic bread");
  expect(await jo.data.getRecipe(bread)).toBeNull();

  const second = await jo.data.copyRecipe(copy);
  if (second.status !== 'copied') throw new Error(second.status);
  await jo.data.deleteRecipe(copy);
  expect((await jo.data.getRecipe(second.recipeId))?.title).toBe("Jo's garlic bread");
});

test("a copy made while the owner is editing waits for the edit, and is all of the new version", async () => {
  const { sam, jo, planId } = await samAndJo();
  const bread = await sam.data.createRecipe(garlicBread);
  await sam.data.addRecipeToCookPlan(planId, bread);
  const cheesy = [{ originalText: '100g cheddar', amountText: '100g', ingredientName: 'cheddar' }];

  const held = await holdRecipeEdit(sam, bread, 'Cheesy bread', cheesy);
  const copying = jo.data.copyRecipe(bread);
  await held.waitForWaiting(1);
  await held.commit();

  const copied = await copying;
  if (copied.status !== 'copied') throw new Error(copied.status);
  expect(asInput(await jo.data.getRecipe(copied.recipeId))).toEqual({ title: 'Cheesy bread', lines: cheesy, steps: [] });
});

test('copying again makes another copy, and the plan Recipe offers the newest as yours', async () => {
  const { sam, jo, planId } = await samAndJo();
  const bread = await sam.data.createRecipe(garlicBread);
  await sam.data.addRecipeToCookPlan(planId, bread);

  const first = await jo.data.copyRecipe(bread);
  const second = await jo.data.copyRecipe(bread);
  if (first.status !== 'copied' || second.status !== 'copied') throw new Error('Not copied.');

  expect(first.recipeId).not.toBe(second.recipeId);
  expect((await jo.data.listMyRecipes()).map((r) => r.id).sort()).toEqual([first.recipeId, second.recipeId].sort());
  const seen = await jo.data.getRecipe(bread);
  expect(seen?.status === 'someoneElses' && seen.yourCopy).toBe(second.recipeId);
});

test("a Recipe you can't read can't be copied, and nothing is made", async () => {
  const { sam, planId } = await samAndJo();
  const stranger = await signInWithUsername('stranger');
  const bread = await sam.data.createRecipe(garlicBread);
  await sam.data.addRecipeToCookPlan(planId, bread);

  expect(await stranger.data.copyRecipe(bread)).toEqual({ status: 'notFound' });
  expect(await stranger.data.listMyRecipes()).toEqual([]);
});

test('deleting a Recipe that is in a Cook Plan: the plans it will leave come first, and then it leaves them', async () => {
  const { sam, jo, planId } = await samAndJo();
  const kim = await signInWithUsername('kim');
  await befriend(sam, kim);
  const second = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId, kim.userId] });
  const alone = await sam.data.createCookPlan({ cookOn: null, friends: [] });
  const bread = await sam.data.createRecipe(garlicBread);
  for (const plan of [planId, second.planId, alone.planId]) await sam.data.addRecipeToCookPlan(plan, bread);

  expect(await sam.data.recipeCookPlans(bread)).toEqual([
    { id: alone.planId, cookOn: null, withUsernames: [] },
    { id: second.planId, cookOn: null, withUsernames: [jo.username, kim.username].sort() },
    { id: planId, cookOn: '2026-11-02', withUsernames: [jo.username] },
  ]);
  expect(await sam.data.recipeCookPlans(await sam.data.createRecipe(lemonade))).toEqual([]);

  await sam.data.deleteRecipe(bread);

  expect((await jo.data.getCookPlan(planId))?.recipes).toEqual([]);
  expect((await kim.data.getCookPlan(second.planId))?.recipes).toEqual([]);
  expect(await sam.data.recipeCookPlans(bread)).toEqual([]);
});

test('leaving: the plan stays for the rest; the last to leave takes it with them; leaving again says so', async () => {
  const { sam, jo, planId } = await samAndJo();
  await sam.data.addRecipeToCookPlan(planId, await sam.data.createRecipe(garlicBread));

  expect(await sam.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: false });
  expect(await sam.data.listCookPlans()).toEqual([]);
  expect(await sam.data.getCookPlan(planId)).toBeNull();
  expect((await jo.data.getCookPlan(planId))?.members.map((m) => m.id)).toEqual([jo.userId]);
  // sam's Recipe stays in it for jo; sam is no longer someone jo shares a plan with.
  expect((await jo.data.getCookPlan(planId))?.recipes.map((r) => [r.title, r.owner])).toEqual([
    ['Garlic bread', { id: sam.userId, username: sam.username }],
  ]);
  expect(await sam.data.leaveCookPlan(planId)).toEqual({ status: 'notMember' });

  expect(await jo.data.leaveCookPlan(planId)).toEqual({ status: 'left', planDeleted: true });
  expect(await cookPlanExists(planId)).toBe(false);
  expect(await jo.data.leaveCookPlan(planId)).toEqual({ status: 'notMember' });
});

test('unfriended co-members both stay and keep reading the plan, but neither can invite the other into any plan', async () => {
  const { sam, jo, planId } = await samAndJo();
  const kim = await signInWithUsername('kim');
  await befriend(kim, sam);
  await befriend(kim, jo);
  const bread = await sam.data.createRecipe(garlicBread);
  const drink = await jo.data.createRecipe(lemonade);
  await sam.data.addRecipeToCookPlan(planId, bread);
  await jo.data.addRecipeToCookPlan(planId, drink);

  await jo.data.unfriend(sam.userId);

  for (const member of [sam, jo]) {
    const plan = await member.data.getCookPlan(planId);
    expect(plan?.members.map((m) => [m.id, m.username])).toEqual([
      [sam.userId, sam.username],
      [jo.userId, jo.username],
    ]);
    expect(titles(plan?.recipes ?? [])).toEqual(['Garlic bread', 'Lemonade']);
  }
  expect((await jo.data.getRecipe(bread))?.status).toBe('someoneElses');
  expect((await sam.data.getRecipe(drink))?.status).toBe('someoneElses');
  expect((await jo.data.copyRecipe(bread)).status).toBe('copied');

  // A new plan of either's.
  const samsNew = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  const josNew = await jo.data.createCookPlan({ cookOn: null, friends: [sam.userId] });
  expect(samsNew.invites).toEqual([{ friendId: jo.userId, status: 'notFriends' }]);
  expect(josNew.invites).toEqual([{ friendId: sam.userId, status: 'notFriends' }]);
  // One the other isn't in yet, started by a Friend of both.
  const kims = await kim.data.createCookPlan({ cookOn: null, friends: [sam.userId] });
  expect(await sam.data.inviteToCookPlan(kims.planId, jo.userId)).toEqual({ status: 'notFriends' });
  expect(await kim.data.inviteToCookPlan(kims.planId, jo.userId)).toEqual({ status: 'invited' });
  expect((await jo.data.listCookPlans()).map((p) => p.id).sort()).toEqual([planId, josNew.planId, kims.planId].sort());
});

test('an invite made while the two are being unfriended waits for it, and then invites nobody', async () => {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [] });

  // jo unfriends sam on their phone, not committed yet.
  const held = await holdUnfriend(jo, sam);
  const inviting = sam.data.inviteToCookPlan(planId, jo.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await inviting).toEqual({ status: 'notFriends' });
  expect((await sam.data.getCookPlan(planId))?.members.map((m) => m.id)).toEqual([sam.userId]);
  expect(await jo.data.listCookPlans()).toEqual([]);
});

/** `inviter` and `count` Friends of theirs who have never signed in, for filling a plan. */
async function friendsOf(inviter: Named, count: number): Promise<{ userId: UserId }[]> {
  const friends = await seedUsersWithUsernames('guest', count);
  await seedFriendships(inviter, friends);
  return friends;
}

test('two invites at once that would together pass 8 members: the second waits, then finds the plan full', async () => {
  const sam = await signInWithUsername('sam');
  const friends = await friendsOf(sam, 8);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: friends.slice(0, 6).map((f) => f.userId) });
  const [seventh, eighth] = friends.slice(6);

  // Another phone of sam's invites the seventh guest and hasn't committed yet: the plan's 8th place.
  const held = await holdCookPlanInvite(sam, planId, seventh);
  const inviting = sam.data.inviteToCookPlan(planId, eighth.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await inviting).toEqual({ status: 'full' });
  const plan = await sam.data.getCookPlan(planId);
  expect(plan?.members).toHaveLength(8);
  expect(plan?.members.map((m) => m.id)).toContain(seventh.userId);
  expect(plan?.members.map((m) => m.id)).not.toContain(eighth.userId);
});

test('two Recipes added at once that would together pass 10: the second waits, then finds the plan full', async () => {
  const { sam, jo, planId } = await samAndJo();
  for (let i = 1; i <= 9; i += 1) {
    expect(await sam.data.addRecipeToCookPlan(planId, await sam.data.createRecipe({ ...lemonade, title: `Dish ${i}` }))).toEqual({
      status: 'added',
    });
  }
  const tenth = await sam.data.createRecipe({ ...lemonade, title: 'Tenth' });
  const eleventh = await jo.data.createRecipe({ ...lemonade, title: 'Eleventh' });

  const held = await holdCookPlanRecipeAdd(sam, planId, tenth);
  const adding = jo.data.addRecipeToCookPlan(planId, eleventh);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await adding).toEqual({ status: 'full' });
  const plan = await jo.data.getCookPlan(planId);
  expect(plan?.recipes).toHaveLength(10);
  expect(titles(plan?.recipes ?? [])).toContain('Tenth');
  expect(titles(plan?.recipes ?? [])).not.toContain('Eleventh');
});

test('the last two members leaving at once: the second waits, finds itself last, and the plan is deleted once', async () => {
  const { sam, jo, planId } = await samAndJo();

  const held = await holdCookPlanLeave(sam, planId);
  const joLeaves = jo.data.leaveCookPlan(planId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await joLeaves).toEqual({ status: 'left', planDeleted: true });
  expect(await cookPlanExists(planId)).toBe(false);
  expect(await sam.data.listCookPlans()).toEqual([]);
  expect(await jo.data.listCookPlans()).toEqual([]);
});

test('every member sees the same plans, newest first', async () => {
  const { sam, jo, planId } = await samAndJo();
  const later: { planId: CookPlanId } = await jo.data.createCookPlan({ cookOn: null, friends: [sam.userId] });

  expect((await sam.data.listCookPlans()).map((p) => p.id)).toEqual([later.planId, planId]);
  expect((await jo.data.listCookPlans()).map((p) => p.id)).toEqual([later.planId, planId]);
});
