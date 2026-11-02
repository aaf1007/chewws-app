import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { messageOf } from '@/auth/errors';
import { editCookLogProblem } from '@/components/cook-log-copy';
import { CookLogForm } from '@/components/cook-log-form';
import { parseRecipeId, type CookLog } from '@/data';
import { data } from '@/data/app';
import { Button, EmptyState, Screen, Text } from '@/ui';

type LogState =
  | { status: 'loading' }
  | { status: 'loaded'; log: CookLog; onlyLog: boolean }
  | { status: 'missing'; message: string };

export default function EditCookLog() {
  const { id, logId } = useLocalSearchParams<{ id: string; logId: string }>();
  const [state, setState] = useState<LogState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => data.listCookLogs(parseRecipeId(id)))
      .then((logs) => {
        if (!live) return;
        const log = logs.find((l) => l.id === logId);
        setState(log ? { status: 'loaded', log, onlyLog: logs.length === 1 } : { status: 'missing', message: 'It may have been deleted.' });
      })
      .catch((e: unknown) => live && setState({ status: 'missing', message: messageOf(e) }));
    return () => {
      live = false;
    };
  }, [id, logId]);

  if (state.status !== 'loaded') {
    return (
      <Screen>
        {state.status === 'loading' ? null : (
          <EmptyState icon="alert-circle-outline" title="Cook Log not found" message={state.message} />
        )}
      </Screen>
    );
  }
  const { log, onlyLog } = state;

  // Deleting the last log makes the Recipe Saved again (decisions 16), so the warning says so.
  const confirmDelete = () => {
    setError(null);
    Alert.alert(
      'Delete this Cook Log?',
      onlyLog ? 'It’s this Recipe’s only one, so the Recipe goes back to Saved.' : 'Its notes and photos go with it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            data
              .deleteCookLog(log.id)
              .then(() => router.back())
              .catch((e: unknown) => setError(messageOf(e))),
        },
      ],
    );
  };

  return (
    <Screen title="Edit Cook Log" scroll>
      <CookLogForm
        initial={log}
        submitLabel="Save changes"
        onSubmit={async (input, people) => {
          const problem = editCookLogProblem(await data.editCookLog(log, input), people);
          if (problem) throw new Error(problem);
          router.back();
        }}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button label="Delete Cook Log" variant="danger" icon="trash-outline" onPress={confirmDelete} />
    </Screen>
  );
}
