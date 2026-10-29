-- Ticket 06: Tags, search and Want to Cook (decisions 06).
--
-- Tags are per user: a Tag belongs to one user, and only they see it or the Recipes it's on. The
-- Draft builder suggests Tag names; they're kept on the Draft (`suggested_tags`), not made into
-- Tags, until the user reviews it and keeps the ones they want. Search and Want to Cook cover
-- reviewed Recipes only.

-- A Tag's name is stored as the user first spelled it, composed (NFC), trimmed with each run of
-- spaces made one, and with no control or format characters (Unicode Cc and Cf, listed below as
-- JavaScript's Unicode 16 has them: a zero-width space or a right-to-left override would make two
-- names that look the same different Tags). The data layer's tag-name.ts tidies names so; these
-- checks refuse any other. Unique per user without regard to case.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null
    check (char_length(name) between 1 and 40 and name = btrim(name) and name !~ '\s\s')
    check (name is nfc normalized)
    check (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'),
  created_at timestamptz not null default now()
);

create unique index tags_owner_name_key on public.tags (owner_id, lower(name));

alter table public.tags enable row level security;

-- Tags are made through add_tag and review_draft below; only the name is the caller's to give.
grant select, delete on table public.tags to authenticated;
grant insert (name) on table public.tags to authenticated;

create policy "Owners can read their Tags"
  on public.tags for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can add their own Tags"
  on public.tags for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Deleting a Tag takes it off every Recipe it was on.
create policy "Owners can delete their Tags"
  on public.tags for delete to authenticated
  using (owner_id = (select auth.uid()));

create table public.recipe_tags (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (recipe_id, tag_id)
);

create index recipe_tags_tag_idx on public.recipe_tags (tag_id);

alter table public.recipe_tags enable row level security;

grant select, insert, delete on table public.recipe_tags to authenticated;

create policy "Owners can read their Recipes' Tags"
  on public.recipe_tags for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

-- Only the user's own Tags, only on their own reviewed Recipes: a Draft gets its Tags when it's
-- reviewed.
create policy "Owners can put their Tags on their reviewed Recipes"
  on public.recipe_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.owner_id = (select auth.uid()) and r.status = 'reviewed'
    )
    and exists (
      select 1 from public.tags t
      where t.id = tag_id and t.owner_id = (select auth.uid())
    )
  );

create policy "Owners can take Tags off their Recipes"
  on public.recipe_tags for delete to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.owner_id = (select auth.uid())
  ));

-- What the Draft builder suggests (at most 5 names: cuisine, meal type, "quick"), and when the
-- user marked a reviewed Recipe Want to Cook (null: not marked).
alter table public.recipes
  add column suggested_tags text[] not null default '{}',
  add column want_to_cook_at timestamptz,
  add constraint recipes_suggested_tags_count check (cardinality(suggested_tags) <= 5),
  add constraint recipes_want_to_cook_reviewed check (status = 'reviewed' or want_to_cook_at is null);

-- set_want_to_cook runs as the caller, so the owner's update policy decides.
grant update (want_to_cook_at) on table public.recipes to authenticated;

create index recipes_owner_want_to_cook_idx on public.recipes (owner_id, want_to_cook_at desc)
  where want_to_cook_at is not null;

