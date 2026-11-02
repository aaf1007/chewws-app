import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

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

/** How long typing has to pause before the Library searches. */
const SEARCH_PAUSE_MS = 250;

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

/** The Recipes a filter shows, searched when the user has typed something. */
function recipesFor(filter: LibraryFilter, query: string): Promise<RecipeSummary[]> {
  const wantToCook = filter === 'wantToCook';
  if (query.trim() !== '') return data.searchRecipes(query, { wantToCook });
  return wantToCook ? data.listWantToCook() : data.listMyRecipes();
}

/** `value`, once it has stopped changing for `ms`. */
function usePaused<T>(value: T, ms: number): T {
  const [paused, setPaused] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setPaused(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return paused;
}

/** What the list shows when it has no Recipes in it. */
function emptyStateOf(filter: LibraryFilter, query: string) {
  if (query.trim() !== '') {
    // At the top, not centred: the keyboard is up while searching.
    const where = filter === 'wantToCook' ? 'your Want to Cook list' : 'your Recipes';
    return (
      <View>
        <SectionHeader title="Results" />
        <Text tone="textMuted">
          {`No matches. Nothing in ${where} has “${query.trim()}” in its title, Ingredients or Tags.`}
        </Text>
      </View>
    );
  }
  if (filter === 'wantToCook') {
    return (
      <EmptyState
        icon="flame-outline"
        title="Nothing to cook yet"
        message="Mark a Recipe Want to Cook and it shows up here."
      />
    );
  }
  return (
    <EmptyState
      icon="book-outline"
      title="No recipes yet"
      message="Recipes you add from videos or write by hand will show up here."
      action={{ label: 'Write a Recipe', onPress: writeRecipe }}
    />
  );
}

export default function Library() {
  // "Cooked" is visual only until Cook Logs (ticket 16): it shows every Recipe, as "Saved" does.
  const [filter, setFilter] = useState<LibraryFilter>('saved');
  const [query, setQuery] = useState('');
  const searched = usePaused(query, SEARCH_PAUSE_MS);
  const [state, setState] = useState<LibraryState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([recipesFor(filter, searched), data.listDrafts()])
        .then(([recipes, drafts]) => live && setState({ status: 'loaded', recipes, drafts }))
        .catch((e: unknown) => live && setState({ status: 'error', message: messageOf(e) }));
      return () => {
        live = false;
      };
    }, [filter, searched]),
  );

  const listTitle = searched.trim() !== '' ? 'Results' : filter === 'wantToCook' ? 'Want to Cook' : 'Recipes';

  return (
    <Screen title="Library">
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your Recipes" />
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
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {state.status === 'loaded' && state.recipes.length === 0 ? emptyStateOf(filter, searched) : null}
      {state.status === 'loaded' && state.recipes.length > 0 ? (
        <FlatList
          data={state.recipes}
          keyExtractor={(recipe) => recipe.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <SectionHeader
              title={listTitle}
              action={listTitle === 'Recipes' ? { label: 'Write a Recipe', onPress: writeRecipe } : undefined}
            />
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
