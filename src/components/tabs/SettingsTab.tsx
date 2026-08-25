import React, { useCallback, useEffect, useState } from 'react';

/**
 * In-panel settings: pick a model per feature and manage API keys without
 * leaving the lecture.
 *
 * Key material flows ONE WAY. This tab can write a key and ask whether a
 * provider has one, but the engine never sends a stored key back — which is
 * why every key field is a blank write-only input showing a placeholder rather
 * than the stored value. Combined with the closed shadow root and the panel's
 * key-event trapping, what the student types here is not reachable from the
 * host page.
 */

export interface FeatureDef { id: string; label: string; blurb: string }
export interface ProviderDef {
  id: string;
  label: string;
  free: boolean;
  keyUrl: string;
  keyHint: string;
}
export interface ModelDef { id: string; provider: string; label: string; note: string }

export interface SettingsState {
  settings: { features: Record<string, { model: string; enabled: boolean }> };
  catalog: { features: FeatureDef[]; providers: Record<string, ProviderDef>; models: ModelDef[] };
  vault: { exists: boolean; unlocked: boolean; configured: string[]; bundledGemini: boolean };
}

interface SettingsTabProps {
  /** undefined = demo mode (no engine behind it) */
  state?: SettingsState | null;
  onSaveSettings?: (settings: SettingsState['settings']) => Promise<void>;
  onCreateVault?: (passphrase: string) => Promise<void>;
  onUnlockVault?: (passphrase: string) => Promise<void>;
  onLockVault?: () => Promise<void>;
  onSaveKey?: (provider: string, apiKey: string) => Promise<void>;
  onRemoveKey?: (provider: string) => Promise<void>;
  onRefresh?: () => void;
}

const card = 'bg-[#0d1b2a] border border-[#1e293b] rounded-xl p-3';
const inputCls =
  'w-full bg-[#0a0f1e] border border-[#1e293b] focus:border-[#00d4c8]/60 rounded-lg px-2.5 py-2 ' +
  'text-xs text-white placeholder-[#94a3b8]/50 outline-none transition-colors';
const btnPrimary =
  'px-3 py-1.5 rounded-lg bg-[#00d4c8] text-[#0a0f1e] text-[11px] font-semibold ' +
  'hover:bg-[#00b8ad] disabled:opacity-40 transition-colors';
const btnGhost =
  'px-2.5 py-1.5 rounded-lg bg-[#0a0f1e] border border-[#1e293b] text-[#94a3b8] text-[11px] ' +
  'hover:text-white transition-colors';

