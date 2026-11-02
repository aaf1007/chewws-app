-- Ticket 17: Ranking (decisions 17).
--
-- A user ranks their own Cooked Recipes Beli-style: a band (Liked, Fine, Didn't like), then a
-- position in it found on the phone by binary search ("better or worse than X?"). One entry per
-- Recipe, positions 1…n with no gaps in each band (1 = best). The Score is never stored: the
-- phone's ranking engine (src/data/ranking-engine.ts) makes it from band, position and band size.
--
-- Rules, each in one place:
--   private.can_see_activity_of: who sees what a user cooked and how they ranked it: the user and
--     their Friends (private.are_friends). The select policy on ranking_entries asks it, and ticket
--     16's private.can_read_cook_logs_of now asks it too, so the rule is written once.
--   private.lock_ranking: one change to a user's Ranking at a time (an advisory lock on the user),
--     taken by place_in_ranking and by the trigger that closes a band's gap when an entry goes.
--
-- Users only read ranking_entries. Every write goes through place_in_ranking, or happens because a
-- Recipe or its last Cook Log was deleted (delete_cook_log, below).
--
-- Lock order, the same everywhere so nothing deadlocks: the Recipe row first (place_in_ranking
-- takes it for share, delete_cook_log for update, deleting the Recipe holds it), then the user's
-- Ranking lock.

create type public.ranking_band as enum ('liked', 'fine', 'disliked');

create table public.ranking_entries (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  band public.ranking_band not null,
  position int not null check (position >= 1),
  ranked_at timestamptz not null default now(),
  -- Checked at the end of each statement, so a band can shift down or up by one in one update.
  constraint ranking_entries_band_position_key unique (user_id, band, position) deferrable initially immediate
);

alter table public.ranking_entries enable row level security;
revoke all on table public.ranking_entries from anon, authenticated;
grant select on table public.ranking_entries to authenticated;

-- The read rule ----------------------------------------------------------------------------------

-- Whether the caller sees `owner`'s activity: their Cook Logs (ticket 16) and their Ranking. Their
-- own, or a Friend's, so unfriending ends it at once (decisions 16, 17). Nothing else restates it.
create function private.can_see_activity_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    can_see_activity_of.owner = (select auth.uid())
      or private.are_friends(can_see_activity_of.owner, (select auth.uid())),
    false
  );
$$;

revoke execute on function private.can_see_activity_of(uuid) from public, anon;
grant execute on function private.can_see_activity_of(uuid) to authenticated;

-- Ticket 16's read rule for Cook Logs is this same rule; its policies keep their name for it.
create or replace function private.can_read_cook_logs_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_see_activity_of(can_read_cook_logs_of.owner);
$$;

create policy "Users and their Friends read their Ranking"
  on public.ranking_entries for select to authenticated
  using (private.can_see_activity_of(user_id));

-- Keeping a band in order --------------------------------------------------------------------------

-- One change to `who`'s Ranking at a time, until the transaction ends.
create function private.lock_ranking(who uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('ranking_entries:' || lock_ranking.who::text, 0));
$$;

revoke execute on function private.lock_ranking(uuid) from public, anon, authenticated;

-- After entries go (a Recipe deleted, its last Cook Log deleted, or a Recipe re-ranked), the
-- bands they left are numbered 1…n again, in the order they were in.
create function private.close_ranking_gaps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
begin
  for who in select distinct g.user_id from gone g order by g.user_id loop
    perform private.lock_ranking(who);
  end loop;
  update public.ranking_entries e
  set position = n.position
  from (
    select r.recipe_id, row_number() over (partition by r.user_id, r.band order by r.position)::int as position
    from public.ranking_entries r
    where (r.user_id, r.band) in (select distinct g.user_id, g.band from gone g)
  ) n
  where e.recipe_id = n.recipe_id and e.position <> n.position;
  return null;
end;
$$;

revoke execute on function private.close_ranking_gaps() from public, anon, authenticated;

