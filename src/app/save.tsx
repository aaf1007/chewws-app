import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { platformName } from '@/components/draft-copy';
import { detectSource, type RecipeId } from '@/data';
import { data } from '@/data/app';
import { Button, EmptyState, Screen, SourceVideoCard, Text, spacing } from '@/ui';

type SaveState =
  | { status: 'ready' }
  | { status: 'saving' }
  | { status: 'saved'; recipeId: RecipeId }
  | { status: 'failed'; message: string };

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * The confirm screen a share opens (and `recipeapp://save?url=…`): the link, and Save. Saving
 * returns at once; the Draft builds in the background and shows up in Drafts.
 */
export default function SaveLink() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const shared = { url: param(params.url), text: param(params.text) };
  const link = detectSource([shared.url, shared.text].filter(Boolean).join(' '));
  const [state, setState] = useState<SaveState>({ status: 'ready' });

  if (state.status === 'saved') {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-circle-outline"
          title="Saved as a Draft"
          message="It’s being filled in from the caption. Review it in Drafts when it’s ready."
          action={{ label: 'View Drafts', onPress: () => router.replace('/drafts') }}
        />
        <Button label="Done" variant="outlined" onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  const unsupported =
    link === null
      ? 'There’s no link in what was shared.'
      : link.platform !== 'tiktok'
        ? 'Only TikTok links can be saved for now.'
        : null;

  const save = () => {
    setState({ status: 'saving' });
    data
      .saveFromLink(shared)
      .then(({ recipeId }) => setState({ status: 'saved', recipeId }))
      .catch((e: unknown) => setState({ status: 'failed', message: messageOf(e) }));
  };

  return (
    <Screen title="Save Recipe" scroll>
      {link ? (
        <SourceVideoCard
          platform={link.platform === 'web' ? 'Link' : platformName(link.platform)}
          title={link.platform === 'web' ? platformName('web', link.url) : `${platformName(link.platform)} video`}
          detail={link.url}
        />
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {unsupported ? <Text tone="danger">{unsupported}</Text> : null}
        {state.status === 'failed' ? <Text tone="danger">{state.message}</Text> : null}
        <Button
          label="Save"
          icon="bookmark-outline"
          disabled={unsupported !== null || state.status === 'saving'}
          onPress={save}
          testID="save-link"
        />
        <Button label="Cancel" variant="plain" onPress={() => router.back()} />
        <Text variant="caption" tone="textMuted">
          The app reads the recipe from the video’s caption and saves it as a Draft for you to review.
        </Text>
      </View>
    </Screen>
  );
}
