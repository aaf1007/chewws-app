import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { checkedOffText, claimText, planAmountsText, whoHasText } from '@/components/cook-plan-copy';
import { changesNotSavedMessage, notSavedMessage, syncNoticeOf } from '@/components/list-sync-copy';
import { parseCookPlanId, type CookPlanId, type CookPlanList, type CookPlanListItem, type CookPlanListView } from '@/data';
import { data } from '@/data/app';
import { useSession } from '@/session';
import { EmptyState, Screen, SectionHeader, ShoppingListRow, SyncNotice, Text, type ListLineNote } from '@/ui';

const loading: CookPlanListView = { status: 'loading', sync: { status: 'idle', waiting: 0 }, notSaved: [] };

function planIdOf(raw: string): CookPlanId | null {
  try {
    return parseCookPlanId(raw);
  } catch {
    return null;
  }
}

/**
 * A Cook Plan's list (decisions 15): one line per Ingredient its Recipes need, each Recipe's amounts
 * apart, who in the plan already has it, and who is buying it. Any member Claims a line ("I'm
 * buying it") or unclaims their own, and checks lines off; what they check off goes in their own
 * Pantry. Works with no signal, as the Shopping List does, and shows what others change as they do.
 */
export default function CookPlanListScreen() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const planId = planIdOf(rawId);
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [state, setState] = useState<CookPlanListView>(loading);
  const [changeError, setChangeError] = useState<string | null>(null);

  // The list as the phone has it, updated on every change (sent or still waiting for a signal),
  // whenever it's read, and whenever anyone in the plan changes it, while this screen is open.
  useFocusEffect(
    useCallback(() => {
      if (!planId) return undefined;
      setState(loading);
      return data.watchCookPlanList(planId, setState);
    }, [planId]),
  );

  if (!planId) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Cook Plan not found" message="This link doesn't open a Cook Plan." />
      </Screen>
    );
  }

  /** Makes a change; the list shows it as it happens. If it fails, says why. */
  const change = (run: () => Promise<unknown>) => () => {
    setChangeError(null);
    run().catch((e: unknown) => setChangeError(messageOf(e)));
  };

  const list = state.status === 'loaded' ? state.list : null;
  const active = list?.status === 'active';

  const row = (item: CookPlanListItem, plan: CookPlanList) => {
    const checked = item.check.status === 'checked';
    const mine = item.claim.status === 'claimed' && item.claim.claimedBy === me;
    const has = whoHasText(item, me);
    const claim = claimText(item, plan, me);
    const checkedBy = checkedOffText(item, plan, me);
    const notes: ListLineNote[] = [
      ...(has ? [{ icon: 'home-outline' as const, text: has }] : []),
      ...(claim ? [{ icon: 'hand-left-outline' as const, text: claim, mine }] : []),
    ];
    return (
      <ShoppingListRow
        key={item.id}
        name={item.ingredient.name}
        details={checkedBy ? [...planAmountsText(item), checkedBy] : planAmountsText(item)}
        notes={notes}
        check={{
          checked,
          onPress: change(() => (checked ? data.uncheckCookPlanItem(planId, item.id) : data.checkOffCookPlanItem(planId, item.id))),
        }}
        // Once cooked (ticket 18) Claims are over; only checking off and unchecking still work.
        action={
          !active || checked
            ? undefined
            : mine
              ? { label: 'Unclaim', onPress: change(() => data.unclaim(planId, item.id)) }
              : { label: 'Claim', onPress: change(() => data.claim(planId, item.id)) }
        }
      />
    );
  };

  const notice = state.status === 'loaded' || state.status === 'loading' ? syncNoticeOf(state.sync, 'This is the list as it was last loaded.') : null;
  const items = list?.items ?? [];
  const toBuy = items.filter((item) => item.check.status === 'unchecked');
  const checkedOff = items.filter((item) => item.check.status === 'checked');

  return (
    <Screen title="Cook Plan list" scroll>
      {state.status === 'gone' ? (
        <SyncNotice
          status="notSaved"
          message={`You're not in this Cook Plan any more.${changesNotSavedMessage(state.changesNotSaved)}`}
          action={{
            label: 'OK',
            onPress: () => {
              void data.dismissCookPlanGone(planId);
              router.back();
            },
          }}
          testID="cook-plan-list-gone"
        />
      ) : null}
      {notice ? <SyncNotice status={notice.status} message={notice.message} testID="cook-plan-list-sync" /> : null}
      {state.notSaved.map((notSaved, i) => (
        <SyncNotice
          key={i}
          status="notSaved"
          message={notSavedMessage(notSaved)}
          action={i === state.notSaved.length - 1 ? { label: 'OK', onPress: () => void data.dismissNotSavedListChanges() } : undefined}
          testID="cook-plan-list-not-saved"
        />
      ))}
      {list?.status === 'cooked' ? (
        <Text tone="textMuted" testID="cook-plan-list-cooked">
          This Cook Plan has been cooked, so Claims are over. You can still check things off.
        </Text>
      ) : null}
      {changeError ? <Text tone="danger">{changeError}</Text> : null}
      {state.status === 'failed' ? <Text tone="danger">{state.error.message}</Text> : null}

      {list && items.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Nothing to buy yet"
          message="Add a Recipe to the plan, and every Ingredient it needs shows here."
        />
      ) : null}

      {list && toBuy.length > 0 ? (
        <View testID="cook-plan-list-to-buy">
          <SectionHeader title="To buy" />
          {active ? (
            <Text variant="caption" tone="textMuted">
              {"Claim what you'll buy, so nobody else buys it too."}
            </Text>
          ) : null}
          {toBuy.map((item) => row(item, list))}
        </View>
      ) : null}

      {list && checkedOff.length > 0 ? (
        <View testID="cook-plan-list-checked-off">
          <SectionHeader title="Checked off" />
          <Text variant="caption" tone="textMuted">
            What you check off goes in your Pantry.
          </Text>
          {checkedOff.map((item) => row(item, list))}
        </View>
      ) : null}
    </Screen>
  );
}
