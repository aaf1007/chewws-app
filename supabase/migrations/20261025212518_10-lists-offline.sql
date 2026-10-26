-- Ticket 10: list changes made with no signal. The phone queues each check, uncheck and hand-added
-- item with the time it was made, and sends them when it's back online. The functions that apply
-- them take that time as `changed_at` and compare it with the item's `phone_changed_at`, the time
-- (by its phone's clock) of the last change a phone made to it: a change made before that is older,
-- and is skipped (the later change wins, whichever arrives first). Only phone-made changes set
-- `phone_changed_at`; what the server does by itself (adding a Recipe's lines, unchecking a line a
-- new Recipe needs) stamps `updated_at` with the server's clock and never moves it, so a phone whose
-- clock runs behind the server isn't beaten by the server's own writes. Phone clocks are trusted
-- against each other (skew accepted), except that a change can't claim to be made after it reached
-- the server, so a phone whose clock runs ahead can't lock an item against everyone else's changes.
--
-- Leaving `changed_at` out means "now". check_off and uncheck say what became of the change:
-- `applied`, `superseded` (a later change made on a phone stands, so the phone reads the list
-- again), or `gone` (the item is gone, or the caller can't use it; the phone drops the change). An
-- add sent again for an item removed since (its first answer lost on the way back) says `gone` too:
-- removed items are recorded, so the add can't bring one back.

drop function public.check_off(uuid);
drop function public.uncheck(uuid);
drop function public.add_manual_item(text, text, uuid);

-- When a phone last changed the item (checked it, unchecked it, or added it by hand), by that
-- phone's clock. Null until one does.
alter table public.shopping_list_items add column phone_changed_at timestamptz;

-- The ids of items removed from each list, so a change sent again for one finds it gone. Written by
-- the trigger below and read by add_manual_item, both security definer; no API role can reach it
-- (the private schema isn't exposed, and nothing is granted).
create table private.removed_shopping_list_items (
  item_id uuid primary key,
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  removed_at timestamptz not null default now()
);

alter table private.removed_shopping_list_items enable row level security;
revoke all on table private.removed_shopping_list_items from public, anon, authenticated;

create function private.record_removed_shopping_list_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only while the list is there: deleting a list (or its owner) takes its items and the record.
  insert into private.removed_shopping_list_items (item_id, list_id)
  select old.id, l.id from public.shopping_lists l where l.id = old.list_id
  on conflict (item_id) do nothing;
  return null;
end;
$$;

revoke execute on function private.record_removed_shopping_list_item() from public, anon, authenticated;

create trigger record_removed
after delete on public.shopping_list_items
for each row execute function private.record_removed_shopping_list_item();

-- Checks an item off, unless a phone changed it after `changed_at`. If it was unchecked and has an
-- Ingredient, the Ingredient goes into the list owner's Pantry (whoever checks it off). Checking off
-- a checked item keeps who checked it and when, but counts as its latest change. Returns `applied`,
-- `superseded` or `gone` (see above).
create function public.check_off(item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(check_off.changed_at, now()), now());
  item public.shopping_list_items;
begin
  select * into item
  from public.shopping_list_items i
  where i.id = check_off.item_id and private.can_use_shopping_list(i.list_id)
  for update;

  if not found then
    return 'gone';
  end if;
  if made_at < item.phone_changed_at then
    return 'superseded';
  end if;

  update public.shopping_list_items i
  set checked_at = coalesce(i.checked_at, made_at),
      checked_by = case when i.checked_at is null then (select auth.uid()) else i.checked_by end,
      phone_changed_at = made_at,
      updated_at = now()
  where i.id = item.id;

  if item.checked_at is null and item.ingredient_id is not null then
    insert into public.pantry_entries (user_id, ingredient_id)
    select l.owner_id, item.ingredient_id from public.shopping_lists l where l.id = item.list_id
    on conflict do nothing;
  end if;
  return 'applied';
end;
$$;

-- Unchecks an item, unless a phone changed it after `changed_at`. The Pantry is left alone. Returns
-- `applied`, `superseded` or `gone` (see above).
create function public.uncheck(item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(uncheck.changed_at, now()), now());
  item public.shopping_list_items;
begin
  select * into item
  from public.shopping_list_items i
  where i.id = uncheck.item_id and private.can_use_shopping_list(i.list_id)
  for update;

  if not found then
    return 'gone';
  end if;
  if made_at < item.phone_changed_at then
    return 'superseded';
  end if;

  update public.shopping_list_items i
  set checked_at = null, checked_by = null, phone_changed_at = made_at, updated_at = now()
  where i.id = item.id;
  return 'applied';
end;
$$;

-- As in ticket 09, plus `changed_at`: the item counts as made by a phone then, so checks the phone
-- made after adding it (sent after it, in order) aren't older than the item itself. Says what became of the
-- item: `added` (it's on the caller's list, now or already), `gone` (it was, and has been removed
-- since, so it stays removed), `taken` (the id is another list's item), or null with no list.
create function public.add_manual_item(
  item_text text,
  ingredient_name text,
  item_id uuid default null,
  changed_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid := private.my_shopping_list();
  new_id uuid := coalesce(add_manual_item.item_id, gen_random_uuid());
  made_at timestamptz := least(coalesce(add_manual_item.changed_at, now()), now());
begin
  if list is null then
    return null;
  end if;
  -- A removal of this item still under way would record it only once it commits, after the check
  -- below has looked: wait for it, so the check sees it.
  perform 1 from public.shopping_list_items i where i.id = new_id and i.list_id = list for update;
  if exists (
    select 1 from private.removed_shopping_list_items r where r.item_id = new_id and r.list_id = list
  ) then
    return 'gone';
  end if;

  insert into public.shopping_list_items (id, list_id, hand_added_text, ingredient_id, phone_changed_at)
  values (
    new_id,
    list,
    btrim(item_text),
    (select i.id from public.ingredients i where i.name = add_manual_item.ingredient_name),
    made_at
  )
  on conflict (id) do nothing;

  if not exists (select 1 from public.shopping_list_items i where i.id = new_id and i.list_id = list) then
    return 'taken';
  end if;
  return 'added';
end;
$$;

revoke execute on function public.check_off(uuid, timestamptz) from public, anon;
revoke execute on function public.uncheck(uuid, timestamptz) from public, anon;
revoke execute on function public.add_manual_item(text, text, uuid, timestamptz) from public, anon;
grant execute on function public.check_off(uuid, timestamptz) to authenticated;
grant execute on function public.uncheck(uuid, timestamptz) to authenticated;
grant execute on function public.add_manual_item(text, text, uuid, timestamptz) to authenticated;
