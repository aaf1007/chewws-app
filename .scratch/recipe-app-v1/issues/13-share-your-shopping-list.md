# 13: Share your Shopping List

**What to build:** A user can share their Shopping List with chosen Friends, for example a roommate. Those Friends see the list update live, and can add items and check them off. Anything checked off goes into the list owner's Pantry, because it's the owner's list. The owner can stop sharing at any time. Unfriending also ends the sharing.

**Blocked by:** 09 (Shopping List), 11 (Usernames and Friends).

**Status:** ready-for-agent

- [ ] The owner can share their Shopping List with one or more Friends and stop sharing
- [ ] Shared Friends can view, add, check off and uncheck items, and see changes live
- [ ] Items checked off by a shared Friend go into the owner's Pantry, not the Friend's
- [ ] Shared Friends' offline changes sync like the owner's
- [ ] Data-layer tests: a shared Friend's check-off lands in the owner's Pantry; a non-shared Friend can't read the list; unfriending removes access
