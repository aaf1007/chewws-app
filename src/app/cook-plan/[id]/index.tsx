import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { hasCode, messageOf } from '@/auth/errors';
import { cookPlanDetail, cookPlanTitle } from '@/components/cook-plan-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import {
  parseCookPlanId,
  type CookPlan,
  type CookPlanListView,
  type CookPlanMember,
  type CookPlanRecipe,
  type UserId,
} from '@/data';
import { data } from '@/data/app';
import { useSession } from '@/session';
import { Button, DayPicker, EmptyState, ListRow, NavRow, PersonRow, Screen, SectionHeader, Text, spacing } from '@/ui';

async function loadPlan(rawId: string): Promise<CookPlan | null> {
  try {
    return await data.getCookPlan(parseCookPlanId(rawId));
  } catch (e) {
    if (hasCode(e, 'invalid_cook_plan_id')) return null;
    throw e;
  }
}

/** Who someone in the plan is to the user: "You", who started it, or who invited them. */
function memberDetail(member: CookPlanMember, members: CookPlanMember[], me: UserId | null): string {
  const you = member.id === me;
  if (member.invitedBy === null) return you ? 'You started this plan' : 'Started this plan';
  const inviter = members.find((m) => m.id === member.invitedBy);
  const by = member.invitedBy === me ? 'you' : inviter?.username ? `@${inviter.username}` : 'someone who has left';
  return you ? `You, invited by ${by}` : `Invited by ${by}`;
}

const recipeDetail = (recipe: CookPlanRecipe, me: UserId | null) =>
  recipe.owner.id === me ? 'Yours' : recipe.owner.username ? `@${recipe.owner.username}'s` : 'Someone else’s';

/** "3 to buy · 1 claimed by you": what's left on the plan's list, once it has been read. */
function listDetail(view: CookPlanListView | null, me: UserId | null): string {
  if (view?.status !== 'loaded') return 'Who has what, and who is buying it';
  const toBuy = view.list.items.filter((i) => i.check.status === 'unchecked');
  if (view.list.items.length === 0) return 'Nothing to buy yet';
  if (toBuy.length === 0) return 'Everything is checked off';
  const mine = toBuy.filter((i) => i.claim.status === 'claimed' && i.claim.claimedBy === me).length;
  return mine > 0 ? `${toBuy.length} to buy · ${mine} claimed by you` : `${toBuy.length} to buy`;
}

/**
 * One Cook Plan (decisions 14): its day, which any member sets or clears; its Recipes, each opened
 * by any member, added by their owners and removed by anyone; its list (decisions 15); and who is
 * in it, with "Invite" for more of your Friends. Anyone can leave; the plan goes with its last
 * member. While it's open, anyone's change to the plan shows at once.
 */
export default function CookPlanScreen() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [state, reload] = useWhileFocused(() => loadPlan(rawId));
  const [error, setError] = useState<string | null>(null);
  const [listView, setListView] = useState<CookPlanListView | null>(null);
  const loadedId = state.status === 'loaded' ? state.value?.id : undefined;

  // The plan's list, which the server says has changed whenever anyone changes the plan, its
  // Recipes, its members or its lines (decisions 15): each new read of it reads the plan again too.
  useFocusEffect(
    useCallback(() => {
      if (!loadedId) return undefined;
      let seen: CookPlanListView | null = null;
      return data.watchCookPlanList(loadedId, (view) => {
        setListView(view);
        const changed = view.status === 'loaded' && seen?.status === 'loaded' && view.list !== seen.list;
        // With no signal the plan can't be read; its list still shows the changes made here.
        if (changed && view.sync.status !== 'offline') reload();
        seen = view;
      });
      // reload is a new function each render; it only bumps a counter.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadedId]),
  );

  const plan = state.status === 'loaded' ? state.value : null;
  if (!plan) {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState
            icon="alert-circle-outline"
            title="Cook Plan not found"
            message={state.status === 'error' ? state.message : "You're not in it, or it has ended."}
          />
        )}
      </Screen>
    );
  }

  /** Runs a change, says why it was refused if it was, then shows the plan as it is now. */
  const change = (run: () => Promise<string | null>) => {
    setError(null);
    run()
      .then((refused) => refused && setError(refused))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(reload);
  };
  const notActive = 'This Cook Plan has been cooked; it can’t change now.';

  const setDay = (day: string | null) =>
    change(async () => {
      const { status } = await data.setCookPlanDate(plan.id, day);
      return status === 'set' ? null : status === 'notActive' ? notActive : 'You’re not in this Cook Plan any more.';
    });

  const removeRecipe = (recipe: CookPlanRecipe) =>
    Alert.alert(recipe.title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove from Cook Plan',
        style: 'destructive',
        onPress: () =>
          change(async () => {
            const { status } = await data.removeRecipeFromCookPlan(plan.id, recipe.id);
            return status === 'removed' || status === 'notInPlan' ? null : status === 'notActive' ? notActive : 'You’re not in this Cook Plan any more.';
          }),
      },
    ]);

  const leave = () =>
    Alert.alert('Leave this Cook Plan?', plan.members.length === 1 ? 'You’re the last one in it, so it ends.' : 'The others keep it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () =>
          data
            .leaveCookPlan(plan.id)
            .then(() => router.back())
            .catch((e: unknown) => setError(messageOf(e))),
      },
    ]);

  const active = plan.status === 'active';
  const params = { id: plan.id };
  return (
    <Screen title="Cook Plan" scroll>
      <Text tone="textMuted" testID="cook-plan-detail">
        {cookPlanDetail(plan, me)}
      </Text>
      {error ? <Text tone="danger">{error}</Text> : null}

      {active ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="When" />
          <DayPicker value={plan.cookOn} onChange={setDay} testID="cook-plan-day" />
        </View>
      ) : null}

      <View testID="cook-plan-recipes">
        <SectionHeader
          title="Recipes"
          action={active ? { label: 'Add a Recipe', onPress: () => router.push({ pathname: '/cook-plan/[id]/add-recipe', params }) } : undefined}
        />
        {plan.recipes.length === 0 ? (
          <Text tone="textMuted">{cookPlanTitle(plan)}. Add one of yours; everyone in the plan can open it.</Text>
        ) : (
          plan.recipes.map((recipe) => (
            <ListRow
              key={recipe.id}
              title={recipe.title}
              meta={[recipeDetail(recipe, me)]}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: recipe.id } })}
              onMore={active ? () => removeRecipe(recipe) : undefined}
            />
          ))
        )}
      </View>

      <NavRow
        icon="cart-outline"
        label="Cook Plan list"
        detail={listDetail(listView, me)}
        onPress={() => router.push({ pathname: '/cook-plan/[id]/list', params })}
        testID="cook-plan-list"
      />

      <View>
        <SectionHeader
          title="Who’s cooking"
          action={active ? { label: 'Invite Friends', onPress: () => router.push({ pathname: '/cook-plan/[id]/invite', params }) } : undefined}
        />
        {plan.members.map((member) => (
          <PersonRow
            key={member.id}
            username={member.username ?? 'someone'}
            detail={memberDetail(member, plan.members, me)}
          />
        ))}
      </View>

      <Button label="Leave Cook Plan" variant="danger" icon="exit-outline" onPress={leave} />
    </Screen>
  );
}
