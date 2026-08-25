// Tests for the persistence layer's pure logic and its write serialization.
// These run in plain Node — `chrome`, `location`, and `document` are stubbed
// below, so no browser environment (and no extra dependency) is needed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Stubs, installed before storage.ts is imported ──
let currentHref = 'https://www.youtube.com/watch?v=abc123';
const store: Record<string, unknown> = {};

vi.stubGlobal('location', {
  get search() { return new URL(currentHref).search; },
  get origin() { return new URL(currentHref).origin; },
  get pathname() { return new URL(currentHref).pathname; },
});
vi.stubGlobal('document', { title: 'Test Lecture' });
vi.stubGlobal('chrome', {
  storage: {
    local: {
      // Deliberately async: the write-serialization tests depend on there being
      // a real gap between read and write for a racing update to slip into.
      get: (key: string) =>
        new Promise(resolve => setTimeout(() => resolve({ [key]: store[key] }), 5)),
      set: (items: Record<string, unknown>) =>
        new Promise<void>(resolve =>
          setTimeout(() => { Object.assign(store, items); resolve(); }, 5)
        ),
    },
  },
});

const {
  videoKey,
  rateCard,
  dueLabel,
  makeCard,
  updateCards,
  updateLecture,
  loadCards,
} = await import('./storage');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  currentHref = 'https://www.youtube.com/watch?v=abc123';
});

describe('videoKey', () => {
  const keyFor = (href: string) => { currentHref = href; return videoKey(); };

  it('keys YouTube by the v param alone', () => {
    expect(keyFor('https://www.youtube.com/watch?v=abc123&t=42&list=PL9')).toBe(
      'https://www.youtube.com/watch?v=abc123'
    );
  });

  it('treats a share link as the same lecture as the plain link', () => {
    expect(keyFor('https://www.youtube.com/watch?v=abc123&si=xyz&pp=zzz')).toBe(
      keyFor('https://www.youtube.com/watch?v=abc123')
    );
  });

  it('keeps query params that identify the lecture on other platforms', () => {
    expect(keyFor('https://learn.edu/player?lecture=7&utm_source=mail')).toBe(
      'https://learn.edu/player?lecture=7'
    );
  });

  it('keeps two lectures served from one path distinct', () => {
    expect(keyFor('https://learn.edu/player?lecture=7')).not.toBe(
      keyFor('https://learn.edu/player?lecture=8')
    );
  });

  it('is insensitive to query param order', () => {
    expect(keyFor('https://learn.edu/p?a=1&b=2')).toBe(keyFor('https://learn.edu/p?b=2&a=1'));
  });
});

describe('rateCard (SM-2 lite)', () => {
  const card = (intervalDays: number) => makeCard('front', 'back', 'sub') && {
    ...makeCard('front', 'back', 'sub'), intervalDays,
  };

  it('promotes a new card to one day', () => {
    expect(rateCard(card(0), 'easy').intervalDays).toBe(1);
  });

  it('doubles the interval on "easy"', () => {
    expect(rateCard(card(4), 'easy').intervalDays).toBe(8);
  });

  it('caps the interval at 30 days', () => {
    expect(rateCard(card(20), 'easy').intervalDays).toBe(30);
  });

  it('resets to relearning on "hard" and re-queues within the hour', () => {
    const rated = rateCard(card(16), 'hard');
    expect(rated.intervalDays).toBe(0);
    expect(rated.nextReview - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe('dueLabel', () => {
  const at = (offset: number) => ({ ...makeCard('f', 'b'), nextReview: Date.now() + offset });

  it('marks an overdue card urgent', () => {
    expect(dueLabel(at(-DAY))).toEqual({ label: 'Due: Now', urgent: true });
  });

  it('marks a card due later today urgent', () => {
    expect(dueLabel(at(2 * 60 * 60 * 1000)).urgent).toBe(true);
  });

  it('does not mark tomorrow urgent', () => {
    expect(dueLabel(at(DAY + 60_000))).toEqual({ label: 'Due: Tomorrow', urgent: false });
  });

  it('counts whole days out for later cards', () => {
    expect(dueLabel(at(3 * DAY + 60_000)).label).toBe('Due: In 3 days');
  });

  it('never skips "Tomorrow" for a card exactly one day out', () => {
    // Regression: the old Math.ceil path made this branch unreachable.
    expect(dueLabel(at(DAY)).label).toBe('Due: Tomorrow');
    expect(dueLabel(at(2 * DAY - 1)).label).toBe('Due: Tomorrow');
  });
});

describe('write serialization', () => {
  it('does not lose concurrent card updates', async () => {
    // Without serialization all three read the empty deck and the last write wins.
    await Promise.all([
      updateCards(cards => [...cards, makeCard('a', 'A')]),
      updateCards(cards => [...cards, makeCard('b', 'B')]),
      updateCards(cards => [...cards, makeCard('c', 'C')]),
    ]);
    const fronts = (await loadCards()).map(c => c.front).sort();
    expect(fronts).toEqual(['a', 'b', 'c']);
  });

  it('does not lose concurrent note updates', async () => {
    await Promise.all([
      updateLecture(l => ({ ...l, notes: [...l.notes, { id: '1', tSec: 1, text: 'one', createdAt: 1 }] })),
      updateLecture(l => ({ ...l, notes: [...l.notes, { id: '2', tSec: 2, text: 'two', createdAt: 2 }] })),
    ]);
    const lecture = await updateLecture(l => l);
    expect(lecture.notes.map(n => n.id).sort()).toEqual(['1', '2']);
  });

  it('keeps the queue alive after a failing update', async () => {
    await expect(
      updateCards(() => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    // A later write must still go through rather than wedging behind the rejection.
    await updateCards(cards => [...cards, makeCard('after', 'A')]);
    expect((await loadCards()).map(c => c.front)).toEqual(['after']);
  });

  it('scopes cards to the lecture that generated them', async () => {
    currentHref = 'https://www.youtube.com/watch?v=lecture-one';
    await updateCards(cards => [...cards, makeCard('Define: Fourier', 'answer', 'Fourier Transform')]);
    currentHref = 'https://www.youtube.com/watch?v=lecture-two';
    await updateCards(cards => [...cards, makeCard('Define: Fourier', 'answer', 'Fourier Transform')]);

    const keys = (await loadCards()).map(c => c.videoKey);
    expect(new Set(keys).size).toBe(2); // same subtopic, two lectures, two cards
  });
});
