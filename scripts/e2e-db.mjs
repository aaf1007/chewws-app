// For the Maestro flows (through scripts/net-control.mjs): the few things a flow needs from the
// local database that no screen can do. Refuses any database but the local stack's.
//   node scripts/e2e-db.mjs push-draft-ready
//     Sends .maestro/assets/draft-ready.apns, with the id and title of the dev user's newest Draft,
//     to the app on the booted simulator (xcrun simctl push): "Draft ready" as Expo's push service
//     delivers it, with no Expo push token and no network.
//   node scripts/e2e-db.mjs fill-daily-limit
//     Gives the dev user link saves from an hour ago, up to the daily limit of 30, so their next
//     save is refused.
//   node scripts/e2e-db.mjs clear-dev-username
//     The dev user has no username, as a new user, so signing in asks them to choose one.
//   node scripts/e2e-db.mjs friend-request-from-sam
//     The seeded user sam asks the dev user to be Friends (send_friend_request, as sam), and
//     .maestro/assets/friend-request.apns, "@sam wants to be Friends", goes to the app on the booted
//     simulator, as the notify function would send it through Expo, with no network.
//   node scripts/e2e-db.mjs alex-accepts
//     The seeded user alex_cooks accepts the dev user's request (respond_to_friend_request, as alex).
//   node scripts/e2e-db.mjs befriend-alex
//     alex_cooks and the dev user become Friends (alex asks, the dev user accepts, each as
//     themselves), so the dev user has someone to share their list with (ticket 13).
//   node scripts/e2e-db.mjs sam-shares-list
//     sam and the dev user become Friends, sam puts Oat milk and Coffee beans on their Shopping List
//     and shares it with the dev user (ticket 13), all as sam (and the dev user accepting).
//   node scripts/e2e-db.mjs sam-adds-item
//     sam adds Dish soap to their list, as the phone would (add_manual_item, as sam): the dev user,
//     watching sam's list, sees it arrive live.
//   node scripts/e2e-db.mjs check-sams-list
//     Fails unless sam's list on the server is what the flow made it: Bananas and Bread added, Coffee
//     beans and Oat milk checked off by the dev user, and Dish soap from sam.
//   node scripts/e2e-db.mjs sam-stops-sharing
//     sam stops sharing their list with the dev user (stop_sharing_shopping_list, as sam).
//   node scripts/e2e-db.mjs befriend-sam
//     sam and the dev user become Friends (sam asks, the dev user accepts), so the dev user has
//     someone to invite into a Cook Plan (ticket 14).
//   node scripts/e2e-db.mjs sam-adds-recipe-to-plan
//     sam writes "Sam's shakshuka" and adds it to the newest Cook Plan the dev user started that sam
//     is in (create_recipe, add_recipe_to_cook_plan, as sam).
//   node scripts/e2e-db.mjs sam-invites-dev
//     sam starts a Cook Plan with his "Sam's flatbread" in it and invites the dev user (as sam), and
//     .maestro/assets/cook-plan-invite.apns, "@sam invited you to cook: Sam's flatbread", goes to the
//     app on the booted simulator, as the notify function would send it through Expo.
//   node scripts/e2e-db.mjs sam-plans-shakshuka
//     sam puts butter in his Pantry, writes "Sam's shakshuka" (4 eggs, 1 tin tomatoes, 1 clove garlic,
//     1 tsp paprika) and adds it to the newest Cook Plan the dev user started that sam is in, with its
//     lines for the plan's list (ticket 15), all as sam.
//   node scripts/e2e-db.mjs sam-claims-egg
//     sam Claims the egg line on that plan's list (claim_cook_plan_item, as sam).
//   node scripts/e2e-db.mjs check-plan-list
//     Fails unless that plan's list on the server has the dev user's changes: garlic and tomato
//     checked off by the dev user, garlic and egg claimed by them, and both in the dev user's Pantry.
//   node scripts/e2e-db.mjs sam-removes-shakshuka
//     sam takes his shakshuka out of that plan (remove_recipe_from_cook_plan, as sam).
//   node scripts/e2e-db.mjs dev-cooked-recipes
//     The dev user writes Shakshuka, Dal, Ramen and Toast and logs each cooked yesterday, and ranks
//     Shakshuka then Dal in Liked (ticket 17), all as the dev user, as their phone would. Ramen and
//     Toast are Cooked and not ranked yet.
//   node scripts/e2e-db.mjs plans-with-sam
//     sam and the dev user become Friends, and the dev user starts two Cook Plans with him (ticket
//     18): first one with no day holding the dev user's Toast and "Sam's flatbread", then one on
//     yesterday holding the dev user's Dal and "Sam's shakshuka". Each adds their own, as their phone
//     would.
//   node scripts/e2e-db.mjs sam-marks-plan-cooked
//     sam marks the newest active Cook Plan the dev user started that he is in cooked
//     (mark_cook_plan_cooked, as sam): "We cooked it" on his phone.
//   node scripts/e2e-db.mjs sam-cooked-and-ranked
//     sam and the dev user become Friends, and sam writes Shakshuka, Dal and Toast, logs Shakshuka
//     two days ago ("Smoky, extra feta", with the dev user), Dal and Toast yesterday, and ranks
//     Shakshuka in Liked and Dal in Didn't like (ticket 19), all as sam, as his phone would. Toast is
//     logged, not ranked.
//   node scripts/e2e-db.mjs sam-unfriends-dev
//     sam unfriends the dev user (unfriend, as sam).
//   node scripts/e2e-db.mjs dev-tagged-recipes
//     The dev user writes Dal, Garlic bread, Ramen, Shakshuka and Toast, Tags all five Weeknight and
//     Garlic bread Italian, and puts Leftovers on Toast and takes it off again, so it's on no Recipe
//     (ticket 22), all as the dev user, as their phone would.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

