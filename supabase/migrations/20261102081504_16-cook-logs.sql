-- Ticket 16: Cook Logs and the Saved/Cooked filter (decisions 16).
--
-- A user logs each time they cook one of their reviewed Recipes: the day, notes, up to 4 photos and
-- who they cooked with. A Recipe with a Cook Log is Cooked; one with none is Saved. Cooked is never
-- stored: it is whether a log exists, so deleting the last one makes the Recipe Saved again.
--
-- Two rules, each in one place:
--   private.can_read_cook_logs_of: who reads a user's Cook Logs, their companions and their photos:
--     the user and their Friends (private.are_friends), so unfriending ends it at once. The select
--     policies on cook_logs, cook_log_companions, cook_log_photos and the cook-log-photos bucket ask
--     it, and so does every read of companions' usernames. Ticket 19's Friend profile reads through it.
--   private.can_be_cook_log_companion: whom a user may log as cooked with: a Friend, or a co-member of
--     the Cook Plan the log came from (ticket 18), through are_friends and is_cook_plan_member. It is
--     asked only when a companion is added, so a companion stays on the log after an unfriend.
--
-- Users only read these tables. Every write goes through add_cook_log, edit_cook_log and
-- delete_cook_log, which check the rules, lock what they decide on, and answer what they did.

create table public.cook_logs (
  -- Made on the phone, so a save sent again (its answer lost) finds the log the first try made.
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  cooked_on date not null,
  notes text check (char_length(notes) <= 2000 and btrim(notes) <> ''),
  -- The Cook Plan it was logged from ("We cooked it", ticket 18); its co-members may be companions.
  cook_plan_id uuid references public.cook_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cook_logs_recipe_idx on public.cook_logs (recipe_id, cooked_on desc);
-- A user's logs newest first (ticket 19's Friend profile).
create index cook_logs_user_idx on public.cook_logs (user_id, cooked_on desc, created_at desc);

create table public.cook_log_companions (
  cook_log_id uuid not null references public.cook_logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (cook_log_id, user_id)
);

create index cook_log_companions_user_idx on public.cook_log_companions (user_id);

-- A photo is the user's own image in the private bucket cook-log-photos, at
-- {user id}/{cook log id}/{photo id}.jpg; this row says it belongs to the log, in what order.
create table public.cook_log_photos (
  id uuid primary key,
  cook_log_id uuid not null references public.cook_logs (id) on delete cascade,
  position int not null,
  created_at timestamptz not null default now(),
  unique (cook_log_id, position)
);

alter table public.cook_logs enable row level security;
alter table public.cook_log_companions enable row level security;
alter table public.cook_log_photos enable row level security;
revoke all on table public.cook_logs from anon, authenticated;
revoke all on table public.cook_log_companions from anon, authenticated;
revoke all on table public.cook_log_photos from anon, authenticated;
grant select on table public.cook_logs to authenticated;
grant select on table public.cook_log_companions to authenticated;
grant select on table public.cook_log_photos to authenticated;

-- The read rule ----------------------------------------------------------------------------------

-- Whether the caller may read `owner`'s Cook Logs, with their companions and photos: their own, or
-- a Friend's. The one rule for reading Cook Logs (decisions 16); nothing else restates it.
create function private.can_read_cook_logs_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    can_read_cook_logs_of.owner = (select auth.uid())
      or private.are_friends(can_read_cook_logs_of.owner, (select auth.uid())),
    false
  );
$$;

revoke execute on function private.can_read_cook_logs_of(uuid) from public, anon;
grant execute on function private.can_read_cook_logs_of(uuid) to authenticated;

create policy "Users and their Friends read their Cook Logs"
  on public.cook_logs for select to authenticated
  using (private.can_read_cook_logs_of(user_id));

create policy "Users and their Friends read who they cooked with"
  on public.cook_log_companions for select to authenticated
  using (private.can_read_cook_logs_of((select l.user_id from public.cook_logs l where l.id = cook_log_id)));

create policy "Users and their Friends read which photos are on their Cook Logs"
  on public.cook_log_photos for select to authenticated
  using (private.can_read_cook_logs_of((select l.user_id from public.cook_logs l where l.id = cook_log_id)));

-- The companion rule -----------------------------------------------------------------------------

