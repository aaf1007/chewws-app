import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { BANDS, bandLabel, placeLabel } from '@/components/ranking-copy';
import { useRecipe } from '@/components/use-recipe';
import type { RankingBand, RankingSession, RecipeId } from '@/data';
import { data } from '@/data/app';
import { BandPicker, Button, ComparisonCard, EmptyState, ScoreBadge, Screen, Text, spacing } from '@/ui';

type Step =
  | { kind: 'band' }
  | { kind: 'working'; band: RankingBand }
  | { kind: 'comparing'; session: Extract<RankingSession, { status: 'comparing' }> }
  | { kind: 'placed'; band: RankingBand; position: number; score: number }
  | { kind: 'refused'; title: string; message: string };

/**
 * Ranks one of the user's Cooked Recipes (decisions 17): pick a band, then answer "better or worse
 * than X?" until its place is found, or Skip to put it in the middle. Re-ranking is the same. If
 * another phone changed the band meanwhile, the comparisons start again. Leaving half-way ranks
 * nothing.
 */
export default function RankRecipe() {
  const state = useRecipe(useLocalSearchParams<{ id: string }>().id);
  const [step, setStep] = useState<Step>({ kind: 'band' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'loaded' || state.recipe.status !== 'reviewed') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState
            icon="alert-circle-outline"
            title="Can’t rank this Recipe"
            message={state.status === 'missing' ? state.message : 'Only your own Recipes can be ranked.'}
          />
        )}
      </Screen>
    );
  }
  const { recipe } = state;

  const failed = (e: unknown) => {
    setError(messageOf(e));
    setStep({ kind: 'band' });
  };

  function start(id: RecipeId, band: RankingBand) {
    setError(null);
    setStep({ kind: 'working', band });
    data.startRanking(id, band).then(settle).catch(failed);
  }

  /** Places the Recipe where a finished session put it, or carries on comparing. */
  function settle(session: RankingSession) {
    if (session.status === 'comparing') {
      setStep({ kind: 'comparing', session });
      return;
    }
    setStep({ kind: 'working', band: session.band });
    data
      .placeInRanking(session)
      .then((placed) => {
        if (placed.status === 'placed') {
          setStep({ kind: 'placed', band: placed.band, position: placed.position, score: placed.score });
        } else if (placed.status === 'bandChanged') {
          setNotice('Your Ranking changed on another phone, so compare again.');
          start(recipe.id, session.band);
        } else if (placed.status === 'notCooked') {
          setStep({ kind: 'refused', title: 'Not cooked yet', message: 'Add a Cook Log first: only Recipes you’ve cooked are ranked.' });
        } else {
          setStep({ kind: 'refused', title: 'Recipe not found', message: 'It may have been deleted.' });
        }
      })
      .catch(failed);
  }

  if (step.kind === 'refused') {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title={step.title} message={step.message} />
      </Screen>
    );
  }

  if (step.kind === 'placed') {
    return (
      <Screen title="Ranked" scroll>
        <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
          <ScoreBadge score={step.score} tone="mine" />
          <Text variant="title">{recipe.title}</Text>
          <Text tone="textMuted">{placeLabel(step.band, step.position)}</Text>
        </View>
        <Button label="Done" onPress={() => router.back()} testID="ranking-done" />
        <Button label="See your Ranking" variant="outlined" icon="podium-outline" onPress={() => router.replace('/ranking')} />
      </Screen>
    );
  }

  return (
    <Screen title="Rank it" scroll>
      <Text tone="textMuted">{recipe.title}</Text>
      {notice ? <Text tone="textMuted">{notice}</Text> : null}
      {error ? <Text tone="danger">{error}</Text> : null}
      {step.kind === 'comparing' ? (
        <>
          <Text variant="headline">{bandLabel(step.session.band)}</Text>
          <ComparisonCard
            title={step.session.against.title}
            step={`Comparison ${step.session.asked + 1}`}
            onBetter={() => settle(data.answerComparison(step.session, 'better'))}
            onWorse={() => settle(data.answerComparison(step.session, 'worse'))}
          />
          <Button
            label="Skip"
            variant="plain"
            onPress={() => settle(data.skipComparisons(step.session))}
            testID="skip-comparisons"
          />
        </>
      ) : (
        <>
          <Text variant="headline">How was it?</Text>
          <BandPicker bands={BANDS} disabled={step.kind === 'working'} onPick={(band) => start(recipe.id, band)} />
        </>
      )}
    </Screen>
  );
}
