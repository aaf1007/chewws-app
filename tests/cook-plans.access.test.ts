// Access-rule tests for ticket 14: Cook Plans (decisions 14). A stranger, a Friend of a member who
// isn't in the plan, a member who has left, and members themselves skip the data layer and call
// PostgREST and Storage directly with their own session, as an attacker would. RLS, the table
// grants, the checks inside the plan functions and the two rules (private.is_cook_plan_member,
// private.can_read_recipe) are what have to stop them.
import { expect, inject, test } from 'vitest';

import type { RecipeId } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  functionsRestatingTheMembershipRule,
  functionsRestatingTheRecipeReadRule,
  policiesRestatingTheMembershipRule,
  recipePartReadPolicies,
  seedFriendships,
  seedUsersWithUsernames,
  uniqueUsername,
} from './harness';
import { screenshotBytes } from './screenshot-fixture';

const permissionDenied = { code: '42501' };
const REEL = 'https://www.instagram.com/reel/C1a2b3c4d5e/';

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

/** A Draft of `owner`'s, built and reviewed with `tags`, as its builder made it. */
async function reviewed(owner: Attacker, saved: Promise<{ recipeId: RecipeId }>, tags: string[]): Promise<RecipeId> {
  const { recipeId } = await saved;
  await owner.drafts.settled();
  const draft = await owner.data.getRecipe(recipeId);
  if (!draft) throw new Error('No Draft.');
  const lines = draft.lines.map((l) => ({ originalText: l.originalText, amountText: l.amountText, ingredientName: l.ingredient.name }));
  await owner.data.reviewDraft(recipeId, { title: draft.title, lines, steps: draft.steps }, tags);
  return recipeId;
}

/**
 * sam's plan with jo in it. sam put in a TikTok Recipe (Tagged, marked Want to Cook) and an
 * Instagram Reel with his screenshot; he also has a Draft, not in the plan. kim is sam's Friend but
 * not in the plan; stranger is nobody to them.
 */
async function plan() {
  const sam = await named('sam');
  const jo = await named('jo');
  const kim = await named('kim');
  const stranger = await named('stranger');
  await befriend(sam, jo);
  await befriend(sam, kim);
  const pasta = await reviewed(sam, sam.data.saveFromLink({ url: FULL_RECIPE.url }), ['Italian']);
  await sam.data.setWantToCook(pasta, true);
  const reel = await reviewed(sam, sam.data.saveFromLink({ url: REEL, screenshot: screenshotBytes() }), []);
  const { recipeId: draft } = await sam.data.saveFromLink({ url: FULL_RECIPE.url });
  await sam.drafts.settled();
  const { planId } = await sam.data.createCookPlan({ cookOn: '2026-11-02', friends: [jo.userId] });
  expect(await sam.data.addRecipeToCookPlan(planId, pasta)).toEqual({ status: 'added' });
  expect(await sam.data.addRecipeToCookPlan(planId, reel)).toEqual({ status: 'added' });
  // A link to sam's screenshot is signed afresh each read; that it's there is what counts.
  const recipeOf = async (id: RecipeId) => {
    const recipe = await sam.data.getRecipe(id);
    const video = recipe?.sourceVideo;
    return video?.screenshotUrl ? { ...recipe, sourceVideo: { ...video, screenshotUrl: 'signed' } } : recipe;
  };
  const planOf = async () => {
    const found = await sam.data.getCookPlan(planId);
    return found && { ...found, members: found.members.filter((m) => m.id === sam.userId) };
  };
  const before = { plan: await planOf(), pasta: await recipeOf(pasta), reel: await recipeOf(reel), draft: await recipeOf(draft) };
  expect(before.reel?.sourceVideo?.screenshotUrl).toBe('signed');
  /** sam's plan (but for who else is in it), and his Recipes, are as they were. */
  async function expectUnchanged() {
    expect(await planOf()).toEqual(before.plan);
    expect(await recipeOf(pasta)).toEqual(before.pasta);
    expect(await recipeOf(reel)).toEqual(before.reel);
    expect(await recipeOf(draft)).toEqual(before.draft);
  }
  return { sam, jo, kim, stranger, planId, pasta, reel, draft, expectUnchanged };
}

