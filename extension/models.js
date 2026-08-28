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
  groq: {
    id: 'groq',
    label: 'Groq',
    // Ships with a free-tier key, like Gemini — Groq's free tier covers the
    // open models below and both Whisper endpoints.
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'Starts with gsk_. Free tier available.',
    keyPattern: /^gsk_[\w-]{20,}$/,
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
  // ── Google Gemini ──
  // `freeTier` is the important field: it means "the bundled key can use this",
  // i.e. the user needs no key of their own. Verified empirically against the
  // live API — Flash-class models answer on the free tier, Pro-class returns 429
  // (quota/billing) without a paid plan. Re-check when adding a Gemini model;
  // do not assume a whole provider is free.
  {
    id: 'gemini-3.7-flash',
    provider: 'gemini',
    label: 'Gemini 3.7 Flash',
    note: 'Free · newest · the default',
    freeTier: true,
  },
  { id: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash', note: 'Free · fast', freeTier: true },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash Lite',
    note: 'Free · fastest, lightest',
    freeTier: true,
  },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', note: 'Free · previous generation', freeTier: true },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro',
    note: 'Strongest reasoning · needs your own Gemini key',
    freeTier: false, // 429 quota on the free tier — billing required
  },

  // ── Anthropic ── (always the user's own key)
  { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', note: 'Most capable', freeTier: false },
  { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', note: 'Balanced', freeTier: false },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', note: 'Fastest · cheapest', freeTier: false },

  // ── Groq (free tier) ──
  // Only models verified to honour a STRICT json_schema are listed: the engine
  // depends entirely on structured output. qwen3.6-27b fails schema validation
  // and groq/compound* reject json_schema outright, so neither is offered.
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    label: 'GPT-OSS 120B (Groq)',
    note: 'Free · very fast · strongest on Groq',
    freeTier: true,
  },
  {
    id: 'qwen/qwen3.8-27b',
    provider: 'groq',
    label: 'Qwen 3.8 27B (Groq)',
    note: 'Free · very fast',
    freeTier: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    label: 'GPT-OSS 20B (Groq)',
    note: 'Free · fastest, lighter',
    freeTier: true,
  },

  // ── OpenAI ── (always the user's own key)
  { id: 'gpt-5.2', provider: 'openai', label: 'GPT-5.2', note: 'Most capable', freeTier: false },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', note: 'Faster · cheaper', freeTier: false },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', note: 'Previous generation', freeTier: false },
];

/**
 * Can this model be used right now?
 *
 * Free-tier models work with the bundled key, so the student needs nothing.
 * Everything else — including Gemini's Pro tier — needs the user's own key for
 * that provider. Deciding this per MODEL rather than per PROVIDER is the point:
 * "Gemini is free" is not true of every Gemini model.
 */
export function modelUsable(model, { configured = [], bundled = {} } = {}) {
  if (!model) return false;
  if (configured.includes(model.provider)) return true;      // user's own key
  return !!(model.freeTier && bundled[model.provider]);       // a bundled free key covers it
}

/**
 * Transcription engines. A separate axis from the four AI features: there is one
 * transcriber for the whole session, not one per tab.
 *
 * `local` is the default and the privacy-preserving option — audio is
 * transcribed on-device and never leaves the machine. The Groq engines are
 * faster and more accurate, but they UPLOAD lecture audio. That tradeoff is the
 * single most important thing this picker has to communicate, so every remote
 * entry carries `uploadsAudio: true` and the UI must show it.
 */
export const TRANSCRIBERS = [
  {
    id: 'local-whisper-base',
    provider: 'local',
    label: 'On-device Whisper',
    note: 'Private · audio never leaves your machine · needs a decent GPU',
    uploadsAudio: false,
    freeTier: true,
  },
  {
    id: 'whisper-large-v3-turbo',
    provider: 'groq',
    label: 'Whisper Large v3 Turbo (Groq)',
    note: 'Free · much faster and more accurate · uploads audio',
    uploadsAudio: true,
    freeTier: true,
  },
  {
    id: 'whisper-large-v3',
    provider: 'groq',
    label: 'Whisper Large v3 (Groq)',
    note: 'Free · most accurate · uploads audio',
    uploadsAudio: true,
    freeTier: true,
  },
];

export const DEFAULT_TRANSCRIBER = 'local-whisper-base';

export function getTranscriber(id) {
  return TRANSCRIBERS.find((t) => t.id === id) || null;
}

/** Local always works; a remote engine needs its provider's key. */
export function transcriberUsable(t, { configured = [], bundled = {} } = {}) {
  if (!t) return false;
  if (t.provider === 'local') return true;
  if (configured.includes(t.provider)) return true;
  return !!(t.freeTier && bundled[t.provider]);
}

export const DEFAULT_MODEL = 'gemini-3.7-flash';

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
    v: 2,
    // On-device by default: the privacy promise is the default, and switching
    // to a remote engine is a deliberate, informed choice.
    transcription: { model: DEFAULT_TRANSCRIBER },
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
  const t = stored.transcription || {};
  const transcription = {
    model: getTranscriber(t.model) ? t.model : base.transcription.model,
  };
  return { ...base, ...stored, features, transcription };
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
export function parseBundledKey(text, field = 'GEMINI_API_KEY') {
  const re = new RegExp(field + String.raw`\s*:\s*['"\`]([^'"\`]+)['"\`]`);
  const m = String(text || '').match(re);
  const key = m && m[1];
  return key && key !== 'PASTE_YOUR_KEY_HERE' ? key : '';
}
