/**
 * Reading back what the phone saved for the Shopping List and Cook Plan lists: the last list it saw
 * and its queued changes. What's saved was written by this app, but may be from an older version, cut short or
 * cleared, so anything that isn't exactly the expected shape reads as nothing rather than throwing.
 */
import { toCookPlanList, withItems, type CookPlanListChange, type ListChange, type ShoppingListChange, type ShoppingListRef } from './list-engine';
import {
  parseCookPlanId,
  parseCookPlanItemId,
  parseIngredientId,
  parseRecipeId,
  parseShoppingListId,
  parseShoppingListItemId,
  parseUserId,
  type CheckState,
  type ClaimState,
  type CookPlanId,
  type CookPlanList,
  type CookPlanListItem,
  type CookPlanRecipeAmounts,
  type ListPerson,
  type SharedShoppingList,
  type ShoppingListId,
  type Ingredient,
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListRecipeAmounts,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Thrown inside the parsers; never escapes them. */
class Unreadable extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Unreadable();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Unreadable();
  return value;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Unreadable();
  return value;
}

function ingredient(value: unknown): Ingredient {
  const row = record(value);
  return { id: parseIngredientId(text(row.id)), name: text(row.name) };
}

function check(value: unknown): CheckState {
  const row = record(value);
  if (row.status === 'unchecked') return { status: 'unchecked' };
  if (row.status !== 'checked') throw new Unreadable();
  return {
    status: 'checked',
    checkedAt: text(row.checkedAt),
    checkedBy: row.checkedBy === null ? null : parseUserId(text(row.checkedBy)),
  };
}

function recipe(value: unknown) {
  const row = record(value);
  return { id: parseRecipeId(text(row.id)), title: text(row.title) };
}

function recipeAmounts(value: unknown): ShoppingListRecipeAmounts {
  const row = record(value);
  return { recipe: recipe(row.recipe), amountTexts: list(row.amountTexts).map(text) };
}

function item(value: unknown): ShoppingListItem {
  const row = record(value);
  const id = parseShoppingListItemId(text(row.id));
  if (row.kind === 'ingredient') {
    return {
      kind: 'ingredient',
      id,
      ingredient: ingredient(row.ingredient),
      recipes: list(row.recipes).map(recipeAmounts),
      check: check(row.check),
    };
  }
  if (row.kind !== 'handAdded') throw new Unreadable();
  return {
    kind: 'handAdded',
    id,
    text: text(row.text),
    ingredient: row.ingredient === null ? null : ingredient(row.ingredient),
    check: check(row.check),
  };
}

const optionalText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value));

function person(value: unknown): ListPerson {
  const row = record(value);
  return { id: parseUserId(text(row.id)), username: optionalText(row.username) };
}

/**
 * The Shopping List the phone saved, or null if there's none it can read. One saved before lists
 * were shared has no owner's username and is shared with nobody.
 */
export function parseSavedShoppingList(raw: string | null): ShoppingList | null {
  if (raw === null) return null;
  try {
    const row = record(JSON.parse(raw));
    // Its Recipes are those its lines name, whatever was saved beside them.
    return withItems(
      {
        id: parseShoppingListId(text(row.id)),
        ownerId: parseUserId(text(row.ownerId)),
        ownerUsername: optionalText(row.ownerUsername),
        sharedWith: row.sharedWith === undefined ? [] : list(row.sharedWith).map(person),
      },
      list(row.items).map(item),
    );
  } catch {
    return null;
  }
}

/**
 * How a queued change is saved: a Shopping List's as ticket 10 saved a hand-add, with its list's id
 * as `listId`, now on every change; a Cook Plan list's with its `list` (decisions 13, 15).
 */
export function encodeListChange(change: ListChange): Record<string, unknown> {
  if (change.list.kind === 'cookPlan') return { ...change };
  const { list, ...rest } = change;
  return { ...rest, listId: list.id };
}

/** The Shopping List a saved change names: `listId` (or a `list` of that kind), else `ownListId`. */
function shoppingListOf(row: Record<string, unknown>, ownListId: ShoppingListId | null): ShoppingListRef | null {
  if (row.listId !== undefined) return { kind: 'shoppingList', id: parseShoppingListId(text(row.listId)) };
  if (row.list !== undefined) {
    const ref = record(row.list);
    if (ref.kind !== 'shoppingList') throw new Unreadable();
    return { kind: 'shoppingList', id: parseShoppingListId(text(ref.id)) };
  }
  return ownListId === null ? null : { kind: 'shoppingList', id: ownListId };
}

const COOK_PLAN_CHANGES = ['checkOff', 'uncheck', 'claim', 'unclaim'] as const;

/** A saved change to a Cook Plan's list, which always names its plan as `list`. */
function cookPlanChange(row: Record<string, unknown>): CookPlanListChange | null {
  const ref = record(row.list);
  const kind = COOK_PLAN_CHANGES.find((k) => k === row.kind);
  if (kind === undefined) return null;
  return {
    kind,
    list: { kind: 'cookPlan', id: parseCookPlanId(text(ref.id)) },
    itemId: parseCookPlanItemId(text(row.itemId)),
  };
}

