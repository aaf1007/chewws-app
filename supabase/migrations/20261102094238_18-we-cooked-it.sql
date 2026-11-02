-- Ticket 18: "We cooked it" (decisions 18). Any member marks a Cook Plan cooked, once and for
-- everyone: it moves to the archive (the Cooked section), read-only apart from checking lines off
-- and unchecking them (decisions 15). Each member is then prompted, in the app, to add a Cook Log
-- for each of its Recipes (ticket 16's add_cook_log with the plan's id, whose co-members may be
-- companions) and to rank it (ticket 17), until they've logged them all or tap "Not now", which is
-- theirs alone: cook_plan_members.prompt_dismissed_at. There's no push.
--
-- Nothing here decides who is in a plan, who is a Friend or who may read a Recipe: every function
-- asks private.is_cook_plan_member, and logging asks ticket 16's rules.
--
-- Lock order, as tickets 14 and 15: the plan row first, then its lines. Marking it cooked takes
-- the plan for update, as invites, adds, removals and date changes do, so each of them either
-- finishes first or waits and finds the plan cooked. Claims and unclaims now take the plan too
-- (key share, so they don't wait for each other), so a Claim made while the plan is being marked
-- cooked waits for it and answers `gone`, instead of reading it active a moment before.

-- "Not now": when this member dismissed the plan's prompt. Null while it still shows (for a cooked
-- plan they haven't logged every Recipe of). Each member's own; set only by them.
alter table public.cook_plan_members add column prompt_dismissed_at timestamptz;

-- Marking -----------------------------------------------------------------------------------------

-- A member marks the plan cooked, for every member at once: status, when and by whom. There's no
-- undo. Marking a cooked plan again changes nothing. Answers {status: 'cooked' | 'alreadyCooked' |
-- 'notFound' (not a plan of the caller's)}. Only `cooked` changed anything.
create function public.mark_cook_plan_cooked(plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan_status public.cook_plan_status;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- The plan's lock, as every change to it takes: two members marking it at once mark it once,
  -- and an invite, an add, a removal, a date change or a Claim made meanwhile waits or went first.
  select p.status into plan_status from public.cook_plans p
  where p.id = mark_cook_plan_cooked.plan_id and private.is_cook_plan_member(p.id, me)
  for update;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'alreadyCooked');
  end if;
  update public.cook_plans p
  set status = 'cooked', cooked_at = now(), cooked_by = me
  where p.id = mark_cook_plan_cooked.plan_id and p.status = 'active';
  if not found then
    return jsonb_build_object('status', 'alreadyCooked');
  end if;
  return jsonb_build_object('status', 'cooked');
end;
$$;

-- "Not now": the caller's prompt for a cooked plan goes, for them only. Dismissing it again keeps
-- when they first did. Answers {status: 'dismissed' | 'notCooked' (no prompt yet) | 'notFound'
-- (not a plan of the caller's)}. Only `dismissed` changed anything.
create function public.dismiss_cook_plan_prompt(plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_status public.cook_plan_status;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.status into plan_status from public.cook_plans p
  where p.id = dismiss_cook_plan_prompt.plan_id and private.is_cook_plan_member(p.id);
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'cooked' then
    return jsonb_build_object('status', 'notCooked');
  end if;
  update public.cook_plan_members m
  set prompt_dismissed_at = coalesce(m.prompt_dismissed_at, now())
  where m.plan_id = dismiss_cook_plan_prompt.plan_id and m.user_id = (select auth.uid());
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  return jsonb_build_object('status', 'dismissed');
end;
$$;

revoke execute on function public.mark_cook_plan_cooked(uuid) from public, anon;
revoke execute on function public.dismiss_cook_plan_prompt(uuid) from public, anon;
grant execute on function public.mark_cook_plan_cooked(uuid) to authenticated;
grant execute on function public.dismiss_cook_plan_prompt(uuid) to authenticated;

-- A cooked plan is read-only ------------------------------------------------------------------

-- As in ticket 14, but the plan is locked before its status is read, as adds and invites do, so a
-- removal made while the plan is being marked cooked waits and answers `notActive`, instead of
-- reading it active and taking the Recipe out of a cooked plan.
create or replace function public.remove_recipe_from_cook_plan(plan_id uuid, recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_status public.cook_plan_status;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.status into plan_status from public.cook_plans p
  where p.id = remove_recipe_from_cook_plan.plan_id and private.is_cook_plan_member(p.id)
  for update;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'notActive');
  end if;
  delete from public.cook_plan_recipes pr
  where pr.plan_id = remove_recipe_from_cook_plan.plan_id and pr.recipe_id = remove_recipe_from_cook_plan.recipe_id;
  if not found then
    return jsonb_build_object('status', 'notInPlan');
  end if;
  return jsonb_build_object('status', 'removed');
end;
$$;

-- As in ticket 15, but the plan is read under a key-share lock first (plan, then line, the order
-- every change to a plan's lines takes), so marking the plan cooked can't land between reading it
-- active and claiming: the Claim waits for it and answers `gone`, or goes first.
create or replace function public.claim_cook_plan_item(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(claim_cook_plan_item.changed_at, now()), now());
  plan_status public.cook_plan_status;
  item public.cook_plan_items;
begin
  select p.status into plan_status from public.cook_plans p
  where p.id = claim_cook_plan_item.plan_id and private.is_cook_plan_member(p.id)
  for key share;
  if not found or plan_status <> 'active' then
    return 'gone';
  end if;
  select * into item from public.cook_plan_items i
  where i.id = claim_cook_plan_item.item_id
    and i.plan_id = claim_cook_plan_item.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found then
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

-- As in ticket 15, with the plan read under a key-share lock first, as claim_cook_plan_item.
create or replace function public.unclaim_cook_plan_item(plan_id uuid, item_id uuid, changed_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := least(coalesce(unclaim_cook_plan_item.changed_at, now()), now());
  plan_status public.cook_plan_status;
  item public.cook_plan_items;
begin
  select p.status into plan_status from public.cook_plans p
  where p.id = unclaim_cook_plan_item.plan_id and private.is_cook_plan_member(p.id)
  for key share;
  if not found or plan_status <> 'active' then
    return 'gone';
  end if;
  select * into item from public.cook_plan_items i
  where i.id = unclaim_cook_plan_item.item_id
    and i.plan_id = unclaim_cook_plan_item.plan_id
    and private.is_cook_plan_member(i.plan_id)
  for update;
  if not found then
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
  perform private.drop_cook_plan_line_if_unneeded(item.id);
  return 'applied';
end;
$$;

-- The archive ------------------------------------------------------------------------------------

-- The plans the caller is in: the active ones newest first, then the cooked ones (the archive),
-- most recently cooked first.
create or replace function public.list_cook_plans()
returns setof public.cook_plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.cook_plans p
  where p.id in (select private.cook_plan_ids((select auth.uid())))
  order by p.status, p.cooked_at desc, p.created_at desc, p.id;
$$;
