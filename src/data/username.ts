/** 3–20 lowercase ASCII letters, digits and _ (the 11 migration checks it too). */
const USERNAME = /^[a-z0-9_]{3,20}$/;

/**
 * A username as typed, the way it's sent (decisions 11): surrounding whitespace and one leading @
 * dropped, lowercased. Whether what's left is a valid username is `checkUsername`'s question.
 */
export function normaliseUsername(typed: string): string {
  return typed.trim().replace(/^@/, '').toLowerCase();
}

/** The rule every username follows, in the words the screen shows when one breaks it. */
export const USERNAME_RULE = 'Use 3–20 letters, numbers or _';

/** A username as typed, checked: the name to send, or why it can't be one. */
export type UsernameCheck = { status: 'valid'; username: string } | { status: 'invalid'; message: string };

/**
 * Checks and tidies a username as typed, without saving it, so the screen can say what's wrong
 * before asking the server: 3–20 lowercase ASCII letters, digits and _, with at least one letter.
 */
export function checkUsername(typed: string): UsernameCheck {
  const username = normaliseUsername(typed);
  if (!USERNAME.test(username) || !/[a-z]/.test(username)) return { status: 'invalid', message: USERNAME_RULE };
  return { status: 'valid', username };
}

/**
 * A search as typed, ready to send: normalised like a username, or null when it can't find
 * anyone (under 3 characters, over 20, or with a character no username has).
 */
export function usernameSearchQuery(typed: string): string | null {
  const query = normaliseUsername(typed);
  return USERNAME.test(query) ? query : null;
}
