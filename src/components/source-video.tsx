import { useState } from 'react';
import { Linking } from 'react-native';

import type { RecipeId, SourceVideo } from '@/data';
import { SourceVideoCard } from '@/ui';

import { platformName } from './draft-copy';
import { useSourceThumbnail } from './use-source-thumbnail';

/**
 * A Recipe's Source Video: thumbnail and creator ("YouTube · {channel}"), or a web page's picture
 * and site, or for an Instagram Reel a plain card (the word "Instagram", no logo) or the user's
 * screenshot. Tapping it opens the video in its app, or the page in the browser. A thumbnail that
 * stops loading is read from the platform again; Instagram is never asked.
 */
export function SourceVideoLink({
  recipeId,
  video,
  recipeTitle,
}: {
  recipeId: RecipeId;
  video: SourceVideo;
  /** Names a page whose author isn't known. */
  recipeTitle: string;
}) {
  const platform = platformName(video.platform, video.originalUrl);
  const thumbnail = useSourceThumbnail(recipeId, video);
  const page = video.platform === 'web';
  const [screenshotFailed, setScreenshotFailed] = useState(false);
  // The user's own screenshot is the picture when they added one (an Instagram Reel, say); a link
  // to it that has run out shows the plain card.
  const screenshot = video.screenshotUrl && !screenshotFailed ? video.screenshotUrl : null;
  const unnamed = video.platform === 'instagram' ? 'Instagram Reel' : `${platform} video`;
  return (
    <SourceVideoCard
      platform={platform}
      kind={page ? 'page' : 'video'}
      title={video.creatorName ?? (page ? recipeTitle : unnamed)}
      detail={page ? 'Open the page' : `Watch on ${platform}`}
      thumbnailUrl={screenshot ?? thumbnail.uri}
      onThumbnailError={screenshot ? () => setScreenshotFailed(true) : thumbnail.onError}
      onPress={() => void Linking.openURL(video.originalUrl)}
      testID="source-video"
    />
  );
}
