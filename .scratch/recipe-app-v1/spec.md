# Spec: Recipe App v1

Status: ready-for-agent

## Problem Statement

I find recipes on TikTok, Instagram Reels and YouTube Shorts, and I save them in each app's saved folder. Those folders pile up with no way to search them, see the ingredients at a glance, or tell which recipes I've actually cooked. When I go shopping I have to rewatch videos to work out what to buy, and I don't know what I already have at home. When I want to cook with a friend, we coordinate in a group chat: which recipe, who buys what, and who already has the garlic. Afterwards there's no record of what we made or how good it was compared to everything else I've cooked.

## Solution

A mobile app (iPhone first) where saving a recipe from a short-form video takes one tap from the platform's share sheet. The app turns the video's caption (or, for Instagram, a screenshot or pasted caption) into a Draft with ingredients, steps and Tags, which I review whenever I like. My Recipes live in one searchable library with a Want to Cook list.

I keep a Pantry of what I have (have-it-or-not, plus Staples like salt) and a Shopping List of what I need. Adding a Recipe to the Shopping List adds only what my Pantry doesn't already cover. Checking an item off at the store moves it into my Pantry. I can share my Shopping List with chosen Friends.

To cook with Friends, I start a Cook Plan. We add the Recipes we're making, get one shared list that shows who already has each Ingredient, and Claim the rest so nobody double-buys. When we tap "We cooked it", each of us writes a Cook Log and can rank the Recipe Beli-style. We pick Liked, Fine or Didn't like, answer a few "better or worse than X?" comparisons, and the Recipe gets a 0–10 Score in our personal Ranking. Friends can browse each other's Rankings and Cook Logs.

## User Stories

### Accounts

1. As a new user, I want to sign in with Apple, so that I can start without creating a password.
2. As a new user, I want to sign in with Google, so that I can use the account I already have.
3. As a new user, I want to choose a unique username, so that Friends can find me.
4. As a user, I want my Recipes, Pantry and Shopping List saved to my account, so that I don't lose them if I change phones.
5. As a user, I want to change my username later, so that I'm not stuck with my first choice.

### Saving a Recipe

6. As a user watching a TikTok, I want to tap Share and pick this app, so that I can save the recipe without leaving TikTok for long.
7. As a user watching a YouTube Short, I want to share it into the app the same way, so that all my saved recipes end up in one place.
8. As a user watching an Instagram Reel, I want to share the link along with a screenshot of the caption, so that the app can read the recipe even though Instagram gives apps nothing.
9. As a user saving an Instagram Reel, I want to paste the caption text instead of a screenshot, so that I can use whichever is easier.
10. As a user, I want saving to finish instantly without waiting for processing, so that saving never interrupts my scrolling.
11. As a user, I want the app to build a Draft in the background with the title, Ingredients, amounts and steps, so that I don't have to type the recipe myself.
12. As a user, I want a notification when my Draft is ready, so that I know I can review it.
13. As a user, I want to review a Draft and fix anything the AI got wrong before it becomes a Recipe, so that my Recipes are accurate.
14. As a user, I want to leave Drafts unreviewed as long as I like, so that "maybe someday" saves don't nag me.
15. As a user, I want to see my unreviewed Drafts in one place, so that I can review a batch when I have time.
16. As a user, I want the app to follow a recipe-site link found in the caption and read the recipe from that page, so that "full recipe at the link" videos still produce a full Draft.
17. As a user, I want a Draft clearly marked "recipe not in caption" when the caption says "link in bio" or has no recipe, so that I know I need to fill it in.
18. As a user, I want to save a link from any website (a blog, Pinterest), so that the app is my only recipe library.
19. As a user, I want TikTok and YouTube Recipes to show the video's thumbnail and creator, so that I recognise them at a glance.
20. As a user, I want Instagram Recipes to show a plain Instagram card or my screenshot as their picture, so that they still look distinct in my library.
21. As a user, I want to tap a Recipe's Source Video to open it in the original app, so that I can rewatch the technique.
22. As a user, I want to create a Recipe from scratch with no video, so that I can save family recipes too.
23. As a user, I want to be told when I hit the daily save limit, so that I understand why a Draft didn't appear.
24. As a user, I want each ingredient line linked to a plain Ingredient (e.g. "2 cloves garlic, minced" → garlic), so that my Pantry and Shopping List understand it.
25. As a user, I want to correct which Ingredient a line is linked to, so that matching stays right when the AI guesses wrong.

