import React, { useState } from 'react';

export interface Note {
  id: string;
  /** Display timestamp — the video position, e.g. "12:34". */
  timestamp: string;
  /** Seconds into the video (null/undefined = position unknown). */
  tSec?: number | null;
  text: string;
}

interface NotesTabProps {
  /** Live mode: notes are managed and persisted per lecture by the extension. */
  notes?: Note[];
  onAdd?: (text: string) => void;
  onDelete?: (id: string) => void;
  /** Jump the lecture video to this note's timestamp. */
  onSeek?: (tSec: number) => void;
}

const demoNotes: Note[] = [
  { id: '1', timestamp: '08:14', tSec: 494, text: 'Fourier transform decomposes signals into sinusoidal components' },
  { id: '2', timestamp: '12:34', tSec: 754, text: 'Time domain → frequency domain via integral transform' },
  { id: '3', timestamp: '19:07', tSec: 1147, text: 'Sampling rate must be ≥ 2× the highest signal frequency (Nyquist)' },
];

const NotesTab: React.FC<NotesTabProps> = ({ notes, onAdd, onDelete, onSeek }) => {
  const live = notes !== undefined;
  const [localNotes, setLocalNotes] = useState<Note[]>(demoNotes);
  const [noteText, setNoteText] = useState('');
  const [copied, setCopied] = useState(false);
  const list = live ? (notes as Note[]) : localNotes;

  const handleCopyAll = () => {
    const text = [...list]
      .reverse() // chronological order for export
      .map(n => `[${n.timestamp}] ${n.text}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAddNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    if (live) {
      if (onAdd) onAdd(trimmed);
    } else {
      const now = new Date();
      const timestamp = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setLocalNotes(prev => [{ id: Date.now().toString(), timestamp, text: trimmed }, ...prev]);
    }
    setNoteText('');
  };

  const handleDelete = (id: string) => {
    if (live) { if (onDelete) onDelete(id); }
    else setLocalNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote();
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Composer */}
      <div className="relative">
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Jot thoughts, highlights, questions…"
          rows={3}
          className="w-full bg-[#0a0f1e] border border-[#1e293b] focus:border-[#00d4c8]/60 rounded-xl px-3 py-3 text-sm text-white placeholder-[#94a3b8]/50 resize-none outline-none transition-colors duration-200 scrollbar-thin"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[#94a3b8]/50 text-[10px]">
          Ctrl+Enter to save{live ? ' — tagged with the video time' : ''}
        </span>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              onClick={handleCopyAll}
              title="Copy all notes with timestamps"
              className="px-2 py-1.5 rounded-lg bg-[#0a0f1e] border border-[#1e293b] text-[#94a3b8] text-xs hover:text-white hover:border-[#94a3b8]/30 transition-colors"
            >
              {copied ? <span className="text-emerald-400">✓ Copied</span> : '⎘ Copy all'}
            </button>
          )}
          <button
            onClick={handleAddNote}
            disabled={!noteText.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-xs font-semibold hover:bg-[#00b8ad] disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            + Add note
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col gap-2 min-h-0">
        {list.length === 0 && (
          <p className="text-[#94a3b8]/60 text-xs text-center mt-6 leading-relaxed">
            No notes yet.
            <br />
            Notes are saved per lecture and restored when you come back.
          </p>
        )}
        {list.map(note => (
          <div
            key={note.id}
            className="group bg-[#0d1b2a] border border-[#1e293b] rounded-xl px-3 py-2.5 flex items-start gap-3"
          >
            <button
              onClick={() => { if (note.tSec != null && onSeek) onSeek(note.tSec); }}
              disabled={note.tSec == null || !onSeek}
              title={note.tSec != null && onSeek ? 'Jump to this moment in the video' : undefined}
              className={`flex-shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold mt-0.5 border transition-colors ${
                note.tSec != null && onSeek
                  ? 'bg-[#00d4c8]/10 text-[#00d4c8] border-[#00d4c8]/25 hover:bg-[#00d4c8]/25 cursor-pointer'
                  : 'bg-[#1e293b] text-[#94a3b8] border-transparent cursor-default'
              }`}
            >
              {note.timestamp}
            </button>
            <p className="text-[#cbd5e1] text-xs leading-relaxed flex-1">{note.text}</p>
            <button
              onClick={() => handleDelete(note.id)}
              className="flex-shrink-0 text-[#94a3b8]/40 hover:text-red-400 text-sm leading-none opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete note"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotesTab;
