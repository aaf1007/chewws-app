/**
 * The offline queue: list changes made on this phone wait here, in the order they were made, until
 * the server has them. It knows nothing about lists. Each kind of list supplies its own change type
 * `C`, how to send one, and what to do once one is sent, so the Shopping List, a shared Shopping
 * List (ticket 13) and the Cook Plan list (ticket 15) can share it.
 *
 * - Each change gets an id and the time it was made, from the phone's clock. Times only go up, so
 *   two changes made in the same millisecond still have an order. The server uses the time to let
 *   the later of two conflicting changes win, however late the earlier one arrives.
 * - A request that fails to reach the server means the phone is offline. Changes stay queued (and
 *   saved in `storage`, so they outlive the app) and are sent again the next time `sync` runs: when
 *   a change is made, and when the app calls it on coming to the foreground or on a timer.
 * - Changes are sent one at a time, oldest first. Sending is safe to repeat: if the answer to a
 *   change is lost, it's sent again and the server ends up the same.
 * - A server error (5xx) may pass, so the change waits too (`waitingToRetry`, not `offline`: the
 *   server was reached), and is tried again after a pause that grows with each error in a row
 *   (`RETRY_DELAYS_MS`): it isn't sent before its `nextTryAt`,
 *   whoever calls `sync`, and the changes behind it wait for it. Both are saved with the change, so
 *   they outlive restarts. When its last retry fails too (about 21 minutes of errors), it's given
 *   up: it leaves the queue, so the changes behind it are sent, and waits in `gaveUp` (saved too)
 *   until whoever shows the list has told the user. No answer at all never counts.
 * - A send that throws (a bug, not an answer) gives its change up at once, logged, the same way.
 *
 * `nextQueueState` is the state machine, pure; `createChangeQueue` runs it.
 */
import { DataError } from './types';

/**
 * A change made on this phone, waiting to be sent. `madeAt` is an ISO timestamp. `serverFailures`:
 * how many times in a row the server answered it with an error of its own (5xx). `nextTryAt`: after
 * one, when it may be sent again (ms, from the phone's clock); null when it may be sent now.
 */
export type QueuedChange<C> = {
  id: string;
  madeAt: string;
  change: C;
  serverFailures: number;
  nextTryAt: number | null;
};

/** A change given up, with the name of what it changed, as the user knew it, for the notice. */
export type GaveUpChange<C> = {
  id: string;
  madeAt: string;
  change: C;
  name: string;
};

/**
 * How long a change waits after each server error in a row before it's tried again. When the try
 * after the last pause fails too, about 21 minutes after the first error, it's given up.
 */
export const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000] as const;

/** How far the phone's clock may go back during a pause before the pause counts as over. */
const CLOCK_BACK_MARGIN_MS = 60_000;

/**
 * Whether a change may be sent at `now`. A next try further off than the change's own pause, by
 * more than a minute, means the phone's clock went back past when the server failed on it, so
 * it's due. A small step back (a clock sync) leaves it waiting.
 */
