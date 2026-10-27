import type { DraftBuildFailure, DraftSummary, SourcePlatform, SourceVideo } from '@/data';

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
      return page ? `Couldn't find ${platform}.` : `${platform} didn't return this video. It may be private or deleted.`;
    case 'sourceUnreachable':
      return `Couldn't reach ${platform}.`;
    case 'unreadable':
      return page ? "The app can't open this link." : "Couldn't read a recipe from it.";
    case 'timedOut':
      return 'This took too long.';
    case 'notSetUp':
      return "Drafts can't be built yet: the Draft builder isn't set up.";
  }
}

/** The banner on a Draft the builder found no recipe in, worded for where it looked. */
export function notFoundCopy(platform: SourcePlatform | undefined): { title: string; message: string } {
  switch (platform) {
    case 'youtube':
      return {
        title: 'Recipe not in description',
        message: 'The description doesn’t list the ingredients. Fill them in from the video.',
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
  if (draft.build.status === 'failed') return "Couldn't build this Draft";
  return draft.recipeFound ? 'Ready to review' : notFoundCopy(draft.sourceVideo?.platform).title;
}

export const NOT_IN_CAPTION = {
  title: 'Recipe not in caption',
  message: 'The caption doesn’t list the ingredients ("link in bio"?). Fill them in from the video.',
};
