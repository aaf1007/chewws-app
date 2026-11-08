# 21: Editing a Recipe updates its Shopping List lines

**What's wrong:** Editing a Recipe that's on the Shopping List (`edit_recipe` replaces its lines) leaves the list as it was: an Ingredient the edit adds gets no line, and one it drops stays on its unchecked line with the Recipe's old amounts. The spec doesn't say what should happen.

**Found:** PR #1 review.

**Proposed behaviour:** After an edit, the Recipe's amounts on the list follow its new lines: an Ingredient it now needs and the user doesn't have joins or makes a line, and amounts change to the new ones.
Its amounts leave the lines of Ingredients it no longer has; an unchecked line no other Recipe needs goes, and a checked-off one stays, as when a Recipe is taken off the list.

**Blocked by:** None

**Decided** (user decision 1, 2026-11-08): the list follows the Recipe, as proposed. It applies to every list the edited Recipe is on: its owner's Shopping List (also when shared with Friends, ticket 13) and every **active** Cook Plan it's in (decisions 15's flag). Cooked plans are read-only (ticket 18) and stay as they were; copies are their own Recipes and are unaffected.

After an edit, each list looks as if the Recipe had been taken off it and put back, except that checked-off lines stay, and so do Claims, and a line other Recipes still need keeps their amounts. "Counts as present" (decisions 08) and the Pantry skip apply exactly as when adding.

**TICKET_SLUG:** `21-recipe-edit-updates-lists`

**Status:** ready-for-agent

- [ ] Editing a Recipe on its owner's Shopping List updates its lines there: an Ingredient it now needs that the owner doesn't have joins its line or makes one, its amounts change to the new ones, and its amounts leave the lines of Ingredients it no longer has; an unchecked line no other Recipe needs goes, and a line other Recipes need keeps their amounts (data-layer test)
- [ ] "Counts as present" and the Pantry skip apply as when adding: an Ingredient the owner has (Pantry or Staple) gets no line, and the Recipe's amount leaves an unchecked line for one they have now (data-layer test)
- [ ] Checked-off lines stay checked off: one the Recipe still needs keeps its amount, changed to the new one; one it no longer needs stays without it. A Recipe taken off the list, or never on it, stays off after an edit (data-layer test)
- [ ] A Friend the list is shared with sees the change (data-layer test)
- [ ] Every active Cook Plan the Recipe is in follows the edit the same way, with no Pantry skip (as adding to a plan has none). Claimed and checked-off lines stay; the Recipe's amount on one it no longer needs shows as "(removed)". Cooked plans and copies are unchanged (data-layer test)
- [ ] Locks keep the documented order (plan row, then lines in id order; the Shopping List's lines in id order), and `edit_recipe` never deadlocks against check-off, Claim, unclaim, add, remove or the delete trigger. Race tests, each holding a second session: an edit vs a check-off on a line it drops, an edit vs a Claim, an edit vs taking the Recipe off the list, and two edits at once
- [ ] Live: the `changed` Realtime ping goes out on every affected list's channel (data-layer test with a watching Friend and member)
- [ ] Offline: a queued change aimed at a line the edit deleted answers `gone` and is dropped, on a Shopping List and on a Cook Plan list (data-layer test)
- [ ] Access: only the owner edits a Recipe, and an edit gives nobody new read access (`tests/*.access.test.ts`, with the restatement tests extended)
- [ ] Flow `21-recipe-edit-updates-lists.yaml`: the dev user's Recipe is on their Shopping List and in a plan with sam; they add an Ingredient, drop one and change an amount; both lists show the change, and a line checked off beforehand stays
