-- Ticket 03: saving a TikTok link into a Draft (decisions 03).
--
-- A Draft is a Recipe with status 'draft'. Saving a link makes it at once, with a placeholder title,
-- its Source Video and build_status 'building'; the Draft builder (the build-draft Edge Function,
-- running as service_role) then claims it, reads the source, asks Claude, and finishes or fails it.
-- The build columns, status and recipe_found change only through the functions below: the owner's
-- direct writes are limited to the columns they may edit.

create type public.draft_build_status as enum ('building', 'built', 'failed');

-- Why a build failed. 'not_set_up': the server has no Claude API key yet.
create type public.draft_build_failure as enum (
  'source_unavailable', 'source_unreachable', 'unreadable', 'timed_out', 'not_set_up'
);

-- A Recipe written by hand needs no review and no build, so the defaults now describe one.
alter table public.recipes
  alter column status set default 'reviewed',
  add column build_status public.draft_build_status not null default 'built',
  add column build_failure public.draft_build_failure,
  add column build_attempts integer not null default 0 check (build_attempts >= 0),
  add column build_started_at timestamptz,
  add constraint recipes_reviewed_is_built check (status = 'draft' or build_status = 'built'),
  add constraint recipes_failure_iff_failed check ((build_failure is not null) = (build_status = 'failed'));

-- Owners write only what they may edit; everything else goes through the functions below.
revoke insert, update on table public.recipes from authenticated;
grant insert (title, steps) on table public.recipes to authenticated;
grant update (title, steps, updated_at) on table public.recipes to authenticated;

create index recipes_owner_drafts_idx on public.recipes (owner_id, created_at desc) where status = 'draft';

-- create_recipe (ticket 02) named status and recipe_found; the defaults above now say the same.
create or replace function public.create_recipe(title text, steps text[], lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.recipes (title, steps)
  values (title, steps)
  returning id into new_id;

  perform private.replace_recipe_lines(new_id, lines);
  return new_id;
end;
$$;

create type public.source_platform as enum ('tiktok', 'youtube', 'instagram', 'web');

-- The video (or page) a Recipe was saved from, one per Recipe. Only the server writes it.
create table public.source_videos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null unique references public.recipes (id) on delete cascade,
  platform public.source_platform not null,
  original_url text not null check (original_url ~* '^https?://'),
  external_id text,
  creator_name text,
  creator_url text,
  caption text,
  title text,
  thumbnail_url text,
  recipe_site_url text,
  screenshot_path text,
  pasted_text text,
  fetched_at timestamptz
);

alter table public.source_videos enable row level security;

grant select on table public.source_videos to authenticated;

create policy "Owners can read their Recipes' Source Videos"
  on public.source_videos for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

-- One row per link saved, kept when the Recipe is deleted: ticket 07 counts them for the daily
-- limit. No API role reads or writes it.
create table public.link_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid references public.recipes (id) on delete set null,
  saved_at timestamptz not null default now()
);

create index link_saves_user_saved_idx on public.link_saves (user_id, saved_at desc);

alter table public.link_saves enable row level security;
revoke all on table public.link_saves from anon, authenticated;

-- Saves a shared link as a Draft and returns at once; the phone then kicks the build. The Recipe id
-- is made on the phone, so a save sent again (its answer lost) finds its Draft and adds nothing.
-- `platform` is what the phone's detectSource saw; the builder reads the link again itself and
-- stores what it found.
create function public.save_from_link(recipe_id uuid, url text, platform public.source_platform)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  link text := btrim(save_from_link.url);
  placeholder text;
  owner uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if link !~* '^https?://[^/?#\s]+' then
    raise exception 'not a link: %', link using errcode = '22023';
  end if;

  placeholder := case save_from_link.platform
    when 'tiktok' then 'TikTok video'
    when 'youtube' then 'YouTube video'
    when 'instagram' then 'Instagram Reel'
    else substring(link from '^https?://(?:www\.)?([^/?#:\s]+)')
  end;

  insert into public.recipes (id, owner_id, title, status, recipe_found, build_status)
  values (save_from_link.recipe_id, me, placeholder, 'draft', true, 'building')
  on conflict (id) do nothing;

  if found then
    insert into public.source_videos (recipe_id, platform, original_url)
    values (save_from_link.recipe_id, save_from_link.platform, link);
    insert into public.link_saves (user_id, recipe_id) values (me, save_from_link.recipe_id);
  else
    select r.owner_id into owner from public.recipes r where r.id = save_from_link.recipe_id;
    if owner is distinct from me then
      raise exception 'that Recipe id is taken' using errcode = '23505';
    end if;
  end if;

  return jsonb_build_object('status', 'saved', 'recipeId', save_from_link.recipe_id);
end;
$$;

revoke execute on function public.save_from_link(uuid, text, public.source_platform) from public, anon;
grant execute on function public.save_from_link(uuid, text, public.source_platform) to authenticated;

