export type UserId = string & { readonly __brand: 'UserId' };
export type RecipeId = string & { readonly __brand: 'RecipeId' };
export type IngredientId = string & { readonly __brand: 'IngredientId' };
export type ShoppingListId = string & { readonly __brand: 'ShoppingListId' };
export type ShoppingListItemId = string & { readonly __brand: 'ShoppingListItemId' };
export type TagId = string & { readonly __brand: 'TagId' };

/**
 * A user's Profile. `username` is null until they choose one. Your own Profile also says when you
 * joined (`createdAt`); another user's, as `getProfile` shows it, is only their id and username.
 */
export type Profile = {
  id: UserId;
  username: string | null;
  createdAt: string;
};

/** Another user's Profile: only who they are (decisions 11). */
export type OtherProfile = { id: UserId; username: string | null };

/** What `setUsername` did: took the name, or why not. A taken or reserved name is never an error. */
export type SetUsernameResult =
  | { status: 'set'; username: string }
  | { status: 'taken' }
  | { status: 'reserved' }
  /** Not 3–20 lowercase letters, digits and _ with at least one letter (`USERNAME_RULE`). */
  | { status: 'invalid' };

/** Where the signed-in user stands with another user. A request of theirs that was declined still reads `requestSent`. */
export type Relationship = 'none' | 'requestSent' | 'requestReceived' | 'friends';

/** Another user as username search finds them: who they are, and where you stand with them. */
export type FoundUser = { id: UserId; username: string; relationship: Relationship };

/**
 * What `sendFriendRequest` did. `requested`: your request is pending (or was declined, which you
 * can't tell). `accepted`: they had already asked you, so you're Friends now. `tooMany`: you have 50
 * requests out. `notFound`: nobody by that id can be asked. `noUsername`: choose a username first.
 */
export type FriendRequestResult = {
  status: 'requested' | 'accepted' | 'alreadyFriends' | 'tooMany' | 'notFound' | 'noUsername';
};

/** What `respondToFriendRequest` did; `notFound` when there's no such request waiting for you. */
export type FriendRequestAnswer = { status: 'accepted' | 'declined' | 'notFound' };

/** A user you're Friends with, and since when. */
export type Friend = { id: UserId; username: string; friendsSince: string };

/** A friend request: the other user (who sent it, or whom you sent it to) and when it was sent. */
export type FriendRequest = { id: UserId; username: string; sentAt: string };

/**
 * Requests waiting for your answer (`incoming`), and yours not accepted yet (`outgoing`, declined
 * ones included), newest first.
 */
export type FriendRequests = { incoming: FriendRequest[]; outgoing: FriendRequest[] };

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

/**
 * Why the Draft builder couldn't fill a Draft in. `sourceUnavailable`: the platform has no such
 * video (private, deleted). `sourceUnreachable`: the platform didn't answer. `unreadable`: no
 * recipe could be read from what it said. `timedOut`: the build took too long. `notSetUp`: the
 * server can't call Claude yet (no API key). The app couldn't read the source at all:
 * `noCaption`, the platform gave no caption (TikTok's oEmbed since October 2026), and
 * `sourceRefused`, the page turned the server away (a 4xx, such as a recipe site's 402). Those two
 * are not "recipe not in caption": the user can add the caption (`addCaptionToDraft`) instead.
 */
export type DraftBuildFailure =
  | 'sourceUnavailable'
  | 'sourceUnreachable'
  | 'unreadable'
  | 'timedOut'
  | 'notSetUp'
  | 'noCaption'
  | 'sourceRefused';

/** Whether a failure means the app couldn't read the source, so the user can add its caption. */
export function couldNotReadSource(reason: DraftBuildFailure): boolean {
  return reason === 'noCaption' || reason === 'sourceRefused';
}

/**
 * Where the Draft builder is with a Recipe. Hand-written and reviewed Recipes are `built`. A
 * failed build can be tried again while `canRetry` (3 builds in all); it can always be filled in
 * by hand.
 */