/** Everything `user` could read of the plan and its Recipes straight from the API. */
async function readsOf(user: Attacker, planId: string, recipeIds: string[]) {
  const [plans, members, recipes, people, list, listed, shared, lines, videos, rows, inPlans] = await Promise.all([
    user.client.from('cook_plans').select('id').eq('id', planId),
    user.client.from('cook_plan_members').select('user_id').eq('plan_id', planId),
    user.client.from('cook_plan_recipes').select('recipe_id').eq('plan_id', planId),
    user.client.from('cook_plan_people').select('user_id').eq('plan_id', planId),
    user.client.from('cook_plan_recipe_list').select('recipe_id').eq('plan_id', planId),
    user.client.rpc('list_cook_plans').select('id'),
    Promise.all(recipeIds.map((id) => user.client.rpc('shared_recipe', { recipe_id: id }).select('id'))),
    user.client.from('recipe_lines').select('recipe_id').in('recipe_id', recipeIds),
    user.client.from('source_videos').select('recipe_id').in('recipe_id', recipeIds),
    user.client.from('recipes').select('id').in('id', recipeIds),
    Promise.all(recipeIds.map((id) => user.client.rpc('recipe_cook_plans', { recipe_id: id }))),
  ]);
  return {
    plans: plans.data,
    members: members.data,
    recipes: recipes.data,
    people: people.data,
    list: list.data,
    listed: listed.data,
    shared: shared.flatMap((s): unknown[] => s.data ?? [s.error?.code]),
    lines: lines.data,
    videos: videos.data,
    rows: rows.data,
    inPlans: inPlans.flatMap((s): unknown[] => s.data ?? [s.error?.code]),
  };
}

const nothing = {
  plans: [],
  members: [],
  recipes: [],
  people: [],
  list: [],
  listed: [],
  shared: [],
  lines: [],
  videos: [],
  rows: [],
  inPlans: [],
};

/** Every change `user` could try on the plan straight from the API, and what each answered. */
async function writesOf(user: Attacker, planId: string, recipeId: string, friendId: string) {
  const own = await user.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const add = await user.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: own });
  const remove = await user.client.rpc('remove_recipe_from_cook_plan', { plan_id: planId, recipe_id: recipeId });
  const invite = await user.client.rpc('invite_to_cook_plan', { plan_id: planId, friend_id: friendId });
  const inviteSelf = await user.client.rpc('invite_to_cook_plan', { plan_id: planId, friend_id: user.userId });
  const setDate = await user.client.rpc('set_cook_plan_date', { plan_id: planId, cook_on: '2030-01-01' });
  const leave = await user.client.rpc('leave_cook_plan', { plan_id: planId });
  const copy = await user.client.rpc('copy_recipe', { recipe_id: recipeId });
  return {
    add: add.data,
    remove: remove.data,
    invite: invite.data,
    inviteSelf: inviteSelf.data,
    setDate: setDate.data,
    leave: leave.data,
    copy: copy.data,
  };
}

const refused = {
  add: { status: 'notFound' },
  remove: { status: 'notFound' },
  invite: { status: 'notFound' },
  inviteSelf: { status: 'notFound' },
  setDate: { status: 'notFound' },
  leave: { status: 'notMember' },
  copy: { status: 'notFound' },
};

