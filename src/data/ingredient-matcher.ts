import pluralize from 'pluralize';

// Words that end like plurals but aren't, which pluralize would otherwise mangle ("molasses" →
// "molass"). Checked before singularising the last word.
const UNCOUNTABLE = new Set(['molasses']);

/**
 * The Ingredient matcher: turns what a user typed into the name an Ingredient is stored under, so
 * "Garlic", "garlic " and "garlics" all mean the same Ingredient. Lowercases, turns punctuation
 * into spaces, collapses whitespace and singularises the last word. No fuzzy matching.
 * Returns '' when nothing is left.
 */
export function normaliseIngredientName(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = words.pop();
  if (last === undefined) return '';
  return [...words, UNCOUNTABLE.has(last) ? last : pluralize.singular(last)].join(' ');
}
