-- Ticket 14: Cook Plans (decisions 14). A user starts a plan, with an optional date, and invites
-- their own Friends, who are members at once and get a push. Any member adds one of their own
-- reviewed Recipes, or removes any Recipe, with no voting. Every member reads every Recipe in the
-- plan and can save their own copy of it (ADR-0002). Members leave when they like; the plan goes
-- with its last member. Unfriended co-members both stay, but neither can invite the other again.
--
-- Two rules, each in one place:
--   private.is_cook_plan_member: who is in a plan (cook_plan_ids is its list form, and asks it).
--   private.can_read_recipe: who may read a Recipe; its owner, or a member of a plan it's in.
--     Ticket 19 widens it. The lines' and Source Videos' select policies ask it, and another
--     user's Recipe itself is read through shared_recipe, which asks it too. The recipes table's
--     own select policy stays owner-only: its rows carry Want to Cook and the Draft builder's
--     suggested Tags, which members never see (decisions 14), and RLS can't hide a column.

create type public.cook_plan_status as enum ('active', 'cooked');

-- No title: a plan shows as its Recipes' titles, its members and its date. `cook_on` is a calendar
-- day with no time or zone. Ticket 18 sets status, cooked_at and cooked_by.
create table public.cook_plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.profiles (id) on delete set null,
  cook_on date,
  status public.cook_plan_status not null default 'active',
  cooked_at timestamptz,
  cooked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cook_plans_cooked_at check ((status = 'cooked') = (cooked_at is not null)),
  constraint cook_plans_cooked_by check (status = 'cooked' or cooked_by is null)
);

