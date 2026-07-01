import React, { useState } from 'react';

export interface SummaryData {
  title: string;
  bullets: string[];
  concepts: string[];
  generatedAt: string;
}

interface SummaryTabProps {
  data?: SummaryData;
}

const defaultData: SummaryData = {
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

const SummaryTab: React.FC<SummaryTabProps> = ({ data = defaultData }) => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = data.bullets.join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto scrollbar-thin pr-0.5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-[#00d4c8]" />
          <h3 className="text-white text-sm font-semibold">{data.title}</h3>
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

      {/* Summary bullets */}
      <div className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-0">
        {data.bullets.map((bullet, i) => (
          <div key={i} className="flex gap-3 py-3 border-b border-[#1e293b] last:border-b-0">
            <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#00d4c8] mt-2" />
            <button
              className="text-left text-[#94a3b8] text-xs leading-relaxed hover:text-white transition-colors w-full"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <span className={expanded === i ? 'text-white' : ''}>{bullet}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Key Concepts */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[#94a3b8] text-xs font-medium uppercase tracking-wider">Key Concepts</span>
          <div className="flex-1 h-px bg-[#1e293b]" />
        </div>
        <div className="flex flex-wrap gap-2">
          {data.concepts.map((concept, i) => (
            <ConceptBadge key={i} label={concept} index={i} />
          ))}
        </div>
      </div>

      {/* Quick stat strip */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Topics', value: data.concepts.length },
          { label: 'Key points', value: data.bullets.length },
          { label: 'Reading time', value: '~2m' },
        ].map(stat => (
          <div
            key={stat.label}
            className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-2.5 flex flex-col items-center gap-0.5"
          >
            <span className="text-white text-sm font-semibold">{stat.value}</span>
            <span className="text-[#94a3b8]/60 text-xs">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="text-[#94a3b8]/40 text-xs text-center pb-1">{data.generatedAt}</p>
    </div>
  );
};

const conceptColors = [
  'bg-[#00d4c8]/10 border-[#00d4c8]/25 text-[#00d4c8]',
  'bg-[#3b82f6]/10 border-[#3b82f6]/25 text-[#3b82f6]',
  'bg-[#8b5cf6]/10 border-[#8b5cf6]/25 text-[#8b5cf6]',
  'bg-[#f59e0b]/10 border-[#f59e0b]/25 text-[#f59e0b]',
];

const ConceptBadge: React.FC<{ label: string; index: number }> = ({ label, index }) => (
  <span
    className={`px-2.5 py-1 rounded-full border text-xs font-medium cursor-default hover:opacity-80 transition-opacity ${
      conceptColors[index % conceptColors.length]
    }`}
  >
    {label}
  </span>
);

export default SummaryTab;