test('a stranger, and a Friend of a member who is not in the plan, read nothing of it or its Recipes', async () => {
  const { jo, kim, stranger, planId, pasta, reel, expectUnchanged } = await plan();

  for (const outsider of [stranger, kim]) {
    expect(await readsOf(outsider, planId, [pasta, reel])).toEqual(nothing);
    expect(await outsider.data.getRecipe(pasta)).toBeNull();
    expect(await outsider.data.getCookPlan(planId)).toBeNull();
  }
  await expectUnchanged();

  // A member reads all of it: the same calls aren't refused for everyone.
  const joReads = await readsOf(jo, planId, [pasta, reel]);
  expect(joReads.plans).toEqual([{ id: planId }]);
  expect(joReads.members).toHaveLength(2);
  expect(joReads.recipes).toHaveLength(2);
  expect(joReads.people).toHaveLength(2);
  expect(joReads.list).toHaveLength(2);
  expect(joReads.listed).toEqual([{ id: planId }]);
  expect(joReads.shared).toEqual([{ id: pasta }, { id: reel }]);
  expect(joReads.lines?.length).toBeGreaterThan(0);
  // The Recipe and Source Video rows themselves (Want to Cook, the screenshot's path and all) stay
  // their owner's; shared_recipe gives what of them a member may read.
  expect(joReads.videos).toEqual([]);
  expect(joReads.rows).toEqual([]);
  expect(joReads.inPlans).toHaveLength(2);
});

test("a non-member can't add or remove Recipes, invite anyone, set the day, leave or copy a plan Recipe", async () => {
  const { sam, jo, kim, stranger, planId, pasta, expectUnchanged } = await plan();

  // kim tries to invite a Friend of hers; the stranger, the stranger.
  expect(await writesOf(kim, planId, pasta, sam.userId)).toEqual(refused);
  expect(await writesOf(stranger, planId, pasta, jo.userId)).toEqual(refused);
  expect(await kim.data.listMyRecipes()).toHaveLength(1);
  expect(await stranger.data.listMyRecipes()).toHaveLength(1);
  await expectUnchanged();
});

test('nobody writes plans, members or plan Recipes directly, not even a member', async () => {
  const { sam, jo, kim, planId, pasta } = await plan();
  const own = await kim.data.createRecipe({ title: 'Toast', lines: [], steps: [] });

  const results = [
    await kim.client.from('cook_plan_members').insert({ plan_id: planId, user_id: kim.userId }),
    await jo.client.from('cook_plan_members').insert({ plan_id: planId, user_id: kim.userId, invited_by: jo.userId }),
    await jo.client.from('cook_plan_members').delete().eq('plan_id', planId).eq('user_id', sam.userId),
    await kim.client.from('cook_plan_recipes').insert({ plan_id: planId, recipe_id: own }),
    await jo.client.from('cook_plan_recipes').delete().eq('plan_id', planId).eq('recipe_id', pasta),
    await kim.client.from('cook_plans').insert({ creator_id: kim.userId }),
    await jo.client.from('cook_plans').update({ cook_on: '2030-01-01' }).eq('id', planId),
    await jo.client.from('cook_plans').delete().eq('id', planId),
    await jo.client.from('cook_plan_people').delete().eq('plan_id', planId),
  ];
  const codes = results.map((r) => r.error?.code);
  expect(codes).toEqual([...Array(8).fill(permissionDenied.code), '55000']);
});

