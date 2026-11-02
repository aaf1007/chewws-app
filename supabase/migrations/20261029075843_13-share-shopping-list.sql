-- Ticket 13: sharing a Shopping List with chosen Friends (decisions 13). The owner shares their one
-- list with a Friend and can stop; the Friend can leave. While they're Friends, a Friend it's shared
-- with reads the list, adds hand items, checks off and unchecks anything, and removes hand-added
-- items. Only the owner removes Ingredient lines or adds and takes off Recipes (those stay on
-- private.my_shopping_list()). A Friend's check-off goes into the owner's Pantry, as check_off
-- already does. Unfriending ends sharing both ways. Every change to a list is announced, with no
-- content, on its private Realtime topic, which only those who may use the list can receive.

-- Shares ----------------------------------------------------------------------------------------------

-- One row per Friend a list is shared with. Users get no grants: the functions below read and
-- write it, so a share can only be made with a Friend.
create table public.shopping_list_shares (
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, friend_id)
);

create index shopping_list_shares_friend_idx on public.shopping_list_shares (friend_id);

alter table public.shopping_list_shares enable row level security;
revoke all on table public.shopping_list_shares from anon, authenticated;

-- Who may use a list stays one rule (decisions 13): its owner, or a Friend it's shared with, while
-- they're still Friends (private.are_friends). So unfriending cuts access at once, before the
-- trigger below has deleted the share. This form says it for anyone (`who`), for the functions
-- below that list who uses a list; nothing else restates it.
create function private.can_use_shopping_list(list_id uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shopping_lists l
    where l.id = can_use_shopping_list.list_id
      and (
        l.owner_id = can_use_shopping_list.who
        or (
          exists (
            select 1 from public.shopping_list_shares s
            where s.list_id = l.id and s.friend_id = can_use_shopping_list.who
          )
          and private.are_friends(l.owner_id, can_use_shopping_list.who)
        )
      )
  );
$$;

revoke execute on function private.can_use_shopping_list(uuid, uuid) from public, anon;
grant execute on function private.can_use_shopping_list(uuid, uuid) to authenticated;