function shoppingListChange(row: Record<string, unknown>, ownListId: ShoppingListId | null): ShoppingListChange | null {
  const itemId = parseShoppingListItemId(text(row.itemId));
  const list = shoppingListOf(row, ownListId);
  if (!list) return null;
  switch (row.kind) {
    case 'checkOff':
      return { kind: 'checkOff', list, itemId };
    case 'uncheck':
      return { kind: 'uncheck', list, itemId };
    case 'addManualItem': {
      const typed = text(row.text).trim();
      return typed ? { kind: 'addManualItem', list, itemId, text: typed } : null;
    }
    default:
      return null;
  }
}

/**
 * One queued list change, or null if it isn't one. A change an older version saved without its
 * list (a check before ticket 13, a hand-add before ticket 10) is for `ownListId`, the user's own
 * list as the phone saved it; with none saved, it isn't one.
 */
export function parseListChange(value: unknown, ownListId: ShoppingListId | null): ListChange | null {
  try {
    const row = record(value);
    if (row.listId === undefined && row.list !== undefined && record(row.list).kind === 'cookPlan') return cookPlanChange(row);
    return shoppingListChange(row, ownListId);
  } catch {
    return null;
  }
}

function claim(value: unknown): ClaimState {
  const row = record(value);
  if (row.status === 'unclaimed') return { status: 'unclaimed' };
  if (row.status !== 'claimed') throw new Unreadable();
  return { status: 'claimed', claimedAt: text(row.claimedAt), claimedBy: row.claimedBy === null ? null : parseUserId(text(row.claimedBy)) };
}

function planRecipeAmounts(value: unknown): CookPlanRecipeAmounts {
  const row = record(value);
  const recipe = record(row.recipe);
  const amountTexts = list(row.amountTexts).map(text);
  if (recipe.status === 'removed') return { recipe: { status: 'removed', title: text(recipe.title) }, amountTexts };
  if (recipe.status !== 'inPlan') throw new Unreadable();
  return { recipe: { status: 'inPlan', id: parseRecipeId(text(recipe.id)), title: text(recipe.title) }, amountTexts };
}

function planItem(value: unknown): CookPlanListItem {
  const row = record(value);
  return {
    id: parseCookPlanItemId(text(row.id)),
    ingredient: ingredient(row.ingredient),
    recipes: list(row.recipes).map(planRecipeAmounts),
    whoHas: list(row.whoHas).map(person),
    claim: claim(row.claim),
    check: check(row.check),
  };
}

/** The Cook Plan list the phone saved for `planId`, or null if there's none it can read. */
export function parseSavedCookPlanList(raw: string | null, planId: CookPlanId): CookPlanList | null {
  if (raw === null) return null;
  try {
    const row = record(JSON.parse(raw));
    if (parseCookPlanId(text(row.planId)) !== planId) return null;
    if (row.status !== 'active' && row.status !== 'cooked') throw new Unreadable();
    const items = list(row.items).map(planItem);
    // Who has what is kept as it was saved; the list is put in order again.
    const whoHas = items.flatMap((item) => item.whoHas.map((p) => ({ ingredientId: item.ingredient.id, userId: p.id })));
    return toCookPlanList({ planId, status: row.status, members: list(row.members).map(person) }, items, whoHas);
  } catch {
    return null;
  }
}

/** A Cook Plan the user found they aren't in any more, until they've been told. */
export type LostCookPlan = { planId: CookPlanId; changesNotSaved: number };

function lostPlan(value: unknown): LostCookPlan {
  const row = record(value);
  const count = row.changesNotSaved;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Unreadable();
  return { planId: parseCookPlanId(text(row.planId)), changesNotSaved: count };
}

/**
 * What the phone saved of the Cook Plan lists it keeps: which plans' lists it has copies of, and
 * those it lost. Anything unreadable reads as none.
 */
export function parseSavedCookPlanIndex(raw: string | null): { plans: CookPlanId[]; lost: LostCookPlan[] } {
  if (raw === null) return { plans: [], lost: [] };
  try {
    const row = record(JSON.parse(raw));
    return { plans: list(row.plans).map((id) => parseCookPlanId(text(id))), lost: list(row.lost).map(lostPlan) };
  } catch {
    return { plans: [], lost: [] };
  }
}

/** A list shared with the user, as the phone saved it for the switcher. */
function sharedList(value: unknown): SharedShoppingList {
  const row = record(value);
  const owner = record(row.owner);
  return { id: parseShoppingListId(text(row.id)), owner: { id: parseUserId(text(owner.id)), username: text(owner.username) } };
}

/** A Friend's list the user found they can't use any more, until they've been told. */
export type LostSharedList = { id: ShoppingListId; ownerUsername: string | null; changesNotSaved: number };

function lostList(value: unknown): LostSharedList {
  const row = record(value);
  const count = row.changesNotSaved;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Unreadable();
  return { id: parseShoppingListId(text(row.id)), ownerUsername: optionalText(row.ownerUsername), changesNotSaved: count };
}

/** What the phone saved of the lists shared with the user. Anything unreadable reads as none. */
export function parseSavedSharedLists(raw: string | null): { lists: SharedShoppingList[]; lost: LostSharedList[] } {
  if (raw === null) return { lists: [], lost: [] };
  try {
    const row = record(JSON.parse(raw));
    return { lists: list(row.lists).map(sharedList), lost: list(row.lost).map(lostList) };
  } catch {
    return { lists: [], lost: [] };
  }
}
