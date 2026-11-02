// Ticket 15: the Cook Plan list (decisions 15), through the data layer as real signed-in users. A
// plan's list has one line per Ingredient across its Recipes, each Recipe's amounts kept apart; each
// line shows which members have it (Pantry or Staples); members Claim and unclaim lines, seen by
// all; a check-off goes into the checker's own Pantry. When a Recipe leaves the plan, its lines
// nobody claimed or checked off go, and the rest stay as "(removed)". Races hold one side in a
// second database session (CODING_STANDARDS.md).
import { randomUUID } from 'node:crypto';

import { expect, test, vi } from 'vitest';

import type {
  CookPlanId,
  CookPlanList,
  CookPlanListView,
  CookPlanListItem,
  DataLayer,
  RecipeId,
  RecipeInput,
  UserId,
} from '../src/data';
import {
  holdCookPlanCheckOff,
  holdCookPlanClaim,
  holdCookPlanRecipeAddWithLines,
  markCookPlanCookedInDatabase,
  signInOnPhones,
  startCookPlanRecipeAdd,
  signInWithUsername,
  uniqueUsername,
  type TestPhone,
} from './harness';

type Someone = { userId: UserId; data: DataLayer; username: string };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** A user signed in on one phone (with its own clock), with a username. */
async function phoneWithUsername(label: string): Promise<TestPhone & { username: string }> {
  const [phone] = await signInOnPhones(label, 1);
  const username = uniqueUsername(label);
  const chosen = await phone.data.setUsername(username);
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  return { ...phone, username };
}

