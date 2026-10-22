# 08: Pantry and Staples

**What to build:** A user can mark Ingredients as in their Pantry or used up. The Pantry records only whether they have an Ingredient, never how much (ADR-0003). They have an editable list of Staples (salt, pepper, oil by default) that are always treated as being in their Pantry.

**Blocked by:** 02 (Write a Recipe by hand).

**Status:** ready-for-agent

- [ ] The user can add Ingredients to their Pantry and mark them used up
- [ ] New users start with a default Staples list they can edit
- [ ] Staples always count as in the Pantry for any check that asks "does this user have X?"
- [ ] Data-layer tests: Pantry and Staples are visible only to their owner; a Staple counts as present even if not in the Pantry
