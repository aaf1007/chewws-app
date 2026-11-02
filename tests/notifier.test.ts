// Ticket 11: what the notify function accepts, and the "Friend request" push as Expo gets it (over a
// fake fetch, no network).
import { expect, test } from 'vitest';

import { parseNotifyRequest } from '../supabase/functions/_shared/notifier';
import { expoPushSender, friendRequestMessages } from '../supabase/functions/_shared/push-sender';

const USER = '0b4a1d2e-3f40-4c5d-8e6f-708192a3b4c5';

test('notify accepts a friend request kick naming a user id, and nothing else', () => {
  expect(parseNotifyRequest({ kind: 'friendRequest', toUserId: USER })).toEqual({ kind: 'friendRequest', toUserId: USER });
  expect(parseNotifyRequest({ kind: 'friendRequest', toUserId: USER, extra: 1 })).toEqual({
    kind: 'friendRequest',
    toUserId: USER,
  });
  for (const body of [
    null,
    'friendRequest',
    [],
    {},
    { kind: 'friendRequest' },
    { kind: 'friendRequest', toUserId: 'not-a-uuid' },
    { kind: 'friendRequest', toUserId: ` ${USER}` },
    { kind: 'draftReady', toUserId: USER },
    { kind: 'cookPlanInvite', cookPlanId: USER },
  ]) {
    expect(parseNotifyRequest(body), JSON.stringify(body)).toBeNull();
  }
});

test('"Friend request" goes to Expo as "@name wants to be Friends", with who asked', async () => {
  const sent: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const batch: unknown = JSON.parse(String(init?.body));
    sent.push(batch);
    return Response.json({ data: Array.isArray(batch) ? batch.map(() => ({ status: 'ok' })) : [] });
  };

  await expoPushSender(fetch)(
    friendRequestMessages(USER, 'rosa_2024', ['ExponentPushToken[a]']),
    new AbortController().signal,
  );

  expect(sent).toEqual([
    [
      {
        to: 'ExponentPushToken[a]',
        title: 'Friend request',
        body: '@rosa_2024 wants to be Friends',
        data: { kind: 'friendRequest', fromUserId: USER },
      },
    ],
  ]);
});
