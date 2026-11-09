// POST /functions/v1/build-draft {recipeId}: builds one of the caller's Drafts in the background.
// A thin Deno entry (docs/agents/verify.md): it checks the caller, answers 202 at once, and runs
// buildDraft (supabase/functions/_shared/draft-builder.ts) with the real source reader and Claude,
// or, with DRAFT_FIXTURES=1 on a local stack only, with the canned ones the tests use.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

import { claudeExtractor, ExtractError, type Extract } from '../_shared/claude-extractor.ts';
import { buildDraft, type Rpc } from '../_shared/draft-builder.ts';
import { fixtureAdapters, fixtureExtract } from '../_shared/draft-fixtures.ts';
import { createSourceReader, tiktokOEmbedAdapter } from '../_shared/source-reader.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim() ?? '';

/** The local stack's API, as the functions runtime sees it. A hosted project is never one of these. */
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);
const local = LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
const fixtures = Deno.env.get('DRAFT_FIXTURES') === '1';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rpc: Rpc = async (fn, args) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
};

/** With no API key the build fails as "not set up" rather than calling Claude without one. */
const notSetUp: Extract = async () => {
  throw new ExtractError('notSetUp', 'ANTHROPIC_API_KEY is not set.');
};

const readSource = createSourceReader(fixtures ? fixtureAdapters : { tiktok: tiktokOEmbedAdapter(fetch) }).read;
const extract: Extract = fixtures
  ? fixtureExtract
  : anthropicKey
    ? claudeExtractor(new Anthropic({ apiKey: anthropicKey, maxRetries: 2 }))
    : notSetUp;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (fixtures && !local) {
    // DRAFT_FIXTURES is for the local e2e stack; a hosted project never builds canned Drafts.
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

  // The caller's own client: row-level security shows them only their own Recipes.
  const asCaller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: draft, error } = await asCaller.from('recipes').select('id').eq('id', recipeId).maybeSingle();
  if (error) return json(error.code === 'PGRST301' ? 401 : 400, { error: error.message });
  if (!draft) return json(404, { error: 'No such Draft.' });

  EdgeRuntime.waitUntil(
    buildDraft(recipeId, { rpc, readSource, extract }).catch((e) => console.error('build-draft:', e)),
  );
  return json(202, { status: 'building' });
});
