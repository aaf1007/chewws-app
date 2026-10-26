import {
  isAuthApiError,
  isAuthSessionMissingError,
  type AuthError,
  type PostgrestError,
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
import { sessionIdOf, type SessionStorage } from './session-storage';
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
  type NotSavedListChange,
  type Pantry,
  type Profile,
  type Recipe,
  type RecipeId,
  type RecipeInput,
  type RecipeSummary,
  type SessionState,
  type ShoppingList,
  type ShoppingListId,
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

/** An item's name as the list shows it. */
const nameOf = (item: ShoppingListItem) => (item.kind === 'ingredient' ? item.ingredient.name : item.text);

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

/**
 * A session the auth client kept on the phone, as much of it as ending it needs: which it is
 * (`sessionIdOf`), and whose (null if that can't be read).
 */
type KeptSession = { accessToken: string; sessionId: string; expiresAt: number | null; userId: UserId | null };

/** The id of the user `user` (a kept session's), or null if it has none this app can read. */
function parseKeptUserId(user: unknown): UserId | null {
  if (typeof user !== 'object' || user === null || !('id' in user) || typeof user.id !== 'string') return null;
  try {
    return parseUserId(user.id);
  } catch {
    return null;
  }
}

/** A session as the auth client saved it, or null if `raw` isn't one. */
function parseKeptSession(raw: string): KeptSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const accessToken = 'access_token' in value ? value.access_token : null;
  const refreshToken = 'refresh_token' in value ? value.refresh_token : null;
  const expiresAt = 'expires_at' in value ? value.expires_at : null;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;
  return {
    accessToken,
    sessionId: sessionIdOf({ access_token: accessToken, refresh_token: refreshToken }),
    expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
    userId: parseKeptUserId('user' in value ? value.user : null),
  };
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
 * should wait and be sent again: no response at all, a timeout, too many requests, or any server
 * error (5xx: the server, or a gateway in front of it, failed; the change itself may be fine).
 * A 401 is handled first by `asSignedIn`. Only a 4xx refuses the change.
 */
const notReached = (status: number) => status === 0 || [408, 429].includes(status) || status >= 500;

/**
 * For a queued change, a server error is told apart: one that never passes gives the change up.
 * So is a 401 that `asSignedIn` got again after refreshing the session: the server keeps refusing
 * a session it just refreshed, which waiting alone won't fix.
 */
const serverFailed = (status: number): Extract<Delivery, { status: 'serverFailed' }> | null => {
  if (status >= 500) return { status: 'serverFailed', error: new DataError('server_error', `The server failed (${status}).`) };
  if (status === 401) {
    return { status: 'serverFailed', error: new DataError('unauthorized', 'The server refused the session (401).') };
  }
  return null;
};

export type DataLayerOptions = {
  /** Where the phone keeps list changes waiting to be sent and the last list it saw. */
  storage?: KeyValueStorage;
  /** The phone's clock, in milliseconds. List changes are stamped with it. */
  now?: () => number;
  /** Makes a fresh UUID, for items added on the phone and its queued changes. */
  newId?: () => string;
  /**
   * Where the auth client keeps its session (the same object as its `auth.storage`), so the data
   * layer ends it on the phone itself, at once, signal or not.
   */
  sessionStorage: SessionStorage;
};

/**
 * The data layer on top of a Supabase client. The client's `fetch` is the transport: when its
 * requests fail, the phone is offline, and Shopping List changes wait on the phone (see
 * `change-queue.ts`) until `syncListChanges` or the next change gets them through.
 */
export function createDataLayer(client: SupabaseClient<Database>, options: DataLayerOptions) {
  const { sessionStorage } = options;
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
  // signed in. So the phone remembers who signed in, and forgets them only when their session ends
  // on this phone (`endSessionOnPhone`): signing out, or a refresh the server refuses. Signed in
  // on a version that didn't remember them (or what it saved can't be read), the session the auth
  // client kept on the phone says who (the auth client reads it as it's created, so
  // `sessionStorage` knows where it is by now). With neither, no one is signed in.
  const signedInKey = 'recipeapp.signedInUser';
  let session: SessionState = { status: 'loading' };
  let remembered: Promise<UserId | null> = storage
    .getItem(signedInKey)
    .then(parseSavedUserId)
    .catch(() => null)
    .then(async (id) => id ?? (await keptUserId()));
  let savingSignedIn: Promise<void> = Promise.resolve();
  const sessionWatchers = new Set<(state: SessionState) => void>();

  // Signing in and ending a session on this phone take turns: each runs once the one asked for
  // before it is done, so a sign-in waits for a sign-out still finishing. `turn` counts every
  // change of who holds the session (a sign-in, a session ended, a session the auth client
  // reports), so a session end the auth client asked for before one of them is stale.
  let turn = 0;
  let lastInTurn: Promise<unknown> = Promise.resolve();
  function inTurn<T>(op: () => Promise<T>): Promise<T> {
    const run = lastInTurn.then(op);
    lastInTurn = run.catch(() => {});
    return run;
  }
  /** Whose the session the auth client keeps on the phone is, if it keeps one. */
  async function keptUserId(): Promise<UserId | null> {
    try {
      return (await sessionStorage.saved()).map(parseKeptSession).find((s) => s?.userId)?.userId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether a session was ended on this phone (`sessionIdOf`). The auth client may yet report one
   * it held, or refresh one after it ended (`sessionStorage` never saves that refresh).
   */
  const ended = (sessionId: string) => sessionStorage.hasEnded(sessionId);

  function remember(id: UserId | null): Promise<void> {
    remembered = Promise.resolve(id);
    const save = () => (id ? storage.setItem(signedInKey, JSON.stringify(id)) : storage.removeItem(signedInKey));
    savingSignedIn = savingSignedIn.then(save).catch(() => {});
    return savingSignedIn;
  }

  function setSession(next: SessionState) {
    if (sameSession(session, next)) return;
    session = next;
    if (next.status === 'signedIn') void remember(next.userId);
    for (const watcher of sessionWatchers) watcher(next);
  }

  /** A session the auth client holds, for a sign-in or one it reports: that user is signed in. */
  function signedInAs(id: UserId): UserId {
    turn += 1;
    setSession({ status: 'signedIn', userId: id });
    return id;
  }

  // Until the auth client answers (with no signal, after it gives up refreshing), the user
  // remembered on the phone is signed in.
  void remembered.then((id) => {
    if (id && session.status === 'loading') setSession({ status: 'signedIn', userId: id });
  });

  /**
   * Why a session ends on this phone. `signedOut`: the user signed out. The others are asked for
   * at `turn` `seen`, and only when `refusesSession` says the server refused `refusedSessionId`
   * (revoked, or signed out everywhere), or there was no session: `refused`, the auth client
   * dropped its session, or `asSignedIn`'s refresh was refused; `noSession`, the app started and
   * the auth client had no session it could use.
   */
  type SessionEnd =
    | { reason: 'signedOut' }
    | { reason: 'refused' | 'noSession'; seen: number; refusedSessionId?: string };

  /**
   * Ends the session on this phone; the only thing that does. The session the auth client kept is
   * cleared, the phone forgets who signed in, their Shopping List changes still waiting are thrown
   * away unsent with the list last seen, and then they're signed out. Runs in turn. An end the
   * auth client asked for does nothing if someone signed in or out since, or if the auth client
   * holds a session not ended here: that session is newer, and never this end's to end. Returns
   * the sessions cleared, to end them on the server too.
   */
  function endSessionOnPhone(end: SessionEnd): Promise<KeptSession[]> {
    return inTurn(async () => {
      if (end.reason !== 'signedOut') {
        if (turn !== end.seen) return [];
        const kept = (await sessionStorage.saved()).map(parseKeptSession);
        // One that says whose it isn't, no one can be signed in with.
        if (kept.some((s) => s?.userId && !ended(s.sessionId) && s.sessionId !== end.refusedSessionId)) return [];
      }
      turn += 1;
      const me = session.status === 'signedIn' ? session.userId : await remembered;
      const cleared = (await sessionStorage.clear()).map(parseKeptSession).filter((s) => s !== null);
      await remember(null);
      if (me) {
        const list = shoppingListOf(me);
        shoppingLists.delete(me);
        await list.discard();
      }
      setSession({ status: 'signedOut' });
      return cleared;
    });
  }

  /**
   * The auth client has no session to give: it started without one (`noSession`), or dropped the
   * one it had (`refused`). There is none, or refreshing it failed. Only no session at all, or a
   * refresh the server refused (`refusesSession`), signs out; any other failure (no signal, a rate
   * limit, a timeout, a proxy's error page) keeps the user signed in, and the session kept on the
   * phone (`sessionStorage` never lets the auth client remove it) is refreshed later.
   */
  async function settleWithoutSession(reason: 'refused' | 'noSession', seen: number) {
    const kept = (await sessionStorage.saved()).map(parseKeptSession).find((s) => s !== null);
    const { data, error } = await client.auth.getSession();
    const id = await remembered;
    if (turn !== seen) return; // A sign-in, a sign-out or a session reported since has the say.
    if (data.session && !ended(sessionIdOf(data.session))) signedInAs(parseUserId(data.session.user.id));
    else if (id && error && !refusesSession(error)) setSession({ status: 'signedIn', userId: id });
    else await endSessionOnPhone({ reason, seen, refusedSessionId: error ? kept?.sessionId : undefined });
  }

  client.auth.onAuthStateChange((event, authSession) => {
    if (authSession) {
      // One ended on this phone, as the auth client held it before then, has no say.
      if (!ended(sessionIdOf(authSession))) signedInAs(parseUserId(authSession.user.id));
    } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
      // Asking the auth client from inside its own callback would wait on itself. Not waited on:
      // the auth client waits on this callback, maybe in the middle of a sync.
      const seen = turn;
      const reason = event === 'INITIAL_SESSION' ? 'noSession' : 'refused';
      setTimeout(() => void settleWithoutSession(reason, seen), 0);
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
   * The session the auth client would make a request with now, refreshing it first if it ran out,
   * if it's `me`'s, wasn't ended on this phone, and is the session `sessionId` names (when given).
   * Null otherwise: signed out, someone else signed in since, or no signal to refresh it.
   */
  async function sessionOf(me: UserId, sessionId?: string): Promise<{ accessToken: string; sessionId: string } | null> {
    const { data } = await client.auth.getSession();
    if (data.session?.user.id !== me) return null;
    const id = sessionIdOf(data.session);
    if (ended(id) || (sessionId !== undefined && id !== sessionId)) return null;
    return { accessToken: data.session.access_token, sessionId: id };
  }

  /**
   * Makes a request as `me`, with their session's access token (`bearer`), so it can never go out
   * as anyone else. Before each request, and before a refresh, the session is checked
   * (`sessionOf`): still `me`'s, the same session the first request went out with, and, for a
   * queued change, its queue not `discarded`. If not, nothing more is sent: `unreachable` when the
   * session isn't `me`'s (signed out, someone else signed in, no signal to refresh it), `ended`
   * once their queue is discarded. A 401 means the server refused the access token: the session is
   * refreshed once and the request made again. With no signal to refresh it, or any answer that
   * doesn't refuse the session (a rate limit, a timeout, a proxy's error page), the request is
   * `unreachable`; a refresh the server refuses ends the session on this phone (`ended`), even when
   * the auth client keeps it because its access token hasn't run out by the phone's clock. A 401
   * after a refresh that worked is returned as the answer.
   */
  async function asSignedIn<R extends { status: number }>(
    me: UserId,
    request: (accessToken: string) => PromiseLike<R>,
    discarded: () => boolean = () => false,
  ): Promise<R | 'unreachable' | 'ended'> {
    const current = async (sessionId?: string) => {
      const found = await sessionOf(me, sessionId);
      if (discarded()) return 'ended';
      return found ?? 'unreachable';
    };
    const first = await current();
    if (typeof first === 'string') return first;
    const answer = await request(first.accessToken);
    if (answer.status !== 401) return answer;
    const seen = turn;
    const before = await current(first.sessionId);
    if (typeof before === 'string') return before;
    const { error } = await client.auth.refreshSession();
    if (error) {
      if (!refusesSession(error)) return 'unreachable';
      await endSessionOnPhone({ reason: 'refused', seen, refusedSessionId: first.sessionId });
      return 'ended';
    }
    const after = await current(first.sessionId);
    if (typeof after === 'string') return after;
    return request(after.accessToken);
  }

  /** The `Authorization` header a request made as a user's session carries. */
  const bearer = (accessToken: string) => `Bearer ${accessToken}`;

  /**
   * Whether a failed refresh ends the session: there was no session, or the auth server itself
   * (its JSON answer) refused the refresh with a 400, 401 or 403, whatever its code (a revoked or
   * reused refresh token, a banned user, a malformed request alike). Anything else (no signal, a
   * 408 or 429, a 5xx, a body that isn't the auth server's JSON) says nothing about the session.
   */
  function refusesSession(error: AuthError): boolean {
    if (isAuthSessionMissingError(error)) return true;
    return isAuthApiError(error) && [400, 401, 403].includes(error.status);
  }

  /** Signs in, once any sign-out still finishing is done. */
  function signInWithIdToken(input: { provider: IdTokenProvider; token: string; nonce?: string }): Promise<UserId> {
    return inTurn(async () => {
      const { data, error } = await client.auth.signInWithIdToken(input);
      if (error) fail(error);
      return signedInAs(parseUserId(data.user.id));
    });
  }

  /** Signs in, once any sign-out still finishing is done. */
  function signInWithPassword(input: { email: string; password: string }): Promise<UserId> {
    return inTurn(async () => {
      const { data, error } = await client.auth.signInWithPassword(input);
      if (error) fail(error);
      return signedInAs(parseUserId(data.user.id));
    });
  }

  /**
   * Signs out on this phone at once, signal or not (`endSessionOnPhone`): the phone forgets the
   * user, the session the auth client saved, and the user's Shopping List (its changes still
   * waiting are thrown away, so they're never sent, as them or as whoever signs in next). Then, if
   * the server can be reached, this phone's session ends there too. The user's other phones stay
   * signed in.
   */
  async function signOut(): Promise<void> {
    await endOnServer(await endSessionOnPhone({ reason: 'signedOut' }));
  }

  /**
   * Best effort: ends on the server the sessions just cleared from this phone, each by its own
   * access token, so it can never end a session made since. With no signal, or an access token
   * that ran out (refreshing it would hand the auth client a session again), the server keeps the
   * session until its refresh token expires; the phone no longer has it.
   */
  async function endOnServer(sessions: KeptSession[]) {
    for (const { accessToken, expiresAt } of sessions) {
      if (expiresAt === null || expiresAt * 1000 <= Date.now()) continue;
      try {
        await client.auth.admin.signOut(accessToken, 'local');
      } catch {
        // Signed out on the phone already.
      }
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

  /**
   * The user's Shopping List as the server has it; `unreachable` with no signal; `serverFailed`
   * when the server answers with an error of its own (5xx): it was reached, so the phone isn't
   * offline.
   */
  async function fetchShoppingList(
    me: UserId,
  ): Promise<{ status: 'reached'; list: ShoppingList } | { status: 'unreachable' } | { status: 'serverFailed'; error: DataError }> {
    const answer = await asSignedIn(me, (token) =>
      client
        .from('shopping_lists')
        .select(SHOPPING_LIST_WITH_ITEMS)
        .eq('owner_id', me)
        .maybeSingle()
        .retry(false)
        .setHeader('Authorization', bearer(token)),
    );
    if (answer === 'unreachable') return { status: 'unreachable' };
    if (answer === 'ended') throw notSignedIn();
    const { data, error, status } = answer;
    const failed = serverFailed(status);
    if (failed) return failed;
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

  /**
   * Sends one queued Shopping List change, stamped with when it was made. Only the user who made it
   * sends it, with their own session, checked before every request (`asSignedIn`): signed out, or
   * someone else signed in, or a session that can't refresh with no signal, it waits. Once its
   * queue is `discarded` (their session ended on this phone, and the change with it, even if
   * they've signed in again since), nothing is sent.
   */
  async function sendListChange(
    me: UserId,
    { madeAt, change }: QueuedChange<ListChange>,
    discarded: () => boolean,
  ): Promise<Delivery> {
    if (change.kind === 'addManualItem') {
      const answer = await asSignedIn(
        me,
        (token) =>
          client
            .rpc('add_manual_item', {
              list_id: change.listId,
              item_text: change.text,
              ingredient_name: normaliseIngredientName(change.text),
              item_id: change.itemId,
              changed_at: madeAt,
            })
            .setHeader('Authorization', bearer(token)),
        discarded,
      );
      if (answer === 'unreachable') return { status: 'unreachable' };
      if (answer === 'ended') return { status: 'refused', error: notSignedIn() };
      const { data: added, error, status } = answer;
      const failed = serverFailed(status);
      if (failed) return failed;
      if (notReached(status)) return { status: 'unreachable' };
      if (error) return { status: 'refused', error: toDataError(error) };
      if (added === 'added') return { status: 'sent' };
      // Removed since it was first sent (that answer lost): it stays removed.
      if (added === 'gone') return { status: 'dropped' };
      if (added === 'taken') return { status: 'refused', error: idTaken() };
      return {
        status: 'refused',
        error: new DataError('shopping_list_missing', "That Shopping List isn't one you can change."),
      };
    }
    const args = { item_id: change.itemId, changed_at: madeAt };
    const answer = await asSignedIn(
      me,
      (token) =>
        (change.kind === 'checkOff' ? client.rpc('check_off', args) : client.rpc('uncheck', args)).setHeader(
          'Authorization',
          bearer(token),
        ),
      discarded,
    );
    if (answer === 'unreachable') return { status: 'unreachable' };
    if (answer === 'ended') return { status: 'refused', error: notSignedIn() };
    const { data: result, error, status } = answer;
    const failed = serverFailed(status);
    if (failed) return failed;
    if (notReached(status)) return { status: 'unreachable' };
    if (error) return { status: 'refused', error: toDataError(error) };
    if (result === 'applied') return { status: 'sent' };
    // A phone changed the item after this change was made: that change stands.
    if (result === 'superseded') return { status: 'superseded' };
    // Gone (removed meanwhile, maybe from another phone): the change has nothing to change.
    return { status: 'dropped' };
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
    let discarded = false;
    // A change the server skipped for a later one: the list last seen is out of date.
    let superseded = false;

    function keep(list: ShoppingList) {
      if (discarded) return; // A read or change that finishes after its user signed out.
      lastSeen = list;
      lastError = null;
      const snapshot = JSON.stringify(list);
      savingList = savingList.then(() => storage.setItem(listKey, snapshot)).catch(() => {});
    }

    // The list saved on the phone, read first: a hand-add an older version queued without its list
    // is for this one.
    const savedList = storage
      .getItem(listKey)
      .catch(() => null)
      .then(parseSavedShoppingList);
    let savedListId: ShoppingListId | null = null;

    const queue = createChangeQueue<ListChange>({
      storage,
      key: `recipeapp.listChanges.${me}`,
      parseChange: (raw) => parseListChange(raw, savedListId),
      parseAfter: savedList.then((list) => {
        savedListId = list?.ownerId === me ? list.id : null;
      }),
      send: (change, discarded) => sendListChange(me, change, discarded),
      // Named as the list shows it now: once given up, the item may go before the user is told.
      nameOf({ change }) {
        if (change.kind === 'addManualItem') return change.text;
        const item = shown()?.items.find((i) => i.id === change.itemId);
        return item ? nameOf(item) : 'an item';
      },
      onDelivered({ madeAt, change }, delivery) {
        if (!lastSeen) return;
        if (delivery.status === 'sent') keep(withListChanges(lastSeen, [{ madeAt, change }], me));
        if (delivery.status === 'dropped') {
          keep({ ...lastSeen, items: lastSeen.items.filter((item) => item.id !== change.itemId) });
        }
        if (delivery.status === 'superseded') superseded = true;
      },
      // Read the list again for whoever's watching it, to find out the phone is back online, or to
      // show the later change that beat one of this phone's.
      afterSync: (wasOffline) =>
        watchers.size > 0 || wasOffline || superseded ? refresh() : Promise.resolve('reached'),
      now,
      newId,
    });

    const ready: Promise<unknown> = Promise.all([
      queue.ready,
      savedList.then((list) => {
        // A list read from the server meanwhile is newer than the saved one.
        lastSeen ??= list;
      }),
    ]);

    function sync(): ListSync {
      const state = queue.state();
      const waiting = state.queue.length;
      return state.status === 'waitingToRetry'
        ? { status: state.status, waiting, retryAt: new Date(state.retryAt).toISOString() }
        : { status: state.status, waiting };
    }

    /** The list as the phone shows it: the last one seen, with the changes not yet sent on top. */
    function shown(): ShoppingList | null {
      return lastSeen && withListChanges(lastSeen, queue.state().queue, me);
    }

    /** The changes given up, named as the list showed their items when they were. */
    function notSaved(): NotSavedListChange[] {
      return queue.state().gaveUp.map(({ change, name }) => ({ kind: change.kind, itemName: name }));
    }

    function view(): ShoppingListView {
      const list = shown();
      if (list) return { status: 'loaded', list, sync: sync(), notSaved: notSaved() };
      if (lastError) return { status: 'failed', error: lastError, sync: sync(), notSaved: notSaved() };
      return { status: 'loading', sync: sync(), notSaved: notSaved() };
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
        if (fetched.status === 'serverFailed') lastError ??= fetched.error;
        else {
          superseded = false;
          keep(fetched.list);
        }
      } catch (e) {
        lastError = e instanceof DataError ? e : new DataError('unknown', String(e), { cause: e });
      }
      emit();
      return 'reached';
    }

    /**
     * Its user's session ended on this phone: the changes waiting are thrown away, and the list
     * last seen forgotten, both gone from storage too. Nothing is kept again.
     */
    async function discard() {
      await ready;
      discarded = true;
      await queue.discard(notSignedIn());
      lastSeen = null;
      savingList = savingList.then(() => storage.removeItem(listKey)).catch(() => {});
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
    return loadShoppingList(await requireListOwner());
  }

  async function loadShoppingList(me: UserId): Promise<ShoppingList> {
    const lists = shoppingListOf(me);
    await lists.ready;
    const fetched = await fetchShoppingList(me);
    if (fetched.status === 'reached') {
      lists.keep(fetched.list);
      if (lists.queue.state().status === 'offline') void lists.queue.sync();
      lists.emit();
    } else if (fetched.status === 'unreachable') {
      lists.queue.markUnreachable();
    }
    const shown = lists.shown();
    if (!shown) throw fetched.status === 'serverFailed' ? fetched.error : needsConnection('Loading your Shopping List the first time');
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
        if (!stopped) watcher({ status: 'failed', error, sync: { status: 'idle', waiting: 0 }, notSaved: [] });
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
   * The user has seen the notice about list changes given up (`notSaved`): it goes, on this phone
   * for good. Resolves once that's saved.
   */
  async function dismissNotSavedListChanges(): Promise<void> {
    const me = session.status === 'signedIn' ? session.userId : null;
    if (me) await shoppingLists.get(me)?.queue.dismissGaveUp();
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
   * have (Pantry or Staples), as the server sees it when it adds them. Each joins the line for its
   * Ingredient, with this Recipe's amounts kept apart. Adding a Recipe that's already on the list
   * changes nothing. Returns the Ingredients the Recipe needed that the user didn't have.
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
    // The server leaves off what the user has by the time it adds them, which may be more.
    const onList = new Set(data.map(parseIngredientId));
    return lines.filter((line) => onList.has(line.ingredient.id)).map((line) => line.ingredient);
  }

  const idTaken = () => new DataError('shopping_list_item_id_taken', 'That item id is already in use.');

  const itemGone = () =>
    new DataError('shopping_list_item_not_found', 'That item is no longer on the Shopping List.');

  /**
   * Queues a Shopping List change and sends it, with every change queued before it. Resolves once
   * the server has it (or has a later change to the item, made on another phone, which stands), or
   * at once with no signal: it waits on the phone, shown on the list, and is sent on reconnect.
   * Fails if the server says its item is gone, or refuses it.
   */
  async function changeShoppingList(me: UserId, change: ListChange): Promise<void> {
    const outcome = await shoppingListOf(me).queue.enqueue(change);
    if (outcome.status === 'dropped') throw itemGone();
    if (outcome.status === 'refused') throw outcome.error;
  }

  /**
   * Adds something typed by hand to the user's Shopping List. If its name is an existing
   * Ingredient's, it's linked to it, so checking it off puts that Ingredient in the Pantry;
   * otherwise ("paper towels") checking it off changes no Pantry. Works with no signal (see
   * `changeShoppingList`), once the phone has seen the list: the add names it, and the server takes
   * it only for a list its sender can use. The phone makes the item's id, or pass `id` to choose it,
   * so adding the same item twice adds it once.
   */
  async function addManualItem(
    text: string,
    options: { id?: ShoppingListItemId } = {},
  ): Promise<ShoppingListItemId> {
    const itemText = text.trim();
    if (!itemText) throw new DataError('item_text_required', 'Type what you need to buy.');
    const itemId = options.id ?? parseShoppingListItemId(newId());
    const me = await requireListOwner();
    const lists = shoppingListOf(me);
    await lists.ready;
    // The list it's for: as the phone last saw it, or read the first time.
    const listId = lists.shown()?.id ?? (await loadShoppingList(me)).id;
    await changeShoppingList(me, { kind: 'addManualItem', listId, itemId, text: itemText });
    return itemId;
  }

  /**
   * Checks an item off. Its Ingredient, if it has one, goes into the list owner's Pantry. Checking
   * off a checked item changes nothing. Works with no signal (see `changeShoppingList`); if the
   * item changed after this check was made, the later change stands.
   */
  async function checkOff(itemId: ShoppingListItemId): Promise<void> {
    await changeShoppingList(await requireListOwner(), { kind: 'checkOff', itemId });
  }

  /** Unchecks an item. The Pantry is left as it is. Works with no signal, like `checkOff`. */
  async function uncheck(itemId: ShoppingListItemId): Promise<void> {
    await changeShoppingList(await requireListOwner(), { kind: 'uncheck', itemId });
  }

  /**
   * Takes one item off the Shopping List. Already gone is fine. Needs a connection: the changes
   * waiting on the phone are sent first, so an item added with no signal is there to remove. A
   * change waiting for its next try after a server error doesn't hold it up: the item is removed,
   * and the changes to it still waiting are dropped (one adding it would put it back).
   */
  async function removeFromShoppingList(itemId: ShoppingListItemId): Promise<void> {
    const me = await requireListOwner();
    const lists = shoppingListOf(me);
    await lists.ready;
    const before = lists.queue.state();
    if (before.status === 'offline' || before.queue.length > 0) await lists.queue.sync();
    if (lists.queue.state().status === 'offline') throw needsConnection('Removing');
    const answer = await asSignedIn(me, (token) =>
      client.from('shopping_list_items').delete().eq('id', itemId).setHeader('Authorization', bearer(token)),
    );
    if (answer === 'ended') throw notSignedIn();
    const { error, status } = answer === 'unreachable' ? { error: null, status: 0 } : answer;
    if (serverFailed(status)) {
      throw new DataError('server_error', "Couldn't remove it: the server had a problem. Try again in a moment.");
    }
    if (notReached(status)) {
      lists.queue.markUnreachable();
      throw needsConnection('Removing');
    }
    if (error) fail(error);
    await lists.queue.withdraw(({ change }) => change.itemId === itemId);
    lists.forget(itemId);
    // The change that was waiting may have been one of them: what's left is due now, or not.
    if (lists.queue.state().status === 'waitingToRetry') await lists.queue.sync();
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
    dismissNotSavedListChanges,
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