test("a member can't change another member's Recipe, nor see its Tags, Want to Cook, Drafts or screenshot", async () => {
  const { sam, jo, planId, pasta, reel, draft, expectUnchanged } = await plan();

  const edit = await jo.client.rpc('edit_recipe', { recipe_id: pasta, title: 'Mine now', steps: [], lines: [] });
  const update = await jo.client.from('recipes').update({ title: 'Mine now' }).eq('id', pasta).select('id');
  const remove = await jo.client.from('recipes').delete().eq('id', pasta).select('id');
  const addLine = await jo.client.from('recipe_lines').insert({
    recipe_id: pasta,
    position: 99,
    original_text: 'chilli',
    ingredient_id: (await jo.data.getRecipe(pasta))?.lines[0].ingredient.id ?? '',
  });
  const removeLines = await jo.client.from('recipe_lines').delete().eq('recipe_id', pasta).select('recipe_id');
  const changeVideo = await jo.client.from('source_videos').update({ caption: 'Mine' }).eq('recipe_id', pasta);
  const tag = await jo.client.rpc('add_tag', { recipe_id: pasta, name: 'Stolen' });
  const wantToCook = await jo.client.rpc('set_want_to_cook', { recipe_id: pasta, want_to_cook: false });
  const removeFromList = await jo.client.rpc('add_recipe_to_shopping_list', { recipe_id: pasta, lines: [] });
  expect(edit).toMatchObject({ data: null, error: null });
  expect(update).toMatchObject({ data: [], error: null });
  expect(remove).toMatchObject({ data: [], error: null });
  expect(addLine.error).toMatchObject(permissionDenied);
  expect(removeLines).toMatchObject({ data: [], error: null });
  expect(changeVideo.error).toMatchObject(permissionDenied);
  expect(tag).toMatchObject({ data: null, error: null });
  expect(wantToCook).toMatchObject({ data: 'gone', error: null });
  expect(removeFromList).toMatchObject({ data: null, error: null });

  // Tags, Want to Cook, the screenshot and the pasted caption: neither the join rows, nor the Recipe
  // or Source Video rows, and shared_recipe has no such field.
  const tags = await jo.client.from('recipe_tags').select('*').eq('recipe_id', pasta);
  const row = await jo.client.from('recipes').select('want_to_cook_at, suggested_tags').eq('id', pasta);
  const video = await jo.client.from('source_videos').select('screenshot_path, pasted_text').in('recipe_id', [pasta, reel]);
  const shared = await jo.client.rpc('shared_recipe', { recipe_id: reel }).select('*').single();
  expect(tags).toMatchObject({ data: [], error: null });
  expect(row).toMatchObject({ data: [], error: null });
  expect(video).toMatchObject({ data: [], error: null });
  expect(Object.keys(shared.data ?? {}).sort()).toEqual([
    'created_at',
    'id',
    'owner_id',
    'owner_username',
    'recipe_found',
    'source_caption',
    'source_creator_name',
    'source_creator_url',
    'source_external_id',
    'source_platform',
    'source_thumbnail_url',
    'source_url',
    'steps',
    'title',
    'updated_at',
  ]);
  // sam sees both on his own Reel: they're there, and only members are kept from them.
  const own = await sam.client.from('source_videos').select('screenshot_path').eq('recipe_id', reel).single();
  expect(own.data?.screenshot_path).toBe(`${sam.userId}/${reel}.jpg`);

  // sam's Draft isn't in the plan, and couldn't be: nothing of it shows, and it can't be added.
  expect((await jo.client.rpc('shared_recipe', { recipe_id: draft })).data).toEqual([]);
  expect((await jo.client.from('recipe_lines').select('recipe_id').eq('recipe_id', draft)).data).toEqual([]);
  expect((await jo.client.from('source_videos').select('recipe_id').eq('recipe_id', draft)).data).toEqual([]);
  expect((await sam.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: draft })).data).toEqual({
    status: 'noSuchRecipe',
  });
  expect(await jo.data.getRecipe(draft)).toBeNull();

  // sam's screenshot of the Reel: jo can't download it or sign a link to it, and sees the plain card.
  const path = `${sam.userId}/${reel}.jpg`;
  expect((await sam.client.storage.from('recipe-images').download(path)).error).toBeNull();
  expect((await jo.client.storage.from('recipe-images').download(path)).data).toBeNull();
  expect((await jo.client.storage.from('recipe-images').createSignedUrl(path, 3600)).data).toBeNull();
  const seen = await jo.data.getRecipe(reel);
  expect(seen?.sourceVideo).toEqual({
    platform: 'instagram',
    originalUrl: REEL,
    creatorName: null,
    creatorUrl: null,
    thumbnailUrl: null,
  });
  await expectUnchanged();
});

