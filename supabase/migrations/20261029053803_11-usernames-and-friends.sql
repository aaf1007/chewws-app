-- Ticket 11: usernames and Friends (decisions 11).

-- Usernames ----------------------------------------------------------------------------------------

-- A username is 3–20 lowercase ASCII letters, digits and _, with at least one letter. Null means the
-- user hasn't chosen one yet. Stored lowercase, so the existing unique is case-insensitive in effect.
alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,20}$' and username ~ '[a-z]');

-- For prefix search (search_users): `like 'abc%'` can use it whatever the database's collation.
create index profiles_username_prefix_idx on public.profiles (username text_pattern_ops);

-- A username as typed, the way the phone sends it: surrounding whitespace and one leading @ dropped,
-- lowercased. Whether the result is a valid username is checked separately.
create function private.normalise_username(typed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(regexp_replace(coalesce(typed, ''), '^\s+|\s+$', '', 'g'), '^@', ''));
$$;

-- Names nobody may take, refused like a taken one: they could pass for the app or its staff.
create function private.is_reserved_username(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name = any (array[
      'admin', 'administrator', 'support', 'help', 'root', 'system', 'staff', 'team', 'official',
      'moderator', 'mod', 'me', 'you', 'friend', 'friends', 'invite', 'api', 'www', 'app', 'settings',
      'profile', 'account', 'login', 'signup', 'null', 'undefined'
    ])
    or starts_with(name, 'recipeapp');
$$;

-- Sets (or changes) the caller's username. Answers {status: 'set' | 'taken' | 'reserved' |
-- 'invalid'} and never raises on a clash. The old name is free for anyone at once: Friendships and
-- requests refer to user ids.
create function public.set_username(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := private.normalise_username(set_username.name);
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if wanted !~ '^[a-z0-9_]{3,20}$' or wanted !~ '[a-z]' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if private.is_reserved_username(wanted) then
    return jsonb_build_object('status', 'reserved');
  end if;
  begin
    update public.profiles p set username = wanted where p.id = me;
  exception when unique_violation then
    return jsonb_build_object('status', 'taken');
  end;
  return jsonb_build_object('status', 'set', 'username', wanted);
end;
$$;

revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- Friendships ----------------------------------------------------------------------------------------

create type public.friendship_status as enum ('pending', 'accepted', 'declined');

-- One row per pair of users, whoever asked first. Accepted is mutual. Users have no grants here:
-- every read and write goes through the functions below, so a requester is never shown `declined`.
create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create unique index friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;
revoke all on table public.friendships from anon, authenticated;

-- The one rule for "is a Friend" (decisions 11): an accepted request between the two, either way.
-- Every visibility rule from here on calls this or friend_ids and restates nothing. Security
-- definer, so policies can call it as any user; the private schema isn't exposed through the Data
-- API, so nobody can probe arbitrary pairs.
create function private.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where least(f.requester_id, f.addressee_id) = least(a, b)
      and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
      and f.status = 'accepted'
  );
$$;

-- Everyone `who` is Friends with.
create function private.friend_ids(who uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.requester_id = who then f.addressee_id else f.requester_id end
  from public.friendships f
  where (f.requester_id = who or f.addressee_id = who)
    and private.are_friends(f.requester_id, f.addressee_id);
$$;

-- Whether the caller may see this Profile (its id and username): their own, a Friend's, and either
-- side of a request still open. The requester keeps seeing a request the other declined, as
-- pending, so a decline is never revealed. Cook Plan co-members join in ticket 14. Anyone else is
-- "not found", the same as an id that doesn't exist.
create function private.can_see_profile(id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select id = (select auth.uid())
    or private.are_friends((select auth.uid()), id)
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = (select auth.uid()) and f.addressee_id = can_see_profile.id
             and f.status in ('pending', 'declined'))
         or (f.addressee_id = (select auth.uid()) and f.requester_id = can_see_profile.id
             and f.status = 'pending')
    );
$$;

revoke execute on function private.are_friends(uuid, uuid) from public, anon;
revoke execute on function private.friend_ids(uuid) from public, anon;
revoke execute on function private.can_see_profile(uuid) from public, anon;
grant execute on function private.are_friends(uuid, uuid) to authenticated;
grant execute on function private.friend_ids(uuid) to authenticated;
grant execute on function private.can_see_profile(uuid) to authenticated;

-- Another user's Profile as the caller may see it: only id and username. No row when they may not
-- (or no such user). The profiles table itself stays readable only by its owner.
create function public.get_profile(user_id uuid)
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username from public.profiles p
  where p.id = get_profile.user_id and private.can_see_profile(p.id);
$$;

revoke execute on function public.get_profile(uuid) from public, anon;
grant execute on function public.get_profile(uuid) to authenticated;

