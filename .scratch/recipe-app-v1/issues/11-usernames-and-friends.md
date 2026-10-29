# 11: Usernames and Friends

**What to build:** Users pick a unique username, which they can change later. They can search for others by username, send a friend request, and accept or decline incoming ones. Incoming requests trigger a push notification. Friendship is mutual and only exists once accepted. Users can unfriend. Strangers see nothing beyond username search results.

**Blocked by:** 01 (App skeleton and sign-in), 07 (Push notifications, "Draft ready" and the daily limit).

**Status:** done

- [x] New users choose a unique username; duplicates are refused; it can be changed later (`tests/friends.test.ts`: a new user must choose one, taken in any case, reserved and invalid names refused, changed later with the old one free at once, two users racing for one name; `tests/username.test.ts` for the normaliser; flow `11-usernames-and-friends.yaml`: "Choose a username" before the tabs, "@sam is taken", the rule shown for "ab", then changed under Profile)
- [x] Username search returns matching users (tests: prefix match, exact first then by name, at most 10, 3-character minimum, `_` taken literally, never yourself; flow 11 finds @alex_cooks)
- [x] The user can send a friend request; the recipient gets a push and can accept or decline (tests: one "Friend request" push through the recording sender, none on accepting, none again within 7 days, a failed push never fails the request; flow 11: sam's request arrives as a push (`xcrun simctl push`), its tap opens Friends with Requests first, and it's accepted)
- [x] After acceptance both users see each other as Friends; after unfriending neither does (tests; flow 11 accepts sam, alex_cooks accepts through `scripts/e2e-db.mjs`, then sam is unfriended)
- [x] Data-layer tests: a pending or declined request creates no Friendship; unfriending removes it both ways; a stranger can find a username but read nothing else (`tests/friends.test.ts`; `tests/friends.access.test.ts` attacks profiles, `friendships`, the private schema, the decline, the 50-request cap and the 7-day push limit with a stranger's raw client, each case seen failing with its rule loosened)
