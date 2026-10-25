/**
 * The list engine: turns Recipes into list lines. Pure, no I/O. The Shopping List uses it to add a
 * Recipe, and the Cook Plan list (ticket 15) to combine a plan's Recipes.
 *
 * - One line per Ingredient, in the order the Ingredients first appear.
 * - Each line keeps every Recipe's own amounts, in line order, under that Recipe. Amounts are text
 *   and are never added together: "2 cloves" and "1 clove" stay two amounts. Blank ones are dropped.
 * - A Recipe that lists an Ingredient twice is under that line once, with both amounts.
 * - Ingredients in `skip` (for a Shopping List, what the user has) get no line.
 *
 * Where a checked-off line's Ingredient goes is decided by the `check_off` database function, not
 * here: it writes another user's Pantry, so the server can't take the client's word for it.
 */
import type { Ingredient, IngredientId, Recipe, RecipeId } from './types';

/** The parts of a Recipe the engine reads. */
export type RecipeForList = Pick<Recipe, 'id' | 'lines'>;

/** One Recipe's amounts on a list line. */
export type RecipeAmounts = { recipeId: RecipeId; amountTexts: string[] };

export type ListLine = { ingredient: Ingredient; amounts: RecipeAmounts[] };

export function toListLines(
  recipes: readonly RecipeForList[],
  skip: ReadonlySet<IngredientId> = new Set(),
): ListLine[] {
  const lines = new Map<IngredientId, ListLine>();
  for (const recipe of recipes) {
    for (const { ingredient, amountText } of recipe.lines) {
      if (skip.has(ingredient.id)) continue;
      let line = lines.get(ingredient.id);
      if (!line) {
        line = { ingredient, amounts: [] };
        lines.set(ingredient.id, line);
      }
      let mine = line.amounts.find((a) => a.recipeId === recipe.id);
      if (!mine) {
        mine = { recipeId: recipe.id, amountTexts: [] };
        line.amounts.push(mine);
      }
      const amount = amountText?.trim();
      if (amount) mine.amountTexts.push(amount);
    }
  }
  return [...lines.values()];
}
