// The push sender (decisions 07): the one place the server sends a push notification. The Draft
// builder and the notifier (friend requests and Cook Plan invites, decisions 11 and 14) call a `PushSender`; the build-draft and
// notify functions wire Expo's push service, and tests and DRAFT_FIXTURES wire the recording fake,
// so neither reaches the network. Runtime-neutral: the caller passes `fetch`, and the one URL it is
// ever called with is Expo's (a fixed host, not a link from a user, so it doesn't go through
// safeFetch).

/** What a "Draft ready" notification carries, for the app to open that Draft when it's tapped. */
export type DraftReadyData = { kind: 'draftReady'; recipeId: string };

/** What a "Friend request" notification carries: who asked. Tapping it opens Friends > Requests. */
export type FriendRequestData = { kind: 'friendRequest'; fromUserId: string };

/** What a "Cook Plan invite" notification carries (ticket 14): the plan to open. */
export type CookPlanInviteData = { kind: 'cookPlanInvite'; cookPlanId: string };

/** What a notification carries, for the app to open the right screen when it's tapped. */
export type PushData = DraftReadyData | FriendRequestData | CookPlanInviteData;

/** One notification to one phone, by its Expo push token. */
export type PushMessage = { to: string; title: string; body: string; data: PushData };

/**
 * Sends `messages`, and answers which of their tokens the push service says are no longer
 * registered (the app was deleted, say), to forget. Throws when nothing could be sent.
 */
export type PushSender = (messages: PushMessage[], signal: AbortSignal) => Promise<{ unregistered: string[] }>;

/** The "Draft ready" notification for one Draft, to each of its owner's phones. */
export function draftReadyMessages(recipeId: string, title: string, tokens: readonly string[]): PushMessage[] {
  return tokens.map((to) => ({ to, title: 'Draft ready', body: title, data: { kind: 'draftReady', recipeId } }));
}

/** The "Friend request" notification from `fromUserId` (@`username`), to each of the addressee's phones. */
export function friendRequestMessages(fromUserId: string, username: string, tokens: readonly string[]): PushMessage[] {
  return tokens.map((to) => ({
    to,
    title: 'Friend request',
    body: `@${username} wants to be Friends`,
    data: { kind: 'friendRequest', fromUserId },
  }));
}

/**
 * The "Cook Plan invite" notification from @`username` (decisions 14), to each of the invitee's
 * phones: "@alex invited you to cook", then the plan's Recipe titles, if it has any yet.
 */
export function cookPlanInviteMessages(
  cookPlanId: string,
  username: string,
  recipeTitles: readonly string[],
  tokens: readonly string[],
): PushMessage[] {
  const what = recipeTitles.length > 0 ? `: ${recipeTitles.join(', ')}` : '';
  return tokens.map((to) => ({
    to,
    title: 'Cook Plan invite',
    body: `@${username} invited you to cook${what}`,
    data: { kind: 'cookPlanInvite', cookPlanId },
  }));
}

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** The most messages Expo takes in one request. */
const EXPO_BATCH = 100;

/** The tokens of `messages` whose tickets say DeviceNotRegistered; tickets come in message order. */
function unregisteredIn(messages: PushMessage[], answer: unknown): string[] {
  const tickets: unknown = typeof answer === 'object' && answer !== null ? Reflect.get(answer, 'data') : null;
  if (!Array.isArray(tickets)) throw new Error('Expo answered without push tickets.');
  return messages.flatMap((message, i) => {
    const ticket: unknown = tickets[i];
    if (typeof ticket !== 'object' || ticket === null || Reflect.get(ticket, 'status') !== 'error') return [];
    const details: unknown = Reflect.get(ticket, 'details');
    const error = typeof details === 'object' && details !== null ? Reflect.get(details, 'error') : null;
    return error === 'DeviceNotRegistered' ? [message.to] : [];
  });
}

/**
 * Expo's push service. `accessToken` is `EXPO_ACCESS_TOKEN`, needed only when the Expo project
 * turns on enhanced push security; never in the app.
 */
export function expoPushSender(fetch: typeof globalThis.fetch, accessToken?: string): PushSender {
  return async (messages, signal) => {
    const unregistered: string[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      const batch = messages.slice(i, i + EXPO_BATCH);
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
        signal,
      });
      if (!response.ok) throw new Error(`Expo refused the push (${response.status}): ${await response.text()}`);
      unregistered.push(...unregisteredIn(batch, await response.json()));
    }
    return { unregistered };
  };
}

/**
 * A push sender that sends nothing and remembers what it was given, for tests and DRAFT_FIXTURES.
 * The tokens in `unregistered` are reported as no longer registered.
 */
export function recordingPushSender({
  unregistered = [],
  onSend,
}: { unregistered?: Iterable<string>; onSend?: (messages: PushMessage[]) => void } = {}) {
  const gone = new Set(unregistered);
  const sent: PushMessage[] = [];
  const send: PushSender = async (messages) => {
    sent.push(...messages);
    onSend?.(messages);
    return { unregistered: messages.map((m) => m.to).filter((token) => gone.has(token)) };
  };
  return { send, sent: () => [...sent] };
}
