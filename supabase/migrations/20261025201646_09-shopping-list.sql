-- Ticket 09: the Shopping List. One per user. Its items are either an Ingredient line, needed by
-- one or more of the user's Recipes with each Recipe's amounts kept apart (never added together),
-- or something the user added by hand, which may match an existing Ingredient. Checking an item off
-- puts its Ingredient, if it has one, in the list owner's Pantry.
--
-- Every write to items goes through the functions below, one item at a time and safe to repeat, so
-- the offline queue (ticket 10) can replay them. Who may use a list is one rule,
-- private.can_use_shopping_list, which ticket 13 widens to the Friends a list is shared with.

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.shopping_lists enable row level security;

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  -- An Ingredient line's Ingredient, or the Ingredient a hand-added item matched when it was added.
  ingredient_id uuid references public.ingredients (id),
  -- What the user typed, for a hand-added item; null for an Ingredient line.
  hand_added_text text check (hand_added_text is null or btrim(hand_added_text) <> ''),
  -- Checked off when checked_at is set. checked_by is who did it, while they still have an account.
  checked_at timestamptz,
  checked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hand_added_text is not null or ingredient_id is not null),
  check (checked_by is null or checked_at is not null)
);

-- One line per Ingredient on a list; hand-added items are their own lines.
create unique index shopping_list_items_ingredient_line_idx
  on public.shopping_list_items (list_id, ingredient_id)
  where hand_added_text is null;

alter table public.shopping_list_items enable row level security;

