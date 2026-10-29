/** The longest a Tag's name can be, in characters (the 06 migration checks it too). */
export const MAX_TAG_NAME_LENGTH = 40;

/**
 * A Tag's name as it's stored (decisions 06): accents composed (NFC), trimmed, and each run of
 * spaces, tabs or line breaks made one space. The case is kept as typed: the first spelling of a
 * Tag is the one it keeps. '' when nothing is left.
 */
export function normaliseTagName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Two names are the same Tag when their keys are equal: the same name without regard to case. */
export function tagKey(name: string): string {
  return normaliseTagName(name).toLowerCase();
}

/** How many characters a name has, as the database counts them (an emoji is one, not two). */
export const tagNameLength = (name: string) => [...name].length;

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
