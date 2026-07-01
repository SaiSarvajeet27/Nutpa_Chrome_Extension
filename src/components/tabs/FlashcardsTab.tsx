import React, { useState } from 'react';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  dueLabel?: string;
  dueColor?: string;
}

interface FlashcardsTabProps {
  cards?: Flashcard[];
}

const defaultCards: Flashcard[] = [
  {
    id: '1',
    front: 'Define: Fourier Transform',
    back: 'A mathematical transform that decomposes a function (signal) into its constituent frequency components. Represented as F(ω) = ∫ f(t)e^{−iωt} dt.',
    dueLabel: 'Due: Today',
    dueColor: 'text-amber-400',
  },
  {
    id: '2',
    front: 'What is Convolution Theorem?',
    back: 'Convolution in the time domain equals multiplication in the frequency domain: f(t) * g(t) ↔ F(ω)·G(ω). This drastically simplifies signal filtering.',
    dueLabel: 'Due: Tomorrow',
    dueColor: 'text-[#94a3b8]',
  },
  {
    id: '3',
    front: 'State the Nyquist Theorem',
    back: 'To faithfully reconstruct a continuous signal from samples, the sampling frequency must be at least twice the highest frequency in the signal (f_s ≥ 2f_max).',
    dueLabel: 'Due: In 2 days',
    dueColor: 'text-[#94a3b8]',
  },
  {
    id: '4',
    front: 'What is the DFT?',
    back: 'The Discrete Fourier Transform converts a finite sequence of samples into a frequency-domain representation. Computed efficiently using FFT in O(n log n) time.',
    dueLabel: 'Due: In 3 days',
    dueColor: 'text-[#94a3b8]',
  },
  {
    id: '5',
    front: 'What is a Transfer Function?',
    back: 'The ratio of output to input in the frequency domain, H(ω) = Y(ω)/X(ω). Describes the frequency response characteristics of a linear time-invariant system.',
    dueLabel: 'Due: In 5 days',
    dueColor: 'text-[#94a3b8]',
  },
];

type Confidence = 'easy' | 'hard' | null;

const FlashcardsTab: React.FC<FlashcardsTabProps> = ({ cards = defaultCards }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<string, Confidence>>({});
  const [completed, setCompleted] = useState(false);

  const card = cards[currentIndex];

  const handleFlip = () => setIsFlipped(f => !f);

  const handleNav = (dir: 'prev' | 'next') => {
    setIsFlipped(false);
    setTimeout(() => {
      if (dir === 'prev' && currentIndex > 0) setCurrentIndex(i => i - 1);
      if (dir === 'next') {
        if (currentIndex < cards.length - 1) setCurrentIndex(i => i + 1);
        else setCompleted(true);
      }
    }, 150);
  };

  const handleRate = (conf: Confidence) => {
    if (!card) return;
    setRatings(r => ({ ...r, [card.id]: conf }));
    handleNav('next');
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setRatings({});
    setCompleted(false);
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
          <p className="text-[#94a3b8] text-sm mt-1">{cards.length} cards reviewed</p>
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
        <button
          onClick={handleReset}
          className="px-5 py-2.5 rounded-full bg-[#8b5cf6] text-white text-sm font-semibold hover:bg-[#7c3aed] transition-colors"
        >
          Study Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Card count badge */}
      <div className="flex items-center justify-between">
        <span className="text-[#94a3b8] text-xs">
          Card{' '}
          <span className="text-white font-medium">{currentIndex + 1}</span>{' '}
          of{' '}
          <span className="text-white font-medium">{cards.length}</span>
        </span>
        {card.dueLabel && (
          <span className={`text-xs font-medium ${card.dueColor}`}>
            ⏰ {card.dueLabel}
          </span>
        )}
      </div>

      {/* 3D Flashcard */}
      <div
        className="card-scene cursor-pointer select-none"
        style={{ height: '180px' }}
        onClick={handleFlip}
      >
        <div className={`card-inner ${isFlipped ? 'flipped' : ''}`}>
          {/* Front */}
          <div className="card-front w-full h-full">
            <div className="w-full h-full bg-[#0d1b2a] border border-[#8b5cf6]/30 rounded-2xl p-5 flex flex-col justify-between shadow-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/25 text-[#8b5cf6] text-xs font-medium">
                  Question
                </span>
              </div>
              <p className="text-white text-sm font-medium leading-relaxed">{card.front}</p>
              <p className="text-[#94a3b8]/50 text-xs">Tap to flip →</p>
            </div>
          </div>

          {/* Back */}
          <div className="card-back w-full h-full">
            <div className="w-full h-full bg-[#0d1b2a] border border-[#00d4c8]/30 rounded-2xl p-5 flex flex-col justify-between shadow-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-[#00d4c8]/15 border border-[#00d4c8]/25 text-[#00d4c8] text-xs font-medium">
                  Answer
                </span>
              </div>
              <p className="text-[#94a3b8] text-xs leading-relaxed">{card.back}</p>
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
      <div className="flex items-center justify-center gap-1.5">
        {cards.map((c, i) => {
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

      {/* Due info strip */}
      <div className="mt-auto bg-[#0d1b2a] border border-[#1e293b] rounded-xl px-3 py-2.5 flex items-center justify-between">
        <span className="text-[#94a3b8] text-xs">Spaced repetition</span>
        <span className="text-[#8b5cf6] text-xs font-medium">
          {Object.keys(ratings).length}/{cards.length} reviewed
        </span>
      </div>
    </div>
  );
};

export default FlashcardsTab;
