# 14: Start a Cook Plan

**What to build:** A user can start a Cook Plan with an optional date and invite one or more Friends. Invites trigger a push notification. Any member can add Recipes from their own library to the plan or remove them, with no voting. Every member can see every Recipe in the plan and save their own copy of it. If two members unfriend each other, both stay in their existing Cook Plans, but neither can invite the other to new ones.

**Blocked by:** 02 (Write a Recipe by hand), 11 (Usernames and Friends).

**Status:** ready-for-agent

- [ ] The user can create a Cook Plan with an optional date and invite Friends only
- [ ] Invited Friends get a push and the plan appears for them
- [ ] Any member can add a Recipe from their library or remove any Recipe from the plan
- [ ] Every member can view every Recipe in the plan, including others' Recipes
- [ ] A member can save their own copy of a plan Recipe; the copy is independent (ADR-0002)
- [ ] Data-layer tests: a non-member can't see the plan or its Recipes; unfriended members stay in existing plans but can't invite each other to new ones