export function isDue({ nextTryAt, serverFailures }: QueuedChange<unknown>, now: number): boolean {
  if (nextTryAt === null || now >= nextTryAt) return true;
  const pause: number = RETRY_DELAYS_MS[serverFailures - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  return nextTryAt - now > pause + CLOCK_BACK_MARGIN_MS;
}

type Queued<C> = {
  queue: readonly QueuedChange<C>[];
  /** Changes given up after their last retry failed, until `dismissed`. */
  gaveUp: readonly GaveUpChange<C>[];
};

/**
 * `idle`: not sending, and the last request reached the server. `syncing`: sending the queue.
 * `offline`: the last request didn't reach the server; changes wait for the next try.
 * `waitingToRetry`: the server was reached but failed on the change at the head of the queue (5xx);
 * it, and the changes behind it, wait for its next try, at `retryAt` (ms, from the phone's clock).
 */
export type QueueState<C> =
  | ({ status: 'idle' | 'syncing' | 'offline' } & Queued<C>)
  | ({ status: 'waitingToRetry'; retryAt: number } & Queued<C>);

export type QueueEvent<C> =
  /** The changes saved on the phone, read back when the app starts. */
  | {
      type: 'restored';
      queue: readonly QueuedChange<C>[];
      gaveUp: readonly GaveUpChange<C>[];
    }
  | { type: 'queued'; change: QueuedChange<C> }
  | { type: 'syncStarted' }
  /** The server has the change, or has said it can never take it. */
  | { type: 'sent'; id: string }
  /**
   * The server answered the change with an error of its own (5xx) at `at`. `name` is what it
   * changed, kept if it's given up.
   */
  | { type: 'serverFailed'; id: string; at: number; name: string }
  /** Sending the change failed in a way nobody expected (a bug): it's given up at once. */
  | { type: 'gaveUp'; id: string; name: string }
  /** The user has been told about the changes given up. */
  | { type: 'dismissed' }
  /** Taken off the queue unsent: what they change is gone. */
  | { type: 'withdrawn'; ids: readonly string[] }
  | { type: 'unreachable' }
  /** The change at the head of the queue isn't due until `until`, after a server error. */
  | { type: 'waitingToRetry'; until: number }
  /** The queue is empty and the server was reached. */
  | { type: 'synced' }
  /** The changes are thrown away unsent, as when their user signs out. */
  | { type: 'discarded' };

/** Takes the change off the queue and keeps it, named `name`, until the user has been told. */
function giveUp<C>(state: QueueState<C>, id: string, name: string): QueueState<C> {
  const failed = state.queue.find((c) => c.id === id);
  if (!failed) return state;
  const { madeAt, change } = failed;
  return {
    ...state,
    queue: state.queue.filter((c) => c.id !== id),
    gaveUp: [...state.gaveUp, { id, madeAt, change, name }],
  };
}

const withStatus = <C>(state: QueueState<C>, status: 'idle' | 'syncing' | 'offline'): QueueState<C> => ({
  status,
  queue: state.queue,
  gaveUp: state.gaveUp,
});

export function nextQueueState<C>(state: QueueState<C>, event: QueueEvent<C>): QueueState<C> {
  switch (event.type) {
    case 'restored': {
      const restored = new Set(event.queue.map((c) => c.id));
      return {
        ...state,
        queue: [...event.queue, ...state.queue.filter((c) => !restored.has(c.id))],
        gaveUp: [...event.gaveUp, ...state.gaveUp],
      };
    }
    case 'queued':
      return state.queue.some((c) => c.id === event.change.id)
        ? state
        : { ...state, queue: [...state.queue, event.change] };
    case 'syncStarted':
      return withStatus(state, 'syncing');
    case 'sent':
      return { ...state, queue: state.queue.filter((c) => c.id !== event.id) };
    case 'serverFailed': {
      const failed = state.queue.find((c) => c.id === event.id);
      if (!failed) return state;
      const serverFailures = failed.serverFailures + 1;
      const delay: number | undefined = RETRY_DELAYS_MS[serverFailures - 1];
      if (delay !== undefined) {
        const counted = {
          ...failed,
          serverFailures,
          nextTryAt: event.at + delay,
        };
        return {
          ...state,
          queue: state.queue.map((c) => (c.id === event.id ? counted : c)),
        };
      }
      return giveUp(state, event.id, event.name);
    }
    case 'gaveUp':
      return giveUp(state, event.id, event.name);
    case 'dismissed':
      return { ...state, gaveUp: [] };
    case 'withdrawn': {
      const withdrawn = new Set(event.ids);
      return { ...state, queue: state.queue.filter((c) => !withdrawn.has(c.id)) };
    }
    case 'unreachable':
      return withStatus(state, 'offline');
    case 'waitingToRetry':
      return { status: 'waitingToRetry', retryAt: event.until, queue: state.queue, gaveUp: state.gaveUp };
    case 'synced':
      return withStatus(state, 'idle');
    case 'discarded':
      return { status: 'idle', queue: [], gaveUp: [] };
  }
}

/** What happened when a change was sent. */
export type Delivery =
  /** The server has it: it applied. */
  | { status: 'sent' }
  /** A later change to its item, made elsewhere, stands instead: whoever shows the list reads it again. */
  | { status: 'superseded' }
  /** Its item is gone, so there's nothing to change. */
  | { status: 'dropped' }
  /** The server will never take it. */
  | { status: 'refused'; error: DataError }
  /** The server answered with an error of its own (5xx): it may pass, so the change is tried again. */
  | { status: 'serverFailed'; error: DataError }
  /** The request didn't reach the server. */
  | { status: 'unreachable' };

/** How a change left the queue. */
export type Delivered = Extract<Delivery, { status: 'sent' | 'superseded' | 'dropped' | 'refused' }>;

/** What the code that made a change hears back: how it was delivered, or that it's waiting. */
export type ChangeOutcome = Delivered | { status: 'queued' };

/** Where the phone keeps things between launches. AsyncStorage in the app. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
    removeItem: async (key) => {
      items.delete(key);
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Saved<C> = { queue: QueuedChange<C>[]; gaveUp: GaveUpChange<C>[] };

/** A saved change's id, time and change, or null if it isn't a change this app can send. */
function parseEntry<C>(entry: unknown, parseChange: (raw: unknown) => C | null) {
  if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.madeAt !== 'string') return null;
  if (Number.isNaN(Date.parse(entry.madeAt))) return null;
  const change = parseChange(entry.change);
  return change === null ? null : { entry, id: entry.id, madeAt: entry.madeAt, change };
}

