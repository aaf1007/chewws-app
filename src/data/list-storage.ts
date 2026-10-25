/**
 * Reading back what the phone saved for the Shopping List: the last list it saw and its queued
 * changes. What's saved was written by this app, but may be from an older version, cut short or
 * cleared, so anything that isn't exactly the expected shape reads as nothing rather than throwing.
 */
import type { ListChange } from './list-engine';
import {
  parseIngredientId,
  parseRecipeId,
  parseShoppingListId,
  parseShoppingListItemId,
  parseUserId,
  type CheckState,
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

/** The Shopping List the phone saved, or null if there's none it can read. */
export function parseSavedShoppingList(raw: string | null): ShoppingList | null {
  if (raw === null) return null;
  try {
    const row = record(JSON.parse(raw));
    return {
      id: parseShoppingListId(text(row.id)),
      ownerId: parseUserId(text(row.ownerId)),
      items: list(row.items).map(item),
      recipes: list(row.recipes).map(recipe),
    };
  } catch {
    return null;
  }
}

/** One queued Shopping List change, or null if it isn't one. */
export function parseListChange(value: unknown): ListChange | null {
  try {
    const row = record(value);
    const itemId = parseShoppingListItemId(text(row.itemId));
    switch (row.kind) {
      case 'checkOff':
        return { kind: 'checkOff', itemId };
      case 'uncheck':
        return { kind: 'uncheck', itemId };
      case 'addManualItem': {
        const typed = text(row.text).trim();
        return typed ? { kind: 'addManualItem', itemId, text: typed } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
