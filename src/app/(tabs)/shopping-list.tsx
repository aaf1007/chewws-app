import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { ShoppingList as ShoppingListContents, ShoppingListItem } from '@/data';
import { data } from '@/data/app';
import { AddField, EmptyState, Screen, SectionHeader, ShoppingListRow, Text } from '@/ui';

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; list: ShoppingListContents }
  | { status: 'error'; message: string };

/** Each Recipe's amounts under an Ingredient line: "Aglio e olio · 4 cloves, 1 clove". */
const detailsOf = (item: ShoppingListItem) =>
  item.kind === 'ingredient'
    ? item.recipes.map(({ recipe, amountTexts }) =>
        amountTexts.length > 0 ? `${recipe.title} · ${amountTexts.join(', ')}` : recipe.title,
      )
    : [];

const nameOf = (item: ShoppingListItem) => (item.kind === 'ingredient' ? item.ingredient.name : item.text);

export default function ShoppingList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [changeError, setChangeError] = useState<string | null>(null);

  // Changes can overlap, each followed by a reload; only the newest reload is shown, so an older
  // one finishing late can't bring back what a later change removed.
  const latestLoad = useRef(0);
  const load = useCallback(() => {
    const thisLoad = ++latestLoad.current;
    const show = (next: ListState) => {
      if (thisLoad === latestLoad.current) setState(next);
    };
    return data
      .getShoppingList()
      .then((list) => show({ status: 'loaded', list }))
      .catch((e: unknown) => show({ status: 'error', message: messageOf(e) }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Makes a change, then shows the list as it is now. If it fails, shows why and rejects. */
  const change = (run: () => Promise<unknown>) => {
    setChangeError(null);
    return run()
      .catch((e: unknown) => {
        setChangeError(messageOf(e));
        throw e;
      })
      .finally(load);
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
      {changeError ? <Text tone="danger">{changeError}</Text> : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}

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
