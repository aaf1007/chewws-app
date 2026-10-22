# 18: "We cooked it"

**What to build:** Any member of a Cook Plan can tap "We cooked it". The plan moves to an archive, and each member is prompted to add a Cook Log for each of the plan's Recipes, with the other members already filled in as cooked-with. They're also prompted to rank each Recipe. Both are optional. Users can browse their archived Cook Plans.

**Blocked by:** 14 (Start a Cook Plan), 17 (Ranking).

**Status:** ready-for-agent

- [ ] "We cooked it" sets the plan to cooked and moves it to the archive for all members
- [ ] Each member is prompted to add a Cook Log per Recipe, with other members pre-filled as cooked-with, and to rank it
- [ ] Members can dismiss the prompts without logging or ranking
- [ ] A member logging a Recipe they don't own is offered to save their own copy first, so the Cook Log and Ranking attach to their copy
- [ ] Users can view archived Cook Plans
- [ ] Data-layer tests: marking cooked archives the plan for every member; a Cook Log created from the prompt lists the other members
