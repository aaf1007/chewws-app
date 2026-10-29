-- Ticket 07: push notifications ("Draft ready") and the daily limit of 30 link saves
-- (decisions 07).

-- One row per phone that may get notifications: its Expo push token, and whose phone it is now.
-- Users read their own; only the RPCs below write. A phone that changes hands moves to the user
-- who registers it last.
create table public.push_tokens (
  token text primary key
    check (length(token) <= 200 and token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
revoke all on table public.push_tokens from anon, authenticated;
grant select on table public.push_tokens to authenticated;

create policy "Users can read their own push tokens"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

-- Registers this phone's push token for the signed-in user, again on each app foreground (which
-- marks it seen). A token another user registered moves to this one.
create function public.register_push_token(token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, user_id)
  values (register_push_token.token, me)
  on conflict on constraint push_tokens_pkey do update
  set user_id = excluded.user_id,
      created_at = case when public.push_tokens.user_id = excluded.user_id
        then public.push_tokens.created_at else now() end,
      last_seen_at = now();
end;
$$;

revoke execute on function public.register_push_token(text) from public, anon;
grant execute on function public.register_push_token(text) to authenticated;

-- Signing out forgets this phone's token, if it's still the signed-in user's.
create function public.forget_push_token(token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.push_tokens p where p.token = forget_push_token.token and p.user_id = auth.uid();
end;
$$;

revoke execute on function public.forget_push_token(text) from public, anon;
grant execute on function public.forget_push_token(text) to authenticated;

-- For the Draft builder (service role only): the "Draft ready" push for a Draft it just finished,
-- its title and every token its owner has. Null when the Recipe is gone.
create function public.draft_ready_push(recipe_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', r.title,
    'tokens', coalesce(
      (select jsonb_agg(p.token order by p.token) from public.push_tokens p where p.user_id = r.owner_id),
      '[]'::jsonb
    )
  )
  from public.recipes r
  where r.id = draft_ready_push.recipe_id;
$$;

revoke execute on function public.draft_ready_push(uuid) from public, anon, authenticated;
grant execute on function public.draft_ready_push(uuid) to service_role;

-- For the Draft builder (service role only): tokens Expo reported as no longer registered
-- (DeviceNotRegistered: the app was deleted, or the phone turned notifications off for good).
create function public.forget_push_tokens(tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens p where p.token = any (forget_push_tokens.tokens);
$$;

revoke execute on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.forget_push_tokens(text[]) to service_role;

-- save_from_link (tickets 03, 05) now enforces the daily limit: at most 30 link saves per user in
-- any 24 hours (a rolling window). Every link save counts, and deleting a Draft doesn't give its
-- save back (link_saves outlive their Recipe). It takes a lock on the user first, so two saves at
-- once can't both be the 30th. A save sent again (its answer lost) finds the Draft its first try
-- made, as before, and is never refused: it was counted then. At the limit it makes nothing and
-- answers when the user can save again: when the save that would make room turns 24 hours old.
create or replace function public.save_from_link(
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
  daily_limit constant int := 30;
  me uuid := auth.uid();
  link text := btrim(save_from_link.url);
  new_caption text := private.pasted_caption(save_from_link.pasted_text);
  new_screenshot text;
  placeholder text;
  owner uuid;
  saves int;
  retry_at timestamptz;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if link !~* '^https?://[^/?#\s]+' then
    raise exception 'not a link: %', link using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('save_from_link:' || me::text, 0));

  select r.owner_id into owner from public.recipes r where r.id = save_from_link.recipe_id;
  if found then
    if owner is distinct from me then
      raise exception 'that Recipe id is taken' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'saved', 'recipeId', save_from_link.recipe_id);
  end if;

  select count(*) into saves
  from public.link_saves l
  where l.user_id = me and l.saved_at > now() - interval '24 hours';
  if saves >= daily_limit then
    select l.saved_at + interval '24 hours' into retry_at
    from public.link_saves l
    where l.user_id = me and l.saved_at > now() - interval '24 hours'
    order by l.saved_at desc
    offset daily_limit - 1
    limit 1;
    return jsonb_build_object('status', 'dailyLimitReached', 'limit', daily_limit, 'retryAt', retry_at);
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
  if not found then
    raise exception 'that Recipe id is taken' using errcode = '23505';
  end if;

  insert into public.source_videos (recipe_id, platform, original_url, pasted_text, screenshot_path)
  values (save_from_link.recipe_id, save_from_link.platform, link, new_caption, new_screenshot);
  insert into public.link_saves (user_id, recipe_id) values (me, save_from_link.recipe_id);

  return jsonb_build_object('status', 'saved', 'recipeId', save_from_link.recipe_id);
end;
$$;
