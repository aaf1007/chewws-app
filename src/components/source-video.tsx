import { Linking } from 'react-native';

import type { RecipeId, SourceVideo } from '@/data';
import { SourceVideoCard } from '@/ui';

import { platformName } from './draft-copy';
import { useSourceThumbnail } from './use-source-thumbnail';

/**
 * A Recipe's Source Video: thumbnail and creator ("YouTube · {channel}"), or a web page's picture
 * and site. Tapping it opens the video in its app, or the page in the browser. A thumbnail that
 * stops loading is read from the platform again.
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
  return (
    <SourceVideoCard
      platform={platform}
      kind={page ? 'page' : 'video'}
      title={video.creatorName ?? (page ? recipeTitle : `${platform} video`)}
      detail={page ? 'Open the page' : `Watch on ${platform}`}
      thumbnailUrl={thumbnail.uri}
      onThumbnailError={thumbnail.onError}
      onPress={() => void Linking.openURL(video.originalUrl)}
      testID="source-video"
    />
  );
}
