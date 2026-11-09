# 13: Share your Shopping List

**What to build:** A user can share their Shopping List with chosen Friends, for example a roommate. Those Friends see the list update live, and can add items and check them off. Anything checked off goes into the list owner's Pantry, because it's the owner's list. The owner can stop sharing at any time. Unfriending also ends the sharing.

**Blocked by:** 09 (Shopping List), 11 (Usernames and Friends).

**Status:** done

- [x] The owner can share their Shopping List with one or more Friends and stop sharing (`tests/shared-shopping-list.test.ts`: sharing with two Friends, again, and with a non-Friend refused; stopping and leaving, each answering `notShared` the second time; races with a held second session for sharing, stopping, leaving, and sharing while being unfriended; flow `13-share-shopping-list.yaml`: the share sheet, Share and Stop sharing @alex_cooks)
- [x] Shared Friends can view, add, check off and uncheck items, and see changes live (tests: a Friend reads the list with its Recipe titles, adds, checks, unchecks and removes hand-added items but not Recipe lines or Recipes; live through Realtime both ways, and told when sharing stops; flow 13: "Sam's list" in the switcher, Bananas added, Coffee beans checked off, sam's Dish soap arriving live)
- [x] Items checked off by a shared Friend go into the owner's Pantry, not the Friend's (tests: an Ingredient line and a hand-added item matching an Ingredient land in the owner's Pantry, the Friend's stays empty; owner and Friend checking the same item at once keep the first checker)
- [x] Shared Friends' offline changes sync like the owner's (`tests/shared-shopping-list-offline.test.ts`: queued, shown and kept across a restart, then synced; sent after the share ended or an unfriend they come back gone, the copy is dropped and the view says 2 changes weren't saved; never sent as the next user on the phone, the 401-retry window included; changes from older versions that name no list go to the user's own; flow 13: two changes offline, synced via `scripts/net.sh`, checked on the server, then one lost to sam stopping)
- [x] Data-layer tests: a shared Friend's check-off lands in the owner's Pantry; a non-shared Friend can't read the list; unfriending removes access (`tests/shared-shopping-list.test.ts`; `tests/shared-shopping-list.access.test.ts` attacks reads, writes and the Realtime topic as a stranger, a Friend it isn't shared with and an unfriended Friend before the cleanup trigger runs, each case seen failing with its rule loosened)
