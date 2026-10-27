import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { SourceVideoLink } from '@/components/source-video';
import { useRecipe } from '@/components/use-recipe';
import { data } from '@/data/app';
import {
  Button,
  EmptyState,
  IngredientLineRow,
  Screen,
  SectionHeader,
  StepRow,
  Text,
  spacing,
} from '@/ui';

export default function RecipeDetail() {
  const state = useRecipe(useLocalSearchParams<{ id: string }>().id);
  const [error, setError] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);

  if (state.status !== 'loaded') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState icon="alert-circle-outline" title="Recipe not found" message={state.message} />
        )}
      </Screen>
    );
  }

  const { recipe } = state;
  const { id } = recipe;
  const confirmDelete = () =>
    Alert.alert(`Delete “${recipe.title}”?`, 'This removes it from your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          data
            .deleteRecipe(id)
            .then(() => router.back())
            .catch((e: unknown) => setError(messageOf(e))),
      },
    ]);

  const addToShoppingList = () => {
    setError(null);
    setListMessage(null);
    data
      .addRecipeToShoppingList(id)
      .then((needed) =>
        setListMessage(
          needed.length === 0
            ? 'You have every Ingredient this Recipe needs.'
            : `On your Shopping List: ${needed.map((i) => i.name).join(', ')}.`,
        ),
      )
      .catch((e: unknown) => setError(messageOf(e)));
  };

  return (
    <Screen title={recipe.title} scroll>
      {recipe.sourceVideo ? <SourceVideoLink video={recipe.sourceVideo} /> : null}
      <View>
        <SectionHeader title="Ingredients" />
        {recipe.lines.length === 0 ? (
          <Text tone="textMuted">No ingredients yet.</Text>
        ) : (
          recipe.lines.map((line, index) => (
            <IngredientLineRow
              key={index}
              text={line.originalText}
              ingredient={line.ingredient.name}
              amount={line.amountText}
            />
          ))
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeader title="Steps" />
        {recipe.steps.length === 0 ? (
          <Text tone="textMuted">No steps yet.</Text>
        ) : (
          recipe.steps.map((step, index) => <StepRow key={index} number={index + 1} text={step} />)
        )}
      </View>

      {error ? <Text tone="danger">{error}</Text> : null}
      <View style={{ gap: spacing.sm }}>
        <Button label="Add to Shopping List" icon="cart-outline" onPress={addToShoppingList} />
        {listMessage ? (
          <Text variant="caption" tone="textMuted">
            {listMessage}
          </Text>
        ) : null}
        <Button
          label="Edit Recipe"
          variant="outlined"
          icon="create-outline"
          onPress={() => router.push({ pathname: '/recipe/[id]/edit', params: { id } })}
        />
        <Button label="Delete Recipe" variant="danger" icon="trash-outline" onPress={confirmDelete} />
      </View>
    </Screen>
  );
}
