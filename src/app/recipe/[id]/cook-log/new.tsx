import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { addCookLogProblem } from '@/components/cook-log-copy';
import { CookLogForm } from '@/components/cook-log-form';
import { useRecipe } from '@/components/use-recipe';
import { data } from '@/data/app';
import { EmptyState, Screen, Text } from '@/ui';

export default function AddCookLog() {
  const state = useRecipe(useLocalSearchParams<{ id: string }>().id);
  // One id for every try of this save, so one sent again after no answer isn't a second log.
  const [cookLogId] = useState(() => data.newCookLogId());

  if (state.status !== 'loaded' || state.recipe.status !== 'reviewed') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState
            icon="alert-circle-outline"
            title="Can’t log this Recipe"
            message={state.status === 'missing' ? state.message : 'Only your own reviewed Recipes can be logged.'}
          />
        )}
      </Screen>
    );
  }
  const { recipe } = state;

  return (
    <Screen title="Add Cook Log" scroll>
      <Text tone="textMuted">{recipe.title}</Text>
      <CookLogForm
        submitLabel="Save Cook Log"
        onSubmit={async (input, people) => {
          const problem = addCookLogProblem(await data.addCookLog(recipe.id, input, { cookLogId }), people);
          if (problem) throw new Error(problem);
          router.back();
        }}
      />
    </Screen>
  );
}
