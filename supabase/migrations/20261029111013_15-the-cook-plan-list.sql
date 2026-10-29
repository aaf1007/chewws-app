-- Ticket 15: the Cook Plan list (decisions 15). Each plan has one list of every Ingredient its
-- Recipes need, one line per Ingredient with each Recipe's amounts kept apart, built by the list
-- engine as a Recipe is added. Each line shows which members already have it (their Pantry or
-- Staples, private.ingredients_had), computed on every read and limited to the plan's own lines.
-- Members Claim and unclaim lines and check them off; a check-off puts the Ingredient in the
-- checker's own Pantry. Every change a phone makes takes the time it was made, so the list works
-- offline as the Shopping List does (decisions 10): Claims and checks keep separate times, so one
-- never beats the other. When a Recipe leaves the plan (removed, or deleted by its owner), its
-- lines nobody has claimed or checked off go; claimed and checked ones stay, with its title.
-- Every change is announced, with no content, on the plan's private Realtime topic.
--
-- Every read and write of a line, an amount or who has it asks private.is_cook_plan_member, and so
-- does the Realtime topic's policy. There are no hand-added lines on a Cook Plan list.

create table public.cook_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cook_plans (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  -- Claimed while claimed_at is set; claimed_by is who, while they still have an account.
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  -- When a phone last claimed or unclaimed it, by that phone's clock (decisions 10, 15).
  claim_changed_at timestamptz,
  -- Checked off while checked_at is set; checked_by bought it, and has it in their Pantry.
  checked_at timestamptz,
  checked_by uuid references public.profiles (id) on delete set null,
  -- When a phone last checked or unchecked it, by that phone's clock.
  check_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cook_plan_items_one_line_per_ingredient unique (plan_id, ingredient_id),
  -- For the amounts' foreign key, which keeps an amount on its own plan's line.
  constraint cook_plan_items_of_plan unique (id, plan_id),
  constraint cook_plan_items_claim check (claimed_by is null or claimed_at is not null),
  constraint cook_plan_items_check check (checked_by is null or checked_at is not null)
);

-- Each Recipe's amounts on a line, in line order, never added together. While the Recipe is in the
-- plan, recipe_id names it (the foreign key to cook_plan_recipes); once it leaves, an amount kept
-- on a claimed or checked line has recipe_id null and shows as "{recipe_title} (removed)".
create table public.cook_plan_amounts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  plan_id uuid not null,
  recipe_id uuid,
  recipe_title text not null,
  amount_texts text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint cook_plan_amounts_item foreign key (item_id, plan_id)
    references public.cook_plan_items (id, plan_id) on delete cascade,
  constraint cook_plan_amounts_recipe foreign key (plan_id, recipe_id)
    references public.cook_plan_recipes (plan_id, recipe_id) on delete set null (recipe_id),
  constraint cook_plan_amounts_one_per_recipe unique (item_id, recipe_id)
);

create index cook_plan_amounts_item_idx on public.cook_plan_amounts (item_id);
create index cook_plan_amounts_recipe_idx on public.cook_plan_amounts (plan_id, recipe_id);

-- Members read; only the functions below write.
alter table public.cook_plan_items enable row level security;
alter table public.cook_plan_amounts enable row level security;
revoke all on table public.cook_plan_items from anon, authenticated;
revoke all on table public.cook_plan_amounts from anon, authenticated;
grant select on table public.cook_plan_items to authenticated;
grant select on table public.cook_plan_amounts to authenticated;

create policy "Members read their Cook Plans' lines"
  on public.cook_plan_items for select to authenticated
  using (private.is_cook_plan_member(plan_id));

create policy "Members read the Recipe amounts on their Cook Plans' lines"
  on public.cook_plan_amounts for select to authenticated
  using (private.is_cook_plan_member(plan_id));

-- Building the list ------------------------------------------------------------------------------

