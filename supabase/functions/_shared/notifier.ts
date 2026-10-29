// The notifier (decisions 11 and 14): sends the push a user's action earns someone else, such as
// "Friend request" to the person they asked, or "Cook Plan invite" to a Friend they invited.
// Runtime-neutral: the notify function wires a service-role `rpc` and Expo's push sender; tests
// wire the recording fake. The database decides whether a push is due (`claim_friend_request_push`:
// a pending request from the caller, at most one push per pair in 7 days;
// `claim_cook_plan_invite_push`: a member the caller invited, once per member per plan), so a
// caller can't push anyone they like, or push the same person twice.

import { cookPlanInviteMessages, friendRequestMessages, type PushMessage, type PushSender } from './push-sender.ts';

/** What the app asks the notify function to send, as the signed-in user. */
export type NotifyRequest =
  | { kind: 'friendRequest'; toUserId: string }
  | { kind: 'cookPlanInvite'; cookPlanId: string; toUserId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** A request body as the notify function got it, or null when it isn't one it sends. */
export function parseNotifyRequest(body: unknown): NotifyRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const kind: unknown = Reflect.get(body, 'kind');
  const toUserId: unknown = Reflect.get(body, 'toUserId');
  if (!isId(toUserId)) return null;
  if (kind === 'friendRequest') return { kind, toUserId };
  const cookPlanId: unknown = Reflect.get(body, 'cookPlanId');
  if (kind === 'cookPlanInvite' && isId(cookPlanId)) return { kind, cookPlanId, toUserId };
  return null;
}

/** Calls one of the notifier's database functions as the service role, and returns its result. */
export type NotifierRpc = (
  fn: 'claim_friend_request_push' | 'claim_cook_plan_invite_push' | 'forget_push_tokens',
  args: Record<string, unknown>,
) => Promise<unknown>;

export type NotifierDeps = { rpc: NotifierRpc; sendPush: PushSender };

/** How long sending one push may take. */
const PUSH_MS = 10_000;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** What a claim returned: the caller's username and the other's tokens (and a plan's Recipe titles). */
function toTarget(target: unknown): { username: string; tokens: string[]; recipeTitles: string[] } | null {
  if (typeof target !== 'object' || target === null) return null;
  const username: unknown = Reflect.get(target, 'username');
  const tokens: unknown = Reflect.get(target, 'tokens');
  if (typeof username !== 'string' || !Array.isArray(tokens)) return null;
  return { username, tokens: strings(tokens), recipeTitles: strings(Reflect.get(target, 'recipeTitles')) };
}

/** Claims the push `request` asks for, as `callerId`, and makes its messages; none when it isn't due. */
async function claim(callerId: string, request: NotifyRequest, rpc: NotifierRpc): Promise<PushMessage[]> {
  if (request.kind === 'friendRequest') {
    const target = toTarget(await rpc('claim_friend_request_push', { requester: callerId, addressee: request.toUserId }));
    return target ? friendRequestMessages(callerId, target.username, target.tokens) : [];
  }
  const target = toTarget(
    await rpc('claim_cook_plan_invite_push', {
      plan_id: request.cookPlanId,
      inviter: callerId,
      invitee: request.toUserId,
    }),
  );
  return target ? cookPlanInviteMessages(request.cookPlanId, target.username, target.recipeTitles, target.tokens) : [];
}

/**
 * Sends what `callerId` (checked by the caller of this, from their session) asks for, if it's due,
 * and forgets the tokens the push service says are gone. Answers how many phones it went to.
 * Throws only when the push service can't be reached; the in-app lists are the source of truth, so
 * nothing retries.
 */
export async function notify(callerId: string, request: NotifyRequest, deps: NotifierDeps): Promise<{ sent: number }> {
  const messages = await claim(callerId, request, deps.rpc);
  if (messages.length === 0) return { sent: 0 };
  const { unregistered } = await deps.sendPush(messages, AbortSignal.timeout(PUSH_MS));
  if (unregistered.length > 0) await deps.rpc('forget_push_tokens', { tokens: unregistered });
  return { sent: messages.length };
}