/** sam's: garlic twice (one line, both amounts), butter, parsley and chives, none in anyone's Pantry. */
const garlicBread: RecipeInput = {
  title: 'Garlic bread',
  lines: [
    { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
    { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    { originalText: '1 clove garlic, minced', amountText: '1 clove', ingredientName: 'Garlic' },
    { originalText: 'A handful of parsley', amountText: 'a handful', ingredientName: 'parsley' },
    { originalText: 'Chives', amountText: null, ingredientName: 'chives' },
  ],
  steps: ['Mash the garlic into the butter.', 'Spread and bake.'],
};

/** jo's: garlic too, olive oil, salt (everyone's Staple) and spaghetti. */
const aglioOlio: RecipeInput = {
  title: 'Aglio e olio',
  lines: [
    { originalText: '4 cloves garlic', amountText: '4 cloves', ingredientName: 'garlic' },
    { originalText: '100ml olive oil', amountText: '100ml', ingredientName: 'olive oil' },
    { originalText: 'Salt', amountText: '  ', ingredientName: 'salt' },
    { originalText: '200g spaghetti', amountText: '200g', ingredientName: 'spaghetti' },
  ],
  steps: ['Boil the spaghetti.', 'Warm the garlic in the oil.'],
};

/**
 * sam's plan with jo and kim, both his Friends. sam put in his garlic bread, jo her aglio e olio.
 * `sam` may be a phone, for tests that set its clock.
 */
async function plan(samUser?: Someone) {
  const sam = samUser ?? (await signInWithUsername('sam'));
  const jo = await signInWithUsername('jo');
  const kim = await signInWithUsername('kim');
  await befriend(sam, jo);
  await befriend(sam, kim);
  const { planId } = await sam.data.createCookPlan({ cookOn: '2026-11-02', friends: [jo.userId, kim.userId] });
  const bread = await sam.data.createRecipe(garlicBread);
  const aglio = await jo.data.createRecipe(aglioOlio);
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  expect(await jo.data.addRecipeToCookPlan(planId, aglio)).toEqual({ status: 'added' });
  const usernames = new Map<UserId | null, string>([
    [sam.userId, sam.username],
    [jo.userId, jo.username],
    [kim.userId, kim.username],
  ]);
  return { sam, jo, kim, planId, bread, aglio, usernames };
}

function lineOf(list: CookPlanList, name: string): CookPlanListItem {
  const found = list.items.find((i) => i.ingredient.name === name);
  if (!found) throw new Error(`${name} is not on the list`);
  return found;
}

/** The list as a member reads it: each line's name, Recipes and amounts, who has it, claimed and checked it. */
function readList(list: CookPlanList, usernames: Map<UserId | null, string>) {
  const who = (id: UserId | null) => usernames.get(id) ?? 'a former member';
  return list.items.map((item) => ({
    line: item.ingredient.name,
    amounts: item.recipes.map(({ recipe, amountTexts }) => [
      recipe.status === 'removed' ? `${recipe.title} (removed)` : recipe.title,
      ...amountTexts,
    ]),
    whoHas: item.whoHas.map((p) => p.username),
    claimedBy: item.claim.status === 'claimed' ? who(item.claim.claimedBy) : null,
    checkedBy: item.check.status === 'checked' ? who(item.check.checkedBy) : null,
  }));
}

const pantryNames = async (user: { data: DataLayer }) => (await user.data.getPantry()).ingredients.map((i) => i.name);

test('the list has one line per Ingredient across the plan’s Recipes, each Recipe’s amounts apart, and every member sees the same', async () => {
  const { sam, jo, kim, planId, bread, aglio, usernames } = await plan();

  const forSam = await sam.data.getCookPlanList(planId);
  expect(readList(forSam, usernames)).toEqual([
    { line: 'butter', amounts: [['Garlic bread', '4 tbsp']], whoHas: [], claimedBy: null, checkedBy: null },
    { line: 'chive', amounts: [['Garlic bread']], whoHas: [], claimedBy: null, checkedBy: null },
    {
      line: 'garlic',
      amounts: [
        ['Garlic bread', '2 cloves', '1 clove'],
        ['Aglio e olio', '4 cloves'],
      ],
      whoHas: [],
      claimedBy: null,
      checkedBy: null,
    },
    { line: 'olive oil', amounts: [['Aglio e olio', '100ml']], whoHas: [], claimedBy: null, checkedBy: null },
    { line: 'parsley', amounts: [['Garlic bread', 'a handful']], whoHas: [], claimedBy: null, checkedBy: null },
    // Everyone's default Staple, so all three have it.
    { line: 'salt', amounts: [['Aglio e olio']], whoHas: [sam.username, jo.username, kim.username], claimedBy: null, checkedBy: null },
    { line: 'spaghetti', amounts: [['Aglio e olio', '200g']], whoHas: [], claimedBy: null, checkedBy: null },
  ]);
  expect(lineOf(forSam, 'garlic')).toEqual({
    id: expect.any(String),
    ingredient: { id: expect.any(String), name: 'garlic' },
    recipes: [
      { recipe: { status: 'inPlan', id: bread, title: 'Garlic bread' }, amountTexts: ['2 cloves', '1 clove'] },
      { recipe: { status: 'inPlan', id: aglio, title: 'Aglio e olio' }, amountTexts: ['4 cloves'] },
    ],
    whoHas: [],
    claim: { status: 'unclaimed' },
    check: { status: 'unchecked' },
  });
  expect(forSam).toMatchObject({ planId, status: 'active' });
  expect(forSam.members.map((m) => m.username)).toEqual([sam.username, jo.username, kim.username]);
  expect(await jo.data.getCookPlanList(planId)).toEqual(forSam);
  expect(await kim.data.getCookPlanList(planId)).toEqual(forSam);

  // Adding a Recipe again changes nothing.
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'alreadyAdded' });
  expect(await sam.data.getCookPlanList(planId)).toEqual(forSam);
});

