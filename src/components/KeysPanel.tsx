import React, { useState } from 'react';
import type { SettingsState } from './ModelPicker';

/**
 * API key entry, rendered inside the widget panel — not a browser tab.
 *
 * Opening a separate page to paste a key throws the student out of the lecture
 * they're watching, so this takes over the panel's content area instead and a
 * back arrow returns them to exactly where they were.
 *
 * Keys are write-only from here: the engine reports which providers are
 * configured but never hands a stored key back, so these inputs are always
 * blank and show a placeholder rather than the saved value.
 */

interface KeysPanelProps {
  state: SettingsState;
  onClose: () => void;
  /** Verifies with the provider, then stores. Rejects with a readable message. */
  onSaveKey: (provider: string, apiKey: string) => Promise<void>;
  onRemoveKey: (provider: string) => Promise<void>;
}

const inputCls =
  'w-full bg-[#0a0f1e] border border-[#1e293b] focus:border-[#00d4c8]/60 rounded-lg px-2.5 py-2 ' +
  'text-xs text-white placeholder-[#94a3b8]/50 outline-none transition-colors';

const KeysPanel: React.FC<KeysPanelProps> = ({ state, onClose, onSaveKey, onRemoveKey }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  const { providers } = state.catalog;
  const configured = state.configured || [];

  const act = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: ok, err: false });
    } catch (e: any) {
      setMsg({ text: String(e?.message || e), err: true });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-2 flex-shrink-0">
        <button
          onClick={onClose}
          aria-label="Back"
          title="Back to the lecture"
          className="w-6 h-6 rounded-lg border border-[#1e293b] text-[#94a3b8] hover:text-[#00d4c8]
                     hover:border-[#00d4c8]/40 flex items-center justify-center text-xs transition-colors"
        >
          ←
        </button>
        <span className="text-white text-xs font-semibold">API keys</span>
      </div>

      <p className="text-[#94a3b8] text-[10px] leading-relaxed pb-2 flex-shrink-0">
        Gemini is free and already set up. Add a key to unlock Claude or GPT in the model dropdowns.
      </p>

      <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col gap-2.5 min-h-0 pr-0.5">
        {Object.values(providers).map(p => {
          const isSet = configured.includes(p.id);
          const freeReady = p.free && state.bundledGemini && !isSet;
          const draft = drafts[p.id] || '';

          return (
            <div key={p.id} className="bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[#cbd5e1] text-[11px] font-medium">{p.label}</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    isSet
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : freeReady
                      ? 'bg-[#00d4c8]/15 text-[#00d4c8]'
                      : 'bg-[#1e293b] text-[#94a3b8]'
                  }`}
                >
                  {isSet ? 'SAVED' : freeReady ? 'FREE' : 'NO KEY'}
                </span>
              </div>

              <div className="flex gap-1.5">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls}
                  placeholder={isSet ? '•••••• saved — type to replace' : `Paste ${p.label} key`}
                  value={draft}
                  onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draft.trim()) {
                      act(p.id, async () => {
                        await onSaveKey(p.id, draft.trim());
                        setDrafts(d => ({ ...d, [p.id]: '' }));
                      }, `${p.label} key saved`);
                    }
                  }}
                />
                <button
                  disabled={busy === p.id || !draft.trim()}
                  onClick={() =>
                    act(p.id, async () => {
                      await onSaveKey(p.id, draft.trim());
                      setDrafts(d => ({ ...d, [p.id]: '' }));
                    }, `${p.label} key saved`)
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-[11px] font-semibold
                             hover:bg-[#00b8ad] disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  {busy === p.id ? '…' : 'Save'}
                </button>
              </div>

              <div className="flex items-center justify-between mt-1">
                <a
                  href={p.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00d4c8] text-[9px] hover:underline"
                >
                  {isSet ? 'Manage keys ↗' : 'Get a key ↗'}
                </a>
                {isSet && (
                  <button
                    className="text-red-400/70 hover:text-red-400 text-[9px]"
                    onClick={() => act(p.id, () => onRemoveKey(p.id), `${p.label} key removed`)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-[#94a3b8]/50 text-[9px] leading-relaxed">
          Stored on this device only and sent to nobody but the provider — Nupta has no server.
          Not encrypted on disk, so treat a key like a saved browser password; revoke it at the
          provider if it's ever exposed.
        </p>
      </div>

      {msg && (
        <div
          className={`mt-2 px-2.5 py-1.5 rounded-lg text-[10px] border flex-shrink-0 ${
            msg.err
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
};

export default KeysPanel;
