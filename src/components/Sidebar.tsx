import React, { useState } from 'react';
import FocusTab from './tabs/FocusTab';
import NotesTab from './tabs/NotesTab';
import SummaryTab from './tabs/SummaryTab';
import FlashcardsTab from './tabs/FlashcardsTab';
import GooeyNav from './GooeyNav';
import logoImg from '../assets/logo.png';

type TabId = 'focus' | 'notes' | 'summary' | 'cards';

export interface SidebarProps {
  defaultOpen?: boolean;
  lectureTitle?: string;
  lectureDetected?: boolean;
  spacedReviewDay?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  defaultOpen = true,
  lectureTitle = 'Signal Processing — Chapter 4',
  lectureDetected = true,
  spacedReviewDay = 3,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TabId>('focus');

  return (
    <>
      {/* Backdrop blur overlay when open on narrow screens */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{ backdropFilter: 'none' }}
        />
      )}

      {/* Sidebar container */}
      <div
        className={`fixed top-0 right-0 h-screen z-[9999] flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: '340px' }}
      >
        {/* Toggle tab — sticks out to the left */}
        <button
          onClick={() => setIsOpen(o => !o)}
          className="toggle-glow absolute -left-9 top-[50%] -translate-y-1/2 flex items-center justify-center w-9 h-14 rounded-l-xl bg-[#0d1b2a] border border-r-0 border-[#00d4c8]/30 text-[#00d4c8] hover:bg-[#00d4c8]/10 transition-all duration-200 shadow-2xl"
          aria-label={isOpen ? 'Close Nupta sidebar' : 'Open Nupta sidebar'}
        >
          <span className="text-sm font-bold select-none">
            {isOpen ? '›' : 'N'}
          </span>
        </button>

        {/* Main panel */}
        <div
          className="flex flex-col h-full border-l shadow-2xl overflow-hidden"
          style={{
            background: '#0a0f1e',
            borderColor: 'rgba(0, 212, 200, 0.2)',
          }}
        >
          {/* Header */}
          <SidebarHeader />

          {/* Tab bar */}
          <div className="flex-shrink-0 px-3 py-2">
            <GooeyNav
              items={[
                { label: 'Focus', href: '#' },
                { label: 'Notes', href: '#' },
                { label: 'Summary', href: '#' },
                { label: 'Cards', href: '#' }
              ]}
              activeIndex={['focus', 'notes', 'summary', 'cards'].indexOf(activeTab)}
              onChange={(index) => {
                const tabs: TabId[] = ['focus', 'notes', 'summary', 'cards'];
                setActiveTab(tabs[index]);
              }}
              animationTime={300}
              particleCount={12}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 min-h-0">
            {activeTab === 'focus' && <FocusTab />}
            {activeTab === 'notes' && <NotesTab />}
            {activeTab === 'summary' && <SummaryTab />}
            {activeTab === 'cards' && <FlashcardsTab />}
          </div>

          {/* Bottom status bar */}
          <BottomBar
            lectureDetected={lectureDetected}
            lectureTitle={lectureTitle}
            spacedReviewDay={spacedReviewDay}
          />
        </div>
      </div>
    </>
  );
};

/* ─── Sub-components ─── */

const SidebarHeader: React.FC = () => (
  <div className="flex-shrink-0 px-4 pt-4 pb-3">
    <div className="flex items-center justify-between">
      {/* Logo */}
      <div>
        <div className="flex items-center gap-2.5">
          <img src={logoImg} alt="nupta labs" className="h-[22px] object-contain" />
          <span
            className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
            style={{ background: 'rgba(0,212,200,0.1)', color: '#00d4c8', border: '1px solid rgba(0,212,200,0.2)' }}
          >
            BETA
          </span>
        </div>
        <p className="text-[#94a3b8] text-[10px] font-medium tracking-widest uppercase mt-0.5">
          Learning Intelligence
        </p>
      </div>

      {/* Live dot */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
          style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' }}
        >
          <div
            className="pulse-dot w-1.5 h-1.5 rounded-full"
            style={{ background: '#10b981' }}
          />
          <span className="text-emerald-400 text-[10px] font-semibold tracking-wide">ACTIVE</span>
        </div>
      </div>
    </div>

    {/* Divider */}
    <div className="mt-3 h-px" style={{ background: 'linear-gradient(to right, rgba(0,212,200,0.4), transparent)' }} />
  </div>
);

const BottomBar: React.FC<{
  lectureDetected: boolean;
  lectureTitle: string;
  spacedReviewDay: number;
}> = ({ lectureDetected, spacedReviewDay }) => (
  <div
    className="flex-shrink-0 flex items-center justify-between px-4 py-2.5"
    style={{ borderTop: '1px solid #1e293b' }}
  >
    <div className="flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-[#00d4c8]" />
      <span className="text-[#94a3b8] text-[11px]">
        {lectureDetected ? '📹 Lecture detected' : '⏸ No video'}
      </span>
    </div>
    <span className="text-[#94a3b8]/60 text-[11px]">Spaced review: Day {spacedReviewDay}</span>
  </div>
);

export default Sidebar;
