import React, { useState, useEffect, useRef } from 'react';
import FocusTab from './tabs/FocusTab';
import type { FocusQuestion } from './tabs/FocusTab';
import NotesTab from './tabs/NotesTab';
import type { Note } from './tabs/NotesTab';
import SummaryTab from './tabs/SummaryTab';
import type { SummaryData } from './tabs/SummaryTab';
import FlashcardsTab from './tabs/FlashcardsTab';
import SettingsTab from './tabs/SettingsTab';
import type { SettingsState } from './tabs/SettingsTab';
import type { Flashcard } from './tabs/FlashcardsTab';
import GooeyNav from './GooeyNav';
import logoImg from '../assets/logo.png';

type TabId = 'focus' | 'notes' | 'summary' | 'cards' | 'settings';

/**
 * Manifest version, shown in the header. Reading it here (rather than baking a
 * constant into the bundle) means it always reflects the extension Chrome
 * actually loaded — which is the fastest way to tell a stale unpacked copy from
 * a current one. Empty on the demo page, which has no chrome runtime.
 */
const extensionVersion = (() => {
  try {
    return chrome?.runtime?.getManifest?.().version ?? '';
  } catch {
    return '';
  }
})();

export interface SidebarProps {
  defaultOpen?: boolean;
  lectureTitle?: string;
  lectureDetected?: boolean;
  spacedReviewDay?: number;
  /** Live quiz from the extension engine (undefined = demo mode, null = idle). */
  focusQuestions?: FocusQuestion[] | null;
  /** Called when a live quiz is finished/skipped → resumes the video. */
  onQuizComplete?: () => void;
  /** Real lecture progress percentage from the tracked video. */
  lectureProgress?: number;
  /** Engine status line (model download %, "Listening to tab audio", ...). */
  engineStatus?: string;
  /** Live notes (persisted per lecture). */
  notes?: Note[];
  onAddNote?: (text: string) => void;
  onDeleteNote?: (id: string) => void;
  onSeekNote?: (tSec: number) => void;
  /** Live summary, growing at each checkpoint. */
  summaryData?: SummaryData;
  /** Live flashcard deck (due-first order). */
  cards?: Flashcard[];
  onRateCard?: (id: string, rating: 'easy' | 'hard') => void;
  /** Wrong quiz answers become flashcards. */
  onWrongAnswer?: (q: FocusQuestion) => void;
  /** A quiz is waiting — the ball pulses amber while the panel is closed. */
  quizPending?: boolean;
  /** Renders a Stop button in the bottom bar (stops monitoring). */
  onStopMonitoring?: () => void;
  /** Live settings state for the in-panel Settings tab. */
  settingsState?: SettingsState | null;
  onSaveSettings?: (s: SettingsState['settings']) => Promise<void>;
  onCreateVault?: (passphrase: string) => Promise<void>;
  onUnlockVault?: (passphrase: string) => Promise<void>;
  onLockVault?: () => Promise<void>;
  onSaveKey?: (provider: string, apiKey: string) => Promise<void>;
  onRemoveKey?: (provider: string) => Promise<void>;
  onRefreshSettings?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  defaultOpen = true,
  lectureTitle = 'Signal Processing — Chapter 4',
  lectureDetected = true,
  spacedReviewDay = 3,
  focusQuestions,
  onQuizComplete,
  lectureProgress,
  engineStatus,
  notes,
  onAddNote,
  onDeleteNote,
  onSeekNote,
  summaryData,
  cards,
  onRateCard,
  onWrongAnswer,
  quizPending,
  onStopMonitoring,
  settingsState,
  onSaveSettings,
  onCreateVault,
  onUnlockVault,
  onLockVault,
  onSaveKey,
  onRemoveKey,
  onRefreshSettings,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TabId>('focus');
  