// supabase/seed.sql
const DEV_USER = 'd0d0d0d0-0000-4000-8000-000000000001';
const SAM = 'd0d0d0d0-0000-4000-8000-000000000002';
const ALEX = 'd0d0d0d0-0000-4000-8000-000000000003';
const DAILY_LIMIT = 30;
const bundleId = 'com.ant1007.recipeapp';

function dbUrl() {
  const status = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const url = /^DB_URL="(.*)"$/m.exec(status)?.[1];
  if (!url || !/@(127\.0\.0\.1|localhost):/.test(url)) throw new Error(`Not the local database: ${url}`);
  return url;
}

async function query(sql, params) {
  const db = new pg.Client({ connectionString: dbUrl() });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.end();
  }
}

/** Calls `sql` (one public RPC call) as `userId`, signed in, as the app would: through the same rules. */
async function asUser(userId, sql, params) {
  const db = new pg.Client({ connectionString: dbUrl() });
  await db.connect();
  try {
    await db.query('begin');
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.query('commit');
    return rows;
  } finally {
    await db.end();
  }
}

/** `asker` asks `answerer` to be Friends and `answerer` accepts, each as themselves. */
async function befriend(asker, answerer) {
  const [{ asked }] = await asUser(asker, 'select public.send_friend_request($1) as asked', [answerer]);
  if (asked.status !== 'requested') throw new Error(`the request: ${JSON.stringify(asked)}`);
  const [{ answer }] = await asUser(answerer, 'select public.respond_to_friend_request($1, true) as answer', [asker]);
  if (answer.status !== 'accepted') throw new Error(`the answer: ${JSON.stringify(answer)}`);
}

/** sam adds something by hand to their own list, as their phone would. */
async function samAdds(text) {
  const [list] = await query('select id from public.shopping_lists where owner_id = $1', [SAM]);
  const [{ added }] = await asUser(SAM, 'select public.add_manual_item($1, $2, $3) as added', [list.id, text, text.toLowerCase()]);
  if (added !== 'added') throw new Error(`sam's ${text}: ${added}`);
}

/** sam writes a Recipe by hand, as his phone would, and answers its id. */
async function samWrites(title, lines) {
  const [{ id }] = await asUser(SAM, 'select public.create_recipe($1, $2, $3) as id', [title, ['Simmer, then serve.'], JSON.stringify(lines)]);
  return id;
}

/**
 * sam adds his Recipe to a Cook Plan, as his phone would: with its lines for the plan's list, one
 * per Ingredient with that Ingredient's amounts in line order, as the list engine's toListLines
 * makes them (decisions 15).
 */
