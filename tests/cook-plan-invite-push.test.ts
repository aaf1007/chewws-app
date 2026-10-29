// Ticket 14: the notify function's "Cook Plan invite" kick, and the push as Expo gets it (over a
// fake fetch, no network); and the app reading a tapped one back to the plan it opens.
import { expect, test } from 'vitest';

import { parseCookPlanInvitePush } from '../src/data';
import { parseNotifyRequest } from '../supabase/functions/_shared/notifier';
import { cookPlanInviteMessages, expoPushSender } from '../supabase/functions/_shared/push-sender';

const USER = '0b4a1d2e-3f40-4c5d-8e6f-708192a3b4c5';
const PLAN = '6f1e2d3c-4b5a-4968-8776-655443322110';

test('notify accepts a Cook Plan invite kick naming a plan and a user, and nothing short of that', () => {
  expect(parseNotifyRequest({ kind: 'cookPlanInvite', cookPlanId: PLAN, toUserId: USER, extra: 1 })).toEqual({
    kind: 'cookPlanInvite',
    cookPlanId: PLAN,
    toUserId: USER,
  });
  for (const body of [
    { kind: 'cookPlanInvite', cookPlanId: PLAN },
    { kind: 'cookPlanInvite', toUserId: USER },
    { kind: 'cookPlanInvite', cookPlanId: 'not-a-uuid', toUserId: USER },
    { kind: 'cookPlanInvite', cookPlanId: PLAN, toUserId: `${USER} ` },
    { kind: 'cookPlanInvites', cookPlanId: PLAN, toUserId: USER },
  ]) {
    expect(parseNotifyRequest(body), JSON.stringify(body)).toBeNull();
  }
});

test('"Cook Plan invite" goes to Expo as "@name invited you to cook", with the Recipes and the plan to open', async () => {
  const sent: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const batch: unknown = JSON.parse(String(init?.body));
    sent.push(batch);
    return Response.json({ data: Array.isArray(batch) ? batch.map(() => ({ status: 'ok' })) : [] });
  };

  await expoPushSender(fetch)(
    [
      ...cookPlanInviteMessages(PLAN, 'alex', ['Shakshuka', "Jo's flatbread"], ['ExponentPushToken[a]']),
      ...cookPlanInviteMessages(PLAN, 'alex', [], ['ExponentPushToken[b]']),
    ],
    new AbortController().signal,
  );

  expect(sent).toEqual([
    [
      {
        to: 'ExponentPushToken[a]',
        title: 'Cook Plan invite',
        body: "@alex invited you to cook: Shakshuka, Jo's flatbread",
        data: { kind: 'cookPlanInvite', cookPlanId: PLAN },
      },
      {
        to: 'ExponentPushToken[b]',
        title: 'Cook Plan invite',
        body: '@alex invited you to cook',
        data: { kind: 'cookPlanInvite', cookPlanId: PLAN },
      },
    ],
  ]);
});

test('a tapped "Cook Plan invite" opens its plan; any other notification, or a broken one, opens none', () => {
  expect(parseCookPlanInvitePush({ kind: 'cookPlanInvite', cookPlanId: PLAN })).toBe(PLAN);
  for (const data of [
    null,
    {},
    { kind: 'friendRequest', fromUserId: USER },
    { kind: 'cookPlanInvite' },
    { kind: 'cookPlanInvite', cookPlanId: 'plan' },
    { kind: 'draftReady', recipeId: PLAN },
  ]) {
    expect(parseCookPlanInvitePush(data), JSON.stringify(data)).toBeNull();
  }
});
