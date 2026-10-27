# 20: Sign-out can be undone by a late token refresh

**What's wrong:** In a rare race, signing out does not stick. The user signs out while the auth client is retrying a token refresh with no signal, and the auth client is reading the saved session at that moment. When the signal comes back, the refreshed session is written to the phone after the sign-out. The screens say signed out, but `getShoppingList()` still works as that user, and a restart would likely sign them back in. On a shared phone the next person could see the previous user's data.

**Found:** Ticket 10's last fix round. `tests/shopping-list-offline-session.test.ts` reproduces the race with the harness hook `slowNextSessionRead()`. Ticket 10's `session_id` keying keeps the session state signed out, but it doesn't stop the write.

**Likely fix:** After a session ends on the phone, refuse any session write for that `session_id` in the auth client's storage adapter (`src/data/session-storage.ts`), so a late refresh can't save it. Test: the same race, then assert the phone's stored session is empty and a cold relaunch stays signed out.

**Blocked by:** None.

**Status:** done