-- Finds or makes the caller's Tag of this name (any case), puts it on the Recipe, and returns its
-- id. Called by add_tag as the caller, and by review_draft.
create function private.attach_tag(recipe_id uuid, tag_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tag uuid;
begin
  insert into public.tags (name) values (attach_tag.tag_name)
  on conflict (owner_id, lower(name)) do nothing;

  select t.id into tag from public.tags t
  where t.owner_id = (select auth.uid()) and lower(t.name) = lower(attach_tag.tag_name);

  insert into public.recipe_tags (recipe_id, tag_id) values (attach_tag.recipe_id, tag)
  on conflict do nothing;
  return tag;
end;
$$;

revoke execute on function private.attach_tag(uuid, text) from public, anon;
grant execute on function private.attach_tag(uuid, text) to authenticated;

-- Puts a Tag on one of the caller's reviewed Recipes, making the Tag if they have none of that
-- name. Already on it is fine. Returns the Tag as {id, name}, its name as first spelled; null when
-- the caller has no reviewed Recipe with this id.
create function public.add_tag(recipe_id uuid, name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tag uuid;
begin
  if not exists (select 1 from public.recipes r where r.id = add_tag.recipe_id and r.status = 'reviewed') then
    return null;
  end if;
  tag := private.attach_tag(add_tag.recipe_id, add_tag.name);
  return (select jsonb_build_object('id', t.id, 'name', t.name) from public.tags t where t.id = tag);
end;
$$;

revoke execute on function public.add_tag(uuid, text) from public, anon;
grant execute on function public.add_tag(uuid, text) to authenticated;

-- Marks or unmarks one of the caller's reviewed Recipes Want to Cook. Marking it again keeps the
-- time it was first marked. Returns 'set', 'notReviewed' (a Draft) or 'gone'.
create function public.set_want_to_cook(recipe_id uuid, want_to_cook boolean)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.recipe_status;
begin
  update public.recipes r
  set want_to_cook_at = case when set_want_to_cook.want_to_cook then coalesce(r.want_to_cook_at, now()) end
  where r.id = set_want_to_cook.recipe_id and r.status = 'reviewed';

  if found then
    return 'set';
  end if;
  select r.status into current_status from public.recipes r where r.id = set_want_to_cook.recipe_id;
  return case when current_status is null then 'gone' else 'notReviewed' end;
end;
$$;

revoke execute on function public.set_want_to_cook(uuid, boolean) from public, anon;
grant execute on function public.set_want_to_cook(uuid, boolean) to authenticated;

-- Text as search compares it: accents composed (NFC), lowercase, and curly apostrophes made
-- straight, as a phone's keyboard types them curly. The data layer does the same to the words.
create function private.search_text(text text)
returns text
language sql
immutable
set search_path = ''
as $$ select translate(lower(normalize(search_text.text, nfc)), '‘’ʼ', '''''''') $$;

revoke execute on function private.search_text(text) from public, anon;
grant execute on function private.search_text(text) to authenticated;

-- The caller's reviewed Recipes matching every word: each word {text, ingredient} is found in the
-- title or a Tag's name (as `text`, already made search text by the data layer), or in a linked
-- Ingredient's name (as `ingredient`, the word put through the Ingredient matcher). No words: every reviewed
-- Recipe. `want_to_cook_only`: only those marked Want to Cook. Runs as the caller: the policies
-- decide whose Recipes it sees. The data layer orders the results.
create function public.search_recipes(words jsonb default '[]', want_to_cook_only boolean default false)
returns setof public.recipes
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from public.recipes r
  where r.status = 'reviewed'
    and (not search_recipes.want_to_cook_only or r.want_to_cook_at is not null)
    and not exists (
      select 1
      from jsonb_array_elements(search_recipes.words) as w (word)
      where not (
        strpos(private.search_text(r.title), w.word ->> 'text') > 0
        or exists (
          select 1 from public.recipe_tags rt
          join public.tags t on t.id = rt.tag_id
          where rt.recipe_id = r.id and strpos(private.search_text(t.name), w.word ->> 'text') > 0
        )
        or (coalesce(w.word ->> 'ingredient', '') <> '' and exists (
          select 1 from public.recipe_lines l
          join public.ingredients i on i.id = l.ingredient_id
          where l.recipe_id = r.id and strpos(i.name, w.word ->> 'ingredient') > 0
        ))
      )
    );
$$;

revoke execute on function public.search_recipes(jsonb, boolean) from public, anon;
grant execute on function public.search_recipes(jsonb, boolean) to authenticated;

-- finish_draft (ticket 03) now also keeps the Tag names the builder suggests: `result.tags`, at
-- most 5, already tidied by the builder.
create or replace function public.finish_draft(recipe_id uuid, result jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_recipe boolean := coalesce((result ->> 'recipeFound')::boolean, false);
  new_title text := nullif(btrim(coalesce(result ->> 'title', '')), '');
  source jsonb := coalesce(result -> 'source', '{}'::jsonb);
begin
  update public.recipes r
  set title = coalesce(new_title, r.title),
      steps = case when found_recipe
        then coalesce(array(
          select btrim(step) from jsonb_array_elements_text(result -> 'steps') as step
          where btrim(step) <> ''
        ), '{}')
        else '{}' end,
      recipe_found = found_recipe,
      suggested_tags = coalesce(array(
        select jsonb_array_elements_text(coalesce(result -> 'tags', '[]'::jsonb))
      ), '{}'),
      build_status = 'built',
      updated_at = now()
  where r.id = finish_draft.recipe_id and r.status = 'draft' and r.build_status = 'building';

  if not found then
    return false;
  end if;

  perform private.replace_recipe_lines(
    finish_draft.recipe_id,
    case when found_recipe then coalesce(result -> 'lines', '[]'::jsonb) else '[]'::jsonb end
  );

  update public.source_videos s
  set platform = coalesce((source ->> 'platform')::public.source_platform, s.platform),
      external_id = source ->> 'external_id',
      creator_name = source ->> 'creator_name',
      creator_url = source ->> 'creator_url',
      caption = source ->> 'caption',
      title = source ->> 'title',
      thumbnail_url = source ->> 'thumbnail_url',
      recipe_site_url = source ->> 'recipe_site_url',
      fetched_at = now()
  where s.recipe_id = finish_draft.recipe_id;

  return true;
end;
$$;

-- review_draft (ticket 03) now also takes the Tag names the user kept or added (`tags`, already
-- tidied by the data layer): it finds or makes each of their Tags and puts it on the Recipe, then
-- clears the suggestions. A review refused, or sent again, attaches nothing.
drop function public.review_draft(uuid, text, text[], jsonb);

create function public.review_draft(
  recipe_id uuid,
  title text,
  steps text[],
  lines jsonb,
  tags text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.recipes;
begin
  select * into draft from public.recipes r
  where r.id = review_draft.recipe_id and r.owner_id = (select auth.uid())
  for update;

  if not found then
    return 'gone';
  end if;
  if draft.status <> 'draft' then
    return 'notDraft';
  end if;
  if draft.build_status = 'building' and not private.build_timed_out(draft.build_started_at) then
    return 'building';
  end if;

  update public.recipes r
  set title = review_draft.title,
      steps = review_draft.steps,
      status = 'reviewed',
      build_status = 'built',
      build_failure = null,
      suggested_tags = '{}',
      updated_at = now()
  where r.id = review_draft.recipe_id;

  perform private.replace_recipe_lines(review_draft.recipe_id, lines);
  perform private.attach_tag(review_draft.recipe_id, tag) from unnest(review_draft.tags) as tag;
  return 'reviewed';
end;
$$;

revoke execute on function public.review_draft(uuid, text, text[], jsonb, text[]) from public, anon;
grant execute on function public.review_draft(uuid, text, text[], jsonb, text[]) to authenticated;
