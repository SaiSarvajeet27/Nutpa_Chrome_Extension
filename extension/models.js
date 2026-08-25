// models.js — the catalog of providers and models the user can pick from, and
// the per-feature settings that record what they picked.
//
// Adding a model is a one-line change here; nothing else needs to know about it.

/**
 * The four things the engine can generate. Each is independently assignable to
 * a model. `quiz` is special — it also decides whether a subtopic finished at
 * all, which gates the other three (see background.js).
 */
export const FEATURES = [
  { id: 'quiz', label: 'Quiz', blurb: 'Comprehension questions at each checkpoint' },
  { id: 'summary', label: 'Summary', blurb: 'Running key points and concept tags' },
  { id: 'flashcards', label: 'Flashcards', blurb: 'One spaced-repetition card per subtopic' },
  { id: 'notes', label: 'Auto-notes', blurb: 'Structured notes written alongside your own' },
];

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    // The only provider that works with no user key — the extension ships with
    // free-tier access, which is why it's the default for every feature.
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Free key from Google AI Studio — no credit card.',
    keyPattern: /^AIza[\w-]{20,}$/,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    free: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Starts with sk-ant-. Billed to your Anthropic account.',
    keyPattern: /^sk-ant-[\w-]{20,}$/,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    free: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Starts with sk-. Billed to your OpenAI account.',
    keyPattern: /^sk-[\w-]{20,}$/,
  },
};

/**
 * Selectable models. `id` is the exact string sent to the provider — never
 * construct or decorate these (no date suffixes), they are complete as written.
 */
export const MODELS = [
  // ── Google Gemini (free tier) ──
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash',
    note: 'Free · fast · the default',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    label: 'Gemini 2.5 Pro',
    note: 'Free tier · slower, stronger reasoning',
  },

  // ── Anthropic ──
  { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', note: 'Most capable' },
  { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', note: 'Balanced' },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    note: 'Fastest · cheapest',
  },

  // ── OpenAI ──
  { id: 'gpt-5.2', provider: 'openai', label: 'GPT-5.2', note: 'Most capable' },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', note: 'Faster · cheaper' },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', note: 'Previous generation' },
];

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export function getModel(modelId) {
  return MODELS.find((m) => m.id === modelId) || null;
}

export function modelsByProvider() {
  const out = {};
  for (const m of MODELS) (out[m.provider] ||= []).push(m);
  return out;
}

const SETTINGS_KEY = 'nupta:settings';

/**
 * Auto-notes is the one feature that defaults OFF: it's new, and it writes into
 * a tab the student already owns. Everything else keeps working exactly as it
 * did before this feature existed.
 */
export function defaultSettings() {
  return {
    v: 1,
    features: {
      quiz: { model: DEFAULT_MODEL, enabled: true },
      summary: { model: DEFAULT_MODEL, enabled: true },
      flashcards: { model: DEFAULT_MODEL, enabled: true },
      notes: { model: DEFAULT_MODEL, enabled: false },
    },
  };
}

export async function loadSettings() {
  const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
  const base = defaultSettings();
  if (!stored || !stored.features) return base;
  // Merge per feature so a settings blob written by an older version — one that
  // predates a feature — still yields a complete, usable shape.
  const features = {};
  for (const f of FEATURES) {
    const s = stored.features[f.id] || {};
    features[f.id] = {
      model: getModel(s.model) ? s.model : base.features[f.id].model,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : base.features[f.id].enabled,
    };
  }
  return { ...base, ...stored, features };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Group the enabled features by the model that serves them.
 *
 * This is what preserves the original cost model: when every feature points at
 * the same model (the default), this returns ONE group, so a checkpoint is still
 * a single API call returning everything — exactly as before per-feature
 * selection existed. Only a user who deliberately splits features across models
 * pays for more than one call.
 */
export function groupFeaturesByModel(settings) {
  const groups = new Map();
  for (const f of FEATURES) {
    const conf = settings.features[f.id];
    if (!conf || !conf.enabled) continue;
    const model = getModel(conf.model);
    if (!model) continue;
    const key = `${model.provider}:${model.id}`;
    if (!groups.has(key)) groups.set(key, { provider: model.provider, model: model.id, features: [] });
    groups.get(key).features.push(f.id);
  }
  return [...groups.values()];
}

/**
 * Pull the bundled Gemini key out of config.js's text.
 *
 * Parsed rather than executed: the service worker fetches that file as text, so
 * nothing in it ever runs. (It cannot be imported either — service workers
 * forbid dynamic import(), and a static import would break the worker whenever
 * the gitignored config.js is absent.)
 *
 * Accepts `const` or `export const`, single/double/backtick quotes, and ignores
 * the untouched placeholder.
 */
export function parseBundledKey(text) {
  const m = String(text || '').match(/GEMINI_API_KEY\s*:\s*['"`]([^'"`]+)['"`]/);
  const key = m && m[1];
  return key && key !== 'PASTE_YOUR_KEY_HERE' ? key : '';
}
