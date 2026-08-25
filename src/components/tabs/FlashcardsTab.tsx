import React, { useEffect, useState } from 'react';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** Lecture subtopic this card covers (one card per subtopic). */
  subtopic?: string;
  dueLabel?: string;
  dueColor?: string;
}

interface FlashcardsTabProps {
  /** Live mode: deck built from lecture quizzes, spaced-repetition scheduled. */
  cards?: Flashcard[];
  /** Reports a rating so the parent reschedules the card (SM-2 lite). */
  onRate?: (id: string, rating: 'easy' | 'hard') => void;
  /** Small model dropdown rendered at the top of this tab. */
  modelPicker?: React.ReactNode;
}

const demoCards: Flashcard[] = [
  {
    id: '1',
    subtopic: 'Fourier Transform',
    front: 'Define: Fourier Transform',
    back: 'A mathematical transform that decomposes a function (signal) into its constituent frequency components. Represented as F(ω) = ∫ f(t)e^{−iωt} dt.',
    dueLabel: 'Due: Today',
    dueColor: 'text-amber-400',
  },
  {
    id: '2',
    subtopic: 'Convolution',
    front: 'What is Convolution Theorem?',
    back: 'Convolution in the time domain equals multiplication in the frequency domain: f(t) * g(t) ↔ F(ω)·G(ω). This drastically simplifies signal filtering.',
    dueLabel: 'Due: Tomorrow',
    dueColor: 'text-[#94a3b8]',
  },
  {
    id: '3',
    subtopic: 'Sampling',
    front: 'State the Nyquist Theorem',
    back: 'To faithfully reconstruct a continuous signal from samples, the sampling frequency must be at least twice the highest frequency in the signal (f_s ≥ 2f_max).',
    dueLabel: 'Due: In 2 days',
    dueColor: 'text-[#94a3b8]',
  },
];

type Confidence = 'easy' | 'hard' | null;

