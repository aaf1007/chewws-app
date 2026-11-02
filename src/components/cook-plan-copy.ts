import type { CookPlan, CookPlanList, CookPlanListItem, RecipeCookPlan, UserId } from '@/data';
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

// The Cook Plan list (decisions 15) ------------------------------------------------------------

/** "@sam", or "a former member" for someone no longer in the plan (or with no username yet). */
function memberName(list: CookPlanList, who: UserId | null): string {
  const username = list.members.find((m) => m.id === who)?.username;
  return username ? `@${username}` : 'a former member';
}

/** "A and B", "A, B and C". */
const andList = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Who already has a line's Ingredient: "@sam has it", "You and @jo have it"; null for nobody. */
export function whoHasText(item: CookPlanListItem, me: UserId | null): string | null {
  const people = [...item.whoHas].sort((a, b) => Number(b.id === me) - Number(a.id === me));
  if (people.length === 0) return null;
  const names = people.map((p) => (p.id === me ? 'You' : p.username ? `@${p.username}` : 'someone'));
  const one = people.length === 1 && people[0].id !== me;
  return `${andList(names)} ${one ? 'has' : 'have'} it`;
}

/** Who Claimed a line: "You're buying it", "@jo is buying it"; null when nobody has. */
export function claimText(item: CookPlanListItem, list: CookPlanList, me: UserId | null): string | null {
  if (item.claim.status !== 'claimed') return null;
  const { claimedBy } = item.claim;
  if (claimedBy !== null && claimedBy === me) return "You're buying it";
  const name = memberName(list, claimedBy);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} is buying it`;
}

/** Who checked a line off: "Checked off by you", "Checked off by @sam"; null while unchecked. */
export function checkedOffText(item: CookPlanListItem, list: CookPlanList, me: UserId | null): string | null {
  if (item.check.status !== 'checked') return null;
  const { checkedBy } = item.check;
  return `Checked off by ${checkedBy !== null && checkedBy === me ? 'you' : memberName(list, checkedBy)}`;
}

/** Each Recipe's amounts on a line: "Garlic bread · 2 cloves", "Shakshuka (removed) · 1 tin". */
export const planAmountsText = (item: CookPlanListItem) =>
  item.recipes.map(({ recipe, amountTexts }) => {
    const title = recipe.status === 'removed' ? `${recipe.title} (removed)` : recipe.title;
    return amountTexts.length > 0 ? `${title} · ${amountTexts.join(', ')}` : title;
  });
