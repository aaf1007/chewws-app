import { hasCode } from '@/auth/errors';
import type { CookPlan, CookPlanPrompt } from '@/data';
import { data } from '@/data/app';

/**
 * The user's prompts for these plans (decisions 18). They need a connection: with no signal there
 * are none to show, and the plans still open; any other failure is the screen's error.
 */
export async function cookPlanPromptsFor(plans: CookPlan[], offline: boolean): Promise<CookPlanPrompt[]> {
  if (offline) return [];
  try {
    return await data.cookPlanPrompts(plans);
  } catch (e) {
    if (hasCode(e, 'offline')) return [];
    throw e;
  }
}
