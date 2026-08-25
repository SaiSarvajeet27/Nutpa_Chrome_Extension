import React, { useState } from 'react';

export interface SummaryData {
  title: string;
  bullets: string[];
  concepts: string[];
  generatedAt: string;
}

interface SummaryTabProps {
  /** Live mode: summary built by the engine, growing at each checkpoint. */
  data?: SummaryData;
  /** Small model dropdown rendered at the top of this tab. */
  modelPicker?: React.ReactNode;
}

const demoData: SummaryData = {
  title: 'Lecture Summary',
  bullets: [
    'The Fourier Transform converts a time-domain signal into its frequency-domain representation, enabling analysis of constituent sinusoidal components.',
    'Convolution in the time domain is equivalent to multiplication in the frequency domain — a key insight that simplifies many signal processing problems.',
    'The Nyquist-Shannon theorem states that accurate reconstruction requires sampling at a rate of at least twice the highest signal frequency.',
    'Discrete signals use the DFT (Discrete Fourier Transform), computed efficiently using the FFT algorithm with O(n log n) complexity.',
  ],
  concepts: ['Fourier Transform', 'Signal Processing', 'Frequency Domain', 'Convolution', 'Nyquist Theorem', 'FFT'],
  generatedAt: 'Generated at end of lecture',
};

const SummaryTab: React.FC<SummaryTabProps> = ({ data, modelPicker }) => {
  const live = data !== undefined;
  const summary = data ?? demoData;
  const [copied, setCopied] = useState(false);

  const wordCount = summary.bullets.join(' ').split(/\s+/).filter(Boolean).length;
  const readingMin = Math.max(1, Math.round(wordCount / 200));

  const handleCopy = () => {
    navigator.clipboard.writeText(summary.bullets.join('\n\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Live mode before the first checkpoint: explain how the summary works.
  if (live && summary.bullets.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {modelPicker}
        <div className="flex flex-col items-center justify-center gap-4 flex-1 py-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#00d4c8]/10 border border-[#00d4c8]/30 flex items-center justify-center text-3xl">
          📝
        </div>
        <div>
          <p className="text-white font-semibold text-base">Summary builds itself</p>
          <p className="text-[#94a3b8] text-xs mt-2 leading-relaxed max-w-[240px]">
            Key points are added automatically every time a subtopic completes. Keep watching — this page fills up on its own.
          </p>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto scrollbar-thin pr-0.5">
      {modelPicker}
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-[#00d4c8]" />
          <h3 className="text-white text-sm font-semibold">{summary.title}</h3>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0a0f1e] border border-[#1e293b] text-[#94a3b8] text-xs hover:text-white hover:border-[#94a3b8]/30 transition-colors"
        >
          {copied ? (
            <>
              <span className="text-emerald-400">✓</span>
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <span>⎘</span>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Bullets */}
      <ul className="flex flex-col gap-2.5">
        {summary.bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 bg-[#0d1b2a] border border-[#1e293b] rounded-xl px-3 py-2.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4c8] mt-1.5 flex-shrink-0" />
            <span className="text-[#cbd5e1] text-xs leading-relaxed">{b}</span>
          </li>
        ))}
      </ul>

      {/* Concept chips */}
      {summary.concepts.length > 0 && (
        <div>
          <p className="text-[#94a3b8] text-[10px] font-semibold tracking-widest uppercase mb-2">Key concepts</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.concepts.map(c => (
              <span
                key={c}
                className="px-2.5 py-1 rounded-full bg-[#00d4c8]/10 border border-[#00d4c8]/25 text-[#00d4c8] text-[11px] font-medium"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stats — computed from the actual content */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { value: String(summary.concepts.length), label: 'Concepts' },
          { value: String(summary.bullets.length), label: 'Key points' },
          { value: `~${readingMin}m`, label: 'Reading time' },
        ].map(s => (
          <div
            key={s.label}
            className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl px-2 py-2.5 text-center"
          >
            <p className="text-white text-sm font-bold">{s.value}</p>
            <p className="text-[#94a3b8] text-[10px] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <p className="text-[#94a3b8]/50 text-[10px] text-center">{summary.generatedAt}</p>
    </div>
  );
};

export default SummaryTab;
