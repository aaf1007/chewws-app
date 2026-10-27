// The offline queue on its own (src/data/change-queue.ts), for what the data-layer tests can't
// reach: a send that throws, as a bug in it would.
import { afterEach, expect, test, vi } from 'vitest';

import { createChangeQueue, memoryStorage } from '../src/data/change-queue';

afterEach(() => {
  vi.restoreAllMocks();
});

type Change = { item: string };

const parseChange = (raw: unknown): Change | null =>
  typeof raw === 'object' && raw !== null && 'item' in raw && typeof raw.item === 'string' ? { item: raw.item } : null;

test('a send that throws unexpectedly gives its change up with the notice, saved, and logs it; the changes behind it are sent', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const storage = memoryStorage();
  const sent: string[] = [];
  let ids = 0;
  const queue = createChangeQueue<Change>({
    storage,
    key: 'changes',
    parseChange,
    async send({ change }) {
      if (change.item === 'Foil') throw new TypeError('a bug while sending');
      sent.push(change.item);
      return { status: 'sent' };
    },
    nameOf: ({ change }) => change.item,
    onDelivered: () => {},
    afterSync: async () => 'reached',
    now: () => 1_000,
    newId: () => `change-${(ids += 1)}`,
  });

  const [foil, towels] = await Promise.all([queue.enqueue({ item: 'Foil' }), queue.enqueue({ item: 'Paper towels' })]);

  expect(foil).toMatchObject({ status: 'refused', error: { code: 'unknown' } });
  expect(towels).toEqual({ status: 'sent' });
  expect(sent).toEqual(['Paper towels']);
  await queue.sync();
  expect(queue.state()).toMatchObject({
    status: 'idle',
    queue: [],
    gaveUp: [{ change: { item: 'Foil' }, name: 'Foil' }],
  });
  expect(JSON.parse((await storage.getItem('changes')) ?? 'null')).toMatchObject({
    queue: [],
    gaveUp: [{ change: { item: 'Foil' }, name: 'Foil' }],
  });
  expect(logged).toHaveBeenCalledWith(expect.stringContaining('Foil'), expect.any(TypeError));
});
