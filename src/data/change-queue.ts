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
 *
 * `nextQueueState` is the state machine, pure; `createChangeQueue` runs it.
 */
import { DataError } from './types';

/** A change made on this phone, waiting to be sent. `madeAt` is an ISO timestamp. */
export type QueuedChange<C> = { id: string; madeAt: string; change: C };

/**
 * `idle`: not sending, and the last request reached the server. `syncing`: sending the queue.
 * `offline`: the last request didn't reach the server; changes wait for the next try.
 */
export type QueueState<C> = {
  status: 'idle' | 'syncing' | 'offline';
  queue: readonly QueuedChange<C>[];
};

export type QueueEvent<C> =
  /** The changes saved on the phone, read back when the app starts. */
  | { type: 'restored'; queue: readonly QueuedChange<C>[] }
  | { type: 'queued'; change: QueuedChange<C> }
  | { type: 'syncStarted' }
  /** The server has the change, or has said it can never take it. */
  | { type: 'sent'; id: string }
  | { type: 'unreachable' }
  /** The queue is empty and the server was reached. */
  | { type: 'synced' }
  /** The changes are thrown away unsent, as when their user signs out. */
  | { type: 'discarded' };

export function nextQueueState<C>(state: QueueState<C>, event: QueueEvent<C>): QueueState<C> {
  switch (event.type) {
    case 'restored': {
      const restored = new Set(event.queue.map((c) => c.id));
      return { ...state, queue: [...event.queue, ...state.queue.filter((c) => !restored.has(c.id))] };
    }
    case 'queued':
      return state.queue.some((c) => c.id === event.change.id)
        ? state
        : { ...state, queue: [...state.queue, event.change] };
    case 'syncStarted':
      return { ...state, status: 'syncing' };
    case 'sent':
      return { ...state, queue: state.queue.filter((c) => c.id !== event.id) };
    case 'unreachable':
      return { ...state, status: 'offline' };
    case 'synced':
      return { ...state, status: 'idle' };
    case 'discarded':
      return { status: 'idle', queue: [] };
  }
}

/** What happened when a change was sent. */
export type Delivery =
  /** The server has it (it applied, or a later change to the item already had). */
  | { status: 'sent' }
  /** Its item is gone, so there's nothing to change. */
  | { status: 'dropped' }
  /** The server will never take it. */
  | { status: 'refused'; error: DataError }
  /** The request didn't reach the server. */
  | { status: 'unreachable' };

/** What the code that made a change hears back: how it was delivered, or that it's waiting. */
export type ChangeOutcome = Exclude<Delivery, { status: 'unreachable' }> | { status: 'queued' };

/** Where the phone keeps things between launches. AsyncStorage in the app. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The saved queue, skipping anything that isn't a change this app can send. */
function parseQueue<C>(raw: string | null, parseChange: (raw: unknown) => C | null): QueuedChange<C>[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const queue: QueuedChange<C>[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.madeAt !== 'string') continue;
    if (Number.isNaN(Date.parse(entry.madeAt))) continue;
    const change = parseChange(entry.change);
    if (change !== null) queue.push({ id: entry.id, madeAt: entry.madeAt, change });
  }
  return queue;
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
  /** Throws away every change waiting, unsent; whoever waits on one hears it's refused with `error`. */
  discard(error: DataError): Promise<void>;
  state(): QueueState<C>;
  subscribe(listener: (state: QueueState<C>) => void): () => void;
};

export function createChangeQueue<C>(options: {
  storage: KeyValueStorage;
  key: string;
  parseChange: (raw: unknown) => C | null;
  send: (change: QueuedChange<C>) => Promise<Delivery>;
  /** Runs before a sent change leaves the queue, so whoever shows it can keep showing it. */
  onDelivered: (change: QueuedChange<C>, delivery: Exclude<Delivery, { status: 'unreachable' }>) => void;
  /** Runs once the queue is empty, e.g. to read the list again. Says whether the server was reached. */
  afterSync: (wasOffline: boolean) => Promise<'reached' | 'unreachable'>;
  now: () => number;
  newId: () => string;
}): ChangeQueue<C> {
  const { storage, key, parseChange, send, onDelivered, afterSync, now, newId } = options;
  let state: QueueState<C> = { status: 'idle', queue: [] };
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

  // Saves run one after another, each writing the queue as it was when it was asked for.
  let saving: Promise<void> = Promise.resolve();
  function save(): Promise<void> {
    const snapshot = JSON.stringify(state.queue);
    saving = saving.then(() => storage.setItem(key, snapshot)).catch(() => {});
    return saving;
  }

  const ready = storage
    .getItem(key)
    .catch(() => null)
    .then((raw) => {
      const restored = parseQueue(raw, parseChange);
      lastMadeAt = Math.max(0, ...restored.map((c) => Date.parse(c.madeAt)));
      dispatch({ type: 'restored', queue: restored });
    });

  /** The server wasn't reached: whoever is waiting on a change hears it's queued. */
  function wentOffline() {
    dispatch({ type: 'unreachable' });
    for (const id of [...waiting.keys()]) settle(id, { status: 'queued' });
  }

  async function flush() {
    const wasOffline = state.status === 'offline';
    dispatch({ type: 'syncStarted' });
    for (let head = state.queue[0]; head; head = state.queue[0]) {
      let delivery: Delivery;
      try {
        delivery = await send(head);
      } catch (e) {
        delivery = {
          status: 'refused',
          error: e instanceof DataError ? e : new DataError('unknown', String(e), { cause: e }),
        };
      }
      if (delivery.status === 'unreachable') {
        wentOffline();
        return;
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
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      await ready;
      do {
        again = false;
        await flush();
      } while ((again || state.queue.length > 0) && state.status !== 'offline');
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function enqueue(change: C): Promise<ChangeOutcome> {
    await ready;
    lastMadeAt = Math.max(now(), lastMadeAt + 1);
    const queued: QueuedChange<C> = { id: newId(), madeAt: new Date(lastMadeAt).toISOString(), change };
    dispatch({ type: 'queued', change: queued });
    await save();
    const outcome = new Promise<ChangeOutcome>((resolve) => waiting.set(queued.id, resolve));
    // Offline already: say so now rather than after another request times out. It's still tried.
    if (state.status === 'offline') settle(queued.id, { status: 'queued' });
    void sync();
    return outcome;
  }

  return {
    ready,
    enqueue,
    sync,
    markUnreachable: () => dispatch({ type: 'unreachable' }),
    async discard(error) {
      await ready;
      dispatch({ type: 'discarded' });
      await save();
      for (const id of [...waiting.keys()]) settle(id, { status: 'refused', error });
    },
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
