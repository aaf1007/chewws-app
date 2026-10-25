export type UserId = string & { readonly __brand: 'UserId' };
export type RecipeId = string & { readonly __brand: 'RecipeId' };
export type IngredientId = string & { readonly __brand: 'IngredientId' };

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