-- Whether a build claimed at `started_at` has run too long: over 3 minutes, after which it counts
-- as timed out and may be claimed again. False for a build not claimed yet.
create function private.build_timed_out(started_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$ select started_at is not null and started_at < now() - interval '3 minutes' $$;

-- The Draft builder claims a Draft before building it, so a second kick builds nothing. It succeeds
-- while the Draft is building, unclaimed or claimed over 3 minutes ago, with attempts left. Returns
-- what was shared, or null when there's nothing to build.
create function public.claim_draft_build(recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared jsonb;
begin
  update public.recipes r
  set build_started_at = now(), build_attempts = r.build_attempts + 1
  where r.id = claim_draft_build.recipe_id
    and r.status = 'draft'
    and r.build_status = 'building'
    and (r.build_started_at is null or private.build_timed_out(r.build_started_at))
    and r.build_attempts < 3;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'url', s.original_url, 'pastedText', s.pasted_text, 'screenshotPath', s.screenshot_path
  ) into shared
  from public.source_videos s
  where s.recipe_id = claim_draft_build.recipe_id;

  return shared;
end;
$$;

-- Fills in a Draft the builder read: what it found about the source, and the title, lines and
-- steps (none when the recipe isn't in the caption). `result`: {title, recipeFound, lines:
-- [{original_text, amount_text, ingredient_name}] with names already normalised, steps, source:
-- {platform, external_id, creator_name, creator_url, caption, title, thumbnail_url,
-- recipe_site_url}}. Only while the Draft is still building; returns whether it changed it.
create function public.finish_draft(recipe_id uuid, result jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_recipe boolean := coalesce((result ->> 'recipeFound')::boolean, false);
  new_title text := nullif(btrim(coalesce(result ->> 'title', '')), '');
  source jsonb := coalesce(result -> 'source', '{}'::jsonb);
begin
  update public.recipes r
  set title = coalesce(new_title, r.title),
      steps = case when found_recipe
        then coalesce(array(
          select btrim(step) from jsonb_array_elements_text(result -> 'steps') as step
          where btrim(step) <> ''
        ), '{}')
        else '{}' end,
      recipe_found = found_recipe,
      build_status = 'built',
      updated_at = now()
  where r.id = finish_draft.recipe_id and r.status = 'draft' and r.build_status = 'building';

  if not found then
    return false;
  end if;

  perform private.replace_recipe_lines(
    finish_draft.recipe_id,
    case when found_recipe then coalesce(result -> 'lines', '[]'::jsonb) else '[]'::jsonb end
  );

  update public.source_videos s
  set platform = coalesce((source ->> 'platform')::public.source_platform, s.platform),
      external_id = source ->> 'external_id',
      creator_name = source ->> 'creator_name',
      creator_url = source ->> 'creator_url',
      caption = source ->> 'caption',
      title = source ->> 'title',
      thumbnail_url = source ->> 'thumbnail_url',
      recipe_site_url = source ->> 'recipe_site_url',
      fetched_at = now()
  where s.recipe_id = finish_draft.recipe_id;

  return true;
end;
$$;

-- Marks a building Draft failed, with why. Returns whether it changed it.
create function public.fail_draft(recipe_id uuid, reason public.draft_build_failure)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipes r
  set build_status = 'failed', build_failure = fail_draft.reason, updated_at = now()
  where r.id = fail_draft.recipe_id and r.status = 'draft' and r.build_status = 'building';
  return found;
end;
$$;

revoke execute on function public.claim_draft_build(uuid) from public, anon, authenticated;
revoke execute on function public.finish_draft(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_draft(uuid, public.draft_build_failure) from public, anon, authenticated;
grant execute on function public.claim_draft_build(uuid) to service_role;
grant execute on function public.finish_draft(uuid, jsonb) to service_role;
grant execute on function public.fail_draft(uuid, public.draft_build_failure) to service_role;
revoke execute on function private.build_timed_out(timestamptz) from public, anon;
grant execute on function private.build_timed_out(timestamptz) to authenticated, service_role;

-- Puts a failed (or timed-out) Draft of the caller's back to building, for the phone to kick.
-- Returns 'retrying'; 'building' when it already is (a Retry sent twice changes nothing more);
-- 'noAttemptsLeft' (3 builds tried); 'built'; or 'gone'.
create function public.retry_draft(recipe_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.recipes;
begin
  select * into draft from public.recipes r
  where r.id = retry_draft.recipe_id and r.owner_id = (select auth.uid()) and r.status = 'draft'
  for update;

  if not found then
    return 'gone';
  end if;
  if draft.build_status = 'built' then
    return 'built';
  end if;
  if draft.build_status = 'building' and not private.build_timed_out(draft.build_started_at) then
    return 'building';
  end if;
  if draft.build_attempts >= 3 then
    return 'noAttemptsLeft';
  end if;

  update public.recipes r
  set build_status = 'building', build_failure = null, build_started_at = null, updated_at = now()
  where r.id = retry_draft.recipe_id;
  return 'retrying';
end;
$$;

-- The user's reviewed version of a Draft: replaces its title, steps and lines, as edit_recipe does,
-- and makes it a Recipe. A Draft still building is refused; a failed one is filled in by hand. A
-- Recipe that isn't a Draft (written by hand, or reviewed already) is refused and left as it is.
-- Returns 'reviewed', 'building', 'notDraft' or 'gone'.
create function public.review_draft(recipe_id uuid, title text, steps text[], lines jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.recipes;
begin
  select * into draft from public.recipes r
  where r.id = review_draft.recipe_id and r.owner_id = (select auth.uid())
  for update;

  if not found then
    return 'gone';
  end if;
  if draft.status <> 'draft' then
    return 'notDraft';
  end if;
  if draft.build_status = 'building' and not private.build_timed_out(draft.build_started_at) then
    return 'building';
  end if;

  update public.recipes r
  set title = review_draft.title,
      steps = review_draft.steps,
      status = 'reviewed',
      build_status = 'built',
      build_failure = null,
      updated_at = now()
  where r.id = review_draft.recipe_id;

  perform private.replace_recipe_lines(review_draft.recipe_id, lines);
  return 'reviewed';
end;
$$;

revoke execute on function public.retry_draft(uuid) from public, anon;
revoke execute on function public.review_draft(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.retry_draft(uuid) to authenticated;
grant execute on function public.review_draft(uuid, text, text[], jsonb) to authenticated;
