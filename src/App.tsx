import React from 'react';
import Sidebar from './components/Sidebar';
import TargetCursor from './components/TargetCursor';
import MagicBento from './components/MagicBento';
import './index.css';

const MockVideoPlayer: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center gap-6 pr-[340px] min-h-screen"
    style={{ background: '#0a0f1e' }}
  >
    {/* Mock YouTube-like player */}
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
        {/* Pause overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,212,200,0.15)', border: '1px solid rgba(0,212,200,0.3)' }}
          >
            <span className="text-[#00d4c8] text-2xl ml-1">▶</span>
          </div>
          <p className="text-[#94a3b8] text-sm">Signal Processing — Chapter 4: Fourier Analysis</p>
        </div>

        {/* Mock video overlay labels */}
        <div className="absolute top-3 left-3">
          <span
            className="px-2 py-1 rounded-md text-xs font-medium"
            style={{ background: 'rgba(0,0,0,0.7)', color: '#94a3b8' }}
          >
            ⏸ 12:34 / 45:02
          </span>
        </div>
        <div className="absolute top-3 right-3">
          <span
            className="px-2 py-1 rounded-md text-xs font-medium"
            style={{ background: 'rgba(0,212,200,0.15)', color: '#00d4c8', border: '1px solid rgba(0,212,200,0.2)' }}
          >
            nupta tracking
          </span>
        </div>

        {/* Progress bar at bottom of video */}
        <div className="absolute bottom-0 left-0 right-0 h-1"
          style={{ background: '#1e293b' }}
        >
          <div className="h-full" style={{ width: '27%', background: '#00d4c8' }} />
        </div>
      </div>

      {/* Mock video info */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold text-base leading-snug">
            Signal Processing: Fourier Transform & Applications
          </h2>
          <p className="text-[#94a3b8] text-sm mt-1">Physics Wallah · 2.4M views · 3 months ago</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
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

      {/* Description placeholder */}
      <div
        className="mt-4 p-4 rounded-xl"
        style={{ background: '#0d1b2a', border: '1px solid #1e293b' }}
      >
        <p className="text-[#94a3b8] text-xs leading-relaxed">
          In this lecture we cover the fundamentals of the Fourier Transform, its applications in signal
          processing, the convolution theorem, and discrete-time signal analysis. Topics: Fourier series,
          DFT, FFT algorithm, Nyquist theorem, windowing functions...
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

const App: React.FC = () => {
  return (
    <div
      className="relative min-h-screen flex"
      style={{ background: '#0a0f1e' }}
    >
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
      />
    </div>
  );
};

export default App;
