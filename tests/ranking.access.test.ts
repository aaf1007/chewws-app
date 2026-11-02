// Access-rule tests for ticket 17: Ranking (decisions 17). A stranger, an unfriended user, a Friend
// and the owner skip the data layer and call PostgREST directly with their own session, as an
// attacker would. RLS, the table grants, the checks inside place_in_ranking and the activity rule
// (private.can_see_activity_of) are what have to stop them.
import { expect, inject, test } from 'vitest';

import type { RecipeId } from '../src/data';
import { signInAttacker, type Attacker } from './access-harness';
import {
  functionsAskingTheActivityRule,
  functionsRestatingTheActivityRule,
  functionsRestatingTheCookLogReadRule,
  functionsRestatingTheFriendRule,
  rankingPolicies,
  rankingWriters,
  uniqueUsername,
} from './harness';

const permissionDenied = { code: '42501' };

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

async function cooked(user: Attacker, title: string): Promise<RecipeId> {
  const recipe = await user.data.createRecipe({ title, lines: [], steps: [] });
  const logged = await user.data.addCookLog(recipe, { cookedOn: '2026-10-30' });
  if (logged.status !== 'added') throw new Error(`Couldn't log ${title}: ${logged.status}`);
  return recipe;
}

/**
 * kim's Ranking: shakshuka and dal in Liked, toast in Didn't like. sam is her Friend; ex was until
 * she unfriended him; stranger is nobody to her. `saved` is hers but not cooked.
 */
async function ranked() {
  const kim = await named('kim');
  const sam = await named('sam');
  const ex = await named('ex');
  const stranger = await named('stranger');
  await befriend(kim, sam);
  await befriend(kim, ex);
  const [shakshuka, dal, toast] = await Promise.all(['Shakshuka', 'Dal', 'Toast'].map((t) => cooked(kim, t)));
  const saved = await kim.data.createRecipe({ title: 'Saved', lines: [], steps: [] });
  for (const [recipe, band, position, seen] of [
    [shakshuka, 'liked', 1, 0],
    [dal, 'liked', 2, 1],
    [toast, 'disliked', 1, 0],
  ] as const) {
    const placed = await kim.client.rpc('place_in_ranking', { recipe_id: recipe, band, position, band_size_seen: seen });
    expect(placed.data).toEqual({ status: 'placed' });
  }
  await kim.data.unfriend(ex.userId);
  const entries = [
    { recipe_id: shakshuka, band: 'liked', position: 1 },
    { recipe_id: dal, band: 'liked', position: 2 },
    { recipe_id: toast, band: 'disliked', position: 1 },
  ];
  /** kim's Ranking is as it was. */
  async function expectUnchanged() {
    expect(await rowsOf(kim, kim)).toEqual(entries);
  }
  return { kim, sam, ex, stranger, shakshuka, dal, toast, saved, entries, expectUnchanged };
}

/** The Ranking rows of `owner`'s that `reader` gets straight from the API. */
async function rowsOf(reader: Attacker, owner: Attacker) {
  const { data, error } = await reader.client
    .from('ranking_entries')
    .select('recipe_id, band, position')
    .eq('user_id', owner.userId)
    .order('band')
    .order('position');
  if (error) throw error;
  return data;
}

test('a stranger, and a user unfriended since, read nothing of a Ranking; a Friend reads all of it', async () => {
  const { kim, sam, ex, stranger, shakshuka, entries } = await ranked();

  for (const outsider of [stranger, ex]) {
    expect(await rowsOf(outsider, kim)).toEqual([]);
    expect((await outsider.client.from('ranking_entries').select('recipe_id').eq('recipe_id', shakshuka)).data).toEqual([]);
    expect((await outsider.client.from('ranking_entries').select('recipe_id')).data).toEqual([]);
  }
  expect(await rowsOf(sam, kim)).toEqual(entries);
  // The Friend reads the entries, not the Recipes (ticket 19 widens that).
  expect((await sam.client.from('recipes').select('id').eq('id', shakshuka)).data).toEqual([]);
});

