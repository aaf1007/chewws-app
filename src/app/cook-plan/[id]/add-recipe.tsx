import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import { parseCookPlanId, type AddRecipeToCookPlanResult, type RecipeSummary } from '@/data';
import { data } from '@/data/app';
import { EmptyState, ListRow, Screen, SectionHeader, Text } from '@/ui';

async function loadAddable(rawId: string) {
  const planId = parseCookPlanId(rawId);
  const [plan, recipes] = await Promise.all([data.getCookPlan(planId), data.listMyRecipes()]);
  const inPlan = new Set(plan?.recipes.map((r) => r.id) ?? []);
  return { planId, recipes: recipes.filter((r) => !inPlan.has(r.id)) };
}

/** Why a Recipe wasn't added, as the screen says it. */
function refusal(status: AddRecipeToCookPlanResult['status']): string | null {
  switch (status) {
    case 'added':
    case 'alreadyAdded':
      return null;
    case 'full':
      return 'A Cook Plan holds 10 Recipes, and this one is full.';
    case 'noSuchRecipe':
      return 'That Recipe isn’t in your library any more.';
    case 'notActive':
      return 'This Cook Plan has been cooked; it can’t change now.';
    case 'notFound':
      return 'You’re not in this Cook Plan any more.';
  }
}

const lines = (recipe: RecipeSummary) => `${recipe.lineCount} ${recipe.lineCount === 1 ? 'ingredient' : 'ingredients'}`;

/** Add one of your Recipes to a Cook Plan: everyone in it can open it and save their own copy. */
export default function AddRecipeToCookPlan() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const [state, reload] = useWhileFocused(() => loadAddable(rawId));
  const [error, setError] = useState<string | null>(null);

  const add = (planId: Parameters<typeof data.addRecipeToCookPlan>[0], recipe: RecipeSummary) => () => {
    setError(null);
    data
      .addRecipeToCookPlan(planId, recipe.id)
      .then(({ status }) => {
        const refused = refusal(status);
        if (refused) {
          setError(refused);
          reload();
        } else router.back();
      })
      .catch((e: unknown) => setError(messageOf(e)));
  };

  const loaded = state.status === 'loaded' ? state.value : null;
  return (
    <Screen title="Add a Recipe" scroll>
      {error ? <Text tone="danger">{error}</Text> : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {loaded && loaded.recipes.length === 0 ? (
        <EmptyState icon="book-outline" title="No Recipes to add" message="Every Recipe in your library is in this plan, or you have none yet." />
      ) : null}
      {loaded && loaded.recipes.length > 0 ? (
        <View testID="addable-recipes">
          <SectionHeader title="Your Recipes" />
          {loaded.recipes.map((recipe) => (
            <ListRow key={recipe.id} title={recipe.title} meta={[lines(recipe)]} onPress={add(loaded.planId, recipe)} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
