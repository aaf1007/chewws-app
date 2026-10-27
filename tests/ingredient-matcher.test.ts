import { expect, test } from 'vitest';

import { normaliseIngredientName } from '../src/data';

// What a user types for an Ingredient → the name it is stored under. Same name, same Ingredient.
const CASES: [input: string, key: string][] = [
  ['garlic', 'garlic'],
  ['garlics', 'garlic'],
  ['Garlic', 'garlic'],
  ['  Garlic  ', 'garlic'],
  ['GARLIC,', 'garlic'],
  ['tomatoes', 'tomato'],
  ['potatoes', 'potato'],
  ['berries', 'berry'],
  ['cherries', 'cherry'],
  ['anchovies', 'anchovy'],
  ['chillies', 'chilli'],
  ['chilli', 'chilli'],
  ['chilies', 'chili'],
  ['chili', 'chili'],
  ['cookies', 'cookie'],
  ['brownies', 'brownie'],
  ['veggies', 'veggie'],
  ['pies', 'pie'],
  ['peaches', 'peach'],
  ['radishes', 'radish'],
  ['boxes', 'box'],
  ['quiches', 'quiche'],
  ['kiwis', 'kiwi'],
  // Plurals of -i words lose their s.
  ['chilis', 'chili'],
  ['chillis', 'chilli'],
  ['pierogis', 'pierogi'],
  ['zucchinis', 'zucchini'],
  ['martinis', 'martini'],
  ['paninis', 'panini'],
  ['blinis', 'blini'],
  ['bay leaves', 'bay leaf'],
  ['onions', 'onion'],
  ['cloves', 'clove'],
  ['eggs', 'egg'],
  ['peas', 'pea'],
  ['oats', 'oat'],
  ['green beans', 'green bean'],
  ['Brussels sprouts', 'brussels sprout'],
  ['  Olive   Oils ', 'olive oil'],
  ['hummus', 'hummus'],
  ['molasses', 'molasses'],
  ['couscous', 'couscous'],
  ['haggis', 'haggis'],
  ['pastis', 'pastis'],
  ['schnapps', 'schnapps'],
  ['Angostura bitters', 'angostura bitters'],
  ['asparagus', 'asparagus'],
  ['swiss cheese', 'swiss cheese'],
  // The apostrophe goes, then the trailing s like any plural's.
  ["Hellmann's", 'hellmann'],
  ['Hellmann’s', 'hellmann'],
  // "&" splits the words; "ms" is too short to lose its s.
  ["M&M's", 'm ms'],
  ['salt & pepper', 'salt pepper'],
  ['Crème fraîche', 'crème fraîche'],
  ['Crème fraîche'.normalize('NFD'), 'crème fraîche'],
  ['jalapeño', 'jalapeño'],
  ['Jalapeños', 'jalapeño'],
  ['हल्दी', 'हल्दी'],
  ['ไก่', 'ไก่'],
  ['2% milk', '2 milk'],
  // Locale-independent lowercase: "İ" becomes "i" plus a combining dot, which is kept.
  ['İSOT', 'i̇sot'],
  ['  ', ''],
  ['?!', ''],
];

test.each(CASES)('%j is the Ingredient %j', (input, key) => {
  expect(normaliseIngredientName(input)).toBe(key);
});

test('the decomposed crème fraîche really is a different string before matching', () => {
  expect('Crème fraîche'.normalize('NFD')).not.toBe('Crème fraîche');
});
