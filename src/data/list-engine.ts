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
 *
 * It also puts a Shopping List in order, and shows it with the changes the phone hasn't sent yet.
 */
import type {
  Ingredient,
  IngredientId,
  Recipe,
  RecipeId,
  ShoppingList,
  ShoppingListId,
  ShoppingListItem,
  ShoppingListItemId,
  UserId,
} from './types';

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

/** A change to a Shopping List the phone can make with no signal, queued until it's sent. */
export type ListChange =
  | { kind: 'checkOff'; itemId: ShoppingListItemId }
  | { kind: 'uncheck'; itemId: ShoppingListItemId }
  /**
   * Something typed by hand, with the id the phone made for it, for the list `listId`: the server
   * refuses it unless whoever sends it can use that list.
   */
  | { kind: 'addManualItem'; listId: ShoppingListId; itemId: ShoppingListItemId; text: string };

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** An Ingredient line comes before a hand-added item of the same name. */
const KIND_ORDER = { ingredient: 0, handAdded: 1 } as const;

const itemName = (item: ShoppingListItem) =>
  item.kind === 'ingredient' ? item.ingredient.name : item.text.toLowerCase();

/** A Shopping List's order: by name (an Ingredient line's Ingredient, a hand-added item's text). */
export function sortListItems(items: readonly ShoppingListItem[]): ShoppingListItem[] {
  return [...items].sort(
    (a, b) =>
      compareText(itemName(a), itemName(b)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareText(a.id, b.id),
  );
}

/**
 * A Shopping List with these items, in order, and as its Recipes the ones its lines name (by
 * title). Every list the phone holds is made here, so its Recipes always match its lines: a Recipe
 * goes as its last line does.
 */
export function withItems(
  list: Pick<ShoppingList, 'id' | 'ownerId'>,
  items: readonly ShoppingListItem[],
): ShoppingList {
  const recipes = new Map(
    items.flatMap((item) => (item.kind === 'ingredient' ? item.recipes : [])).map((r) => [r.recipe.id, r.recipe]),
  );
  return {
    id: list.id,
    ownerId: list.ownerId,
    items: sortListItems(items),
    recipes: [...recipes.values()].sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id)),
  };
}

/**
 * The list as the phone shows it: the last list read from the server with the changes made since
 * on top, in the order they were made. A check made here is by `me`, at the time it was made. An
 * item added here has no Ingredient yet: the server matches it when it arrives. A change to an item
 * that isn't on the list does nothing. Applying a change twice is the same as once.
 */
export function withListChanges(
  list: ShoppingList,
  changes: readonly { madeAt: string; change: ListChange }[],
  me: UserId,
): ShoppingList {
  let items = list.items;
  for (const { madeAt, change } of changes) {
    if (change.kind === 'addManualItem') {
      if (items.some((item) => item.id === change.itemId)) continue;
      const added: ShoppingListItem = {
        kind: 'handAdded',
        id: change.itemId,
        text: change.text,
        ingredient: null,
        check: { status: 'unchecked' },
      };
      items = [...items, added];
      continue;
    }
    items = items.map((item) => {
      if (item.id !== change.itemId) return item;
      if (change.kind === 'uncheck') return { ...item, check: { status: 'unchecked' } };
      return item.check.status === 'checked' ? item : { ...item, check: { status: 'checked', checkedAt: madeAt, checkedBy: me } };
    });
  }
  return items === list.items ? list : withItems(list, items);
}