-- The rule for the caller, as every policy and list function asks it.
create or replace function private.can_use_shopping_list(list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_use_shopping_list(can_use_shopping_list.list_id, (select auth.uid()));
$$;

-- The lock every change to a pair of users takes (as send_friend_request and unfriend do), so a
-- share made while the two are being unfriended waits for it, and then finds them not Friends.
create function private.lock_pair(a uuid, b uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('friendship:' || least(a, b)::text || greatest(a, b)::text, 0));
$$;

revoke execute on function private.lock_pair(uuid, uuid) from public, anon, authenticated;

-- Shares the caller's list with `friend_id`. Answers {status: 'shared' | 'notFriends'}: shared
-- (now, or already), or not done because they aren't Friends (or it's the caller).
create function public.share_shopping_list(friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  list uuid := private.my_shopping_list();
begin
  if me is null or list is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.lock_pair(me, share_shopping_list.friend_id);
  if share_shopping_list.friend_id is null or not private.are_friends(me, share_shopping_list.friend_id) then
    return jsonb_build_object('status', 'notFriends');
  end if;
  insert into public.shopping_list_shares (list_id, friend_id)
  values (list, share_shopping_list.friend_id)
  on conflict on constraint shopping_list_shares_pkey do nothing;
  return jsonb_build_object('status', 'shared');
end;
$$;

-- Stops sharing the caller's list with `friend_id`. Answers {status: 'stopped' | 'notShared'}: only
-- a share it deleted is `stopped`.
create function public.stop_sharing_shopping_list(friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.shopping_list_shares s
  where s.list_id = private.my_shopping_list() and s.friend_id = stop_sharing_shopping_list.friend_id;
  if found then
    return jsonb_build_object('status', 'stopped');
  end if;
  return jsonb_build_object('status', 'notShared');
end;
$$;

-- The caller leaves a list shared with them. Answers {status: 'left' | 'notShared'}: only a share it
-- deleted is `left`.
create function public.leave_shared_shopping_list(list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.shopping_list_shares s
  where s.list_id = leave_shared_shopping_list.list_id and s.friend_id = (select auth.uid());
  if found then
    return jsonb_build_object('status', 'left');
  end if;
  return jsonb_build_object('status', 'notShared');
end;
$$;

-- The Friends the caller's list is shared with, by username, with when it was shared.
create function public.list_shopping_list_shares()
returns table (friend_id uuid, username text, shared_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, s.created_at
  from public.shopping_list_shares s
  join public.profiles p on p.id = s.friend_id
  where s.list_id = private.my_shopping_list()
    and private.can_use_shopping_list(s.list_id, s.friend_id)
  order by p.username;
$$;

-- The lists shared with the caller by Friends, by the owner's username.
create function public.list_shared_shopping_lists()
returns table (list_id uuid, owner_id uuid, owner_username text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, p.id, p.username
  from public.shopping_list_shares s
  join public.shopping_lists l on l.id = s.list_id
  join public.profiles p on p.id = l.owner_id
  where s.friend_id = (select auth.uid())
    and private.can_use_shopping_list(l.id)
  order by p.username;
$$;

-- Who uses each list the caller may use: the owner, and the Friends it's shared with (while
-- they're Friends). Someone who checked an item off and isn't here any more shows as "a former
-- Friend". Read through the view below (a plain read, beside the list's), not as an RPC.
create function private.shopping_list_people()
returns table (list_id uuid, user_id uuid, username text, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with used as (
    select l.id, l.owner_id from public.shopping_lists l where l.owner_id = (select auth.uid())
    union all
    select l.id, l.owner_id
    from public.shopping_list_shares s join public.shopping_lists l on l.id = s.list_id
    where s.friend_id = (select auth.uid()) and private.can_use_shopping_list(l.id)
  )
  select u.id, p.id, p.username, true
  from used u join public.profiles p on p.id = u.owner_id
  union all
  select u.id, p.id, p.username, false
  from used u
  join public.shopping_list_shares s on s.list_id = u.id
  join public.profiles p on p.id = s.friend_id
  where private.can_use_shopping_list(u.id, s.friend_id);
$$;

revoke execute on function private.shopping_list_people() from public, anon;
grant execute on function private.shopping_list_people() to authenticated;

-- Runs as the caller (security_invoker), so it shows only what the function above gives them.
create view public.shopping_list_people with (security_invoker = true) as
  select people.list_id, people.user_id, people.username, people.is_owner
  from private.shopping_list_people() as people;

revoke all on public.shopping_list_people from anon, authenticated;
grant select on public.shopping_list_people to authenticated;

revoke execute on function public.share_shopping_list(uuid) from public, anon;
revoke execute on function public.stop_sharing_shopping_list(uuid) from public, anon;
revoke execute on function public.leave_shared_shopping_list(uuid) from public, anon;
revoke execute on function public.list_shopping_list_shares() from public, anon;
revoke execute on function public.list_shared_shopping_lists() from public, anon;
grant execute on function public.share_shopping_list(uuid) to authenticated;
grant execute on function public.stop_sharing_shopping_list(uuid) to authenticated;
grant execute on function public.leave_shared_shopping_list(uuid) to authenticated;
grant execute on function public.list_shopping_list_shares() to authenticated;
grant execute on function public.list_shared_shopping_lists() to authenticated;

-- Unfriending ends sharing both ways (decisions 11 and 13): each one's list stops being shared with
-- the other. Items the Friend added stay, and so does who checked them off.
create function private.end_shopping_list_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.shopping_list_shares s
  using public.shopping_lists l
  where s.list_id = l.id
    and ((l.owner_id = old.requester_id and s.friend_id = old.addressee_id)
      or (l.owner_id = old.addressee_id and s.friend_id = old.requester_id));
  return null;
end;
$$;

revoke execute on function private.end_shopping_list_shares() from public, anon, authenticated;

create trigger on_friendship_ended_shopping_list_shares
  after delete on public.friendships
  for each row execute function private.end_shopping_list_shares();

-- What a shared Friend may remove -----------------------------------------------------------------

-- The owner removes any item; a Friend the list is shared with only hand-added ones (decisions 13):
-- Ingredient lines come from the owner's Recipes and Pantry. Only the owner removes Recipe amounts.
drop policy "Users can remove items from Shopping Lists they use" on public.shopping_list_items;
drop policy "Users can remove Recipe amounts from Shopping Lists they use" on public.shopping_list_amounts;

create policy "Owners remove any item, shared Friends hand-added ones"
  on public.shopping_list_items for delete to authenticated
  using (
    list_id = private.my_shopping_list()
    or (hand_added_text is not null and private.can_use_shopping_list(list_id))
  );

create policy "Owners remove Recipe amounts from their Shopping List"
  on public.shopping_list_amounts for delete to authenticated
  using (exists (
    select 1 from public.shopping_list_items i
    where i.id = item_id and i.list_id = private.my_shopping_list()
  ));

-- Recipe titles on amounts ------------------------------------------------------------------------

-- A Friend on a shared list sees which Recipes need a line, but can't read the owner's Recipes
-- (spec L190), so each amount keeps its Recipe's title: copied from the Recipe as the amount is
-- written (whatever the insert says), and kept in step when the Recipe is renamed.
alter table public.shopping_list_amounts add column recipe_title text not null default '';
update public.shopping_list_amounts a set recipe_title = r.title from public.recipes r where r.id = a.recipe_id;

create function private.copy_shopping_list_recipe_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.recipe_title := coalesce((select r.title from public.recipes r where r.id = new.recipe_id), '');
  return new;
end;
$$;

revoke execute on function private.copy_shopping_list_recipe_title() from public, anon, authenticated;

create trigger copy_recipe_title
  before insert or update of recipe_id on public.shopping_list_amounts
  for each row execute function private.copy_shopping_list_recipe_title();

create function private.keep_shopping_list_recipe_titles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shopping_list_amounts a set recipe_title = new.title where a.recipe_id = new.id;
  return null;
end;
$$;

revoke execute on function private.keep_shopping_list_recipe_titles() from public, anon, authenticated;

create trigger on_recipe_title_changed_shopping_list
  after update of title on public.recipes
  for each row when (old.title is distinct from new.title)
  execute function private.keep_shopping_list_recipe_titles();

-- Live changes (Realtime Broadcast) ---------------------------------------------------------------

-- Each statement that changes a list's items, amounts or shares sends `changed`, with no content,
-- on the list's private topic `shopping_list:{id}`. The phone reads the list again; nothing about
-- the change itself is sent, so a message can't show anything RLS wouldn't. Not postgres_changes:
-- its DELETE events can't be filtered and aren't checked by RLS (decisions 13).
create function private.announce_shopping_lists(list_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed uuid;
begin
  for changed in select distinct id from unnest(list_ids) as id where id is not null loop
    perform realtime.send('{}'::jsonb, 'changed', 'shopping_list:' || changed::text, true);
  end loop;
end;
$$;

-- For items and shares, which name their list.
create function private.announce_shopping_list_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.announce_shopping_lists(array(select n.list_id from new_rows n));
  elsif tg_op = 'DELETE' then
    perform private.announce_shopping_lists(array(select o.list_id from old_rows o));
  else
    perform private.announce_shopping_lists(array(
      select n.list_id from new_rows n union select o.list_id from old_rows o
    ));
  end if;
  return null;
end;
$$;

-- For amounts, through their item. An amount deleted with its item is announced by the item.
create function private.announce_shopping_list_amounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.announce_shopping_lists(array(
      select i.list_id from new_rows n join public.shopping_list_items i on i.id = n.item_id
    ));
  elsif tg_op = 'DELETE' then
    perform private.announce_shopping_lists(array(
      select i.list_id from old_rows o join public.shopping_list_items i on i.id = o.item_id
    ));
  else
    perform private.announce_shopping_lists(array(
      select i.list_id from new_rows n join public.shopping_list_items i on i.id = n.item_id
    ));
  end if;
  return null;
end;
$$;

revoke execute on function private.announce_shopping_lists(uuid[]) from public, anon, authenticated;
revoke execute on function private.announce_shopping_list_rows() from public, anon, authenticated;
revoke execute on function private.announce_shopping_list_amounts() from public, anon, authenticated;

create trigger announce_inserted after insert on public.shopping_list_items
  referencing new table as new_rows for each statement execute function private.announce_shopping_list_rows();
create trigger announce_updated after update on public.shopping_list_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_shopping_list_rows();
create trigger announce_deleted after delete on public.shopping_list_items
  referencing old table as old_rows for each statement execute function private.announce_shopping_list_rows();

create trigger announce_inserted after insert on public.shopping_list_shares
  referencing new table as new_rows for each statement execute function private.announce_shopping_list_rows();
create trigger announce_updated after update on public.shopping_list_shares
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_shopping_list_rows();
create trigger announce_deleted after delete on public.shopping_list_shares
  referencing old table as old_rows for each statement execute function private.announce_shopping_list_rows();

create trigger announce_inserted after insert on public.shopping_list_amounts
  referencing new table as new_rows for each statement execute function private.announce_shopping_list_amounts();
create trigger announce_updated after update on public.shopping_list_amounts
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_shopping_list_amounts();
create trigger announce_deleted after delete on public.shopping_list_amounts
  referencing old table as old_rows for each statement execute function private.announce_shopping_list_amounts();

-- The list a Realtime topic names, if it's `shopping_list:{uuid}`; null for any other topic.
create function private.shopping_list_of_topic(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^shopping_list:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substr(topic, length('shopping_list:') + 1)::uuid
  end;
$$;

revoke execute on function private.shopping_list_of_topic(text) from public, anon;
grant execute on function private.shopping_list_of_topic(text) to authenticated;

-- Only those who may use a list receive its topic. Nobody may send on it: there's no insert policy,
-- so only the triggers above (security definer) announce changes. The Cook Plan list (ticket 15)
-- adds its own policy for its topics.
create policy "Users receive changes to the Shopping Lists they use"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_use_shopping_list(private.shopping_list_of_topic((select realtime.topic())))
  );