async function samAddsToPlan(planId, recipeId) {
  await addsToPlan(SAM, planId, recipeId);
}

/** `userId` adds their Recipe to a Cook Plan, with its lines, as `samAddsToPlan` does. */
async function addsToPlan(userId, planId, recipeId) {
  const lines = await query(
    `select l.ingredient_id,
       coalesce(array_agg(btrim(l.amount_text) order by l.position) filter (where btrim(l.amount_text) <> ''), '{}') as amount_texts
     from public.recipe_lines l where l.recipe_id = $1
     group by l.ingredient_id order by min(l.position)`,
    [recipeId],
  );
  const [{ answer }] = await asUser(userId, 'select public.add_recipe_to_cook_plan($1, $2, $3::jsonb) as answer', [
    planId,
    recipeId,
    JSON.stringify(lines),
  ]);
  if (answer.status !== 'added') throw new Error(`the add: ${JSON.stringify(answer)}`);
}

/** The newest active Cook Plan the dev user started that sam is in. */
async function devsPlanWithSam() {
  const [plan] = await query(
    `select p.id from public.cook_plans p
     join public.cook_plan_members m on m.plan_id = p.id and m.user_id = $2
     where p.creator_id = $1 and p.status = 'active' order by p.created_at desc limit 1`,
    [DEV_USER, SAM],
  );
  if (!plan) throw new Error('sam is in no Cook Plan of the dev user.');
  return plan.id;
}

/** Delivers a notification to the app on the booted simulator, as the push service would. */
function simulatorPush(asset, fill) {
  const payload = JSON.parse(readFileSync(fileURLToPath(new URL(`../.maestro/assets/${asset}`, import.meta.url)), 'utf8'));
  fill(payload);
  const file = join(mkdtempSync(join(tmpdir(), 'push-')), asset);
  writeFileSync(file, JSON.stringify(payload));
  execFileSync('xcrun', ['simctl', 'push', 'booted', bundleId, file], { stdio: 'inherit' });
}