export type DraftBuild =
  | { status: 'building' }
  | { status: 'built' }
  | { status: 'failed'; reason: DraftBuildFailure; canRetry: boolean };

export type SourcePlatform = 'tiktok' | 'youtube' | 'instagram' | 'web';

/** The video a Recipe was saved from, as the platform described it. Null fields: not known (yet). */
export type SourceVideo = {
  platform: SourcePlatform;
  originalUrl: string;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
  /**
   * The screenshot the user added (an Instagram Reel's caption, say), as a link valid for an hour.
   * Absent when they added none. It is the user's own image, and the Recipe's picture.
   */
  screenshotUrl?: string;
};

/**
 * What the user added to a link so the Draft builder can read it when the app can't (an Instagram
 * Reel; a source that couldn't be read): a caption they pasted, a screenshot, or both. The
 * screenshot is JPEG bytes, already scaled to at most 1568 px on its long edge.
 */
export type CaptionInput = { caption?: string | null; screenshot?: ArrayBuffer | null };

/**
 * A label on a user's Recipes (cuisine, meal type, "quick"), theirs alone. `name` is as they first
 * spelled it; names are the same Tag without regard to case.
 */
export type Tag = { id: TagId; name: string };

type RecipeFields = {
  id: RecipeId;
  ownerId: UserId;
  title: string;
  /** False when the Draft builder found no recipe in the caption ("link in bio"). */
  recipeFound: boolean;
  lines: RecipeLine[];
  steps: string[];
  /** The video it was saved from; absent for a Recipe written by hand. */
  sourceVideo?: SourceVideo;
  createdAt: string;
  updatedAt: string;
};

/**
 * A Recipe in the user's library (`reviewed`), or a `draft` the Draft builder fills in and the
 * user hasn't reviewed yet, with where its build is.
 */
export type Recipe =
  | (RecipeFields & {
      status: 'reviewed';
      /** Its Tags, by name without regard to case. */
      tags: Tag[];
      /** When the user marked it Want to Cook; null when it isn't marked. */
      wantToCookSince: string | null;
    })
  | (RecipeFields & {
      status: 'draft';
      build: DraftBuild;
      /**
       * The Tag names the Draft builder suggests, each spelled as the user's Tag of that name when
       * they have one. Not Tags yet: `reviewDraft` makes the ones the user keeps.
       */
      suggestedTags: string[];
      /**
       * Whether the user can paste a caption or add a screenshot to build it again
       * (`addCaptionToDraft`): a failed Draft, or one built with no recipe found, with builds left.
       */
      canAddCaption: boolean;
    });

/** A Draft as the Drafts list shows it. */
export type DraftSummary = {
  id: RecipeId;
  title: string;
  build: DraftBuild;
  recipeFound: boolean;
  sourceVideo: SourceVideo | null;
  createdAt: string;
};

/** What `saveFromLink` did: saved the link as a Draft, which builds in the background. */
export type SaveFromLinkResult = { status: 'saved'; recipeId: RecipeId };

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

/** Someone who uses a Shopping List: its owner, or a Friend it's shared with (null: no username yet). */
export type ListPerson = { id: UserId; username: string | null };

/**
 * A user's Shopping List, theirs or a Friend's shared with them (decisions 13). Items are sorted by
 * name (an Ingredient line's Ingredient, a hand-added item's text); `recipes` lists each Recipe on
 * the list once, by title. `sharedWith`: the Friends it's shared with, by username. Someone who
 * checked an item off and is neither the owner nor one of them is a former Friend.
 */
export type ShoppingList = {
  id: ShoppingListId;
  ownerId: UserId;
  ownerUsername: string | null;
  sharedWith: ListPerson[];
  items: ShoppingListItem[];
  recipes: { id: RecipeId; title: string }[];
};

/** A Friend's Shopping List shared with the signed-in user ("Sam's list"). */
export type SharedShoppingList = { id: ShoppingListId; owner: { id: UserId; username: string } };

