# 15: The Cook Plan list

**What to build:** A Cook Plan has its own combined list of every Ingredient its Recipes need, built by the list engine, with one line per Ingredient and each Recipe's amount shown. Each line shows which members already have it, from their Pantry or Staples. Members can Claim and unclaim items, and Claims are visible to everyone in the plan. Checked-off items go into the buyer's own Pantry. The list updates live and works offline like the Shopping List. If an owner deletes a Recipe that's in the plan, they're warned first. Its unbought, unclaimed lines are removed, but Claimed or checked-off lines stay.

**Blocked by:** 10 (Lists work with no signal), 14 (Start a Cook Plan).

**Status:** ready-for-agent

- [ ] The Cook Plan list shows one line per Ingredient across the plan's Recipes, with per-Recipe amounts
- [ ] Each line shows the members who have that Ingredient (Pantry or Staples)
- [ ] Members can Claim and unclaim items; Claims show who claimed
- [ ] Checking off an item puts it in the checking member's Pantry
- [ ] The list updates live for all members and supports offline changes
- [ ] Deleting a Recipe that's in a Cook Plan warns the owner first, then removes its unclaimed, unchecked lines while keeping Claimed or checked ones
- [ ] Data-layer tests cover who-has-it, Claim visibility, check-off going to the buyer's Pantry, and the deletion rule
