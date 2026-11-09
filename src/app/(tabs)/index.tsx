import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { DraftSummary, RecipeSummary } from '@/data';
import { data } from '@/data/app';
import {
  EmptyState,
  FilterTiles,
  ListRow,
  NavRow,
  Screen,
  SearchField,
  SectionHeader,
  Text,
  type FilterTileOption,
} from '@/ui';

type LibraryFilter = 'wantToCook' | 'saved' | 'cooked';

const FILTERS = [
  { value: 'wantToCook', label: 'Want to Cook', icon: 'flame-outline' },
  { value: 'saved', label: 'Saved', icon: 'bookmark-outline' },
  { value: 'cooked', label: 'Cooked', icon: 'checkmark-circle-outline' },
] as const satisfies readonly FilterTileOption<LibraryFilter>[];

type LibraryState =
  | { status: 'loading' }
  | { status: 'loaded'; recipes: RecipeSummary[]; drafts: DraftSummary[] }
  | { status: 'error'; message: string };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const writeRecipe = () => router.push('/recipe/new');

/** "2 ready to review · 1 building", for the Drafts row. */
function draftsDetail(drafts: DraftSummary[]): string {
  const building = drafts.filter((d) => d.build.status === 'building').length;
  const failed = drafts.filter((d) => d.build.status === 'failed').length;
  const ready = drafts.length - building - failed;
  return [
    ready > 0 ? `${ready} ready to review` : null,
    building > 0 ? `${building} building` : null,
    failed > 0 ? `${failed} couldn't be built` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function Library() {
  // Filters and search are visual only until ticket 06.
  const [filter, setFilter] = useState<LibraryFilter>('saved');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<LibraryState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([data.listMyRecipes(), data.listDrafts()])
        .then(([recipes, drafts]) => live && setState({ status: 'loaded', recipes, drafts }))
        .catch((e: unknown) => live && setState({ status: 'error', message: messageOf(e) }));
      return () => {
        live = false;
      };
    }, []),
  );

  return (
    <Screen title="Library">
      {state.status === 'loaded' && state.drafts.length > 0 ? (
        <NavRow
          icon="document-text-outline"
          label={`Drafts (${state.drafts.length})`}
          detail={draftsDetail(state.drafts)}
          onPress={() => router.push('/drafts')}
          testID="drafts-row"
        />
      ) : null}
      <FilterTiles options={FILTERS} value={filter} onChange={setFilter} />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your Recipes" />
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {state.status === 'loaded' && state.recipes.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title="No recipes yet"
          message="Recipes you add from videos or write by hand will show up here."
          action={{ label: 'Write a Recipe', onPress: writeRecipe }}
        />
      ) : null}
      {state.status === 'loaded' && state.recipes.length > 0 ? (
        <FlatList
          data={state.recipes}
          keyExtractor={(recipe) => recipe.id}
          ListHeaderComponent={
            <SectionHeader title="Recipes" action={{ label: 'Write a Recipe', onPress: writeRecipe }} />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.title}
              meta={[
                `${count(item.lineCount, 'ingredient', 'ingredients')} · ${count(item.stepCount, 'step', 'steps')}`,
              ]}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