-- As in ticket 14, plus `lines`: the list engine's lines for the Recipe (toListLines with no skip,
-- decisions 15), a JSON array of {ingredient_id, amount_texts}. An Ingredient that isn't on one of
-- the Recipe's lines, or comes twice, is refused (22023), as add_recipe_to_shopping_list does. Each
-- joins the plan's line for it, or makes one, with this Recipe's amounts beside the others'; a
-- line's Claim and check are left as they are. Left out, `lines` is none.
drop function public.add_recipe_to_cook_plan(uuid, uuid);

create function public.add_recipe_to_cook_plan(plan_id uuid, recipe_id uuid, lines jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan_status public.cook_plan_status;
  recipe_title text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- Share-locks the Recipe, if it's the caller's reviewed one, so a delete of it waits for this add
  -- (and then takes the Recipe out of the plan again), or finishes first and it's not found.
  select r.title into recipe_title from public.recipes r
  where r.id = add_recipe_to_cook_plan.recipe_id and r.owner_id = me and r.status = 'reviewed'
  for key share;
  -- One change to a plan's Recipes at a time, so two adds can't both take its last place.
  select p.status into plan_status from public.cook_plans p where p.id = add_recipe_to_cook_plan.plan_id for update;
  if not found or not private.is_cook_plan_member(add_recipe_to_cook_plan.plan_id, me) then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'notActive');
  end if;
  -- Adding is the owner's: a member adds only their own Recipes (a write rule, not who may read).
  if recipe_title is null then
    return jsonb_build_object('status', 'noSuchRecipe');
  end if;
  if exists (
    select 1 from public.cook_plan_recipes pr
    where pr.plan_id = add_recipe_to_cook_plan.plan_id and pr.recipe_id = add_recipe_to_cook_plan.recipe_id
  ) then
    return jsonb_build_object('status', 'alreadyAdded');
  end if;
  if (select count(*) from public.cook_plan_recipes pr where pr.plan_id = add_recipe_to_cook_plan.plan_id) >= 10 then
    return jsonb_build_object('status', 'full');
  end if;
  if exists (
    select 1 from jsonb_array_elements(add_recipe_to_cook_plan.lines) as line
    where not exists (
      select 1 from public.recipe_lines rl
      where rl.recipe_id = add_recipe_to_cook_plan.recipe_id
        and rl.ingredient_id = (line ->> 'ingredient_id')::uuid
    )
  ) or (
    select count(*) <> count(distinct (line ->> 'ingredient_id')::uuid)
    from jsonb_array_elements(add_recipe_to_cook_plan.lines) as line
  ) then
    raise exception 'Only the Recipe''s own Ingredients can be added with it, each once.' using errcode = '22023';
  end if;

  insert into public.cook_plan_recipes (plan_id, recipe_id, added_by)
  values (add_recipe_to_cook_plan.plan_id, add_recipe_to_cook_plan.recipe_id, me)
  on conflict on constraint cook_plan_recipes_pkey do nothing;
  if not found then
    return jsonb_build_object('status', 'alreadyAdded');
  end if;

  -- Makes each missing line and locks every line it joins (in Ingredient order), so its amounts go
  -- onto lines nobody else can delete before this commits: a Recipe leaving meanwhile (the trigger
  -- below) waits for this, then finds the line needed.
  with needed as (
    insert into public.cook_plan_items as i (plan_id, ingredient_id)
    select add_recipe_to_cook_plan.plan_id, (line ->> 'ingredient_id')::uuid
    from jsonb_array_elements(add_recipe_to_cook_plan.lines) as line
    order by 2
    on conflict on constraint cook_plan_items_one_line_per_ingredient do update set updated_at = now()
    returning i.id, i.ingredient_id
  )
  insert into public.cook_plan_amounts (item_id, plan_id, recipe_id, recipe_title, amount_texts)
  select n.id,
    add_recipe_to_cook_plan.plan_id,
    add_recipe_to_cook_plan.recipe_id,
    recipe_title,
    array(select jsonb_array_elements_text(coalesce(line -> 'amount_texts', '[]'::jsonb)))
  from jsonb_array_elements(add_recipe_to_cook_plan.lines) as line
  join needed n on n.ingredient_id = (line ->> 'ingredient_id')::uuid;

  return jsonb_build_object('status', 'added');
