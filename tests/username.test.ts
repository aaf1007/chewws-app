// Ticket 11: how a typed username becomes the one sent (decisions 11), with awkward real input.
import { expect, test } from 'vitest';

import { USERNAME_RULE, checkUsername, normaliseUsername } from '../src/data';

test('a username is trimmed, loses one leading @, and is lowercased', () => {
  expect(normaliseUsername('  @Sam_Cooks  ')).toBe('sam_cooks');
  expect(normaliseUsername('\tALEX\n')).toBe('alex');
  expect(normaliseUsername('@@sam')).toBe('@sam');
  expect(normaliseUsername('')).toBe('');
  expect(normaliseUsername('   ')).toBe('');
});

test('3–20 lowercase letters, digits and _ with at least one letter is a username', () => {
  expect(checkUsername('@Rosa_2024')).toEqual({ status: 'valid', username: 'rosa_2024' });
  expect(checkUsername('abc')).toEqual({ status: 'valid', username: 'abc' });
  expect(checkUsername('a_________________z')).toEqual({ status: 'valid', username: 'a_________________z' });
  expect(checkUsername('_x_')).toEqual({ status: 'valid', username: '_x_' });
});

test('anything else is refused with the one rule', () => {
  const refused = { status: 'invalid', message: USERNAME_RULE };
  expect(USERNAME_RULE).toBe('Use 3–20 letters, numbers or _');
  for (const typed of [
    '',
    '   ',
    '@',
    'ab',
    '@ab',
    'abcdefghijklmnopqrstu', // 21
    '12345', // no letter
    '___',
    'crème', // accents
    'josé',
    "o'brien", // apostrophe
    'sam cooks',
    '@ sam',
    'sam.cooks',
    'sam-cooks',
    'ｓａｍ', // full-width letters
    'sam​cooks', // zero-width space
    '🍝pasta',
  ]) {
    expect(checkUsername(typed), JSON.stringify(typed)).toEqual(refused);
  }
});
