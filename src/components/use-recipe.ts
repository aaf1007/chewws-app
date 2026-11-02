import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { hasCode, messageOf } from '@/auth/errors';
import { parseRecipeId, type Recipe } from '@/data';
import { data } from '@/data/app';

export type RecipeState =
  | { status: 'loading' }
  | { status: 'loaded'; recipe: Recipe }
  | { status: 'missing'; message: string };

/**
 * Loads a Recipe each time the screen comes into focus, so it's fresh after an edit, and again on
 * `reload()` (after a change made on the screen). Takes the raw route param: an id that isn't a
 * Recipe id reads as a missing Recipe rather than throwing.
 */
export function useRecipe(rawId: string): RecipeState & { reload: () => void } {
  const [state, setState] = useState<RecipeState>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.resolve()
        .then(() => data.getRecipe(parseRecipeId(rawId)))
        .then((recipe) => {
          if (!live) return;
          setState(
            recipe
              ? { status: 'loaded', recipe }
              : { status: 'missing', message: 'It may have been deleted.' },
          );
        })
        .catch((e: unknown) => {
          if (!live) return;
          setState({
            status: 'missing',
            message: hasCode(e, 'invalid_recipe_id') ? 'That link doesn’t lead to a Recipe.' : messageOf(e),
          });
        });
      return () => {
        live = false;
      };
      // `round` reloads on demand.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawId, round]),
  );
  return { ...state, reload: () => setRound((r) => r + 1) };
}
