-- Ticket 19: Friend profiles (decisions 19, user decision 5). A Friend's profile shows their
-- username, "Friends since", their Ranking with Scores and their Cook Logs, and from it the user can
-- read and save their own copy of any Recipe the Friend has ranked or logged.
--
-- Widened in one place: private.can_read_recipe (ticket 14) is also true for a Recipe with a Cook
-- Log or a Ranking entry whose owner's activity the reader may see (private.can_see_activity_of,
-- ticket 17: themselves or a Friend). Everything that already asks it picks this up unchanged:
-- shared_recipe (the Recipe and its Source Video), the recipe_lines select policy, and copy_recipe.
-- The recipes and source_videos tables stay owner-only, so the owner's screenshot, pasted caption,
-- Want to Cook and Tags stay theirs (decisions 14, as built). Unfriending ends it at once.
--
-- Nothing else is new on the server: the profile's head is the caller's own Friends list
-- (list_friends), and the Ranking and Cook Logs are read through their own select policies.

-- The activity rule, for any reader ---------------------------------------------------------------

-- Whether `who` sees `owner`'s activity (their Cook Logs and Ranking): their own, or a Friend's.
-- Ticket 17's one-argument form asks this for the caller, so the rule is still written once.
create function private.can_see_activity_of(owner uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    can_see_activity_of.owner = can_see_activity_of.who
      or private.are_friends(can_see_activity_of.owner, can_see_activity_of.who),
    false
  );
$$;

revoke execute on function private.can_see_activity_of(uuid, uuid) from public, anon;
grant execute on function private.can_see_activity_of(uuid, uuid) to authenticated;

create or replace function private.can_see_activity_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_see_activity_of(can_see_activity_of.owner, (select auth.uid()));
$$;

-- The Recipe read rule, widened -------------------------------------------------------------------

-- Whether `who` may read the Recipe: its owner; a member of any Cook Plan it's in, active or cooked
-- (ticket 14); or anyone who sees the activity of someone who logged or ranked it (ticket 19: their
-- Friends). Reading means its title, lines, steps and Source Video, never its Tags, Want to Cook or
-- screenshot. Writes stay the owner's.
create or replace function private.can_read_recipe(recipe_id uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.recipes r
      where r.id = can_read_recipe.recipe_id and r.owner_id = can_read_recipe.who
    )
    or exists (
      select 1 from public.cook_plan_recipes pr
      where pr.recipe_id = can_read_recipe.recipe_id
        and private.is_cook_plan_member(pr.plan_id, can_read_recipe.who)
    )
    or exists (
      select 1 from public.cook_logs l
      where l.recipe_id = can_read_recipe.recipe_id
        and private.can_see_activity_of(l.user_id, can_read_recipe.who)
    )
    or exists (
      select 1 from public.ranking_entries e
      where e.recipe_id = can_read_recipe.recipe_id
        and private.can_see_activity_of(e.user_id, can_read_recipe.who)
    );
$$;

-- Titles of Recipes the caller may read ----------------------------------------------------------

-- The titles of those of these reviewed Recipes the caller may read, for a Friend's Ranking and Cook
-- Logs, whose Recipes the recipes table's owner-only policy hides. Nothing for the others.
create function public.recipe_titles(recipe_ids uuid[])
returns table (id uuid, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title from public.recipes r
  where r.id = any (recipe_titles.recipe_ids) and r.status = 'reviewed' and private.can_read_recipe(r.id);
$$;

revoke execute on function public.recipe_titles(uuid[]) from public, anon;
grant execute on function public.recipe_titles(uuid[]) to authenticated;

-- Your own copy, asked again once the Recipe is held -----------------------------------------------

-- Ticket 14's copy_recipe, with one change: once it holds the Recipe, it asks can_read_recipe again,
-- in a statement of its own, so it sees whatever it waited for. A copy that waited on the owner's
-- change to the Recipe (an edit, or deleting its last Cook Log, which takes it out of the Ranking
-- too) while the reason it could read it ended (that change, or an unfriend meanwhile) answers
-- notFound, rather than copying on the strength of what it read before it waited.
create or replace function public.copy_recipe(recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  original public.recipes;
  copy_id uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- Shared-locked, so an edit the owner is making finishes first, and the copy is one version of
  -- the Recipe: never the old title with the new lines.
  select * into original from public.recipes r
  where r.id = copy_recipe.recipe_id and r.status = 'reviewed' and private.can_read_recipe(r.id, me)
  for share;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  -- The lock may have been waited for; this statement reads what has committed since.
  if not private.can_read_recipe(original.id, me) then
    return jsonb_build_object('status', 'notFound');
  end if;

  insert into public.recipes (owner_id, title, steps, status, recipe_found, copied_from_recipe_id, copied_from_user_id)
  values (me, original.title, original.steps, 'reviewed', original.recipe_found, original.id, original.owner_id)
  returning id into copy_id;

  insert into public.recipe_lines (recipe_id, position, original_text, amount_text, ingredient_id)
  select copy_id, l.position, l.original_text, l.amount_text, l.ingredient_id
  from public.recipe_lines l where l.recipe_id = original.id;

  insert into public.source_videos (
    recipe_id, platform, original_url, external_id, creator_name, creator_url, caption, thumbnail_url, fetched_at
  )
  select copy_id, s.platform, s.original_url, s.external_id, s.creator_name, s.creator_url, s.caption,
    s.thumbnail_url, s.fetched_at
  from public.source_videos s where s.recipe_id = original.id;

  return jsonb_build_object('status', 'copied', 'recipeId', copy_id);
end;
$$;
