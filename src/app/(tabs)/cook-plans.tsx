import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import {
  PROMPT_MESSAGE,
  cookPlanDetail,
  cookPlanTitle,
  cookedDetail,
  promptStepLabel,
  promptTitle,
  recipeOwnerText,
} from '@/components/cook-plan-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import type { CookPlan, CookPlanId, CookPlanPrompt, CookPlansRead } from '@/data';
import { data } from '@/data/app';
import { useSession } from '@/session';
import { Button, CookedPrompt, EmptyState, ListRow, Screen, SectionHeader, SyncNotice, Text, spacing } from '@/ui';

const startCookPlan = () => router.push('/cook-plan/new');
const openPlan = (id: CookPlanId) => router.push({ pathname: '/cook-plan/[id]', params: { id } });

/** The plans, and the user's prompts for the cooked ones (decisions 18), which need a connection. */
async function load(): Promise<CookPlansRead & { prompts: CookPlanPrompt[] }> {
  const read = await data.readCookPlans();
  const prompts = read.offline ? [] : await data.cookPlanPrompts(read.plans).catch(() => []);
  return { ...read, prompts };
}

/**
 * The Cook Plans the user is in (decisions 14, 18): first a prompt for each cooked plan they
 * haven't logged yet, then the Active plans, newest first, then the Cooked ones (the archive), the
 * most recently cooked first. Each shows as its Recipes' titles, who else is in it and its day.
 * "Start a Cook Plan" makes a new one. With no signal they're the ones the phone last read, said
 * so: cooked plans still open, read-only, and a new one waits for a connection.
 */
export default function CookPlans() {
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [state, reload] = useWhileFocused(load);
  const [error, setError] = useState<string | null>(null);
  const plans = state.status === 'loaded' ? state.value.plans : null;
  const offline = state.status === 'loaded' && state.value.offline;
  const prompts = state.status === 'loaded' ? state.value.prompts : [];
  // The server lists active plans first, then cooked ones, most recently cooked first.
  const active = plans?.filter((plan) => plan.status === 'active') ?? [];
  const cooked = plans?.filter((plan) => plan.status === 'cooked') ?? [];

  const dismiss = (id: CookPlanId) => {
    setError(null);
    data
      .dismissCookPlanPrompt(id)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(reload);
  };

  const row = (plan: CookPlan) => (
    <ListRow
      key={plan.id}
      title={cookPlanTitle(plan)}
      meta={[cookPlanDetail(plan, me), ...(plan.status === 'cooked' ? [cookedDetail(plan, me) ?? ''] : [])]}
      onPress={() => openPlan(plan.id)}
    />
  );

  return (
    <Screen title="Cook Plans" scroll>
      <Button label="Start a Cook Plan" icon="add" onPress={startCookPlan} disabled={offline} testID="start-cook-plan" />
      {offline ? (
        <SyncNotice status="offline" message="You're offline. These are your Cook Plans as they were last loaded." testID="cook-plans-offline" />
      ) : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {error ? <Text tone="danger">{error}</Text> : null}

      {prompts.length > 0 ? (
        <View style={{ gap: spacing.md }} testID="cook-plan-prompts">
          {prompts.map((prompt) => (
            <CookedPrompt
              key={prompt.planId}
              title={promptTitle(prompt)}
              message={PROMPT_MESSAGE}
              onOpen={() => openPlan(prompt.planId)}
              recipes={prompt.recipes.map(({ recipe, step }) => ({
                key: recipe.id,
                title: recipe.title,
                detail: recipeOwnerText(recipe, me),
                ...(step.kind === 'logged'
                  ? { status: 'done', done: promptStepLabel(step) }
                  : {
                      status: 'toDo',
                      action: promptStepLabel(step),
                      onPress: () =>
                        router.push({ pathname: '/cook-plan/[id]/log/[recipeId]', params: { id: prompt.planId, recipeId: recipe.id } }),
                    }),
              }))}
              onDismiss={() => dismiss(prompt.planId)}
              testID="cook-plans-prompt"
            />
          ))}
        </View>
      ) : null}

      {plans && plans.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No Cook Plans yet"
          message="Start one, invite Friends, and choose Recipes to make together."
        />
      ) : null}
      {active.length > 0 ? (
        <View testID="cook-plans">
          <SectionHeader title="Active" />
          {active.map(row)}
        </View>
      ) : null}
      {cooked.length > 0 ? (
        <View testID="cooked-plans">
          <SectionHeader title="Cooked" />
          {cooked.map(row)}
        </View>
      ) : null}
    </Screen>
  );
}