-- Which Recipes need an Ingredient line, and the amounts each Recipe's lines give for it, in line
-- order. A Recipe appears once per line it's on.
create table public.shopping_list_amounts (
  item_id uuid not null references public.shopping_list_items (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  amount_texts text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (item_id, recipe_id)
);

create index shopping_list_amounts_recipe_idx on public.shopping_list_amounts (recipe_id);

alter table public.shopping_list_amounts enable row level security;

-- The one rule for who may see and change a Shopping List and its items: its owner. Security
-- definer so the shopping_lists policy can call it without recursing; it names the caller itself.
create function private.can_use_shopping_list(list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shopping_lists l
    where l.id = can_use_shopping_list.list_id and l.owner_id = (select auth.uid())
  );
$$;

-- The caller's own Shopping List.
create function private.my_shopping_list()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.shopping_lists l where l.owner_id = (select auth.uid());
$$;

grant select on table public.shopping_lists to authenticated;
grant select, delete on table public.shopping_list_items to authenticated;
grant select, delete on table public.shopping_list_amounts to authenticated;

create policy "Users can read the Shopping Lists they use"
  on public.shopping_lists for select to authenticated
  using (private.can_use_shopping_list(id));

create policy "Users can read the items on Shopping Lists they use"
  on public.shopping_list_items for select to authenticated
  using (private.can_use_shopping_list(list_id));

create policy "Users can remove items from Shopping Lists they use"
  on public.shopping_list_items for delete to authenticated
  using (private.can_use_shopping_list(list_id));

create policy "Users can read the Recipe amounts on Shopping Lists they use"
  on public.shopping_list_amounts for select to authenticated
  using (exists (
    select 1 from public.shopping_list_items i
    where i.id = item_id and private.can_use_shopping_list(i.list_id)
  ));

create policy "Users can remove Recipe amounts from Shopping Lists they use"
  on public.shopping_list_amounts for delete to authenticated
  using (exists (
    select 1 from public.shopping_list_items i
    where i.id = item_id and private.can_use_shopping_list(i.list_id)
  ));

-- The writes. Each is security definer and checks private.can_use_shopping_list (or that the list
-- is the caller's own) itself, because a check-off writes the owner's Pantry, which the caller may
-- not be able to write (a Friend on a shared list, ticket 13). Ingredient names arrive already
-- normalised by the data layer's Ingredient matcher.

-- Adds one of the caller's Recipes to their list. `lines` is the list engine's output for it: a JSON
-- array of {ingredient_id, amount_texts}, already without the Ingredients the caller has. Each
-- Ingredient joins its existing line, or makes a new one; a line the Recipe is already on is left
-- alone, so adding a Recipe twice changes nothing. A checked-off line that a new Recipe needs is
-- needed again, so it's unchecked. Rows are written in id order, so concurrent adds can't deadlock.
-- Returns false when the caller has no such Recipe.
create function public.add_recipe_to_shopping_list(recipe_id uuid, lines jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid := private.my_shopping_list();
begin
  if list is null or not exists (
    select 1 from public.recipes r
    where r.id = add_recipe_to_shopping_list.recipe_id and r.owner_id = (select auth.uid())
  ) then
    return false;
  end if;

  insert into public.shopping_list_items (list_id, ingredient_id)
  select list, (line ->> 'ingredient_id')::uuid
  from jsonb_array_elements(lines) as line
  order by 2
  on conflict (list_id, ingredient_id) where hand_added_text is null do nothing;

  with added as (
    insert into public.shopping_list_amounts (item_id, recipe_id, amount_texts)
    select i.id,
      add_recipe_to_shopping_list.recipe_id,
      array(select jsonb_array_elements_text(line -> 'amount_texts'))
    from jsonb_array_elements(lines) as line
    join public.shopping_list_items i
      on i.list_id = list
      and i.ingredient_id = (line ->> 'ingredient_id')::uuid
      and i.hand_added_text is null
    order by i.id
    on conflict (item_id, recipe_id) do nothing
    returning item_id
  )
  update public.shopping_list_items i
  set checked_at = null, checked_by = null, updated_at = now()
  where i.id in (select a.item_id from added a) and i.checked_at is not null;

  return true;
end;
$$;

-- Adds something typed by hand to the caller's list. It's linked to the Ingredient of that name if
-- one exists; none is ever created, so "paper towels" stays text. `item_id` lets the phone choose
-- the id, so sending the same add twice adds it once. Returns the item's id, or null when that id
-- is already used on another list.
create function public.add_manual_item(item_text text, ingredient_name text, item_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid := private.my_shopping_list();
  new_id uuid := coalesce(add_manual_item.item_id, gen_random_uuid());
begin
  if list is null then
    return null;
  end if;

  insert into public.shopping_list_items (id, list_id, hand_added_text, ingredient_id)
  values (
    new_id,
    list,
    btrim(item_text),
    (select i.id from public.ingredients i where i.name = add_manual_item.ingredient_name)
  )
  on conflict (id) do nothing;

  if not exists (select 1 from public.shopping_list_items i where i.id = new_id and i.list_id = list) then
    return null;
  end if;
  return new_id;
end;
$$;

-- Checks an item off. If it was unchecked and has an Ingredient, the Ingredient goes into the list
-- owner's Pantry (whoever checks it off). Checking off a checked item changes nothing. Returns false
-- when the caller can't use the item.
create function public.check_off(item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid;
  ingredient uuid;
begin
  update public.shopping_list_items i
  set checked_at = now(), checked_by = (select auth.uid()), updated_at = now()
  where i.id = check_off.item_id and i.checked_at is null and private.can_use_shopping_list(i.list_id)
  returning i.list_id, i.ingredient_id into list, ingredient;

  if not found then
    return exists (
      select 1 from public.shopping_list_items i
      where i.id = check_off.item_id and private.can_use_shopping_list(i.list_id)
    );
  end if;

  if ingredient is not null then
    insert into public.pantry_entries (user_id, ingredient_id)
    select l.owner_id, ingredient from public.shopping_lists l where l.id = list
    on conflict do nothing;
  end if;
  return true;
end;
$$;

-- Unchecks an item. The Pantry is left alone. Returns false when the caller can't use the item.
create function public.uncheck(item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shopping_list_items i
  set checked_at = null, checked_by = null, updated_at = now()
  where i.id = uncheck.item_id and private.can_use_shopping_list(i.list_id);
  return found;
end;
$$;

-- Takes one Recipe off the caller's list: its amounts go, and so does every Ingredient line no
-- other Recipe needs, checked off or not. Locks the lines first, in id order, so two Recipes
-- removed at once can't each leave the other's last line behind.
create function public.remove_recipe_from_shopping_list(recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid := private.my_shopping_list();
  touched uuid[];
begin
  perform 1
  from public.shopping_list_items i
  where i.list_id = list
    and i.id in (
      select a.item_id from public.shopping_list_amounts a
      where a.recipe_id = remove_recipe_from_shopping_list.recipe_id
    )
  order by i.id
  for update;

  with gone as (
    delete from public.shopping_list_amounts a
    using public.shopping_list_items i
    where a.item_id = i.id and i.list_id = list and a.recipe_id = remove_recipe_from_shopping_list.recipe_id
    returning a.item_id
  )
  select array_agg(g.item_id) into touched from gone g;

  delete from public.shopping_list_items i
  where i.id = any (touched)
    and not exists (select 1 from public.shopping_list_amounts a where a.item_id = i.id);
end;
$$;

-- When a Recipe's amounts leave a line (the Recipe was deleted, or taken off the list), an
-- unchecked Ingredient line that no Recipe needs any more goes too. A checked-off one stays: it was
-- bought. Locks the line first, so two Recipes leaving it at once see each other's change.
create function private.remove_unneeded_shopping_list_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.shopping_list_items i where i.id = old.item_id for update;
  delete from public.shopping_list_items i
  where i.id = old.item_id
    and i.hand_added_text is null
    and i.checked_at is null
    and not exists (select 1 from public.shopping_list_amounts a where a.item_id = i.id);
  return old;
end;
$$;

create trigger on_shopping_list_amount_deleted
  after delete on public.shopping_list_amounts
  for each row execute function private.remove_unneeded_shopping_list_line();

revoke execute on function private.can_use_shopping_list(uuid) from public, anon;
revoke execute on function private.my_shopping_list() from public, anon;
revoke execute on function public.add_recipe_to_shopping_list(uuid, jsonb) from public, anon;
revoke execute on function public.add_manual_item(text, text, uuid) from public, anon;
revoke execute on function public.check_off(uuid) from public, anon;
revoke execute on function public.uncheck(uuid) from public, anon;
revoke execute on function public.remove_recipe_from_shopping_list(uuid) from public, anon;
revoke execute on function private.remove_unneeded_shopping_list_line() from public, anon, authenticated;
grant execute on function private.can_use_shopping_list(uuid) to authenticated;
grant execute on function private.my_shopping_list() to authenticated;
grant execute on function public.add_recipe_to_shopping_list(uuid, jsonb) to authenticated;
grant execute on function public.add_manual_item(text, text, uuid) to authenticated;
grant execute on function public.check_off(uuid) to authenticated;
grant execute on function public.uncheck(uuid) to authenticated;
grant execute on function public.remove_recipe_from_shopping_list(uuid) to authenticated;

-- Every new Profile gets its Shopping List. Runs inside the Profile insert, with no auth.uid().
create function public.create_shopping_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shopping_lists (owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_shopping_list() from public, anon, authenticated;

create trigger on_profile_created_shopping_list
  after insert on public.profiles
  for each row execute function public.create_shopping_list();

-- Backfill: Profiles made before this migration get a Shopping List too.
insert into public.shopping_lists (owner_id)
select p.id from public.profiles p
on conflict (owner_id) do nothing;