create trigger ranking_entries_close_gaps
  after delete on public.ranking_entries
  referencing old table as gone
  for each statement execute function private.close_ranking_gaps();

-- Writes -----------------------------------------------------------------------------------------

-- Places one of the caller's Cooked Recipes in `band` at `position` (1 = best), the spot the
-- phone's comparisons found among the `band_size_seen` Recipes it read in that band (without this
-- one). Ranked already, it moves: out of its old band and into this one, in one transaction.
-- Answers {status: 'placed' | 'bandChanged' | 'notCooked' | 'noSuchRecipe'}. `bandChanged`: the
-- band no longer has `band_size_seen` Recipes (another phone ranked meanwhile), so nothing changed
-- and the phone compares again. Only `placed` changed anything.
create function public.place_in_ranking(recipe_id uuid, band public.ranking_band, "position" int, band_size_seen int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  band_size int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if place_in_ranking.band is null or place_in_ranking.position is null or place_in_ranking.band_size_seen is null then
    raise exception 'a band, a position and the band size seen are needed' using errcode = '22023';
  end if;

  -- The Recipe is the caller's, held until this commits: deleting it, or its last Cook Log, waits.
  perform 1 from public.recipes r
  where r.id = place_in_ranking.recipe_id and r.owner_id = me
  for share;
  if not found then
    return jsonb_build_object('status', 'noSuchRecipe');
  end if;
  if not exists (select 1 from public.cook_logs l where l.recipe_id = place_in_ranking.recipe_id) then
    return jsonb_build_object('status', 'notCooked');
  end if;

  perform private.lock_ranking(me);
  select count(*)::int into band_size from public.ranking_entries e
  where e.user_id = me and e.band = place_in_ranking.band and e.recipe_id <> place_in_ranking.recipe_id;
  if band_size <> place_in_ranking.band_size_seen then
    return jsonb_build_object('status', 'bandChanged');
  end if;
  if place_in_ranking.position < 1 or place_in_ranking.position > band_size + 1 then
    raise exception 'a band of % has no position %', band_size, place_in_ranking.position using errcode = '22023';
  end if;

  -- Out of where it was (the trigger closes that gap), then into the gap it was placed in.
  delete from public.ranking_entries e where e.recipe_id = place_in_ranking.recipe_id;
  update public.ranking_entries e set position = e.position + 1
  where e.user_id = me and e.band = place_in_ranking.band and e.position >= place_in_ranking.position;
  insert into public.ranking_entries (recipe_id, user_id, band, position)
  values (place_in_ranking.recipe_id, me, place_in_ranking.band, place_in_ranking.position);
  if not found then
    raise exception 'the Recipe was not placed' using errcode = 'P0001';
  end if;
  return jsonb_build_object('status', 'placed');
end;
$$;

revoke execute on function public.place_in_ranking(uuid, public.ranking_band, int, int) from public, anon;
grant execute on function public.place_in_ranking(uuid, public.ranking_band, int, int) to authenticated;

-- Ticket 16's delete_cook_log, now also taking a Recipe left with no Cook Log (Saved again) out of
-- the Ranking, under the same Recipe lock, after the phone's warning (user decisions 11–19, 7).
-- Answers as before: {status: 'deleted', recipe: 'cooked' | 'saved'} or {status: 'notFound'}.
create or replace function public.delete_cook_log(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  of_recipe uuid;
  still_cooked boolean;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select l.recipe_id into of_recipe from public.cook_logs l where l.id = delete_cook_log.id and l.user_id = me;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  perform 1 from public.recipes r where r.id = of_recipe for update;

  delete from public.cook_logs l where l.id = delete_cook_log.id and l.user_id = me;
  if not found then
    return jsonb_build_object('status', 'notFound');
  end if;
  still_cooked := exists (select 1 from public.cook_logs l where l.recipe_id = of_recipe);
  if not still_cooked then
    delete from public.ranking_entries e where e.recipe_id = of_recipe;
  end if;
  return jsonb_build_object('status', 'deleted', 'recipe', case when still_cooked then 'cooked' else 'saved' end);
end;
$$;
