// The list engine through its own seam, for the case the Shopping List can't reach yet: several
// Recipes combined in one go, as the Cook Plan list (ticket 15) will. Everything else about it is
// covered through the data layer in shopping-list.test.ts.
import { expect, test } from 'vitest';

import { toListLines } from '../src/data/list-engine';
import { parseIngredientId, parseRecipeId } from '../src/data/types';

const garlic = { id: parseIngredientId('00000000-0000-4000-8000-00000000000a'), name: 'garlic' };
const butter = { id: parseIngredientId('00000000-0000-4000-8000-00000000000b'), name: 'butter' };
const salt = { id: parseIngredientId('00000000-0000-4000-8000-00000000000c'), name: 'salt' };
const bread = parseRecipeId('00000000-0000-4000-8000-000000000001');
const pasta = parseRecipeId('00000000-0000-4000-8000-000000000002');

const line = (ingredient: typeof garlic, amountText: string | null) => ({
  originalText: ingredient.name,
  amountText,
  ingredient,
});

test('several Recipes give one line per Ingredient, each Recipe with its own amounts, none added up', () => {
  const lines = toListLines([
    { id: bread, lines: [line(garlic, '2 cloves'), line(butter, ' 4 tbsp '), line(salt, null)] },
    { id: pasta, lines: [line(butter, '1 stick'), line(garlic, '4 cloves'), line(garlic, '1 clove'), line(salt, '  ')] },
  ]);

  expect(lines).toEqual([
    {
      ingredient: garlic,
      amounts: [
        { recipeId: bread, amountTexts: ['2 cloves'] },
        { recipeId: pasta, amountTexts: ['4 cloves', '1 clove'] },
      ],
    },
    {
      ingredient: butter,
      amounts: [
        { recipeId: bread, amountTexts: ['4 tbsp'] },
        { recipeId: pasta, amountTexts: ['1 stick'] },
      ],
    },
    {
      ingredient: salt,
      amounts: [
        { recipeId: bread, amountTexts: [] },
        { recipeId: pasta, amountTexts: [] },
      ],
    },
  ]);
});

test('Ingredients to skip get no line; nothing to skip, no Recipes or no lines give what you expect', () => {
  const recipes = [
    { id: bread, lines: [line(garlic, '2 cloves'), line(salt, null)] },
    { id: pasta, lines: [line(salt, 'a pinch')] },
  ];

  expect(toListLines(recipes, new Set([salt.id]))).toEqual([
    { ingredient: garlic, amounts: [{ recipeId: bread, amountTexts: ['2 cloves'] }] },
  ]);
  expect(toListLines(recipes, new Set([salt.id, garlic.id]))).toEqual([]);
  expect(toListLines([])).toEqual([]);
  expect(toListLines([{ id: bread, lines: [] }])).toEqual([]);
});
