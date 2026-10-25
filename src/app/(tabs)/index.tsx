import { useState } from 'react';

import { EmptyState, FilterTiles, Screen, SearchField, type FilterTileOption } from '@/ui';

type LibraryFilter = 'wantToCook' | 'saved' | 'cooked';

const FILTERS = [
  { value: 'wantToCook', label: 'Want to Cook', icon: 'flame-outline' },
  { value: 'saved', label: 'Saved', icon: 'bookmark-outline' },
  { value: 'cooked', label: 'Cooked', icon: 'checkmark-circle-outline' },
] as const satisfies readonly FilterTileOption<LibraryFilter>[];

export default function Library() {
  // Filters and search are visual only until ticket 06.
  const [filter, setFilter] = useState<LibraryFilter>('saved');
  const [query, setQuery] = useState('');

  return (
    <Screen title="Library">
      <FilterTiles options={FILTERS} value={filter} onChange={setFilter} />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your Recipes" />
      <EmptyState
        icon="book-outline"
        title="No recipes yet"
        message="Recipes you add from videos or write by hand will show up here."
      />
    </Screen>
  );
}
