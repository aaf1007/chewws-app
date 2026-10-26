# 10: Lists work with no signal

**What to build:** A user in a store with no signal can still check off, uncheck and add Shopping List items. Changes are queued on the phone and sent when it reconnects. When two changes to the same item conflict, the later one wins. The rest of the app may still require a connection.

**Blocked by:** 09 (Shopping List).

**Status:** done

- [x] With the network off, checking off, unchecking and adding items update the list on screen
- [x] On reconnect, queued changes are sent in order and the server matches the phone
- [x] Two conflicting changes to the same item resolve to the later one
- [x] The app tells the user when list changes are waiting to sync
- [x] Data-layer tests simulate offline changes and reconnect, including a conflicting check from a second client

## Comments

2026-10-25: Known limits. Rare edge cases of signing out while an offline sync is under way, beyond those fixed in the final fix round (a change discarded while its send waited for a session is never sent; a cold start offline with no remembered user signs in as the kept session's user; ended sessions are remembered by session id), are known limits, not blockers. The limits accepted while building this ticket (clock skew, a check made in a dead zone just before signing out is lost, a session ended offline stays alive on the server until its refresh token expires) are in `decisions.md` §10.