const commands = {
  async 'push-draft-ready'() {
    const [draft] = await query(
      `select id, title from public.recipes where owner_id = $1 and status = 'draft' order by created_at desc limit 1`,
      [DEV_USER],
    );
    if (!draft) throw new Error('The dev user has no Draft to say is ready.');
    simulatorPush('draft-ready.apns', (payload) => {
      payload.body.recipeId = draft.id;
      payload.aps.alert.body = draft.title;
    });
    console.log(`pushed Draft ready for ${draft.id}`);
  },
  async 'fill-daily-limit'() {
    const rows = await query(
      `insert into public.link_saves (user_id, saved_at)
       select $1, now() - interval '1 hour'
       from generate_series(1, greatest(0, $2 - (
         select count(*) from public.link_saves where user_id = $1 and saved_at > now() - interval '24 hours'
       )))
       returning id`,
      [DEV_USER, DAILY_LIMIT],
    );
    console.log(`added ${rows.length} link saves`);
  },
  async 'clear-dev-username'() {
    await query('update public.profiles set username = null where id = $1', [DEV_USER]);
    console.log('the dev user has no username');
  },
  async 'friend-request-from-sam'() {
    const [{ answer }] = await asUser(SAM, 'select public.send_friend_request($1) as answer', [DEV_USER]);
    if (answer.status !== 'requested') throw new Error(`sam's request: ${JSON.stringify(answer)}`);
    simulatorPush('friend-request.apns', (payload) => {
      payload.body.fromUserId = SAM;
    });
    console.log('sam asked the dev user to be Friends');
  },
  async 'befriend-alex'() {
    await befriend(ALEX, DEV_USER);
    console.log('alex_cooks and the dev user are Friends');
  },
  async 'sam-shares-list'() {
    await befriend(SAM, DEV_USER);
    for (const text of ['Oat milk', 'Coffee beans']) await samAdds(text);
    const [{ answer }] = await asUser(SAM, 'select public.share_shopping_list($1) as answer', [DEV_USER]);
    if (answer.status !== 'shared') throw new Error(`sam's share: ${JSON.stringify(answer)}`);
    console.log('sam shared their list with the dev user');
  },
  async 'sam-adds-item'() {
    await samAdds('Dish soap');
    console.log('sam added Dish soap');
  },
  async 'check-sams-list'() {
    const rows = await query(
      `select i.hand_added_text as item, i.checked_by = $2 as by_dev
       from public.shopping_list_items i join public.shopping_lists l on l.id = i.list_id
       where l.owner_id = $1 order by i.hand_added_text`,
      [SAM, DEV_USER],
    );
    const found = JSON.stringify(rows.map((r) => [r.item, r.by_dev]));
    const expected = JSON.stringify([
      ['Bananas', null],
      ['Bread', null],
      ['Coffee beans', true],
      ['Dish soap', null],
      ['Oat milk', true],
    ]);
    if (found !== expected) throw new Error(`sam's list is ${found}, not ${expected}`);
    console.log("sam's list has the dev user's changes");
  },
  async 'sam-stops-sharing'() {
    const [{ answer }] = await asUser(SAM, 'select public.stop_sharing_shopping_list($1) as answer', [DEV_USER]);
    if (answer.status !== 'stopped') throw new Error(`sam's stop: ${JSON.stringify(answer)}`);
    console.log('sam stopped sharing their list with the dev user');
  },
  async 'befriend-sam'() {
    await befriend(SAM, DEV_USER);
    console.log('sam and the dev user are Friends');
  },
  async 'sam-adds-recipe-to-plan'() {
    const [plan] = await query(
      `select p.id from public.cook_plans p
       join public.cook_plan_members m on m.plan_id = p.id and m.user_id = $2
       where p.creator_id = $1 and p.status = 'active' order by p.created_at desc limit 1`,
      [DEV_USER, SAM],
    );
    if (!plan) throw new Error('sam is in no Cook Plan of the dev user.');
    const recipeId = await samWrites("Sam's shakshuka", [
      { original_text: '4 eggs', amount_text: '4', ingredient_name: 'egg' },
      { original_text: '1 tin tomatoes', amount_text: '1 tin', ingredient_name: 'tomato' },
    ]);
    await samAddsToPlan(plan.id, recipeId);
    console.log(`sam added his shakshuka to ${plan.id}`);
  },
  async 'sam-invites-dev'() {
    const [{ planId }] = await asUser(SAM, 'select public.create_cook_plan(null) as "planId"', []);
    await samAddsToPlan(planId, await samWrites("Sam's flatbread", [
      { original_text: '300g flour', amount_text: '300g', ingredient_name: 'flour' },
    ]));
    const [{ answer }] = await asUser(SAM, 'select public.invite_to_cook_plan($1, $2) as answer', [planId, DEV_USER]);
    if (answer.status !== 'invited') throw new Error(`sam's invite: ${JSON.stringify(answer)}`);
    simulatorPush('cook-plan-invite.apns', (payload) => {
      payload.body.cookPlanId = planId;
    });
    console.log(`sam invited the dev user to ${planId}`);
  },
  async 'sam-plans-shakshuka'() {
    const planId = await devsPlanWithSam();
    await asUser(SAM, "select public.add_to_pantry('butter')", []);
    const recipeId = await samWrites("Sam's shakshuka", [
      { original_text: '4 eggs', amount_text: '4', ingredient_name: 'egg' },
      { original_text: '1 tin tomatoes', amount_text: '1 tin', ingredient_name: 'tomato' },
      { original_text: '1 clove garlic', amount_text: '1 clove', ingredient_name: 'garlic' },
      { original_text: '1 tsp paprika', amount_text: '1 tsp', ingredient_name: 'paprika' },
    ]);
    await samAddsToPlan(planId, recipeId);
    console.log(`sam has butter and added his shakshuka to ${planId}`);
  },
  async 'sam-claims-egg'() {
    const planId = await devsPlanWithSam();
    const [item] = await query(
      `select i.id from public.cook_plan_items i join public.ingredients g on g.id = i.ingredient_id
       where i.plan_id = $1 and g.name = 'egg'`,
      [planId],
    );
    if (!item) throw new Error('There is no egg line on the plan.');
    const [{ answer }] = await asUser(SAM, 'select public.claim_cook_plan_item($1, $2) as answer', [planId, item.id]);
    if (answer !== 'applied') throw new Error(`sam's Claim: ${answer}`);
    console.log('sam claimed the egg');
  },
  async 'check-plan-list'() {
    const planId = await devsPlanWithSam();
    const rows = await query(
      `select g.name, i.claimed_by = $2 as claimed_by_dev, i.checked_by = $2 as checked_by_dev
       from public.cook_plan_items i join public.ingredients g on g.id = i.ingredient_id
       where i.plan_id = $1 order by g.name`,
      [planId, DEV_USER],
    );
    const found = JSON.stringify(rows.map((r) => [r.name, r.claimed_by_dev, r.checked_by_dev]));
    const expected = JSON.stringify([
      ['butter', null, null],
      ['egg', true, null],
      ['garlic', true, true],
      ['paprika', null, null],
      ['tomato', null, true],
    ]);
    if (found !== expected) throw new Error(`the plan's list is ${found}, not ${expected}`);
    const pantry = await query(
      `select g.name from public.pantry_entries p join public.ingredients g on g.id = p.ingredient_id
       where p.user_id = $1 order by g.name`,
      [DEV_USER],
    );
    const names = JSON.stringify(pantry.map((r) => r.name));
    if (names !== JSON.stringify(['garlic', 'tomato'])) throw new Error(`the dev user's Pantry is ${names}`);
    console.log("the plan's list has the dev user's changes");
  },
  async 'sam-removes-shakshuka'() {
    const planId = await devsPlanWithSam();
    const [recipe] = await query(`select id from public.recipes where owner_id = $1 and title = $2`, [SAM, "Sam's shakshuka"]);
    const [{ answer }] = await asUser(SAM, 'select public.remove_recipe_from_cook_plan($1, $2) as answer', [planId, recipe.id]);
    if (answer.status !== 'removed') throw new Error(`sam's removal: ${JSON.stringify(answer)}`);
    console.log('sam took his shakshuka out of the plan');
  },
  async 'dev-cooked-recipes'() {
    const ids = {};
    for (const title of ['Shakshuka', 'Dal', 'Ramen', 'Toast']) {
      const [{ id }] = await asUser(DEV_USER, 'select public.create_recipe($1, $2, $3) as id', [title, ['Cook it.'], '[]']);
      const [{ logged }] = await asUser(
        DEV_USER,
        "select public.add_cook_log(gen_random_uuid(), $1, (now() at time zone 'utc')::date - 1) as logged",
        [id],
      );
      if (logged.status !== 'added') throw new Error(`the dev user's ${title}: ${JSON.stringify(logged)}`);
      ids[title] = id;
    }
    for (const [title, position, seen] of [['Shakshuka', 1, []], ['Dal', 2, ['Shakshuka']]]) {
      const [{ placed }] = await asUser(
        DEV_USER,
        "select public.place_in_ranking($1, 'liked', $2, $3::uuid[]) as placed",
        [ids[title], position, seen.map((t) => ids[t])],
      );
      if (placed.status !== 'placed') throw new Error(`ranking ${title}: ${JSON.stringify(placed)}`);
    }
    console.log('the dev user has four Cooked Recipes, Shakshuka and Dal ranked in Liked');
  },
  async 'plans-with-sam'() {
    await befriend(SAM, DEV_USER);
    const devWrites = async (title, lines) => {
      const [{ id }] = await asUser(DEV_USER, 'select public.create_recipe($1, $2, $3) as id', [title, ['Cook it.'], JSON.stringify(lines)]);
      return id;
    };
    for (const [day, mine, his] of [
      [null, ['Toast', [{ original_text: '2 slices bread', amount_text: '2 slices', ingredient_name: 'bread' }]], ["Sam's flatbread", [{ original_text: '300g flour', amount_text: '300g', ingredient_name: 'flour' }]]],
      ['yesterday', ['Dal', [{ original_text: '200g lentils', amount_text: '200g', ingredient_name: 'lentil' }]], ["Sam's shakshuka", [{ original_text: '4 eggs', amount_text: '4', ingredient_name: 'egg' }]]],
    ]) {
      const [{ planId }] = await asUser(
        DEV_USER,
        day ? "select public.create_cook_plan((now() at time zone 'utc')::date - 1) as \"planId\"" : 'select public.create_cook_plan(null) as "planId"',
        [],
      );
      const [{ answer }] = await asUser(DEV_USER, 'select public.invite_to_cook_plan($1, $2) as answer', [planId, SAM]);
      if (answer.status !== 'invited') throw new Error(`the invite: ${JSON.stringify(answer)}`);
      await addsToPlan(DEV_USER, planId, await devWrites(...mine));
      await addsToPlan(SAM, planId, await samWrites(...his));
    }
    console.log('the dev user has two Cook Plans with sam');
  },
  async 'sam-marks-plan-cooked'() {
    const planId = await devsPlanWithSam();
    const [{ answer }] = await asUser(SAM, 'select public.mark_cook_plan_cooked($1) as answer', [planId]);
    if (answer.status !== 'cooked') throw new Error(`sam's "We cooked it": ${JSON.stringify(answer)}`);
    console.log(`sam marked ${planId} cooked`);
  },
  async 'sam-cooked-and-ranked'() {
    await befriend(SAM, DEV_USER);
    const ids = {};
    for (const [title, line, daysAgo, notes, companions] of [
      ['Shakshuka', { original_text: '4 eggs', amount_text: '4', ingredient_name: 'egg' }, 2, 'Smoky, extra feta', [DEV_USER]],
      ['Dal', { original_text: '200g lentils', amount_text: '200g', ingredient_name: 'lentil' }, 1, 'Too salty', []],
      ['Toast', { original_text: '2 slices bread', amount_text: '2 slices', ingredient_name: 'bread' }, 1, null, []],
    ]) {
      ids[title] = await samWrites(title, [line]);
      const [{ logged }] = await asUser(
        SAM,
        "select public.add_cook_log(gen_random_uuid(), $1, (now() at time zone 'utc')::date - $2::int, $3, $4::uuid[]) as logged",
        [ids[title], daysAgo, notes, companions],
      );
      if (logged.status !== 'added') throw new Error(`sam's ${title}: ${JSON.stringify(logged)}`);
    }
    for (const [title, band] of [['Shakshuka', 'liked'], ['Dal', 'disliked']]) {
      const [{ placed }] = await asUser(SAM, 'select public.place_in_ranking($1, $2, 1, $3::uuid[]) as placed', [ids[title], band, []]);
      if (placed.status !== 'placed') throw new Error(`ranking sam's ${title}: ${JSON.stringify(placed)}`);
    }
    console.log("sam is the dev user's Friend, with three Cook Logs and two Recipes ranked");
  },
  async 'sam-unfriends-dev'() {
    await asUser(SAM, 'select public.unfriend($1)', [DEV_USER]);
    console.log('sam unfriended the dev user');
  },
  async 'dev-tagged-recipes'() {
    const ids = {};
    for (const title of ['Dal', 'Garlic bread', 'Ramen', 'Shakshuka', 'Toast']) {
      const [{ id }] = await asUser(DEV_USER, 'select public.create_recipe($1, $2, $3) as id', [title, ['Cook it.'], '[]']);
      ids[title] = id;
    }
    const tag = async (title, name) => {
      const [{ added }] = await asUser(DEV_USER, 'select public.add_tag($1, $2) as added', [ids[title], name]);
      if (!added) throw new Error(`Tagging the dev user's ${title} ${name}: ${JSON.stringify(added)}`);
      return added.id;
    };
    for (const title of Object.keys(ids)) await tag(title, 'Weeknight');
    await tag('Garlic bread', 'Italian');
    const leftovers = await tag('Toast', 'Leftovers');
    await asUser(DEV_USER, 'delete from public.recipe_tags where recipe_id = $1 and tag_id = $2', [ids.Toast, leftovers]);
    console.log('the dev user has five Recipes Tagged Weeknight, Garlic bread Italian too, and Leftovers on none');
  },
  async 'alex-accepts'() {
    const [{ answer }] = await asUser(ALEX, 'select public.respond_to_friend_request($1, true) as answer', [DEV_USER]);
    if (answer.status !== 'accepted') throw new Error(`alex's answer: ${JSON.stringify(answer)}`);
    console.log("alex_cooks accepted the dev user's request");
  },
};

const command = commands[process.argv[2]];
if (!command) {
  console.error(`usage: node scripts/e2e-db.mjs ${Object.keys(commands).join(' | ')}`);
  process.exit(2);
}
await command();