### Library

26. As a user, I want suggested Tags (cuisine, meal type, "quick") on each Draft, so that my library is organised without effort.
27. As a user, I want to add, remove and create Tags, so that I can organise Recipes my way.
28. As a user, I want to search my Recipes by title, Ingredient or Tag, so that I can find "that chicken thing" quickly.
29. As a user, I want to filter by Saved vs Cooked, so that I can see what I haven't tried yet.
30. As a user, I want to mark Recipes as Want to Cook, so that I have a short list of what to make next.
31. As a user, I want to edit any Recipe after saving it, so that I can record my own tweaks.
32. As a user, I want to delete a Recipe, so that my library stays clean.
33. As a user deleting a Recipe that's in a Cook Plan, I want a warning saying so, so that I don't break my friends' plan by accident.

### Pantry

34. As a user, I want to mark Ingredients as in my Pantry, so that the app knows what I have.
35. As a user, I want to mark Ingredients as used up, so that my Pantry stays true.
36. As a user, I want a Staples list (salt, pepper, oil) that's always assumed to be in my Pantry, so that they never clutter my Shopping List.
37. As a user, I want to edit my Staples, so that they match my kitchen.

### Shopping List

38. As a user, I want to add a Recipe to my Shopping List and have only the Ingredients I don't have (not in my Pantry or Staples) added, so that I only buy what I need.
39. As a user, I want Ingredients needed by several Recipes shown as one line with each Recipe's amount underneath, so that I buy enough without doing maths.
40. As a user, I want to add items by hand (paper towels, snacks), so that this is my only shopping list.
41. As a user, I want checking off a Recipe Ingredient to put it in my Pantry, so that I don't have to update two places.
42. As a user, I want hand-added items that aren't Ingredients to stay out of my Pantry when checked, so that my Pantry holds only food.
43. As a user, I want to remove items or a whole Recipe's lines from my Shopping List, so that I can change my mind.
44. As a user in a store with no signal, I want to check items off and have it sync when I'm back online, so that the list works where I actually shop.
45. As a user, I want to share my Shopping List with chosen Friends, so that my roommate can add to it and shop from it.
46. As a Friend on a shared Shopping List, I want to add and check off items, so that we can shop for the house together.
47. As a list owner, I want items a Friend checks off on my list to go into my Pantry, so that my Pantry reflects what was bought for me.
48. As a list owner, I want to stop sharing with a Friend, so that I control who sees my list.
49. As a user, I want changes to a shared list to appear live, so that two people shopping at once don't buy the same thing.

### Friends

50. As a user, I want to search for Friends by username, so that I can connect with people already on the app.
51. As a user, I want to send an invite link through iMessage or WhatsApp, so that friends who don't have the app can install it and connect with me.
52. As a user receiving a friend request, I want to accept or decline it, so that only people I choose become Friends.
53. As a user, I want a notification for incoming friend requests, so that I don't miss them.
54. As a user, I want to unfriend someone, so that they no longer see my Rankings, Cook Logs or shared lists.
55. As a user, I want strangers unable to see my Recipes, Rankings or Cook Logs, so that my activity is private by default.

### Cook Plans

