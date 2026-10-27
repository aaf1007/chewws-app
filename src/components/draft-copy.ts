import type { DraftBuildFailure, DraftSummary, SourcePlatform, SourceVideo } from '@/data';

/** The platform's name as the app shows it. */
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

/** The reason line under "Couldn't build this Draft" (decisions 03). */
export function failureMessage(reason: DraftBuildFailure, video?: SourceVideo): string {
  const platform = video ? platformName(video.platform, video.originalUrl) : 'TikTok';
  switch (reason) {
    case 'sourceUnavailable':
      return `${platform} didn't return this video. It may be private or deleted.`;
    case 'sourceUnreachable':
      return `Couldn't reach ${platform}.`;
    case 'unreadable':
      return "Couldn't read a recipe from it.";
    case 'timedOut':
      return 'This took too long.';
    case 'notSetUp':
      return "Drafts can't be built yet: the Draft builder isn't set up.";
  }
}

/** One line saying where a Draft is, for the Drafts list. */
export function draftStatusLine(draft: Pick<DraftSummary, 'build' | 'recipeFound'>): string {
  if (draft.build.status === 'building') return 'Building…';
  if (draft.build.status === 'failed') return "Couldn't build this Draft";
  return draft.recipeFound ? 'Ready to review' : 'Recipe not in caption';
}

export const NOT_IN_CAPTION = {
  title: 'Recipe not in caption',
  message: 'The caption doesn’t list the ingredients ("link in bio"?). Fill them in from the video.',
};
