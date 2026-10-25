# 09: Shopping List

**What to build:** A user can add a Recipe to their Shopping List, and only Ingredients not in their Pantry or Staples are added. An Ingredient needed by several Recipes shows as one line with each Recipe's amount underneath. Amounts are never added together. The user can add items by hand. Checking off a Recipe Ingredient puts it in their Pantry. Checking off a hand-added item puts it in the Pantry only if it matches an Ingredient. The user can remove items or a whole Recipe's lines. This logic lives in the list engine, which Cook Plans reuse later.

**Blocked by:** 08 (Pantry and Staples).

**Status:** done

- [x] Adding a Recipe adds only Ingredients the user doesn't have (Pantry or Staples)
- [x] Two Recipes needing the same Ingredient produce one line showing both amounts, labelled by Recipe
- [x] The user can add hand-written items
- [x] Checking off a Recipe Ingredient puts it in the user's Pantry; checking off a hand-added item that matches an Ingredient does too; one that doesn't changes no Pantry
- [x] The user can uncheck, remove an item, or remove all lines from one Recipe
- [x] Data-layer tests cover each of the rules above
