// ContentApp.tsx — top-frame React root for the injected nupta widget.
// Bridges the extension engine (background/offscreen) to the Sidebar UI:
// quizzes into the Focus tab, per-lecture notes and live summary into their
// tabs, and a spaced-repetition flashcard deck — all persisted locally.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../components/Sidebar';
import type { FocusQuestion } from '../components/tabs/FocusTab';
import type { Note } from '../components/tabs/NotesTab';
import type { SummaryData } from '../components/tabs/SummaryTab';
import type { Flashcard as UICard } from '../components/tabs/FlashcardsTab';
import type { SettingsState } from '../components/ModelPicker';
import { getCurrentTime, getProgress } from './videoTracker';
import {
  loadLecture,
  loadCards,
  updateCards,
  updateLecture,
  makeCard,
  rateCard,
  dueLabel,
  getReviewDay,
  videoKey,
} from './storage';
import type { LectureData, Flashcard } from './storage';

interface EngineQuestion {
  subtopic?: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
}

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

function toFocusQuestions(raw: EngineQuestion[]): FocusQuestion[] {
  return raw.map((q, i) => ({
    id: i + 1,
    total: raw.length,
    subtopic: q.subtopic,
    explanation: q.explanation,
    question: q.question,
    correctKey: KEYS[q.answerIndex] ?? 'A',
    options: q.options.slice(0, KEYS.length).map((text, oi) => ({ key: KEYS[oi], text })),
  }));
}