const SettingsTab: React.FC<SettingsTabProps> = ({
  state,
  onSaveSettings,
  onCreateVault,
  onUnlockVault,
  onLockVault,
  onSaveKey,
  onRemoveKey,
  onRefresh,
}) => {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);

  const run = useCallback(async (tag: string, fn: () => Promise<void>, ok: string) => {
    setBusy(tag);
    try {
      await fn();
      setMsg({ text: ok, err: false });
    } catch (e: any) {
      setMsg({ text: String(e?.message || e), err: true });
    } finally {
      setBusy('');
    }
  }, []);

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#00d4c8]/10 border border-[#00d4c8]/30 flex items-center justify-center text-2xl">
          ⚙️
        </div>
        <p className="text-[#94a3b8] text-xs max-w-[230px] leading-relaxed">
          Settings load when the extension engine is running.
        </p>
      </div>
    );
  }

  const { settings, catalog, vault } = state;
  const activeModels = catalog.features
    .filter(f => settings.features[f.id]?.enabled)
    .map(f => settings.features[f.id].model);
  const distinct = new Set(activeModels);
  const paidCount = [...distinct].filter(id => {
    const m = catalog.models.find(x => x.id === id);
    return m && !catalog.providers[m.provider]?.free;
  }).length;

  const setFeature = (id: string, patch: Partial<{ model: string; enabled: boolean }>) => {
    const next = {
      ...settings,
      features: { ...settings.features, [id]: { ...settings.features[id], ...patch } },
    };
    run('save', async () => { await onSaveSettings?.(next); }, 'Saved');
  };

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto scrollbar-thin pr-0.5 pb-1">
      {/* ── Per-feature model ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3.5 rounded-full bg-[#00d4c8]" />
          <h3 className="text-white text-xs font-semibold">Model for each feature</h3>
        </div>

        <div className="flex flex-col gap-2">
          {catalog.features.map(f => {
            const conf = settings.features[f.id] || { model: '', enabled: false };
            return (
              <div key={f.id} className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={conf.enabled}
                    onChange={e => setFeature(f.id, { enabled: e.target.checked })}
                    className="accent-[#00d4c8] w-3.5 h-3.5 flex-shrink-0"
                  />
                  <span className="text-[#cbd5e1] text-[11px] font-medium flex-1">{f.label}</span>
                </label>
                <select
                  value={conf.model}
                  disabled={!conf.enabled}
                  onChange={e => setFeature(f.id, { model: e.target.value })}
                  aria-label={`Model for ${f.label}`}
                  className={`${inputCls} disabled:opacity-40 cursor-pointer`}
                >
                  {Object.values(catalog.providers).map(p => (
                    <optgroup key={p.id} label={p.label}>
                      {catalog.models
                        .filter(m => m.provider === p.id)
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.label} — {m.note}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div
          className={`mt-2.5 px-2.5 py-1.5 rounded-lg text-[10px] leading-relaxed border ${
            paidCount
              ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
              : 'bg-[#00d4c8]/10 border-[#00d4c8]/25 text-[#00d4c8]'
          }`}
        >
          {distinct.size === 0
            ? 'Every feature is off — nothing will be generated.'
            : `${distinct.size} API request${distinct.size === 1 ? '' : 's'} per checkpoint` +
              (paidCount ? ` · ${paidCount} billed to you` : ' · all free-tier')}
        </div>
      </div>

      {/* ── API keys ── */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3.5 rounded-full bg-[#8b5cf6]" />
            <h3 className="text-white text-xs font-semibold">API keys</h3>
          </div>
          {vault.exists && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                vault.unlocked
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-amber-500/15 text-amber-400'
              }`}
            >
              {vault.unlocked ? '🔓 UNLOCKED' : '🔒 LOCKED'}
            </span>
          )}
        </div>

        {/* No vault yet */}
        {!vault.exists && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[#94a3b8] text-[10px] leading-relaxed">
              Set a passphrase to store your own keys. They're encrypted on this device — there is
              no recovery if you forget it.
            </p>
            <input
              type="password"
              className={inputCls}
              placeholder="New passphrase (min 8)"
              value={pass}
              onChange={e => setPass(e.target.value)}
            />
            <input
              type="password"
              className={inputCls}
              placeholder="Confirm passphrase"
              value={pass2}
              onChange={e => setPass2(e.target.value)}
            />
            <button
              className={btnPrimary}
              disabled={busy === 'vault'}
              onClick={() => {
                if (pass !== pass2) return setMsg({ text: 'Passphrases do not match.', err: true });
                run('vault', async () => {
                  await onCreateVault?.(pass);
                  setPass('');
                  setPass2('');
                }, 'Vault created');
              }}
            >
              Create vault
            </button>
          </div>
        )}

        {/* Locked */}
        {vault.exists && !vault.unlocked && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[#94a3b8] text-[10px]">
              Unlock once per browser session. Until then Nupta uses the free model.
            </p>
            <input
              type="password"
              className={inputCls}
              placeholder="Passphrase"
              value={pass}
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  run('vault', async () => { await onUnlockVault?.(pass); setPass(''); }, 'Unlocked');
                }
              }}
            />
            <button
              className={btnPrimary}
              disabled={busy === 'vault'}
              onClick={() =>
                run('vault', async () => { await onUnlockVault?.(pass); setPass(''); }, 'Unlocked')
              }
            >
              {busy === 'vault' ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        )}

        {/* Unlocked */}
        {vault.exists && vault.unlocked && (
          <div className="flex flex-col gap-2">
            {Object.values(catalog.providers).map(p => {
              const isSet = vault.configured.includes(p.id);
              const free = p.free && vault.bundledGemini && !isSet;
              return (
                <div key={p.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[#cbd5e1] text-[11px] font-medium">{p.label}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        isSet
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : free
                          ? 'bg-[#00d4c8]/15 text-[#00d4c8]'
                          : 'bg-[#1e293b] text-[#94a3b8]'
                      }`}
                    >
                      {isSet ? 'YOUR KEY' : free ? 'FREE TIER' : 'NOT SET'}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      autoComplete="off"
                      className={inputCls}
                      placeholder={isSet ? '•••••• stored — type to replace' : `Paste ${p.label} key`}
                      value={keyDrafts[p.id] || ''}
                      onChange={e => setKeyDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                    />
                    <button
                      className={btnPrimary}
                      disabled={busy === p.id || !(keyDrafts[p.id] || '').trim()}
                      onClick={() =>
                        run(p.id, async () => {
                          await onSaveKey?.(p.id, (keyDrafts[p.id] || '').trim());
                          setKeyDrafts(d => ({ ...d, [p.id]: '' }));
                        }, `${p.label} key saved`)
                      }
                    >
                      {busy === p.id ? '…' : 'Save'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <a
                      href={p.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#00d4c8] text-[9px] hover:underline"
                    >
                      Get a key ↗
                    </a>
                    {isSet && (
                      <button
                        className="text-red-400/70 hover:text-red-400 text-[9px]"
                        onClick={() => run(p.id, async () => { await onRemoveKey?.(p.id); }, 'Key removed')}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button className={btnGhost} onClick={() => run('lock', async () => { await onLockVault?.(); }, 'Locked')}>
              🔒 Lock vault
            </button>
          </div>
        )}
      </div>

      <p className="text-[#94a3b8]/50 text-[9px] leading-relaxed px-0.5">
        Keys are encrypted on this device (AES-GCM, PBKDF2-SHA256) and sent only to their own
        provider. Nupta has no server.
        {onRefresh && (
          <button onClick={onRefresh} className="ml-1 text-[#00d4c8] hover:underline">
            Refresh
          </button>
        )}
      </p>

      {msg && (
        <div
          className={`px-2.5 py-1.5 rounded-lg text-[10px] border ${
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

export default SettingsTab;
