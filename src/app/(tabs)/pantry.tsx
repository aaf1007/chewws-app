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
  const [newIngredient, setNewIngredient] = useState('');
  const [newStaple, setNewStaple] = useState('');
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

  /** Makes a change, then shows the Pantry as it is now. Returns whether the change worked. */
  const change = (field: ChangeError['field'], run: () => Promise<unknown>) => {
    setChangeError(null);
    return run()
      .then(() => true)
      .catch((e: unknown) => {
        setChangeError({ field, message: messageOf(e) });
        return false;
      })
      .finally(load);
  };

  const addIngredient = () =>
    change('pantry', () => data.addToPantry(newIngredient)).then((ok) => ok && setNewIngredient(''));

  const staples = state.status === 'loaded' ? state.pantry.staples : [];
  const addStaple = () =>
    change('staples', () => data.addStaple(newStaple)).then((ok) => ok && setNewStaple(''));

  const errorFor = (field: ChangeError['field']) =>
    changeError?.field === field ? <Text tone="danger">{changeError.message}</Text> : null;

  return (
    <Screen title="Pantry" scroll>
      <AddField
        value={newIngredient}
        onChangeText={setNewIngredient}
        onSubmit={addIngredient}
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
                    onPress: () => change('pantry', () => data.markUsedUp(ingredient.id)),
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
                    onPress: () => change('staples', () => data.removeStaple(staple.id)),
                  }}
                />
              ))}
            </View>
            <AddField
              value={newStaple}
              onChangeText={setNewStaple}
              onSubmit={addStaple}
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
