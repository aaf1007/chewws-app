import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ActionButtons,
  Button,
  EmptyState,
  FilterTiles,
  FloatingSegment,
  IngredientLineEditor,
  IngredientLineRow,
  ListRow,
  ScoreBadge,
  Screen,
  SearchField,
  SectionHeader,
  StepEditor,
  StepRow,
  Text,
  TextField,
  colors,
  radii,
  spacing,
  type ColorRole,
  type TypeVariant,
} from '@/ui';

// Dev-only (the route is guarded by __DEV__ in the root layout). Every primitive in src/ui with
// sample data, so a change to one can be eyeballed here.

const photo = (id: string) => ({
  uri: `https://images.unsplash.com/${id}?w=240&h=240&fit=crop`,
});

const ROLES: ColorRole[] = [
  'background',
  'surface',
  'surfaceMuted',
  'text',
  'textMuted',
  'border',
  'accent',
  'onAccent',
  'friendAccent',
  'danger',
];

const VARIANTS: TypeVariant[] = ['largeTitle', 'title', 'headline', 'body', 'label', 'caption', 'overline'];

const noop = () => {};

export default function UiGallery() {
  const [filter, setFilter] = useState<'wantToCook' | 'saved' | 'cooked'>('saved');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [title, setTitle] = useState('Garlic bread');
  const [line, setLine] = useState({
    originalText: '2 cloves garlic, minced',
    amountText: '2 cloves',
    ingredientName: 'garlic',
  });
  const [step, setStep] = useState('Mash the garlic into the butter.');

  return (
    <Screen scroll>
      <SectionHeader title="Type" />
      {VARIANTS.map((variant) => (
        <Text key={variant} variant={variant}>
          {variant}
        </Text>
      ))}
      <Text tone="textMuted">textMuted body</Text>

      <SectionHeader title="Colours" />
      <View style={styles.swatches}>
        {ROLES.map((role) => (
          <View key={role} style={styles.swatch}>
            <View style={[styles.chip, { backgroundColor: colors[role] }]} />
            <Text variant="caption" tone="textMuted">
              {role}
            </Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Buttons" />
      <Button label="Filled" onPress={noop} />
      <Button label="Outlined" variant="outlined" icon="add" onPress={noop} />
      <Button label="Plain" variant="plain" onPress={noop} />
      <Button label="Disabled" disabled onPress={noop} />
      <Button label="Danger" variant="danger" icon="trash-outline" onPress={noop} />

      <SectionHeader title="Filter tiles" />
      <FilterTiles
        options={[
          { value: 'wantToCook', label: 'Want to Cook', icon: 'flame-outline' },
          { value: 'saved', label: 'Saved', icon: 'bookmark-outline' },
          { value: 'cooked', label: 'Cooked', icon: 'checkmark-circle-outline' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <SectionHeader title="Search field" />
      <SearchField value={query} onChangeText={setQuery} />
      <SearchField value={query} onChangeText={setQuery} placeholder="With filters" onFilterPress={noop} />

      <SectionHeader title="Score badges" action={{ label: 'Action', onPress: noop }} />
      <View style={styles.badges}>
        <ScoreBadge score={7.8} tone="mine" />
        <ScoreBadge score={9.25} tone="friend" />
        <ScoreBadge score={10} tone="mine" size="sm" />
        <ScoreBadge score={4} tone="friend" size="sm" />
      </View>

      <SectionHeader title="List rows" />
      <View>
        <ListRow
          title="Crispy chilli tofu"
          titleSuffix="25 min"
          meta={['Chinese, Dinner', 'From TikTok']}
          photo={photo('photo-1546069901-ba9599a7e63c')}
          score={7.8}
          onPress={noop}
          onMore={noop}
        />
        <ListRow
          title="Margherita pizza with a very long name that will not fit"
          titleSuffix="1 h"
          meta={['Italian']}
          photo={photo('photo-1565299624946-b28f40a0ae38')}
          score={8.4}
          scoreTone="friend"
          onMore={noop}
        />
        <ListRow title="Lemon pasta" meta={['No photo, with Score']} score={10} onMore={noop} />
        <ListRow title="Green salad" titleSuffix="10 min" meta={['No photo, no Score']} />
      </View>

      <SectionHeader title="Action buttons" />
      <ActionButtons
        actions={[
          { label: 'Want to Cook', icon: 'flame-outline', onPress: noop },
          { label: 'Shopping List', icon: 'cart-outline', onPress: noop },
          { label: 'Cooked', icon: 'checkmark-circle-outline', onPress: noop },
        ]}
      />

      <SectionHeader title="Floating segment" />
      <View style={styles.segmentArea}>
        <FloatingSegment
          options={[
            { value: 'list', label: 'List' },
            { value: 'map', label: 'Map' },
          ]}
          value={view}
          onChange={setView}
        />
      </View>

      <SectionHeader title="Empty state" />
      <View style={styles.emptyArea}>
        <EmptyState
          icon="book-outline"
          title="Nothing here yet"
          message="A short line saying what will show up here."
          action={{ label: 'Add one', onPress: noop }}
        />
      </View>

      <SectionHeader title="Text field" />
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Grandma's lasagne" />
      <TextField label="Notes" value="" onChangeText={noop} placeholder="Multiline" multiline />

      <SectionHeader title="Ingredient line editor" />
      <IngredientLineEditor number={1} value={line} onChange={setLine} onRemove={noop} />

      <SectionHeader title="Step editor" />
      <StepEditor number={1} value={step} onChange={setStep} onRemove={noop} />

      <SectionHeader title="Ingredient lines" />
      <View>
        <IngredientLineRow text="2 cloves garlic, minced" ingredient="garlic" amount="2 cloves" />
        <IngredientLineRow text="Salt to taste" ingredient="salt" />
      </View>

      <SectionHeader title="Steps" />
      <StepRow number={1} text="Mash the garlic into the butter." />
      <StepRow number={2} text="Spread on the bread and bake for 10 minutes, until the edges are golden." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatch: { alignItems: 'center', gap: spacing.xs, width: 104 },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  segmentArea: { height: 96, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  emptyArea: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
});
