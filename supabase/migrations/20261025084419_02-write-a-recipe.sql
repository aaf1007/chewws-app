-- Ticket 02: Recipes written by hand, their lines, and the global Ingredients the lines link to.

-- Ingredients are global and keyed by their normalised name (the data layer's Ingredient matcher
-- normalises; the check only guards the cheap invariants). Anyone signed in can read and add one;
-- nobody renames or deletes one.
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
    check (name <> '' and name = btrim(name) and name = lower(name) and name !~ '\s\s'),
  created_at timestamptz not null default now()
);

alter table public.ingredients enable row level security;

grant select, insert on table public.ingredients to authenticated;

create policy "Signed-in users can read Ingredients"
  on public.ingredients for select to authenticated
  using (true);

create policy "Signed-in users can add Ingredients"
  on public.ingredients for insert to authenticated
  with check (true);

create type public.recipe_status as enum ('draft', 'reviewed');

-- Every Recipe belongs to exactly one user (ADR-0002), and only that user can see it.
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  steps text[] not null default '{}',
  status public.recipe_status not null default 'draft',
  recipe_found boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_owner_created_idx on public.recipes (owner_id, created_at desc);

alter table public.recipes enable row level security;

grant select, insert, update, delete on table public.recipes to authenticated;

create policy "Owners can read their Recipes"
  on public.recipes for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can add their own Recipes"
  on public.recipes for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Owners can change their Recipes"
  on public.recipes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners can delete their Recipes"
  on public.recipes for delete to authenticated
  using (owner_id = (select auth.uid()));

create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position integer not null check (position >= 0),
  original_text text not null check (btrim(original_text) <> ''),
  amount_text text,
  ingredient_id uuid not null references public.ingredients (id),
  unique (recipe_id, position)
);

create index recipe_lines_ingredient_idx on public.recipe_lines (ingredient_id);

alter table public.recipe_lines enable row level security;

grant select, insert, delete on table public.recipe_lines to authenticated;

create policy "Owners can read their Recipes' lines"
  on public.recipe_lines for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

create policy "Owners can add lines to their Recipes"
  on public.recipe_lines for insert to authenticated
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

create policy "Owners can remove lines from their Recipes"
  on public.recipe_lines for delete to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

-- Writes go through these functions so a Recipe and its lines change in one transaction. They run
-- as the caller (security invoker), so the policies above still decide what they can touch.
-- `lines` is a JSON array of {original_text, amount_text, ingredient_name}, in order, with
-- ingredient names already normalised by the data layer.

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.replace_recipe_lines(target uuid, lines jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.recipe_lines where recipe_id = target;

  insert into public.ingredients (name)
  select distinct line ->> 'ingredient_name'
  from jsonb_array_elements(lines) as line
  on conflict (name) do nothing;

  insert into public.recipe_lines (recipe_id, position, original_text, amount_text, ingredient_id)
  select target, l.ord - 1, l.line ->> 'original_text', nullif(l.line ->> 'amount_text', ''), i.id
  from jsonb_array_elements(lines) with ordinality as l (line, ord)
  join public.ingredients i on i.name = l.line ->> 'ingredient_name';
end;
$$;

revoke execute on function private.replace_recipe_lines(uuid, jsonb) from public, anon;
grant execute on function private.replace_recipe_lines(uuid, jsonb) to authenticated;

-- A Recipe written by hand needs no review.
create function public.create_recipe(title text, steps text[], lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.recipes (title, steps, status, recipe_found)
  values (title, steps, 'reviewed', true)
  returning id into new_id;

  perform private.replace_recipe_lines(new_id, lines);
  return new_id;
end;
$$;

-- Replaces the title, steps and every line. Returns null when the caller can't see the Recipe.
create function public.edit_recipe(recipe_id uuid, title text, steps text[], lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.recipes r
  set title = edit_recipe.title, steps = edit_recipe.steps, updated_at = now()
  where r.id = edit_recipe.recipe_id;

  if not found then
    return null;
  end if;

  perform private.replace_recipe_lines(edit_recipe.recipe_id, lines);
  return edit_recipe.recipe_id;
end;
$$;

revoke execute on function public.create_recipe(text, text[], jsonb) from public, anon;
revoke execute on function public.edit_recipe(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.create_recipe(text, text[], jsonb) to authenticated;
grant execute on function public.edit_recipe(uuid, text, text[], jsonb) to authenticated;
