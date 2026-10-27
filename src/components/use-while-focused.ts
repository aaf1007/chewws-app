import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { messageOf } from '@/auth/errors';

export type Loaded<T> = { status: 'loading' } | { status: 'loaded'; value: T } | { status: 'error'; message: string };

/**
 * Loads `load()` each time the screen comes into focus, and again every `pollMs` while
 * `keepPolling` says so (a Draft still building), until the screen loses focus.
 */
export function useWhileFocused<T>(
  load: () => Promise<T>,
  { pollMs = 2_000, keepPolling = () => false }: { pollMs?: number; keepPolling?: (value: T) => boolean } = {},
): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = () =>
        load()
          .then((value) => {
            if (!live) return;
            setState({ status: 'loaded', value });
            if (keepPolling(value)) timer = setTimeout(tick, pollMs);
          })
          .catch((e: unknown) => live && setState({ status: 'error', message: messageOf(e) }));
      void tick();
      return () => {
        live = false;
        clearTimeout(timer);
      };
      // `round` reloads on demand; load and keepPolling are the caller's, fixed per screen.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round]),
  );
  return [state, () => setRound((r) => r + 1)];
}