test("a copy takes no Tags, Want to Cook or screenshot, and the owner's screenshot stays theirs alone", async () => {
  const { sam, jo, pasta, reel } = await plan();

  const pastaCopy = await jo.client.rpc('copy_recipe', { recipe_id: pasta });
  const reelCopy = await jo.client.rpc('copy_recipe', { recipe_id: reel });
  const ids = [pastaCopy.data, reelCopy.data].map((answer) =>
    typeof answer === 'object' && answer !== null && !Array.isArray(answer) ? String(answer.recipeId) : '',
  );

  const rows = await jo.client.from('recipes').select('want_to_cook_at, suggested_tags').in('id', ids);
  const tags = await jo.client.from('recipe_tags').select('*').in('recipe_id', ids);
  const videos = await jo.client.from('source_videos').select('screenshot_path, pasted_text').in('recipe_id', ids);
  expect(rows.data).toEqual([
    { want_to_cook_at: null, suggested_tags: [] },
    { want_to_cook_at: null, suggested_tags: [] },
  ]);
  expect(tags.data).toEqual([]);
  expect(videos.data).toEqual([
    { screenshot_path: null, pasted_text: null },
    { screenshot_path: null, pasted_text: null },
  ]);
  // Nothing at the copy's own screenshot path, and sam's own is still there for him.
  expect((await jo.client.storage.from('recipe-images').download(`${jo.userId}/${ids[1]}.jpg`)).data).toBeNull();
  expect((await sam.client.storage.from('recipe-images').download(`${sam.userId}/${reel}.jpg`)).error).toBeNull();
});

test('a member who leaves loses the plan and its Recipes at once', async () => {
  const { sam, jo, planId, pasta, reel, expectUnchanged } = await plan();
  expect((await jo.client.rpc('shared_recipe', { recipe_id: pasta })).data).toHaveLength(1);

  expect((await jo.client.rpc('leave_cook_plan', { plan_id: planId })).data).toEqual({
    status: 'left',
    planDeleted: false,
  });

  expect(await readsOf(jo, planId, [pasta, reel])).toEqual(nothing);
  expect(await writesOf(jo, planId, pasta, sam.userId)).toEqual(refused);
  // sam is still in it; only jo's place went.
  const samsPlan = await sam.data.getCookPlan(planId);
  expect(samsPlan?.members.map((m) => m.id)).toEqual([sam.userId]);
  await expectUnchanged();
});

test('unfriended co-members both stay and keep reading the plan, but neither can invite the other into any plan', async () => {
  const { sam, jo, kim, planId, pasta } = await plan();
  const josRecipe = await jo.data.createRecipe({ title: 'Lemonade', lines: [], steps: [] });
  await jo.data.addRecipeToCookPlan(planId, josRecipe);
  await befriend(jo, kim);
  const { planId: kims } = await kim.data.createCookPlan({ cookOn: null, friends: [sam.userId] });

  await sam.data.unfriend(jo.userId);

  expect((await jo.client.rpc('shared_recipe', { recipe_id: pasta })).data).toHaveLength(1);
  expect((await sam.client.rpc('shared_recipe', { recipe_id: josRecipe })).data).toHaveLength(1);
  expect((await jo.client.from('cook_plan_people').select('user_id').eq('plan_id', planId)).data).toHaveLength(2);
  const joNew = (await jo.client.rpc('create_cook_plan', {})).data ?? '';
  const samNew = (await sam.client.rpc('create_cook_plan', {})).data ?? '';
  for (const [inviter, plan, invitee] of [
    [sam, planId, jo],
    [sam, samNew, jo],
    [jo, joNew, sam],
    [sam, kims, jo],
  ] as const) {
    expect((await inviter.client.rpc('invite_to_cook_plan', { plan_id: plan, friend_id: invitee.userId })).data).toEqual({
      status: 'notFriends',
    });
  }
  expect((await jo.client.rpc('list_cook_plans').select('id')).data?.map((p) => p.id).sort()).toEqual([planId, joNew].sort());
});

