import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { draftStatusLine, failureMessage, platformName } from '@/components/draft-copy';
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
          message="Share a TikTok to the app and it shows up here while it’s filled in, ready for you to review."
        />
      ) : null}
      {state.status === 'loaded' && state.value.length > 0 ? (
        <View>
          {state.value.map((item) => {
            const video = item.sourceVideo;
            const from = video
              ? [platformName(video.platform, video.originalUrl), video.creatorName].filter(Boolean).join(' · ')
              : undefined;
            const { build } = item;
            return (
              <View key={item.id} style={{ paddingBottom: build.status === 'failed' ? spacing.md : 0 }}>
                <ListRow
                  title={item.title}
                  meta={[draftStatusLine(item), ...(from ? [from] : [])]}
                  photo={video?.thumbnailUrl ? { uri: video.thumbnailUrl } : undefined}
                  onPress={() => openDraft(item.id)}
                />
                {build.status === 'failed' ? (
                  <DraftBanner
                    kind="failed"
                    title="Couldn't build this Draft"
                    message={failureMessage(build.reason, video ?? undefined)}
                    actions={[
                      ...(build.canRetry ? [{ label: 'Try again', onPress: () => void retry(item) }] : []),
                      { label: 'Fill in by hand', onPress: () => openDraft(item.id) },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
