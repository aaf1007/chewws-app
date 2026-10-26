import {
  isAuthRetryableFetchError,
  type AuthError,
  type PostgrestError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  createChangeQueue,
  memoryStorage,
  type Delivery,
  type KeyValueStorage,
  type QueuedChange,
} from './change-queue';
import type { Database } from './database.types';
import { normaliseIngredientName } from './ingredient-matcher';
import { sortListItems, toListLines, withListChanges, type ListChange } from './list-engine';
import { parseListChange, parseSavedShoppingList } from './list-storage';
import { validateRecipeInput } from './recipe-input';
import type { SessionStorage } from './session-storage';
import {
  DataError,
  parseIngredientId,
  parseRecipeId,
  parseShoppingListId,
  parseShoppingListItemId,
  parseUserId,
  type CheckState,
  type IdTokenProvider,
  type Ingredient,
  type IngredientId,
  type ListSync,
  type Pantry,
  type Profile,
  type Recipe,
  type RecipeId,
  type RecipeInput,
  type RecipeSummary,
  type SessionState,
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListItemId,
  type ShoppingListView,
  type UserId,
} from './types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type RecipeRow = Database['public']['Tables']['recipes']['Row'];
type IngredientRow = Database['public']['Tables']['ingredients']['Row'];
type RecipeLineRow = Database['public']['Tables']['recipe_lines']['Row'];
type ShoppingListItemRow = Database['public']['Tables']['shopping_list_items']['Row'];
type ShoppingListAmountRow = Database['public']['Tables']['shopping_list_amounts']['Row'];

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

const SHOPPING_LIST_WITH_ITEMS =
  'id, owner_id, shopping_list_items(id, hand_added_text, checked_at, checked_by, ingredient:ingredients(id, name), shopping_list_amounts(amount_texts, created_at, recipe:recipes(id, title)))';

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toCheckState(row: Pick<ShoppingListItemRow, 'checked_at' | 'checked_by'>): CheckState {
  return row.checked_at === null
    ? { status: 'unchecked' }
    : {
        status: 'checked',
        checkedAt: row.checked_at,
        checkedBy: row.checked_by === null ? null : parseUserId(row.checked_by),
      };
}

function toShoppingListItem(
  row: Pick<ShoppingListItemRow, 'id' | 'hand_added_text' | 'checked_at' | 'checked_by'> & {
    ingredient: Pick<IngredientRow, 'id' | 'name'> | null;
    shopping_list_amounts: (Pick<ShoppingListAmountRow, 'amount_texts' | 'created_at'> & {
      recipe: Pick<RecipeRow, 'id' | 'title'>;
    })[];
  },
): ShoppingListItem {
  const id = parseShoppingListItemId(row.id);
  const check = toCheckState(row);
  const ingredient = row.ingredient ? toIngredient(row.ingredient) : null;
  if (row.hand_added_text !== null) {
    return { kind: 'handAdded', id, text: row.hand_added_text, ingredient, check };
  }
  if (!ingredient) throw new DataError('invalid_shopping_list_item', `Item ${row.id} has no Ingredient.`);
  const recipes = [...row.shopping_list_amounts]
    .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.recipe.title, b.recipe.title))
    .map((amount) => ({
      recipe: { id: parseRecipeId(amount.recipe.id), title: amount.recipe.title },
      amountTexts: amount.amount_texts,
    }));
  return { kind: 'ingredient', id, ingredient, recipes, check };
}

function toProfile(row: ProfileRow): Profile {
  return { id: parseUserId(row.id), username: row.username, createdAt: row.created_at };
}

/** The signed-in user id the data layer saved on the phone, or null if none (or unreadable). */
function parseSavedUserId(raw: string | null): UserId | null {
  try {
    const saved: unknown = raw === null ? null : JSON.parse(raw);
    return typeof saved === 'string' ? parseUserId(saved) : null;
  } catch {
    return null;
  }
}

const sameSession = (a: SessionState, b: SessionState) =>
  a.status === b.status && (a.status !== 'signedIn' || (b.status === 'signedIn' && a.userId === b.userId));

/** A request that never reached the server (no signal) fails with code `offline`. */
function toDataError(error: AuthError | PostgrestError): DataError {
  if (error.code === '' || ('status' in error && error.status === 0)) {
    return new DataError('offline', "No connection. Try again when you're back online.", { cause: error });
  }
  return new DataError(error.code ?? 'unknown', error.message, { cause: error });
}