/**
 * The saved queue and changes given up, skipping anything this app can't read. An older version
 * saved the queue alone, as an array.
 */
function parseSaved<C>(raw: string | null, parseChange: (raw: unknown) => C | null): Saved<C> {
  const saved: Saved<C> = { queue: [], gaveUp: [] };
  if (raw === null) return saved;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return saved;
  }
  const queue: unknown = Array.isArray(value) ? value : isRecord(value) ? value.queue : null;
  const gaveUp: unknown = isRecord(value) ? value.gaveUp : null;
  for (const raw of Array.isArray(queue) ? queue : []) {
    const parsed = parseEntry(raw, parseChange);
    if (!parsed) continue;
    const { entry, id, madeAt, change } = parsed;
    // Saved before failures were counted, or unreadable: none yet.
    const failures = entry.serverFailures;
    const serverFailures = typeof failures === 'number' && Number.isInteger(failures) && failures >= 0 ? failures : 0;
    const nextTryAt = typeof entry.nextTryAt === 'number' && Number.isFinite(entry.nextTryAt) ? entry.nextTryAt : null;
    saved.queue.push({ id, madeAt, change, serverFailures, nextTryAt });
  }
  for (const raw of Array.isArray(gaveUp) ? gaveUp : []) {
    const parsed = parseEntry(raw, parseChange);
    if (parsed && typeof parsed.entry.name === 'string') {
      saved.gaveUp.push({
        id: parsed.id,
        madeAt: parsed.madeAt,
        change: parsed.change,
        name: parsed.entry.name,
      });
    }
  }
  return saved;
}

export type ChangeQueue<C> = {
  /** Resolves once the changes saved on the phone are read back. */
  ready: Promise<void>;
  /** Queues a change and starts sending. Resolves once it's sent, or once it's known to wait. */
  enqueue(change: C): Promise<ChangeOutcome>;
  /** Sends what's queued, then runs `afterSync`. Resolves when done or offline. */
  sync(): Promise<void>;
  /** For a request outside the queue that didn't reach the server. */
  markUnreachable(): void;
  /**
   * Takes the changes `matches` picks off the queue unsent, as when what they change is gone.
   * Whoever waits on one hears it's dropped. Resolves once saved.
   */
  withdraw(matches: (change: QueuedChange<C>) => boolean): Promise<void>;
  /**
   * Throws away every change waiting, unsent, and what's saved of them: whoever waits on one, or
   * makes one from now on, hears it's refused with `error`. Nothing is sent or saved after.
   */
  discard(error: DataError): Promise<void>;
  /** The user has been told about the changes given up: forgets them. Resolves once saved. */
  dismissGaveUp(): Promise<void>;
  state(): QueueState<C>;
  subscribe(listener: (state: QueueState<C>) => void): () => void;
};

