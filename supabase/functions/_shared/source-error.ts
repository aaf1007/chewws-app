// Why a source couldn't be read. Its own module so the guarded fetch and the adapters share it.

/**
 * `unavailable`: the platform answered that it has no such video (private, deleted, not a video),
 * or the page doesn't exist. `unreachable`: no usable answer (network error, 5xx, too slow).
 * `unreadable`: the link leads somewhere the reader won't go (a private address, a short link
 * redirecting off the platform). `notSetUp`: the server has no working key for the platform's API.
 */
export type SourceFailure = 'unavailable' | 'unreachable' | 'unreadable' | 'notSetUp';

export class SourceError extends Error {
  readonly reason: SourceFailure;

  constructor(reason: SourceFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceError';
    this.reason = reason;
  }
}
