// What the Tags screen says (src/components/tag-copy.ts): each Tag's count, and the confirmation
// before deleting one, which names the first three Recipes it comes off, then "and N more".
import { expect, test } from 'vitest';

import { deleteTagConfirmation, recipeCount } from '@/components/tag-copy';
import { parseRecipeId, parseTagId, type TagWithRecipes } from '@/data';

const tag = (name: string, titles: string[]): TagWithRecipes => ({
  id: parseTagId('00000000-0000-4000-8000-0000000000a1'),
  name,
  recipes: titles.map((title, i) => ({ id: parseRecipeId(`00000000-0000-4000-8000-0000000000b${i}`), title })),
});

test('a Tag’s count reads 0 Recipes, 1 Recipe, 2 Recipes', () => {
  expect([[], ['Dal'], ['Dal', 'Toast']].map((titles) => recipeCount(tag('Weeknight', titles)))).toEqual([
    '0 Recipes',
    '1 Recipe',
    '2 Recipes',
  ]);
});

test('the confirmation names the Recipes a Tag comes off: all of up to three, then the first three and how many more', () => {
  const said = (titles: string[]) => deleteTagConfirmation(tag("Nonna's", titles)).message;

  expect(deleteTagConfirmation(tag("Nonna's", []))).toEqual({ title: 'Delete “Nonna\'s”?', message: 'It isn’t on any Recipe.' });
  expect(said(['Crème brûlée'])).toBe('It comes off “Crème brûlée”.');
  expect(said(['Crème brûlée', "Nonna's ragù"])).toBe('It comes off “Crème brûlée” and “Nonna\'s ragù”.');
  expect(said(['A', 'B, with a comma', 'C'])).toBe('It comes off “A”, “B, with a comma” and “C”.');
  expect(said(['A', 'B', 'C', 'D'])).toBe('It comes off “A”, “B”, “C” and 1 more.');
  expect(said(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('It comes off “A”, “B”, “C” and 3 more.');
});

test('the confirmation keeps a Tag’s name as spelled, emoji and accents included', () => {
  expect(deleteTagConfirmation(tag('\u{1F468}‍\u{1F373} Crème', [])).title).toBe('Delete “\u{1F468}‍\u{1F373} Crème”?');
});