function fail(error: AuthError | PostgrestError): never {
  throw toDataError(error);
}

/**
 * Whether a response means the server wasn't reached, or can't answer yet, so a queued change
 * should wait and be sent again: no response at all, a session that needs refreshing, a timeout,
 * too many requests, or any server error (5xx: the server, or a gateway in front of it, failed;
 * the change itself may be fine). Only a 4xx refuses the change.
 */
const notReached = (status: number) => status === 0 || [401, 408, 429].includes(status) || status >= 500;

export type DataLayerOptions = {
  /** Where the phone keeps list changes waiting to be sent and the last list it saw. */
  storage?: KeyValueStorage;
  /** The phone's clock, in milliseconds. List changes are stamped with it. */
  now?: () => number;
  /** Makes a fresh UUID, for items added on the phone and its queued changes. */
  newId?: () => string;
  /**
   * Where the auth client keeps its session (the same object as its `auth.storage`), so signing
   * out ends it on the phone at once, signal or not. Without it, signing out waits on the auth client.
   */
  sessionStorage?: SessionStorage;
};

/**
 * The data layer on top of a Supabase client. The client's `fetch` is the transport: when its
 * requests fail, the phone is offline, and Shopping List changes wait on the phone (see
 * `change-queue.ts`) until `syncListChanges` or the next change gets them through.
 */
