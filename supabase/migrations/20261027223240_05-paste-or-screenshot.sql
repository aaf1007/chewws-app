-- Ticket 05: Instagram via a screenshot or a pasted caption (decisions 05), and the same two paths
-- for a Draft whose source couldn't be read (decisions, "when a source can't be read").
--
-- The app never reads Instagram. A Reel is saved with what the user adds: a caption they paste, a
-- screenshot, both or neither. A screenshot is the user's own image, in the private bucket
-- recipe-images at {user_id}/{recipe_id}.jpg, readable and writable only by them. The Draft
-- builder (service role) downloads it and sends it to Claude.
--
-- A TikTok whose oEmbed gives no caption, or a page that refuses the server (a 4xx), fails its
-- build as "couldn't read it" (no_caption, source_refused), not as "recipe not in caption". The
-- user can then add a caption or a screenshot, which builds it again like a Retry (3 builds in all).

alter type public.draft_build_failure add value 'no_caption';
alter type public.draft_build_failure add value 'source_refused';

-- A pasted caption is capped so one Draft can't send Claude a book.
alter table public.source_videos
  add constraint source_videos_pasted_text_length check (char_length(pasted_text) <= 10000);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 3145728, array['image/jpeg']);

-- Owner-only: the first folder of the path is the user's id. Upload (insert, and update for a save
-- sent again), read (signed URLs) and delete (with the Recipe). An upload is only ever a Recipe's
-- screenshot, {user id}/{recipe id}.jpg, so a user can't keep other files in their folder.
create policy "Users upload recipe images to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recipe-images'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );

create policy "Users read their own recipe images"
  on storage.objects for select to authenticated
  using (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users replace their own recipe images"
  on storage.objects for update to authenticated
  using (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'recipe-images'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );

create policy "Users delete their own recipe images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Where the caller's screenshot for a Recipe lives, after checking they uploaded it. The path is
-- made here, never taken from the caller, so a Draft can't name someone else's image for the
-- builder (which reads as the service role) to send to Claude.
create function private.uploaded_screenshot_path(recipe_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path text := (select auth.uid())::text || '/' || uploaded_screenshot_path.recipe_id::text || '.jpg';
begin
  if not exists (select 1 from storage.objects o where o.bucket_id = 'recipe-images' and o.name = path) then
    raise exception 'upload the screenshot first' using errcode = '22023';
  end if;
  return path;
end;
$$;

revoke execute on function private.uploaded_screenshot_path(uuid) from public, anon, authenticated;

-- A caption as the user pasted it: trimmed, null when blank, refused when too long.
create function private.pasted_caption(text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  caption text := nullif(btrim(pasted_caption.text), '');
begin
  if char_length(caption) > 10000 then
    raise exception 'the caption is too long' using errcode = '22001';
  end if;
  return caption;
end;
$$;

revoke execute on function private.pasted_caption(text) from public, anon, authenticated;

-- save_from_link (ticket 03) now also takes what the user added: a pasted caption and whether they
-- uploaded a screenshot (at the path above) first.
drop function public.save_from_link(uuid, text, public.source_platform);

create function public.save_from_link(
  recipe_id uuid,
  url text,
  platform public.source_platform,
  pasted_text text default null,
  with_screenshot boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  link text := btrim(save_from_link.url);
  new_caption text := private.pasted_caption(save_from_link.pasted_text);
  new_screenshot text;
  placeholder text;
  owner uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if link !~* '^https?://[^/?#\s]+' then
    raise exception 'not a link: %', link using errcode = '22023';
  end if;
  if with_screenshot then
    new_screenshot := private.uploaded_screenshot_path(save_from_link.recipe_id);
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
    insert into public.source_videos (recipe_id, platform, original_url, pasted_text, screenshot_path)
    values (save_from_link.recipe_id, save_from_link.platform, link, new_caption, new_screenshot);
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

revoke execute on function public.save_from_link(uuid, text, public.source_platform, text, boolean) from public, anon;
grant execute on function public.save_from_link(uuid, text, public.source_platform, text, boolean) to authenticated;

-- A caption the user pasted, a screenshot they uploaded, or both, for one of their failed Drafts
-- (most often one whose source couldn't be read): stores them in place of any added before and
-- puts the Draft back to building, for the phone to kick. It counts as a Retry. Returns
-- 'retrying'; 'building' when it already is; 'noAttemptsLeft' (3 builds tried); 'built'; or 'gone'.
create function public.add_caption_to_draft(recipe_id uuid, pasted_text text default null, with_screenshot boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.recipes;
  new_caption text := private.pasted_caption(add_caption_to_draft.pasted_text);
  new_screenshot text;
begin
  select * into draft from public.recipes r
  where r.id = add_caption_to_draft.recipe_id and r.owner_id = (select auth.uid()) and r.status = 'draft'
  for update;

  if not found then
    return 'gone';
  end if;
  if new_caption is null and not with_screenshot then
    raise exception 'paste a caption or add a screenshot' using errcode = '22023';
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
  if with_screenshot then
    new_screenshot := private.uploaded_screenshot_path(add_caption_to_draft.recipe_id);
  end if;

  update public.source_videos s
  set pasted_text = new_caption, screenshot_path = new_screenshot
  where s.recipe_id = add_caption_to_draft.recipe_id;

  update public.recipes r
  set build_status = 'building', build_failure = null, build_started_at = null, updated_at = now()
  where r.id = add_caption_to_draft.recipe_id;
  return 'retrying';
end;
$$;

revoke execute on function public.add_caption_to_draft(uuid, text, boolean) from public, anon;
grant execute on function public.add_caption_to_draft(uuid, text, boolean) to authenticated;
