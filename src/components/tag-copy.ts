import type { TagWithRecipes } from '@/data';

/** How many Recipes the confirmation names before "and N more". */
const NAMED = 3;

/** "0 Recipes", "1 Recipe", "12 Recipes": how many of the user's Recipes a Tag is on. */
export const recipeCount = (tag: TagWithRecipes) => `${tag.recipes.length} ${tag.recipes.length === 1 ? 'Recipe' : 'Recipes'}`;

/** "A and B", "A, B and C". */
const andList = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * The confirmation before deleting a Tag: its title, and a message naming the Recipes it comes off
 * (the first three, then "and 2 more"), or that it's on none.
 */
export function deleteTagConfirmation(tag: TagWithRecipes): { title: string; message: string } {
  const titles = tag.recipes.map((r) => `“${r.title}”`);
  const more = titles.length - NAMED;
  const named = more > 0 ? [...titles.slice(0, NAMED), `${more} more`] : titles;
  return {
    title: `Delete “${tag.name}”?`,
    message: titles.length === 0 ? 'It isn’t on any Recipe.' : `It comes off ${andList(named)}.`,
  };
}
