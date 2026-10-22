# 07: Push notifications, "Draft ready" and the daily limit

**What to build:** The app registers each device for Expo push notifications. When the Draft builder finishes, the user gets a "Draft ready" notification that opens the Draft. A Drafts screen lists all unreviewed Drafts. Each user can save at most 30 links a day. The 31st save is refused with a clear message, and no Draft is built for it.

**Blocked by:** 03 (Save a TikTok link into a Draft).

**Status:** ready-for-agent

- [ ] The app asks for notification permission and stores a push token per device per user
- [ ] A finished Draft sends a "Draft ready" notification; tapping it opens that Draft
- [ ] A Drafts screen lists every unreviewed Draft
- [ ] The 31st save in a day is refused with a message explaining the limit
- [ ] Data-layer tests: the 31st save in a day is refused and the 30th succeeds; a finished Draft triggers exactly one push to the owner (push sender faked)
