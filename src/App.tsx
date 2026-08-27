import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import type { FocusQuestion } from './components/tabs/FocusTab';
import TargetCursor from './components/TargetCursor';
import MagicBento from './components/MagicBento';
import ClickSpark from './components/ClickSpark';
import DotField from './components/DotField';
import './index.css';

const MockVideoPlayer: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center gap-6 min-h-screen py-10 z-10 relative"                 
  >                      
    {/* Real YouTube video player */}
    <div className="w-full max-w-3xl px-6">
      {/* Video container */}
      <div                   
        className="w-full rounded-2xl overflow-hidden relative"
        style={{                                               
          aspectRatio: '16/9',
          background: '#0d1b2a',
          border: '1px solid #1e293b',
        }}
      >
        <iframe
          src="https://www.youtube.com/embed/9R3-0-Xg_Ro?enablejsapi=1&rel=0"
          title="Introduction to Fourier Series"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>

      {/* Video info */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <a
            href="https://youtu.be/9R3-0-Xg_Ro?si=QIa5H8deVZ50o5lQ"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white hover:text-[#00d4c8] transition-colors font-semibold text-lg leading-snug flex items-center gap-2 group cursor-pointer"
          >
            Introduction to Fourier Series
            <span className="text-[#94a3b8] group-hover:text-[#00d4c8] text-sm transition-colors">↗</span>
          </a>
          <p className="text-[#94a3b8] text-sm mt-1">Neso Academy · 1.6M views · 5 years ago</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <a
            href="https://youtu.be/9R3-0-Xg_Ro?si=QIa5H8deVZ50o5lQ"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-full text-xs text-[#00d4c8] hover:text-white transition-colors flex items-center gap-1.5"
            style={{ background: 'rgba(0,212,200,0.1)', border: '1px solid rgba(0,212,200,0.3)' }}
          >
            <span>📺 Watch on YT</span>
          </a>
          {['👍 48K', '💾 Save', '↗ Share'].map(action => (
            <button
              key={action}
              className="px-3 py-1.5 rounded-full text-xs text-[#94a3b8] hover:text-white transition-colors"
              style={{ background: '#0d1b2a', border: '1px solid #1e293b' }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div
        className="mt-4 p-4 rounded-xl"
        style={{ background: '#0d1b2a', border: '1px solid #1e293b' }}
      >
        <p className="text-[#94a3b8] text-xs leading-relaxed">
          In this lecture we introduce the Fourier Series, a mathematical tool used to represent periodic signals 
          as a sum of sine and cosine components. We cover periodic signals, harmonics, Dirichlet conditions, 
          and discuss the fundamental differences between the Fourier Series and the Fourier Transform.
        </p>
      </div>

      {/* Bento grid section */}
      <div className="mt-8 mb-6 w-full">
        <h3 className="text-white text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-[#00d4c8] rounded-full" />
          Learning Platform Features
        </h3>
        <MagicBento 
          textAutoHide={true}
          enableStars={true}
          enableSpotlight={true}
          enableBorderGlow={true}
          enableTilt={true}
          enableMagnetism={true}
          clickEffect={true}
          spotlightRadius={250}
          particleCount={10}
          glowColor="0, 212, 200"
        />
      </div>

      {/* Nupta attribution note */}
      <div className="mt-6 flex items-center justify-center">
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(0,212,200,0.05)', border: '1px solid rgba(0,212,200,0.15)' }}
        >
          <span className="text-[#00d4c8] text-xs">✦</span>
          <span className="text-[#94a3b8] text-xs">
            <span className="text-[#00d4c8] font-medium">nupta</span> is active — click ⚡ Focus in the sidebar to answer comprehension questions
          </span>
        </div>
      </div>
    </div>
  </div>
);

// Demo simulation of a live quiz — in the real extension these questions come
// from the engine (Whisper transcript → Gemini) via QUIZ_READY messages.
const demoQuizQuestions: FocusQuestion[] = [
  {
    id: 1,
    total: 2,
    subtopic: 'Fourier Series basics',
    question: 'Why is the Fourier Series used for periodic signals?',
    correctKey: 'A',
    explanation: 'The lecturer explained that periodic signals can be expanded into sinusoidal harmonics that are orthogonal to one another.',
    options: [
      { key: 'A', text: 'To expand them in terms of sinusoidal, orthogonal harmonics' },
      { key: 'B', text: 'To compress them for storage' },
      { key: 'C', text: 'To convert them into aperiodic signals' },
      { key: 'D', text: 'To amplify their fundamental frequency' },
    ],
  },
  {
    id: 2,
    total: 2,
    subtopic: 'Harmonics & frequency',
    question: 'If a periodic signal has period T seconds, what is its fundamental frequency?',
    correctKey: 'C',
    explanation: 'One cycle takes T seconds, so the signal completes 1/T cycles per second — the fundamental frequency.',
    options: [
      { key: 'A', text: 'T cycles per second' },
      { key: 'B', text: '2T cycles per second' },
      { key: 'C', text: '1/T cycles per second' },
      { key: 'D', text: 'T² cycles per second' },
    ],
  },
];

const App: React.FC = () => {
  // null = idle ("watching the lecture"), array = active quiz — same states the
  // extension drives. Finishing or skipping the demo quiz returns to idle.
  const [quiz, setQuiz] = useState<FocusQuestion[] | null>(demoQuizQuestions);
  return (
    <ClickSpark
      sparkColor="#00d4c8"
      sparkSize={12}
      sparkRadius={20}
      sparkCount={10}
      duration={500}
    >
      <div
        className="relative min-h-screen flex overflow-hidden"
        style={{ background: '#0a0f1e' }}
      >
        {/* Interactive background dot grid */}
        <DotField
          className="absolute inset-0 z-0 pointer-events-none"
          dotRadius={1.5}
          dotSpacing={14}
          bulgeStrength={67}
          glowRadius={160}
          sparkle={true}
          waveAmplitude={0}
          gradientFrom="rgba(0, 212, 200, 0.25)"
          gradientTo="rgba(139, 92, 246, 0.12)"
          glowColor="#0a121e"
        />
        <TargetCursor 
          targetSelector=".cursor-target"
          cursorColorOnTarget="#00d4c8"
          cursorColor="#94a3b8"
          hideDefaultCursor={true}
        />
        <MockVideoPlayer />
        <Sidebar
          defaultOpen={true}
          lectureTitle="Signal Processing — Chapter 4"
          lectureDetected={true}
          spacedReviewDay={3}
          focusQuestions={quiz}
          onQuizComplete={() => setQuiz(null)}
          lectureProgress={42}
        />
      </div>
    </ClickSpark>
  );
};

export default App;
