import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { ListSync, NotSavedListChange, ShoppingListItem, ShoppingListView } from '@/data';
import { data } from '@/data/app';
import { AddField, EmptyState, Screen, SectionHeader, ShoppingListRow, SyncNotice, Text } from '@/ui';

/** Each Recipe's amounts under an Ingredient line: "Aglio e olio · 4 cloves, 1 clove". */
const detailsOf = (item: ShoppingListItem) =>
  item.kind === 'ingredient'
    ? item.recipes.map(({ recipe, amountTexts }) =>
        amountTexts.length > 0 ? `${recipe.title} · ${amountTexts.join(', ')}` : recipe.title,
      )
    : [];

const nameOf = (item: ShoppingListItem) => (item.kind === 'ingredient' ? item.ingredient.name : item.text);

const changes = (count: number) => (count === 1 ? '1 change' : `${count} changes`);

/** What to tell the user about changes made on this phone that the server doesn't have yet. */
function syncNoticeOf(sync: ListSync): { status: 'offline' | 'syncing'; message: string } | null {
  if (sync.status === 'offline') {
    return {
      status: 'offline',
      message:
        sync.waiting > 0
          ? `You're offline. ${changes(sync.waiting)} will sync when you're back online.`
          : "You're offline. This is your list as it was last loaded.",
    };
  }
  if (sync.status === 'syncing' && sync.waiting > 0) {
    return { status: 'syncing', message: `Syncing ${changes(sync.waiting)}…` };
  }
  return null;
}

const VERB: Record<NotSavedListChange['kind'], string> = {
  checkOff: 'check off',
  uncheck: 'uncheck',
  addManualItem: 'add',
};

/** "Couldn't check off Foil." */
const notSavedMessage = ({ kind, itemName }: NotSavedListChange) => `Couldn't ${VERB[kind]} ${itemName}.`;

export default function ShoppingList() {
  const [state, setState] = useState<ShoppingListView>({
    status: 'loading',
    sync: { status: 'idle', waiting: 0 },
    notSaved: [],
  });
  const [changeError, setChangeError] = useState<string | null>(null);

  // The list as the phone has it, updated on every change (sent or still waiting for a signal)
  // and whenever it's read from the server, while this tab is open.
  useFocusEffect(useCallback(() => data.watchShoppingList(setState), []));

  /** Makes a change; the list shows it as it happens. If it fails, shows why and rejects. */
  const change = (run: () => Promise<unknown>) => {
    setChangeError(null);
    return run().catch((e: unknown) => {
      setChangeError(messageOf(e));
      throw e;
    });
  };
  /** For a row's button, whose failure is already shown by `change`. */
  const changeFromRow = (run: () => Promise<unknown>) => () => {
    change(run).catch(() => {});
  };

  const row = (item: ShoppingListItem) => {
    const checked = item.check.status === 'checked';
    return (
      <ShoppingListRow
        key={item.id}
        name={nameOf(item)}
        details={detailsOf(item)}
        check={{
          checked,
          onPress: changeFromRow(() => (checked ? data.uncheck(item.id) : data.checkOff(item.id))),
        }}
        action={{ label: 'Remove', onPress: changeFromRow(() => data.removeFromShoppingList(item.id)) }}
      />
    );
  };

  const notice = state.status === 'failed' ? null : syncNoticeOf(state.sync);
  const items = state.status === 'loaded' ? state.list.items : [];
  const toBuy = items.filter((item) => item.check.status === 'unchecked');
  const checkedOff = items.filter((item) => item.check.status === 'checked');
  const recipes = state.status === 'loaded' ? state.list.recipes : [];

  return (
    <Screen title="Shopping List" scroll>
      <AddField
        onSubmit={(text) => change(() => data.addManualItem(text))}
        placeholder="Add something to buy"
        testID="shopping-list-add"
      />
      {notice ? <SyncNotice status={notice.status} message={notice.message} testID="shopping-list-sync" /> : null}
      {state.notSaved.map((change, i) => (
        <SyncNotice
          key={i}
          status="notSaved"
          message={notSavedMessage(change)}
          action={i === state.notSaved.length - 1 ? { label: 'OK', onPress: () => void data.dismissNotSavedListChanges() } : undefined}
          testID="shopping-list-not-saved"
        />
      ))}
      {changeError ? <Text tone="danger">{changeError}</Text> : null}
      {state.status === 'failed' ? <Text tone="danger">{state.error.message}</Text> : null}

      {state.status === 'loaded' && items.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Your Shopping List is empty"
          message="Add a Recipe to get the Ingredients it needs that aren't in your Pantry, or add anything by hand."
        />
      ) : null}

      {toBuy.length > 0 ? (
        <View>
          <SectionHeader title="To buy" />
          {toBuy.map(row)}
        </View>
      ) : null}

      {checkedOff.length > 0 ? (
        <View>
          <SectionHeader title="Checked off" />
          <Text variant="caption" tone="textMuted">
            Ingredients you check off go in your Pantry.
          </Text>
          {checkedOff.map(row)}
        </View>
      ) : null}

      {recipes.length > 0 ? (
        <View>
          <SectionHeader title="From Recipes" />
          <Text variant="caption" tone="textMuted">
            Removing a Recipe takes off its amounts, and every line only it needs.
          </Text>
          {recipes.map((recipe) => (
            <ShoppingListRow
              key={recipe.id}
              name={recipe.title}
              action={{
                label: 'Remove',
                onPress: changeFromRow(() => data.removeRecipeFromShoppingList(recipe.id)),
              }}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
