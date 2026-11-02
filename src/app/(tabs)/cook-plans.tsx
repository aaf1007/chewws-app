import { router } from 'expo-router';
import { View } from 'react-native';

import { cookPlanDetail, cookPlanTitle } from '@/components/cook-plan-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import { data } from '@/data/app';
import { useSession } from '@/session';
import { Button, EmptyState, ListRow, Screen, SectionHeader, SyncNotice, Text } from '@/ui';

const startCookPlan = () => router.push('/cook-plan/new');

/**
 * The Cook Plans the user is in (decisions 14), newest first: each shows as its Recipes' titles,
 * who else is in it and its day. "Start a Cook Plan" makes a new one. With no signal they're the
 * ones the phone last read, said so, and a new one waits for a connection.
 */
export default function CookPlans() {
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [state] = useWhileFocused(() => data.readCookPlans());
  const plans = state.status === 'loaded' ? state.value.plans : null;
  const offline = state.status === 'loaded' && state.value.offline;
  const active = plans?.filter((plan) => plan.status === 'active') ?? [];

  return (
    <Screen title="Cook Plans" scroll>
      <Button label="Start a Cook Plan" icon="add" onPress={startCookPlan} disabled={offline} testID="start-cook-plan" />
      {offline ? (
        <SyncNotice status="offline" message="You're offline. These are your Cook Plans as they were last loaded." testID="cook-plans-offline" />
      ) : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {plans && active.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No Cook Plans yet"
          message="Start one, invite Friends, and choose Recipes to make together."
        />
      ) : null}
      {active.length > 0 ? (
        <View testID="cook-plans">
          <SectionHeader title="Active" />
          {active.map((plan) => (
            <ListRow
              key={plan.id}
              title={cookPlanTitle(plan)}
              meta={[cookPlanDetail(plan, me)]}
              onPress={() => router.push({ pathname: '/cook-plan/[id]', params: { id: plan.id } })}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
