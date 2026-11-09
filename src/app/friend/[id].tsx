import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { hasCode, messageOf } from '@/auth/errors';
import { friendsSince } from '@/components/friend-copy';
import { BANDS } from '@/components/ranking-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import { parseUserId, type FriendCookLogPage, type FriendProfileResult, type RecipeId } from '@/data';
import { data } from '@/data/app';
import { Button, CookLogCard, EmptyState, ListRow, Screen, SectionHeader, Text, formatDay, spacing } from '@/ui';

/** The profile, or notFound for anyone who isn't a Friend, an id that isn't a user's included. */
async function loadProfile(rawId: string): Promise<FriendProfileResult> {
  try {
    return await data.getFriendProfile(parseUserId(rawId));
  } catch (e) {
    if (hasCode(e, 'invalid_user_id')) return { status: 'notFound' };
    throw e;
  }
}

const openRecipe = (id: RecipeId) => router.push({ pathname: '/recipe/[id]', params: { id } });

/** The one screen for a profile the user can't see: a stranger's, or a Friend's after an unfriend. */
function NotFound() {
  return (
    <Screen>
      <EmptyState
        icon="person-outline"
        title="Profile not found"
        message="You can see the profiles of your Friends only."
      />
    </Screen>
  );
}

/**
 * A Friend's profile (decisions 19): their username, "Friends since", their Ranking (each band best
 * first, the Scores in the Friends' accent) and their Cook Logs, newest first, 20 at a time. A
 * Recipe from either opens it, to read and save your own copy. Read again whenever the screen comes
 * into focus, so after an unfriend it shows "Profile not found", as for anyone else.
 */
export default function FriendProfile() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const [state] = useWhileFocused(() => loadProfile(rawId));
  // Pages after the first, as "Show more" read them; dropped whenever the first page is read again.
  const [more, setMore] = useState<{ after: FriendCookLogPage; pages: FriendCookLogPage[] } | null>(null);
  const [goneSince, setGoneSince] = useState<FriendCookLogPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') return <Screen />;
  if (state.status === 'error') {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Couldn’t load this profile" message={state.message} />
      </Screen>
    );
  }
  const profile = state.value;
  if (profile.status === 'notFound') return <NotFound />;
  // "Show more" found them unfriended since this page was read.
  if (goneSince === profile.cookLogs) return <NotFound />;

  const first = profile.cookLogs;
  const pages = more?.after === first ? [first, ...more.pages] : [first];
  const last = pages[pages.length - 1];
  const logs = pages.flatMap((page) => page.logs);

  const showMore = () => {
    if (last.next === null) return;
    setError(null);
    setLoadingMore(true);
    data
      .getFriendCookLogs(profile.id, last.next)
      .then((page) => {
        if (page.status === 'notFound') setGoneSince(first);
        else setMore({ after: first, pages: [...pages.slice(1), page] });
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setLoadingMore(false));
  };

  const nothingRanked = BANDS.every((band) => profile.ranking[band.value].length === 0);
  return (
    <Screen title={`@${profile.username}`} scroll>
      <Text tone="textMuted">{friendsSince(profile.friendsSince)}</Text>

      <View style={{ gap: spacing.xs }} testID="friend-ranking">
        <SectionHeader title="Ranking" />
        {nothingRanked ? (
          <Text tone="textMuted">{`@${profile.username} hasn’t ranked anything yet.`}</Text>
        ) : (
          BANDS.map((band) =>
            profile.ranking[band.value].length === 0 ? null : (
              <View key={band.value}>
                <Text variant="caption" tone="textMuted">{`${band.label} · ${band.range}`}</Text>
                {profile.ranking[band.value].map((entry) => (
                  <ListRow
                    key={entry.recipeId}
                    title={entry.title ?? 'A Recipe'}
                    titleSuffix={`#${entry.position}`}
                    score={entry.score}
                    scoreTone="friend"
                    onPress={() => openRecipe(entry.recipeId)}
                  />
                ))}
              </View>
            ),
          )
        )}
      </View>

      <View style={{ gap: spacing.xs }} testID="friend-cook-logs">
        <SectionHeader title="Cook Logs" />
        {logs.length === 0 ? (
          <Text tone="textMuted">{`@${profile.username} hasn’t logged anything they cooked yet.`}</Text>
        ) : (
          logs.map((log, i) => (
            <CookLogCard
              key={log.id}
              recipe={log.recipeTitle ?? 'A Recipe'}
              day={formatDay(log.cookedOn)}
              companions={log.companions.map((c) => c.username ?? 'someone')}
              notes={log.notes}
              photos={log.photos.map((p) => ({ key: p.id, uri: p.url }))}
              onPress={() => openRecipe(log.recipeId)}
              testID={`friend-cook-log-${i + 1}`}
            />
          ))
        )}
        {error ? <Text tone="danger">{error}</Text> : null}
        {last.next !== null ? (
          <Button
            label="Show more Cook Logs"
            variant="outlined"
            disabled={loadingMore}
            onPress={showMore}
            testID="friend-cook-logs-more"
          />
        ) : null}
      </View>
    </Screen>
  );
}
