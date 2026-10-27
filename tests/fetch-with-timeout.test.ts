// The app's fetch with a timeout (src/data/fetch-with-timeout.ts), against a stand-in fetch.
import { expect, test, vi } from 'vitest';

import { withTimeout } from '../src/data/fetch-with-timeout';

/** A fetch that never answers on its own: it fails once its signal aborts. Keeps the signal it got. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fetchFn: typeof fetch = (_input, init) => {
    const signal = init?.signal;
    if (!signal) return Promise.reject(new Error('no signal'));
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  return { fetchFn, signals };
}

test('a request whose signal was already aborted is aborted at once, not after the timeout', async () => {
  const { fetchFn, signals } = hangingFetch();
  const caller = new AbortController();
  caller.abort();

  const request = withTimeout(fetchFn, 60_000)('https://example.test', { signal: caller.signal });

  expect(signals[0].aborted).toBe(true);
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});

test("once a request is done, it stops listening to the caller's signal", async () => {
  const caller = new AbortController();
  const added = vi.spyOn(caller.signal, 'addEventListener');
  const removed = vi.spyOn(caller.signal, 'removeEventListener');
  const answered: typeof fetch = async () => new Response('ok');

  await withTimeout(answered, 60_000)('https://example.test', { signal: caller.signal });

  expect(added).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
});

test('a request with no answer is aborted after the timeout', async () => {
  vi.useFakeTimers();
  try {
    const { fetchFn, signals } = hangingFetch();
    const request = withTimeout(fetchFn, 8_000)('https://example.test');
    const failed = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    vi.advanceTimersByTime(7_999);
    expect(signals[0].aborted).toBe(false);
    vi.advanceTimersByTime(1);
    await failed;
  } finally {
    vi.useRealTimers();
  }
});
