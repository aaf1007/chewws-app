import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { cookedDetail } from '@/components/cook-log-copy';
import type { DraftSummary, RecipeSummary, Tag } from '@/data';
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
  | { status: 'loaded'; recipes: RecipeSummary[]; drafts: DraftSummary[]; tags: Tag[]; allCooked: boolean }
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

/** "Italian, quick, Weeknight" for the Tags row, or that there are none yet. */
const tagsDetail = (tags: Tag[]) => (tags.length === 0 ? 'None yet' : tags.map((t) => t.name).join(', '));

/**
 * The Recipes a filter shows, searched when the user has typed something: Want to Cook; Saved, the
 * ones not cooked yet; or Cooked, the ones with a Cook Log (decisions 16).
 */
function recipesFor(filter: LibraryFilter, query: string): Promise<RecipeSummary[]> {
  if (filter === 'wantToCook') {
    return query.trim() !== '' ? data.searchRecipes(query, { wantToCook: true }) : data.listWantToCook();
  }
  return data.searchRecipes(query, { cooked: filter === 'cooked' });
}

/** Whether the user has Cooked Recipes, so an empty Saved tile can say everything's been cooked. */
const hasCooked = async () => (await data.searchRecipes('', { cooked: true })).length > 0;

/** `value`, once it has stopped changing for `ms`. */
function usePaused<T>(value: T, ms: number): T {
  const [paused, setPaused] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setPaused(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return paused;
}

/** What the list shows when it has no Recipes in it. `allCooked`: Saved is empty as all are Cooked. */
function emptyStateOf(filter: LibraryFilter, query: string, allCooked: boolean) {
  if (query.trim() !== '') {
    // At the top, not centred: the keyboard is up while searching.
    const where =
      filter === 'wantToCook' ? 'your Want to Cook list' : filter === 'cooked' ? 'your Cooked Recipes' : 'your Saved Recipes';
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
  if (filter === 'cooked') {
    return (
      <EmptyState
        icon="checkmark-circle-outline"
        title="Nothing cooked yet"
        message="Add a Cook Log to a Recipe once you’ve cooked it, and it shows up here."
      />
    );
  }
  if (allCooked) {
    return (
      <EmptyState
        icon="checkmark-done-outline"
        title="You’ve cooked them all"
        message="Every Recipe you’ve saved has a Cook Log, so they’re all under Cooked."
        action={{ label: 'Write a Recipe', onPress: writeRecipe }}
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
  const [filter, setFilter] = useState<LibraryFilter>('saved');
  const [query, setQuery] = useState('');
  const searched = usePaused(query, SEARCH_PAUSE_MS);
  const [state, setState] = useState<LibraryState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      const allCooked = async (recipes: RecipeSummary[]) =>
        filter === 'saved' && searched.trim() === '' && recipes.length === 0 && (await hasCooked());
      Promise.all([recipesFor(filter, searched), data.listDrafts(), data.listTags()])
        .then(async ([recipes, drafts, tags]) => ({ recipes, drafts, tags, allCooked: await allCooked(recipes) }))
        .then((loaded) => live && setState({ status: 'loaded', ...loaded }))
        .catch((e: unknown) => live && setState({ status: 'error', message: messageOf(e) }));
      return () => {
        live = false;
      };
    }, [filter, searched]),
  );

  const listTitle =
    searched.trim() !== '' ? 'Results' : filter === 'wantToCook' ? 'Want to Cook' : filter === 'cooked' ? 'Cooked' : 'Recipes';

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
      {/* Always there, so a Tag on no Recipe can still be found and deleted (issue 22). */}
      <NavRow
        icon="pricetags-outline"
        label="Tags"
        detail={state.status === 'loaded' ? tagsDetail(state.tags) : undefined}
        onPress={() => router.push('/tags')}
        testID="tags-row"
      />
      <FilterTiles options={FILTERS} value={filter} onChange={setFilter} />
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {state.status === 'loaded' && state.recipes.length === 0 ? emptyStateOf(filter, searched, state.allCooked) : null}
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
                ...(item.cooked ? [cookedDetail(item.cooked)] : []),
              ]}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
