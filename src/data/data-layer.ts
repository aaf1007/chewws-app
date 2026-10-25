import type { AuthError, PostgrestError, Session, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { normaliseIngredientName } from './ingredient-matcher';
import { validateRecipeInput } from './recipe-input';
import {
  DataError,
  parseIngredientId,
  parseRecipeId,
  parseUserId,
  type IdTokenProvider,
  type Ingredient,
  type IngredientId,
  type Pantry,
  type Profile,
  type Recipe,
  type RecipeId,
  type RecipeInput,
  type RecipeSummary,
  type SessionState,
  type UserId,
} from './types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type RecipeRow = Database['public']['Tables']['recipes']['Row'];
type IngredientRow = Database['public']['Tables']['ingredients']['Row'];
type RecipeLineRow = Database['public']['Tables']['recipe_lines']['Row'];

const RECIPE_WITH_LINES =
  '*, recipe_lines(position, original_text, amount_text, ingredient:ingredients(id, name))';

function toRecipe(
  row: RecipeRow & {
    recipe_lines: (Pick<RecipeLineRow, 'position' | 'original_text' | 'amount_text'> & {
      ingredient: Pick<IngredientRow, 'id' | 'name'>;
    })[];
  },
): Recipe {
  return {
    id: parseRecipeId(row.id),
    ownerId: parseUserId(row.owner_id),
    title: row.title,
    status: row.status,
    recipeFound: row.recipe_found,
    lines: [...row.recipe_lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        originalText: line.original_text,
        amountText: line.amount_text,
        ingredient: { id: parseIngredientId(line.ingredient.id), name: line.ingredient.name },
      })),
    steps: row.steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * What the user typed, as the arguments the create and edit functions take. Fails with the first
 * rule `validateRecipeInput` reports broken.
 */
function toRecipeArgs(input: RecipeInput) {
  const check = validateRecipeInput(input);
  if (check.status === 'invalid') {
    const [first] = check.errors;
    throw new DataError(first.code, first.message);
  }
  const { title, steps, lines } = check.recipe;
  return {
    title,
    steps,
    lines: lines.map((line) => ({
      original_text: line.originalText,
      amount_text: line.amountText,
      ingredient_name: line.ingredientName,
    })),
  };
}

function toIngredient(row: Pick<IngredientRow, 'id' | 'name'>): Ingredient {
  return { id: parseIngredientId(row.id), name: row.name };
}

const byName = (a: Ingredient, b: Ingredient) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The name a typed Ingredient is stored under. Fails when the matcher leaves nothing of it. */
function toIngredientName(typed: string): string {
  const name = normaliseIngredientName(typed);
  if (!name) throw new DataError('ingredient_required', 'Type the name of an Ingredient.');
  return name;
}

function toProfile(row: ProfileRow): Profile {
  return { id: parseUserId(row.id), username: row.username, createdAt: row.created_at };
}

function toSessionState(session: Session | null): SessionState {
  return session ? { status: 'signedIn', userId: parseUserId(session.user.id) } : { status: 'signedOut' };
}

function fail(error: AuthError | PostgrestError): never {
  throw new DataError(error.code ?? 'unknown', error.message, { cause: error });
}

export function createDataLayer(client: SupabaseClient<Database>) {
  async function currentUserId(): Promise<UserId> {
    const { data, error } = await client.auth.getSession();
    if (error) fail(error);
    if (!data.session) throw new DataError('not_signed_in', 'No user is signed in.');
    return parseUserId(data.session.user.id);
  }

  async function signInWithIdToken(input: {
    provider: IdTokenProvider;
    token: string;
    nonce?: string;
  }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithIdToken(input);
    if (error) fail(error);
    return parseUserId(data.user.id);
  }

  async function signInWithPassword(input: { email: string; password: string }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithPassword(input);
    if (error) fail(error);
    return parseUserId(data.user.id);
  }

  async function signOut(): Promise<void> {
    const { error } = await client.auth.signOut();
    if (error) fail(error);
  }

  function onSessionChange(cb: (state: SessionState) => void): () => void {
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(toSessionState(session)));
    return () => data.subscription.unsubscribe();
  }

  async function getProfile(id: UserId): Promise<Profile | null> {
    const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) fail(error);
    return data ? toProfile(data) : null;
  }

  async function getMyProfile(): Promise<Profile> {
    const id = await currentUserId();
    const profile = await getProfile(id);
    if (!profile) throw new DataError('profile_missing', `No Profile for user ${id}.`);
    return profile;
  }

  async function createRecipe(input: RecipeInput): Promise<RecipeId> {
    const { data, error } = await client.rpc('create_recipe', toRecipeArgs(input));
    if (error) fail(error);
    return parseRecipeId(data);
  }

  /** Replaces the Recipe's title, lines and steps. */
  async function editRecipe(id: RecipeId, input: RecipeInput): Promise<void> {
    const { data, error } = await client.rpc('edit_recipe', { recipe_id: id, ...toRecipeArgs(input) });
    if (error) fail(error);
    if (!data) throw new DataError('recipe_not_found', 'That Recipe no longer exists.');
  }

  async function deleteRecipe(id: RecipeId): Promise<void> {
    const { data, error } = await client.from('recipes').delete().eq('id', id).select('id');
    if (error) fail(error);
    if (data.length === 0) throw new DataError('recipe_not_found', 'That Recipe no longer exists.');
  }

  async function getRecipe(id: RecipeId): Promise<Recipe | null> {
    const { data, error } = await client
      .from('recipes')
      .select(RECIPE_WITH_LINES)
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    return data ? toRecipe(data) : null;
  }

  /** The signed-in user's reviewed Recipes, newest first. */
  async function listMyRecipes(): Promise<RecipeSummary[]> {
    const me = await currentUserId();
    const { data, error } = await client
      .from('recipes')
      .select('id, title, steps, created_at, recipe_lines(count)')
      .eq('owner_id', me)
      .eq('status', 'reviewed')
      .order('created_at', { ascending: false })
      .order('id');
    if (error) fail(error);
    return data.map((row) => ({
      id: parseRecipeId(row.id),
      title: row.title,
      lineCount: row.recipe_lines[0]?.count ?? 0,
      stepCount: row.steps.length,
      createdAt: row.created_at,
    }));
  }

  /** The Ingredients in the signed-in user's Pantry, and their Staples. */
  async function getPantry(): Promise<Pantry> {
    const me = await currentUserId();
    const [entries, staples] = await Promise.all([
      client.from('pantry_entries').select('ingredient:ingredients(id, name)').eq('user_id', me),
      client.from('staples').select('ingredient:ingredients(id, name)').eq('user_id', me),
    ]);
    if (entries.error) fail(entries.error);
    if (staples.error) fail(staples.error);
    return {
      ingredients: entries.data.map((row) => toIngredient(row.ingredient)).sort(byName),
      staples: staples.data.map((row) => toIngredient(row.ingredient)).sort(byName),
    };
  }

  /** Marks an Ingredient as in the Pantry, by the name the user typed. Already there is fine. */
  async function addToPantry(ingredientName: string): Promise<Ingredient> {
    const name = toIngredientName(ingredientName);
    const { data, error } = await client.rpc('add_to_pantry', { ingredient_name: name });
    if (error) fail(error);
    return { id: parseIngredientId(data), name };
  }

  /** Takes an Ingredient out of the Pantry. Not there is fine; a Staple stays a Staple. */
  async function markUsedUp(ingredientId: IngredientId): Promise<void> {
    const me = await currentUserId();
    const { error } = await client
      .from('pantry_entries')
      .delete()
      .eq('user_id', me)
      .eq('ingredient_id', ingredientId);
    if (error) fail(error);
  }

  /**
   * Makes an Ingredient one of the user's Staples, by the name the user typed. Already one is fine.
   * Staples change one at a time, so changes made at once never undo each other.
   */
  async function addStaple(ingredientName: string): Promise<Ingredient> {
    const name = toIngredientName(ingredientName);
    const { data, error } = await client.rpc('add_staple', { ingredient_name: name });
    if (error) fail(error);
    return { id: parseIngredientId(data), name };
  }

  /** Stops an Ingredient being one of the user's Staples. Not one is fine; the Pantry is untouched. */
  async function removeStaple(ingredientId: IngredientId): Promise<void> {
    const me = await currentUserId();
    const { error } = await client
      .from('staples')
      .delete()
      .eq('user_id', me)
      .eq('ingredient_id', ingredientId);
    if (error) fail(error);
  }

  /** Whether the user has this Ingredient: in their Pantry, or as a Staple. */
  async function hasIngredient(ingredientId: IngredientId): Promise<boolean> {
    const { data, error } = await client.rpc('has_ingredient', { ingredient_id: ingredientId });
    if (error) fail(error);
    return data;
  }

  /**
   * Every Ingredient the user has (in their Pantry or a Staple), each once. Whatever skips what the
   * user already has, such as the Shopping List, reads this.
   */
  async function listIngredientsIHave(): Promise<IngredientId[]> {
    const { data, error } = await client.rpc('ingredients_i_have');
    if (error) fail(error);
    return data.map(parseIngredientId);
  }

  return {
    getPantry,
    addToPantry,
    markUsedUp,
    addStaple,
    removeStaple,
    hasIngredient,
    listIngredientsIHave,
    createRecipe,
    editRecipe,
    deleteRecipe,
    getRecipe,
    listMyRecipes,
    signInWithIdToken,
    signInWithPassword,
    signOut,
    onSessionChange,
    getMyProfile,
    getProfile,
  };
}

export type DataLayer = ReturnType<typeof createDataLayer>;
