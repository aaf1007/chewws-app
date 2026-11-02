import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { CookLog, RecipeId } from '@/data';
import { data } from '@/data/app';
import { CookLogCard, SectionHeader, Text, formatDay, spacing } from '@/ui';

type LogsState = { status: 'loading' } | { status: 'loaded'; logs: CookLog[] } | { status: 'failed'; message: string };

/**
 * A Recipe's Cook Logs, newest day first, read again whenever the screen comes back into focus
 * (after adding or editing one), with "Add Cook Log". Each opens to be edited or deleted.
 * `onLoaded` hears the logs each time they're read (the Recipe's Ranking section needs them).
 */
export function RecipeCookLogs({ recipeId, onLoaded }: { recipeId: RecipeId; onLoaded?: (logs: CookLog[]) => void }) {
  const [state, setState] = useState<LogsState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      data
        .listCookLogs(recipeId)
        .then((logs) => {
          if (!live) return;
          setState({ status: 'loaded', logs });
          onLoaded?.(logs);
        })
        .catch((e: unknown) => live && setState({ status: 'failed', message: messageOf(e) }));
      return () => {
        live = false;
      };
      // onLoaded is the screen's, fixed per screen.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recipeId]),
  );

  const add = () => router.push({ pathname: '/recipe/[id]/cook-log/new', params: { id: recipeId } });

  return (
    <View style={{ gap: spacing.xs }}>
      <SectionHeader title="Cook Logs" action={{ label: 'Add Cook Log', onPress: add }} />
      {state.status === 'failed' ? <Text tone="danger">{state.message}</Text> : null}
      {state.status === 'loaded' && state.logs.length === 0 ? (
        <Text tone="textMuted">Not cooked yet. Add a Cook Log each time you cook it.</Text>
      ) : null}
      {state.status === 'loaded'
        ? state.logs.map((log, i) => (
            <CookLogCard
              key={log.id}
              day={formatDay(log.cookedOn)}
              companions={log.companions.map((c) => c.username ?? 'someone')}
              notes={log.notes}
              photos={log.photos.map((p) => ({ key: p.id, uri: p.url }))}
              onPress={() =>
                router.push({ pathname: '/recipe/[id]/cook-log/[logId]', params: { id: recipeId, logId: log.id } })
              }
              testID={`cook-log-${i + 1}`}
            />
          ))
        : null}
    </View>
  );
}