export function createDataLayer(client: SupabaseClient<Database>, options: DataLayerOptions = {}) {
  const storage = options.storage ?? memoryStorage();
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());

  const notSignedIn = () => new DataError('not_signed_in', 'No user is signed in.');

  async function currentUserId(): Promise<UserId> {
    const { data, error } = await client.auth.getSession();
    if (error) fail(error);
    if (!data.session) throw notSignedIn();
    return parseUserId(data.session.user.id);
  }

  // Who is signed in on this phone. The auth client says, but its session runs out after an hour
  // and only a signal can refresh it: until then it has no session to give, and the user is still
  // signed in. So the phone remembers who signed in, and forgets them only on a real sign-out,
  // which includes a refresh the server refuses (the auth client then reports SIGNED_OUT).
  const signedInKey = 'recipeapp.signedInUser';
  let session: SessionState = { status: 'loading' };
  let remembered: Promise<UserId | null> = storage
    .getItem(signedInKey)
    .then(parseSavedUserId)
    .catch(() => null);
  let savingSignedIn: Promise<void> = Promise.resolve();
  let authEvents = 0;
  /** The session the auth client last reported, to end it on the server when signing out. */
  let heldSession: Session | null = null;
  const sessionWatchers = new Set<(state: SessionState) => void>();

  function setSession(next: SessionState) {
    if (sameSession(session, next)) return;
    session = next;
    if (next.status !== 'loading') {
      const id = next.status === 'signedIn' ? next.userId : null;
      remembered = Promise.resolve(id);
      const saved = JSON.stringify(id);
      savingSignedIn = savingSignedIn.then(() => storage.setItem(signedInKey, saved)).catch(() => {});
    }
    for (const watcher of sessionWatchers) watcher(next);
  }

  // Until the auth client answers (with no signal, after it gives up refreshing), the user
  // remembered on the phone is signed in.
  void remembered.then((id) => {
    if (id && session.status === 'loading') setSession({ status: 'signedIn', userId: id });
  });

  /**
   * The auth client started without a session: there is none, or it couldn't refresh it for lack
   * of a signal (a network failure, not an answer from the server). Only the first signs out.
   */
  async function settleWithoutSession(seenEvents: number) {
    const { data, error } = await client.auth.getSession();
    const id = await remembered;
    if (authEvents !== seenEvents) return; // A sign-in or sign-out since has the say.
    if (data.session) setSession({ status: 'signedIn', userId: parseUserId(data.session.user.id) });
    else if (id && error && isAuthRetryableFetchError(error)) setSession({ status: 'signedIn', userId: id });
    else setSession({ status: 'signedOut' });
  }

  client.auth.onAuthStateChange((event, authSession) => {
    authEvents += 1;
    heldSession = authSession;
    if (authSession) {
      setSession({ status: 'signedIn', userId: parseUserId(authSession.user.id) });
    } else if (event === 'INITIAL_SESSION') {
      // Asking the auth client from inside its own callback would wait on itself.
      const seen = authEvents;
      setTimeout(() => void settleWithoutSession(seen), 0);
    } else if (event === 'SIGNED_OUT') {
      setSession({ status: 'signedOut' });
    }
  });

  /**
   * Who the Shopping List on this phone belongs to: the user signed in here, without refreshing
   * their session (with no signal that fails, and the list still works). Null when signed out.
   */
  async function listOwner(): Promise<UserId | null> {
    const id = await remembered;
    if (id) return id;
    const { data } = await client.auth.getSession();
    return data.session ? parseUserId(data.session.user.id) : null;
  }

  async function requireListOwner(): Promise<UserId> {
    const id = await listOwner();
    if (!id) throw notSignedIn();
    return id;
  }

  /**
   * Whether requests now go out as `me`, refreshing their session first if it ran out. With no
   * signal to refresh it, they'd go out as nobody.
   */
  async function hasSessionOf(me: UserId): Promise<boolean> {
    const { data } = await client.auth.getSession();
    return data.session?.user.id === me;
  }

  async function signInWithIdToken(input: {
    provider: IdTokenProvider;
    token: string;
    nonce?: string;
  }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithIdToken(input);
    if (error) fail(error);
    const id = parseUserId(data.user.id);
    setSession({ status: 'signedIn', userId: id });
    return id;
  }

  async function signInWithPassword(input: { email: string; password: string }): Promise<UserId> {
    const { data, error } = await client.auth.signInWithPassword(input);
    if (error) fail(error);
    const id = parseUserId(data.user.id);
    setSession({ status: 'signedIn', userId: id });
    return id;
  }

  /**
   * Signs out on this phone at once, signal or not: the phone forgets the user, the session the
   * auth client saved, and the user's Shopping List (its changes still waiting are thrown away, so
   * they're never sent, as them or as whoever signs in next). Then, if the server can be reached,
   * this phone's session ends there too. The user's other phones stay signed in.
   */
  async function signOut(): Promise<void> {
    const me = await listOwner();
    const held = heldSession;
    authEvents += 1; // A session the auth client was still settling has no say any more.
    await options.sessionStorage?.clear();
    setSession({ status: 'signedOut' });
    if (me) {
      await shoppingListOf(me).discard();
      shoppingLists.delete(me);
    }
    await endSessionOnServer(held);
  }

  /** Best effort: with no signal, or a session that ran out, the server keeps it until it expires. */
  async function endSessionOnServer(held: Session | null) {
    try {
      if (held?.expires_at && held.expires_at * 1000 > Date.now()) {
        await client.auth.admin.signOut(held.access_token, 'local');
      }
      // Lets the auth client let go of the session too. It has none saved any more, so it asks no server.
      await client.auth.signOut({ scope: 'local' });
    } catch {
      // Signed out on the phone already.
    }
  }

  /**
   * Tells `cb` who is signed in now (once known) and on every change. Signed in stays signed in
   * with no signal, even once the session needs refreshing. Returns a function that stops it.
   */
  function onSessionChange(cb: (state: SessionState) => void): () => void {
    sessionWatchers.add(cb);
    if (session.status !== 'loading') cb(session);
    return () => sessionWatchers.delete(cb);
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

  /** The user's Shopping List as the server has it, or `unreachable` with no signal. */
  async function fetchShoppingList(me: UserId): Promise<{ status: 'reached'; list: ShoppingList } | { status: 'unreachable' }> {
    if (!(await hasSessionOf(me))) return { status: 'unreachable' };
    const { data, error, status } = await client
      .from('shopping_lists')
      .select(SHOPPING_LIST_WITH_ITEMS)
      .eq('owner_id', me)
      .maybeSingle()
      .retry(false);
    if (notReached(status)) return { status: 'unreachable' };
    if (error) fail(error);
    if (!data) throw new DataError('shopping_list_missing', `No Shopping List for user ${me}.`);
    const items = sortListItems(data.shopping_list_items.map(toShoppingListItem));
    const recipes = new Map(
      items.flatMap((item) => (item.kind === 'ingredient' ? item.recipes : [])).map((r) => [r.recipe.id, r.recipe]),
    );
    return {
      status: 'reached',
      list: {
        id: parseShoppingListId(data.id),
        ownerId: parseUserId(data.owner_id),
        items,
        recipes: [...recipes.values()].sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id)),
      },
    };
  }

  const needsConnection = (what: string) =>
    new DataError('offline', `You're offline. ${what} needs a connection.`);

  /** Sends one queued Shopping List change, stamped with when it was made. */
  async function sendListChange(me: UserId, { madeAt, change }: QueuedChange<ListChange>): Promise<Delivery> {
    // Only the user who made a change sends it. Signed out, or a session that can't refresh with
    // no signal, it waits.
    if (!(await hasSessionOf(me))) return { status: 'unreachable' };
    if (change.kind === 'addManualItem') {
      const { data: added, error, status } = await client.rpc('add_manual_item', {
        item_text: change.text,
        ingredient_name: normaliseIngredientName(change.text),
        item_id: change.itemId,
        changed_at: madeAt,
      });
      if (notReached(status)) return { status: 'unreachable' };
      if (error) return { status: 'refused', error: toDataError(error) };
      if (added === 'added') return { status: 'sent' };
      // Removed since it was first sent (that answer lost): it stays removed.
      if (added === 'gone') return { status: 'dropped' };
      if (added === 'taken') return { status: 'refused', error: idTaken() };
      return { status: 'refused', error: new DataError('shopping_list_missing', 'You have no Shopping List.') };
    }
    const args = { item_id: change.itemId, changed_at: madeAt };
    const { data: found, error, status } =
      change.kind === 'checkOff' ? await client.rpc('check_off', args) : await client.rpc('uncheck', args);
    if (notReached(status)) return { status: 'unreachable' };
    if (error) return { status: 'refused', error: toDataError(error) };
    // Gone (removed meanwhile, maybe from another phone): the change has nothing to change.
    return found ? { status: 'sent' } : { status: 'dropped' };
  }

  /**
   * One user's Shopping List on this phone: the changes waiting to be sent, the last list read
   * from the server (kept in storage, so it shows with no signal after a restart), and the screens
   * watching it.
   */
  function openShoppingList(me: UserId) {
    const listKey = `recipeapp.shoppingList.${me}`;
    const watchers = new Set<(view: ShoppingListView) => void>();
    let lastSeen: ShoppingList | null = null;
    let lastError: DataError | null = null;
    let savingList: Promise<void> = Promise.resolve();

    function keep(list: ShoppingList) {
      lastSeen = list;
      lastError = null;
      const snapshot = JSON.stringify(list);
      savingList = savingList.then(() => storage.setItem(listKey, snapshot)).catch(() => {});
    }

    const queue = createChangeQueue<ListChange>({
      storage,
      key: `recipeapp.listChanges.${me}`,
      parseChange: parseListChange,
      send: (change) => sendListChange(me, change),
      onDelivered({ madeAt, change }, delivery) {
        if (!lastSeen) return;
        if (delivery.status === 'sent') keep(withListChanges(lastSeen, [{ madeAt, change }], me));
        if (delivery.status === 'dropped') {
          keep({ ...lastSeen, items: lastSeen.items.filter((item) => item.id !== change.itemId) });
        }
      },
      // Read the list again for whoever's watching it, or to find out the phone is back online.
      afterSync: (wasOffline) => (watchers.size > 0 || wasOffline ? refresh() : Promise.resolve('reached')),
      now,
      newId,
    });

    const ready: Promise<unknown> = Promise.all([
      queue.ready,
      storage
        .getItem(listKey)
        .catch(() => null)
        .then((raw) => {
          // A list read from the server meanwhile is newer than the saved one.
          lastSeen ??= parseSavedShoppingList(raw);
        }),
    ]);

    function sync(): ListSync {
      const state = queue.state();
      return { status: state.status, waiting: state.queue.length };
    }

    /** The list as the phone shows it: the last one seen, with the changes not yet sent on top. */
    function shown(): ShoppingList | null {
      return lastSeen && withListChanges(lastSeen, queue.state().queue, me);
    }

    function view(): ShoppingListView {
      const list = shown();
      if (list) return { status: 'loaded', list, sync: sync() };
      if (lastError) return { status: 'failed', error: lastError, sync: sync() };
      return { status: 'loading', sync: sync() };
    }

    function emit() {
      const current = view();
      for (const watcher of watchers) watcher(current);
    }

    async function refresh(): Promise<'reached' | 'unreachable'> {
      try {
        const fetched = await fetchShoppingList(me);
        if (fetched.status === 'unreachable') {
          lastError ??= needsConnection('Loading your Shopping List the first time');
          return 'unreachable';
        }
        keep(fetched.list);
      } catch (e) {
        lastError = e instanceof DataError ? e : new DataError('unknown', String(e), { cause: e });
      }
      emit();
      return 'reached';
    }

    /** Its user signed out: the changes waiting are thrown away, and the list last seen forgotten. */
    async function discard() {
      await ready;
      await queue.discard(notSignedIn());
      lastSeen = null;
      savingList = savingList.then(() => storage.setItem(listKey, 'null')).catch(() => {});
      await savingList;
    }

    function forget(itemId: ShoppingListItemId) {
      if (lastSeen) keep({ ...lastSeen, items: lastSeen.items.filter((item) => item.id !== itemId) });
      emit();
    }

    /** After a change made online, outside the queue: show the list as it is now. */
    function refreshWatched() {
      if (watchers.size > 0) void refresh();
    }

    queue.subscribe(emit);
    return { queue, watchers, ready, keep, shown, view, emit, sync, refresh, refreshWatched, forget, discard };
  }

  const shoppingLists = new Map<UserId, ReturnType<typeof openShoppingList>>();
  function shoppingListOf(me: UserId) {
    let list = shoppingLists.get(me);
    if (!list) {
      list = openShoppingList(me);
      shoppingLists.set(me, list);
    }
    return list;
  }

  /**
   * The signed-in user's Shopping List, with the changes made on this phone that haven't reached
   * the server yet. With no signal, it's the last list this phone saw, with those changes; never
   * seen, it fails with code `offline`.
   */
  async function getShoppingList(): Promise<ShoppingList> {
    const me = await requireListOwner();
    const lists = shoppingListOf(me);
    await lists.ready;
    const fetched = await fetchShoppingList(me);
    if (fetched.status === 'reached') {
      lists.keep(fetched.list);
      if (lists.queue.state().status === 'offline') void lists.queue.sync();
      lists.emit();
    } else {
      lists.queue.markUnreachable();
    }
    const shown = lists.shown();
    if (!shown) throw needsConnection('Loading your Shopping List the first time');
    return shown;
  }

  /**
   * Shows the signed-in user's Shopping List as it changes: at once from what the phone has, again
   * when it's read from the server, and on every change made here, sent or not. Each view says
   * whether changes are waiting to sync. Returns a function that stops watching.
   */
  function watchShoppingList(watcher: (view: ShoppingListView) => void): () => void {
    let lists: ReturnType<typeof openShoppingList> | null = null;
    let stopped = false;
    requireListOwner().then(
      async (me) => {
        if (stopped) return;
        lists = shoppingListOf(me);
        lists.watchers.add(watcher);
        await lists.ready;
        if (stopped) return;
        watcher(lists.view());
        await lists.queue.sync();
      },
      (e: unknown) => {
        const error = e instanceof DataError ? e : new DataError('unknown', String(e), { cause: e });
        if (!stopped) watcher({ status: 'failed', error, sync: { status: 'idle', waiting: 0 } });
      },
    );
    return () => {
      stopped = true;
      lists?.watchers.delete(watcher);
    };
  }

  /** Whether the signed-in user's list changes are waiting to sync. */
  async function getListSync(): Promise<ListSync> {
    const me = await requireListOwner();
    const lists = shoppingListOf(me);
    await lists.ready;
    return lists.sync();
  }

  /**
   * Sends the list changes waiting on this phone, in the order they were made, if there are any or
   * the phone was offline. The app calls it when it comes to the foreground and on a timer. Says
   * what's still waiting.
   */
  async function syncListChanges(): Promise<ListSync> {
    const me = await listOwner();
    if (!me) return { status: 'idle', waiting: 0 };
    const lists = shoppingListOf(me);
    await lists.ready;
    const { status, queue } = lists.queue.state();
    if (status !== 'idle' || queue.length > 0) await lists.queue.sync();
    return lists.sync();
  }

  /**
   * Puts the Ingredients one of the user's Recipes needs on their Shopping List, except those they
   * have (Pantry or Staples). Each joins the line for its Ingredient, with this Recipe's amounts
   * kept apart. Adding a Recipe that's already on the list changes nothing. Returns the
   * Ingredients the Recipe needed that the user didn't have.
   */
  async function addRecipeToShoppingList(recipeId: RecipeId): Promise<Ingredient[]> {
    const [recipe, had] = await Promise.all([getRecipe(recipeId), listIngredientsIHave()]);
    if (!recipe) throw new DataError('recipe_not_found', 'That Recipe no longer exists.');
    const lines = toListLines([recipe], new Set(had));
    const { data, error } = await client.rpc('add_recipe_to_shopping_list', {
      recipe_id: recipeId,
      lines: lines.map((line) => ({
        ingredient_id: line.ingredient.id,
        amount_texts: line.amounts.flatMap((a) => a.amountTexts),
      })),
    });
    if (error) fail(error);
    if (!data) throw new DataError('recipe_not_found', 'That Recipe no longer exists.');
    shoppingListOf(recipe.ownerId).refreshWatched();
    return lines.map((line) => line.ingredient);
  }

  const idTaken = () => new DataError('shopping_list_item_id_taken', 'That item id is already in use.');

  const itemGone = () =>
    new DataError('shopping_list_item_not_found', 'That item is no longer on the Shopping List.');

  /**
   * Queues a Shopping List change and sends it, with every change queued before it. Resolves once
   * the server has it, or at once with no signal: it waits on the phone, shown on the list, and is
   * sent on reconnect. Fails if the server says its item is gone, or refuses it.
   */
  async function changeShoppingList(change: ListChange): Promise<void> {
    const me = await requireListOwner();
    const outcome = await shoppingListOf(me).queue.enqueue(change);
    if (outcome.status === 'dropped') throw itemGone();
    if (outcome.status === 'refused') throw outcome.error;
  }

  /**
   * Adds something typed by hand to the user's Shopping List. If its name is an existing
   * Ingredient's, it's linked to it, so checking it off puts that Ingredient in the Pantry;
   * otherwise ("paper towels") checking it off changes no Pantry. Works with no signal (see
   * `changeShoppingList`). The phone makes the item's id, or pass `id` to choose it, so adding the
   * same item twice adds it once.
   */
  async function addManualItem(
    text: string,
    options: { id?: ShoppingListItemId } = {},
  ): Promise<ShoppingListItemId> {
    const itemText = text.trim();
    if (!itemText) throw new DataError('item_text_required', 'Type what you need to buy.');
    const itemId = options.id ?? parseShoppingListItemId(newId());
    await changeShoppingList({ kind: 'addManualItem', itemId, text: itemText });
    return itemId;
  }

  /**
   * Checks an item off. Its Ingredient, if it has one, goes into the list owner's Pantry. Checking
   * off a checked item changes nothing. Works with no signal (see `changeShoppingList`); if the
   * item changed after this check was made, the later change stands.
   */
  async function checkOff(itemId: ShoppingListItemId): Promise<void> {
    await changeShoppingList({ kind: 'checkOff', itemId });
  }

  /** Unchecks an item. The Pantry is left as it is. Works with no signal, like `checkOff`. */
  async function uncheck(itemId: ShoppingListItemId): Promise<void> {
    await changeShoppingList({ kind: 'uncheck', itemId });
  }

  /**
   * Takes one item off the Shopping List. Already gone is fine. Needs a connection: the changes
   * waiting on the phone are sent first, so an item added with no signal is there to remove.
   */
  async function removeFromShoppingList(itemId: ShoppingListItemId): Promise<void> {
    const me = await requireListOwner();
    const lists = shoppingListOf(me);
    await lists.ready;
    const before = lists.queue.state();
    if (before.status === 'offline' || before.queue.length > 0) await lists.queue.sync();
    if (lists.queue.state().status === 'offline') throw needsConnection('Removing');
    const { error, status } = await client.from('shopping_list_items').delete().eq('id', itemId);
    if (notReached(status)) {
      lists.queue.markUnreachable();
      throw needsConnection('Removing');
    }
    if (error) fail(error);
    lists.forget(itemId);
  }

  /**
   * Takes all of one Recipe's lines off the Shopping List: its amounts go, and so does every line
   * no other Recipe on the list needs. Not on the list is fine.
   */
  async function removeRecipeFromShoppingList(recipeId: RecipeId): Promise<void> {
    const { error } = await client.rpc('remove_recipe_from_shopping_list', { recipe_id: recipeId });
    if (error) fail(error);
    shoppingListOf(await currentUserId()).refreshWatched();
  }

  return {
    getShoppingList,
    watchShoppingList,
    getListSync,
    syncListChanges,
    addRecipeToShoppingList,
    addManualItem,
    checkOff,
    uncheck,
    removeFromShoppingList,
    removeRecipeFromShoppingList,
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
