// POST /functions/v1/notify {kind: 'friendRequest', toUserId} or {kind: 'cookPlanInvite', cookPlanId,
// toUserId}: sends the push the caller's action earns someone else (decisions 11, 14). A thin Deno
// entry (docs/agents/verify.md): it checks the caller's session, answers 202 at once, and runs
// notify (supabase/functions/_shared/notifier.ts) with a service-role rpc and Expo's push service;
// or, with DRAFT_FIXTURES=1 on a local stack only, with a push sender that only logs. Whether a push
// is due is the database's call.

import { createClient } from '@supabase/supabase-js';

import { notify, parseNotifyRequest, type NotifierRpc } from '../_shared/notifier.ts';
import { expoPushSender, recordingPushSender, type PushSender } from '../_shared/push-sender.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Only needed when the Expo project turns on enhanced push security.
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN')?.trim() || undefined;

/** The local stack's API, as the functions runtime sees it. A hosted project is never one of these. */
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);
const local = LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
const fixtures = Deno.env.get('DRAFT_FIXTURES') === '1';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rpc: NotifierRpc = async (fn, args) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
};

// Expo's push service, a fixed host. In fixture mode nothing is sent.
const sendPush: PushSender = fixtures
  ? recordingPushSender({ onSend: (messages) => console.log('notify: push not sent (DRAFT_FIXTURES):', messages) }).send
  : expoPushSender(fetch, expoAccessToken);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (fixtures && !local) {
    return json(500, { error: 'DRAFT_FIXTURES is set on a stack that is not local.' });
  }
  if (request.method !== 'POST') return json(405, { error: 'POST only.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in first.' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const wanted = parseNotifyRequest(body);
  if (!wanted) return json(400, { error: 'Send {"kind": "friendRequest" or "cookPlanInvite", "toUserId": "…"}.' });

  // Who is asking, from their session; the anon key alone is nobody.
  const asCaller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data.user) return json(401, { error: 'Sign in first.' });

  EdgeRuntime.waitUntil(notify(data.user.id, wanted, { rpc, sendPush }).catch((e) => console.error('notify:', e)));
  return json(202, { status: 'sending' });
});
