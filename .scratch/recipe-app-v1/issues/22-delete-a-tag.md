# 22: Delete a Tag

**What's wrong:** A Tag stays in the user's Tags after it's taken off its last Recipe (decisions 06), and nothing in the app can delete it. The data layer has `deleteTag(tagId)`, which deletes one of the user's Tags and takes it off every Recipe it was on, but no screen calls it. A Tag the user no longer wants keeps its name taken: typing it again on a Recipe brings back its old spelling.

**Found:** Ticket 06 review.

**Proposed behaviour:** The user can see their Tags (with how many Recipes each is on) and delete one, after a confirmation that names the Recipes it will come off. Where the list lives (Profile, or a "Tags" row in the Library) is to decide.

**Blocked by:** 06 (Tags, search and Want to Cook)

**Status:** needs-triage
