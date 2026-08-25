import React from 'react';

/**
 * The small model dropdown that sits at the top of each tab, choosing which
 * model powers that one feature.
 *
 * Gemini is free and always selectable. Models from providers with no API key
 * yet are shown but disabled and labelled, rather than hidden — otherwise the
 * options silently don't exist and there's nothing to explain why. An "Add key"
 * link appears next to the picker in exactly that case, so the dead end always
 * comes with its own way out.
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
  /** Providers with a stored key. Never contains key material. */
  configured: string[];
  /** True when a free-tier Gemini key ships with the build. */
  bundledGemini: boolean;
}

export interface ModelPickerProps {
  /** Which feature this picker controls: quiz | summary | flashcards | notes. */
  featureId: string;
  state?: SettingsState | null;
  /** null model = turn the feature off. */
  onChange?: (featureId: string, model: string | null) => void;
  /** Opens the API keys screen. */
  onAddKey?: () => void;
}

const OFF = '__off__';

/** True when this provider can actually be used right now. */
function providerUsable(
  providerId: string,
  state: Pick<SettingsState, 'catalog' | 'configured' | 'bundledGemini'>
): boolean {
  if (state.configured.includes(providerId)) return true;
  const p = state.catalog.providers[providerId];
  return !!(p && p.free && state.bundledGemini);
}

const ModelPicker: React.FC<ModelPickerProps> = ({ featureId, state, onChange, onAddKey }) => {
  if (!state) return null;

  const conf = state.settings.features[featureId];
  if (!conf) return null;

  const { providers, models } = state.catalog;
  const current = conf.enabled ? conf.model : OFF;
  const currentModel = models.find(m => m.id === conf.model);
  // Prompt for a key only when the selection actually needs one.
  const needsKey =
    conf.enabled && currentModel && !providerUsable(currentModel.provider, state);
  const anyLocked = Object.keys(providers).some(id => !providerUsable(id, state));

  return (
    <div className="flex items-center gap-1.5 pb-2">
      <select
        value={current}
        aria-label={`Model for ${featureId}`}
        title="Which AI model powers this tab"
        onChange={e => {
          const v = e.target.value;
          onChange?.(featureId, v === OFF ? null : v);
        }}
        className="flex-1 min-w-0 bg-[#0a0f1e] border border-[#1e293b] hover:border-[#00d4c8]/40
                   focus:border-[#00d4c8]/60 rounded-lg pl-2 pr-1 py-1.5 text-[11px] text-[#cbd5e1]
                   outline-none cursor-pointer transition-colors"
      >
        <option value={OFF}>⏻ Off</option>
        {Object.values(providers).map(p => {
          const usable = providerUsable(p.id, state);
          return (
            <optgroup key={p.id} label={usable ? p.label : `${p.label} — needs API key`}>
              {models
                .filter(m => m.provider === p.id)
                .map(m => (
                  <option
                    key={m.id}
                    value={m.id}
                    // Never disable the option that is currently selected: a
                    // <select> cannot display a disabled option, so it would
                    // fall back to showing the first enabled one and the
                    // control would lie about what is configured.
                    disabled={!usable && m.id !== conf.model}
                  >
                    {m.label}
                    {p.free ? ' (free)' : usable ? '' : ' — add key'}
                  </option>
                ))}
            </optgroup>
          );
        })}
      </select>

      {(needsKey || anyLocked) && onAddKey && (
        <button
          onClick={onAddKey}
          title="Add an API key to unlock Claude and GPT models"
          className={`flex-shrink-0 px-1.5 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
            needsKey
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-[#0a0f1e] border-[#1e293b] text-[#94a3b8] hover:text-[#00d4c8] hover:border-[#00d4c8]/40'
          }`}
        >
          {needsKey ? '⚠ Add key' : '＋ Key'}
        </button>
      )}
    </div>
  );
};

export default ModelPicker;
