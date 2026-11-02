// The notifier (decisions 11): sends the push a user's action earns someone else, such as "Friend
// request" to the person they asked. Runtime-neutral: the notify function wires a service-role
// `rpc` and Expo's push sender; tests wire the recording fake. The database decides whether a push
// is due (`claim_friend_request_push`: a pending request from the caller, at most one push per pair
// in 7 days), so a caller can't push anyone they like, or push the same person twice.

import { friendRequestMessages, type PushSender } from './push-sender.ts';

/** What the app asks the notify function to send, as the signed-in user. Ticket 14 adds cookPlanInvite. */
export type NotifyRequest = { kind: 'friendRequest'; toUserId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request body as the notify function got it, or null when it isn't one it sends. */
export function parseNotifyRequest(body: unknown): NotifyRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const kind: unknown = Reflect.get(body, 'kind');
  const toUserId: unknown = Reflect.get(body, 'toUserId');
  if (kind === 'friendRequest' && typeof toUserId === 'string' && UUID.test(toUserId)) return { kind, toUserId };
  return null;
}

/** Calls one of the notifier's database functions as the service role, and returns its result. */
export type NotifierRpc = (fn: 'claim_friend_request_push' | 'forget_push_tokens', args: Record<string, unknown>) => Promise<unknown>;

export type NotifierDeps = { rpc: NotifierRpc; sendPush: PushSender };

/** How long sending one push may take. */
const PUSH_MS = 10_000;

/** What `claim_friend_request_push` returned: the requester's username and the addressee's tokens. */
function toFriendRequestTarget(target: unknown): { username: string; tokens: string[] } | null {
  if (typeof target !== 'object' || target === null) return null;
  const username: unknown = Reflect.get(target, 'username');
  const tokens: unknown = Reflect.get(target, 'tokens');
  if (typeof username !== 'string' || !Array.isArray(tokens)) return null;
  return { username, tokens: tokens.filter((t): t is string => typeof t === 'string') };
}

/**
 * Sends what `callerId` (checked by the caller of this, from their session) asks for, if it's due,
 * and forgets the tokens the push service says are gone. Answers how many phones it went to.
 * Throws only when the push service can't be reached; the in-app list is the source of truth, so
 * nothing retries.
 */
export async function notify(callerId: string, request: NotifyRequest, deps: NotifierDeps): Promise<{ sent: number }> {
  const target = toFriendRequestTarget(
    await deps.rpc('claim_friend_request_push', { requester: callerId, addressee: request.toUserId }),
  );
  if (target === null || target.tokens.length === 0) return { sent: 0 };
  const messages = friendRequestMessages(callerId, target.username, target.tokens);
  const { unregistered } = await deps.sendPush(messages, AbortSignal.timeout(PUSH_MS));
  if (unregistered.length > 0) await deps.rpc('forget_push_tokens', { tokens: unregistered });
  return { sent: messages.length };
}
