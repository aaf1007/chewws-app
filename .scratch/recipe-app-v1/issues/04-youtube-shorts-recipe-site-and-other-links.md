# 04: YouTube Shorts, recipe-site and other links

**What to build:** Saving works for YouTube Shorts, recipe sites and any other link. YouTube Shorts use the YouTube Data API (videos.list, snippet) for description, title, thumbnails and channel name. Stored YouTube metadata is re-fetched once it is older than 30 days, and YouTube is shown as the source. When a caption or description contains a link to a recipe site, the source reader follows it and reads the page's schema.org Recipe markup. Any other link saves with a plain preview (page title and image). Platform thumbnails are never copied into storage. A thumbnail that stops loading is re-fetched from the platform (ADR-0004).

**Blocked by:** 03 (Save a TikTok link into a Draft).

**Status:** done

- [x] A YouTube Shorts link produces a Draft from the video's description, with thumbnail and channel name
- [x] YouTube metadata older than 30 days is re-fetched when the Recipe is viewed
- [x] A recipe-site URL found in a caption or description is fetched and its schema.org Recipe used to build the Draft
- [x] Sharing a recipe-site link directly produces a Draft from its schema.org Recipe
- [x] Any other link saves with a plain preview and an empty Draft to fill in
- [x] When a stored TikTok or YouTube thumbnail URL fails to load, it is re-fetched rather than shown broken
- [x] Data-layer tests with fake adapters cover: YouTube description → Draft; caption with recipe-site link → Draft from the site's recipe; unknown link → plain preview
