# 16: Cook Logs and the Saved/Cooked filter

**What to build:** A user can add a Cook Log to any of their Recipes, with a date, notes, photos and the Friends they cooked with. They can add several Cook Logs to one Recipe, and edit or delete them. A Recipe with at least one Cook Log counts as Cooked, and the library can filter by Saved vs Cooked. Friends can read each other's Cook Logs, and strangers can't.

**Blocked by:** 02 (Write a Recipe by hand), 11 (Usernames and Friends).

**Status:** ready-for-agent

- [ ] The user can add a Cook Log with date, notes, photos and cooked-with Friends (e2e owed: data layer and tests pass; the screens wait on `.maestro/16-cook-logs.yaml` passing on the simulator)
- [ ] Several Cook Logs per Recipe are allowed; each can be edited or deleted (e2e owed: data layer and tests pass; the screens wait on `.maestro/16-cook-logs.yaml` passing on the simulator)
- [ ] A Recipe with a Cook Log shows as Cooked; deleting its last Cook Log makes it Saved again (e2e owed: data layer and tests pass; the screens wait on `.maestro/16-cook-logs.yaml` passing on the simulator)
- [ ] The library filters by Saved vs Cooked (e2e owed: data layer and tests pass; the screens wait on `.maestro/16-cook-logs.yaml` passing on the simulator)
- [x] Photos are stored as the user's own images
- [x] Data-layer tests: a Friend can read the user's Cook Logs, a stranger can't, and an unfriended user no longer can