56. As a user, I want to start a Cook Plan and invite one or more Friends, so that we can plan a meal together.
57. As an invited Friend, I want a notification for Cook Plan invites, so that I can join quickly.
58. As a Cook Plan member, I want to add Recipes from my library to the plan, so that we can decide what to make.
59. As a Cook Plan member, I want to remove Recipes from the plan, so that we can change our minds without voting.
60. As a Cook Plan member, I want to see a Recipe another member added, so that I know what we're making.
61. As a Cook Plan member, I want to save my own copy of a Recipe in the plan, so that I can keep it after we cook.
62. As a Cook Plan member, I want an optional date on the plan, so that we remember when we're cooking.
63. As a Cook Plan member, I want one list of every Ingredient the plan's Recipes need, so that we see everything at once.
64. As a Cook Plan member, I want each line to show which members already have that Ingredient (Pantry or Staples), so that nobody buys what someone already has.
65. As a Cook Plan member, I want to Claim an item, so that others know I'm buying it.
66. As a Cook Plan member, I want to unclaim an item, so that someone else can pick it up if I can't.
67. As a Cook Plan member, I want to check off items I bought and have them go into my own Pantry, so that my Pantry stays right.
68. As a Cook Plan member, I want the Cook Plan list to work offline like my Shopping List, so that I can shop with no signal.
69. As a Cook Plan member, I want to tap "We cooked it", so that the plan is finished and archived.
70. As a Cook Plan member, I want to be asked to write a Cook Log and rank each Recipe after "We cooked it", without being forced to, so that recording is easy but optional.
71. As a Cook Plan member, I want to see archived Cook Plans, so that I can look back on what we made together.
72. As a member of a Cook Plan whose Recipe the owner deleted, I want the Recipe and its unbought lines to disappear while Claimed and checked-off lines stay, so that the plan stays accurate without losing what people already bought.
73. As someone who unfriended a fellow member, I want us both to stay in our existing Cook Plans, so that the meal isn't disrupted, though neither of us can invite the other again.

### Cook Logs

74. As a user, I want to add a Cook Log to any Recipe I've cooked (date, who I cooked with, notes, photos), so that I have a record of each time.
75. As a user, I want a Recipe to count as Cooked once it has a Cook Log, so that the Saved/Cooked filter is automatic.
76. As a user, I want to add several Cook Logs to the same Recipe, so that I can track how it went each time.
77. As a user, I want to edit or delete my Cook Logs, so that I can fix mistakes.

### Ranking

78. As a user who just cooked a Recipe, I want to pick Liked, Fine or Didn't like, so that the Recipe lands in the right range quickly.
79. As a user, I want to answer a few "better or worse than X?" comparisons against Recipes I've already ranked, so that the Recipe's exact spot in my Ranking is found without me assigning numbers.
80. As a user, I want only about 3–5 comparisons even with 100 cooked Recipes, so that ranking stays quick.
81. As a user, I want to skip the comparisons and have the Recipe placed in the middle of its band, so that I can rank in one tap when I'm busy.
82. As a user, I want every Recipe in my Ranking to show a 0–10 Score, so that I can compare at a glance.
83. As a user, I want to re-rank a Recipe after cooking it again, so that my Ranking reflects my latest opinion.
84. As a user, I want to view my whole Ranking in order, so that I can see my best and worst Recipes.
85. As a user who cooked a Recipe with a Friend, I want to rank it on my own, so that my Ranking is my opinion, not ours.
86. As a user, I want a deleted Recipe removed from my Ranking with the other Scores adjusting, so that my Ranking has no gaps.

### Friend profiles

87. As a user, I want to open a Friend's profile and browse their Ranking, so that I can find great Recipes they've cooked.
88. As a user, I want to see a Friend's Cook Logs, so that I can see what they've been making and with whom.
89. As a user, I want to save my own copy of a Recipe from a Friend's profile, so that I can cook it too.

## Implementation Decisions

### Platform and stack

