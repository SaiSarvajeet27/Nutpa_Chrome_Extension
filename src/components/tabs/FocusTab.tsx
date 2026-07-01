import React, { useState } from 'react';

export interface FocusQuestion {
  id: number;
  question: string;
  options: { key: string; text: string }[];
  correctKey: string;
  total: number;
}

interface FocusTabProps {
  questions?: FocusQuestion[];
  lectureProgress?: number;
}

const defaultQuestions: FocusQuestion[] = [
  {
    id: 1,
    total: 3,
    question: 'What is the primary purpose of the Fourier Transform in signal processing?',
    correctKey: 'A',
    options: [
      { key: 'A', text: 'Convert signals from time domain to frequency domain' },
      { key: 'B', text: 'Amplify weak electrical signals' },
      { key: 'C', text: 'Remove noise from digital images' },
      { key: 'D', text: 'Compress audio files for storage' },
    ],
  },
  {
    id: 2,
    total: 3,
    question: 'In signal processing, what does convolution in the time domain correspond to in the frequency domain?',
    correctKey: 'B',
    options: [
      { key: 'A', text: 'Addition of frequency components' },
      { key: 'B', text: 'Multiplication of frequency spectra' },
      { key: 'C', text: 'Subtraction of phase angles' },
      { key: 'D', text: 'Division of amplitudes' },
    ],
  },
  {
    id: 3,
    total: 3,
    question: 'Which of the following best describes the Nyquist-Shannon sampling theorem?',
    correctKey: 'C',
    options: [
      { key: 'A', text: 'Signals must be sampled at exactly their frequency' },
      { key: 'B', text: 'Sampling rate should equal the signal frequency' },
      { key: 'C', text: 'Sampling rate must be at least twice the highest frequency' },
      { key: 'D', text: 'Signals can be sampled at any rate without information loss' },
    ],
  },
];

type AnswerState = 'unanswered' | 'correct' | 'incorrect';

const FocusTab: React.FC<FocusTabProps> = ({
  questions = defaultQuestions,
  lectureProgress = 42,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered');
  const [completed, setCompleted] = useState(false);

  const q = questions[currentIndex];

  const handleSelect = (key: string) => {
    if (answerState !== 'unanswered') return;
    setSelectedKey(key);
    setAnswerState(key === q.correctKey ? 'correct' : 'incorrect');
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
      setSelectedKey(null);
      setAnswerState('unanswered');
    } else {
      setCompleted(true);
    }
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setSelectedKey(null);
    setAnswerState('unanswered');
    setCompleted(false);
  };

  const getOptionStyle = (key: string): string => {
    const base =
      'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all duration-200 flex items-start gap-3 group';
    if (answerState === 'unanswered') {
      return `${base} border-[#1e293b] bg-[#0a0f1e] text-[#94a3b8] hover:border-[#00d4c8]/50 hover:text-white hover:bg-[#00d4c8]/5 cursor-pointer`;
    }
    if (key === q.correctKey) {
      return `${base} border-emerald-500/60 bg-emerald-500/10 text-emerald-300`;
    }
    if (key === selectedKey && key !== q.correctKey) {
      return `${base} border-red-500/60 bg-red-500/10 text-red-300`;
    }
    return `${base} border-[#1e293b] bg-[#0a0f1e] text-[#94a3b8]/50 cursor-default`;
  };

  const getKeyBadge = (key: string): string => {
    const base = 'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-bold mt-0.5';
    if (answerState === 'unanswered') {
      return `${base} bg-[#1e293b] text-[#94a3b8] group-hover:bg-[#00d4c8]/20 group-hover:text-[#00d4c8]`;
    }
    if (key === q.correctKey) return `${base} bg-emerald-500 text-white`;
    if (key === selectedKey) return `${base} bg-red-500 text-white`;
    return `${base} bg-[#1e293b] text-[#94a3b8]/50`;
  };

  if (completed) {
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-3xl">
            🎯
          </div>
          <div className="text-center">
            <p className="text-white font-semibold text-lg">Session Complete</p>
            <p className="text-[#94a3b8] text-sm mt-1">All {questions.length} questions answered</p>
          </div>
          <button
            onClick={handleReset}
            className="px-5 py-2.5 rounded-full bg-[#00d4c8] text-[#0a0f1e] text-sm font-semibold hover:bg-[#00b8ad] transition-colors"
          >
            Try Again
          </button>
        </div>
        <ProgressBar progress={lectureProgress} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Pause banner */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#00d4c8]/10 border border-[#00d4c8]/25 rounded-xl">
        <span className="text-[#00d4c8] text-sm">⏸</span>
        <span className="text-[#00d4c8] text-xs font-medium">Lecture paused — Comprehension check</span>
      </div>

      {/* Question card */}
      <div className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-xs">
            Question {currentIndex + 1} of {q.total}
          </span>
          {answerState !== 'unanswered' && (
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                answerState === 'correct'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {answerState === 'correct' ? '✓ Correct' : '✗ Incorrect'}
            </span>
          )}
        </div>

        <p className="text-white text-sm font-medium leading-relaxed">{q.question}</p>

        <div className="flex flex-col gap-2">
          {q.options.map(opt => (
            <button
              key={opt.key}
              className={getOptionStyle(opt.key)}
              onClick={() => handleSelect(opt.key)}
            >
              <span className={getKeyBadge(opt.key)}>{opt.key}</span>
              <span className="leading-snug pt-px">{opt.text}</span>
              {answerState !== 'unanswered' && opt.key === q.correctKey && (
                <span className="ml-auto text-emerald-400 flex-shrink-0">✓</span>
              )}
              {answerState !== 'unanswered' && opt.key === selectedKey && opt.key !== q.correctKey && (
                <span className="ml-auto text-red-400 flex-shrink-0">✗</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Post-answer actions */}
      {answerState !== 'unanswered' && (
        <div className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-3 flex flex-col gap-2">
          <p className="text-[#94a3b8] text-xs mb-1">What would you like to do next?</p>
          <div className="flex gap-2 flex-wrap">
            <button className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] text-xs font-medium hover:bg-[#3b82f6]/20 transition-colors">
              📚 Revise Concept
            </button>
            <button
              onClick={handleNext}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-xs font-semibold hover:bg-[#00b8ad] transition-colors"
            >
              {currentIndex < questions.length - 1 ? 'Next →' : 'Finish ✓'}
            </button>
          </div>
          <button className="w-full px-2 py-2 rounded-lg bg-[#0a0f1e] border border-[#1e293b] text-[#94a3b8] text-xs hover:text-white hover:border-[#94a3b8]/40 transition-colors">
            ☕ Take a Break
          </button>
        </div>
      )}

      <div className="mt-auto">
        <ProgressBar progress={lectureProgress} />
      </div>
    </div>
  );
};

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => (
  <div className="flex flex-col gap-1.5 pt-1">
    <div className="flex items-center justify-between">
      <span className="text-[#94a3b8] text-xs">Lecture progress</span>
      <span className="text-[#00d4c8] text-xs font-medium">{progress}%</span>
    </div>
    <div className="h-1.5 bg-[#1e293b] rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-[#00d4c8] to-[#3b82f6] rounded-full transition-all duration-700"
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);

export default FocusTab;