-- Whether `logger` may log `companion` as cooked with them, on a log from Cook Plan `plan_id` (or
-- none): a Friend, or a co-member of that plan, Friends or not (spec L237). Never themselves.
create function private.can_be_cook_log_companion(logger uuid, companion uuid, plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select can_be_cook_log_companion.companion <> can_be_cook_log_companion.logger
    and (
      private.are_friends(can_be_cook_log_companion.logger, can_be_cook_log_companion.companion)
      or (
        can_be_cook_log_companion.plan_id is not null
        and private.is_cook_plan_member(can_be_cook_log_companion.plan_id, can_be_cook_log_companion.logger)
        and private.is_cook_plan_member(can_be_cook_log_companion.plan_id, can_be_cook_log_companion.companion)
      )
    );
$$;

revoke execute on function private.can_be_cook_log_companion(uuid, uuid, uuid) from public, anon, authenticated;

-- Photos -----------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cook-log-photos', 'cook-log-photos', false, 3145728, array['image/jpeg']);

-- Uploads go only into the user's own folder, as {user id}/{cook log id}/{photo id}.jpg.
create policy "Users upload Cook Log photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cook-log-photos'
    and name ~ ('^' || (select auth.uid())::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );

-- Read by the owner and their Friends: the read rule, on the folder's user. A name that doesn't
-- start with a user id names nobody's photo.
create policy "Users and their Friends read Cook Log photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cook-log-photos'
    and private.can_read_cook_logs_of(
      case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        then split_part(name, '/', 1)::uuid end
    )
  );

create policy "Users delete their own Cook Log photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cook-log-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Whether the caller uploaded a photo for their log first, at the one path it can have.
create function private.cook_log_photo_uploaded(cook_log_id uuid, photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'cook-log-photos'
      and o.name = (select auth.uid())::text || '/' || cook_log_photo_uploaded.cook_log_id::text
        || '/' || cook_log_photo_uploaded.photo_id::text || '.jpg'
  );
$$;

revoke execute on function private.cook_log_photo_uploaded(uuid, uuid) from public, anon, authenticated;

-- What the user typed ----------------------------------------------------------------------------

-- The day cooked, as the phone sent it. The phone allows up to its own tomorrow; with time zones
-- from UTC-12 to UTC+14 that is never later than two days after today in UTC.
create function private.cooked_on(day date)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if cooked_on.day is null or cooked_on.day > (now() at time zone 'utc')::date + 2 then
    raise exception 'a Cook Log can''t be dated later than tomorrow' using errcode = '22023';
  end if;
  return cooked_on.day;
end;
$$;

