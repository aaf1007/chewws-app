import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { draftStatusLine, failureMessage, platformName } from '@/components/draft-copy';
import { useSourceThumbnail } from '@/components/use-source-thumbnail';
import { useWhileFocused } from '@/components/use-while-focused';
import type { DraftSummary } from '@/data';
import { data } from '@/data/app';
import { DraftBanner, EmptyState, ListRow, Screen, Text, spacing } from '@/ui';

const anyBuilding = (drafts: DraftSummary[]) => drafts.some((d) => d.build.status === 'building');

async function loadDrafts(): Promise<DraftSummary[]> {
  // Opening the list is when a Draft whose build got lost is kicked again (decisions 03).
  await data.resumeDraftBuilds().catch(() => {});
  return data.listDrafts();
}

const openDraft = (id: string) => router.push({ pathname: '/draft/[id]', params: { id } });

/** One Draft in the list; a thumbnail that stops loading is read from the platform again. */
function DraftRow({ draft, onRetry }: { draft: DraftSummary; onRetry: () => void }) {
  const video = draft.sourceVideo;
  const thumbnail = useSourceThumbnail(draft.id, video);
  const from = video
    ? [platformName(video.platform, video.originalUrl), video.creatorName].filter(Boolean).join(' · ')
    : undefined;
  const { build } = draft;
  return (
    <View style={{ paddingBottom: build.status === 'failed' ? spacing.md : 0 }}>
      <ListRow
        title={draft.title}
        // A page not read yet is titled with its site; don't say the site twice.
        meta={[draftStatusLine(draft), ...(from && from !== draft.title ? [from] : [])]}
        photo={thumbnail.uri ? { uri: thumbnail.uri } : undefined}
        onPhotoError={thumbnail.onError}
        onPress={() => openDraft(draft.id)}
      />
      {build.status === 'failed' ? (
        <DraftBanner
          kind="failed"
          title="Couldn't build this Draft"
          message={failureMessage(build.reason, video ?? undefined)}
          actions={[
            ...(build.canRetry ? [{ label: 'Try again', onPress: onRetry }] : []),
            { label: 'Fill in by hand', onPress: () => openDraft(draft.id) },
          ]}
        />
      ) : null}
    </View>
  );
}

/** Every Draft the user hasn't reviewed, newest first, in whatever build state. */
export default function Drafts() {
  const [state, reload] = useWhileFocused(loadDrafts, { keepPolling: anyBuilding });

  const retry = (draft: DraftSummary) =>
    data
      .retryDraft(draft.id)
      .then(reload)
      .catch((e: unknown) => Alert.alert("Couldn't try again", messageOf(e)));

  return (
    <Screen title="Drafts" scroll>
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {state.status === 'loaded' && state.value.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No Drafts"
          message="Share a TikTok, a YouTube Short or a recipe page to the app and it shows up here while it’s filled in, ready for you to review."
        />
      ) : null}
      {state.status === 'loaded' && state.value.length > 0 ? (
        <View>
          {state.value.map((item) => (
            <DraftRow key={item.id} draft={item} onRetry={() => void retry(item)} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
