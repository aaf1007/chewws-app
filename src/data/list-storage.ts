/**
 * Reading back what the phone saved for the Shopping List: the last list it saw and its queued
 * changes. What's saved was written by this app, but may be from an older version, cut short or
 * cleared, so anything that isn't exactly the expected shape reads as nothing rather than throwing.
 */
import { withItems, type ListChange, type ListRef } from './list-engine';
import {
  parseIngredientId,
  parseRecipeId,
  parseShoppingListId,
  parseShoppingListItemId,
  parseUserId,
  type CheckState,
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
 * How a queued change is saved: as ticket 10 saved a hand-add, with its Shopping List's id as
 * `listId`, now on every change. Ticket 15 saves a Cook Plan's as `list`.
 */
export function encodeListChange(change: ListChange): Record<string, unknown> {
  const { list, ...rest } = change;
  return { ...rest, listId: list.id };
}

/** The list a saved change names: `listId` (or a `list` of a kind this app knows), else `ownListId`. */
function listOf(row: Record<string, unknown>, ownListId: ShoppingListId | null): ListRef | null {
  if (row.listId !== undefined) return { kind: 'shoppingList', id: parseShoppingListId(text(row.listId)) };
  if (row.list !== undefined) {
    const ref = record(row.list);
    if (ref.kind !== 'shoppingList') throw new Unreadable();
    return { kind: 'shoppingList', id: parseShoppingListId(text(ref.id)) };
  }
  return ownListId === null ? null : { kind: 'shoppingList', id: ownListId };
}

/**
 * One queued list change, or null if it isn't one. A change an older version saved without its
 * list (a check before ticket 13, a hand-add before ticket 10) is for `ownListId`, the user's own
 * list as the phone saved it; with none saved, it isn't one.
 */
export function parseListChange(value: unknown, ownListId: ShoppingListId | null): ListChange | null {
  try {
    const row = record(value);
    const itemId = parseShoppingListItemId(text(row.itemId));
    const list = listOf(row, ownListId);
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
  } catch {
    return null;
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