create table public.cook_plan_members (
  plan_id uuid not null references public.cook_plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create index cook_plan_members_user_idx on public.cook_plan_members (user_id);

create table public.cook_plan_recipes (
  plan_id uuid not null references public.cook_plans (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (plan_id, recipe_id)
);

create index cook_plan_recipes_recipe_idx on public.cook_plan_recipes (recipe_id);

-- Members read; only the functions below write.
alter table public.cook_plans enable row level security;
alter table public.cook_plan_members enable row level security;
alter table public.cook_plan_recipes enable row level security;
revoke all on table public.cook_plans from anon, authenticated;
revoke all on table public.cook_plan_members from anon, authenticated;
revoke all on table public.cook_plan_recipes from anon, authenticated;
grant select on table public.cook_plans to authenticated;
grant select on table public.cook_plan_members to authenticated;
grant select on table public.cook_plan_recipes to authenticated;

-- A copy keeps where it came from, for display only ("Saved from @sam"). Only copy_recipe sets them.
alter table public.recipes
  add column copied_from_recipe_id uuid references public.recipes (id) on delete set null,
  add column copied_from_user_id uuid references public.profiles (id) on delete set null;

create index recipes_copied_from_idx on public.recipes (owner_id, copied_from_recipe_id)
  where copied_from_recipe_id is not null;

-- The membership rule --------------------------------------------------------------------------

-- Whether `who` is a member of the plan. The one membership rule (decisions 14): every policy and
-- function asks this, and nothing else matches a user against cook_plan_members.
create function private.is_cook_plan_member(plan_id uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cook_plan_members m
    where m.plan_id = is_cook_plan_member.plan_id and m.user_id = is_cook_plan_member.who
  );
$$;

-- The rule for the caller, as the policies ask it.
create function private.is_cook_plan_member(plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_cook_plan_member(is_cook_plan_member.plan_id, (select auth.uid()));
$$;

-- The plans `who` is a member of: the rule's list form, as friend_ids is are_friends'.
create function private.cook_plan_ids(who uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.plan_id from public.cook_plan_members m
  where m.user_id = cook_plan_ids.who and private.is_cook_plan_member(m.plan_id, cook_plan_ids.who);
$$;

revoke execute on function private.is_cook_plan_member(uuid, uuid) from public, anon;
revoke execute on function private.is_cook_plan_member(uuid) from public, anon;
revoke execute on function private.cook_plan_ids(uuid) from public, anon;
grant execute on function private.is_cook_plan_member(uuid, uuid) to authenticated;
grant execute on function private.is_cook_plan_member(uuid) to authenticated;
grant execute on function private.cook_plan_ids(uuid) to authenticated;

create policy "Members read their Cook Plans"
  on public.cook_plans for select to authenticated
  using (private.is_cook_plan_member(id));

create policy "Members read who is in their Cook Plans"
  on public.cook_plan_members for select to authenticated
  using (private.is_cook_plan_member(plan_id));

create policy "Members read which Recipes are in their Cook Plans"
  on public.cook_plan_recipes for select to authenticated
  using (private.is_cook_plan_member(plan_id));

-- Co-members of a Cook Plan see each other's Profile (decisions 11), Friends or not.
create or replace function private.can_see_profile(id uuid)
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
    )
    or exists (
      select 1 from private.cook_plan_ids((select auth.uid())) as mine (plan_id)
      where private.is_cook_plan_member(mine.plan_id, can_see_profile.id)
    );
$$;

-- The Recipe read rule ---------------------------------------------------------------------------

-- Whether `who` may read the Recipe: its owner, or a member of any Cook Plan it's in, active or
-- cooked. The one rule for reading another user's Recipe (decisions 14; ticket 19 widens it).
-- Reading means its title, lines, steps and Source Video, never its Tags, Want to Cook or
-- screenshot. Writes stay the owner's.
create function private.can_read_recipe(recipe_id uuid, who uuid)
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
    );
$$;

create function private.can_read_recipe(recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_recipe(can_read_recipe.recipe_id, (select auth.uid()));
$$;

revoke execute on function private.can_read_recipe(uuid, uuid) from public, anon;
revoke execute on function private.can_read_recipe(uuid) from public, anon;
grant execute on function private.can_read_recipe(uuid, uuid) to authenticated;
grant execute on function private.can_read_recipe(uuid) to authenticated;

drop policy "Owners can read their Recipes' lines" on public.recipe_lines;
create policy "Users read the lines of Recipes they may read"
  on public.recipe_lines for select to authenticated
  using (private.can_read_recipe(recipe_id));

drop policy "Owners can read their Recipes' Source Videos" on public.source_videos;
create policy "Users read the Source Videos of Recipes they may read"
  on public.source_videos for select to authenticated
  using (private.can_read_recipe(recipe_id));

-- Another user's reviewed Recipe, as the caller may read it: no Tags, Want to Cook, suggested Tags
-- or build state. The owner's username only while the caller may see their Profile. No row when
-- they may not read it (or it's a Draft, or there's no such Recipe).
create function public.shared_recipe(recipe_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  owner_username text,
  title text,
  steps text[],
  recipe_found boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.owner_id, case when private.can_see_profile(p.id) then p.username end,
    r.title, r.steps, r.recipe_found, r.created_at, r.updated_at
  from public.recipes r
  join public.profiles p on p.id = r.owner_id
  where r.id = shared_recipe.recipe_id and r.status = 'reviewed' and private.can_read_recipe(r.id);
$$;

revoke execute on function public.shared_recipe(uuid) from public, anon;
grant execute on function public.shared_recipe(uuid) to authenticated;

-- Your own copy (ADR-0002) -----------------------------------------------------------------------

-- Saves the caller's own copy of a reviewed Recipe they may read: a reviewed Recipe of theirs with
-- the same title, steps and lines (the same Ingredients), and its Source Video's platform, link,
-- external id, creator, caption and thumbnail, read when the original's was (`fetched_at`), so the
-- 30-day YouTube job clears it on time (decisions 04). Never the screenshot, Tags, Want to Cook,
-- Cook Logs or Ranking. Copying again makes another copy. Answers {status: 'copied', recipeId} or
-- {status: 'notFound'}, with nothing made.
create function public.copy_recipe(recipe_id uuid)
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
  select * into original from public.recipes r
  where r.id = copy_recipe.recipe_id and r.status = 'reviewed' and private.can_read_recipe(r.id, me);
  if not found then
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

revoke execute on function public.copy_recipe(uuid) from public, anon;
grant execute on function public.copy_recipe(uuid) to authenticated;

-- Plans ----------------------------------------------------------------------------------------

-- Starts a plan with the caller as its only member, on `cook_on` (null: no date). Returns its id.
create function public.create_cook_plan(cook_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.cook_plans (creator_id, cook_on) values (me, create_cook_plan.cook_on) returning id into plan;
  insert into public.cook_plan_members (plan_id, user_id) values (plan, me);
  return plan;
end;
$$;

-- Sets or clears (null) an active plan's date, for any member. Past days are allowed; nobody is
-- told. Answers {status: 'set' | 'notActive' | 'notFound'}.
create function public.set_cook_plan_date(plan_id uuid, cook_on date default null)
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
  where p.id = set_cook_plan_date.plan_id and private.is_cook_plan_member(p.id)
  for update;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'notActive');
  end if;
  update public.cook_plans p set cook_on = set_cook_plan_date.cook_on where p.id = set_cook_plan_date.plan_id;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  return jsonb_build_object('status', 'set');
end;
$$;

-- The "Cook Plan invite" push each invite earns, one per member per plan, ever: written by
-- invite_to_cook_plan with who invited them, and marked sent by claim_cook_plan_invite_push.
-- Leaving and being invited again earns none.
create table private.cook_plan_invite_pushes (
  plan_id uuid not null references public.cook_plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  invited_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (plan_id, user_id)
);

revoke all on table private.cook_plan_invite_pushes from public, anon, authenticated;

-- A member invites one of their own Friends into an active plan, at most 8 members. They're a
-- member at once. Answers {status: 'invited' | 'notFound' (not a plan of the caller's) |
-- 'notActive' | 'notFriends' | 'alreadyMember' | 'full'}. Only `invited` changed anything.
create function public.invite_to_cook_plan(plan_id uuid, friend_id uuid)
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
  -- One change to a plan's members at a time, so two invites can't both take its last place.
  select p.status into plan_status from public.cook_plans p where p.id = invite_to_cook_plan.plan_id for update;
  if not found or not private.is_cook_plan_member(invite_to_cook_plan.plan_id, me) then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'notActive');
  end if;
  -- As share_shopping_list does, an invite made while the two are being unfriended waits for it.
  perform private.lock_pair(me, invite_to_cook_plan.friend_id);
  if invite_to_cook_plan.friend_id is null or not private.are_friends(me, invite_to_cook_plan.friend_id) then
    return jsonb_build_object('status', 'notFriends');
  end if;
  if private.is_cook_plan_member(invite_to_cook_plan.plan_id, invite_to_cook_plan.friend_id) then
    return jsonb_build_object('status', 'alreadyMember');
  end if;
  if (select count(*) from public.cook_plan_members m where m.plan_id = invite_to_cook_plan.plan_id) >= 8 then
    return jsonb_build_object('status', 'full');
  end if;
  insert into public.cook_plan_members (plan_id, user_id, invited_by)
  values (invite_to_cook_plan.plan_id, invite_to_cook_plan.friend_id, me)
  on conflict on constraint cook_plan_members_pkey do nothing;
  if not found then
    return jsonb_build_object('status', 'alreadyMember');
  end if;
  insert into private.cook_plan_invite_pushes (plan_id, user_id, invited_by)
  values (invite_to_cook_plan.plan_id, invite_to_cook_plan.friend_id, me)
  on conflict on constraint cook_plan_invite_pushes_pkey do nothing;
  return jsonb_build_object('status', 'invited');
end;
$$;

-- The caller leaves a plan. The plan goes with its last member (the trigger below). Answers
-- {status: 'left', planDeleted} or {status: 'notMember'}.
create function public.leave_cook_plan(plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- One change to a plan's members at a time, so the last two leaving at once can't each see the
  -- other still there: the second waits, then finds itself last.
  perform 1 from public.cook_plans p where p.id = leave_cook_plan.plan_id for update;
  delete from public.cook_plan_members m
  where m.plan_id = leave_cook_plan.plan_id and m.user_id = (select auth.uid());
  if not found then
    return jsonb_build_object('status', 'notMember');
  end if;
  return jsonb_build_object(
    'status', 'left',
    'planDeleted', not exists (select 1 from public.cook_plans p where p.id = leave_cook_plan.plan_id)
  );
end;
$$;

-- A plan with no members left is deleted, however its last member went (leaving, or deleting their
-- account).
create function private.delete_empty_cook_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.cook_plans p
  where p.id in (select o.plan_id from old_rows o)
    and not exists (select 1 from public.cook_plan_members m where m.plan_id = p.id);
  return null;
end;
$$;

revoke execute on function private.delete_empty_cook_plans() from public, anon, authenticated;

create trigger delete_empty_cook_plans
  after delete on public.cook_plan_members
  referencing old table as old_rows
  for each statement execute function private.delete_empty_cook_plans();

-- Recipes in a plan ------------------------------------------------------------------------------

-- A member adds one of their own reviewed Recipes to an active plan, at most 10 Recipes. Answers
-- {status: 'added' | 'notFound' (not a plan of the caller's) | 'notActive' | 'noSuchRecipe' (no
-- reviewed Recipe of theirs by that id) | 'alreadyAdded' | 'full'}. Only `added` changed anything.
create function public.add_recipe_to_cook_plan(plan_id uuid, recipe_id uuid)
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
  -- One change to a plan's Recipes at a time, so two adds can't both take its last place.
  select p.status into plan_status from public.cook_plans p where p.id = add_recipe_to_cook_plan.plan_id for update;
  if not found or not private.is_cook_plan_member(add_recipe_to_cook_plan.plan_id, me) then
    return jsonb_build_object('status', 'notFound');
  end if;
  if plan_status <> 'active' then
    return jsonb_build_object('status', 'notActive');
  end if;
  -- Adding is the owner's: a member adds only their own Recipes (a write rule, not who may read).
  if not exists (
    select 1 from public.recipes r
    where r.id = add_recipe_to_cook_plan.recipe_id and r.owner_id = me and r.status = 'reviewed'
  ) then
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
  insert into public.cook_plan_recipes (plan_id, recipe_id, added_by)
  values (add_recipe_to_cook_plan.plan_id, add_recipe_to_cook_plan.recipe_id, me)
  on conflict on constraint cook_plan_recipes_pkey do nothing;
  if not found then
    return jsonb_build_object('status', 'alreadyAdded');
  end if;
  return jsonb_build_object('status', 'added');
end;
$$;

-- Any member removes any Recipe from an active plan (no voting). Answers {status: 'removed' |
-- 'notFound' | 'notActive' | 'notInPlan'}. Only `removed` changed anything.
create function public.remove_recipe_from_cook_plan(plan_id uuid, recipe_id uuid)
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
  where p.id = remove_recipe_from_cook_plan.plan_id and private.is_cook_plan_member(p.id);
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

-- What members see ------------------------------------------------------------------------------

-- The plans the caller is in, newest first.
create function public.list_cook_plans()
returns setof public.cook_plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.cook_plans p
  where p.id in (select private.cook_plan_ids((select auth.uid())))
  order by p.created_at desc, p.id;
$$;

-- Everyone in every plan the caller is in, with their username. Read through the view below.
create function private.cook_plan_people()
returns table (plan_id uuid, user_id uuid, username text, invited_by uuid, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.plan_id, m.user_id, pr.username, m.invited_by, m.joined_at
  from private.cook_plan_ids((select auth.uid())) as mine (plan_id)
  join public.cook_plan_members m on m.plan_id = mine.plan_id
  join public.profiles pr on pr.id = m.user_id;
$$;

-- Every Recipe in every plan the caller is in, with its title and owner (their username while the
-- caller may see their Profile). Read through the view below.
create function private.cook_plan_recipe_list()
returns table (
  plan_id uuid, recipe_id uuid, title text, owner_id uuid, owner_username text, added_by uuid, added_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.plan_id, r.id, r.title, r.owner_id, case when private.can_see_profile(o.id) then o.username end,
    pr.added_by, pr.added_at
  from private.cook_plan_ids((select auth.uid())) as mine (plan_id)
  join public.cook_plan_recipes pr on pr.plan_id = mine.plan_id
  join public.recipes r on r.id = pr.recipe_id
  join public.profiles o on o.id = r.owner_id
  where private.can_read_recipe(r.id);
$$;

revoke execute on function private.cook_plan_people() from public, anon;
revoke execute on function private.cook_plan_recipe_list() from public, anon;
grant execute on function private.cook_plan_people() to authenticated;
grant execute on function private.cook_plan_recipe_list() to authenticated;

-- Each runs as the caller (security_invoker), so it shows only what its function gives them.
create view public.cook_plan_people with (security_invoker = true) as
  select people.plan_id, people.user_id, people.username, people.invited_by, people.joined_at
  from private.cook_plan_people() as people;

create view public.cook_plan_recipe_list with (security_invoker = true) as
  select list.plan_id, list.recipe_id, list.title, list.owner_id, list.owner_username, list.added_by, list.added_at
  from private.cook_plan_recipe_list() as list;

revoke all on public.cook_plan_people from anon, authenticated;
revoke all on public.cook_plan_recipe_list from anon, authenticated;
grant select on public.cook_plan_people to authenticated;
grant select on public.cook_plan_recipe_list to authenticated;

-- The active plans a Recipe is in that the caller is a member of, with the other members'
-- usernames, so deleting it can warn "It'll leave your Cook Plan with @sam" first.
create function public.recipe_cook_plans(recipe_id uuid)
returns table (plan_id uuid, cook_on date, with_usernames text[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.cook_on,
    array(
      select pr.username from private.cook_plan_people() pr
      where pr.plan_id = p.id and pr.user_id <> (select auth.uid()) and pr.username is not null
      order by pr.username
    )
  from public.cook_plan_recipes cpr
  join public.cook_plans p on p.id = cpr.plan_id
  where cpr.recipe_id = recipe_cook_plans.recipe_id
    and p.status = 'active'
    and private.is_cook_plan_member(p.id)
  order by p.created_at desc, p.id;
$$;

revoke execute on function public.create_cook_plan(date) from public, anon;
revoke execute on function public.set_cook_plan_date(uuid, date) from public, anon;
revoke execute on function public.invite_to_cook_plan(uuid, uuid) from public, anon;
revoke execute on function public.leave_cook_plan(uuid) from public, anon;
revoke execute on function public.add_recipe_to_cook_plan(uuid, uuid) from public, anon;
revoke execute on function public.remove_recipe_from_cook_plan(uuid, uuid) from public, anon;
revoke execute on function public.list_cook_plans() from public, anon;
revoke execute on function public.recipe_cook_plans(uuid) from public, anon;
grant execute on function public.create_cook_plan(date) to authenticated;
grant execute on function public.set_cook_plan_date(uuid, date) to authenticated;
grant execute on function public.invite_to_cook_plan(uuid, uuid) to authenticated;
grant execute on function public.leave_cook_plan(uuid) to authenticated;
grant execute on function public.add_recipe_to_cook_plan(uuid, uuid) to authenticated;
grant execute on function public.remove_recipe_from_cook_plan(uuid, uuid) to authenticated;
grant execute on function public.list_cook_plans() to authenticated;
grant execute on function public.recipe_cook_plans(uuid) to authenticated;

-- The invite push ------------------------------------------------------------------------------

-- For the notify function (service role only), as `inviter` asks to tell `invitee` they were
-- invited: the inviter's username, the plan's Recipe titles and the invitee's push tokens, and the
-- push is marked sent. Null, and nothing marked, unless `invitee` is a member whose invite from
-- `inviter` hasn't been pushed yet, and has a phone to tell.
create function public.claim_cook_plan_invite_push(plan_id uuid, inviter uuid, invitee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter_name text;
  tokens jsonb;
  titles jsonb;
begin
  if not private.is_cook_plan_member(claim_cook_plan_invite_push.plan_id, invitee)
    or not exists (
      select 1 from private.cook_plan_invite_pushes s
      where s.plan_id = claim_cook_plan_invite_push.plan_id and s.user_id = invitee
        and s.invited_by = inviter and s.sent_at is null
    ) then
    return null;
  end if;

  select p.username into inviter_name from public.profiles p where p.id = inviter;
  select jsonb_agg(t.token order by t.token) into tokens from public.push_tokens t where t.user_id = invitee;
  if inviter_name is null or tokens is null then
    return null;
  end if;

  update private.cook_plan_invite_pushes s set sent_at = now()
  where s.plan_id = claim_cook_plan_invite_push.plan_id and s.user_id = invitee
    and s.invited_by = inviter and s.sent_at is null;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(r.title order by pr.added_at, r.title), '[]'::jsonb) into titles
  from public.cook_plan_recipes pr join public.recipes r on r.id = pr.recipe_id
  where pr.plan_id = claim_cook_plan_invite_push.plan_id;
  return jsonb_build_object('username', inviter_name, 'tokens', tokens, 'recipeTitles', titles);
end;
$$;

revoke execute on function public.claim_cook_plan_invite_push(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_cook_plan_invite_push(uuid, uuid, uuid) to service_role;
