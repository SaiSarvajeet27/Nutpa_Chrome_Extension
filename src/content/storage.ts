// storage.ts — persistence for notes, summaries, and flashcards using
// chrome.storage.local: free, on-device, no backend, survives restarts.
// Lecture data (notes + summary) is keyed per video; the flashcard deck and
// review streak are global.

export interface LectureNote {
  id: string;
  /** Seconds into the video when the note was taken (null = unknown). */
  tSec: number | null;
  text: string;
  createdAt: number;
  /** Written by the auto-notes feature rather than typed by the student. */
  ai?: boolean;
  /** Subtopic an AI note belongs to (grouping + dedupe). */
  subtopic?: string;
}

export interface LectureSummary {
  bullets: string[];
  concepts: string[];
  updatedAt: number;
}

export interface LectureData {
  title: string;
  lastWatched: number;
  notes: LectureNote[];
  summary: LectureSummary;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** Lecture subtopic this card belongs to (one card per subtopic). */
  subtopic?: string;
  videoKey: string;
  videoTitle: string;
  /** Current spaced-repetition interval in days (0 = new/relearning). */
  intervalDays: number;
  /** Epoch ms when the card is next due. */
  nextReview: number;
  createdAt: number;
}

// Params that identify a *visit* rather than a lecture. Keeping them would give
// the same video a new identity on every share link, splitting its notes.
const NOISE_PARAMS = /^(utm_|fbclid$|gclid$|si$|feature$|ref$|ref_src$|t$|start$|list$|index$|pp$)/i;

/**
 * Stable identity for the current lecture. YouTube is keyed by its `v` param;
 * elsewhere the path plus any meaningful query params, since plenty of course
 * platforms serve every lecture from one path and vary only the query string.
 */
export function videoKey(): string {
  const params = new URLSearchParams(location.search);
  const v = params.get('v');
  if (v) return `${location.origin}${location.pathname}?v=${v}`;

  const meaningful = [...params.entries()]
    .filter(([k]) => !NOISE_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b)) // param order must not change identity
    .map(([k, val]) => `${k}=${val}`)
    .join('&');
  return meaningful
    ? `${location.origin}${location.pathname}?${meaningful}`
    : `${location.origin}${location.pathname}`;
}

const lectureStorageKey = (k: string) => `nupta:lecture:${k}`;
const CARDS_KEY = 'nupta:cards';
const META_KEY = 'nupta:meta';

async function storageGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const o = await chrome.storage.local.get(key);
    return (o && (o as Record<string, T>)[key]) ?? fallback;
  } catch {
    return fallback;
  }
}

async function storageSet(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    /* storage unavailable — degrade gracefully */
  }
}

function emptyLecture(): LectureData {
  return {
    title: document.title,
    lastWatched: Date.now(),
    notes: [],
    summary: { bullets: [], concepts: [], updatedAt: 0 },
  };
}

export async function loadLecture(): Promise<LectureData> {
  const d = await storageGet<Partial<LectureData>>(lectureStorageKey(videoKey()), {});
  const base = emptyLecture();
  return {
    ...base,
    ...d,
    notes: Array.isArray(d.notes) ? (d.notes as LectureNote[]) : [],
    summary: { ...base.summary, ...(d.summary || {}) },
  };
}

export async function saveLecture(data: LectureData): Promise<void> {
  await storageSet(lectureStorageKey(videoKey()), {
    ...data,
    title: document.title,
    lastWatched: Date.now(),
  });
}

export async function loadCards(): Promise<Flashcard[]> {
  return storageGet<Flashcard[]>(CARDS_KEY, []);
}

export async function saveCards(cards: Flashcard[]): Promise<void> {
  await storageSet(CARDS_KEY, cards);
}

/**
 * Serializes read-modify-write cycles against chrome.storage.
 *
 * Two quick actions — answering a second question wrong, deleting a note while
 * a checkpoint lands — would otherwise both read the old value and the second
 * write would silently discard the first. Every mutation queues behind the last.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(job: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(job, job);
  // Keep the chain alive even if one job rejects.
  writeQueue = next.catch(() => {});
  return next;
}

/** Atomically read, transform, and persist the flashcard deck. */
export function updateCards(
  fn: (cards: Flashcard[]) => Flashcard[] | Promise<Flashcard[]>
): Promise<Flashcard[]> {
  return serialize(async () => {
    const next = await fn(await loadCards());
    await saveCards(next);
    return next;
  });
}

/** Atomically read, transform, and persist this lecture's notes + summary. */
export function updateLecture(
  fn: (lecture: LectureData) => LectureData | Promise<LectureData>
): Promise<LectureData> {
  return serialize(async () => {
    const next = await fn(await loadLecture());
    await saveLecture(next);
    return next;
  });
}

export function makeCard(front: string, back: string, subtopic?: string): Flashcard {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    front,
    back,
    subtopic,
    videoKey: videoKey(),
    videoTitle: document.title,
    intervalDays: 0,
    nextReview: Date.now(), // new cards are due immediately
    createdAt: Date.now(),
  };
}

/**
 * SM-2 lite: "Got it" doubles the interval (1 → 2 → 4 … capped at 30 days);
 * "Hard" resets the card and re-queues it in 30 minutes.
 */
export function rateCard(card: Flashcard, rating: 'easy' | 'hard'): Flashcard {
  if (rating === 'easy') {
    const nextInterval = card.intervalDays === 0 ? 1 : Math.min(card.intervalDays * 2, 30);
    return {
      ...card,
      intervalDays: nextInterval,
      nextReview: Date.now() + nextInterval * 24 * 60 * 60 * 1000,
    };
  }
  return { ...card, intervalDays: 0, nextReview: Date.now() + 30 * 60 * 1000 };
}

export function dueLabel(card: Flashcard): { label: string; urgent: boolean } {
  const DAY = 24 * 60 * 60 * 1000;
  const diff = card.nextReview - Date.now();
  if (diff <= 0) return { label: 'Due: Now', urgent: true };
  if (diff < DAY) return { label: 'Due: Today', urgent: true };
  // Anything past 24h used to fall through to Math.ceil, which returns 2 for
  // even a hair over a day — so "Tomorrow" was unreachable and a card one day
  // out read as "In 2 days". Bracket the day explicitly instead.
  if (diff < 2 * DAY) return { label: 'Due: Tomorrow', urgent: false };
  return { label: `Due: In ${Math.floor(diff / DAY)} days`, urgent: false };
}

/** Day counter since first use ("Spaced review: Day N"). */
export async function getReviewDay(): Promise<number> {
  const meta = await storageGet<{ firstUse?: number }>(META_KEY, {});
  if (!meta.firstUse) {
    await storageSet(META_KEY, { firstUse: Date.now() });
    return 1;
  }
  return Math.floor((Date.now() - meta.firstUse) / (24 * 60 * 60 * 1000)) + 1;
}
