// POST /functions/v1/refresh-source-video {recipeId}: reads one of the caller's TikTok or YouTube
// Source Videos from its platform again, and answers once it's stored ({status}). The app calls it
// when a thumbnail stops loading, and when YouTube data is over 30 days old (decisions 04).
// A thin Deno entry (docs/agents/verify.md): the work is refreshSourceVideo in
// supabase/functions/_shared/source-refresher.ts. The claim runs as the caller, so the database
// refuses anyone else's Recipe; with DRAFT_FIXTURES=1 on a local stack only, the canned platforms
// answer as they do "later" (a thumbnail URL that has changed).

import { createClient } from '@supabase/supabase-js';

import type { Rpc } from '../_shared/draft-builder.ts';
import { laterFixtureAdapters } from '../_shared/draft-fixtures.ts';
import { createSafeFetch, dnsResolver } from '../_shared/safe-fetch.ts';
import { realSourceAdapters } from '../_shared/source-reader.ts';
import { refreshSourceVideo } from '../_shared/source-refresher.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const youtubeKey = Deno.env.get('YOUTUBE_API_KEY')?.trim() ?? '';

/** The local stack's API, as the functions runtime sees it. A hosted project is never one of these. */
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);
const local = LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
const fixtures = Deno.env.get('DRAFT_FIXTURES') === '1';

/** One refresh may take this long, platform and database together. */
const BUDGET_MS = 9_000;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rpc: Rpc = async (fn, args) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
};

const safeFetch = createSafeFetch({ fetch, resolveHost: dnsResolver(Deno.resolveDns) });
const adapters = fixtures ? laterFixtureAdapters : realSourceAdapters(safeFetch, youtubeKey);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (fixtures && !local) {
    return json(500, { error: 'DRAFT_FIXTURES is set on a stack that is not local.' });
  }
  if (request.method !== 'POST') return json(405, { error: 'POST only.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in first.' });

  let recipeId: unknown;
  try {
    recipeId = (await request.json())?.recipeId;
  } catch {
    return json(400, { error: 'Send {"recipeId": "…"}.' });
  }
  if (typeof recipeId !== 'string') return json(400, { error: 'Send {"recipeId": "…"}.' });

  // The caller's own client: claim_source_refresh claims only their own Source Videos.
  const asCaller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  try {
    const status = await refreshSourceVideo(recipeId, {
      claim: async (id) => {
        const { data, error } = await asCaller.rpc('claim_source_refresh', { recipe_id: id });
        if (error) throw Object.assign(new Error(error.message), { code: error.code });
        return data;
      },
      rpc,
      adapters,
      signal: AbortSignal.timeout(BUDGET_MS),
    });
    return json(200, { status });
  } catch (e) {
    const code: unknown = e instanceof Error ? Reflect.get(e, 'code') : undefined;
    if (code === 'PGRST301' || code === '42501') return json(401, { error: 'Sign in first.' });
    console.error('refresh-source-video:', e);
    return json(500, { error: 'The refresh failed.' });
  }
});