- React Native with Expo and TypeScript, iPhone first. Android should need little extra work later.
- The app runs as a development build via EAS rather than in Expo Go, because receiving shared links needs a native share extension.
- Receiving shares uses `expo-share-intent`. Its iOS activation rules accept a URL, plus images and text, for the Instagram screenshot and pasted-caption path. `expo-sharing`'s receiving support is the first-party option to revisit once it's no longer experimental.
- Backend: Supabase, covering Postgres, Auth, Realtime, Storage and Edge Functions (ADR-0001).
- Auth is Sign in with Apple and Google through Supabase Auth.
- Push notifications go through Expo's push service.

### Modules

1. **Data layer.** A typed set of actions the screens call, and the only way the UI reads or writes data. Examples:
   - `saveFromLink`, `reviewDraft`, `createRecipe`, `editRecipe`, `deleteRecipe`
   - `setPantry`, `setStaples`
   - `addRecipeToShoppingList`, `addManualItem`, `checkOff`, `shareShoppingList`
   - `sendFriendRequest`, `respondToFriendRequest`, `createInviteLink`, `unfriend`
   - `createCookPlan`, `inviteToCookPlan`, `addRecipeToCookPlan`, `claim`, `unclaim`, `markCookPlanCooked`
   - `addCookLog`
   - `startRanking`, `answerComparison`, `skipComparisons`
   - `getRanking`, `getFriendProfile`

   It hides Supabase, Realtime subscriptions and the offline queue from the screens. This is the main test seam (see Testing Decisions).
2. **Source reader.** A single interface that takes what was shared (a URL, plus an optional screenshot or text) and returns the raw material for a Draft: platform, external ID, caption or description text, thumbnail reference, creator, and any recipe-site URL it found. It has one adapter per source:
   - **TikTok**: oEmbed, with no auth. `title` is the caption, plus `author_name`, `author_url` and `thumbnail_url`.
   - **YouTube Shorts**: Data API v3 `videos.list` with `part=snippet`, using an API key. It takes the description, title, thumbnails and channel title.
   - **Instagram**: no network call. It uses only the user-supplied screenshot or text and keeps the link (ADR-0004).
   - **Recipe site**: fetches the page and reads its schema.org Recipe markup.
   - **Generic link**: page title and Open Graph image only.
3. **Draft builder.** A Supabase Edge Function that runs after a save in the background. It passes the source reader's output to Claude Haiku 5.5 and receives structured output:
   - title
   - ingredient lines, each with original text, amount text and a linked Ingredient name
   - steps
   - suggested Tags
   - a `recipeFound` flag

   Haiku also reads Instagram screenshots through image input. When it finishes, the Recipe is marked as an unreviewed Draft and a "Draft ready" push is sent. It enforces a limit of 30 saves per user per day.
4. **Ingredient matcher.** Normalises Ingredient names so lines, the Pantry, Staples and lists all refer to the same Ingredient. It matches hand-added Shopping List items to an Ingredient when the name matches.
5. **List engine.** Pure logic shared by the Shopping List and Cook Plan lists:
   - turns Recipes into lines, merging by Ingredient with per-Recipe amounts and never adding amounts together
   - excludes Pantry and Staples for the Shopping List
   - annotates "who has it" for Cook Plan lists
   - decides where a checked-off Ingredient goes: the list owner's Pantry for a Shopping List, the buyer's Pantry for a Cook Plan
6. **Offline sync for lists.** Only Shopping List and Cook Plan list changes (check, uncheck, add, claim) are queued locally while offline and replayed on reconnect. Conflicts on the same item resolve by last write wins. Everything else in the app needs a connection.
7. **Ranking engine.** Pure logic:
   - Each user has one Ranking split into three bands: Liked (6.7–10), Fine (3.4–6.6) and Didn't like (0–3.3).
   - A new Recipe goes into its chosen band by binary search, one "better or worse than X?" comparison per step against Recipes in that band. That takes about log₂(band size) comparisons.
   - Skipping places the Recipe at the middle of its band.
   - Scores are spread evenly within each band: with `n` Recipes in a band from `lo` to `hi`, the Recipe at position `i` (1 = best) gets `hi − (hi − lo) × i / (n + 1)`, rounded to one decimal.
   - Re-ranking removes the Recipe and inserts it again. Deleting removes it and recomputes the Scores in that band.
