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
