/**
 * The Ingredient matcher: turns what a user typed into the name an Ingredient is stored under, so
 * "Garlic", "garlic " and "garlics" all mean the same Ingredient. No fuzzy matching, no plural
 * library: our own ordered rules, tested against real ingredient names.
 *
 * 1. Compose accents (NFC), so a decomposed "crème" matches a composed one.
 * 2. Lowercase, locale-independently ("İSOT" keeps its dot as a combining mark).
 * 3. Drop apostrophes ("Hellmann's" → "hellmanns"); every character other than a letter, a
 *    combining mark or a number becomes a space; collapse and trim spaces.
 * 4. Singularise the last word only (see `singular`).
 *
 * Returns '' when nothing is left, which the Recipe checks treat as a missing Ingredient.
 */
export function normaliseIngredientName(raw: string): string {
  const words = raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/['‘’ʼ]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const last = words.pop();
  return last === undefined ? '' : [...words, singular(last)].join(' ');
}

/** Words that look plural but are one thing. */
const UNCOUNTABLE = new Set(['molasses', 'schnapps', 'bitters', 'grits']);

/** Plurals the suffix rules below get wrong. */
const IRREGULAR = new Map([
  ['leaves', 'leaf'],
  ['loaves', 'loaf'],
  ['halves', 'half'],
  ['calves', 'calf'],
  ['knives', 'knife'],
  ['geese', 'goose'],
  ['feet', 'foot'],
  ['quiches', 'quiche'],
  ['brioches', 'brioche'],
  ['ganaches', 'ganache'],
  ['mousses', 'mousse'],
  ['glazes', 'glaze'],
  ['sloes', 'sloe'],
  ['kiwis', 'kiwi'],
  ['rotis', 'roti'],
  ['chapatis', 'chapati'],
  ['salamis', 'salami'],
]);

/** Singulars ending in -ie or -i whose plural ends in -ies, which `-ies → -y` would mangle. */
const IE_OR_I = new Set([
  'cookie',
  'brownie',
  'veggie',
  'smoothie',
  'pie',
  'hoagie',
  'goodie',
  'calorie',
  'chilli',
  'chili',
  'pierogi',
]);

/** One word's singular, by the first rule that applies. */
function singular(word: string): string {
  if (UNCOUNTABLE.has(word)) return word;
  const irregular = IRREGULAR.get(word);
  if (irregular !== undefined) return irregular;
  if (word.endsWith('ies')) {
    if (IE_OR_I.has(word.slice(0, -1))) return word.slice(0, -1); // cookies → cookie
    if (IE_OR_I.has(word.slice(0, -2))) return word.slice(0, -2); // chillies → chilli
    return `${word.slice(0, -3)}y`; // berries → berry
  }
  if (word.endsWith('oes')) return word.slice(0, -2); // tomatoes → tomato
  if (/(?:ch|sh|x|ss|z)es$/u.test(word)) return word.slice(0, -2); // peaches → peach
  // hummus, haggis, swiss and short words such as "gas" or "ms" keep their s.
  if (word.endsWith('s') && !/(?:ss|us|is)$/u.test(word) && [...word].length > 3) {
    return word.slice(0, -1);
  }
  return word;
}
