// Ticket 07: the Expo push sender, over a fake fetch (no network). It posts only to Expo's push
// service, carries the access token only when one is set, and reads back which tokens are gone.
import { expect, test } from 'vitest';

import {
  EXPO_PUSH_URL,
  draftReadyMessages,
  expoPushSender,
} from '../supabase/functions/_shared/push-sender';

const RECIPE = '0b4a1d2e-3f40-4c5d-8e6f-708192a3b4c5';
const signal = new AbortController().signal;

type Sent = { url: string; method?: string; headers: Record<string, string>; body: unknown };

/** A fetch that records each request and answers with `answer(batch)`. */
function fakeFetch(answer: (batch: unknown[]) => Response) {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    sent.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    return answer(Array.isArray(body) ? body : []);
  };
  return { fetch, sent };
}

const ok = (batch: unknown[]) => Response.json({ data: batch.map((_, i) => ({ status: 'ok', id: `ticket-${i}` })) });

test('"Draft ready" goes to Expo’s push service, one message per phone, with the Draft’s title and id', async () => {
  const { fetch, sent } = fakeFetch(ok);
  const send = expoPushSender(fetch);

  const result = await send(draftReadyMessages(RECIPE, 'Rosa’s café crêpes', ['ExponentPushToken[a]', 'ExponentPushToken[b]']), signal);

  expect(result).toEqual({ unregistered: [] });
  expect(sent).toEqual([
    {
      url: 'https://exp.host/--/api/v2/push/send',
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: [
        { to: 'ExponentPushToken[a]', title: 'Draft ready', body: 'Rosa’s café crêpes', data: { kind: 'draftReady', recipeId: RECIPE } },
        { to: 'ExponentPushToken[b]', title: 'Draft ready', body: 'Rosa’s café crêpes', data: { kind: 'draftReady', recipeId: RECIPE } },
      ],
    },
  ]);
  expect(EXPO_PUSH_URL).toBe('https://exp.host/--/api/v2/push/send');
});

test('the Expo access token goes with the request only when one is set', async () => {
  const withToken = fakeFetch(ok);
  const blank = fakeFetch(ok);

  await expoPushSender(withToken.fetch, 'expo-secret')(draftReadyMessages(RECIPE, 'Soup', ['ExponentPushToken[a]']), signal);
  await expoPushSender(blank.fetch, '')(draftReadyMessages(RECIPE, 'Soup', ['ExponentPushToken[a]']), signal);

  expect(withToken.sent[0].headers.authorization).toBe('Bearer expo-secret');
  expect(blank.sent[0].headers.authorization).toBeUndefined();
});

test('tokens Expo reports as DeviceNotRegistered come back to be forgotten; other errors do not', async () => {
  const { fetch } = fakeFetch(() =>
    Response.json({
      data: [
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        { status: 'error', message: 'no details' },
      ],
    }),
  );
  const tokens = ['ExponentPushToken[gone]', 'ExponentPushToken[ok]', 'ExponentPushToken[big]', 'ExponentPushToken[odd]'];

  expect(await expoPushSender(fetch)(draftReadyMessages(RECIPE, 'Soup', tokens), signal)).toEqual({
    unregistered: ['ExponentPushToken[gone]'],
  });
});

test('a refused request, or an answer with no tickets, fails the send', async () => {
  const refused = fakeFetch(() => new Response('{"errors":[{"code":"PUSH_TOO_MANY_EXPERIENCE_IDS"}]}', { status: 400 }));
  const odd = fakeFetch(() => Response.json({ nothing: true }));
  const messages = draftReadyMessages(RECIPE, 'Soup', ['ExponentPushToken[a]']);

  await expect(expoPushSender(refused.fetch)(messages, signal)).rejects.toThrow('Expo refused the push (400)');
  await expect(expoPushSender(odd.fetch)(messages, signal)).rejects.toThrow('without push tickets');
});

test('more than 100 phones go in batches of 100, as Expo takes them', async () => {
  const { fetch, sent } = fakeFetch(ok);
  const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`);

  await expoPushSender(fetch)(draftReadyMessages(RECIPE, 'Soup', tokens), signal);

  expect(sent.map((s) => (Array.isArray(s.body) ? s.body.length : 0))).toEqual([100, 50]);
});
