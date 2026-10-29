import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { leavesCookPlansWarning } from '@/components/cook-plan-copy';
import { RecipeTags } from '@/components/recipe-tags';
import { SourceVideoLink } from '@/components/source-video';
import { useRecipe } from '@/components/use-recipe';
import type { Recipe, RecipeId } from '@/data';
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
  const [markingWantToCook, setMarkingWantToCook] = useState(false);

  if (state.status !== 'loaded') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState icon="alert-circle-outline" title="Recipe not found" message={state.message} />
        )}
      </Screen>
    );
  }

  const { recipe, reload } = state;
  if (recipe.status === 'someoneElses') return <SomeoneElsesRecipe recipe={recipe} reload={reload} />;
  const { id } = recipe;
  const wantToCook = recipe.status === 'reviewed' && recipe.wantToCookSince !== null;
  const toggleWantToCook = () => {
    setError(null);
    setMarkingWantToCook(true);
    data
      .setWantToCook(id, !wantToCook)
      .then(reload)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setMarkingWantToCook(false));
  };
  // A Recipe in Cook Plans says so first: deleting it takes it out of them (decisions 14).
  const confirmDelete = async () => {
    setError(null);
    const plans = await data.recipeCookPlans(id).catch(() => []);
    const leaves = leavesCookPlansWarning(plans);
    const message = leaves ? `${leaves} This also removes it from your library.` : 'This removes it from your library.';
    Alert.alert(`Delete “${recipe.title}”?`, message, [
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
  };

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
      {recipe.status === 'reviewed' && recipe.savedFrom ? (
        <Text tone="textMuted">{recipe.savedFrom.username ? `Saved from @${recipe.savedFrom.username}` : 'Saved from a Cook Plan'}</Text>
      ) : null}
      {recipe.sourceVideo ? <SourceVideoLink recipeId={id} video={recipe.sourceVideo} recipeTitle={recipe.title} /> : null}
      {recipe.status === 'reviewed' ? (
        <>
          <Button
            label="Want to Cook"
            variant={wantToCook ? 'filled' : 'outlined'}
            icon={wantToCook ? 'flame' : 'flame-outline'}
            selected={wantToCook}
            disabled={markingWantToCook}
            onPress={toggleWantToCook}
            testID="want-to-cook"
          />
          <RecipeTags recipeId={id} tags={recipe.tags} onChanged={reload} />
        </>
      ) : null}
      <RecipeBody recipe={recipe} />

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
        <Button label="Delete Recipe" variant="danger" icon="trash-outline" onPress={() => void confirmDelete()} />
      </View>
    </Screen>
  );
}

/** A Recipe's Ingredients and steps, whoever's it is. */
function RecipeBody({ recipe }: { recipe: Recipe }) {
  return (
    <>
      <View>
        <SectionHeader title="Ingredients" />
        {recipe.lines.length === 0 ? (
          <Text tone="textMuted">No ingredients yet.</Text>
        ) : (
          recipe.lines.map((line, index) => (
            <IngredientLineRow key={index} text={line.originalText} ingredient={line.ingredient.name} amount={line.amountText} />
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
    </>
  );
}

/**
 * Another member's Recipe, from a Cook Plan (decisions 14): read it, and save your own copy to
 * change, Tag or cook from (ADR-0002). Its Tags, Want to Cook and screenshot stay its owner's.
 */
function SomeoneElsesRecipe({ recipe, reload }: { recipe: Extract<Recipe, { status: 'someoneElses' }>; reload: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openCopy = (copy: RecipeId) => router.push({ pathname: '/recipe/[id]', params: { id: copy } });

  const saveCopy = () => {
    setError(null);
    setSaving(true);
    data
      .copyRecipe(recipe.id)
      .then((copied) => {
        if (copied.status === 'notFound') setError('You can’t open this Recipe any more.');
        else setSaved(true);
        reload();
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setSaving(false));
  };

  return (
    <Screen title={recipe.title} scroll>
      <Text tone="textMuted">{recipe.owner.username ? `@${recipe.owner.username}'s Recipe` : 'Someone else’s Recipe'}</Text>
      {recipe.sourceVideo ? <SourceVideoLink recipeId={recipe.id} video={recipe.sourceVideo} recipeTitle={recipe.title} /> : null}
      {recipe.yourCopy ? (
        <View style={{ gap: spacing.sm }}>
          <Button label="Open your copy" icon="book-outline" onPress={() => recipe.yourCopy && openCopy(recipe.yourCopy)} />
          {saved ? (
            <Text variant="caption" tone="textMuted">
              Saved to your library.
            </Text>
          ) : null}
        </View>
      ) : (
        <Button label="Save your own copy" icon="bookmark-outline" disabled={saving} onPress={saveCopy} />
      )}
      {error ? <Text tone="danger">{error}</Text> : null}
      <RecipeBody recipe={recipe} />
    </Screen>
  );
}