export function createChangeQueue<C>(options: {
  storage: KeyValueStorage;
  key: string;
  parseChange: (raw: unknown) => C | null;
  /**
   * Resolves once `parseChange` can read the changes saved, if it needs something read first (to
   * fill in what an older version didn't save). They're read back after it.
   */
  parseAfter?: Promise<unknown>;
  /**
   * Sends one change. `discarded()` says whether the queue has been thrown away since the send
   * began (`discard`, as when its user signs out): a send that waits before its request goes out,
   * say for a session to refresh, checks it after the wait, and sends nothing if so.
   */
  send: (change: QueuedChange<C>, discarded: () => boolean) => Promise<Delivery>;
  /** What the change changed, as the user knows it, to name it if it's given up. */
  nameOf: (change: QueuedChange<C>) => string;
  /** Runs before a sent change leaves the queue, so whoever shows it can keep showing it. */
  onDelivered: (change: QueuedChange<C>, delivery: Delivered) => void;
  /** Runs once the queue is empty, e.g. to read the list again. Says whether the server was reached. */
  afterSync: (wasOffline: boolean) => Promise<'reached' | 'unreachable'>;
  now: () => number;
  newId: () => string;
}): ChangeQueue<C> {
  const { storage, key, parseChange, parseAfter, send, nameOf, onDelivered, afterSync, now, newId } = options;
  let state: QueueState<C> = { status: 'idle', queue: [], gaveUp: [] };
  let lastMadeAt = 0;
  const listeners = new Set<(state: QueueState<C>) => void>();
  const waiting = new Map<string, (outcome: ChangeOutcome) => void>();

  function dispatch(event: QueueEvent<C>) {
    state = nextQueueState(state, event);
    for (const listener of listeners) listener(state);
  }

  function settle(id: string, outcome: ChangeOutcome) {
    waiting.get(id)?.(outcome);
    waiting.delete(id);
  }

  // Saves run one after another, each writing the queue as it was when it was asked for. Once
  // discarded, nothing is saved again: the queue is gone from the phone.
  let saving: Promise<void> = Promise.resolve();
  let discardedWith: DataError | null = null;
  function save(): Promise<void> {
    if (discardedWith) return saving;
    const snapshot = JSON.stringify({
      queue: state.queue,
      gaveUp: state.gaveUp,
    });
    saving = saving.then(() => storage.setItem(key, snapshot)).catch(() => {});
    return saving;
  }

  const ready = Promise.resolve(parseAfter)
    .catch(() => {})
    .then(() => storage.getItem(key))
    .catch(() => null)
    .then((raw) => {
      const { queue, gaveUp } = parseSaved(raw, parseChange);
      lastMadeAt = Math.max(0, ...queue.map((c) => Date.parse(c.madeAt)));
      dispatch({ type: 'restored', queue, gaveUp });
    });

  /**
   * The queue stops for now: the server wasn't reached (`unreachable`), or the change at its head
   * waits for its next try (`waitingToRetry`). Whoever is waiting on a change hears it's queued.
   */
  function pause(event: Extract<QueueEvent<C>, { type: 'unreachable' | 'waitingToRetry' }>) {
    dispatch(event);
    for (const id of [...waiting.keys()]) settle(id, { status: 'queued' });
  }
  const wentOffline = () => pause({ type: 'unreachable' });
  const waitForRetry = (change: QueuedChange<C>) =>
    pause({ type: 'waitingToRetry', until: change.nextTryAt ?? now() });

  async function flush() {
    const wasOffline = state.status === 'offline';
    dispatch({ type: 'syncStarted' });
    for (let head = state.queue[0]; head; head = state.queue[0]) {
      // The server failed on it a moment ago: it, and the changes behind it, wait for its next try.
      if (!isDue(head, now())) {
        waitForRetry(head);
        return;
      }
      let delivery: Delivery;
      try {
        delivery = await send(head, () => discardedWith !== null);
      } catch (e) {
        // A bug, not an answer: retrying won't help, so the change is given up and the user told.
        const name = nameOf(head);
        console.error(`Sending a list change to ${name} failed unexpectedly; it was given up.`, e);
        dispatch({ type: 'gaveUp', id: head.id, name });
        await save();
        settle(head.id, {
          status: 'refused',
          error: e instanceof DataError ? e : new DataError('unknown', String(e), { cause: e }),
        });
        continue;
      }
      if (delivery.status === 'unreachable') {
        wentOffline();
        return;
      }
      if (delivery.status === 'serverFailed') {
        dispatch({
          type: 'serverFailed',
          id: head.id,
          at: now(),
          name: nameOf(head),
        });
        await save();
        const failed = state.queue.find((c) => c.id === head.id);
        if (failed) {
          waitForRetry(failed);
          return;
        }
        // Given up: the changes behind it are sent.
        settle(head.id, { status: 'refused', error: delivery.error });
        continue;
      }
      onDelivered(head, delivery);
      dispatch({ type: 'sent', id: head.id });
      await save();
      settle(head.id, delivery);
    }
    // A change queued meanwhile isn't tried in this run, so it waits too.
    if ((await afterSync(wasOffline)) === 'unreachable') {
      wentOffline();
      return;
    }
    // A change queued while the list was being read is sent by the run `sync` starts next.
    if (state.queue.length === 0) dispatch({ type: 'synced' });
  }

  let running: Promise<void> | null = null;
  let again = false;
  function sync(): Promise<void> {
    if (discardedWith) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      await ready;
      do {
        again = false;
        await flush();
      } while ((again || state.queue.length > 0) && state.status !== 'offline' && state.status !== 'waitingToRetry');
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function enqueue(change: C): Promise<ChangeOutcome> {
    await ready;
    if (discardedWith) return { status: 'refused', error: discardedWith };
    lastMadeAt = Math.max(now(), lastMadeAt + 1);
    const queued: QueuedChange<C> = {
      id: newId(),
      madeAt: new Date(lastMadeAt).toISOString(),
      change,
      serverFailures: 0,
      nextTryAt: null,
    };
    dispatch({ type: 'queued', change: queued });
    await save();
    const outcome = new Promise<ChangeOutcome>((resolve) => waiting.set(queued.id, resolve));
    // Offline, or behind a change waiting for its next try, already: say so now rather than after
    // another request times out. It's still tried.
    if (state.status === 'offline' || state.status === 'waitingToRetry') settle(queued.id, { status: 'queued' });
    void sync();
    return outcome;
  }

  return {
    ready,
    enqueue,
    sync,
    markUnreachable: () => dispatch({ type: 'unreachable' }),
    async withdraw(matches) {
      await ready;
      const ids = state.queue.filter(matches).map((c) => c.id);
      if (ids.length === 0) return;
      dispatch({ type: 'withdrawn', ids });
      await save();
      for (const id of ids) settle(id, { status: 'dropped' });
    },
    async discard(error) {
      await ready;
      discardedWith = error;
      dispatch({ type: 'discarded' });
      saving = saving.then(() => storage.removeItem(key)).catch(() => {});
      await saving;
      for (const id of [...waiting.keys()]) settle(id, { status: 'refused', error });
    },
    async dismissGaveUp() {
      await ready;
      dispatch({ type: 'dismissed' });
      await save();
    },
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
