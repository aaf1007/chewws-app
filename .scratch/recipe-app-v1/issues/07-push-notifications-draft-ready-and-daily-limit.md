# 07: Push notifications, "Draft ready" and the daily limit

**What to build:** The app registers each device for Expo push notifications. When the Draft builder finishes, the user gets a "Draft ready" notification that opens the Draft. A Drafts screen lists all unreviewed Drafts. Each user can save at most 30 links a day. The 31st save is refused with a clear message, and no Draft is built for it.

**Blocked by:** 03 (Save a TikTok link into a Draft).

**Status:** done

- [x] The app asks for notification permission and stores a push token per device per user (flow `07-push-and-daily-limit.yaml`: no prompt at launch, the prompt after the first saved link; `tests/push-and-daily-limit.test.ts`: tokens per phone, moved to a new user, forgotten on sign-out; `tests/push.access.test.ts`)
- [x] A finished Draft sends a "Draft ready" notification; tapping it opens that Draft (tests: one push per phone, none for a failed build, none on a second kick; flow 07: `xcrun simctl push` of `.maestro/assets/draft-ready.apns`, tapped, opens that Draft)
- [x] A Drafts screen lists every unreviewed Draft (ticket 03's Drafts list, reached from the "Drafts (n)" row: `listDrafts` tests in `tests/drafts.test.ts`; flow 07 shows a ready and a recipe-not-in-caption Draft there)
- [x] The 31st save in a day is refused with a message explaining the limit (flow 07: "You've saved 30 links in the last 24 hours, the daily limit. You can save again at …", no Draft made)
- [x] Data-layer tests: the 31st save in a day is refused and the 30th succeeds; a finished Draft triggers exactly one push to the owner (push sender faked) (`tests/push-and-daily-limit.test.ts`: "the 30th link save in a day succeeds and the 31st is refused…" with 30 real saves, and "a finished Draft sends exactly one 'Draft ready' push…")