/** A Friend the signed-in user's Shopping List is shared with, and since when. */
export type ShoppingListShare = { friend: { id: UserId; username: string }; sharedAt: string };

/** What `shareShoppingList` did: shared (now or already), or not, as they aren't Friends. */
export type ShareShoppingListResult = { status: 'shared' | 'notFriends' };

/** What `stopSharingShoppingList` did: stopped, or it wasn't shared with them. */
export type StopSharingShoppingListResult = { status: 'stopped' | 'notShared' };

/** What `leaveSharedShoppingList` did: left, or it wasn't shared with you. */
export type LeaveSharedShoppingListResult = { status: 'left' | 'notShared' };

/**
 * Whether list changes made on this phone are waiting to reach the server. `idle`: none are, as far
 * as the phone knows. `syncing`: sending them. `offline`: the last request didn't get through;
 * `waiting` changes will be sent on reconnect. `waitingToRetry`: the server was reached but failed
 * on the oldest change waiting; it and the rest are tried again at `retryAt` (ISO time).
 */
export type ListSync =
  | { status: 'idle' | 'syncing' | 'offline'; waiting: number }
  | { status: 'waitingToRetry'; waiting: number; retryAt: string };

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
  /**
   * The list with the changes made on this phone, sent or not. `live`: changes made elsewhere show
   * as they happen (the phone hears of them over Realtime).
   */
  | { status: 'loaded'; list: ShoppingList; live: boolean; sync: ListSync; notSaved: NotSavedListChange[] }
  /**
   * A Friend's list the user can't use any more (its owner stopped sharing, or they're no longer
   * Friends): nothing of it is kept on the phone. `changesNotSaved` of the user's changes to it
   * never reached it.
   */
  | {
      status: 'noLongerShared';
      ownerUsername: string | null;
      changesNotSaved: number;
      sync: ListSync;
      notSaved: NotSavedListChange[];
    }
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

/**
 * A link save refused by the daily limit (decisions 07): the user has saved `limit` links in the
 * last 24 hours. Nothing was saved. `retryAt` (an ISO timestamp) is when they can save again.
 */
export class DailyLimitError extends DataError {
  readonly limit: number;
  readonly retryAt: string;

  constructor(limit: number, retryAt: string) {
    super('daily_limit_reached', `You've saved ${limit} links in the last 24 hours, the daily limit.`);
    this.name = 'DailyLimitError';
    this.limit = limit;
    this.retryAt = retryAt;
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

/**
 * The Draft a tapped "Draft ready" notification opens: its `data` is `{ kind: 'draftReady',
 * recipeId }` (decisions 07). Null for any other notification, or data that isn't that.
 */
export function parseDraftReadyPush(data: unknown): RecipeId | null {
  if (typeof data !== 'object' || data === null) return null;
  const kind: unknown = Reflect.get(data, 'kind');
  const recipeId: unknown = Reflect.get(data, 'recipeId');
  if (kind !== 'draftReady' || typeof recipeId !== 'string' || !UUID.test(recipeId)) return null;
  return parseRecipeId(recipeId);
}

/**
 * Who sent a tapped "Friend request" notification, from its data `{ kind: 'friendRequest',
 * fromUserId }` (decisions 11). Null for any other notification, or data that isn't that.
 */
export function parseFriendRequestPush(data: unknown): UserId | null {
  if (typeof data !== 'object' || data === null) return null;
  const kind: unknown = Reflect.get(data, 'kind');
  const fromUserId: unknown = Reflect.get(data, 'fromUserId');
  if (kind !== 'friendRequest' || typeof fromUserId !== 'string' || !UUID.test(fromUserId)) return null;
  return parseUserId(fromUserId);
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

export function parseTagId(raw: string): TagId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_tag_id', `Not a Tag id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as TagId;
}

export function parseShoppingListItemId(raw: string): ShoppingListItemId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_shopping_list_item_id', `Not a Shopping List item id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as ShoppingListItemId;
}
