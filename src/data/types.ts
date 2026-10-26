export type UserId = string & { readonly __brand: 'UserId' };
export type RecipeId = string & { readonly __brand: 'RecipeId' };
export type IngredientId = string & { readonly __brand: 'IngredientId' };
export type ShoppingListId = string & { readonly __brand: 'ShoppingListId' };
export type ShoppingListItemId = string & { readonly __brand: 'ShoppingListItemId' };

export type Profile = {
  id: UserId;
  username: string | null;
  createdAt: string;
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; userId: UserId };

/** A plain, unquantified food item, stored under its normalised name. */
export type Ingredient = { id: IngredientId; name: string };

export type RecipeLine = {
  originalText: string;
  amountText: string | null;
  ingredient: Ingredient;
};

export type Recipe = {
  id: RecipeId;
  ownerId: UserId;
  title: string;
  status: 'draft' | 'reviewed';
  recipeFound: boolean;
  lines: RecipeLine[];
  steps: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * What a user has: the Ingredients in their Pantry and their Staples, each sorted by name. A Staple
 * always counts as had, whether or not it's also in the Pantry.
 */
export type Pantry = { ingredients: Ingredient[]; staples: Ingredient[] };

/** A Recipe as the library lists it. */
export type RecipeSummary = {
  id: RecipeId;
  title: string;
  lineCount: number;
  stepCount: number;
  createdAt: string;
};

/** What the user typed for one ingredient line. `ingredientName` is matched to an Ingredient. */
export type RecipeLineInput = {
  originalText: string;
  amountText?: string | null;
  ingredientName: string;
};

/** What the user typed for a whole Recipe. Blank lines and steps are dropped. */
export type RecipeInput = {
  title: string;
  lines: readonly RecipeLineInput[];
  steps: readonly string[];
};

/** Whether a Shopping List item is checked off, and if so when and by whom (null once they've gone). */
export type CheckState =
  | { status: 'unchecked' }
  | { status: 'checked'; checkedAt: string; checkedBy: UserId | null };

/** One Recipe that needs an Ingredient line, with its own amounts for it. Never added together. */
export type ShoppingListRecipeAmounts = {
  recipe: { id: RecipeId; title: string };
  amountTexts: string[];
};

export type ShoppingListItem =
  /** An Ingredient that Recipes on the list need and the user didn't have when they were added. */
  | {
      kind: 'ingredient';
      id: ShoppingListItemId;
      ingredient: Ingredient;
      recipes: ShoppingListRecipeAmounts[];
      check: CheckState;
    }
  /** Something typed by hand, linked to the Ingredient of that name if there was one. */
  | {
      kind: 'handAdded';
      id: ShoppingListItemId;
      text: string;
      ingredient: Ingredient | null;
      check: CheckState;
    };

/**
 * A user's Shopping List. Items are sorted by name (an Ingredient line's Ingredient, a hand-added
 * item's text); `recipes` lists each Recipe on the list once, by title.
 */
export type ShoppingList = {
  id: ShoppingListId;
  ownerId: UserId;
  items: ShoppingListItem[];
  recipes: { id: RecipeId; title: string }[];
};

/**
 * Whether list changes made on this phone are waiting to reach the server. `idle`: none are, as far
 * as the phone knows. `syncing`: sending them. `offline`: the last request didn't get through;
 * `waiting` changes will be sent on reconnect.
 */
export type ListSync = { status: 'idle' | 'syncing' | 'offline'; waiting: number };

/**
 * A list change made on this phone that the server failed on too many times in a row, so it was
 * given up: the server doesn't have it. `itemName` is the item's name, as the list showed it.
 */
export type NotSavedListChange = { kind: 'checkOff' | 'uncheck' | 'addManualItem'; itemName: string };

/**
 * A Shopping List as a screen shows it while it changes. `notSaved`: changes given up, to tell the
 * user about until they dismiss them.
 */
export type ShoppingListView =
  /** Nothing to show yet: never seen on this phone, and being read. */
  | { status: 'loading'; sync: ListSync; notSaved: NotSavedListChange[] }
  /** The list with the changes made on this phone, sent or not. */
  | { status: 'loaded'; list: ShoppingList; sync: ListSync; notSaved: NotSavedListChange[] }
  /** Couldn't be read, and this phone has never seen it (code `offline` with no signal). */
  | { status: 'failed'; error: DataError; sync: ListSync; notSaved: NotSavedListChange[] };

export type IdTokenProvider = 'apple' | 'google';

export class DataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUserId(raw: string): UserId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_user_id', `Not a user id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as UserId;
}

export function parseRecipeId(raw: string): RecipeId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_recipe_id', `Not a Recipe id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as RecipeId;
}

export function parseIngredientId(raw: string): IngredientId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_ingredient_id', `Not an Ingredient id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as IngredientId;
}

export function parseShoppingListId(raw: string): ShoppingListId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_shopping_list_id', `Not a Shopping List id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as ShoppingListId;
}

export function parseShoppingListItemId(raw: string): ShoppingListItemId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_shopping_list_item_id', `Not a Shopping List item id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as ShoppingListItemId;
}