-- Where the caller stands with `other`, as search shows it. A request of theirs the other declined
-- still reads requestSent.
create function private.relationship_with(other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when f.status = 'accepted' then 'friends'
      when f.requester_id = (select auth.uid()) then 'requestSent'
      when f.status = 'pending' then 'requestReceived'
      else 'none'
    end
    from public.friendships f
    where least(f.requester_id, f.addressee_id) = least((select auth.uid()), other)
      and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), other)
  ), 'none');
$$;

revoke execute on function private.relationship_with(uuid) from public, anon;
grant execute on function private.relationship_with(uuid) to authenticated;

-- Users whose username starts with the query (normalised like a username), exact match first, then
-- alphabetical, at most 10, never the caller or anyone without a username. Under 3 characters, or
-- anything no username could start with, finds nobody. It shows nothing but id and username.
create function public.search_users(query text)
returns table (id uuid, username text, relationship text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := private.normalise_username(search_users.query);
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if q !~ '^[a-z0-9_]{3,20}$' then
    return;
  end if;
  return query
    select p.id, p.username, private.relationship_with(p.id)
    from public.profiles p
    -- _ is a LIKE wildcard; escaped, it matches only itself.
    where p.username like replace(q, '_', '\_') || '%'
      and p.id <> auth.uid()
    order by p.username <> q, p.username
    limit 10;
end;
$$;

revoke execute on function public.search_users(text) from public, anon;
grant execute on function public.search_users(text) to authenticated;

-- Asks `user_id` to be Friends. Answers {status}:
--   requested       a request from the caller is pending now (new, or one already there, pending or
--                   declined: the caller can't tell those apart)
--   accepted        the other had already asked the caller, so both chose: they're Friends now
--   alreadyFriends
--   tooMany         the caller has 50 requests out already
--   notFound        no such user, the caller, or someone with no username (nobody can find them)
--   noUsername      the caller hasn't chosen a username yet
-- Requests the other declined count toward the 50 as pending ones do, so the count never shows one
-- was declined. A request of the other's that the caller declined is replaced by the caller's.
create function public.send_friend_request(user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_pending constant int := 50;
  me uuid := auth.uid();
  other uuid := send_friend_request.user_id;
  existing public.friendships;
  have_row boolean;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = me and p.username is not null) then
    return jsonb_build_object('status', 'noUsername');
  end if;
  if other is null or other = me
     or not exists (select 1 from public.profiles p where p.id = other and p.username is not null) then
    return jsonb_build_object('status', 'notFound');
  end if;

  -- One change at a time per pair (two people asking each other at once), and per sender (the cap).
  perform pg_advisory_xact_lock(hashtextextended('friendship:' || least(me, other)::text || greatest(me, other)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('friend_requests_from:' || me::text, 0));

  select * into existing from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(me, other)
    and greatest(f.requester_id, f.addressee_id) = greatest(me, other);
  have_row := found;

  if have_row and existing.status = 'accepted' then
    return jsonb_build_object('status', 'alreadyFriends');
  end if;
  if have_row and existing.requester_id = me then
    return jsonb_build_object('status', 'requested');
  end if;
  if have_row and existing.status = 'pending' then
    update public.friendships f set status = 'accepted', responded_at = now()
    where f.requester_id = other and f.addressee_id = me and f.status = 'pending';
    if found then
      return jsonb_build_object('status', 'accepted');
    end if;
    -- Gone meanwhile (it can't be, under the pair lock, but never answer a change not made).
    have_row := false;
  end if;

  if (select count(*) from public.friendships f
      where f.requester_id = me and f.status in ('pending', 'declined')) >= max_pending then
    return jsonb_build_object('status', 'tooMany');
  end if;

  if have_row then
    -- Theirs, which the caller declined: the caller asks afresh, and the other chooses again.
    delete from public.friendships f where f.requester_id = other and f.addressee_id = me;
  end if;
  insert into public.friendships (requester_id, addressee_id) values (me, other);
  return jsonb_build_object('status', 'requested');
end;
$$;

revoke execute on function public.send_friend_request(uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

-- Accepts or declines the pending request from `requester_id` to the caller. Answers {status:
-- 'accepted' | 'declined' | 'notFound'}; the same answer again is fine (a retried tap). A declined
-- request leaves the caller's list, and the requester still sees it as pending.
create function public.respond_to_friend_request(requester_id uuid, accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  answer public.friendship_status := case when accept then 'accepted' else 'declined' end;
  current_status public.friendship_status;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'friendship:' || least(me, respond_to_friend_request.requester_id)::text
      || greatest(me, respond_to_friend_request.requester_id)::text, 0));

  select f.status into current_status from public.friendships f
  where f.requester_id = respond_to_friend_request.requester_id and f.addressee_id = me;

  if current_status = 'pending' then
    update public.friendships f set status = answer, responded_at = now()
    where f.requester_id = respond_to_friend_request.requester_id and f.addressee_id = me
      and f.status = 'pending';
    -- Only an answer that was recorded is reported.
    if found then
      return jsonb_build_object('status', answer);
    end if;
    return jsonb_build_object('status', 'notFound');
  end if;
  if current_status = answer then
    return jsonb_build_object('status', answer);
  end if;
  return jsonb_build_object('status', 'notFound');
end;
$$;

revoke execute on function public.respond_to_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

-- Withdraws the caller's request to `user_id`, pending or declined alike. None is fine. It takes
-- the pair's lock as every change to a pair does, so an answer or a request back made meanwhile
-- waits for it and then sees the request gone.
create function public.cancel_friend_request(user_id uuid)
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
  perform pg_advisory_xact_lock(hashtextextended(
    'friendship:' || least(me, cancel_friend_request.user_id)::text
      || greatest(me, cancel_friend_request.user_id)::text, 0));
  delete from public.friendships f
  where f.requester_id = me
    and f.addressee_id = cancel_friend_request.user_id
    and f.status in ('pending', 'declined');
end;
$$;

revoke execute on function public.cancel_friend_request(uuid) from public, anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

-- Ends the Friendship between the caller and `user_id`, for both. Either may ask again later.
-- Not Friends is fine. Under the pair's lock, so a request made meanwhile waits and then asks anew.
create function public.unfriend(user_id uuid)
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
  perform pg_advisory_xact_lock(hashtextextended(
    'friendship:' || least(me, unfriend.user_id)::text || greatest(me, unfriend.user_id)::text, 0));
  delete from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(me, unfriend.user_id)
    and greatest(f.requester_id, f.addressee_id) = greatest(me, unfriend.user_id)
    and f.status = 'accepted';
end;
$$;

revoke execute on function public.unfriend(uuid) from public, anon;
grant execute on function public.unfriend(uuid) to authenticated;

-- The caller's Friends, by username, with when they became Friends.
create function public.list_friends()
returns table (id uuid, username text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, f.responded_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (f.requester_id = (select auth.uid()) or f.addressee_id = (select auth.uid()))
    and f.status = 'accepted'
  order by p.username;
$$;

revoke execute on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;

-- Requests to the caller still waiting for an answer (incoming), and the caller's own that haven't
-- been accepted (outgoing; one the other declined is still listed), newest first.
create function public.list_friend_requests()
returns table (id uuid, username text, direction text, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, 'incoming', f.created_at
  from public.friendships f join public.profiles p on p.id = f.requester_id
  where f.addressee_id = (select auth.uid()) and f.status = 'pending'
  union all
  select p.id, p.username, 'outgoing', f.created_at
  from public.friendships f join public.profiles p on p.id = f.addressee_id
  where f.requester_id = (select auth.uid()) and f.status in ('pending', 'declined')
  order by 4 desc, 2;
$$;

revoke execute on function public.list_friend_requests() from public, anon;
grant execute on function public.list_friend_requests() to authenticated;

-- The friend request push -----------------------------------------------------------------------------

-- Each "Friend request" push sent, for the 7-day limit per pair (user decisions 11–19, 3).
create table private.friend_request_pushes (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index friend_request_pushes_pair_idx on private.friend_request_pushes (
  least(requester_id, addressee_id), greatest(requester_id, addressee_id), sent_at
);

revoke all on table private.friend_request_pushes from public, anon, authenticated;

-- For the notify function (service role only), as `requester` asks to tell `addressee` about their
-- request: the requester's username and the addressee's push tokens, and the push is recorded. Null,
-- and nothing recorded, unless that request is pending (a declined one stays quiet), the addressee
-- has a phone to tell, and no push went to the pair, either way, in the last 7 days.
create function public.claim_friend_request_push(requester uuid, addressee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_name text;
  tokens jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'friend_request_push:' || least(requester, addressee)::text || greatest(requester, addressee)::text, 0));

  if not exists (
    select 1 from public.friendships f
    where f.requester_id = claim_friend_request_push.requester
      and f.addressee_id = claim_friend_request_push.addressee
      and f.status = 'pending'
  ) then
    return null;
  end if;
  if exists (
    select 1 from private.friend_request_pushes s
    where least(s.requester_id, s.addressee_id) = least(requester, addressee)
      and greatest(s.requester_id, s.addressee_id) = greatest(requester, addressee)
      and s.sent_at > now() - interval '7 days'
  ) then
    return null;
  end if;

  select p.username into requester_name from public.profiles p where p.id = requester;
  select jsonb_agg(t.token order by t.token) into tokens
  from public.push_tokens t where t.user_id = addressee;
  if requester_name is null or tokens is null then
    return null;
  end if;

  insert into private.friend_request_pushes (requester_id, addressee_id) values (requester, addressee);
  return jsonb_build_object('username', requester_name, 'tokens', tokens);
end;
$$;

revoke execute on function public.claim_friend_request_push(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_friend_request_push(uuid, uuid) to service_role;
