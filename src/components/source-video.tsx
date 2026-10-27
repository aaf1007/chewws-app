import { Linking } from 'react-native';

import type { SourceVideo } from '@/data';
import { SourceVideoCard } from '@/ui';

import { platformName } from './draft-copy';

/** A Recipe's Source Video: thumbnail and creator; tapping it opens the video in its app. */
export function SourceVideoLink({ video }: { video: SourceVideo }) {
  const platform = platformName(video.platform, video.originalUrl);
  return (
    <SourceVideoCard
      platform={platform}
      title={video.creatorName ?? `${platform} video`}
      detail={`Watch on ${platform}`}
      thumbnailUrl={video.thumbnailUrl}
      onPress={() => void Linking.openURL(video.originalUrl)}
      testID="source-video"
    />
  );
}
