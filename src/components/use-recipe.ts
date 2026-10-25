import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { messageOf } from '@/auth/errors';
import type { Recipe, RecipeId } from '@/data';
import { data } from '@/data/app';

export type RecipeState =
  | { status: 'loading' }
  | { status: 'loaded'; recipe: Recipe }
  | { status: 'missing'; message: string };

/** Loads a Recipe each time the screen comes into focus, so it's fresh after an edit. */
export function useRecipe(id: RecipeId): RecipeState {
  const [state, setState] = useState<RecipeState>({ status: 'loading' });
  useFocusEffect(
    useCallback(() => {
      let live = true;
      data
        .getRecipe(id)
        .then((recipe) => {
          if (!live) return;
          setState(
            recipe
              ? { status: 'loaded', recipe }
              : { status: 'missing', message: 'It may have been deleted.' },
          );
        })
        .catch((e: unknown) => live && setState({ status: 'missing', message: messageOf(e) }));
      return () => {
        live = false;
      };
    }, [id]),
  );
  return state;
}