test('each line shows the members who have it, from their Pantry or Staples as they are now, and nothing else of their Pantry', async () => {
  const { sam, jo, kim, planId, usernames } = await plan();
  await jo.data.addToPantry('Butter');
  await kim.data.addStaple('spaghetti');
  await kim.data.addToPantry('Caviar');
  const salt = (await sam.data.getPantry()).staples.find((s) => s.name === 'salt');
  if (!salt) throw new Error('sam has no salt Staple');
  await sam.data.removeStaple(salt.id);

  const whoHas = async (user: Someone) =>
    Object.fromEntries(readList(await user.data.getCookPlanList(planId), usernames).map((l) => [l.line, l.whoHas]));
  const expected = {
    butter: [jo.username],
    chive: [],
    garlic: [],
    'olive oil': [],
    parsley: [],
    salt: [jo.username, kim.username],
    spaghetti: [kim.username],
  };
  expect(await whoHas(sam)).toEqual(expected);
  expect(await whoHas(kim)).toEqual(expected);

  // As it is now: used up, it's no longer had. Unfriended co-members still see each other here.
  await jo.data.markUsedUp((await jo.data.getPantry()).ingredients[0].id);
  await sam.data.unfriend(kim.userId);
  expect(await whoHas(sam)).toEqual({ ...expected, butter: [] });
  expect(await whoHas(kim)).toEqual({ ...expected, butter: [] });
});

