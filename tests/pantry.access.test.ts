// Access-rule tests for the Pantry and Staples: a stranger skips the data layer and calls PostgREST
// directly with the anon key and their own session, as an attacker would. RLS is what has to stop them.
import { expect, test } from 'vitest';

import { signInAttacker } from './access-harness';

/** An owner with garlic in their Pantry and salt, pepper and oil as Staples, plus a stranger. */
async function ownerAndStranger() {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const garlic = await owner.data.addToPantry('garlic');
  const before = await owner.data.getPantry();
  const salt = before.staples.find((i) => i.name === 'salt');
  if (!salt) throw new Error('the owner has no salt Staple');

  async function expectOwnerStillHasEverything() {
    expect(await owner.data.getPantry()).toEqual(before);
    expect(before.ingredients.map((i) => i.name)).toEqual(['garlic']);
    expect(before.staples.map((i) => i.name)).toEqual(['oil', 'pepper', 'salt']);
  }

  return { owner, garlic, salt, stranger: stranger.client, expectOwnerStillHasEverything };
}

test("a stranger cannot read someone else's Pantry or Staples", async () => {
  const { owner, garlic, stranger, expectOwnerStillHasEverything } = await ownerAndStranger();

  const pantryByUser = await stranger.from('pantry_entries').select('*').eq('user_id', owner.userId);
  const pantryByIngredient = await stranger.from('pantry_entries').select('*').eq('ingredient_id', garlic.id);
  const staples = await stranger.from('staples').select('*').eq('user_id', owner.userId);

  expect(pantryByUser).toMatchObject({ data: [], error: null });
  expect(pantryByIngredient).toMatchObject({ data: [], error: null });
  expect(staples).toMatchObject({ data: [], error: null });
  await expectOwnerStillHasEverything();
});

test("a stranger cannot add to someone else's Pantry or Staples", async () => {
  const { owner, stranger, expectOwnerStillHasEverything } = await ownerAndStranger();
  // An Ingredient the owner has neither in their Pantry nor as a Staple.
  const butter = await stranger.rpc('add_to_pantry', { ingredient_name: 'butter' });
  if (butter.error) throw butter.error;

  const pantry = await stranger.from('pantry_entries').insert({ user_id: owner.userId, ingredient_id: butter.data });
  const staples = await stranger.from('staples').insert({ user_id: owner.userId, ingredient_id: butter.data });

  expect(pantry.error).toMatchObject({ code: '42501' });
  expect(staples.error).toMatchObject({ code: '42501' });
  await expectOwnerStillHasEverything();
});

test("a stranger cannot change someone else's Pantry entries or Staples", async () => {
  const { owner, garlic, salt, stranger, expectOwnerStillHasEverything } = await ownerAndStranger();

  const pantry = await stranger
    .from('pantry_entries')
    .update({ ingredient_id: salt.id })
    .eq('user_id', owner.userId)
    .eq('ingredient_id', garlic.id)
    .select();
  const staples = await stranger
    .from('staples')
    .update({ ingredient_id: garlic.id })
    .eq('user_id', owner.userId)
    .eq('ingredient_id', salt.id)
    .select();

  expect(pantry).toMatchObject({ data: null, error: { code: '42501' } });
  expect(staples).toMatchObject({ data: null, error: { code: '42501' } });
  await expectOwnerStillHasEverything();
});

test("a stranger cannot mark someone else's Ingredients used up or remove their Staples", async () => {
  const { owner, garlic, salt, stranger, expectOwnerStillHasEverything } = await ownerAndStranger();

  const pantry = await stranger
    .from('pantry_entries')
    .delete()
    .eq('user_id', owner.userId)
    .eq('ingredient_id', garlic.id)
    .select();
  const staples = await stranger
    .from('staples')
    .delete()
    .eq('user_id', owner.userId)
    .eq('ingredient_id', salt.id)
    .select();

  expect(pantry).toMatchObject({ data: [], error: null });
  expect(staples).toMatchObject({ data: [], error: null });
  await expectOwnerStillHasEverything();
});

test("a stranger's Pantry and Staples functions touch only their own, and say nothing of the owner's", async () => {
  const { garlic, salt, stranger, expectOwnerStillHasEverything } = await ownerAndStranger();

  const added = await stranger.rpc('add_to_pantry', { ingredient_name: 'garlic' });
  const stapled = await stranger.rpc('add_staple', { ingredient_name: 'garlic' });
  const unstapled = await stranger.from('staples').delete().in('ingredient_id', [salt.id, garlic.id]);
  expect(added).toMatchObject({ data: garlic.id, error: null });
  expect(stapled).toMatchObject({ data: garlic.id, error: null });
  expect(unstapled.error).toBeNull();
  await expectOwnerStillHasEverything();

  // The stranger now has garlic but not salt; the owner's salt doesn't count for them.
  expect(await stranger.rpc('has_ingredient', { ingredient_id: garlic.id })).toMatchObject({ data: true });
  expect(await stranger.rpc('has_ingredient', { ingredient_id: salt.id })).toMatchObject({ data: false });
  await stranger.from('pantry_entries').delete().eq('ingredient_id', garlic.id);
  expect(await stranger.rpc('has_ingredient', { ingredient_id: garlic.id })).toMatchObject({ data: false });
  await expectOwnerStillHasEverything();
});