8. **Social and access rules.** Postgres row-level security is the single place visibility is enforced:
   - Recipes, Pantry, Staples and the Shopping List are visible only to their owner, plus Friends the Shopping List is shared with.
   - Rankings and Cook Logs are visible to the owner and their Friends.
   - Cook Plan contents are visible to the plan's members, including the Recipes added to the plan.
   - Strangers see nothing beyond username search results.

### Schema outline

These are entities and relationships, not final column lists:

- **Profile**: one per auth user, with a unique username.
- **Friendship**: requester, addressee, status (pending, accepted, declined). Accepted is mutual.
- **Invite link**: a token tied to the inviter. Opening it after install creates a friend request.
- **Recipe**:
  - owner, title, steps, status (draft or reviewed), `recipeFound`, Want to Cook flag, optional Source Video.
  - A Recipe has one owner, and copies are independent rows (ADR-0002).
  - A copy may record which Recipe it was copied from, for display only.
- **Source Video**: platform, original URL, external ID, creator, plus fetched caption, thumbnail URL and a fetched-at timestamp.
  - YouTube metadata is re-fetched when older than 30 days.
  - Platform thumbnails are never copied into storage. When the stored URL fails, it's re-fetched (ADR-0004).
  - User-supplied Instagram screenshots are stored as the user's own images.
- **Recipe line**: belongs to a Recipe. Has original text, amount text and a linked Ingredient.
- **Ingredient**: a normalised name.
- **Tag** and Recipe–Tag join: Tags are per user.
- **Pantry entry**: user plus Ingredient, presence only (ADR-0003).
- **Staple**: user plus Ingredient.
- **Shopping List**: one per user. It has list shares (list plus Friend) and items. An item is either an Ingredient line with per-Recipe amounts or a hand-added text item, plus a checked flag, who checked it, and when.
- **Cook Plan**: creator, optional date, status (active or cooked), members, Recipes and items. An item is an Ingredient line with per-Recipe amounts, plus an optional Claim (member), checked flag and who bought it.
- **Cook Log**: user, Recipe, date, notes, photos, and the users cooked with.
- **Ranking entry**: user, Recipe, band and position within the band. The Score is derived from position, never stored as user input.
- **Push token**: per device, per user.

### Specific interactions

- **Save flow:**
  1. The share sheet opens a small confirm screen.
  2. For Instagram links, it offers "Add screenshot" and "Paste caption".
  3. Tapping Save creates the Recipe row (status draft, not yet built) and returns at once.
  4. The Draft builder fills the Recipe in later.
- **"Link in bio" or no recipe** in the caption: `recipeFound` is false and the Draft shows "recipe not in caption" with empty Ingredients and steps for the user to fill in.
- **Deleting a Recipe that's in a Cook Plan:**
  - The user gets a warning first.
  - On delete, the Recipe leaves every Cook Plan.
  - Its unclaimed, unchecked lines in that plan are removed. Claimed or checked-off lines stay.
- **Unfriending:**
  - It removes Ranking, Cook Log and Shopping List visibility both ways.
  - Existing Cook Plan memberships are kept.
  - Neither person can invite the other to new Cook Plans.
- **"We cooked it":** sets the Cook Plan to cooked (archived) and prompts each member to add a Cook Log per Recipe and optionally rank. The Cook Log records the other members as people cooked with.
- **Push notifications** are sent only for friend requests, Cook Plan invites and "Draft ready". List changes appear through Realtime while the list is open, with no push.

### Build order

Each step is usable on its own:

1. Save and library. This includes sign-in, so data is tied to an account from the start.
2. Pantry and Shopping List.
3. Usernames, Friends, invite links and Shopping List sharing.
4. Cook Plans with Claims.
5. Cook Logs and Ranking.
6. Friend profiles.