-- Notes as typed: trimmed, null when blank, refused when too long.
create function private.cook_log_notes(notes text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  trimmed text := nullif(btrim(cook_log_notes.notes), '');
begin
  if char_length(trimmed) > 2000 then
    raise exception 'the notes are too long' using errcode = '22001';
  end if;
  return trimmed;
end;
$$;

revoke execute on function private.cooked_on(date) from public, anon, authenticated;
revoke execute on function private.cook_log_notes(text) from public, anon, authenticated;

-- Writes -----------------------------------------------------------------------------------------

-- Logs one of the caller's reviewed Recipes, with the companions and the photos they uploaded first
-- (at most 4). `id` is made on the phone; the same id sent again finds the log the first try made.
-- Answers {status: 'added' | 'noSuchRecipe' | 'notReviewed' | 'noSuchCookPlan' | 'notCompanion'
-- (with userId) | 'photoNotUploaded'}. Only `added` saved anything.
create function public.add_cook_log(
  id uuid,
  recipe_id uuid,
  cooked_on date,
  notes text default null,
  companions uuid[] default '{}',
  photos uuid[] default '{}',
  cook_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  day date := private.cooked_on(add_cook_log.cooked_on);
  new_notes text := private.cook_log_notes(add_cook_log.notes);
  recipe_status public.recipe_status;
  existing public.cook_logs;
  companion uuid;
  photo uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  add_cook_log.companions := coalesce(add_cook_log.companions, '{}');
  add_cook_log.photos := coalesce(add_cook_log.photos, '{}');
  if cardinality(add_cook_log.photos) > 4 then
    raise exception 'a Cook Log has at most 4 photos' using errcode = '22023';
  end if;
  if (select count(distinct p) from unnest(add_cook_log.photos) as p) <> cardinality(add_cook_log.photos) then
    raise exception 'a photo is named twice' using errcode = '22023';
  end if;

  -- The Recipe is the caller's and reviewed. Held (shared) until this commits, so a delete of its
  -- last log, which takes it for update, waits and sees this log (decisions 16, ticket 17).
  select r.status into recipe_status from public.recipes r
  where r.id = add_cook_log.recipe_id and r.owner_id = me
  for share;
  if not found then
    return jsonb_build_object('status', 'noSuchRecipe');
  end if;
  if recipe_status <> 'reviewed' then
    return jsonb_build_object('status', 'notReviewed');
  end if;

  select * into existing from public.cook_logs l where l.id = add_cook_log.id;
  if found then
    if existing.user_id is distinct from me or existing.recipe_id <> add_cook_log.recipe_id then
      raise exception 'that Cook Log id is taken' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'added');
  end if;

  if add_cook_log.cook_plan_id is not null
    and not private.is_cook_plan_member(add_cook_log.cook_plan_id, me) then
    return jsonb_build_object('status', 'noSuchCookPlan');
  end if;
  foreach companion in array add_cook_log.companions loop
    if not private.can_be_cook_log_companion(me, companion, add_cook_log.cook_plan_id) then
      return jsonb_build_object('status', 'notCompanion', 'userId', companion);
    end if;
  end loop;
  foreach photo in array add_cook_log.photos loop
    if not private.cook_log_photo_uploaded(add_cook_log.id, photo) then
      return jsonb_build_object('status', 'photoNotUploaded');
    end if;
  end loop;

  insert into public.cook_logs (id, user_id, recipe_id, cooked_on, notes, cook_plan_id)
  values (add_cook_log.id, me, add_cook_log.recipe_id, day, new_notes, add_cook_log.cook_plan_id)
  on conflict on constraint cook_logs_pkey do nothing;
  if not found then
    -- The same save sent twice at once: the other try made it.
    return jsonb_build_object('status', 'added');
  end if;
  insert into public.cook_log_companions (cook_log_id, user_id)
  select add_cook_log.id, c from unnest(add_cook_log.companions) as c
  on conflict do nothing;
  insert into public.cook_log_photos (id, cook_log_id, position)
  select p.photo, add_cook_log.id, p.ord::int from unnest(add_cook_log.photos) with ordinality as p (photo, ord);
  return jsonb_build_object('status', 'added');
end;
$$;

revoke execute on function public.add_cook_log(uuid, uuid, date, text, uuid[], uuid[], uuid) from public, anon;
grant execute on function public.add_cook_log(uuid, uuid, date, text, uuid[], uuid[], uuid) to authenticated;

-- Changes one of the caller's Cook Logs, only in what the phone changed: a new day (null: as it
-- was), notes (null: as they were; blank clears them), companions added or removed, photos added
-- (uploaded first) or removed. A companion already on the log stays without being asked again, so
-- one unfriended since isn't dropped. At most 4 photos after. Answers {status: 'edited' | 'notFound'
-- | 'notCompanion' (with userId) | 'tooManyPhotos' | 'photoNotUploaded'}. Only `edited` changed it.
create function public.edit_cook_log(
  id uuid,
  cooked_on date default null,
  notes text default null,
  add_companions uuid[] default '{}',
  remove_companions uuid[] default '{}',
  add_photos uuid[] default '{}',
  remove_photos uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  found_log public.cook_logs;
  companion uuid;
  photo uuid;
  photos_after int;
  next_position int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  edit_cook_log.add_companions := coalesce(edit_cook_log.add_companions, '{}');
  edit_cook_log.remove_companions := coalesce(edit_cook_log.remove_companions, '{}');
  edit_cook_log.add_photos := coalesce(edit_cook_log.add_photos, '{}');
  edit_cook_log.remove_photos := coalesce(edit_cook_log.remove_photos, '{}');
  -- One change to a log at a time, so two edits can't both take its last photo places.
  select * into found_log from public.cook_logs l
  where l.id = edit_cook_log.id and l.user_id = me
  for update;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;

  foreach companion in array edit_cook_log.add_companions loop
    if not exists (
      select 1 from public.cook_log_companions c where c.cook_log_id = found_log.id and c.user_id = companion
    ) and not private.can_be_cook_log_companion(me, companion, found_log.cook_plan_id) then
      return jsonb_build_object('status', 'notCompanion', 'userId', companion);
    end if;
  end loop;

  select count(*) into photos_after from (
    select p.id from public.cook_log_photos p
    where p.cook_log_id = found_log.id and p.id <> all (edit_cook_log.remove_photos)
    union
    select a from unnest(edit_cook_log.add_photos) as a
  ) as kept;
  if photos_after > 4 then
    return jsonb_build_object('status', 'tooManyPhotos');
  end if;
  foreach photo in array edit_cook_log.add_photos loop
    if not exists (select 1 from public.cook_log_photos p where p.id = photo and p.cook_log_id = found_log.id)
      and not private.cook_log_photo_uploaded(found_log.id, photo) then
      return jsonb_build_object('status', 'photoNotUploaded');
    end if;
  end loop;

  update public.cook_logs l
  set cooked_on = case when edit_cook_log.cooked_on is null then l.cooked_on
                       else private.cooked_on(edit_cook_log.cooked_on) end,
      notes = case when edit_cook_log.notes is null then l.notes
                   else private.cook_log_notes(edit_cook_log.notes) end,
      updated_at = now()
  where l.id = found_log.id;

  delete from public.cook_log_companions c
  where c.cook_log_id = found_log.id and c.user_id = any (edit_cook_log.remove_companions);
  insert into public.cook_log_companions (cook_log_id, user_id)
  select found_log.id, c from unnest(edit_cook_log.add_companions) as c
  on conflict do nothing;

  delete from public.cook_log_photos p
  where p.cook_log_id = found_log.id and p.id = any (edit_cook_log.remove_photos);
  select coalesce(max(p.position), 0) into next_position from public.cook_log_photos p where p.cook_log_id = found_log.id;
  insert into public.cook_log_photos (id, cook_log_id, position)
  select a.photo, found_log.id, next_position + a.ord::int
  from unnest(edit_cook_log.add_photos) with ordinality as a (photo, ord)
  on conflict on constraint cook_log_photos_pkey do nothing;

  return jsonb_build_object('status', 'edited');
end;
$$;

revoke execute on function public.edit_cook_log(uuid, date, text, uuid[], uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.edit_cook_log(uuid, date, text, uuid[], uuid[], uuid[], uuid[]) to authenticated;

-- Deletes one of the caller's Cook Logs. Answers {status: 'deleted', recipe: 'cooked' | 'saved'},
-- whether its Recipe still has a log after, or {status: 'notFound'}. The Recipe is taken for update
-- first, so a log being added to it at the same moment is waited for and counted: the answer is
-- never 'saved' for a Recipe that ends Cooked (ticket 17 takes a Recipe left Saved out of the
-- Ranking here). Its photos are the phone's to remove from Storage after.
create function public.delete_cook_log(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  of_recipe uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select l.recipe_id into of_recipe from public.cook_logs l where l.id = delete_cook_log.id and l.user_id = me;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  perform 1 from public.recipes r where r.id = of_recipe for update;

  delete from public.cook_logs l where l.id = delete_cook_log.id and l.user_id = me;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  return jsonb_build_object(
    'status', 'deleted',
    'recipe', case when exists (select 1 from public.cook_logs l where l.recipe_id = of_recipe)
      then 'cooked' else 'saved' end
  );
end;
$$;

revoke execute on function public.delete_cook_log(uuid) from public, anon;
grant execute on function public.delete_cook_log(uuid) to authenticated;

-- Reads ------------------------------------------------------------------------------------------

-- Who was cooked with on these logs, by username, for the logs the caller may read (the read
-- rule). Companions needn't be the reader's Friends, so their Profiles aren't otherwise readable;
-- this shows only their id and username (decisions 16), which username search finds anyway.
create function public.cook_log_companion_list(cook_log_ids uuid[])
returns table (cook_log_id uuid, user_id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.cook_log_id, c.user_id, p.username
  from public.cook_log_companions c
  join public.cook_logs l on l.id = c.cook_log_id
  join public.profiles p on p.id = c.user_id
  where c.cook_log_id = any (cook_log_companion_list.cook_log_ids)
    and private.can_read_cook_logs_of(l.user_id)
  order by c.cook_log_id, p.username, c.user_id;
$$;

revoke execute on function public.cook_log_companion_list(uuid[]) from public, anon;
grant execute on function public.cook_log_companion_list(uuid[]) to authenticated;

-- Saved and Cooked (decisions 16): search_recipes (ticket 06) also takes `cooked`: true for the
-- Recipes with a Cook Log, false for those with none, null (as before) for both.
drop function public.search_recipes(jsonb, boolean);

create function public.search_recipes(
  words jsonb default '[]',
  want_to_cook_only boolean default false,
  cooked boolean default null
)
returns setof public.recipes
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from public.recipes r
  where r.status = 'reviewed'
    and (not search_recipes.want_to_cook_only or r.want_to_cook_at is not null)
    and (
      search_recipes.cooked is null
      or exists (select 1 from public.cook_logs l where l.recipe_id = r.id) = search_recipes.cooked
    )
    and not exists (
      select 1
      from jsonb_array_elements(search_recipes.words) as w (word)
      where not (
        strpos(private.search_text(r.title), w.word ->> 'text') > 0
        or exists (
          select 1 from public.recipe_tags rt
          join public.tags t on t.id = rt.tag_id
          where rt.recipe_id = r.id and strpos(private.search_text(t.name), w.word ->> 'text') > 0
        )
        or (coalesce(w.word ->> 'ingredient', '') <> '' and exists (
          select 1 from public.recipe_lines l
          join public.ingredients i on i.id = l.ingredient_id
          where l.recipe_id = r.id and strpos(i.name, w.word ->> 'ingredient') > 0
        ))
      )
    );
$$;

revoke execute on function public.search_recipes(jsonb, boolean, boolean) from public, anon;
grant execute on function public.search_recipes(jsonb, boolean, boolean) to authenticated;
