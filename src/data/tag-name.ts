/** The longest a Tag's name can be, in characters (the 06 migration checks it too). */
export const MAX_TAG_NAME_LENGTH = 40;

/** The most Tag names a Draft can be reviewed with (review_draft checks it too). */
export const MAX_REVIEW_TAGS = 20;

/**
 * A Tag's name as it's stored (decisions 06): accents composed (NFC); each run of spaces, tabs or
 * line breaks made one space; every other control or format character (Unicode Cc and Cf: a
 * zero-width space, a right-to-left override, a soft hyphen) removed, so two names that look the
 * same are the same Tag, except the zero-width joiner (U+200D), which holds emoji such as 👨‍🍳
 * together; trimmed. The 06 migration refuses a name that isn't like this. The case
 * is kept as typed: the first spelling of a Tag is the one it keeps. '' when nothing is left.
 */
export function normaliseTagName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/(?!\u200D)[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/gu, ' ')
    .trim()
    .normalize('NFC');
}

/** Two names are the same Tag when their keys are equal: the same name without regard to case. */
export function tagKey(name: string): string {
  return normaliseTagName(name).toLowerCase();
}

/** How many characters a name has, as the database counts them (an emoji is one, not two). */
export const tagNameLength = (name: string) => [...name].length;

/** A Tag name as typed, checked: the name to save, or the rule it breaks (its `DataError` code). */
export type TagNameCheck =
  | { status: 'valid'; name: string }
  | { status: 'invalid'; code: 'tag_required' | 'tag_too_long'; message: string };

/** Checks and tidies a Tag name as typed, without saving it, so a screen can show the same error. */
export function checkTagName(typed: string): TagNameCheck {
  const name = normaliseTagName(typed);
  if (!name) return { status: 'invalid', code: 'tag_required', message: 'Type the name of a Tag.' };
  if (tagNameLength(name) > MAX_TAG_NAME_LENGTH) {
    return { status: 'invalid', code: 'tag_too_long', message: `A Tag can be at most ${MAX_TAG_NAME_LENGTH} characters.` };
  }
  return { status: 'valid', name };
}

/**
 * Tag names tidied for saving: normalised, blank and over-long ones dropped, and each Tag once,
 * spelled as it first appears. Keeps the first `max` of them.
 */
export function tidyTagNames(names: readonly string[], max = Infinity): string[] {
  const kept = new Map<string, string>();
  for (const raw of names) {
    const name = normaliseTagName(raw);
    if (!name || tagNameLength(name) > MAX_TAG_NAME_LENGTH || kept.has(tagKey(name))) continue;
    kept.set(tagKey(name), name);
    if (kept.size >= max) break;
  }
  return [...kept.values()];
}
