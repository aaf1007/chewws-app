# Decisions for tickets 02, 08, 09, 10

Defaults chosen where the tickets leave things open. Override any by editing this file before the ticket starts. Implementers follow these; a reviewer treats a deviation as a finding.

## 02 Write a Recipe by hand

- **Ingredient** is global: one `ingredients` table, unique on the normalised name. Any signed-in user can read and insert; nobody updates or deletes.
- **Normalising a name**: lowercase, trim, collapse whitespace, strip punctuation, then singularise with a JS-only library (e.g. `pluralize`). "Garlic", "garlic " and "garlics" give the same Ingredient; "tomatoes" gives "tomato". Uncountable words must not be mangled: test that "hummus", "molasses" and "couscous" are unchanged. No fuzzy matching.
- **Typed lines**: each line has its original text, optional amount text and a required Ingredient name the user fills in or edits.
- A hand-made Recipe is `status = 'reviewed'`, `recipe_found = true`. Steps are an ordered list; lines have a position. `editRecipe` replaces all lines in one transaction (RPC). The library lists the user's reviewed Recipes, newest first.

## 08 Pantry and Staples

- Default Staples (salt, pepper, oil) are seeded by a trigger on Profile insert; the migration backfills existing Profiles.
- Pantry, Staples: owner-only RLS now. Ticket 15 will expose "who has it" to Cook Plan members; don't build that now.
- "Used up" deletes the Pantry entry. Staples change only through `setStaples`; a Staple always counts as in the Pantry.

## 09 Shopping List

- One Shopping List per user, created by trigger (backfill existing users).
- Hand-added items only look up an existing Ingredient by normalised name; they never create one. The match is stored when the item is added. So "paper towels" matches nothing and checking it off changes no Pantry.
- `checkOff` is a security-definer RPC that writes the **list owner's** Pantry, so ticket 13 (shared lists) needs no rewrite.
- Unchecking leaves the Pantry alone.
- Adding the same Recipe twice changes nothing. Deleting a Recipe removes its amount rows; an unchecked line with no amounts left is removed.

## 10 Lists work with no signal

- **Conflicts resolve by when each change was made** (decided by the human, 2026-10-24). Each queued change carries the phone's timestamp; an RPC compares it with the item's `updated_at` and rejects an older change. Clock skew is accepted.
- No new native module: a failed request means offline; retry on app foreground and on a timer. The data layer takes an injectable transport/connectivity switch so tests can go offline.
- Offline you can check, uncheck and add hand items. Removing needs a connection. Items added offline get a client-made UUID so replays are idempotent. Changes to an item deleted meanwhile are dropped. The last-seen list is cached in AsyncStorage.
