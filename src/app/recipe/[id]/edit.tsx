import { router, useLocalSearchParams } from 'expo-router';

import { RecipeForm } from '@/components/recipe-form';
import { useRecipe } from '@/components/use-recipe';
import { data } from '@/data/app';
import { EmptyState, Screen } from '@/ui';

export default function EditRecipe() {
  const state = useRecipe(useLocalSearchParams<{ id: string }>().id);

  // Someone else's Recipe (one in a Cook Plan) is theirs to edit; you edit your own copy.
  if (state.status !== 'loaded' || state.recipe.status === 'someoneElses') {
    return (
      <Screen>
        {state.status === 'loading' ? null : state.status === 'loaded' ? (
          <EmptyState icon="alert-circle-outline" title="Not your Recipe" message="Save your own copy to change it." />
        ) : (
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
