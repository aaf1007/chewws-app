import { useState } from 'react';
import { View } from 'react-native';

import { hasCode, messageOf } from '@/auth/errors';
import { validateRecipeInput, type Recipe, type RecipeInput, type RecipeInputError } from '@/data';
import {
  Button,
  IngredientLineEditor,
  SectionHeader,
  StepEditor,
  Text,
  TextField,
  spacing,
  type IngredientLineFields,
} from '@/ui';

/** A row the user is editing, with a stable key for React while rows are added and removed. */
type Keyed<T> = { key: number; value: T };

let lastKey = 0;
const keyed = <T,>(value: T): Keyed<T> => ({ key: ++lastKey, value });

const EMPTY_LINE: IngredientLineFields = { originalText: '', amountText: '', ingredientName: '' };

type FormState = { title: string; lines: Keyed<IngredientLineFields>[] };

const CHECK_CODES: RecipeInputError['code'][] = ['title_required', 'ingredient_required'];

/**
 * The message to show for the last save's error, given the form as it is now. An error from the
 * Recipe checks follows the same checks as the form changes (so "?!" for an Ingredient still
 * fails), and goes once they pass; any other error stays until the next save.
 */
function messageNow(saveError: unknown, form: FormState): string | null {
  const code = CHECK_CODES.find((c) => hasCode(saveError, c));
  if (code === undefined) return messageOf(saveError);
  const check = validateRecipeInput({
    title: form.title,
    lines: form.lines.map((l) => l.value),
    steps: [],
  });
  if (check.status === 'valid') return null;
  return check.errors.find((e) => e.code === code)?.message ?? null;
}

/**
 * The Recipe editor shared by "New Recipe" and "Edit Recipe". Holds what the user is typing and
 * hands it to `onSubmit` as is; the data layer drops blank rows and checks the rest.
 */
export function RecipeForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Recipe;
  submitLabel: string;
  onSubmit: (input: RecipeInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [lines, setLines] = useState<Keyed<IngredientLineFields>[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((line) =>
          keyed({
            originalText: line.originalText,
            amountText: line.amountText ?? '',
            ingredientName: line.ingredient.name,
          }),
        )
      : [keyed(EMPTY_LINE)],
  );
  const [steps, setSteps] = useState<Keyed<string>[]>(() =>
    initial && initial.steps.length > 0 ? initial.steps.map((step) => keyed(step)) : [keyed('')],
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ error: unknown } | null>(null);
  const shownError = saveError && messageNow(saveError.error, { title, lines });

  const save = () => {
    setSaving(true);
    setSaveError(null);
    onSubmit({ title, lines: lines.map((l) => l.value), steps: steps.map((s) => s.value) }).catch(
      (error: unknown) => {
        setSaveError({ error });
        setSaving(false);
      },
    );
  };

  return (
    <>
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Grandma's lasagne"
        testID="recipe-title"
      />

      <View style={{ gap: spacing.sm }}>
        <SectionHeader
          title="Ingredients"
          action={{ label: 'Add line', onPress: () => setLines((all) => [...all, keyed(EMPTY_LINE)]) }}
        />
        {lines.map((line, index) => (
          <IngredientLineEditor
            key={line.key}
            number={index + 1}
            value={line.value}
            onChange={(value) =>
              setLines((all) => all.map((l) => (l.key === line.key ? { ...l, value } : l)))
            }
            onRemove={() => setLines((all) => all.filter((l) => l.key !== line.key))}
          />
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader
          title="Steps"
          action={{ label: 'Add step', onPress: () => setSteps((all) => [...all, keyed('')]) }}
        />
        {steps.map((step, index) => (
          <StepEditor
            key={step.key}
            number={index + 1}
            value={step.value}
            onChange={(value) =>
              setSteps((all) => all.map((s) => (s.key === step.key ? { ...s, value } : s)))
            }
            onRemove={() => setSteps((all) => all.filter((s) => s.key !== step.key))}
          />
        ))}
      </View>

      {shownError ? <Text tone="danger">{shownError}</Text> : null}
      <Button label={submitLabel} icon="checkmark" disabled={saving} onPress={save} />
    </>
  );
}
