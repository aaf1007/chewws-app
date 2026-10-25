import { EmptyState, Screen } from '@/ui';

export default function ShoppingList() {
  return (
    <Screen title="Shopping List">
      <EmptyState
        icon="cart-outline"
        title="Your Shopping List is empty"
        message="Ingredients your Recipes need that aren't in your Pantry, plus anything you add by hand, will show up here."
      />
    </Screen>
  );
}
