import { router } from 'expo-router';
import { View } from 'react-native';

import { BANDS } from '@/components/ranking-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import { data } from '@/data/app';
import { EmptyState, ListRow, Screen, SectionHeader, Text, spacing } from '@/ui';

/**
 * The user's whole Ranking (decisions 17): Liked, Fine and Didn't like in that order, each best
 * first, with every Recipe's Score. Read again whenever the screen comes into focus (after a
 * re-rank). Each row opens its Recipe.
 */
export default function RankingScreen() {
  const [state] = useWhileFocused(() => data.getRanking());

  if (state.status === 'error') {
    return (
      <Screen title="Your Ranking" scroll>
        <EmptyState icon="alert-circle-outline" title="Couldn’t load your Ranking" message={state.message} />
      </Screen>
    );
  }
  if (state.status === 'loading') return <Screen title="Your Ranking" scroll />;

  const ranking = state.value;
  if (BANDS.every((band) => ranking[band.value].length === 0)) {
    return (
      <Screen title="Your Ranking" scroll>
        <EmptyState
          icon="podium-outline"
          title="Nothing ranked yet"
          message="Add a Cook Log to a Recipe you’ve cooked, then rank it from the Recipe."
        />
      </Screen>
    );
  }

  return (
    <Screen title="Your Ranking" scroll>
      {BANDS.map((band) => (
        <View key={band.value} style={{ gap: spacing.xs }}>
          <SectionHeader title={`${band.label} · ${band.range}`} />
          {ranking[band.value].length === 0 ? (
            <Text tone="textMuted">Nothing here yet.</Text>
          ) : (
            ranking[band.value].map((entry) => (
              <ListRow
                key={entry.recipeId}
                title={entry.title ?? 'A Recipe'}
                titleSuffix={`#${entry.position}`}
                score={entry.score}
                onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: entry.recipeId } })}
              />
            ))
          )}
        </View>
      ))}
    </Screen>
  );
}