end;
$$;

revoke execute on function public.add_recipe_to_cook_plan(uuid, uuid, jsonb) from public, anon;
grant execute on function public.add_recipe_to_cook_plan(uuid, uuid, jsonb) to authenticated;

-- A Recipe leaves a plan (removed by a member, or deleted by its owner, whose delete cascades
-- here): its amounts go from the lines nobody has claimed or checked off, and so does each such
-- line that no other Recipe needs. A claimed or checked line keeps its amount, which the foreign
-- key leaves with no recipe_id once this row is gone: "{title} (removed)". Runs before the row
-- goes, so it still finds the amounts by their Recipe.
create function private.remove_cook_plan_recipe_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched uuid[];
begin
  -- Its lines, locked in id order, before deciding what goes: a Claim, check-off or another
  -- Recipe's amount (an add) on one of them, made meanwhile, waits for this, or finishes first and
  -- is seen by the statements below, so the line stays.
  select array_agg(i.id order by i.id) into touched from (
    select i.id from public.cook_plan_items i
    where i.plan_id = old.plan_id
      and i.id in (
        select a.item_id from public.cook_plan_amounts a
        where a.plan_id = old.plan_id and a.recipe_id = old.recipe_id
      )
    order by i.id
    for update
  ) as i;

  delete from public.cook_plan_amounts a
  using public.cook_plan_items i
  where a.item_id = i.id
    and i.id = any (touched)
    and a.recipe_id = old.recipe_id
    and i.claimed_at is null
    and i.checked_at is null;

  delete from public.cook_plan_items i
  where i.id = any (touched)
    and i.claimed_at is null
    and i.checked_at is null
    and not exists (select 1 from public.cook_plan_amounts a where a.item_id = i.id);
  return old;
end;
$$;

revoke execute on function private.remove_cook_plan_recipe_lines() from public, anon, authenticated;

create trigger remove_cook_plan_recipe_lines
  before delete on public.cook_plan_recipes
  for each row execute function private.remove_cook_plan_recipe_lines();

-- Who has it -------------------------------------------------------------------------------------

