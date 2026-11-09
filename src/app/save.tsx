import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import {
  CaptionInputs,
  NOTHING_ADDED,
  captionFromShared,
  hasAddedCaption,
  type AddedCaption,
} from '@/components/caption-inputs';
import { dailyLimitMessage, platformName, sourceText } from '@/components/draft-copy';
import { prepareScreenshot } from '@/components/screenshot';
import { DailyLimitError, checkSharedLink, type DetectedSource, type RecipeId } from '@/data';
import { data } from '@/data/app';
import { registerForDraftReady } from '@/notifications';
import { Button, EmptyState, Screen, SourceVideoCard, Text, spacing } from '@/ui';

type SaveState =
  | { status: 'ready' }
  | { status: 'saving' }
  | { status: 'saved'; recipeId: RecipeId; added: boolean }
  | { status: 'failed'; message: string }
  /** Refused: the user has saved as many links as a day allows (decisions 07). */
  | { status: 'dailyLimitReached'; message: string };

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** The card for the link on the save screen: the platform and what the link is. */
function linkCard(link: DetectedSource) {
  if (link.platform === 'web') return { platform: 'Link', kind: 'page' as const, title: platformName('web', link.url) };
  const name = platformName(link.platform);
  return { platform: name, kind: 'video' as const, title: link.platform === 'instagram' ? 'Instagram Reel' : `${name} video` };
}

/**
 * The confirm screen a share opens (and `recipeapp://save?url=…`): the link, and Save. Saving
 * returns at once; the Draft builds in the background and shows up in Drafts. An Instagram Reel
 * can't be read by the app, so here the user can paste its caption or add a screenshot (or both,
 * or neither), and a shared image or text arrives as those.
 */
export default function SaveLink() {
  const params = useLocalSearchParams<{ url?: string; text?: string; image?: string }>();
  const shared = { url: param(params.url), text: param(params.text) };
  const sharedImage = param(params.image);
  const checked = checkSharedLink([shared.url, shared.text].filter(Boolean).join(' '));
  const link = checked.status === 'noLink' ? null : checked.link;
  const instagram = link?.platform === 'instagram';
  const readFrom = link ? sourceText(link.platform) : 'caption';
  const [state, setState] = useState<SaveState>({ status: 'ready' });
  const [added, setAdded] = useState<AddedCaption>(() => ({ ...NOTHING_ADDED, caption: captionFromShared(shared.text) }));
  const [imageError, setImageError] = useState<string | null>(null);
  // One id for this save, however many times Save is tapped: a save whose answer was lost, tried
  // again, finds the Draft it made instead of making a second.
  const [draftId] = useState(() => data.newDraftId());

  // A screenshot shared with the link is scaled down like one picked here.
  useEffect(() => {
    if (!sharedImage) return;
    prepareScreenshot(sharedImage)
      .then((screenshot) => setAdded((now) => (now.screenshot ? now : { ...now, screenshot })))
      .catch((e: unknown) => setImageError(messageOf(e)));
  }, [sharedImage]);

  if (state.status === 'saved') {
    const message = !instagram
      ? `It’s being filled in from the ${readFrom}. Review it in Drafts when it’s ready.`
      : state.added
        ? 'It’s being filled in from what you added. Review it in Drafts when it’s ready.'
        : 'There was nothing to read it from, so fill it in from the Reel in Drafts.';
    return (
      <Screen>
        <EmptyState
          icon="checkmark-circle-outline"
          title="Saved as a Draft"
          message={message}
          action={{ label: 'View Drafts', onPress: () => router.replace('/drafts') }}
        />
        <Button label="Done" variant="outlined" onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  const unsupported =
    checked.status === 'noLink'
      ? 'There’s no link in what was shared.'
      : checked.status === 'unsupported'
        ? checked.message
        : null;

  const save = () => {
    setState({ status: 'saving' });
    const withCaption = instagram && hasAddedCaption(added);
    data
      .saveFromLink({
        ...shared,
        draftId,
        ...(instagram ? { caption: added.caption, screenshot: added.screenshot?.jpeg ?? null } : {}),
      })
      .then(({ recipeId }) => {
        setState({ status: 'saved', recipeId, added: withCaption });
        // After the first link saved is when the app asks to send "Draft ready" (decisions 07).
        void registerForDraftReady({ ask: true });
      })
      .catch((e: unknown) =>
        setState(
          e instanceof DailyLimitError
            ? { status: 'dailyLimitReached', message: dailyLimitMessage(e.limit, new Date(e.retryAt), new Date()) }
            : { status: 'failed', message: messageOf(e) },
        ),
      );
  };

  const card = link ? linkCard(link) : null;
  return (
    <Screen title="Save Recipe" scroll>
      {link && card ? <SourceVideoCard {...card} detail={link.url} /> : null}
      {instagram ? (
        <View style={{ gap: spacing.md }}>
          <Text tone="textMuted">
            Instagram doesn’t let apps read a Reel. Paste its caption or add a screenshot of it, and the app reads the
            recipe from that. Or save it as it is and fill it in yourself.
          </Text>
          <CaptionInputs value={added} onChange={setAdded} disabled={state.status === 'saving'} />
          {imageError ? <Text tone="danger">{imageError}</Text> : null}
        </View>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {unsupported ? <Text tone="danger">{unsupported}</Text> : null}
        {state.status === 'failed' || state.status === 'dailyLimitReached' ? (
          <Text tone="danger" testID={state.status === 'dailyLimitReached' ? 'daily-limit' : undefined}>
            {state.message}
          </Text>
        ) : null}
        <Button
          label={state.status === 'saving' ? 'Saving…' : 'Save'}
          icon="bookmark-outline"
          disabled={unsupported !== null || state.status === 'saving' || state.status === 'dailyLimitReached'}
          onPress={save}
          testID="save-link"
        />
        <Button label="Cancel" variant="plain" onPress={() => router.back()} />
        {instagram ? null : (
          <Text variant="caption" tone="textMuted">
            {link?.platform === 'web'
              ? 'The app reads the recipe from the page and saves it as a Draft for you to review.'
              : `The app reads the recipe from the video’s ${readFrom} and saves it as a Draft for you to review.`}
          </Text>
        )}
      </View>
    </Screen>
  );
}
