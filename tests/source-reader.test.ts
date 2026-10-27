// The pure parts of the source reader and the Claude call: finding the link in what was shared,
// and reading Claude's answer. No network: the adapters themselves are checked by hand (spec).
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';

import { parseExtraction } from '../supabase/functions/_shared/claude-extractor';
import { detectSource } from '../supabase/functions/_shared/detect-source';

describe('detectSource', () => {
  test.each([
    ['https://www.tiktok.com/@pastaqueen/video/7400000000000000001', 'tiktok', 'https://www.tiktok.com/@pastaqueen/video/7400000000000000001'],
    ['  https://vm.tiktok.com/ZMabc123/  ', 'tiktok', 'https://vm.tiktok.com/ZMabc123/'],
    ['https://vt.tiktok.com/ZSxyz/', 'tiktok', 'https://vt.tiktok.com/ZSxyz/'],
    ['HTTPS://WWW.TIKTOK.COM/@Chef/video/1', 'tiktok', 'https://www.tiktok.com/@Chef/video/1'],
    ['https://tiktok.com/@chef/video/1?is_from_webapp=1&sender_device=pc', 'tiktok', 'https://tiktok.com/@chef/video/1?is_from_webapp=1&sender_device=pc'],
    // Shared text: the first link wins, without the punctuation around it.
    ["Mira esta receta de crème brûlée 😍 https://vm.tiktok.com/ZMcreme/. ¡Qué rico!", 'tiktok', 'https://vm.tiktok.com/ZMcreme/'],
    ["Grandma's pasta (https://www.tiktok.com/@nonna/video/42)", 'tiktok', 'https://www.tiktok.com/@nonna/video/42'],
    ['“https://vm.tiktok.com/ZMquoted/”', 'tiktok', 'https://vm.tiktok.com/ZMquoted/'],
    ['first https://vm.tiktok.com/ZMone/ then https://vm.tiktok.com/ZMtwo/', 'tiktok', 'https://vm.tiktok.com/ZMone/'],
    // Hosts that only look like TikTok are other links.
    ['https://notiktok.com/video/1', 'web', 'https://notiktok.com/video/1'],
    ['https://tiktok.com.example.org/video/1', 'web', 'https://tiktok.com.example.org/video/1'],
    ['http://www.allrecipes.com/recipe/1/', 'web', 'http://www.allrecipes.com/recipe/1/'],
  ])('%s is a %s link: %s', (shared, platform, url) => {
    expect(detectSource(shared)).toEqual({ platform, url });
  });

  test.each([[''], ['   '], ['link in bio!'], ['tiktok.com/@chef/video/1'], ['ftp://tiktok.com/x'], ['https://']])(
    '%j has no link',
    (shared) => {
      expect(detectSource(shared)).toBeNull();
    },
  );
});

/** Claude's answer, as the SDK returns it, with `text` as its one text block. */
function answer(text: string, stop_reason: Anthropic.StopReason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text' as const, text, citations: null }] };
}

describe('parseExtraction', () => {
  test('reads a recipe, keeping accents, apostrophes and a missing amount as written', () => {
    const json = JSON.stringify({
      title: "Nonna's crème brûlée",
      recipeFound: true,
      lines: [
        { text: '4 egg yolks', amount: '4', ingredient: 'egg yolk' },
        { text: "a splash of Grand Marnier's finest", amount: null, ingredient: 'Grand Marnier' },
      ],
      steps: ['Whisk.', 'Bake at 150°C.'],
    });

    expect(parseExtraction(answer(json))).toEqual({
      title: "Nonna's crème brûlée",
      recipeFound: true,
      lines: [
        { text: '4 egg yolks', amount: '4', ingredient: 'egg yolk' },
        { text: "a splash of Grand Marnier's finest", amount: null, ingredient: 'Grand Marnier' },
      ],
      steps: ['Whisk.', 'Bake at 150°C.'],
    });
  });

  test.each([
    ['a refusal', answer('{}', 'refusal')],
    ['an answer cut off at max_tokens', answer('{"title": "Pa', 'max_tokens')],
    ['text that is not JSON', answer('Here is the recipe: pasta')],
    ['an empty answer', answer('')],
    ['JSON that is not an object', answer('"pasta"')],
    ['a missing field', answer('{"title": "Pasta", "recipeFound": true, "lines": []}')],
    ['a line with no ingredient', answer('{"title": "P", "recipeFound": true, "lines": [{"text": "salt", "amount": null}], "steps": []}')],
    ['a number as an amount', answer('{"title": "P", "recipeFound": true, "lines": [{"text": "2 eggs", "amount": 2, "ingredient": "egg"}], "steps": []}')],
    ['a step that is not text', answer('{"title": "P", "recipeFound": true, "lines": [], "steps": [1]}')],
    ['recipeFound as a string', answer('{"title": "P", "recipeFound": "false", "lines": [], "steps": []}')],
  ])('%s is unreadable', (_, message) => {
    expect(() => parseExtraction(message)).toThrow(expect.objectContaining({ name: 'ExtractError', reason: 'unreadable' }));
  });
});