test('members claim and unclaim lines and everyone sees who; a Claim takes over another; someone else’s Claim can’t be unclaimed', async () => {
  const { sam, jo, kim, planId, usernames } = await plan();
  const garlic = lineOf(await sam.data.getCookPlanList(planId), 'garlic').id;
  const claimOf = async (user: Someone) => readList(await user.data.getCookPlanList(planId), usernames).find((l) => l.line === 'garlic')?.claimedBy;

  await jo.data.claim(planId, garlic);
  for (const member of [sam, jo, kim]) expect(await claimOf(member)).toBe(jo.username);
  const claimed = lineOf(await kim.data.getCookPlanList(planId), 'garlic').claim;
  expect(claimed).toEqual({ status: 'claimed', claimedAt: expect.any(String), claimedBy: jo.userId });

  // Claiming your own again changes nothing; sam takes it over.
  await jo.data.claim(planId, garlic);
  expect(lineOf(await kim.data.getCookPlanList(planId), 'garlic').claim).toEqual(claimed);
  await sam.data.claim(planId, garlic);
  for (const member of [sam, jo, kim]) expect(await claimOf(member)).toBe(sam.username);

  // jo's Claim is gone, so there's nothing of hers to unclaim; sam's stays.
  await expect(jo.data.unclaim(planId, garlic)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  expect(await claimOf(kim)).toBe(sam.username);
  await sam.data.unclaim(planId, garlic);
  for (const member of [sam, jo, kim]) expect(await claimOf(member)).toBeNull();
  // Unclaiming a line nobody claimed changes nothing, and says so.
  await expect(sam.data.unclaim(planId, garlic)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
});

test('checking off puts the Ingredient in the checker’s own Pantry, never the claimer’s or the Recipe owner’s; unchecking leaves it there', async () => {
  const { sam, jo, kim, planId, usernames } = await plan();
  const butter = lineOf(await sam.data.getCookPlanList(planId), 'butter').id;
  await kim.data.claim(planId, butter);

  await jo.data.checkOffCookPlanItem(planId, butter);

  const line = readList(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'butter');
  expect(line).toEqual({ line: 'butter', amounts: [['Garlic bread', '4 tbsp']], whoHas: [jo.username], claimedBy: kim.username, checkedBy: jo.username });
  expect(await pantryNames(jo)).toEqual(['butter']);
  expect(await pantryNames(kim)).toEqual([]);
  expect(await pantryNames(sam)).toEqual([]);

  // Checking it off again changes nothing; unchecking leaves jo's Pantry and kim's Claim alone.
  await kim.data.checkOffCookPlanItem(planId, butter);
  expect(lineOf(await sam.data.getCookPlanList(planId), 'butter').check).toMatchObject({ status: 'checked', checkedBy: jo.userId });
  expect(await pantryNames(kim)).toEqual([]);
  await kim.data.uncheckCookPlanItem(planId, butter);
  expect(lineOf(await jo.data.getCookPlanList(planId), 'butter')).toMatchObject({
    check: { status: 'unchecked' },
    claim: { status: 'claimed', claimedBy: kim.userId },
  });
  expect(await pantryNames(jo)).toEqual(['butter']);
});

test.each(['removes it from the plan', 'deletes the Recipe'] as const)(
  'when sam %s, its unclaimed, unchecked lines go and its Claimed or checked ones stay, "(removed)"',
  async (how) => {
    const { sam, jo, kim, planId, bread, usernames } = await plan();
    const list = await sam.data.getCookPlanList(planId);
    await jo.data.claim(planId, lineOf(list, 'butter').id);
    await kim.data.checkOffCookPlanItem(planId, lineOf(list, 'chive').id);
    if (how === 'deletes the Recipe') {
      expect(await sam.data.recipeCookPlans(bread)).toEqual([{ id: planId, cookOn: '2026-11-02', withUsernames: [jo.username, kim.username].sort() }]);
      await sam.data.deleteRecipe(bread);
    } else {
      expect(await jo.data.removeRecipeFromCookPlan(planId, bread)).toEqual({ status: 'removed' });
    }

    const after = await kim.data.getCookPlanList(planId);
    expect(readList(after, usernames)).toEqual([
      { line: 'butter', amounts: [['Garlic bread (removed)', '4 tbsp']], whoHas: [], claimedBy: jo.username, checkedBy: null },
      { line: 'chive', amounts: [['Garlic bread (removed)']], whoHas: [kim.username], claimedBy: null, checkedBy: kim.username },
      // Aglio e olio still needs garlic: only the garlic bread's amounts went.
      { line: 'garlic', amounts: [['Aglio e olio', '4 cloves']], whoHas: [], claimedBy: null, checkedBy: null },
      { line: 'olive oil', amounts: [['Aglio e olio', '100ml']], whoHas: [], claimedBy: null, checkedBy: null },
      { line: 'salt', amounts: [['Aglio e olio']], whoHas: [sam.username, jo.username, kim.username], claimedBy: null, checkedBy: null },
      { line: 'spaghetti', amounts: [['Aglio e olio', '200g']], whoHas: [], claimedBy: null, checkedBy: null },
    ]);
    expect(lineOf(after, 'butter').recipes).toEqual([{ recipe: { status: 'removed', title: 'Garlic bread' }, amountTexts: ['4 tbsp'] }]);
    expect(await sam.data.getCookPlanList(planId)).toEqual(after);
    expect((await jo.data.getCookPlan(planId))?.recipes.map((r) => r.title)).toEqual(['Aglio e olio']);
  },
);

test('a "(removed)" line goes once nobody has it claimed or checked off: unclaimed, or unchecked; one still claimed or checked stays', async () => {
  const { sam, jo, kim, planId, bread, usernames } = await plan();
  const list = await sam.data.getCookPlanList(planId);
  await jo.data.claim(planId, lineOf(list, 'butter').id);
  await kim.data.checkOffCookPlanItem(planId, lineOf(list, 'chive').id);
  // Parsley is both: kim claimed it and sam bought it.
  await kim.data.claim(planId, lineOf(list, 'parsley').id);
  await sam.data.checkOffCookPlanItem(planId, lineOf(list, 'parsley').id);
  expect(await jo.data.removeRecipeFromCookPlan(planId, bread)).toEqual({ status: 'removed' });
  const names = async () => (await sam.data.getCookPlanList(planId)).items.map((i) => i.ingredient.name);
  expect(await names()).toEqual(['butter', 'chive', 'garlic', 'olive oil', 'parsley', 'salt', 'spaghetti']);

  await jo.data.unclaim(planId, lineOf(list, 'butter').id);
  await kim.data.uncheckCookPlanItem(planId, lineOf(list, 'chive').id);
  await kim.data.unclaim(planId, lineOf(list, 'parsley').id);
  expect(await names()).toEqual(['garlic', 'olive oil', 'parsley', 'salt', 'spaghetti']);
  expect(readList(await jo.data.getCookPlanList(planId), usernames).find((l) => l.line === 'parsley')).toEqual({
    line: 'parsley',
    amounts: [['Garlic bread (removed)', 'a handful']],
    whoHas: [sam.username],
    claimedBy: null,
    checkedBy: sam.username,
  });
  // Unchecking leaves the Pantry alone, as ever.
  expect(await pantryNames(kim)).toEqual(['chive']);

  await sam.data.uncheckCookPlanItem(planId, lineOf(list, 'parsley').id);
  expect(await names()).toEqual(['garlic', 'olive oil', 'salt', 'spaghetti']);
});

test('after "We cooked it", Claims answer gone, but checking off and unchecking still work and fill the buyer’s Pantry', async () => {
  const { sam, jo, planId, usernames } = await plan();
  const list = await sam.data.getCookPlanList(planId);
  const [garlic, butter] = [lineOf(list, 'garlic').id, lineOf(list, 'butter').id];
  await sam.data.claim(planId, garlic);
  await markCookPlanCookedInDatabase(planId, sam);

  await expect(jo.data.claim(planId, butter)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  await expect(sam.data.unclaim(planId, garlic)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  await jo.data.checkOffCookPlanItem(planId, garlic);
  await jo.data.checkOffCookPlanItem(planId, butter);
  await jo.data.uncheckCookPlanItem(planId, butter);

  const cooked = await sam.data.getCookPlanList(planId);
  expect(cooked.status).toBe('cooked');
  expect(readList(cooked, usernames).filter((l) => ['butter', 'garlic'].includes(l.line))).toEqual([
    { line: 'butter', amounts: [['Garlic bread', '4 tbsp']], whoHas: [jo.username], claimedBy: null, checkedBy: null },
    {
      line: 'garlic',
      amounts: [
        ['Garlic bread', '2 cloves', '1 clove'],
        ['Aglio e olio', '4 cloves'],
      ],
      whoHas: [jo.username],
      claimedBy: sam.username,
      checkedBy: jo.username,
    },
  ]);
  expect(await pantryNames(jo)).toEqual(['butter', 'garlic']);
});

test('a change that changes nothing never counts as applied: an older Claim or check is superseded, a line gone answers gone', async () => {
  const sam = await phoneWithUsername('sam');
  const { jo, planId, bread, usernames } = await plan(sam);
  const list = await jo.data.getCookPlanList(planId);
  const [garlic, parsley] = [lineOf(list, 'garlic').id, lineOf(list, 'parsley').id];

  // jo claims and checks garlic off now; sam's phone thinks it's a minute earlier.
  await jo.data.claim(planId, garlic);
  await jo.data.checkOffCookPlanItem(planId, garlic);
  sam.setClock(new Date(Date.now() - 60_000));
  await sam.data.claim(planId, garlic);
  await sam.data.uncheckCookPlanItem(planId, garlic);
  expect(readList(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'garlic')).toMatchObject({
    claimedBy: jo.username,
    checkedBy: jo.username,
  });

  // parsley goes with the garlic bread; sam's phone still has it.
  await sam.data.removeRecipeFromCookPlan(planId, bread);
  for (const change of [sam.data.claim, sam.data.unclaim, sam.data.checkOffCookPlanItem, sam.data.uncheckCookPlanItem]) {
    await expect(change(planId, parsley)).rejects.toMatchObject({ code: 'cook_plan_item_gone' });
  }
  expect((await sam.data.getCookPlanList(planId)).items.map((i) => i.ingredient.name)).not.toContain('parsley');
  expect(await pantryNames(sam)).toEqual([]);
});

test('two members claiming one line at once: the later Claim stands, whichever arrives last', async () => {
  const sam = await phoneWithUsername('sam');
  const { jo, planId, usernames } = await plan(sam);
  const garlic = lineOf(await sam.data.getCookPlanList(planId), 'garlic').id;

  // jo claims it a minute ago on her phone, and it hasn't committed yet; sam's Claim, made two
  // minutes ago by his phone's clock, arrives meanwhile, waits for jo's, and is older.
  const held = await holdCookPlanClaim(jo, planId, garlic, new Date(Date.now() - 60_000));
  sam.setClock(new Date(Date.now() - 120_000));
  const claiming = sam.data.claim(planId, garlic);
  await held.waitForWaiting(1);
  await held.commit();
  await claiming;

  expect(readList(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'garlic')?.claimedBy).toBe(jo.username);
});

test('a Recipe added while another sharing an Ingredient is removed: the shared line stays, with the new Recipe’s amount', async () => {
  const { sam, jo, planId, bread, usernames } = await plan();
  // Parsley is on the list for the garlic bread alone, until this joins it.
  const herbs = await jo.data.createRecipe({
    title: 'Herb butter',
    lines: [
      { originalText: '1 bunch parsley', amountText: '1 bunch', ingredientName: 'parsley' },
      { originalText: '1 lemon', amountText: '1', ingredientName: 'lemon' },
    ],
    steps: [],
  });
  const recipe = await jo.data.getRecipe(herbs);
  const [parsleyId, lemonId] = recipe?.lines.map((l) => l.ingredient.id) ?? [];

  // jo adds it on her phone, not committed yet; sam removes his garlic bread meanwhile.
  const held = await holdCookPlanRecipeAddWithLines(jo, planId, herbs, [
    { ingredientId: parsleyId, amountTexts: ['1 bunch'] },
    { ingredientId: lemonId, amountTexts: ['1'] },
  ]);
  const removing = sam.data.removeRecipeFromCookPlan(planId, bread);
  await held.waitForWaiting(1);
  await held.commit();
  expect(await removing).toEqual({ status: 'removed' });

  expect(readList(await sam.data.getCookPlanList(planId), usernames).map((l) => [l.line, ...l.amounts])).toEqual([
    ['garlic', ['Aglio e olio', '4 cloves']],
    ['lemon', ['Herb butter', '1']],
    ['olive oil', ['Aglio e olio', '100ml']],
    ['parsley', ['Herb butter', '1 bunch']],
    ['salt', ['Aglio e olio']],
    ['spaghetti', ['Aglio e olio', '200g']],
  ]);
});

test('a line checked off while its Recipe is removed stays, "(removed)", and the check-off lands', async () => {
  const { sam, jo, planId, bread, usernames } = await plan();
  const parsley = lineOf(await sam.data.getCookPlanList(planId), 'parsley').id;

  // jo checks parsley off in the shop, not committed yet; sam removes the garlic bread meanwhile.
  const held = await holdCookPlanCheckOff(jo, planId, parsley);
  const removing = sam.data.removeRecipeFromCookPlan(planId, bread);
  await held.waitForWaiting(1);
  await held.commit();
  expect(await removing).toEqual({ status: 'removed' });

  expect(readList(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'parsley')).toEqual({
    line: 'parsley',
    amounts: [['Garlic bread (removed)', 'a handful']],
    whoHas: [jo.username],
    claimedBy: null,
    checkedBy: jo.username,
  });
  expect(await pantryNames(jo)).toEqual(['parsley']);
});

/** An Ingredient name no other test uses: letters only, ending so the matcher leaves it as it is. */
const freshIngredient = () =>
  `${randomUUID()
    .replace(/-/g, '')
    .slice(0, 10)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))}q`;

test('a Recipe added while another sharing two of its Ingredients is removed never deadlocks: the removal goes first, then the add', async () => {
  const { sam, jo, kim, planId, usernames } = await plan();
  // sam's spice rub, with two Ingredients of its own, chosen so that the add below locks their
  // lines in the opposite order to the removal: an add goes by Ingredient, the removal by line.
  let found: { rub: RecipeId; names: string[]; first: CookPlanListItem } | null = null;
  for (let attempt = 0; attempt < 30 && !found; attempt += 1) {
    const names = [freshIngredient(), freshIngredient()];
    const rub = await sam.data.createRecipe({
      title: 'Spice rub',
      lines: names.map((name) => ({ originalText: `1 tsp ${name}`, amountText: '1 tsp', ingredientName: name })),
      steps: [],
    });
    expect(await sam.data.addRecipeToCookPlan(planId, rub)).toEqual({ status: 'added' });
    const [first, second] = (await sam.data.getCookPlanList(planId)).items
      .filter((i) => names.includes(i.ingredient.name))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (first.ingredient.id > second.ingredient.id) found = { rub, names, first };
    else expect(await sam.data.removeRecipeFromCookPlan(planId, rub)).toEqual({ status: 'removed' });
  }
  if (!found) throw new Error('Never found two lines in opposite orders.');
  const { rub, names, first } = found;
  const rubTwo = await jo.data.createRecipe({
    title: 'Rub two',
    lines: names.map((name) => ({ originalText: `2 tsp ${name}`, amountText: '2 tsp', ingredientName: name })),
    steps: [],
  });
  const lines = ((await jo.data.getRecipe(rubTwo))?.lines ?? []).map((l) => ({ ingredientId: l.ingredient.id, amountTexts: ['2 tsp'] }));

  // kim claims the line the removal locks first, and hasn't committed: sam's removal waits at it.
  // jo's add starts meanwhile and waits too. Then kim's Claim lands.
  const held = await holdCookPlanClaim(kim, planId, first.id, new Date());
  const removing = sam.data.removeRecipeFromCookPlan(planId, rub);
  await held.waitForWaiting(1);
  const adding = await startCookPlanRecipeAdd(jo, planId, rubTwo, lines);
  await adding.waitUntilBlocked();
  await held.commit();

  expect(await removing).toEqual({ status: 'removed' });
  expect(await adding.finish()).toEqual({ status: 'answered', rows: [{ answer: { status: 'added' } }] });
  const list = readList(await sam.data.getCookPlanList(planId), usernames).filter((l) => names.includes(l.line));
  expect(list.find((l) => l.line === first.ingredient.name)).toEqual({
    line: first.ingredient.name,
    amounts: [['Spice rub (removed)', '1 tsp'], ['Rub two', '2 tsp']],
    whoHas: [],
    claimedBy: kim.username,
    checkedBy: null,
  });
  expect(list.find((l) => l.line !== first.ingredient.name)?.amounts).toEqual([['Rub two', '2 tsp']]);
});

/** Every view a member's Cook Plan list screen would get, while watching it. */
function watch(user: Someone, planId: CookPlanId) {
  const views: CookPlanListView[] = [];
  const stop = user.data.watchCookPlanList(planId, (v) => views.push(v));
  return { views, last: () => views[views.length - 1], stop };
}

test('live: one member’s Claim, check-off and Recipe reach another watching the list, with no reading by hand', async () => {
  const { sam, jo, planId, usernames } = await plan();
  const butter = lineOf(await sam.data.getCookPlanList(planId), 'butter').id;
  const screen = watch(jo, planId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });
  const lineOnScreen = (name: string) => {
    const shown = screen.last();
    return shown?.status === 'loaded' ? readList(shown.list, usernames).find((l) => l.line === name) : undefined;
  };

  await sam.data.claim(planId, butter);
  await vi.waitFor(() => expect(lineOnScreen('butter')?.claimedBy).toBe(sam.username), { timeout: 5_000 });
  await sam.data.checkOffCookPlanItem(planId, butter);
  await vi.waitFor(() => expect(lineOnScreen('butter')?.checkedBy).toBe(sam.username), { timeout: 5_000 });
  await sam.data.addRecipeToCookPlan(
    planId,
    await sam.data.createRecipe({ title: 'Toast', lines: [{ originalText: 'Bread', amountText: '2 slices', ingredientName: 'bread' }], steps: [] }),
  );
  await vi.waitFor(() => expect(lineOnScreen('bread')?.amounts).toEqual([['Toast', '2 slices']]), { timeout: 5_000 });
  screen.stop();
});