  // Floating panel size state
  const [panelSize, setPanelSize] = useState({ width: 340, height: 540 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; startWidth: number; startHeight: number } | null>(null);

  // Floating button state & positioning
  const [buttonPos, setButtonPos] = useState({
    x: typeof window !== 'undefined' ? window.innerWidth - 80 : 1000,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 - 28 : 400
  });
  
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; btnX: number; btnY: number } | null>(null);
  const dragStartedRef = useRef<boolean>(false);

  const buttonWidth = 38;
  const buttonHeight = 38;
  const minPadding = 16;

  // Initialize button position correctly after mount
  useEffect(() => {
    setButtonPos({
      x: window.innerWidth - buttonWidth - minPadding - 16,
      y: window.innerHeight / 2 - buttonHeight / 2
    });
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      btnX: buttonPos.x,
      btnY: buttonPos.y
    };
    dragStartedRef.current = false;
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    dragStartRef.current = {
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      btnX: buttonPos.x,
      btnY: buttonPos.y
    };
    dragStartedRef.current = false;
  };

  // Dragging event handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        dragStartedRef.current = true;
        setIsDragging(true);
        setIsOpen(false); // Close panel on drag start
      }

      const newX = Math.max(minPadding, Math.min(window.innerWidth - buttonWidth - minPadding, dragStartRef.current.btnX + deltaX));
      const newY = Math.max(minPadding, Math.min(window.innerHeight - buttonHeight - minPadding, dragStartRef.current.btnY + deltaY));
      
      setButtonPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        setTimeout(() => {
          setIsDragging(false);
        }, 50);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragStartRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - dragStartRef.current.mouseX;
      const deltaY = touch.clientY - dragStartRef.current.mouseY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        dragStartedRef.current = true;
        setIsDragging(true);
        setIsOpen(false);
      }

      const newX = Math.max(minPadding, Math.min(window.innerWidth - buttonWidth - minPadding, dragStartRef.current.btnX + deltaX));
      const newY = Math.max(minPadding, Math.min(window.innerHeight - buttonHeight - minPadding, dragStartRef.current.btnY + deltaY));

      setButtonPos({ x: newX, y: newY });
    };

    const handleTouchEnd = () => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        setTimeout(() => {
          setIsDragging(false);
        }, 50);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    const handleResize = () => {
      setButtonPos(current => ({
        x: Math.max(minPadding, Math.min(window.innerWidth - buttonWidth - minPadding, current.x)),
        y: Math.max(minPadding, Math.min(window.innerHeight - buttonHeight - minPadding, current.y))
      }));
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('resize', handleResize);
    };
    // Every handler works off refs or functional setState, so this binds once.
    // Depending on buttonPos here would re-register all five listeners on each
    // pointer move during a drag.
  }, []);

  // Resizing event handlers
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height
    };
    setIsResizing(true);
  };

  const handleResizeTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    resizeStartRef.current = {
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height
    };
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const deltaX = e.clientX - resizeStartRef.current.mouseX;
      const deltaY = e.clientY - resizeStartRef.current.mouseY;

      // Constraints: min width 280, max 600; min height 350, max 800
      const newWidth = Math.max(280, Math.min(600, resizeStartRef.current.startWidth + deltaX));
      const newHeight = Math.max(350, Math.min(800, resizeStartRef.current.startHeight + deltaY));

      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      if (resizeStartRef.current) {
        resizeStartRef.current = null;
        setIsResizing(false);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!resizeStartRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - resizeStartRef.current.mouseX;
      const deltaY = touch.clientY - resizeStartRef.current.mouseY;

      const newWidth = Math.max(280, Math.min(600, resizeStartRef.current.startWidth + deltaX));
      const newHeight = Math.max(350, Math.min(800, resizeStartRef.current.startHeight + deltaY));

      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handleTouchEnd = () => {
      if (resizeStartRef.current) {
        resizeStartRef.current = null;
        setIsResizing(false);
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isResizing]);

  // Tab switching custom event listener
  useEffect(() => {
    const handleOpenTab = (e: Event) => {
      const customEvent = e as CustomEvent<{ tabId: TabId }>;
      if (customEvent.detail && customEvent.detail.tabId) {
        setActiveTab(customEvent.detail.tabId);
        setIsOpen(true);
      }
    };
    window.addEventListener('open-sidebar-tab', handleOpenTab);
    return () => {
      window.removeEventListener('open-sidebar-tab', handleOpenTab);
    };
  }, []);

  const handleClick = () => {
    if (dragStartedRef.current) return;
    setIsOpen(o => !o);
  };

  // Quiz waiting + panel closed → the ball demands attention.
  const alerting = !!quizPending && !isOpen;

  // Position panel relative to the button
  const isLeftHalf = buttonPos.x < window.innerWidth / 2;
  const panelX = isLeftHalf 
    ? buttonPos.x + buttonWidth + 12 
    : buttonPos.x - panelSize.width - 12;
  const panelY = buttonPos.y + (buttonHeight / 2) - (panelSize.height / 2);

  // Clamp panel within viewport boundaries
  const clampedX = Math.max(minPadding, Math.min(window.innerWidth - panelSize.width - minPadding, panelX));
  const clampedY = Math.max(minPadding, Math.min(window.innerHeight - panelSize.height - minPadding, panelY));

  return (
    <>
      {/* Draggable AssistiveTouch Floating Button */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={handleClick}
        className={`fixed z-[10000] rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-shadow duration-300 shadow-[0_4px_24px_rgba(0,0,0,0.4)] border border-white/10 hover:border-[#00d4c8]/30 ${
          isDragging ? 'scale-95' : 'hover:scale-105'
        } ${alerting ? 'nupta-alert' : ''}`}
        style={{
          left: `${buttonPos.x}px`,
          top: `${buttonPos.y}px`,
          width: `${buttonWidth}px`,
          height: `${buttonHeight}px`,
          background: 'rgba(15, 23, 42, 0.28)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          transition: isDragging ? 'none' : 'transform 0.15s ease-out, border-color 0.15s ease-out',
        }}
      >
        {/* Expanding ripple rings while a quiz is waiting */}
        {alerting && (
          <>
            <span className="nupta-ripple" />
            <span className="nupta-ripple nupta-ripple-delay" />
          </>
        )}
        {/* AssistiveTouch Outer Ring */}
        <div
          className="rounded-full border border-white/20 flex items-center justify-center transition-all duration-300"
          style={{ width: '27px', height: '27px' }}
        >
          {/* AssistiveTouch Inner Circle */}
          <div
            className={`rounded-full transition-all duration-300 ${
              isOpen
                ? 'bg-[#00d4c8] shadow-[0_0_12px_#00d4c8]'
                : alerting
                ? 'bg-amber-400 shadow-[0_0_14px_#f59e0b]'
                : 'bg-white/60 shadow-[0_0_8px_rgba(255,255,255,0.3)]'
            }`}
            style={{ width: '15px', height: '15px' }}
          />
        </div>
      </div>

      {/* Floating Panel */}
      <div
        className="flex flex-col shadow-2xl rounded-2xl overflow-hidden border"
        style={{
          position: 'fixed',
          left: `${clampedX}px`,
          top: `${clampedY}px`,
          width: `${panelSize.width}px`,
          height: `${panelSize.height}px`,
          zIndex: 9999,
          background: 'rgba(10, 15, 30, 0.85)',
          borderColor: 'rgba(0, 212, 200, 0.25)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          transform: isOpen ? 'scale(1)' : 'scale(0.95)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: isResizing ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          transformOrigin: isLeftHalf ? 'left center' : 'right center',
        }}
      >
        {/* Header */}
        <SidebarHeader onOpenSettings={() => setActiveTab('settings')} />

        {/* Tab bar */}
        <div className="flex-shrink-0 px-3 py-2">
          <GooeyNav
            items={[
              { label: 'Focus', href: '#' },
              { label: 'Notes', href: '#' },
              { label: 'Summary', href: '#' },
              { label: 'Cards', href: '#' },
              { label: 'Setup', href: '#' }
            ]}
            activeIndex={['focus', 'notes', 'summary', 'cards', 'settings'].indexOf(activeTab)}
            onChange={(index) => {
              const tabs: TabId[] = ['focus', 'notes', 'summary', 'cards', 'settings'];
              setActiveTab(tabs[index]);
            }}
            animationTime={300}
            particleCount={12}
          />
        </div>

        {/* Tab content — all tabs stay mounted so switching tabs never loses
            quiz progress, notes drafts, or flashcard position. */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 min-h-0">
          <div className="h-full" style={{ display: activeTab === 'focus' ? 'block' : 'none' }}>
            <FocusTab
              questions={focusQuestions}
              onComplete={onQuizComplete}
              lectureProgress={lectureProgress ?? 42}
              engineStatus={engineStatus}
              onWrongAnswer={onWrongAnswer}
            />
          </div>
          <div className="h-full" style={{ display: activeTab === 'notes' ? 'block' : 'none' }}>
            <NotesTab notes={notes} onAdd={onAddNote} onDelete={onDeleteNote} onSeek={onSeekNote} />
          </div>
          <div className="h-full" style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
            <SummaryTab data={summaryData} />
          </div>
          <div className="h-full" style={{ display: activeTab === 'cards' ? 'block' : 'none' }}>
            <FlashcardsTab cards={cards} onRate={onRateCard} />
          </div>
          <div className="h-full" style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <SettingsTab
              state={settingsState}
              onSaveSettings={onSaveSettings}
              onCreateVault={onCreateVault}
              onUnlockVault={onUnlockVault}
              onLockVault={onLockVault}
              onSaveKey={onSaveKey}
              onRemoveKey={onRemoveKey}
              onRefresh={onRefreshSettings}
            />
          </div>
        </div>

        {/* Bottom status bar */}
        <BottomBar
          lectureDetected={lectureDetected}
          lectureTitle={lectureTitle}
          spacedReviewDay={spacedReviewDay}
          onStop={onStopMonitoring}
        />

        {/* Resize handle (bottom-right corner) */}
        <div
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          className="absolute bottom-0.5 right-0.5 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5 text-white/30 hover:text-[#00d4c8] transition-colors select-none z-[100]"
          title="Drag to resize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="8" y1="2" x2="2" y2="8" />
            <line x1="8" y1="5" x2="5" y2="8" />
          </svg>
        </div>

        {/* Bottom edge resize helper */}
        <div
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          className="absolute bottom-0 left-0 right-5 h-2 cursor-s-resize z-[99]"
        />

        {/* Right edge resize helper */}
        <div
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          className="absolute top-0 bottom-5 right-0 w-2 cursor-e-resize z-[99]"
        />
      </div>
    </>
  );
};

/* ─── Sub-components ─── */

const SidebarHeader: React.FC<{ onOpenSettings?: () => void }> = ({ onOpenSettings }) => (
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
          {/* Build version, so it's always obvious which code is actually loaded. */}
          {extensionVersion && (
            <span className="ml-1.5 normal-case tracking-normal text-[#94a3b8]/50">
              v{extensionVersion}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Settings lives on the extension's options page (keys must never be
            typed into a widget injected onto a web page), but it has to be
            reachable from here — this is where people look for it. */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            title="Settings — choose a model per feature, add API keys"
            aria-label="Open Nupta settings"
            className="flex items-center justify-center w-7 h-7 rounded-full border border-[#1e293b] text-[#94a3b8] hover:text-[#00d4c8] hover:border-[#00d4c8]/40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}

        {/* Live dot */}
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
  onStop?: () => void;
}> = ({ lectureDetected, spacedReviewDay, onStop }) => (
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
    <div className="flex items-center gap-2.5">
      <span className="text-[#94a3b8]/60 text-[11px]">Spaced review: Day {spacedReviewDay}</span>
      {onStop && (
        <button
          onClick={onStop}
          title="Stop monitoring this lecture"
          className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] font-semibold hover:bg-red-500/20 transition-colors"
        >
          ■ Stop
        </button>
      )}
    </div>
  </div>
);

export default Sidebar;
