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
 * Loads a Recipe each time the screen comes into focus, so it's fresh after an edit. Takes the raw
 * route param: an id that isn't a Recipe id reads as a missing Recipe rather than throwing.
 */
export function useRecipe(rawId: string): RecipeState {
  const [state, setState] = useState<RecipeState>({ status: 'loading' });
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
    }, [rawId]),
  );
  return state;
}
