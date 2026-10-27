import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { Pantry as PantryContents } from '@/data';
import { data } from '@/data/app';
import { AddField, EmptyState, IngredientRow, Screen, SectionHeader, Text, spacing } from '@/ui';

type PantryState =
  | { status: 'loading' }
  | { status: 'loaded'; pantry: PantryContents }
  | { status: 'error'; message: string };

/** Which field the last failed change came from, so its error shows under that field. */
type ChangeError = { field: 'pantry' | 'staples'; message: string };

export default function Pantry() {
  const [state, setState] = useState<PantryState>({ status: 'loading' });
  const [changeError, setChangeError] = useState<ChangeError | null>(null);

  // Changes can overlap, each followed by a reload; only the newest reload is shown, so an older
  // one finishing late can't bring back what a later change removed.
  const latestLoad = useRef(0);
  const load = useCallback(() => {
    const thisLoad = ++latestLoad.current;
    const show = (next: PantryState) => {
      if (thisLoad === latestLoad.current) setState(next);
    };
    return data
      .getPantry()
      .then((pantry) => show({ status: 'loaded', pantry }))
      .catch((e: unknown) => show({ status: 'error', message: messageOf(e) }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Makes a change, then shows the Pantry as it is now. If the change fails, shows why under its
   * field and rejects, so an `AddField` gets its text back.
   */
  const change = (field: ChangeError['field'], run: () => Promise<unknown>) => {
    setChangeError(null);
    return run()
      .catch((e: unknown) => {
        setChangeError({ field, message: messageOf(e) });
        throw e;
      })
      .finally(load);
  };
  /** For a row's button, whose failure is already shown by `change`. */
  const changeFromRow = (field: ChangeError['field'], run: () => Promise<unknown>) => () => {
    change(field, run).catch(() => {});
  };

  const staples = state.status === 'loaded' ? state.pantry.staples : [];

  const errorFor = (field: ChangeError['field']) =>
    changeError?.field === field ? <Text tone="danger">{changeError.message}</Text> : null;

  return (
    <Screen title="Pantry" scroll>
      <AddField
        onSubmit={(name) => change('pantry', () => data.addToPantry(name))}
        placeholder="Add an Ingredient you have"
        testID="pantry-add"
      />
      {errorFor('pantry')}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}

      {state.status === 'loaded' ? (
        <>
          <View>
            <SectionHeader title="In your Pantry" />
            {state.pantry.ingredients.length === 0 ? (
              <EmptyState
                icon="basket-outline"
                title="Your Pantry is empty"
                message="Add the Ingredients you have at home, and mark them used up when they run out."
              />
            ) : (
              state.pantry.ingredients.map((ingredient) => (
                <IngredientRow
                  key={ingredient.id}
                  name={ingredient.name}
                  action={{
                    label: 'Used up',
                    onPress: changeFromRow('pantry', () => data.markUsedUp(ingredient.id)),
                  }}
                />
              ))
            )}
          </View>

          <View style={{ gap: spacing.sm }}>
            <View>
              <SectionHeader title="Staples" />
              <Text variant="caption" tone="textMuted">
                Always counted as in your Pantry.
              </Text>
              {staples.map((staple) => (
                <IngredientRow
                  key={staple.id}
                  name={staple.name}
                  action={{
                    label: 'Remove',
                    onPress: changeFromRow('staples', () => data.removeStaple(staple.id)),
                  }}
                />
              ))}
            </View>
            <AddField
              onSubmit={(name) => change('staples', () => data.addStaple(name))}
              placeholder="Add a Staple"
              testID="staple-add"
            />
            {errorFor('staples')}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
