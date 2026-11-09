-- Ticket 22: Delete a Tag.
--
-- The user deletes one of their Tags from the Library's Tags list (the `tags` delete policy from
-- ticket 06, unchanged); it comes off every Recipe through the cascade on `recipe_tags`. What this
-- migration changes is putting a Tag on a Recipe while that Tag is being deleted.
--
-- attach_tag (06) found the Tag's id and then inserted the `recipe_tags` row. A delete that
-- committed in between left that insert pointing at a Tag that no longer exists: the foreign key
-- (or, when the delete committed before the insert began, the insert policy, which looks for the
-- Tag) refused it, and adding the Tag failed. Now attach_tag tries again when the Tag it found has
-- gone, which makes a fresh Tag spelled as the user just typed it. Once its row is in, the foreign
-- key holds the Tag (key share) until the add commits, so a delete arriving then waits and takes
-- the Tag off this Recipe too. Either way the end is one of the two: the Tag gone everywhere, or
-- the add made a fresh one. Never a `recipe_tags` row without its Tag.
create or replace function private.attach_tag(recipe_id uuid, tag_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tag uuid;
begin
  -- Each try after the first follows a delete of the Tag; three in a row is someone deleting it on
  -- purpose, and the add fails as before.
  for attempt in 1..3 loop
    insert into public.tags (name) values (attach_tag.tag_name)
    on conflict (owner_id, lower(name)) do nothing;

    select t.id into tag from public.tags t
    where t.owner_id = (select auth.uid()) and lower(t.name) = lower(attach_tag.tag_name);

    if tag is not null then
      begin
        insert into public.recipe_tags (recipe_id, tag_id) values (attach_tag.recipe_id, tag)
        on conflict do nothing;
        return tag;
      exception when foreign_key_violation or insufficient_privilege then
        -- With the Tag still there, the refusal is about the Recipe (gone, or not the caller's
        -- reviewed one): raise it, as before.
        if attempt = 3 or exists (select 1 from public.tags t where t.id = tag) then
          raise;
        end if;
      end;
    end if;
  end loop;
  raise exception 'the Tag "%" was deleted while it was being added', attach_tag.tag_name using errcode = '40001';
end;
$$;
