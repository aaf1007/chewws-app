import type { AddCookLogResult, EditCookLogResult, UserId } from '@/data';
import { formatDay } from '@/ui';

/** Someone by username as the form knows them, for "@sam isn't your Friend any more". */
type Known = readonly { id: UserId; username: string | null }[];

const handle = (people: Known, id: UserId) => {
  const username = people.find((p) => p.id === id)?.username;
  return username ? `@${username}` : 'Someone you picked';
};

/** What to tell the user when adding a Cook Log didn't save it; null when it did. */
export function addCookLogProblem(result: AddCookLogResult, people: Known): string | null {
  switch (result.status) {
    case 'added':
      return null;
    case 'noSuchRecipe':
      return 'This Recipe isn’t in your library any more.';
    case 'notReviewed':
      return 'Review this Draft first, then log it.';
    case 'noSuchCookPlan':
      return 'You’re not in that Cook Plan any more.';
    case 'notCompanion':
      return `${handle(people, result.userId)} isn’t your Friend any more. Take them off and save again.`;
  }
}

/** What to tell the user when editing a Cook Log didn't change it; null when it did. */
export function editCookLogProblem(result: EditCookLogResult, people: Known): string | null {
  switch (result.status) {
    case 'edited':
      return null;
    case 'notFound':
      return 'This Cook Log was deleted.';
    case 'tooManyPhotos':
      return 'A Cook Log can have at most 4 photos, and it has more now. Remove one and save again.';
    case 'notCompanion':
      return `${handle(people, result.userId)} isn’t your Friend any more. Take them off and save again.`;
  }
}

/** "Cooked 3 times · last Sat 2 Nov", for a Cooked Recipe in the Library. */
export function cookedDetail(cooked: { count: number; lastCookedOn: string }): string {
  const times = cooked.count === 1 ? 'Cooked once' : `Cooked ${cooked.count} times`;
  return `${times} · last ${formatDay(cooked.lastCookedOn)}`;
}
