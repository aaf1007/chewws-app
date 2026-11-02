import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ActionButtons,
  AddField,
  Button,
  DayPicker,
  DraftBanner,
  EmptyState,
  FilterTiles,
  FloatingSegment,
  IngredientLineEditor,
  IngredientLineRow,
  IngredientRow,
  ListRow,
  ListSwitcher,
  NavRow,
  PersonRow,
  ScoreBadge,
  Screen,
  ScreenshotField,
  SearchField,
  SectionHeader,
  ShoppingListRow,
  SourceVideoCard,
  StepEditor,
  StepRow,
  SuggestedTagChip,
  SyncNotice,
  TagChip,
  TagChips,
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
  const [whichList, setWhichList] = useState('mine');
  const [cookOn, setCookOn] = useState<string | null>('2026-11-02');
  const [title, setTitle] = useState('Garlic bread');
  const [line, setLine] = useState({
    originalText: '2 cloves garlic, minced',
    amountText: '2 cloves',
    ingredientName: 'garlic',
  });
  const [step, setStep] = useState('Mash the garlic into the butter.');
  const [kept, setKept] = useState<Record<string, boolean>>({ Italian: true, Dinner: false, quick: true });
  const [wantToCook, setWantToCook] = useState(false);

  return (
    <Screen scroll>
      <SectionHeader title="Screen" />
      <Button
        label="Scrolling screen under a header"
        variant="outlined"
        onPress={() => router.push('/dev/scroll')}
      />
      <Button
        label="Scrolling screen without a header"
        variant="outlined"
        onPress={() => router.push({ pathname: '/dev/scroll', params: { header: 'none' } })}
      />

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
      <Button
        label="Want to Cook"
        variant={wantToCook ? 'filled' : 'outlined'}
        icon={wantToCook ? 'flame' : 'flame-outline'}
        selected={wantToCook}
        onPress={() => setWantToCook((on) => !on)}
      />

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

      <SectionHeader title="Tag chips" />
      <TagChips>
        <TagChip name="Italian" onRemove={noop} />
        <TagChip name="Crème de la crème" onRemove={noop} />
        <TagChip name="A Tag with a long name of forty letters" onRemove={noop} />
        <TagChip name="No remove" />
      </TagChips>
      <TagChips>
        {Object.entries(kept).map(([name, selected]) => (
          <SuggestedTagChip
            key={name}
            name={name}
            selected={selected}
            onPress={() => setKept((all) => ({ ...all, [name]: !selected }))}
          />
        ))}
      </TagChips>

      <SectionHeader title="Nav row" />
      <NavRow icon="document-text-outline" label="Drafts (2)" detail="1 ready to review" onPress={noop} />

      <SectionHeader title="Source video cards" />
      <SourceVideoCard
        platform="TikTok"
        title="Pasta Queen"
        detail="Watch on TikTok"
        thumbnailUrl={photo('photo-1546069901-ba9599a7e63c').uri}
        onPress={noop}
      />
      <SourceVideoCard platform="TikTok" title="TikTok video" detail="https://vm.tiktok.com/ZMabc123/" />
      <SourceVideoCard
        platform="YouTube"
        title="Lemon Kitchen"
        detail="Watch on YouTube"
        thumbnailUrl={photo('photo-1473093295043-cdd812d0e601').uri}
        onPress={noop}
      />
      <SourceVideoCard
        kind="page"
        platform="cooking.example.com"
        title="Rosa Martínez"
        detail="Open the page"
        thumbnailUrl={photo('photo-1590412200988-a436970781fa').uri}
        onPress={noop}
      />
      <SourceVideoCard kind="page" platform="blog.example.org" title="My kitchen tour" detail="Open the page" onPress={noop} />
      <SourceVideoCard platform="Instagram" title="Instagram Reel" detail="Watch on Instagram" onPress={noop} />

      <SectionHeader title="Screenshot field" />
      <ScreenshotField imageUri={null} onAdd={noop} onRemove={noop} />
      <ScreenshotField imageUri={photo('photo-1467003909585-2f8a72700288').uri} onAdd={noop} onRemove={noop} />

      <SectionHeader title="Draft banners" />
      <DraftBanner kind="building" title="Building this Draft…" message="It’ll be ready in a moment." />
      <DraftBanner
        kind="notInCaption"
        title="Recipe not in caption"
        message="The caption doesn’t list the ingredients. Fill them in from the video."
      />
      <DraftBanner
        kind="failed"
        title="Couldn't build this Draft"
        message="Couldn't reach TikTok."
        actions={[
          { label: 'Try again', onPress: noop },
          { label: 'Fill in by hand', onPress: noop },
        ]}
      />
      <DraftBanner
        kind="couldNotRead"
        title="Couldn't read this TikTok"
        message="TikTok didn't share this video's caption. Paste the caption or add a screenshot of it."
        actions={[
          { label: 'Add caption or screenshot', onPress: noop },
          { label: 'Fill in by hand', onPress: noop },
        ]}
      />

      <SectionHeader title="Action buttons" />
      <ActionButtons
        actions={[
          { label: 'Want to Cook', icon: 'flame-outline', onPress: noop },
          { label: 'Shopping List', icon: 'cart-outline', onPress: noop },
          { label: 'Cooked', icon: 'checkmark-circle-outline', onPress: noop },
        ]}
      />

      <SectionHeader title="List switcher" />
      <ListSwitcher
        options={[
          { value: 'mine', label: 'Your list' },
          { value: 'sam', label: "Sam's list" },
          { value: 'alex', label: "Alex_cooks's list" },
          { value: 'rosa', label: "Rosa_2024's list" },
        ]}
        value={whichList}
        onChange={setWhichList}
      />

      <SectionHeader title="Day picker" />
      <DayPicker value={cookOn} onChange={setCookOn} today="2026-10-31" />

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
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Grandma's lasagne" />
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

      <SectionHeader title="Add field" />
      <AddField onSubmit={() => Promise.resolve()} placeholder="Add an Ingredient" />
      <AddField onSubmit={() => Promise.reject(new Error('refused'))} placeholder="Refuses, so the text comes back" />

      <SectionHeader title="Ingredient rows" />
      <View>
        <IngredientRow name="garlic" action={{ label: 'Used up', onPress: noop }} />
        <IngredientRow name="crème fraîche" action={{ label: 'Remove', onPress: noop }} />
        <IngredientRow name="salt" />
      </View>

      <SectionHeader title="Shopping List rows" />
      <View>
        <ShoppingListRow
          name="garlic"
          details={['Garlic bread · 2 cloves', 'Aglio e olio · 4 cloves, 1 clove']}
          check={{ checked: false, onPress: noop }}
          action={{ label: 'Remove', onPress: noop }}
        />
        <ShoppingListRow
          name="Paper towels"
          check={{ checked: true, onPress: noop }}
          action={{ label: 'Remove', onPress: noop }}
        />
        <ShoppingListRow name="Garlic bread" action={{ label: 'Remove', onPress: noop }} />
      </View>

      <SectionHeader title="Sync notices" />
      <SyncNotice status="offline" message="You're offline. 3 changes will sync when you're back online." />
      <SyncNotice status="offline" message="You're offline. This is your list as it was last loaded." />
      <SyncNotice status="syncing" message="Syncing 2 changes…" />
      <SyncNotice status="retrying" message="The server had a problem. 2 changes will retry shortly." />
      <SyncNotice status="notSaved" message="Couldn't check off Foil." action={{ label: 'OK', onPress: () => {} }} />

      <SectionHeader title="Steps" />
      <StepRow number={1} text="Mash the garlic into the butter." />
      <StepRow number={2} text="Spread on the bread and bake for 10 minutes, until the edges are golden." />

      <SectionHeader title="Person rows" />
      <View>
        <PersonRow
          username="sam"
          detail="Wants to be Friends"
          actions={[
            { label: 'Accept', onPress: noop },
            { label: 'Decline', onPress: noop, tone: 'muted' },
          ]}
        />
        <PersonRow username="alex_cooks" actions={[{ label: 'Add', onPress: noop }]} />
        <PersonRow username="rosa_2024" detail="Requested" actions={[{ label: 'Cancel', onPress: noop, tone: 'muted' }]} />
        <PersonRow username="a_username_twenty_ch" detail="Friends since 28 Oct 2026" />
      </View>
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
