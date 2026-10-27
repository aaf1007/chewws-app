import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { hasCode, messageOf } from '@/auth/errors';
import { failureMessage, notFoundCopy, sourceText } from '@/components/draft-copy';
import { RecipeForm } from '@/components/recipe-form';
import { SourceVideoLink } from '@/components/source-video';
import { useWhileFocused } from '@/components/use-while-focused';
import { parseRecipeId, type Recipe } from '@/data';
import { data } from '@/data/app';
import { DraftBanner, EmptyState, Screen } from '@/ui';

const stillBuilding = (recipe: Recipe | null) => recipe?.status === 'draft' && recipe.build.status === 'building';

/**
 * Reviewing a Draft: what the Draft builder filled in, to fix and mark reviewed, after which it's a
 * Recipe in the library. While it builds, this waits; a failed build can be tried again or filled
 * in by hand.
 */
export default function ReviewDraft() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const [state, reload] = useWhileFocused(() => data.getRecipe(parseRecipeId(rawId)), {
    keepPolling: stillBuilding,
  });

  if (state.status !== 'loaded' || state.value === null) {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState
            icon="alert-circle-outline"
            title="Draft not found"
            message={state.status === 'error' ? state.message : 'It may have been deleted.'}
          />
        )}
      </Screen>
    );
  }

  const recipe = state.value;
  if (recipe.status === 'reviewed') {
    return <Redirect href={{ pathname: '/recipe/[id]', params: { id: recipe.id } }} />;
  }
  const { build } = recipe;
  const notFound = notFoundCopy(recipe.sourceVideo?.platform);
  const readFrom = recipe.sourceVideo ? sourceText(recipe.sourceVideo.platform) : 'caption';

  const retry = () =>
    data
      .retryDraft(recipe.id)
      .then(reload)
      .catch((e: unknown) => Alert.alert("Couldn't try again", messageOf(e)));

  return (
    <Screen title="Review Draft" scroll>
      {recipe.sourceVideo ? (
        <SourceVideoLink recipeId={recipe.id} video={recipe.sourceVideo} recipeTitle={recipe.title} />
      ) : null}
      {build.status === 'building' ? (
        <DraftBanner
          kind="building"
          title="Building this Draft…"
          message={`Reading the recipe from the ${readFrom}. It’ll be ready in a moment.`}
          testID="draft-building"
        />
      ) : null}
      {build.status === 'failed' ? (
        <DraftBanner
          kind="failed"
          title="Couldn't build this Draft"
          message={`${failureMessage(build.reason, recipe.sourceVideo)} Fill it in by hand below.`}
          actions={build.canRetry ? [{ label: 'Try again', onPress: () => void retry() }] : []}
        />
      ) : null}
      {build.status === 'built' && !recipe.recipeFound ? (
        <DraftBanner kind="notInCaption" title={notFound.title} message={notFound.message} testID="not-in-caption" />
      ) : null}
      {build.status === 'building' ? null : (
        <RecipeForm
          // A Retry that builds it again brings new lines; start the form over from them.
          key={`${recipe.updatedAt}`}
          initial={recipe}
          submitLabel="Mark reviewed"
          onSubmit={async (input) => {
            try {
              await data.reviewDraft(recipe.id, input);
            } catch (e) {
              if (hasCode(e, 'draft_building')) reload();
              throw e;
            }
            router.replace({ pathname: '/recipe/[id]', params: { id: recipe.id } });
          }}
        />
      )}
    </Screen>
  );
}
