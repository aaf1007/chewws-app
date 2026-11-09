-- A plan's Recipes (ticket 14's cook_plan_recipe_list) asked can_read_recipe of every Recipe in
-- every Cook Plan, the caller's or not, before keeping the caller's: the planner joined Recipes to
-- all plans' rows and filtered them first. So each read of a plan grew with every plan anyone had
-- made. The caller's plans' rows are now found first (a materialized CTE the planner can't fold
-- in), and only those are asked. Same rows, same rules: nothing else changes.
create or replace function private.cook_plan_recipe_list()
returns table (
  plan_id uuid, recipe_id uuid, title text, owner_id uuid, owner_username text, added_by uuid, added_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as materialized (
    select pr.plan_id, pr.recipe_id, pr.added_by, pr.added_at
    from private.cook_plan_ids((select auth.uid())) as m (plan_id)
    join public.cook_plan_recipes pr on pr.plan_id = m.plan_id
  )
  select mine.plan_id, r.id, r.title, r.owner_id, case when private.can_see_profile(o.id) then o.username end,
    mine.added_by, mine.added_at
  from mine
  join public.recipes r on r.id = mine.recipe_id
  join public.profiles o on o.id = r.owner_id
  where private.can_read_recipe(r.id);
$$;
