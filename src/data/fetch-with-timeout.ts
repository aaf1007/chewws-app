/**
 * `fetch` that gives up after `ms` with no answer, which counts as no signal. With no signal at all
 * a request usually fails at once; this covers a connection that goes nowhere. The caller's own
 * signal still aborts it, even one aborted before the request, and is let go once it's done.
 */
export function withTimeout(fetchFn: typeof fetch, ms: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const caller = init?.signal ?? null;
    const abort = () => controller.abort(caller?.reason);
    if (caller?.aborted) abort();
    else caller?.addEventListener('abort', abort);
    const timer = setTimeout(() => controller.abort(), ms);
    return fetchFn(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', abort);
    });
  };
}
