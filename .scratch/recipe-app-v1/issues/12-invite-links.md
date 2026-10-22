# 12: Invite links

**What to build:** A user can create an invite link and send it through iMessage, WhatsApp or anywhere else. When the recipient opens it, including after installing the app and signing in for the first time, a friend request to the inviter is created.

**Blocked by:** 11 (Usernames and Friends).

**Status:** ready-for-agent

- [ ] The user can create and share an invite link through the iOS share sheet
- [ ] Opening the link with the app installed creates a friend request to the inviter
- [ ] Opening the link without the app leads to install, and the friend request is created after first sign-in
- [ ] Data-layer test: redeeming an invite token creates a request to the inviter; redeeming your own token does nothing
