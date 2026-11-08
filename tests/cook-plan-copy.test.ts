// What a Cook Plan list line says about its Claim (src/components/cook-plan-copy.ts). A checked-off
// line is bought, so it stops saying who's buying it; its Claim stays, and shows again once unchecked
// (user decision 4, 2026-11-08).
import { expect, test } from 'vitest';

import { claimText } from '@/components/cook-plan-copy';
import type { CheckState, ClaimState, CookPlanList, CookPlanListItem } from '@/data';
import { parseCookPlanId, parseCookPlanItemId, parseUserId } from '@/data';
import { parseIngredientId } from '@/data/types';

const me = parseUserId('00000000-0000-4000-8000-000000000001');
const jo = parseUserId('00000000-0000-4000-8000-000000000002');

const line = (claim: ClaimState, check: CheckState): CookPlanListItem => ({
  id: parseCookPlanItemId('00000000-0000-4000-8000-0000000000a1'),
  ingredient: { id: parseIngredientId('00000000-0000-4000-8000-0000000000b1'), name: 'garlic' },
  recipes: [],
  whoHas: [],
  claim,
  check,
});

const listOf = (item: CookPlanListItem): CookPlanList => ({
  planId: parseCookPlanId('00000000-0000-4000-8000-0000000000c1'),
  status: 'active',
  members: [
    { id: me, username: 'dev' },
    { id: jo, username: 'jo' },
  ],
  items: [item],
});

const claimedBy = (who: typeof me): ClaimState => ({ status: 'claimed', claimedAt: '2026-11-08T10:00:00Z', claimedBy: who });
const unchecked: CheckState = { status: 'unchecked' };
const checkedBy = (who: typeof me): CheckState => ({ status: 'checked', checkedAt: '2026-11-08T11:00:00Z', checkedBy: who });

const textFor = (claim: ClaimState, check: CheckState) => {
  const item = line(claim, check);
  return claimText(item, listOf(item), me);
};

test("an unchecked line says who's buying it", () => {
  expect(textFor(claimedBy(me), unchecked)).toBe("You're buying it");
  expect(textFor(claimedBy(jo), unchecked)).toBe('@jo is buying it');
  expect(textFor({ status: 'unclaimed' }, unchecked)).toBeNull();
});

test("a checked-off line stops saying who's buying it, whoever claimed or checked it", () => {
  expect(textFor(claimedBy(me), checkedBy(me))).toBeNull();
  expect(textFor(claimedBy(jo), checkedBy(me))).toBeNull();
  expect(textFor(claimedBy(me), checkedBy(jo))).toBeNull();
  expect(textFor(claimedBy(jo), checkedBy(jo))).toBeNull();
});

test('unchecked again, the Claim it kept shows again', () => {
  const claim = claimedBy(jo);
  expect(textFor(claim, checkedBy(me))).toBeNull();
  expect(textFor(claim, unchecked)).toBe('@jo is buying it');
});
