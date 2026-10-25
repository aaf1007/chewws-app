import { EmptyState, Screen } from '@/ui';

export default function Pantry() {
  return (
    <Screen title="Pantry">
      <EmptyState
        icon="basket-outline"
        title="Your Pantry is empty"
        message="The Ingredients you have at home will show up here, along with Staples like salt, pepper and oil."
      />
    </Screen>
  );
}
