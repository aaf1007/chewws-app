# 14: Start a Cook Plan

**What to build:** A user can start a Cook Plan with an optional date and invite one or more Friends. Invites trigger a push notification. Any member can add Recipes from their own library to the plan or remove them, with no voting. Every member can see every Recipe in the plan and save their own copy of it. If two members unfriend each other, both stay in their existing Cook Plans, but neither can invite the other to new ones.

**Blocked by:** 02 (Write a Recipe by hand), 11 (Usernames and Friends).

**Status:** done

- [x] The user can create a Cook Plan with an optional date and invite Friends only (`tests/cook-plans.test.ts`: starts a plan on a day, needs no day, only Friends are invited; flow 14)
- [x] Invited Friends get a push and the plan appears for them (`cook-plans.test.ts`: one push per member per plan; `cook-plan-invite-push.test.ts`; flow 14 taps the push)
- [x] Any member can add a Recipe from their library or remove any Recipe from the plan (`cook-plans.test.ts`; caps and races in both test files; flow 14)
- [x] Every member can view every Recipe in the plan, including others' Recipes (`cook-plans.test.ts`; `cook-plans.access.test.ts`, never Tags, Want to Cook, Drafts or screenshot; flow 14)
- [x] A member can save their own copy of a plan Recipe; the copy is independent (ADR-0002) (`cook-plans.test.ts`: independence, `fetched_at` kept, again makes another; access test: no Tags, Want to Cook or screenshot; flow 14)
- [x] Data-layer tests: a non-member can't see the plan or its Recipes; unfriended members stay in existing plans but can't invite each other to new ones (`cook-plans.access.test.ts` and `cook-plans.test.ts`, each proved to bite by loosening its rule)