test('nobody writes a Ranking directly, not even its owner: no insert, update or delete to break its order', async () => {
  const { kim, sam, stranger, shakshuka, dal, saved, expectUnchanged } = await ranked();

  for (const user of [kim, sam, stranger]) {
    expect(
      (await user.client.from('ranking_entries').insert({ recipe_id: saved, user_id: kim.userId, band: 'liked', position: 3 }))
        .error,
    ).toMatchObject(permissionDenied);
    expect((await user.client.from('ranking_entries').update({ position: 5 }).eq('recipe_id', dal)).error).toMatchObject(
      permissionDenied,
    );
    expect((await user.client.from('ranking_entries').update({ band: 'fine' }).eq('user_id', kim.userId)).error).toMatchObject(
      permissionDenied,
    );
    expect((await user.client.from('ranking_entries').delete().eq('recipe_id', shakshuka)).error).toMatchObject(
      permissionDenied,
    );
    expect(
      (await user.client.from('ranking_entries').upsert({ recipe_id: dal, user_id: kim.userId, band: 'liked', position: 1 }))
        .error,
    ).toMatchObject(permissionDenied);
  }
  await expectUnchanged();
});

test('nobody ranks a Recipe that isn’t their own: not a stranger, not a Friend', async () => {
  const { kim, sam, stranger, shakshuka, saved, expectUnchanged } = await ranked();

  for (const user of [sam, stranger]) {
    for (const recipe of [shakshuka, saved]) {
      const placed = await user.client.rpc('place_in_ranking', { recipe_id: recipe, band: 'fine', position: 1, band_size_seen: 0 });
      expect(placed.data).toEqual({ status: 'noSuchRecipe' });
    }
    expect(await rowsOf(user, user)).toEqual([]);
  }
  await expectUnchanged();
  expect(await rowsOf(kim, sam)).toEqual([]);
});

test('a Recipe that isn’t Cooked can’t be ranked, by its owner either', async () => {
  const { kim, saved, expectUnchanged } = await ranked();
  const placed = await kim.client.rpc('place_in_ranking', { recipe_id: saved, band: 'fine', position: 1, band_size_seen: 0 });
  expect(placed.data).toEqual({ status: 'notCooked' });
  await expectUnchanged();
});

test('place_in_ranking can’t leave a gap or a clash: positions outside 1…n+1 are refused, and a stale band size changes nothing', async () => {
  const { kim, toast, expectUnchanged } = await ranked();
  const extra = await cooked(kim, 'Extra');

  for (const position of [0, -1, 4, 100]) {
    const placed = await kim.client.rpc('place_in_ranking', { recipe_id: extra, band: 'liked', position, band_size_seen: 2 });
    expect(placed.error, `position ${position}`).toMatchObject({ code: '22023' });
  }
  // Moving toast within its own band of 1: only position 1 is there.
  expect((await kim.client.rpc('place_in_ranking', { recipe_id: toast, band: 'disliked', position: 2, band_size_seen: 0 })).error).toMatchObject({
    code: '22023',
  });
  // A band size other than the band's, too small or too big, is a band that changed.
  for (const seen of [0, 1, 3]) {
    const placed = await kim.client.rpc('place_in_ranking', { recipe_id: extra, band: 'liked', position: 1, band_size_seen: seen });
    expect(placed.data, `seen ${seen}`).toEqual({ status: 'bandChanged' });
  }
  await expectUnchanged();
});

test('the private Ranking functions are not exposed through the Data API', async () => {
  const { kim, stranger } = await ranked();
  const { url, anonKey } = inject('supabase');
  const { data } = await stranger.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['can_see_activity_of', { owner: kim.userId }],
    ['lock_ranking', { who: kim.userId }],
    ['close_ranking_gaps', {}],
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
});

test('who sees a Ranking (and Cook Logs) is decided in one place, and only three functions write a Ranking', async () => {
  expect(await rankingPolicies()).toEqual(['ranking_entries SELECT: private.can_see_activity_of(user_id)']);
  // The Cook Log read rule is the same rule, asked, not restated.
  expect(await functionsAskingTheActivityRule()).toEqual(['private.can_read_cook_logs_of']);
  expect(await functionsRestatingTheActivityRule()).toEqual([]);
  expect(await functionsRestatingTheCookLogReadRule()).toEqual([]);
  expect(await functionsRestatingTheFriendRule()).toEqual([]);
  // Placing, the gap closer, and a delete of a Recipe's last Cook Log (whose gap the trigger closes).
  expect(await rankingWriters()).toEqual([
    'private.close_ranking_gaps: locks',
    'public.delete_cook_log: doesn\'t lock',
    'public.place_in_ranking: locks',
  ]);
});
