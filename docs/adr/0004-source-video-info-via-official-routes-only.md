# Source Video info comes only from official platform routes

We read caption, thumbnail and creator only through each platform's official route: TikTok oEmbed, and the YouTube Data API (re-fetched rather than stored past 30 days). Instagram offers no allowed route, so an Instagram Draft is built from a screenshot or pasted caption the user supplies, plus any recipe-site link in it. We never keep our own copies of platform thumbnails. Competitors like Pestle and ReciMe scrape the public Reel page or download the video, which breaks Instagram's terms and risks App Store rules 5.2.2/5.2.3. We chose the slower but safe path for now, and will decide on best-effort caption fetching (behind an off switch) before going public.

## Considered Options

- Fetching the public Reel page logged out to read the caption: deferred until before public launch, pending a legal check.
- Downloading and transcribing the video: rejected (App Store 5.2.3).

## Note (2026-10-27): when a source can't be read

TikTok's oEmbed stopped returning the caption, creator and thumbnail around 2026-10-19, and big recipe sites answer 402 to apps. We stay on official routes: oEmbed is still tried first and used whenever it answers in full. We don't read TikTok's embed page or its internal page data, and we don't send a browser User-Agent to get past a site's refusal. A Draft whose source gave no caption, or refused us, says the app couldn't read it (not "recipe not in caption"), keeps the link, and offers the Instagram paths: paste the caption or add a screenshot, each built like a "Try again". See `.scratch/recipe-app-v1/decisions.md`, "User decision: when a source can't be read".
