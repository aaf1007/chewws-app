import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { addCookLogProblem } from '@/components/cook-log-copy';
import { CookLogForm } from '@/components/cook-log-form';
import { recipeOwnerText } from '@/components/cook-plan-copy';
import { parseCookPlanId, type CookPlanPrompt, type CookPlanRecipe, type RecipeId } from '@/data';
import { data } from '@/data/app';
import { useSession } from '@/session';
import { Button, EmptyState, Screen, Text, spacing } from '@/ui';

type Step =
  | { kind: 'loading' }
  | { kind: 'missing'; title: string; message: string }
  /** Someone else's Recipe with no copy of the user's yet: "Save your copy first". */
  | { kind: 'copyFirst'; prompt: CookPlanPrompt; recipe: CookPlanRecipe; saving: boolean; error: string | null }
  /** The Cook Log form, for the user's own Recipe or their copy (`logOn`). */
  | { kind: 'form'; prompt: CookPlanPrompt; recipe: CookPlanRecipe; logOn: RecipeId }
  /** Saved: "Rank it", or Skip. */
  | { kind: 'logged'; recipe: CookPlanRecipe; logOn: RecipeId };

/** Loads what the plan's prompt offers for this Recipe, as the step to show. */
async function load(rawPlanId: string, recipeId: string): Promise<Step> {
  const plan = await data.getCookPlan(parseCookPlanId(rawPlanId));
  const [prompt] = plan ? await data.cookPlanPrompts([plan]) : [];
  const entry = prompt?.recipes.find((r) => r.recipe.id === recipeId);
  if (!prompt || !entry || entry.step.kind === 'logged') {
    return { kind: 'missing', title: 'Nothing to log', message: 'You’ve logged this Recipe from the plan already, or it has left the plan.' };
  }
  const { recipe, step } = entry;
  if (step.kind === 'saveYourCopy') return { kind: 'copyFirst', prompt, recipe, saving: false, error: null };
  return { kind: 'form', prompt, recipe, logOn: step.kind === 'useYourCopy' ? step.copyId : recipe.id };
}

/**
 * Logging one of a cooked Cook Plan's Recipes from its prompt (decisions 18). Someone else's Recipe
 * is logged on the user's own copy: "Save your copy first" makes one (or the copy they have is
 * used), so the Cook Log and Ranking are theirs. The form starts with the plan's day and everyone
 * else in it. Once saved, "Rank it" opens the band picker, or Skip. Every step can be left.
 */
export default function LogFromCookPlan() {
  const { id, recipeId } = useLocalSearchParams<{ id: string; recipeId: string }>();
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  // One id for every try of this save, so one sent again after no answer isn't a second log.
  const [cookLogId] = useState(() => data.newCookLogId());

  useEffect(() => {
    let live = true;
    load(id, recipeId)
      .then((loaded) => live && setStep(loaded))
      .catch((e: unknown) => live && setStep({ kind: 'missing', title: 'Can’t log this Recipe', message: messageOf(e) }));
    return () => {
      live = false;
    };
  }, [id, recipeId]);

  if (step.kind === 'loading' || step.kind === 'missing') {
    return (
      <Screen>
        {step.kind === 'missing' ? <EmptyState icon="alert-circle-outline" title={step.title} message={step.message} /> : null}
      </Screen>
    );
  }

  if (step.kind === 'copyFirst') {
    const { prompt, recipe } = step;
    const saveCopy = () => {
      setStep({ ...step, saving: true, error: null });
      data
        .copyRecipe(recipe.id)
        .then((copied) =>
          setStep(
            copied.status === 'copied'
              ? { kind: 'form', prompt, recipe, logOn: copied.recipeId }
              : { kind: 'missing', title: 'Recipe not found', message: 'It may have been deleted, or left the plan.' },
          ),
        )
        .catch((e: unknown) => setStep({ ...step, saving: false, error: messageOf(e) }));
    };
    return (
      <Screen title="Save your copy first" scroll>
        <View style={{ gap: spacing.sm }} testID="save-your-copy-first">
          <Text variant="headline">{recipe.title}</Text>
          <Text tone="textMuted">{recipeOwnerText(recipe, me)}</Text>
        </View>
        <Text>
          To log a Recipe that isn’t yours, save your own copy first. Your Cook Log and Ranking go on your copy, in your
          Library; changing or deleting either never touches the other.
        </Text>
        {step.error ? <Text tone="danger">{step.error}</Text> : null}
        <Button
          label={step.saving ? 'Saving…' : 'Save your copy'}
          icon="copy-outline"
          disabled={step.saving}
          onPress={saveCopy}
          testID="save-your-copy"
        />
        <Button label="Not now" variant="plain" onPress={() => router.back()} testID="copy-not-now" />
      </Screen>
    );
  }

  if (step.kind === 'logged') {
    const { recipe, logOn } = step;
    return (
      <Screen title="Logged" scroll>
        <View style={{ gap: spacing.sm }}>
          <Text variant="headline">{recipe.title}</Text>
          <Text tone="textMuted">Rank it against the other Recipes you’ve cooked? You can do it later from the Recipe.</Text>
        </View>
        <Button
          label="Rank it"
          icon="podium-outline"
          onPress={() => router.replace({ pathname: '/recipe/[id]/rank', params: { id: logOn } })}
          testID="prompt-rank-it"
        />
        <Button label="Skip" variant="plain" onPress={() => router.back()} testID="prompt-skip-ranking" />
      </Screen>
    );
  }

  const { prompt, recipe, logOn } = step;
  return (
    <Screen title="Add Cook Log" scroll>
      <Text tone="textMuted">{logOn === recipe.id ? recipe.title : `${recipe.title} (your copy)`}</Text>
      <CookLogForm
        prefill={{ cookedOn: prompt.cookedOn, companions: prompt.companions }}
        submitLabel="Save Cook Log"
        onSubmit={async (input, people) => {
          const problem = addCookLogProblem(await data.addCookLog(logOn, input, { cookLogId, cookPlanId: prompt.planId }), people);
          if (problem) throw new Error(problem);
          setStep({ kind: 'logged', recipe, logOn });
        }}
      />
    </Screen>
  );
}