-- Which members have each Ingredient on the plan's lines, by private.ingredients_had (their Pantry
-- or Staples, decisions 08), computed now: one (ingredient_id, user_id) row each. Nothing else of
-- anyone's Pantry, and nothing at all unless the caller is a member. Unfriended co-members still
-- see each other here (spec L235).
create function public.cook_plan_who_has(plan_id uuid)
returns table (ingredient_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select h.ingredient_id, h.user_id
  from public.cook_plan_members m
  cross join lateral private.ingredients_had(m.user_id) as h
  where m.plan_id = cook_plan_who_has.plan_id
    and private.is_cook_plan_member(cook_plan_who_has.plan_id)
    and h.ingredient_id in (
      select i.ingredient_id from public.cook_plan_items i where i.plan_id = cook_plan_who_has.plan_id
    )
  order by 1, 2;
$$;

revoke execute on function public.cook_plan_who_has(uuid) from public, anon;
grant execute on function public.cook_plan_who_has(uuid) to authenticated;

-- Changes a phone makes ----------------------------------------------------------------------------

-- Each takes the line's plan (the change is for that plan's list only) and when the change was made
-- (`changed_at`, by the phone's clock; no later than now, as in decisions 10), and answers
-- `applied`, `superseded` (a later change made on a phone stands; the phone reads the list again)
-- or `gone` (no such line on that plan, or the caller isn't a member of it now: the phone drops the
-- change). Claims compare with claim_changed_at and checks with check_changed_at, so a Claim made
-- earlier never beats someone's later check-off, nor the other way round. Once the plan is cooked
-- (ticket 18), Claims answer `gone`; checks still apply, so a check made offline in the store still
-- fills the buyer's Pantry.

-- Checks a line off. On the unchecked-to-checked change its Ingredient goes into the checker's own
-- Pantry (the buyer's, decisions 15): never the claimer's or the Recipe owner's. Checking off a
-- checked line keeps who checked it and when, but counts as its latest check. The Claim is untouched.
create function public.cook_plan_check_off(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(cook_plan_check_off.changed_at, now()), now());
  item public.cook_plan_items;
begin
  select * into item from public.cook_plan_items i
  where i.id = cook_plan_check_off.item_id
    and i.plan_id = cook_plan_check_off.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found then
    return 'gone';
  end if;
  if made_at < item.check_changed_at then
    return 'superseded';
  end if;

  update public.cook_plan_items i
  set checked_at = coalesce(i.checked_at, made_at),
      checked_by = case when i.checked_at is null then (select auth.uid()) else i.checked_by end,
      check_changed_at = made_at,
      updated_at = now()
  where i.id = item.id;
  if not found then
    return 'gone';
  end if;

  if item.checked_at is null then
    insert into public.pantry_entries (user_id, ingredient_id)
    values ((select auth.uid()), item.ingredient_id)
    on conflict do nothing;
  end if;
  return 'applied';
end;
$$;

-- Unchecks a line. The Pantry is left alone (decisions 09). The Claim is untouched.
create function public.cook_plan_uncheck(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(cook_plan_uncheck.changed_at, now()), now());
  item public.cook_plan_items;
begin
  select * into item from public.cook_plan_items i
  where i.id = cook_plan_uncheck.item_id
    and i.plan_id = cook_plan_uncheck.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found then
    return 'gone';
  end if;
  if made_at < item.check_changed_at then
    return 'superseded';
  end if;

  update public.cook_plan_items i
  set checked_at = null, checked_by = null, check_changed_at = made_at, updated_at = now()
  where i.id = item.id;
  if not found then
    return 'gone';
  end if;
  return 'applied';
end;
$$;

-- Claims a line for the caller ("I'm buying it"), taking over a Claim someone else holds. Claiming
-- a line already yours keeps when you claimed it, but counts as its latest Claim change.
create function public.claim_cook_plan_item(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(claim_cook_plan_item.changed_at, now()), now());
  item public.cook_plan_items;
begin
  select * into item from public.cook_plan_items i
  where i.id = claim_cook_plan_item.item_id
    and i.plan_id = claim_cook_plan_item.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found or (select p.status from public.cook_plans p where p.id = item.plan_id) <> 'active' then
    return 'gone';
  end if;
  if made_at < item.claim_changed_at then
    return 'superseded';
  end if;

  update public.cook_plan_items i
  set claimed_by = (select auth.uid()),
      claimed_at = case when i.claimed_by = (select auth.uid()) then i.claimed_at else made_at end,
      claim_changed_at = made_at,
      updated_at = now()
  where i.id = item.id;
  if not found then
    return 'gone';
  end if;
  return 'applied';
end;
$$;

-- Clears the caller's own Claim on a line. Anyone else's Claim, or none, answers `gone` and stays.
create function public.unclaim_cook_plan_item(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(unclaim_cook_plan_item.changed_at, now()), now());
  item public.cook_plan_items;
begin
  select * into item from public.cook_plan_items i
  where i.id = unclaim_cook_plan_item.item_id
    and i.plan_id = unclaim_cook_plan_item.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found or (select p.status from public.cook_plans p where p.id = item.plan_id) <> 'active' then
    return 'gone';
  end if;
  if made_at < item.claim_changed_at then
    return 'superseded';
  end if;

  update public.cook_plan_items i
  set claimed_by = null, claimed_at = null, claim_changed_at = made_at, updated_at = now()
  where i.id = item.id and i.claimed_by = (select auth.uid());
  if not found then
    return 'gone';
  end if;
  return 'applied';
end;
$$;

revoke execute on function public.cook_plan_check_off(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.cook_plan_uncheck(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.claim_cook_plan_item(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.unclaim_cook_plan_item(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.cook_plan_check_off(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.cook_plan_uncheck(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.claim_cook_plan_item(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.unclaim_cook_plan_item(uuid, uuid, timestamptz) to authenticated;

-- Live changes (Realtime Broadcast, as decisions 13) ----------------------------------------------

-- Each statement that changes a plan's lines, amounts, Recipes, members or the plan itself sends
-- `changed`, with no content, on the plan's private topic `cook_plan:{id}`. The phone reads the
-- plan's list again.
create function private.announce_cook_plans(plan_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed uuid;
begin
  for changed in select distinct id from unnest(plan_ids) as id where id is not null loop
    perform realtime.send('{}'::jsonb, 'changed', 'cook_plan:' || changed::text, true);
  end loop;
end;
$$;

-- For lines, amounts, Recipes and members, which name their plan.
create function private.announce_cook_plan_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.announce_cook_plans(array(select n.plan_id from new_rows n));
  elsif tg_op = 'DELETE' then
    perform private.announce_cook_plans(array(select o.plan_id from old_rows o));
  else
    perform private.announce_cook_plans(array(select n.plan_id from new_rows n union select o.plan_id from old_rows o));
  end if;
  return null;
end;
$$;

-- For the plan row itself (its day, its status).
create function private.announce_cook_plan_itself()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.announce_cook_plans(array(select o.id from old_rows o));
  else
    perform private.announce_cook_plans(array(select n.id from new_rows n));
  end if;
  return null;
end;
$$;

revoke execute on function private.announce_cook_plans(uuid[]) from public, anon, authenticated;
revoke execute on function private.announce_cook_plan_rows() from public, anon, authenticated;
revoke execute on function private.announce_cook_plan_itself() from public, anon, authenticated;

create trigger announce_inserted after insert on public.cook_plan_items
  referencing new table as new_rows for each statement execute function private.announce_cook_plan_rows();
create trigger announce_updated after update on public.cook_plan_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_cook_plan_rows();
create trigger announce_deleted after delete on public.cook_plan_items
  referencing old table as old_rows for each statement execute function private.announce_cook_plan_rows();

create trigger announce_inserted after insert on public.cook_plan_amounts
  referencing new table as new_rows for each statement execute function private.announce_cook_plan_rows();
create trigger announce_updated after update on public.cook_plan_amounts
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_cook_plan_rows();
create trigger announce_deleted after delete on public.cook_plan_amounts
  referencing old table as old_rows for each statement execute function private.announce_cook_plan_rows();

create trigger announce_inserted after insert on public.cook_plan_recipes
  referencing new table as new_rows for each statement execute function private.announce_cook_plan_rows();
create trigger announce_deleted after delete on public.cook_plan_recipes
  referencing old table as old_rows for each statement execute function private.announce_cook_plan_rows();

create trigger announce_inserted after insert on public.cook_plan_members
  referencing new table as new_rows for each statement execute function private.announce_cook_plan_rows();
create trigger announce_deleted after delete on public.cook_plan_members
  referencing old table as old_rows for each statement execute function private.announce_cook_plan_rows();

create trigger announce_updated after update on public.cook_plans
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.announce_cook_plan_itself();
create trigger announce_deleted after delete on public.cook_plans
  referencing old table as old_rows for each statement execute function private.announce_cook_plan_itself();

-- The plan a Realtime topic names, if it's `cook_plan:{uuid}`; null for any other topic.
create function private.cook_plan_of_topic(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^cook_plan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substr(topic, length('cook_plan:') + 1)::uuid
  end;
$$;

revoke execute on function private.cook_plan_of_topic(text) from public, anon;
grant execute on function private.cook_plan_of_topic(text) to authenticated;

-- Only members receive a plan's topic. Nobody may send on it: there's no insert policy, so only the
-- triggers above (security definer) announce changes.
create policy "Members receive changes to their Cook Plans"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.is_cook_plan_member(private.cook_plan_of_topic((select realtime.topic())))
  );
