-- Ticket 04: YouTube, recipe-site and other links (decisions 04).
--
-- Saving and building work as in ticket 03; the Draft builder reads the new sources itself. What's
-- new here is keeping a Source Video fresh: a thumbnail that stops loading, or YouTube data over
-- 30 days old, is read from the platform again (refresh-source-video). Thumbnails stay platform
-- URLs (ADR-0004). YouTube's API terms also say stored data must not outlive 30 days, so a daily
-- job drops it from any YouTube Source Video nobody opened in that time.

-- When a refresh was last asked for: at most one per Recipe every 10 minutes.
alter table public.source_videos add column refresh_requested_at timestamptz;

-- The first step of a refresh, called as the user who asked (the refresh-source-video function
-- passes their session). Claims the refresh of one of their own TikTok or YouTube Source Videos,
-- read at least once, if none was asked for in the last 10 minutes. Returns {platform, url} for
-- the function to read, or null when there's nothing to do.
create function public.claim_source_refresh(recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  update public.source_videos s
  set refresh_requested_at = now()
  where s.recipe_id = claim_source_refresh.recipe_id
    and s.platform in ('tiktok', 'youtube')
    and s.fetched_at is not null
    and (s.refresh_requested_at is null or s.refresh_requested_at < now() - interval '10 minutes')
    and exists (
      select 1 from public.recipes r
      where r.id = s.recipe_id and r.owner_id = (select auth.uid())
    )
  returning jsonb_build_object('platform', s.platform, 'url', s.original_url) into claimed;
  return claimed;
end;
$$;

revoke execute on function public.claim_source_refresh(uuid) from public, anon;
grant execute on function public.claim_source_refresh(uuid) to authenticated;

-- Stores what the platform says about a Source Video now: `source` is {creator_name, creator_url,
-- caption, title, thumbnail_url}, all null when the video is gone. Only the server calls it.
create function public.store_source_refresh(recipe_id uuid, source jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.source_videos s
  set creator_name = source ->> 'creator_name',
      creator_url = source ->> 'creator_url',
      caption = source ->> 'caption',
      title = source ->> 'title',
      thumbnail_url = source ->> 'thumbnail_url',
      fetched_at = now()
  where s.recipe_id = store_source_refresh.recipe_id and s.platform in ('tiktok', 'youtube');
  return found;
end;
$$;

revoke execute on function public.store_source_refresh(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.store_source_refresh(uuid, jsonb) to service_role;

-- Drops what the YouTube API said about any YouTube Source Video read over 30 days ago (its
-- caption, title, thumbnail and channel). fetched_at stays, so opening the Recipe reads it again.
-- The Recipe's own title, lines and steps are the user's and stay. Returns how many it cleared.
create function private.expire_youtube_source_data()
returns integer
language sql
set search_path = ''
as $$
  with cleared as (
    update public.source_videos s
    set caption = null, title = null, thumbnail_url = null, creator_name = null, creator_url = null
    where s.platform = 'youtube'
      and s.fetched_at < now() - interval '30 days'
      and (s.caption is not null or s.title is not null or s.thumbnail_url is not null
        or s.creator_name is not null or s.creator_url is not null)
    returning 1
  )
  select count(*)::integer from cleared;
$$;

revoke execute on function private.expire_youtube_source_data() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule('expire-youtube-source-data', '17 3 * * *', 'select private.expire_youtube_source_data()');
