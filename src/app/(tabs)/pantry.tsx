import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { Ingredient, Pantry as PantryContents } from '@/data';
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

  const load = useCallback(
    () =>
      data
        .getPantry()
        .then((pantry) => setState({ status: 'loaded', pantry }))
        .catch((e: unknown) => setState({ status: 'error', message: messageOf(e) })),
    [],
  );

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
  const setStaples = (names: string[]) => change('staples', () => data.setStaples(names));
  const addStaple = () =>
    setStaples([...staples.map((s) => s.name), newStaple]).then((ok) => ok && setNewStaple(''));
  const removeStaple = (staple: Ingredient) =>
    setStaples(staples.filter((s) => s.id !== staple.id).map((s) => s.name));

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
                  action={{ label: 'Remove', onPress: () => removeStaple(staple) }}
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