function fmtTime(t: number | null | undefined): string {
  if (t == null || !isFinite(t)) return '—';
  const s = Math.floor(t % 60);
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** How often the widget asks the engine for status while monitoring this tab. */
const ACTIVE_POLL_MS = 2000;
/**
 * The content script is injected into every page, so an idle tab must cost
 * next to nothing. But a freshly injected script may have MISSED the pushed
 * MONITORING_STARTED — that's exactly the case where the user is staring at the
 * page waiting for the ball. So start responsive and back off geometrically:
 * a just-loaded script finds an active session in ~2s, while a tab left open on
 * some unrelated site settles at one cheap check every 30s.
 */
const IDLE_POLL_START_MS = 2000;
const IDLE_POLL_MAX_MS = 30000;
const IDLE_BACKOFF = 1.6;

/**
 * Whisper states worth putting on screen. Everything else — `ready`,
 * `capturing`, `idle`, `stopped` — means the engine is working as intended and
 * needs no commentary.
 */
const ENGINE_STATUS_SHOWN = new Set(['loading-model', 'error']);

const ContentApp: React.FC = () => {
  const [questions, setQuestions] = useState<FocusQuestion[] | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [engineStatus, setEngineStatus] = useState('');
  const [lecture, setLecture] = useState<LectureData | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [reviewDay, setReviewDay] = useState(1);
  const [quizWarning, setQuizWarning] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState | null>(null);
  const lastHrefRef = useRef(location.href);
  const warnTimerRef = useRef<number | null>(null);
  // Playback position reported by whichever frame owns the <video>; used when
  // the player sits in an iframe and this frame's tracker has no video.
  const remoteTimeRef = useRef<number | null>(null);

  // Restore persisted data for this lecture + the global deck.
  useEffect(() => {
    loadLecture().then(setLecture);
    loadCards().then(setCards);
    getReviewDay().then(setReviewDay);
  }, []);

  useEffect(() => {
    // Assigned once the poll loop below is defined; lets pushed messages pull
    // the next status check forward instead of waiting out the idle interval.
    let pollNow = () => {};

    // Persist the piggybacked engine outputs (summary bullets, concepts,
    // Gemini-suggested flashcards). Storage-first: always merge against the
    // freshest stored copy, never against possibly-stale component state.
    const applyEngineExtras = async (message: any) => {
      const bullets: string[] = Array.isArray(message.summaryBullets) ? message.summaryBullets : [];
      const concepts: string[] = Array.isArray(message.keyConcepts) ? message.keyConcepts : [];
      if (bullets.length || concepts.length) {
        const lec = await updateLecture(cur => {
          const nb = bullets.filter(b => b && !cur.summary.bullets.includes(b));
          const nc = concepts.filter(c => c && !cur.summary.concepts.includes(c));
          if (!nb.length && !nc.length) return cur;
          return {
            ...cur,
            summary: {
              bullets: [...cur.summary.bullets, ...nb],
              concepts: [...cur.summary.concepts, ...nc],
              updatedAt: Date.now(),
            },
          };
        });
        setLecture({ ...lec });
      }

      const fcs: { subtopic?: string; front?: string; back?: string }[] = Array.isArray(
        message.flashcards
      )
        ? message.flashcards
        : [];
      // Auto-notes: one note per point, tagged to its subtopic and stamped with
      // the position the lecture had reached. They land in the same list as the
      // student's own notes but stay visually distinct.
      const aiNotes: { subtopic?: string; points?: string[] }[] = Array.isArray(message.aiNotes)
        ? message.aiNotes
        : [];
      if (aiNotes.length) {
        const tSec = getCurrentTime() ?? remoteTimeRef.current;
        const lec = await updateLecture(cur => {
          const existing = new Set(cur.notes.map(n => n.text));
          const fresh = aiNotes.flatMap(n =>
            (n.points || [])
              .filter(p => p && !existing.has(p))
              .map((p, i) => ({
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`,
                tSec,
                text: p,
                createdAt: Date.now(),
                ai: true,
                subtopic: n.subtopic || undefined,
              }))
          );
          return fresh.length ? { ...cur, notes: [...fresh, ...cur.notes] } : cur;
        });
        setLecture({ ...lec });
      }

      if (fcs.length) {
        const merged = await updateCards(all => {
          const thisLecture = videoKey();
          // One card per subtopic, scoped to THIS lecture — two courses may both
          // cover "Fourier Transform" and each deserves its own card.
          const mine = all.filter(c => c.videoKey === thisLecture);
          const subtopics = new Set(mine.map(c => (c.subtopic || '').toLowerCase()).filter(Boolean));
          const fronts = new Set(mine.map(c => c.front));
          const added = fcs
            .filter(
              f =>
                f.front &&
                f.back &&
                !fronts.has(f.front) &&
                !(f.subtopic && subtopics.has(f.subtopic.toLowerCase()))
            )
            .map(f => makeCard(f.front as string, f.back as string, f.subtopic));
          return added.length ? [...all, ...added] : all;
        });
        setCards(merged);
      }
    };

    const listener = (message: any) => {
      switch (message && message.type) {
        case 'MONITORING_STARTED':
          setMonitoring(true);
          pollNow(); // switch from the idle cadence to the active one at once
          break;
        case 'MONITORING_STOPPED':
          setMonitoring(false);
          setQuestions(null);
          setQuizWarning(false);
          if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
          break;
        case 'QUIZ_READY':
          if (Array.isArray(message.questions) && message.questions.length > 0) {
            // Heads-up phase: the ball pulses amber for a few seconds while the
            // video keeps playing — then pause + expand + show the quiz.
            const qs = toFocusQuestions(message.questions);
            if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
            setQuizWarning(true);
            warnTimerRef.current = window.setTimeout(() => {
              warnTimerRef.current = null;
              setQuizWarning(false);
              setQuestions(qs);
              try { chrome.runtime.sendMessage({ type: 'PAUSE_VIDEO' }).catch(() => {}); } catch { /* ignore */ }
              // Open the panel on the Focus tab (hook built into Sidebar).
              window.dispatchEvent(
                new CustomEvent('open-sidebar-tab', { detail: { tabId: 'focus' } })
              );
            }, 4000);
          }
          applyEngineExtras(message);
          break;
        case 'QUIZ_ERROR':
          console.warn('[nupta] quiz generation failed:', message.error);
          break;
      }
    };
    // GET_STATUS also self-heals the monitoring flag if this page loaded after
    // monitoring started, and carries the video position reported by whichever
    // frame owns the player.
    let cancelled = false;
    const checkStatus = () =>
      new Promise<boolean>(resolve => {
        try {
          chrome.runtime
            .sendMessage({ type: 'GET_STATUS' })
            .then((res: any) => {
              if (cancelled || !res || !res.ok || !res.session) return resolve(false);
              const active = !!res.activeHere;
              setMonitoring(active);
              const w = res.session.whisper || {};
              // Only surface states the student can do something about — model
              // download progress, and failures. "ready" and "capturing" are
              // just "everything is fine", and showing them left a permanent
              // "Whisper ready (WebGPU)" sitting under the panel for the whole
              // lecture. Silence is the healthy state.
              const whisperLine = ENGINE_STATUS_SHOWN.has(w.status) ? w.detail || w.status : '';
              // A hard failure outranks a degradation notice, which outranks
              // model-loading progress.
              setEngineStatus(res.session.lastError || res.session.notice || whisperLine);
              const v = res.session.video || {};
              remoteTimeRef.current = typeof v.time === 'number' ? v.time : null;
              if (typeof v.progress === 'number') setProgress(v.progress);
              resolve(active);
            })
            .catch(() => resolve(false));
        } catch {
          resolve(false); // extension reloaded
        }
      });

    // Self-rescheduling poll: fast while this tab is monitored, near-idle
    // otherwise, so the widget costs nothing on the other tabs it's injected into.
    let timer = 0;
    let running = false;
    let idleDelay = IDLE_POLL_START_MS;
    const tick = async () => {
      // A poll is already in flight — it will reschedule itself, and starting a
      // second loop here would leave two running against one `timer`.
      if (running) return;
      running = true;
      try {
        // SPA navigation (YouTube next video): switch to the new lecture's data.
        if (location.href !== lastHrefRef.current) {
          lastHrefRef.current = location.href;
          loadLecture().then(setLecture);
          setQuestions(null);
        }
        // A video in this frame is authoritative; otherwise GET_STATUS filled in.
        const p = getProgress();
        if (p !== null) setProgress(p);

        const active = await checkStatus();
        if (cancelled) return;
        // Reset the backoff on every active tick, so stopping and restarting
        // monitoring finds the ball quickly again.
        if (active) idleDelay = IDLE_POLL_START_MS;
        else idleDelay = Math.min(idleDelay * IDLE_BACKOFF, IDLE_POLL_MAX_MS);
        timer = window.setTimeout(tick, active ? ACTIVE_POLL_MS : idleDelay);
      } finally {
        running = false;
      }
    };

    // Bring the next poll forward — used when a pushed message tells us the
    // session changed and the idle cadence would otherwise lag 30s behind.
    pollNow = () => {
      clearTimeout(timer);
      tick();
    };

    chrome.runtime.onMessage.addListener(listener);
    tick();

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };
  }, []);

  const handleStopMonitoring = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: 'STOP_MONITORING' }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  // ── Model selection + key status for the per-tab dropdowns ──
  // Read-only as far as secrets go: SETTINGS_GET returns which providers are
  // configured, never their keys, so nothing secret lives in this component.
  const refreshSettings = useCallback(() => {
    try {
      chrome.runtime
        .sendMessage({ type: 'SETTINGS_GET' })
        .then((res: any) => {
          if (!res || !res.ok) return setSettingsState(null);
          setSettingsState({
            settings: res.settings,
            catalog: res.catalog,
            configured: res.configured || [],
            bundled: res.bundled || {},
            transcribers: res.transcribers || [],
          });
        })
        .catch(() => setSettingsState(null));
    } catch {
      setSettingsState(null);
    }
  }, []);

  useEffect(() => {
    if (monitoring) refreshSettings();
  }, [monitoring, refreshSettings]);

  // Re-read after the keys screen may have changed things, so a key added in
  // another tab unlocks the dropdowns here without a reload.
  useEffect(() => {
    const onFocus = () => { if (monitoring) refreshSettings(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [monitoring, refreshSettings]);

  // One transcription engine for the whole session — not per feature.
  const handleChangeTranscriber = useCallback((id: string) => {
    setSettingsState(prev => {
      if (!prev) return prev;
      const settings = { ...prev.settings, transcription: { model: id } };
      try {
        chrome.runtime.sendMessage({ type: 'SETTINGS_SAVE', settings }).catch(() => {});
      } catch { /* extension reloaded */ }
      return { ...prev, settings };
    });
  }, []);

  const handleChangeModel = useCallback(
    (featureId: string, model: string | null) => {
      setSettingsState(prev => {
        if (!prev) return prev;
        const cur = prev.settings.features[featureId];
        // A null model means "off"; keep the last model so turning it back on
        // returns to what the student had chosen rather than the default.
        const nextFeature = model === null
          ? { ...cur, enabled: false }
          : { model, enabled: true };
        const settings = {
          ...prev.settings,
          features: { ...prev.settings.features, [featureId]: nextFeature },
        };
        try {
          chrome.runtime.sendMessage({ type: 'SETTINGS_SAVE', settings }).catch(() => {});
        } catch { /* extension reloaded */ }
        return { ...prev, settings };
      });
    },
    []
  );

  const rpc = useCallback(async (type: string, payload: Record<string, unknown> = {}) => {
    const res: any = await chrome.runtime.sendMessage({ type, ...payload });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Request failed.');
    return res;
  }, []);

  const handleSaveKey = useCallback(
    async (provider: string, apiKey: string) => {
      // Verified with the provider before storing, so a bad paste fails here
      // rather than silently in the middle of a lecture.
      await rpc('KEY_VERIFY', { provider, apiKey });
      await rpc('KEY_SET', { provider, apiKey });
      refreshSettings(); // newly usable models unlock in every dropdown
    },
    [rpc, refreshSettings]
  );

  const handleRemoveKey = useCallback(
    async (provider: string) => {
      await rpc('KEY_SET', { provider, apiKey: '' });
      refreshSettings();
    },
    [rpc, refreshSettings]
  );

  const handleQuizComplete = useCallback(() => {
    setQuestions(null);
    try {
      chrome.runtime.sendMessage({ type: 'RESUME_VIDEO' }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  // Wrong quiz answer → that subtopic's flashcard becomes due immediately.
  // (Cards stay independent of quiz questions; a wrong answer just means the
  // subtopic needs review NOW. If no card exists yet, create one for it.)
  const handleWrongAnswer = useCallback((q: FocusQuestion) => {
    (async () => {
      const merged = await updateCards(all => {
        const thisLecture = videoKey();
        const sub = (q.subtopic || '').toLowerCase();
        // Match within this lecture only; an identically-named subtopic from a
        // different course is a different card.
        const idx = sub
          ? all.findIndex(c => c.videoKey === thisLecture && (c.subtopic || '').toLowerCase() === sub)
          : -1;
        if (idx >= 0) {
          const next = [...all];
          next[idx] = { ...next[idx], intervalDays: 0, nextReview: Date.now() };
          return next;
        }
        const front = q.subtopic ? `Explain: ${q.subtopic}` : q.question;
        if (all.some(c => c.videoKey === thisLecture && c.front === front)) return all;
        const correct = q.options.find(o => o.key === q.correctKey);
        const back =
          `${correct ? correct.text : ''}${q.explanation ? ` — ${q.explanation}` : ''}`.trim() ||
          'Revisit this part of the lecture.';
        return [...all, makeCard(front, back, q.subtopic)];
      });
      setCards(merged);
    })();
  }, []);

  // ── Notes (persisted per lecture, tagged with the video position) ──
  const handleAddNote = useCallback((text: string) => {
    (async () => {
      // getCurrentTime() only sees a video in THIS frame; for an embedded
      // player fall back to the position the owning frame reported.
      const tSec = getCurrentTime() ?? remoteTimeRef.current;
      const lec = await updateLecture(cur => ({
        ...cur,
        notes: [
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tSec, text, createdAt: Date.now() },
          ...cur.notes,
        ],
      }));
      setLecture({ ...lec });
    })();
  }, []);

  const handleDeleteNote = useCallback((id: string) => {
    (async () => {
      const lec = await updateLecture(cur => ({
        ...cur,
        notes: cur.notes.filter(n => n.id !== id),
      }));
      setLecture({ ...lec });
    })();
  }, []);

  const handleSeekNote = useCallback((tSec: number) => {
    try {
      chrome.runtime.sendMessage({ type: 'SEEK_VIDEO', time: tSec }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  // ── Flashcards (SM-2 lite scheduling, persisted globally) ──
  const handleRateCard = useCallback((id: string, rating: 'easy' | 'hard') => {
    (async () => {
      const next = await updateCards(all => {
        const idx = all.findIndex(c => c.id === id);
        if (idx < 0) return all;
        const updated = [...all];
        updated[idx] = rateCard(updated[idx], rating);
        return updated;
      });
      setCards(next);
    })();
  }, []);

  const uiNotes: Note[] = useMemo(
    () =>
      lecture
        ? lecture.notes.map(n => ({
            id: n.id,
            timestamp: fmtTime(n.tSec),
            tSec: n.tSec,
            text: n.text,
            ai: n.ai,
            subtopic: n.subtopic,
          }))
        : [],
    [lecture]
  );

  const uiSummary: SummaryData = useMemo(
    () => ({
      title: 'Lecture Summary',
      bullets: lecture ? lecture.summary.bullets : [],
      concepts: lecture ? lecture.summary.concepts : [],
      generatedAt: 'Live — updates at each checkpoint',
    }),
    [lecture]
  );

  const uiCards: UICard[] = useMemo(
    () =>
      [...cards]
        .sort((a, b) => a.nextReview - b.nextReview)
        .map(c => {
          const d = dueLabel(c);
          return {
            id: c.id,
            front: c.front,
            back: c.back,
            subtopic: c.subtopic,
            dueLabel: d.label,
            dueColor: d.urgent ? 'text-amber-400' : 'text-[#94a3b8]',
          };
        }),
    [cards]
  );

  // The ball (and panel) only exist while this tab is being monitored.
  if (!monitoring) return null;

  return (
    <Sidebar
      defaultOpen={false}
      lectureTitle={document.title}
      lectureDetected={monitoring}
      spacedReviewDay={reviewDay}
      focusQuestions={questions}
      quizPending={quizWarning || (!!questions && questions.length > 0)}
      onQuizComplete={handleQuizComplete}
      onWrongAnswer={handleWrongAnswer}
      onStopMonitoring={handleStopMonitoring}
      settingsState={settingsState}
      onChangeModel={handleChangeModel}
      onSaveKey={handleSaveKey}
      onRemoveKey={handleRemoveKey}
      onChangeTranscriber={handleChangeTranscriber}
      lectureProgress={progress}
      engineStatus={engineStatus}
      notes={uiNotes}
      onAddNote={handleAddNote}
      onDeleteNote={handleDeleteNote}
      onSeekNote={handleSeekNote}
      summaryData={uiSummary}
      cards={uiCards}
      onRateCard={handleRateCard}
    />
  );
};

export default ContentApp;
