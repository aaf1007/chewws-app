# 21: Editing a Recipe updates its Shopping List lines

**What's wrong:** Editing a Recipe that's on the Shopping List (`edit_recipe` replaces its lines) leaves the list as it was: an Ingredient the edit adds gets no line, and one it drops stays on its unchecked line with the Recipe's old amounts. The spec doesn't say what should happen.

**Found:** PR #1 review.

**Proposed behaviour:** After an edit, the Recipe's amounts on the list follow its new lines: an Ingredient it now needs and the user doesn't have joins or makes a line, and amounts change to the new ones.
Its amounts leave the lines of Ingredients it no longer has; an unchecked line no other Recipe needs goes, and a checked-off one stays, as when a Recipe is taken off the list.

**Blocked by:** None

**Status:** needs-triage
