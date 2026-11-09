import { normaliseIngredientName } from './ingredient-matcher';

/**
 * One word of a search: `text` is looked for in titles and Tag names, `ingredient` (the word put
 * through the Ingredient matcher, so "tomatoes" finds "tomato") in Ingredient names. `ingredient`
 * is '' when the matcher leaves nothing of the word ("&").
 */
export type SearchWord = { text: string; ingredient: string };

/**
 * What the user typed into search, as the words every match must have (decisions 06). Each word
 * is made search text as the database makes titles and Tag names: accents composed (NFC),
 * lowercase, and curly apostrophes straight (a phone types "Rosa’s"). No words: search for nothing
 * in particular, which finds every Recipe.
 */
export function searchWords(query: string): SearchWord[] {
  return query
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’ʼ]/gu, "'")
    .split(/\s+/u)
    .filter(Boolean)
    .map((text) => ({ text, ingredient: normaliseIngredientName(text) }));
}
