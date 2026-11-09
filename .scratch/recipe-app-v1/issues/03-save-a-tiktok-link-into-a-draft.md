# 03: Save a TikTok link into a Draft

**What to build:** A user watching a TikTok taps Share, picks the app, and saves with one tap. Saving returns at once. In the background, the source reader fetches the caption, creator and thumbnail through TikTok oEmbed, and the Draft builder (an Edge Function calling Claude Haiku 5.5) fills in title, ingredient lines with linked Ingredients, and steps. The user reviews the Draft, fixes anything, and it becomes a Recipe showing the Source Video's thumbnail and creator. Tapping the Source Video opens it in TikTok. If the caption has no recipe, the Draft is flagged "recipe not in caption" for the user to fill in. Only official platform routes are used (ADR-0004).

**Blocked by:** 02 (Write a Recipe by hand).

**Status:** done

- [x] The app appears in the iOS share sheet for links (via expo-share-intent) and saves a TikTok link with one tap
- [x] Saving returns immediately; the Recipe exists as an unbuilt Draft until the Draft builder finishes
- [x] The source reader sits behind one interface, with a TikTok oEmbed adapter returning caption, creator, creator URL and thumbnail URL
- [x] The Draft builder produces title, ingredient lines (text, amount, linked Ingredient), steps and a recipeFound flag
- [x] A Draft with recipeFound false shows "recipe not in caption" with empty ingredients and steps
- [x] The user can review and edit a Draft and mark it reviewed, after which it is a normal Recipe
- [x] Drafts can stay unreviewed indefinitely
- [x] The Recipe shows the Source Video's thumbnail and creator, and tapping it opens the original video
- [x] Data-layer tests use a fake source reader and a fake Claude call (no network): a full-recipe TikTok caption produces a Draft with the expected ingredients; a "link in bio" caption produces a recipe-not-in-caption Draft