test('a plan holds at most 8 members and 10 Recipes, however they are sent', async () => {
  const sam = await named('sam');
  const guests = await seedUsersWithUsernames('guest', 8);
  await seedFriendships({ userId: sam.userId }, guests);
  const planId = (await sam.client.rpc('create_cook_plan', {})).data ?? '';

  const invites = [];
  for (const guest of guests) {
    invites.push((await sam.client.rpc('invite_to_cook_plan', { plan_id: planId, friend_id: guest.userId })).data);
  }
  expect(invites).toEqual([...Array(7).fill({ status: 'invited' }), { status: 'full' }]);
  expect((await sam.client.from('cook_plan_members').select('user_id').eq('plan_id', planId)).data).toHaveLength(8);

  const adds = [];
  for (let i = 1; i <= 11; i += 1) {
    const recipe = await sam.data.createRecipe({ title: `Dish ${i}`, lines: [], steps: [] });
    adds.push((await sam.client.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: recipe })).data);
  }
  expect(adds).toEqual([...Array(10).fill({ status: 'added' }), { status: 'full' }]);
  expect((await sam.client.from('cook_plan_recipes').select('recipe_id').eq('plan_id', planId)).data).toHaveLength(10);
});

test('who is in a plan is decided only by private.is_cook_plan_member, never restated', async () => {
  expect(await functionsRestatingTheMembershipRule()).toEqual([]);
  expect(await policiesRestatingTheMembershipRule()).toEqual([]);
});

test("who may read another user's Recipe is decided only by private.can_read_recipe, never restated", async () => {
  expect(await recipePartReadPolicies()).toEqual([
    'recipe_lines: private.can_read_recipe(recipe_id)',
    // Owner-only: a Source Video row holds the screenshot's path and the pasted caption.
    'source_videos: (EXISTS ( SELECT 1 FROM recipes r WHERE ((r.id = source_videos.recipe_id) AND (r.owner_id = ( SELECT auth.uid() AS uid)))))',
  ]);
  expect(await functionsRestatingTheRecipeReadRule()).toEqual([]);
});

test('the private rules are not exposed through the Data API, the invite push is the server’s, and signed out nothing answers', async () => {
  const { sam, jo, planId, pasta } = await plan();
  const { url, anonKey } = inject('supabase');
  const { data } = await jo.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['is_cook_plan_member', { plan_id: planId, who: jo.userId }],
    ['can_read_recipe', { recipe_id: pasta, who: jo.userId }],
    ['cook_plan_ids', { who: sam.userId }],
    ['cook_plan_people', {}],
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

  // Only the notify function (the service role) claims an invite push.
  const claim = await jo.client.rpc('claim_cook_plan_invite_push', { plan_id: planId, inviter: sam.userId, invitee: jo.userId });
  expect(claim.error).toMatchObject(permissionDenied);

  const anon = createTestClient();
  const signedOut = [
    await anon.rpc('create_cook_plan', {}),
    await anon.rpc('invite_to_cook_plan', { plan_id: planId, friend_id: jo.userId }),
    await anon.rpc('leave_cook_plan', { plan_id: planId }),
    await anon.rpc('add_recipe_to_cook_plan', { plan_id: planId, recipe_id: pasta }),
    await anon.rpc('remove_recipe_from_cook_plan', { plan_id: planId, recipe_id: pasta }),
    await anon.rpc('set_cook_plan_date', { plan_id: planId }),
    await anon.rpc('copy_recipe', { recipe_id: pasta }),
    await anon.rpc('shared_recipe', { recipe_id: pasta }),
    await anon.rpc('list_cook_plans'),
    await anon.rpc('recipe_cook_plans', { recipe_id: pasta }),
  ];
  for (const { error } of signedOut) expect(error).toMatchObject(permissionDenied);
  for (const view of ['cook_plan_people', 'cook_plan_recipe_list'] as const) {
    expect((await anon.from(view).select('*')).error).toMatchObject(permissionDenied);
  }
  expect((await anon.from('cook_plans').select('*')).error).toMatchObject(permissionDenied);
});
