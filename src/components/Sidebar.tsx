import React, { useState, useEffect, useRef } from 'react';
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

  const buttonWidth = 56;
  const buttonHeight = 56;
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
  }, [buttonPos]);

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
        className={`fixed z-[10000] w-14 h-14 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-shadow duration-300 shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-white/10 hover:border-[#00d4c8]/30 ${
          isDragging ? 'scale-95' : 'hover:scale-105'
        }`}
        style={{
          left: `${buttonPos.x}px`,
          top: `${buttonPos.y}px`,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          transition: isDragging ? 'none' : 'transform 0.15s ease-out, border-color 0.15s ease-out',
        }}
      >
        {/* AssistiveTouch Outer Ring */}
        <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center transition-all duration-300">
          {/* AssistiveTouch Inner Circle */}
          <div
            className={`w-6 h-6 rounded-full transition-all duration-300 ${
              isOpen 
                ? 'bg-[#00d4c8] shadow-[0_0_12px_#00d4c8]' 
                : 'bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.4)]'
            }`}
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
