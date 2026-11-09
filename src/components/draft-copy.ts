import { couldNotReadSource, type DraftBuildFailure, type DraftSummary, type SourcePlatform, type SourceVideo } from '@/data';

/** The platform's name as the app shows it; a web page's is its site ("cooking.example.com"). */
export function platformName(platform: SourcePlatform, url?: string): string {
  switch (platform) {
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'instagram':
      return 'Instagram';
    case 'web':
      return url ? new URL(url).hostname.replace(/^www\./u, '') : 'Link';
  }
}

/** What the Draft builder reads a recipe from: a TikTok's caption, a YouTube video's description, a page. */
export function sourceText(platform: SourcePlatform): string {
  switch (platform) {
    case 'youtube':
      return 'description';
    case 'web':
      return 'page';
    default:
      return 'caption';
  }
}

/** The reason line under "Couldn't build this Draft" (decisions 03, 04). */
export function failureMessage(reason: DraftBuildFailure, video?: SourceVideo): string {
  const platform = video ? platformName(video.platform, video.originalUrl) : 'TikTok';
  const page = video?.platform === 'web';
  switch (reason) {
    case 'sourceUnavailable':
      return page
        ? `${platform} says this page isn't there. It may have moved or been deleted.`
        : `${platform} didn't return this video. It may be private or deleted.`;
    case 'sourceUnreachable':
      return `Couldn't reach ${platform}.`;
    case 'unreadable':
      return page ? "The app can't open this link." : "Couldn't read a recipe from it.";
    case 'timedOut':
      return 'This took too long.';
    case 'notSetUp':
      return "Drafts can't be built yet: the Draft builder isn't set up.";
    case 'noCaption':
      return `${platform} didn't share this video's caption.`;
    case 'sourceRefused':
      return `${platform} didn't let the app read this page.`;
  }
}

/** What the source is, in "Couldn't read this …": "TikTok", "YouTube video", "page". */
function sourceNoun(video?: SourceVideo): string {
  switch (video?.platform) {
    case 'web':
      return 'page';
    case 'youtube':
      return 'YouTube video';
    case 'instagram':
      return 'Reel';
    default:
      return 'TikTok';
  }
}

/**
 * The banner on a Draft whose source the app couldn't read (decisions, "when a source can't be
 * read"): not "recipe not in caption", but what to add instead. `canAdd`: builds are left.
 */
export function couldNotReadCopy(
  reason: DraftBuildFailure,
  video: SourceVideo | undefined,
  canAdd: boolean,
): { title: string; message: string } {
  const page = video?.platform === 'web';
  const add = canAdd
    ? page
      ? 'Paste the recipe or add a screenshot of it, and the app reads it from that.'
      : 'Paste the caption or add a screenshot of it, and the app reads the recipe from that.'
    : 'Fill it in by hand.';
  return { title: `Couldn't read this ${sourceNoun(video)}`, message: `${failureMessage(reason, video)} ${add}` };
}

/** The banner on a Draft the builder found no recipe in, worded for where it looked. */
export function notFoundCopy(platform: SourcePlatform | undefined): { title: string; message: string } {
  switch (platform) {
    case 'youtube':
      return {
        title: 'Recipe not in description',
        message: 'The description doesn’t list the ingredients. Fill them in from the video.',
      };
    case 'instagram':
      return {
        title: NOT_IN_CAPTION.title,
        message: 'The app can’t read Instagram, and there was no ingredient list to read. Fill them in from the Reel.',
      };
    case 'web':
      return {
        title: 'No recipe on this page',
        message: 'The app found no recipe it can read on this page. Fill in the ingredients and steps yourself.',
      };
    default:
      return NOT_IN_CAPTION;
  }
}

/** One line saying where a Draft is, for the Drafts list. */
export function draftStatusLine(draft: Pick<DraftSummary, 'build' | 'recipeFound' | 'sourceVideo'>): string {
  if (draft.build.status === 'building') return 'Building…';
  if (draft.build.status === 'failed') {
    return couldNotReadSource(draft.build.reason)
      ? `Couldn't read this ${sourceNoun(draft.sourceVideo ?? undefined)}`
      : "Couldn't build this Draft";
  }
  return draft.recipeFound ? 'Ready to review' : notFoundCopy(draft.sourceVideo?.platform).title;
}

export const NOT_IN_CAPTION = {
  title: 'Recipe not in caption',
  message: 'The caption doesn’t list the ingredients ("link in bio"?). Fill them in from the video.',
};

/**
 * What the save screen says when the daily limit refuses a link (decisions 07): when the user can
 * save again, as a time of day, "tomorrow" when that's not today.
 */
export function dailyLimitMessage(limit: number, retryAt: Date, now: Date): string {
  const time = retryAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const when = retryAt.toDateString() === now.toDateString() ? time : `${time} tomorrow`;
  return `You've saved ${limit} links in the last 24 hours, the daily limit. You can save again at ${when}.`;
}
