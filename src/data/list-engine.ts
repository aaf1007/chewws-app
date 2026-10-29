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
 * It also puts a Shopping List in order, and shows it with the changes the phone hasn't sent yet,
 * and does the same for a Cook Plan list, annotating each line with the members who have it.
 */
import type {
  CookPlanId,
  CookPlanItemId,
  CookPlanList,
  CookPlanListItem,
  Ingredient,
  IngredientId,
  ListPerson,
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

/**
 * The list a change is for (decisions 13, 15): the user's own Shopping List or a Friend's shared
 * with them, or a Cook Plan's list. The server takes a change only for a list its sender can use
 * when it arrives.
 */
export type ShoppingListRef = { kind: 'shoppingList'; id: ShoppingListId };
export type CookPlanListRef = { kind: 'cookPlan'; id: CookPlanId };
export type ListRef = ShoppingListRef | CookPlanListRef;

/** A change to a Shopping List the phone can make with no signal, queued until it's sent. */
export type ShoppingListChange =
  | { kind: 'checkOff'; list: ShoppingListRef; itemId: ShoppingListItemId }
  | { kind: 'uncheck'; list: ShoppingListRef; itemId: ShoppingListItemId }
  /** Something typed by hand, with the id the phone made for it. */
  | { kind: 'addManualItem'; list: ShoppingListRef; itemId: ShoppingListItemId; text: string };

/** A change to a Cook Plan's list the phone can make with no signal. There are no hand-added lines. */
export type CookPlanListChange = {
  kind: 'checkOff' | 'uncheck' | 'claim' | 'unclaim';
  list: CookPlanListRef;
  itemId: CookPlanItemId;
};

/** A change to a list, queued until it's sent. Each names its list; one queue holds every kind. */
export type ListChange = ShoppingListChange | CookPlanListChange;

export const isCookPlanChange = (change: ListChange): change is CookPlanListChange => change.list.kind === 'cookPlan';

export const isShoppingListChange = (change: ListChange): change is ShoppingListChange =>
  change.list.kind === 'shoppingList';

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
  list: Pick<ShoppingList, 'id' | 'ownerId' | 'ownerUsername' | 'sharedWith'>,
  items: readonly ShoppingListItem[],
): ShoppingList {
  const recipes = new Map(
    items.flatMap((item) => (item.kind === 'ingredient' ? item.recipes : [])).map((r) => [r.recipe.id, r.recipe]),
  );
  return {
    id: list.id,
    ownerId: list.ownerId,
    ownerUsername: list.ownerUsername,
    sharedWith: list.sharedWith,
    items: sortListItems(items),
    recipes: [...recipes.values()].sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id)),
  };
}

/**
 * The list as the phone shows it: the last list read from the server with the changes made since
 * on top, in the order they were made. Only the changes that name this list count. A check made
 * here is by `me`, at the time it was made. An item added here has no Ingredient yet: the server
 * matches it when it arrives. A change to an item that isn't on the list does nothing. Applying a
 * change twice is the same as once.
 */
export function withListChanges(
  list: ShoppingList,
  changes: readonly { madeAt: string; change: ListChange }[],
  me: UserId,
): ShoppingList {
  let items = list.items;
  for (const { madeAt, change } of changes) {
    if (!isShoppingListChange(change) || change.list.id !== list.id) continue;
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

/** Which member has which Ingredient on a Cook Plan's lines, as the server computed it. */
export type WhoHas = { ingredientId: IngredientId; userId: UserId };

/** A Cook Plan list's order: by Ingredient name. */
const byIngredient = (a: CookPlanListItem, b: CookPlanListItem) =>
  compareText(a.ingredient.name, b.ingredient.name) || compareText(a.id, b.id);

/**
 * A Cook Plan list with these lines, in order, each annotated with the members who have its
 * Ingredient (`whoHas`, from their Pantry or Staples), in the order the plan lists its members.
 * Someone `whoHas` names who isn't a member any more is left out.
 */
export function toCookPlanList(
  plan: Pick<CookPlanList, 'planId' | 'status' | 'members'>,
  items: readonly Omit<CookPlanListItem, 'whoHas'>[],
  whoHas: readonly WhoHas[],
): CookPlanList {
  const having = new Map<IngredientId, Set<UserId>>();
  for (const { ingredientId, userId } of whoHas) {
    having.set(ingredientId, (having.get(ingredientId) ?? new Set()).add(userId));
  }
  const withWhoHas = items.map((item) => {
    const who = having.get(item.ingredient.id);
    const people: ListPerson[] = who ? plan.members.filter((m) => who.has(m.id)) : [];
    return { ...item, whoHas: people };
  });
  return { planId: plan.planId, status: plan.status, members: plan.members, items: withWhoHas.sort(byIngredient) };
}

/**
 * A Cook Plan list as the phone shows it: the last list read with the changes made since on top, in
 * the order they were made, as `withListChanges` does for a Shopping List. A check or Claim made
 * here is `me`'s, at the time it was made; unclaiming clears only `me`'s own Claim. Only changes
 * naming this plan count.
 */
export function withCookPlanChanges(
  list: CookPlanList,
  changes: readonly { madeAt: string; change: ListChange }[],
  me: UserId,
): CookPlanList {
  let items = list.items;
  for (const { madeAt, change } of changes) {
    if (!isCookPlanChange(change) || change.list.id !== list.planId) continue;
    items = items.map((item): CookPlanListItem => {
      if (item.id !== change.itemId) return item;
      switch (change.kind) {
        case 'checkOff':
          return item.check.status === 'checked' ? item : { ...item, check: { status: 'checked', checkedAt: madeAt, checkedBy: me } };
        case 'uncheck':
          return { ...item, check: { status: 'unchecked' } };
        case 'claim':
          return item.claim.status === 'claimed' && item.claim.claimedBy === me
            ? item
            : { ...item, claim: { status: 'claimed', claimedAt: madeAt, claimedBy: me } };
        case 'unclaim':
          return item.claim.status === 'claimed' && item.claim.claimedBy === me ? { ...item, claim: { status: 'unclaimed' } } : item;
      }
    });
  }
  return items === list.items ? list : { ...list, items };
}
