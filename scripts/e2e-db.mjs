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

/** sam adds his Recipe to a Cook Plan, as his phone would. */
async function samAddsToPlan(planId, recipeId) {
  const [{ answer }] = await asUser(SAM, 'select public.add_recipe_to_cook_plan($1, $2) as answer', [planId, recipeId]);
  if (answer.status !== 'added') throw new Error(`sam's add: ${JSON.stringify(answer)}`);
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
