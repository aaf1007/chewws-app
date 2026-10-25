# 02: Write a Recipe by hand

**What to build:** A user can create a Recipe from scratch with a title, ingredient lines (original text and amount, each linked to an Ingredient they can change) and steps. They can edit and delete it. Their library lists their Recipes. Every Recipe belongs to exactly one user (ADR-0002) and nobody else can read it.

**Blocked by:** 01 (App skeleton and sign-in).

**Status:** done

- [x] The user can create a Recipe with title, ingredient lines and steps, and it appears in their library
- [x] Each ingredient line is linked to a plain Ingredient (e.g. "2 cloves garlic, minced" → garlic); the user can change which Ingredient a line is linked to
- [x] The Ingredient matcher normalises names so the same Ingredient isn't created twice under different spellings or casing
- [x] The user can edit and delete their Recipe
- [x] Data-layer test: another signed-in user cannot read, edit or delete the Recipe
- [x] Data-layer test: creating, editing and deleting a Recipe is reflected in the owner's library
