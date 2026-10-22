# 11: Usernames and Friends

**What to build:** Users pick a unique username, which they can change later. They can search for others by username, send a friend request, and accept or decline incoming ones. Incoming requests trigger a push notification. Friendship is mutual and only exists once accepted. Users can unfriend. Strangers see nothing beyond username search results.

**Blocked by:** 01 (App skeleton and sign-in), 07 (Push notifications, "Draft ready" and the daily limit).

**Status:** ready-for-agent

- [ ] New users choose a unique username; duplicates are refused; it can be changed later
- [ ] Username search returns matching users
- [ ] The user can send a friend request; the recipient gets a push and can accept or decline
- [ ] After acceptance both users see each other as Friends; after unfriending neither does
- [ ] Data-layer tests: a pending or declined request creates no Friendship; unfriending removes it both ways; a stranger can find a username but read nothing else
