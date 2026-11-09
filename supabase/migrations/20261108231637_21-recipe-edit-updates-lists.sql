-- Ticket 21: editing a Recipe updates its list lines (user decision 1 of 2026-11-08, decisions 21).
-- After an edit, every list the Recipe is on looks as if it had been taken off and put back: its
-- owner's Shopping List (shared with Friends or not) and every active Cook Plan it's in. Except:
-- checked-off lines stay, and so do Claims, and a line other Recipes still need keeps their
-- amounts. Cooked plans are read-only (ticket 18) and stay as they were; a copy is its own Recipe.
--
-- Nothing here restates a rule. The add and remove logic moves into private functions that the add
-- RPCs, the remove trigger and the edit all call: private.put_recipe_on_shopping_list (the body of
-- add_recipe_to_shopping_list), private.put_recipe_on_cook_plan_list (the lines half of
-- add_recipe_to_cook_plan) and private.take_recipe_off_cook_plan_lines (the remove trigger's body).
-- What a list line may carry for a Recipe is checked by one function, private.check_recipe_list_lines.
-- "Counts as present" is private.ingredients_had, on the Shopping List only, as when adding.
--
-- Locks, in the order every path takes them: the Recipe's row (the edit's update; a delete's), then
-- its owner's Shopping List lines in id order, then each plan it's in, in id order (the plan row
-- before its lines, as an add, a removal, a Claim and the remove trigger take them), then that
-- plan's lines in id order. Each decision about a line is made after it's locked, in a statement of
-- its own, so a check-off, Claim or removal made meanwhile waits, or finishes first and is seen.

-- What a list's lines may carry for a Recipe --------------------------------------------------------

-- `lines` is the list engine's output for one Recipe: a JSON array of {ingredient_id, amount_texts}.
-- Every Ingredient must be on one of the Recipe's lines (22023). `whole`: also each of them, once,
-- so a list never has part of the Recipe (the Cook Plan list, and an edit).
create function private.check_recipe_list_lines(recipe_id uuid, lines jsonb, whole boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from jsonb_array_elements(check_recipe_list_lines.lines) as line
    where not exists (
      select 1 from public.recipe_lines rl
      where rl.recipe_id = check_recipe_list_lines.recipe_id
        and rl.ingredient_id = (line ->> 'ingredient_id')::uuid
    )
  ) then
    raise exception 'Only the Recipe''s own Ingredients can be put on a list with it.' using errcode = '22023';
  end if;
  if whole and ((
    select count(*) <> count(distinct (line ->> 'ingredient_id')::uuid)
    from jsonb_array_elements(check_recipe_list_lines.lines) as line
  ) or exists (
    select 1 from public.recipe_lines rl
    where rl.recipe_id = check_recipe_list_lines.recipe_id
      and not exists (
        select 1 from jsonb_array_elements(check_recipe_list_lines.lines) as line
        where (line ->> 'ingredient_id')::uuid = rl.ingredient_id
      )
  )) then
    raise exception 'A Recipe goes on a list with each of its own Ingredients, once.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.check_recipe_list_lines(uuid, jsonb, boolean) from public, anon, authenticated;

-- The Shopping List -----------------------------------------------------------------------------

-- Puts a Recipe's `lines` (checked by the caller) on a Shopping List, as ticket 09 added them: the
-- Ingredients the list's owner has (private.ingredients_had, read now) are left off, and each other
-- one joins its line or makes one, with this Recipe's amounts beside the others'. Returns the
-- Ingredients it put the Recipe on the list for.
--
-- Adding (`editing` false): a line the Recipe is already on is left alone, so adding twice changes
-- nothing, and a checked-off line the Recipe needs is needed again, so it's unchecked.
--
-- Editing: only a Recipe that's on the list (it has amounts there) is changed; one taken off
-- meanwhile, or never put on, stays off. Its amounts change to the new ones, and leave the lines of
-- Ingredients it no longer needs, as when it's taken off: the trigger on_shopping_list_amount_deleted
-- then removes each such line left unchecked and needed by no other Recipe. Checked-off lines stay
-- checked: one it still needs keeps its amount, even though checking it off put it in the Pantry.
create function private.put_recipe_on_shopping_list(list uuid, recipe_id uuid, lines jsonb, editing boolean)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  list_owner uuid := (select l.owner_id from public.shopping_lists l where l.id = put_recipe_on_shopping_list.list);
  wanted jsonb;
  added_to uuid[];
begin
  -- Every line it could change, in id order, as removals lock them (so the two never deadlock), and
  -- before anything is decided: the lines for its Ingredients and, editing, the lines it's on now.
  -- A removal of a line still under way when it's made again below waits for this; a check-off or
  -- a removal of the Recipe made meanwhile finishes first and is seen, or waits for this.
  perform 1
  from public.shopping_list_items i
  where i.list_id = put_recipe_on_shopping_list.list
    and i.hand_added_text is null
    and (
      i.ingredient_id in (
        select (line ->> 'ingredient_id')::uuid from jsonb_array_elements(put_recipe_on_shopping_list.lines) as line
      )
      or (editing and i.id in (
        select a.item_id from public.shopping_list_amounts a where a.recipe_id = put_recipe_on_shopping_list.recipe_id
      ))
    )
  order by i.id
  for update;

  if editing and not exists (
    select 1 from public.shopping_list_amounts a
    join public.shopping_list_items i on i.id = a.item_id
    where i.list_id = put_recipe_on_shopping_list.list and a.recipe_id = put_recipe_on_shopping_list.recipe_id
  ) then
    return '{}';
  end if;

  select coalesce(jsonb_agg(line), '[]'::jsonb) into wanted
  from jsonb_array_elements(put_recipe_on_shopping_list.lines) as line
  where (line ->> 'ingredient_id')::uuid not in (select h.ingredient_id from private.ingredients_had(list_owner) h)
    or (editing and exists (
      select 1 from public.shopping_list_items i
      join public.shopping_list_amounts a on a.item_id = i.id
      where i.list_id = put_recipe_on_shopping_list.list
        and i.hand_added_text is null
        and i.ingredient_id = (line ->> 'ingredient_id')::uuid
        and i.checked_at is not null
        and a.recipe_id = put_recipe_on_shopping_list.recipe_id
    ));

  if editing then
    delete from public.shopping_list_amounts a
    using public.shopping_list_items i
    where a.item_id = i.id
      and i.list_id = put_recipe_on_shopping_list.list
      and a.recipe_id = put_recipe_on_shopping_list.recipe_id
      and i.ingredient_id not in (select (line ->> 'ingredient_id')::uuid from jsonb_array_elements(wanted) as line);
  end if;

  -- Makes each missing line (including one removed since the lock above) and locks every line, so
  -- the amounts below go onto rows nobody else can delete before this commits.
  with needed as (
    insert into public.shopping_list_items as i (list_id, ingredient_id)
    select put_recipe_on_shopping_list.list, (line ->> 'ingredient_id')::uuid
    from jsonb_array_elements(wanted) as line
    order by 2
    on conflict (list_id, ingredient_id) where hand_added_text is null
      do update set updated_at = i.updated_at
    returning i.id, i.ingredient_id
  ),
  added as (
    insert into public.shopping_list_amounts as a (item_id, recipe_id, amount_texts)
    select n.id,
      put_recipe_on_shopping_list.recipe_id,
      array(select jsonb_array_elements_text(line -> 'amount_texts'))
    from jsonb_array_elements(wanted) as line
    join needed n on n.ingredient_id = (line ->> 'ingredient_id')::uuid
    order by n.id
    on conflict (item_id, recipe_id) do update set amount_texts = excluded.amount_texts
      where editing and a.amount_texts is distinct from excluded.amount_texts
    returning a.item_id
  )
  select array_agg(x.item_id) into added_to from added x;

  if not editing then
    update public.shopping_list_items i
    set checked_at = null, checked_by = null, updated_at = now()
    where i.id = any (added_to) and i.checked_at is not null;
  end if;

  return array(select (line ->> 'ingredient_id')::uuid from jsonb_array_elements(wanted) as line);
end;
$$;

revoke execute on function private.put_recipe_on_shopping_list(uuid, uuid, jsonb, boolean) from public, anon, authenticated;

-- As in ticket 09, through the function above. The Recipe is share-locked first, so an edit made
-- meanwhile waits for this add and then changes the lines it put on the list, or goes first, and the
-- lines sent are checked against the edited Recipe.
create or replace function public.add_recipe_to_shopping_list(recipe_id uuid, lines jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  list uuid := private.my_shopping_list();
begin
  if list is null then
    return null;
  end if;
  perform 1 from public.recipes r
  where r.id = add_recipe_to_shopping_list.recipe_id and r.owner_id = (select auth.uid())
  for share;
  if not found then
    return null;
  end if;
  perform private.check_recipe_list_lines(add_recipe_to_shopping_list.recipe_id, add_recipe_to_shopping_list.lines, false);
  return private.put_recipe_on_shopping_list(list, add_recipe_to_shopping_list.recipe_id, add_recipe_to_shopping_list.lines, false);
end;
$$;

-- The Cook Plan list ----------------------------------------------------------------------------

-- Puts a Recipe's `lines` (checked whole by the caller, who holds the plan row) on a plan's list:
-- each joins the plan's line for its Ingredient, or makes one, with this Recipe's amounts beside the
-- others'; a line's Claim and check are left as they are. Amounts it already has there become the
-- new ones, with the Recipe's title as it is now (an edit). There's no Pantry skip (decisions 15).
create function private.put_recipe_on_cook_plan_list(plan_id uuid, recipe_id uuid, recipe_title text, lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Makes each missing line and locks every line it joins (in Ingredient order), so its amounts go
  -- onto lines nobody else can delete before this commits.
  with needed as (
    insert into public.cook_plan_items as i (plan_id, ingredient_id)
    select put_recipe_on_cook_plan_list.plan_id, (line ->> 'ingredient_id')::uuid
    from jsonb_array_elements(put_recipe_on_cook_plan_list.lines) as line
    order by 2
    on conflict on constraint cook_plan_items_one_line_per_ingredient do update set updated_at = now()
    returning i.id, i.ingredient_id
  )
  insert into public.cook_plan_amounts as a (item_id, plan_id, recipe_id, recipe_title, amount_texts)
  select n.id,
    put_recipe_on_cook_plan_list.plan_id,
    put_recipe_on_cook_plan_list.recipe_id,
    put_recipe_on_cook_plan_list.recipe_title,
    array(select jsonb_array_elements_text(coalesce(line -> 'amount_texts', '[]'::jsonb)))
  from jsonb_array_elements(put_recipe_on_cook_plan_list.lines) as line
  join needed n on n.ingredient_id = (line ->> 'ingredient_id')::uuid
  on conflict on constraint cook_plan_amounts_one_per_recipe do update
    set amount_texts = excluded.amount_texts, recipe_title = excluded.recipe_title
    where (a.amount_texts, a.recipe_title) is distinct from (excluded.amount_texts, excluded.recipe_title);
end;
$$;

revoke execute on function private.put_recipe_on_cook_plan_list(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- A Recipe's amounts leave a plan's lines, except those for the Ingredients in `keeping` (none when
-- it leaves the plan; those it still needs after an edit), as decisions 15 says: from the lines
-- nobody has claimed or checked off they go, and so does each such line no other Recipe needs; a
-- claimed or checked line keeps the amount with no Recipe, "{title} (removed)". The caller holds the
-- plan row. Its lines are locked in id order before deciding, so a Claim or check-off on one of them
-- made meanwhile waits for this, or finishes first and is seen by the statements below.
create function private.take_recipe_off_cook_plan_lines(plan_id uuid, recipe_id uuid, keeping uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched uuid[];
begin
  select array_agg(i.id order by i.id) into touched from (
    select i.id from public.cook_plan_items i
    where i.plan_id = take_recipe_off_cook_plan_lines.plan_id
      and not (i.ingredient_id = any (coalesce(take_recipe_off_cook_plan_lines.keeping, '{}')))
      and i.id in (
        select a.item_id from public.cook_plan_amounts a
        where a.plan_id = take_recipe_off_cook_plan_lines.plan_id
          and a.recipe_id = take_recipe_off_cook_plan_lines.recipe_id
      )
    order by i.id
    for update
  ) as i;

  delete from public.cook_plan_amounts a
  using public.cook_plan_items i
  where a.item_id = i.id
    and i.id = any (touched)
    and a.recipe_id = take_recipe_off_cook_plan_lines.recipe_id
    and i.claimed_at is null
    and i.checked_at is null;

  update public.cook_plan_amounts a
  set recipe_id = null
  where a.item_id = any (touched) and a.recipe_id = take_recipe_off_cook_plan_lines.recipe_id;

  delete from public.cook_plan_items i
  where i.id = any (touched)
    and i.claimed_at is null
    and i.checked_at is null
    and not exists (select 1 from public.cook_plan_amounts a where a.item_id = i.id);
end;
$$;

revoke execute on function private.take_recipe_off_cook_plan_lines(uuid, uuid, uuid[]) from public, anon, authenticated;

-- As in ticket 15, through the function above.
create or replace function private.remove_cook_plan_recipe_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The plan row first, as an add takes it before its lines: one change to a plan's Recipes at a
  -- time, so an add and a removal never lock shared lines in opposite orders (a deadlock).
  perform 1 from public.cook_plans p where p.id = old.plan_id for update;
  perform private.take_recipe_off_cook_plan_lines(old.plan_id, old.recipe_id, '{}');
  return old;
end;
$$;

-- As in ticket 15, with its lines put on the list by the function above, and the Recipe
-- share-locked (ticket 15 took a key-share lock): an edit made meanwhile waits for this add and
-- then changes the lines it added, or goes first, and the lines sent are checked against it.
create or replace function public.add_recipe_to_cook_plan(plan_id uuid, recipe_id uuid, lines jsonb default '[]'::jsonb)
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
  select r.title into recipe_title from public.recipes r
  where r.id = add_recipe_to_cook_plan.recipe_id and r.owner_id = me and r.status = 'reviewed'
  for share;
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
  perform private.check_recipe_list_lines(add_recipe_to_cook_plan.recipe_id, add_recipe_to_cook_plan.lines, true);

  insert into public.cook_plan_recipes (plan_id, recipe_id, added_by)
  values (add_recipe_to_cook_plan.plan_id, add_recipe_to_cook_plan.recipe_id, me)
  on conflict on constraint cook_plan_recipes_pkey do nothing;
  if not found then
    return jsonb_build_object('status', 'alreadyAdded');
  end if;

  perform private.put_recipe_on_cook_plan_list(
    add_recipe_to_cook_plan.plan_id, add_recipe_to_cook_plan.recipe_id, recipe_title, add_recipe_to_cook_plan.lines
  );
  return jsonb_build_object('status', 'added');
end;
$$;

-- The edit --------------------------------------------------------------------------------------

-- After its owner's edit has replaced a Recipe's lines: its lists follow it. `list_lines` is the
-- list engine's lines for the edited Recipe, by Ingredient name, as its lines are sent: a JSON array
-- of {ingredient_name, amount_texts}, each of its Ingredients once (22023 otherwise, and when it's
-- left out). Its owner's Shopping List takes them as an add would (the Pantry skip included); every
-- active Cook Plan it's in drops its amounts from the lines it no longer needs, as a removal would,
-- and takes them as an add would. Cooked plans stay as they were. Asks nothing of plan membership:
-- the Recipe is in the plan, and the owner may have left it (user decision 3 of 2026-11-08).
create function private.recipe_lines_edited(recipe_id uuid, list_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  editor uuid := auth.uid();
  recipe_owner uuid;
  recipe_title text;
  lines jsonb;
  owners_list uuid;
  plan uuid;
begin
  select r.owner_id, r.title into recipe_owner, recipe_title from public.recipes r where r.id = recipe_lines_edited.recipe_id;
  if recipe_owner is null or recipe_owner is distinct from editor then
    raise exception 'Only a Recipe''s owner edits it.' using errcode = '42501';
  end if;
  if list_lines is null then
    raise exception 'An edit is sent with the list engine''s lines for the edited Recipe.' using errcode = '22023';
  end if;

  -- The Ingredients by id, now that the edit has made any new one.
  select coalesce(jsonb_agg(jsonb_build_object(
    'ingredient_id', i.id,
    'amount_texts', coalesce(line -> 'amount_texts', '[]'::jsonb)
  )), '[]'::jsonb) into lines
  from jsonb_array_elements(recipe_lines_edited.list_lines) as line
  left join public.ingredients i on i.name = line ->> 'ingredient_name';
  perform private.check_recipe_list_lines(recipe_lines_edited.recipe_id, lines, true);

  -- The editor is the owner, so their list is the owner's.
  owners_list := private.my_shopping_list();
  if owners_list is not null then
    perform private.put_recipe_on_shopping_list(owners_list, recipe_lines_edited.recipe_id, lines, true);
  end if;

  -- The plans it's in, cooked ones too, locked in id order before any of their lines, so two edits,
  -- or an edit and a delete, never take two plans in opposite orders. A plan cooked meanwhile waits
  -- for this or is seen cooked below.
  perform 1 from public.cook_plans p
  where p.id in (select pr.plan_id from public.cook_plan_recipes pr where pr.recipe_id = recipe_lines_edited.recipe_id)
  order by p.id
  for update;
  for plan in
    select p.id from public.cook_plans p
    join public.cook_plan_recipes pr on pr.plan_id = p.id and pr.recipe_id = recipe_lines_edited.recipe_id
    where p.status = 'active'
    order by p.id
  loop
    perform private.take_recipe_off_cook_plan_lines(
      plan,
      recipe_lines_edited.recipe_id,
      array(select (line ->> 'ingredient_id')::uuid from jsonb_array_elements(lines) as line)
    );
    perform private.put_recipe_on_cook_plan_list(plan, recipe_lines_edited.recipe_id, recipe_title, lines);
  end loop;
end;
$$;

revoke execute on function private.recipe_lines_edited(uuid, jsonb) from public, anon;
grant execute on function private.recipe_lines_edited(uuid, jsonb) to authenticated;

-- Renaming a Recipe renames its amounts on every Shopping List (ticket 13's
-- on_recipe_title_changed_shopping_list), which locks them; a removal, and the deletion of a line,
-- lock the line first and then its amounts. So before the title changes, this takes the lines, in
-- id order: every line with the Recipe's amounts, on any list, and, on the renamer's own list, the
-- line of each Ingredient the Recipe now has, which an edit's put_recipe_on_shopping_list goes on to
-- take (taking that one later, out of order, could deadlock with an add or a removal holding it).
-- The Recipe row is locked before a before-update trigger runs, so the order stays the Recipe, then
-- its lines.
create function private.lock_retitled_recipe_lists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.shopping_list_items i
  where i.id in (select a.item_id from public.shopping_list_amounts a where a.recipe_id = new.id)
    or (
      i.list_id = private.my_shopping_list()
      and i.hand_added_text is null
      and i.ingredient_id in (select rl.ingredient_id from public.recipe_lines rl where rl.recipe_id = new.id)
    )
  order by i.id
  for update;
  return new;
end;
$$;

revoke execute on function private.lock_retitled_recipe_lists() from public, anon, authenticated;

create trigger lock_retitled_recipe_lists
  before update of title on public.recipes
  for each row when (old.title is distinct from new.title)
  execute function private.lock_retitled_recipe_lists();

-- As in ticket 02, plus `list_lines` (see above), after the lines are replaced. Still security
-- invoker: only the owner's update of the Recipe row passes, so anyone else's edit changes nothing
-- and answers null before reaching a list. The title changes after the lines are replaced, so
-- lock_retitled_recipe_lists takes the lines of the Ingredients the Recipe has after the edit.
drop function public.edit_recipe(uuid, text, text[], jsonb);

create function public.edit_recipe(recipe_id uuid, title text, steps text[], lines jsonb, list_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.recipes r
  set steps = edit_recipe.steps, updated_at = now()
  where r.id = edit_recipe.recipe_id;

  if not found then
    return null;
  end if;

  perform private.replace_recipe_lines(edit_recipe.recipe_id, lines);
  update public.recipes r set title = edit_recipe.title where r.id = edit_recipe.recipe_id;
  perform private.recipe_lines_edited(edit_recipe.recipe_id, list_lines);
  return edit_recipe.recipe_id;
end;
$$;

revoke execute on function public.edit_recipe(uuid, text, text[], jsonb, jsonb) from public, anon;
grant execute on function public.edit_recipe(uuid, text, text[], jsonb, jsonb) to authenticated;

-- Deleting a Recipe -------------------------------------------------------------------------------

-- Deleting a Recipe takes it off its lists through cascades whose triggers lock its Shopping List
-- lines and its plans one row at a time, in no set order. Taking them first, in the order an edit
-- takes them (Shopping List lines by id, then plans by id), means a delete never deadlocks with an
-- edit, or another delete, of a Recipe sharing its lines or plans.
create function private.lock_deleted_recipe_lists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.shopping_list_items i
  where i.id in (select a.item_id from public.shopping_list_amounts a where a.recipe_id = old.id)
  order by i.id
  for update;
  perform 1 from public.cook_plans p
  where p.id in (select pr.plan_id from public.cook_plan_recipes pr where pr.recipe_id = old.id)
  order by p.id
  for update;
  return old;
end;
$$;

revoke execute on function private.lock_deleted_recipe_lists() from public, anon, authenticated;

create trigger lock_deleted_recipe_lists
  before delete on public.recipes
  for each row execute function private.lock_deleted_recipe_lists();
