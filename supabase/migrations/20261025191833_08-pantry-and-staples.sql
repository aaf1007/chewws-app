-- Ticket 08: the Pantry (which Ingredients a user has, never how much: ADR-0003) and Staples (the
-- Ingredients a user always counts as in their Pantry). Both are visible only to their owner for
-- now; ticket 15 shows Cook Plan members who has what.

-- A row means the user has the Ingredient. "Used up" deletes the row.
create table public.pantry_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  created_at timestamptz not null default now(),
  primary key (user_id, ingredient_id)
);

alter table public.pantry_entries enable row level security;

grant select, insert, delete on table public.pantry_entries to authenticated;

create policy "Owners can read their Pantry"
  on public.pantry_entries for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners can add to their Pantry"
  on public.pantry_entries for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owners can mark their Pantry's Ingredients used up"
  on public.pantry_entries for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.staples (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  created_at timestamptz not null default now(),
  primary key (user_id, ingredient_id)
);

alter table public.staples enable row level security;

grant select, insert, delete on table public.staples to authenticated;

create policy "Owners can read their Staples"
  on public.staples for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners can add Staples"
  on public.staples for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owners can remove Staples"
  on public.staples for delete to authenticated
  using (user_id = (select auth.uid()));

-- The functions below run as the caller (security invoker), so the policies above decide what they
-- can touch. Ingredient names arrive already normalised by the data layer's Ingredient matcher.

-- Puts an Ingredient in the caller's Pantry, adding the Ingredient if it's new. Returns its id.
create function public.add_to_pantry(ingredient_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  found_id uuid;
begin
  insert into public.ingredients (name) values (ingredient_name) on conflict (name) do nothing;
  select i.id into found_id from public.ingredients i where i.name = ingredient_name;

  insert into public.pantry_entries (ingredient_id) values (found_id) on conflict do nothing;
  return found_id;
end;
$$;

-- Makes an Ingredient one of the caller's Staples, adding the Ingredient if it's new. Returns its id.
-- Staples change one row at a time (this, or deleting the row), so two changes at once never clash
-- and doing one twice is the same as once.
create function public.add_staple(ingredient_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  found_id uuid;
begin
  insert into public.ingredients (name) values (ingredient_name) on conflict (name) do nothing;
  select i.id into found_id from public.ingredients i where i.name = ingredient_name;

  insert into public.staples (ingredient_id) values (found_id) on conflict do nothing;
  return found_id;
end;
$$;

-- The one answer to "does the caller have this Ingredient?": in their Pantry, or a Staple.
create function public.has_ingredient(ingredient_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.pantry_entries p
    where p.user_id = (select auth.uid()) and p.ingredient_id = has_ingredient.ingredient_id
  ) or exists (
    select 1 from public.staples s
    where s.user_id = (select auth.uid()) and s.ingredient_id = has_ingredient.ingredient_id
  );
$$;

revoke execute on function public.add_to_pantry(text) from public, anon;
revoke execute on function public.add_staple(text) from public, anon;
revoke execute on function public.has_ingredient(uuid) from public, anon;
grant execute on function public.add_to_pantry(text) to authenticated;
grant execute on function public.add_staple(text) to authenticated;
grant execute on function public.has_ingredient(uuid) to authenticated;

-- Every new Profile starts with salt, pepper and oil as Staples. Runs inside the Profile insert,
-- where there's no auth.uid(), so it names the user itself.
create function public.add_default_staples()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ingredients (name)
  values ('salt'), ('pepper'), ('oil')
  on conflict (name) do nothing;

  insert into public.staples (user_id, ingredient_id)
  select new.id, i.id from public.ingredients i where i.name in ('salt', 'pepper', 'oil')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.add_default_staples() from public, anon, authenticated;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.add_default_staples();

-- Backfill: Profiles made before this migration get the defaults too.
insert into public.ingredients (name)
values ('salt'), ('pepper'), ('oil')
on conflict (name) do nothing;

insert into public.staples (user_id, ingredient_id)
select p.id, i.id
from public.profiles p
cross join public.ingredients i
where i.name in ('salt', 'pepper', 'oil')
on conflict do nothing;
