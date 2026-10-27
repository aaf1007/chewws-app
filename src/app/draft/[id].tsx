import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { hasCode, messageOf } from '@/auth/errors';
import { CaptionInputs, NOTHING_ADDED, hasAddedCaption, type AddedCaption } from '@/components/caption-inputs';
import { couldNotReadCopy, failureMessage, notFoundCopy, sourceText } from '@/components/draft-copy';
import { RecipeForm } from '@/components/recipe-form';
import { SourceVideoLink } from '@/components/source-video';
import { useWhileFocused } from '@/components/use-while-focused';
import { couldNotReadSource, parseRecipeId, type Recipe, type RecipeId } from '@/data';
import { data } from '@/data/app';
import { Button, DraftBanner, EmptyState, Screen, SectionHeader, Text, spacing } from '@/ui';

const stillBuilding = (recipe: Recipe | null) => recipe?.status === 'draft' && recipe.build.status === 'building';

/**
 * For a source the app couldn't read: the caption to paste or a screenshot to add, and "Build
 * Draft", which builds it again from them (as a Retry).
 */
function AddCaption({ recipeId, page, onAdded }: { recipeId: RecipeId; page: boolean; onAdded: () => void }) {
  const [added, setAdded] = useState<AddedCaption>(NOTHING_ADDED);
  const [state, setState] = useState<{ status: 'ready' | 'sending' } | { status: 'failed'; message: string }>({
    status: 'ready',
  });
  const send = () => {
    setState({ status: 'sending' });
    data
      .addCaptionToDraft(recipeId, { caption: added.caption, screenshot: added.screenshot?.jpeg ?? null })
      .then(onAdded)
      .catch((e: unknown) => setState({ status: 'failed', message: messageOf(e) }));
  };
  return (
    <View style={{ gap: spacing.md }}>
      <CaptionInputs
        value={added}
        onChange={setAdded}
        captionLabel={page ? 'Paste the recipe' : 'Paste caption'}
        placeholder={page ? 'Paste the recipe from the page here' : 'Paste the caption here'}
        disabled={state.status === 'sending'}
      />
      {state.status === 'failed' ? <Text tone="danger">{state.message}</Text> : null}
      <Button
        label={state.status === 'sending' ? 'Building…' : 'Build Draft'}
        icon="sparkles-outline"
        disabled={!hasAddedCaption(added) || state.status === 'sending'}
        onPress={send}
        testID="build-from-caption"
      />
    </View>
  );
}

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
  const couldNotRead = build.status === 'failed' && couldNotReadSource(build.reason);

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
      {build.status === 'failed' && couldNotRead ? (
        <DraftBanner
          kind="couldNotRead"
          {...couldNotReadCopy(build.reason, recipe.sourceVideo, build.canRetry)}
          testID="could-not-read"
        />
      ) : null}
      {build.status === 'failed' && couldNotRead && build.canRetry ? (
        <AddCaption recipeId={recipe.id} page={recipe.sourceVideo?.platform === 'web'} onAdded={reload} />
      ) : null}
      {build.status === 'failed' && !couldNotRead ? (
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
      {couldNotRead && build.status === 'failed' && build.canRetry ? <SectionHeader title="Or fill it in by hand" /> : null}
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