const FlashcardsTab: React.FC<FlashcardsTabProps> = ({ cards, onRate, modelPicker }) => {
  const live = cards !== undefined;

  // The review session works on a stable snapshot: in live mode ratings
  // reschedule cards (deck reorders), which must not shuffle the session.
  const [session, setSession] = useState<Flashcard[] | null>(live ? null : demoCards);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<string, Confidence>>({});
  const [completed, setCompleted] = useState(false);

  // Live mode: start a session as soon as cards exist, then keep it in step
  // with the deck. New cards are APPENDED rather than the session being
  // replaced by the (re-sorted) deck, so the student's current card and
  // position never jump — while cards generated later in the lecture still
  // show up. Without this the session froze at whatever the deck held when
  // the very first card arrived.
  useEffect(() => {
    if (!live || !cards || cards.length === 0) return;
    setSession(prev => {
      if (prev === null) return cards;
      const byId = new Map(cards.map(c => [c.id, c]));
      // Ratings reschedule cards, so refresh due labels in place.
      let changed = false;
      const synced = prev.map(c => {
        const latest = byId.get(c.id);
        if (latest && (latest.dueLabel !== c.dueLabel || latest.dueColor !== c.dueColor)) {
          changed = true;
          return { ...c, dueLabel: latest.dueLabel, dueColor: latest.dueColor };
        }
        return c;
      });
      const known = new Set(prev.map(c => c.id));
      const fresh = cards.filter(c => !known.has(c.id));
      if (fresh.length) return [...synced, ...fresh];
      return changed ? synced : prev;
    });
  }, [live, cards]);

  const startSession = () => {
    setSession(live ? (cards && cards.length > 0 ? cards : null) : demoCards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setRatings({});
    setCompleted(false);
  };

  // Live mode with no cards yet: explain how the deck grows.
  if (!session || session.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {modelPicker}
        <div className="flex flex-col items-center justify-center gap-4 flex-1 py-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#8b5cf6]/15 border border-[#8b5cf6]/30 flex items-center justify-center text-3xl">
          🃏
        </div>
        <div>
          <p className="text-white font-semibold text-base">Your deck builds itself</p>
          <p className="text-[#94a3b8] text-xs mt-2 leading-relaxed max-w-[240px]">
            Every quiz adds study cards automatically — and questions you get wrong come back here for spaced review.
          </p>
        </div>
        </div>
      </div>
    );
  }

  const card = session[Math.min(currentIndex, session.length - 1)];

  const handleFlip = () => setIsFlipped(f => !f);

  const handleNav = (dir: 'prev' | 'next') => {
    setIsFlipped(false);
    setTimeout(() => {
      if (dir === 'prev' && currentIndex > 0) setCurrentIndex(i => i - 1);
      if (dir === 'next') {
        if (currentIndex < session.length - 1) setCurrentIndex(i => i + 1);
        else setCompleted(true);
      }
    }, 150);
  };

  const handleRate = (conf: Confidence) => {
    if (!card || !conf) return;
    setRatings(r => ({ ...r, [card.id]: conf }));
    if (live && onRate) onRate(card.id, conf); // parent reschedules + persists
    handleNav('next');
  };

  if (completed) {
    const easy = Object.values(ratings).filter(v => v === 'easy').length;
    const hard = Object.values(ratings).filter(v => v === 'hard').length;
    return (
      <div className="flex flex-col items-center justify-center gap-5 h-full py-4">
        <div className="w-16 h-16 rounded-2xl bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 flex items-center justify-center text-3xl">
          🃏
        </div>
        <div className="text-center">
          <p className="text-white font-semibold text-lg">Review Complete!</p>
          <p className="text-[#94a3b8] text-sm mt-1">{session.length} cards reviewed</p>
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-emerald-400 text-xl font-bold">{easy}</p>
            <p className="text-[#94a3b8] text-xs">Got it</p>
          </div>
          <div className="w-px bg-[#1e293b]" />
          <div className="text-center">
            <p className="text-red-400 text-xl font-bold">{hard}</p>
            <p className="text-[#94a3b8] text-xs">Review again</p>
          </div>
        </div>
        {live && (
          <p className="text-[#94a3b8]/60 text-[11px] text-center max-w-[220px] leading-relaxed">
            "Got it" pushes a card further out (1 → 2 → 4 days…); "Hard" brings it back in 30 minutes.
          </p>
        )}
        <button
          onClick={startSession}
          className="px-5 py-2.5 rounded-full bg-[#8b5cf6] text-white text-sm font-semibold hover:bg-[#7c3aed] transition-colors"
        >
          Study Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {modelPicker}
      {/* Card count badge */}
      <div className="flex items-center justify-between">
        <span className="text-[#94a3b8] text-xs">
          Card <span className="text-white font-medium">{currentIndex + 1}</span> of{' '}
          <span className="text-white font-medium">{session.length}</span>
        </span>
        {card.dueLabel && (
          <span className={`text-xs font-medium ${card.dueColor || 'text-[#94a3b8]'}`}>⏰ {card.dueLabel}</span>
        )}
      </div>

      {/* 3D Flashcard */}
      <div className="card-scene cursor-pointer select-none" style={{ height: '180px' }} onClick={handleFlip}>
        <div className={`card-inner ${isFlipped ? 'flipped' : ''}`}>
          <div className="card-front w-full h-full">
            <div className="w-full h-full bg-[#0d1b2a] border border-[#8b5cf6]/30 rounded-2xl p-5 flex flex-col justify-between shadow-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/25 text-[#8b5cf6] text-xs font-medium">
                  Question
                </span>
                {card.subtopic && (
                  <span className="px-2 py-0.5 rounded-full bg-[#3b82f6]/10 border border-[#3b82f6]/25 text-[#60a5fa] text-[10px] font-medium">
                    {card.subtopic}
                  </span>
                )}
              </div>
              <p className="text-white text-sm font-medium leading-relaxed">{card.front}</p>
              <p className="text-[#94a3b8]/50 text-xs">Tap to flip →</p>
            </div>
          </div>
          <div className="card-back w-full h-full">
            <div className="w-full h-full bg-[#0d1b2a] border border-[#00d4c8]/30 rounded-2xl p-5 flex flex-col justify-between shadow-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-[#00d4c8]/15 border border-[#00d4c8]/25 text-[#00d4c8] text-xs font-medium">
                  Answer
                </span>
              </div>
              <p className="text-[#94a3b8] text-xs leading-relaxed overflow-y-auto scrollbar-thin">{card.back}</p>
              <p className="text-[#94a3b8]/50 text-xs">Tap again to flip back ←</p>
            </div>
          </div>
        </div>
      </div>

      {/* Rating buttons (shown after flip) */}
      {isFlipped ? (
        <div className="flex gap-2">
          <button
            onClick={() => handleRate('hard')}
            className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
          >
            😓 Hard
          </button>
          <button
            onClick={() => handleRate('easy')}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
          >
            ✓ Got it
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => handleNav('prev')}
            disabled={currentIndex === 0}
            className="flex-1 py-2.5 rounded-xl bg-[#0d1b2a] border border-[#1e293b] text-[#94a3b8] text-xs font-medium hover:text-white hover:border-[#94a3b8]/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={() => handleNav('next')}
            className="flex-1 py-2.5 rounded-xl bg-[#0d1b2a] border border-[#1e293b] text-[#94a3b8] text-xs font-medium hover:text-white hover:border-[#94a3b8]/30 transition-colors"
          >
            Skip →
          </button>
        </div>
      )}

      {/* Dot indicators */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        {session.map((c, i) => {
          const r = ratings[c.id];
          return (
            <button
              key={c.id}
              onClick={() => {
                setIsFlipped(false);
                setTimeout(() => setCurrentIndex(i), 150);
              }}
              className={`rounded-full transition-all duration-200 ${
                i === currentIndex
                  ? 'w-5 h-2 bg-[#8b5cf6]'
                  : r === 'easy'
                  ? 'w-2 h-2 bg-emerald-500/60'
                  : r === 'hard'
                  ? 'w-2 h-2 bg-red-500/60'
                  : 'w-2 h-2 bg-[#1e293b]'
              }`}
            />
          );
        })}
      </div>

      {/* Review progress strip */}
      <div className="mt-auto bg-[#0d1b2a] border border-[#1e293b] rounded-xl px-3 py-2.5 flex items-center justify-between">
        <span className="text-[#94a3b8] text-xs">Spaced repetition</span>
        <span className="text-[#8b5cf6] text-xs font-medium">
          {Object.keys(ratings).length}/{session.length} reviewed
        </span>
      </div>
    </div>
  );
};

export default FlashcardsTab;
