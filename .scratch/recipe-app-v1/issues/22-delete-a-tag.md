# 22: Delete a Tag

**What's wrong:** A Tag stays in the user's Tags after it's taken off its last Recipe (decisions 06), and nothing in the app can delete it. The data layer has `deleteTag(tagId)`, which deletes one of the user's Tags and takes it off every Recipe it was on, but no screen calls it. A Tag the user no longer wants keeps its name taken: typing it again on a Recipe brings back its old spelling.

**Found:** Ticket 06 review.

**Proposed behaviour:** The user can see their Tags (with how many Recipes each is on) and delete one, after a confirmation that names the Recipes it will come off. Where the list lives (Profile, or a "Tags" row in the Library) is to decide.

**Blocked by:** 06 (Tags, search and Want to Cook)

**Decided** (user decision 2, 2026-11-08): the Tags list lives on a "Tags" row in the Library.

Counts are of the user's own Recipes. A Tag is never on a Draft (decisions 06: the `recipe_tags` insert policy wants a reviewed Recipe, and a Draft gets its Tags when it's reviewed), so no Draft is counted or needs leaving out.

The Library has no Tag filter (the brief assumed one): Recipes are found by Tag through search (decisions 06). After a delete, searching the Tag's name no longer finds a Recipe by it.

**TICKET_SLUG:** `22-delete-a-tag`

**Status:** done

- [x] The Library has a "Tags" row that opens the user's Tags, by name, each with how many of their Recipes it's on. A Tag on no Recipe shows 0 and stays listed. With no Tags, the screen says so (empty state) Proved: `.maestro/22-delete-a-tag.yaml` (counts, "Leftovers, 0 Recipes", "No Tags yet"); `tests/delete-a-tag.test.ts` "the user’s Tags, by name…".
- [x] The counts and each Tag's Recipes are read in one query, and count only the user's own Recipes (data-layer test) Proved: `tests/delete-a-tag.test.ts` "the user’s Tags, by name…" and "the counts are of the user’s own Recipes…" (`listTagsWithRecipes`, one PostgREST read).
- [x] Deleting a Tag asks first; the confirmation names the Recipes it comes off (the first three, then "and N more"), or says it's on none Proved: `tests/tag-copy.test.ts`; flow 22 asserts the alert for 5 Recipes, 1, and none.
- [x] Confirming calls the existing `deleteTag(tagId)`, which takes the Tag off every Recipe it was on and answers `deleted`; a Tag already gone answers `gone` (never success on 0 rows), and the screen says so and reads the list again (data-layer test) Proved: `tests/delete-a-tag.test.ts` "deleting a Tag takes it off every Recipe…" (deleted, then gone); the screen's `gone` notice by reading `src/app/tags.tsx`.
- [x] After a delete, typing the name again on a Recipe makes a fresh Tag with the new spelling; searching the old name no longer finds a Recipe by that Tag; search by title and Ingredient, and Want to Cook, are unchanged (data-layer test) Proved: `tests/delete-a-tag.test.ts` "after a delete the name typed again makes a fresh Tag…"; flow 22 (search "weeknight" finds nothing, "WeekNight" shows).
- [x] Race, holding a second session: a delete and an add of the same Tag end literally (the Tag gone everywhere, or the add made a fresh Tag), never with a `recipe_tag` without its Tag, and the add never fails because the Tag went meanwhile; two deletes at once answer `deleted` once and `gone` once (data-layer tests) Proved: the four "race:" tests in `tests/delete-a-tag.test.ts`; the first fails every time with ticket 06's `attach_tag`.
- [x] Access: Tags are owner-only. A stranger and a Friend (who can read the owner's logged Recipe, ticket 19) can't read the owner's Tags, their counts or `recipe_tags`, and can't delete either; `deleteTag` on someone else's Tag answers `gone`. A Friend's Tags never show in the user's Tags (`tests/*.access.test.ts`, each case failing with its rule loosened) Proved: `tests/delete-a-tag.access.test.ts` (reads fail with the select policy loosened; deletes with select and delete policies loosened together, since a delete's filter reads the row).
- [x] Flow `22-delete-a-tag.yaml`: Library > Tags shows the counts; deleting a Tag shows the confirmation with its Recipes' names; after confirming it's gone from the list and from the Recipe; typing it again in a new spelling shows that spelling Proved: `.maestro/22-delete-a-tag.yaml` passes.
