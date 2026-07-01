import React, { useState } from 'react';

export interface Note {
  id: string;
  timestamp: string;
  text: string;
}

interface NotesTabProps {
  initialNotes?: Note[];
}

const defaultNotes: Note[] = [
  { id: '1', timestamp: '08:14', text: 'Fourier transform decomposes signals into sinusoidal components' },
  { id: '2', timestamp: '12:34', text: 'Time domain → frequency domain via integral transform' },
  { id: '3', timestamp: '19:07', text: 'Sampling rate must be ≥ 2× the highest signal frequency (Nyquist)' },
];

const NotesTab: React.FC<NotesTabProps> = ({ initialNotes = defaultNotes }) => {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [noteText, setNoteText] = useState('');

  const handleAddNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    const now = new Date();
    const timestamp = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const newNote: Note = {
      id: Date.now().toString(),
      timestamp,
      text: trimmed,
    };
    setNotes(prev => [newNote, ...prev]);
    setNoteText('');
  };

  const handleDelete = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleAddNote();
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Textarea */}
      <div className="relative">
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Jot thoughts, highlights, questions..."
          rows={3}
          className="w-full bg-[#0a0f1e] border border-[#1e293b] focus:border-[#00d4c8]/60 rounded-xl px-3 py-3 text-sm text-white placeholder-[#94a3b8]/50 resize-none outline-none transition-colors duration-200 scrollbar-thin"
          style={{ fontFamily: 'Inter, sans-serif' }}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          <span className="text-[#94a3b8]/40 text-xs">⌘↵ to save</span>
        </div>
      </div>

      {/* Save + media buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleAddNote}
          disabled={!noteText.trim()}
          className="flex-1 py-2 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-xs font-semibold disabled:opacity-30 hover:bg-[#00b8ad] transition-colors"
        >
          Save Note
        </button>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0d1b2a] border border-[#1e293b] text-[#94a3b8] text-xs hover:text-white hover:border-[#94a3b8]/30 transition-colors">
          <span>📷</span>
          <span>Screenshot</span>
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-[#1e293b]" />
        <span className="text-[#94a3b8]/50 text-xs">{notes.length} saved</span>
        <div className="flex-1 h-px bg-[#1e293b]" />
      </div>

      {/* Notes list */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1 scrollbar-thin pr-0.5">
        {notes.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="text-2xl opacity-30">📝</span>
            <p className="text-[#94a3b8]/50 text-xs">No notes yet. Start writing above.</p>
          </div>
        )}
        {notes.map(note => (
          <NoteCard key={note.id} note={note} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
};

const NoteCard: React.FC<{ note: Note; onDelete: (id: string) => void }> = ({ note, onDelete }) => {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    setDeleting(true);
    setTimeout(() => onDelete(note.id), 200);
  };

  return (
    <div
      className={`group flex items-start gap-2.5 bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-3 transition-all duration-200 hover:border-[#1e293b]/80 ${
        deleting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      <span className="flex-shrink-0 px-1.5 py-0.5 bg-[#00d4c8]/10 border border-[#00d4c8]/20 rounded-md text-[#00d4c8] text-xs font-mono font-medium">
        {note.timestamp}
      </span>
      <p className="flex-1 text-[#94a3b8] text-xs leading-relaxed group-hover:text-white transition-colors">
        {note.text}
      </p>
      <button
        onClick={handleDelete}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-[#94a3b8]/30 hover:text-red-400 transition-colors text-sm opacity-0 group-hover:opacity-100"
        aria-label="Delete note"
      >
        ×
      </button>
    </div>
  );
};

export default NotesTab;
