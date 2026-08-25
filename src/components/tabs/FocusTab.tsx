import React, { useEffect, useState } from 'react';

export interface FocusQuestion {
  id: number;
  question: string;
  options: { key: string; text: string }[];
  correctKey: string;
  total: number;
  /** Which lecture subtopic this question checks (from the AI engine). */
  subtopic?: string;
  /** Shown after answering (from the AI engine). */
  explanation?: string;
}

interface FocusTabProps {
  /**
   * undefined → demo mode (built-in mock questions)
   * null      → live mode, no active quiz (idle "watching" state)
   * array     → live quiz from the engine
   */
  questions?: FocusQuestion[] | null;
  lectureProgress?: number;
  /** Called when the student finishes or skips a live quiz → resumes the video. */
  onComplete?: () => void;
  /** Engine status line shown while idle (model download %, listening state). */
  engineStatus?: string;
  /** Live mode: called when the student answers wrong → auto-creates a flashcard. */
  onWrongAnswer?: (q: FocusQuestion) => void;
  /** Small model dropdown rendered at the top of this tab. */
  modelPicker?: React.ReactNode;
}

const defaultQuestions: FocusQuestion[] = [
  {
    id: 1,
    total: 3,
    question: 'What is the primary purpose of the Fourier Transform in signal processing?',
    correctKey: 'A',
    subtopic: 'Fourier Transform',
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
    subtopic: 'Convolution Theorem',
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
    subtopic: 'Sampling Theorem',
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
  questions,
  lectureProgress = 0,
  onComplete,
  engineStatus,
  onWrongAnswer,
  modelPicker,
}) => {
  const liveMode = questions !== undefined;
  const activeQuestions = questions === undefined ? defaultQuestions : questions;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered');
  const [completed, setCompleted] = useState(false);
  const [score, setScore] = useState(0);

  // A new quiz arrived (or was cleared) — reset all progress.
  useEffect(() => {
    setCurrentIndex(0);
    setSelectedKey(null);
    setAnswerState('unanswered');
    setCompleted(false);
    setScore(0);
  }, [questions]);

  // ── Idle state: monitoring is on but no quiz is due ──
  if (liveMode && (activeQuestions === null || activeQuestions.length === 0)) {
    return (
      <div className="flex flex-col gap-4 h-full">
        {modelPicker}
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-[#00d4c8]/10 border border-[#00d4c8]/30 flex items-center justify-center text-3xl">
            👁️
          </div>
          <div>
            <p className="text-white font-semibold text-base">Watching the lecture with you</p>
            <p className="text-[#94a3b8] text-xs mt-2 leading-relaxed max-w-[240px]">
              Questions appear here automatically when a subtopic wraps up — keep watching.
            </p>
            {engineStatus && (
              <p className="text-[#00d4c8] text-[11px] mt-3 font-medium">{engineStatus}</p>
            )}
          </div>
        </div>
        <ProgressBar progress={lectureProgress} />
      </div>
    );
  }

  const q = activeQuestions![currentIndex];

  const handleSelect = (key: string) => {
    if (answerState !== 'unanswered') return;
    setSelectedKey(key);
    const correct = key === q.correctKey;
    setAnswerState(correct ? 'correct' : 'incorrect');
    if (correct) setScore(s => s + 1);
    else if (liveMode && onWrongAnswer) onWrongAnswer(q); // wrong → spaced-review card
  };

  const handleNext = () => {
    if (currentIndex < activeQuestions!.length - 1) {
      setCurrentIndex(i => i + 1);
      setSelectedKey(null);
      setAnswerState('unanswered');
    } else {
      setCompleted(true);
    }
  };

  const handleFinish = () => {
    if (onComplete) onComplete();
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setSelectedKey(null);
    setAnswerState('unanswered');
    setCompleted(false);
    setScore(0);
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

  // ── Completion screen ──
  if (completed) {
    return (
      <div className="flex flex-col gap-4 h-full">
        {modelPicker}
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-3xl">
            🎯
          </div>
          <div className="text-center">
            <p className="text-white font-semibold text-lg">
              {liveMode ? 'Checkpoint cleared' : 'Session Complete'}
            </p>
            <p className="text-[#94a3b8] text-sm mt-1">
              Score: <span className="text-[#00d4c8] font-semibold">{score}/{activeQuestions!.length}</span>
            </p>
          </div>
          {liveMode && onComplete ? (
            <button
              onClick={handleFinish}
              className="px-5 py-2.5 rounded-full bg-[#00d4c8] text-[#0a0f1e] text-sm font-semibold hover:bg-[#00b8ad] transition-colors"
            >
              Resume video ▶
            </button>
          ) : (
            <button
              onClick={handleReset}
              className="px-5 py-2.5 rounded-full bg-[#00d4c8] text-[#0a0f1e] text-sm font-semibold hover:bg-[#00b8ad] transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
        <ProgressBar progress={lectureProgress} />
      </div>
    );
  }

  // ── Active question ──
  return (
    <div className="flex flex-col gap-3 h-full">
      {modelPicker}
      {/* Pause banner */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#00d4c8]/10 border border-[#00d4c8]/25 rounded-xl">
        <span className="text-[#00d4c8] text-sm">⏸</span>
        <span className="text-[#00d4c8] text-xs font-medium">Lecture paused — Comprehension check</span>
      </div>

      {/* Question card */}
      <div className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-xs">
            Question {currentIndex + 1} of {activeQuestions!.length}
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

        {q.subtopic && (
          <span className="self-start px-2 py-0.5 rounded-full bg-[#3b82f6]/10 border border-[#3b82f6]/25 text-[#60a5fa] text-[10px] font-semibold tracking-wide">
            {q.subtopic}
          </span>
        )}

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

        {/* Explanation (from the AI engine) */}
        {answerState !== 'unanswered' && q.explanation && (
          <div className="px-3 py-2.5 rounded-lg bg-[#0a0f1e] border border-[#1e293b]">
            <p className="text-[#94a3b8] text-xs leading-relaxed">
              <span className={answerState === 'correct' ? 'text-emerald-400' : 'text-red-400'}>
                {answerState === 'correct' ? '✓ ' : '✗ '}
              </span>
              {q.explanation}
            </p>
          </div>
        )}
      </div>

      {/* Post-answer actions */}
      {answerState !== 'unanswered' && (
        <div className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-3 flex flex-col gap-2">
          <button
            onClick={handleNext}
            className="w-full px-2 py-2 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-xs font-semibold hover:bg-[#00b8ad] transition-colors"
          >
            {currentIndex < activeQuestions!.length - 1 ? 'Next question →' : 'Finish ✓'}
          </button>
        </div>
      )}

      {/* Skip escape hatch for live quizzes */}
      {liveMode && onComplete && (
        <button
          onClick={handleFinish}
          className="self-center text-[#94a3b8]/60 hover:text-[#94a3b8] text-[11px] underline transition-colors"
        >
          Skip quiz →
        </button>
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
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${progress}%`, background: 'linear-gradient(to right, #00d4c8, #3b82f6)' }}
      />
    </div>
  </div>
);

export default FocusTab;
