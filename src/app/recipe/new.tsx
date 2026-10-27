import { router } from 'expo-router';

import { RecipeForm } from '@/components/recipe-form';
import { data } from '@/data/app';
import { Screen } from '@/ui';

export default function NewRecipe() {
  return (
    <Screen title="New Recipe" scroll>
      <RecipeForm
        submitLabel="Save Recipe"
        onSubmit={async (input) => {
          const id = await data.createRecipe(input);
          router.replace({ pathname: '/recipe/[id]', params: { id } });
        }}
      />
    </Screen>
  );
}
