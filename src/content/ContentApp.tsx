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
import { getCurrentTime, getProgress } from './videoTracker';
import {
  loadLecture,
  saveLecture,
  loadCards,
  saveCards,
  makeCard,
  rateCard,
  dueLabel,
  getReviewDay,
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

const ContentApp: React.FC = () => {
  const [questions, setQuestions] = useState<FocusQuestion[] | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [engineStatus, setEngineStatus] = useState('');
  const [lecture, setLecture] = useState<LectureData | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [reviewDay, setReviewDay] = useState(1);
  const [quizWarning, setQuizWarning] = useState(false);
  const lastHrefRef = useRef(location.href);
  const warnTimerRef = useRef<number | null>(null);

  // Restore persisted data for this lecture + the global deck.
  useEffect(() => {
    loadLecture().then(setLecture);
    loadCards().then(setCards);
    getReviewDay().then(setReviewDay);
  }, []);

  useEffect(() => {
    // Persist the piggybacked engine outputs (summary bullets, concepts,
    // Gemini-suggested flashcards). Storage-first: always merge against the
    // freshest stored copy, never against possibly-stale component state.
    const applyEngineExtras = async (message: any) => {
      const bullets: string[] = Array.isArray(message.summaryBullets) ? message.summaryBullets : [];
      const concepts: string[] = Array.isArray(message.keyConcepts) ? message.keyConcepts : [];
      if (bullets.length || concepts.length) {
        const lec = await loadLecture();
        const nb = bullets.filter(b => b && !lec.summary.bullets.includes(b));
        const nc = concepts.filter(c => c && !lec.summary.concepts.includes(c));
        if (nb.length || nc.length) {
          lec.summary = {
            bullets: [...lec.summary.bullets, ...nb],
            concepts: [...lec.summary.concepts, ...nc],
            updatedAt: Date.now(),
          };
          await saveLecture(lec);
          setLecture({ ...lec });
        }
      }

      const fcs: { subtopic?: string; front?: string; back?: string }[] = Array.isArray(
        message.flashcards
      )
        ? message.flashcards
        : [];
      if (fcs.length) {
        const all = await loadCards();
        // One card per subtopic: dedupe on subtopic first, then on front text.
        const subtopics = new Set(all.map(c => (c.subtopic || '').toLowerCase()).filter(Boolean));
        const fronts = new Set(all.map(c => c.front));
        const added = fcs
          .filter(
            f =>
              f.front &&
              f.back &&
              !fronts.has(f.front) &&
              !(f.subtopic && subtopics.has(f.subtopic.toLowerCase()))
          )
          .map(f => makeCard(f.front as string, f.back as string, f.subtopic));
        if (added.length) {
          const merged = [...all, ...added];
          await saveCards(merged);
          setCards(merged);
        }
      }
    };

    const listener = (message: any) => {
      switch (message && message.type) {
        case 'MONITORING_STARTED':
          setMonitoring(true);
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
    chrome.runtime.onMessage.addListener(listener);

    // Poll playback progress + engine status. GET_STATUS also self-heals the
    // monitoring flag if this page loaded after monitoring started.
    const poll = window.setInterval(() => {
      // SPA navigation (YouTube next video): switch to the new lecture's data.
      if (location.href !== lastHrefRef.current) {
        lastHrefRef.current = location.href;
        loadLecture().then(setLecture);
        setQuestions(null);
      }
      const p = getProgress();
      if (p !== null) setProgress(p);
      try {
        chrome.runtime
          .sendMessage({ type: 'GET_STATUS' })
          .then((res: any) => {
            if (!res || !res.ok || !res.session) return;
            setMonitoring(!!res.activeHere);
            const w = res.session.whisper || {};
            setEngineStatus(
              w.status && w.status !== 'idle' && w.status !== 'stopped' ? w.detail || w.status : ''
            );
          })
          .catch(() => {});
      } catch {
        /* extension reloaded */
      }
    }, 2000);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(poll);
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
      const all = await loadCards();
      const sub = (q.subtopic || '').toLowerCase();
      const idx = sub ? all.findIndex(c => (c.subtopic || '').toLowerCase() === sub) : -1;
      if (idx >= 0) {
        all[idx] = { ...all[idx], intervalDays: 0, nextReview: Date.now() };
        await saveCards(all);
        setCards([...all]);
        return;
      }
      const front = q.subtopic ? `Explain: ${q.subtopic}` : q.question;
      if (all.some(c => c.front === front)) return;
      const correct = q.options.find(o => o.key === q.correctKey);
      const back =
        `${correct ? correct.text : ''}${q.explanation ? ` — ${q.explanation}` : ''}` ||
        'Revisit this part of the lecture.';
      const merged = [...all, makeCard(front, back, q.subtopic)];
      await saveCards(merged);
      setCards(merged);
    })();
  }, []);

  // ── Notes (persisted per lecture, tagged with the video position) ──
  const handleAddNote = useCallback((text: string) => {
    (async () => {
      const lec = await loadLecture();
      lec.notes = [
        { id: `${Date.now()}`, tSec: getCurrentTime(), text, createdAt: Date.now() },
        ...lec.notes,
      ];
      await saveLecture(lec);
      setLecture({ ...lec });
    })();
  }, []);

  const handleDeleteNote = useCallback((id: string) => {
    (async () => {
      const lec = await loadLecture();
      lec.notes = lec.notes.filter(n => n.id !== id);
      await saveLecture(lec);
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
      const all = await loadCards();
      const idx = all.findIndex(c => c.id === id);
      if (idx < 0) return;
      all[idx] = rateCard(all[idx], rating);
      await saveCards(all);
      setCards([...all]);
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
