import type { CookPlan, RecipeCookPlan, UserId } from '@/data';
import { formatDay } from '@/ui';

const handles = (usernames: readonly (string | null)[]) =>
  usernames.flatMap((name) => (name ? [`@${name}`] : [])).join(', ');

/** A Cook Plan has no title (decisions 14): it shows as its Recipes' titles. */
export function cookPlanTitle(plan: CookPlan): string {
  return plan.recipes.length === 0 ? 'No Recipes yet' : plan.recipes.map((r) => r.title).join(', ');
}

/** Who else is in it and its day: "with @sam, @jo · Sat 2 Nov", or "Just you so far". */
export function cookPlanDetail(plan: CookPlan, me: UserId | null): string {
  const others = handles(plan.members.filter((m) => m.id !== me).map((m) => m.username));
  const who = others ? `with ${others}` : 'Just you so far';
  return plan.cookOn ? `${who} · ${formatDay(plan.cookOn)}` : who;
}

/** The warning before deleting a Recipe that's in Cook Plans: "It'll leave your Cook Plan with @sam." */
export function leavesCookPlansWarning(plans: readonly RecipeCookPlan[]): string | null {
  if (plans.length === 0) return null;
  const withWhom = plans.map((plan) => (plan.withUsernames.length > 0 ? ` with ${handles(plan.withUsernames)}` : ''));
  if (plans.length === 1) return `It'll leave your Cook Plan${withWhom[0]}.`;
  const named = withWhom.filter(Boolean).map((w) => w.trim());
  return named.length > 0
    ? `It'll leave your ${plans.length} Cook Plans (${named.join('; ')}).`
    : `It'll leave your ${plans.length} Cook Plans.`;
}