## Testing Decisions

- **What a good test is:** it calls the app the way the screens do, through the data layer's actions, as one or more real signed-in users. It asserts what each user can then see. It doesn't reach into tables, internal helpers or Supabase directly, so the schema and internals can change without rewriting tests.
- **Main seam: the data layer, run against a local Supabase stack** (the Supabase CLI's local instance, with migrations applied). Tests sign in as several test users and check behaviour and access rules together. Representative cases:
  - Adding a Recipe to the Shopping List skips Ingredients in the Pantry and Staples, and merges shared Ingredients into one line with per-Recipe amounts.
  - Checking off on your own list puts the Ingredient in your Pantry. A Friend checking off on your shared list puts it in **your** Pantry. Checking off in a Cook Plan puts it in the **buyer's** Pantry. Checking off a hand-added non-Ingredient item changes no Pantry.
  - The Cook Plan list shows which members have each Ingredient. A Claim is visible to all members.
  - A stranger can't read your Recipes, Ranking or Cook Logs, but a Friend can read your Ranking and Cook Logs. After unfriending, the Friend can't.
  - Deleting a Recipe in a Cook Plan removes its unbought lines but keeps Claimed or checked ones.
  - A sequence of comparison answers places a Recipe in the expected position with the expected Score. Skipping lands it at the band's middle. Deleting recomputes the band.
  - The 31st save in a day is refused.
  - List changes made while offline replay correctly on reconnect, and the later of two conflicting checks wins.
- **One fake boundary: the source reader and the Claude call.** Tests swap in fake adapters that return canned captions: a TikTok caption with a full recipe, a YouTube description, an Instagram screenshot input, a "link in bio" caption, and a caption with a recipe-site link. No network calls in tests. The real adapters aren't unit-tested. They're checked by hand against real links.
- **Pure engines** (list engine, ranking engine) are exercised through the data layer like everything else. They don't get their own test seam unless a case is hard to reach through it.
- **Screens** have no automated tests in v1 and are checked by hand on TestFlight. An optional later addition is one Maestro end-to-end flow for "share from another app → Recipe appears in library", the flow most likely to break silently.
- **Prior art:** none. The repo is empty, and these will be the first tests.

## Out of Scope

- Android builds (planned soon after; Expo keeps it cheap)
- A web app
- Activity feed of Friends' Cook Logs (planned soon after v1)
- Public profiles, following, discovery of strangers' content
- "What can we make from what we both have" pantry matching
- Transcribing video audio or reading on-screen text from videos
- Fetching Instagram pages automatically (to be decided before going public, after a legal check; ADR-0004)
- Tracking Pantry quantities or expiry dates (ADR-0003)
- Households or shared Pantries
- Voting on Recipes in a Cook Plan
- Contacts syncing for finding Friends
- Separate Rankings per category
- Push notifications for list changes
- Meal-planning calendars, nutrition info, unit conversion, scaling servings
- Monetisation, moderation tools, growth features

## Further Notes

- **Audience:** you and friends on TestFlight first. Built to go public later, so accounts, access rules and platform-terms compliance are in place from day one.
- **Before going public:**
  - Get a short legal review of Instagram handling and YouTube's "derived data" clause.
  - Decide on best-effort Instagram caption fetching behind a server-side off switch.
  - Check App Store guidelines 5.2.2 and 5.2.3. Apple can ask for proof that the app may use third-party content.
- **YouTube API terms:** stored API data must be refreshed or deleted within 30 days, and YouTube must be shown as the source. Reviewed Recipe text is treated as the user's own content.
- **TikTok thumbnail URLs expire.** Re-fetch through oEmbed when one fails.
- **Score formula:** the exact within-band spacing in the ranking engine was chosen while writing this spec ("spread evenly"). It's easy to change if it feels wrong in use.
- **Not decided:** the app's name.
