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

/** Stable identity for the current lecture (YouTube: keyed by the v param). */
export function videoKey(): string {
  const v = new URLSearchParams(location.search).get('v');
  return v
    ? `${location.origin}${location.pathname}?v=${v}`
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
  const diff = card.nextReview - Date.now();
  if (diff <= 0) return { label: 'Due: Now', urgent: true };
  if (diff < 24 * 60 * 60 * 1000) return { label: 'Due: Today', urgent: true };
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return { label: 'Due: Tomorrow', urgent: false };
  return { label: `Due: In ${days} days`, urgent: false };
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
