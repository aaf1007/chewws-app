import { normaliseIngredientName } from './ingredient-matcher';
import type { RecipeInput } from './types';

/** A rule the Recipe as typed breaks. Its `code` is the `DataError` code a save fails with. */
export type RecipeInputError =
  | { code: 'title_required'; message: string }
  | { code: 'ingredient_required'; lineNumber: number; message: string };

/** A Recipe as typed, tidied: blank lines and steps dropped, every Ingredient name normalised. */
export type CheckedRecipe = {
  title: string;
  lines: { originalText: string; amountText: string | null; ingredientName: string }[];
  steps: string[];
};

export type RecipeInputCheck =
  | { status: 'valid'; recipe: CheckedRecipe }
  | { status: 'invalid'; errors: RecipeInputError[] };

/**
 * Checks and tidies what the user typed, without saving it: the rules a save enforces, so a form
 * can show the same errors. Blank lines and steps are dropped; every other line needs an
 * Ingredient name the Ingredient matcher leaves something of. A line with no text of its own reads
 * as its amount and Ingredient. Errors name lines by the number the user sees, blank lines included.
 */
export function validateRecipeInput(input: RecipeInput): RecipeInputCheck {
  const errors: RecipeInputError[] = [];

  const title = input.title.trim();
  if (!title) errors.push({ code: 'title_required', message: 'Give the Recipe a title.' });

  const lines: CheckedRecipe['lines'] = [];
  input.lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const originalText = line.originalText.trim();
    const amountText = (line.amountText ?? '').trim();
    const typedName = line.ingredientName.trim();
    if (!originalText && !amountText && !typedName) return;

    const ingredientName = normaliseIngredientName(typedName);
    if (!ingredientName) {
      errors.push({
        code: 'ingredient_required',
        lineNumber,
        message: `Ingredient line ${lineNumber} needs an Ingredient.`,
      });
      return;
    }
    lines.push({
      originalText: originalText || `${amountText} ${typedName}`.trim(),
      amountText: amountText || null,
      ingredientName,
    });
  });

  if (errors.length > 0) return { status: 'invalid', errors };
  const steps = input.steps.map((step) => step.trim()).filter(Boolean);
  return { status: 'valid', recipe: { title, lines, steps } };
}
