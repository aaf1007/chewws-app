import { router, useLocalSearchParams } from 'expo-router';

import { RecipeForm } from '@/components/recipe-form';
import { useRecipe } from '@/components/use-recipe';
import { data } from '@/data/app';
import { EmptyState, Screen } from '@/ui';

export default function EditRecipe() {
  const state = useRecipe(useLocalSearchParams<{ id: string }>().id);

  if (state.status !== 'loaded') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState icon="alert-circle-outline" title="Recipe not found" message={state.message} />
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Edit Recipe" scroll>
      <RecipeForm
        initial={state.recipe}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await data.editRecipe(state.recipe.id, input);
          router.back();
        }}
      />
    </Screen>
  );
}
