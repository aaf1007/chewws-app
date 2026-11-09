import { useRef, useState } from 'react';

import type { RecipeId, SourceVideo } from '@/data';
import { data } from '@/data/app';

/**
 * A Source Video's thumbnail as the screen should show it. When the stored URL fails to load
 * (TikTok's expire), it asks the server once to read it from the platform again and shows the new
 * one; if that one fails too, or there's none, it shows no picture rather than a broken one.
 */
export function useSourceThumbnail(recipeId: RecipeId, video: SourceVideo | null | undefined) {
  const stored = video?.thumbnailUrl ?? null;
  // What replaced the stored URL, while that URL is still the stored one.
  const [replaced, setReplaced] = useState<{ stored: string | null; uri: string | null } | null>(null);
  const asked = useRef(false);
  const uri = replaced && replaced.stored === stored ? replaced.uri : stored;

  const onError = () => {
    const failed = uri;
    if (asked.current) {
      setReplaced({ stored, uri: null });
      return;
    }
    asked.current = true;
    data
      .refreshSourceVideo(recipeId)
      .then((fresh) => {
        const next = fresh?.thumbnailUrl ?? null;
        setReplaced({ stored, uri: next !== failed ? next : null });
      })
      .catch(() => setReplaced({ stored, uri: null }));
  };

  return { uri, onError };
}
