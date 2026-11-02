import { router } from 'expo-router';
import { View } from 'react-native';

import { placeLabel } from '@/components/ranking-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import type { CookLog, RecipeId } from '@/data';
import { data } from '@/data/app';
import { Button, ScoreBadge, SectionHeader, Text, spacing } from '@/ui';

/**
 * A Recipe's place in the user's Ranking (decisions 17), under its Cook Logs: its Score and "#2 in
 * Liked" with "Re-rank", or "Rank it" once it's Cooked and not ranked yet. After a Cook Log newer
 * than its ranking, it offers a re-rank. Nothing while it isn't Cooked: only Cooked Recipes rank.
 */
export function RecipeRanking({ recipeId, logs }: { recipeId: RecipeId; logs: CookLog[] | null }) {
  const [state] = useWhileFocused(() => data.getRanking());
  if (!logs || logs.length === 0 || state.status !== 'loaded') return null;

  const { liked, fine, disliked } = state.value;
  const entry = [...liked, ...fine, ...disliked].find((r) => r.recipeId === recipeId);
  const rank = () => router.push({ pathname: '/recipe/[id]/rank', params: { id: recipeId } });

  if (!entry) {
    return (
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Ranking" />
        <Text tone="textMuted">You’ve cooked it. Rank it against the others you’ve cooked.</Text>
        <Button label="Rank it" icon="podium-outline" onPress={rank} testID="rank-it" />
      </View>
    );
  }

  const cookedSince = logs.some((log) => log.createdAt > entry.rankedAt);
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Ranking" action={{ label: 'Re-rank', onPress: rank }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} testID="recipe-ranking">
        <ScoreBadge score={entry.score} tone="mine" />
        <Text variant="headline">{placeLabel(entry.band, entry.position)}</Text>
      </View>
      {cookedSince ? (
        <Text tone="textMuted">Cooked it again? Re-rank it to see where it stands now.</Text>
      ) : null}
    </View>
  );
}
