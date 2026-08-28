// Tests for the provider-agnostic engine logic: how features are grouped into
// API calls, and the shape of the request that goes out.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (items) => Object.assign(store, items),
    },
  },
});

const {
  groupFeaturesByModel, defaultSettings, loadSettings, FEATURES, MODELS, getModel, parseBundledKey,
  DEFAULT_MODEL,
  modelUsable,
  PROVIDERS,
  TRANSCRIBERS,
  getTranscriber,
  transcriberUsable,
  DEFAULT_TRANSCRIBER,
} = await import('./models.js');
const { buildRequest, normalize } = await import('./checkpoint.js');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

const withModels = (map) => {
  const s = defaultSettings();
  for (const [feature, model] of Object.entries(map)) {
    s.features[feature] = { model, enabled: true };
  }
  return s;
};

describe('groupFeaturesByModel', () => {
  it('collapses to a SINGLE call when every feature shares a model', () => {
    // This is the cost guarantee: the default config must never cost more than
    // the one-call-per-checkpoint design it replaced.
    const s = withModels({
      quiz: 'gemini-2.5-flash',
      summary: 'gemini-2.5-flash',
      flashcards: 'gemini-2.5-flash',
      notes: 'gemini-2.5-flash',
    });
    const groups = groupFeaturesByModel(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].features.sort()).toEqual(['flashcards', 'notes', 'quiz', 'summary']);
  });

  it('defaults ship as one call (auto-notes off, everything else on Gemini)', () => {
    const groups = groupFeaturesByModel(defaultSettings());
    expect(groups).toHaveLength(1);
    expect(groups[0].provider).toBe('gemini');
    expect(groups[0].features).not.toContain('notes'); // off by default
  });

  it('splits into one group per distinct model', () => {
    const s = withModels({
      quiz: 'gemini-2.5-flash',
      summary: 'claude-opus-5',
      flashcards: 'claude-opus-5',
      notes: 'gpt-5.2',
    });
    const groups = groupFeaturesByModel(s);
    expect(groups).toHaveLength(3);
    const claude = groups.find((g) => g.model === 'claude-opus-5');
    expect(claude.features.sort()).toEqual(['flashcards', 'summary']);
    expect(claude.provider).toBe('anthropic');
  });

  it('omits disabled features entirely', () => {
    const s = withModels({ quiz: 'gemini-2.5-flash', summary: 'claude-opus-5' });
    s.features.summary.enabled = false;
    s.features.flashcards.enabled = false;
    s.features.notes.enabled = false;
    const groups = groupFeaturesByModel(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].features).toEqual(['quiz']);
  });

  it('returns nothing when every feature is off', () => {
    const s = defaultSettings();
    for (const f of FEATURES) s.features[f.id].enabled = false;
    expect(groupFeaturesByModel(s)).toEqual([]);
  });

  it('ignores a model id that is no longer in the catalog', () => {
    const s = withModels({ quiz: 'model-that-was-removed' });
    expect(groupFeaturesByModel(s).some((g) => g.features.includes('quiz'))).toBe(false);
  });
});

describe('loadSettings', () => {
  it('fills in a feature missing from an older stored blob', async () => {
    store['nupta:settings'] = {
      v: 1,
      features: { quiz: { model: 'claude-opus-5', enabled: true } }, // pre-notes
    };
    const s = await loadSettings();
    expect(s.features.quiz.model).toBe('claude-opus-5'); // keeps the user's choice
    expect(s.features.notes).toBeDefined(); // and gains the new feature
    expect(s.features.summary.model).toBe(DEFAULT_MODEL);
  });

  it('falls back to the default when a stored model no longer exists', async () => {
    store['nupta:settings'] = { v: 1, features: { quiz: { model: 'gone', enabled: true } } };
    expect((await loadSettings()).features.quiz.model).toBe(DEFAULT_MODEL);
  });

  it('migrates a user off a model that was retired upstream', async () => {
    // gemini-2.5-pro now 404s ("no longer available to new users"). Anyone who
    // had selected it must land on something that works, not a dead id.
    store['nupta:settings'] = { v: 1, features: { quiz: { model: 'gemini-2.5-pro', enabled: true } } };
    const s = await loadSettings();
    expect(s.features.quiz.model).toBe(DEFAULT_MODEL);
    expect(getModel(s.features.quiz.model)).toBeTruthy();
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(defaultSettings());
  });
});

describe('model catalog', () => {
  it('maps every model to a provider that actually exists', () => {
    for (const m of MODELS) {
      expect(Object.keys(PROVIDERS), m.id).toContain(m.provider);
    }
  });

  it('has no duplicate model ids', () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves the default model', () => {
    expect(getModel('gemini-2.5-flash')).toBeTruthy();
  });
});

/** OpenAI strict mode rejects any object missing these — assert recursively. */
function assertStrict(schema, path = 'root') {
  if (schema.type === 'object') {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(new Set(schema.required), `${path}.required`).toEqual(
      new Set(Object.keys(schema.properties))
    );
    for (const [k, v] of Object.entries(schema.properties)) assertStrict(v, `${path}.${k}`);
  }
  if (schema.type === 'array' && schema.items) assertStrict(schema.items, `${path}[]`);
}

describe('buildRequest', () => {
  it('asks only for the features in this group', () => {
    const { schema, prompt } = buildRequest({
      features: ['summary'],
      transcript: 'lecture text',
    });
    expect(Object.keys(schema.properties).sort()).toEqual(['ready', 'summary']);
    expect(prompt).toContain('lecture text');
    expect(prompt).not.toContain('flashcards —');
  });

  it('emits a schema that satisfies OpenAI strict mode at every level', () => {
    const { schema } = buildRequest({
      features: ['quiz', 'summary', 'flashcards', 'notes'],
      transcript: 't',
    });
    assertStrict(schema);
  });

  it('lets the gating call decide readiness', () => {
    const { prompt } = buildRequest({
      features: ['quiz'],
      transcript: 't',
      decidesReadiness: true,
    });
    expect(prompt).toMatch(/has the lecturer COMPLETED/i);
    expect(prompt).toMatch(/ready=false/);
  });

  it('tells a follow-up call the subtopic is already confirmed', () => {
    // Two models must not disagree about whether the checkpoint is happening.
    const { prompt } = buildRequest({
      features: ['flashcards'],
      transcript: 't',
      decidesReadiness: false,
    });
    expect(prompt).toMatch(/already been confirmed complete/i);
    expect(prompt).not.toMatch(/has the lecturer COMPLETED/i);
  });

  it('urges a final answer when the video has ended', () => {
    const { prompt } = buildRequest({ features: ['quiz'], transcript: 't', isFinal: true });
    expect(prompt).toMatch(/video has ENDED/i);
  });
});

describe('normalize', () => {
  it('returns only the keys this group was asked for', () => {
    const out = normalize({ ready: true, summary: { bullets: ['a'], concepts: ['b'] } }, [
      'summary',
    ]);
    expect(out).toEqual({ ready: true, summaryBullets: ['a'], keyConcepts: ['b'] });
    expect(out).not.toHaveProperty('questions');
  });

  it('drops malformed questions rather than showing a broken quiz', () => {
    const out = normalize(
      {
        ready: true,
        quiz: [
          { question: 'Good?', options: ['a', 'b'], answerIndex: 0 },
          { question: 'No options' },
          { options: ['a', 'b'] },
        ],
      },
      ['quiz']
    );
    expect(out.questions).toHaveLength(1);
  });

  it('drops flashcards missing a side', () => {
    const out = normalize(
      { ready: true, flashcards: [{ front: 'f', back: 'b' }, { front: 'only front' }] },
      ['flashcards']
    );
    expect(out.flashcards).toHaveLength(1);
  });

  it('drops AI notes with no points', () => {
    const out = normalize(
      { ready: true, notes: [{ subtopic: 'X', points: ['p'] }, { subtopic: 'Y', points: [] }] },
      ['notes']
    );
    expect(out.notes).toEqual([{ subtopic: 'X', points: ['p'] }]);
  });

  it('survives a response that is missing everything', () => {
    const out = normalize({}, ['quiz', 'summary', 'flashcards', 'notes']);
    expect(out).toEqual({
      ready: false,
      questions: [],
      summaryBullets: [],
      keyConcepts: [],
      flashcards: [],
      notes: [],
    });
  });
});

describe('parseBundledKey', () => {
  // This is what makes Gemini work out of the box. When it returned '' the
  // whole picker greyed out and claimed Gemini "needs API key", so each
  // supported spelling of config.js is pinned here.
  const KEY = 'AIzaEXAMPLEKEY0123456789abcdef';

  it('reads a plain const config', () => {
    expect(parseBundledKey(`const LCQ_CONFIG = {
  GEMINI_API_KEY: '${KEY}',
};`)).toBe(KEY);
  });

  it('reads an ES-module config', () => {
    expect(parseBundledKey(`export const LCQ_CONFIG = {
  GEMINI_API_KEY: '${KEY}',
};`)).toBe(KEY);
  });

  it('accepts double and backtick quotes', () => {
    expect(parseBundledKey(`const C = { GEMINI_API_KEY: "${KEY}" };`)).toBe(KEY);
    expect(parseBundledKey('const C = { GEMINI_API_KEY: `' + KEY + '` };')).toBe(KEY);
  });

  it('ignores other fields in the file', () => {
    expect(
      parseBundledKey(`export const C = {
 GEMINI_API_KEY: '${KEY}',
 GEMINI_MODEL: 'gemini-2.5-flash',
};`)
    ).toBe(KEY);
  });

  it('treats the untouched placeholder as no key', () => {
    expect(parseBundledKey("const C = { GEMINI_API_KEY: 'PASTE_YOUR_KEY_HERE' };")).toBe('');
  });

  it('returns empty for a missing or unreadable file', () => {
    expect(parseBundledKey('')).toBe('');
    expect(parseBundledKey(undefined)).toBe('');
    expect(parseBundledKey('// nothing useful here')).toBe('');
  });
});

describe('modelUsable — free tier is per model, not per provider', () => {
  const bundled = { configured: [], bundled: { gemini: true, groq: true } };
  const nothing = { configured: [], bundled: {} };
  const m = (id) => getModel(id);

  it('lets the bundled key run every free-tier Gemini model', () => {
    // Verified against the live API: these answer on the free tier.
    for (const id of ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']) {
      expect(modelUsable(m(id), bundled), id).toBe(true);
    }
  });

  it('does NOT offer Gemini Pro on the bundled key', () => {
    // It returns 429 quota without billing — offering it would fail mid-lecture.
    expect(modelUsable(m('gemini-3.1-pro-preview'), bundled)).toBe(false);
  });

  it('unlocks Gemini Pro once the user adds their own Gemini key', () => {
    expect(modelUsable(m('gemini-3.1-pro-preview'), { configured: ['gemini'], bundled: { gemini: true } })).toBe(true);
  });

  it('never offers Claude or GPT without a user key', () => {
    for (const id of ['claude-opus-5', 'gpt-5.2']) {
      expect(modelUsable(m(id), bundled), id).toBe(false);
    }
    expect(modelUsable(m('claude-opus-5'), { configured: ['anthropic'], bundled: { gemini: true } })).toBe(true);
  });

  it('offers nothing when there is no bundled key and no user key', () => {
    expect(MODELS.some((x) => modelUsable(x, nothing))).toBe(false);
  });

  it('defaults to a model that works with no setup at all', () => {
    expect(modelUsable(getModel(defaultSettings().features.quiz.model), bundled)).toBe(true);
  });

  it('has no model referencing a retired id', () => {
    // gemini-2.5-pro now 404s ("no longer available to new users").
    expect(MODELS.find((x) => x.id === 'gemini-2.5-pro')).toBeUndefined();
  });
});

describe('Groq models', () => {
  const bundled = { configured: [], bundled: { gemini: true, groq: true } };

  it('offers every Groq model on the bundled free key', () => {
    // Only models VERIFIED to honour a strict json_schema are in the catalog;
    // the engine cannot work without structured output.
    const groq = MODELS.filter((m) => m.provider === 'groq');
    expect(groq.length).toBeGreaterThan(0);
    for (const m of groq) expect(modelUsable(m, bundled), m.id).toBe(true);
  });

  it('excludes models that cannot do strict json_schema', () => {
    // qwen3.6-27b fails schema validation; groq/compound* reject json_schema.
    const ids = MODELS.map((m) => m.id);
    expect(ids).not.toContain('qwen/qwen3.6-27b');
    expect(ids.some((i) => i.startsWith('groq/compound'))).toBe(false);
  });

  it('keeps Groq model ids with their vendor prefix intact', () => {
    // These are sent verbatim; stripping the prefix would 404.
    expect(MODELS.find((m) => m.id === 'openai/gpt-oss-120b')?.provider).toBe('groq');
  });
});

describe('transcription engines', () => {
  const bundled = { configured: [], bundled: { groq: true } };
  const nothing = { configured: [], bundled: {} };

  it('defaults to on-device, which never uploads audio', () => {
    const t = getTranscriber(DEFAULT_TRANSCRIBER);
    expect(t.provider).toBe('local');
    expect(t.uploadsAudio).toBe(false);
    expect(defaultSettings().transcription.model).toBe(DEFAULT_TRANSCRIBER);
  });

  it('keeps on-device usable even with no keys at all', () => {
    expect(transcriberUsable(getTranscriber(DEFAULT_TRANSCRIBER), nothing)).toBe(true);
  });

  it('needs a key for every engine that uploads audio', () => {
    for (const t of TRANSCRIBERS.filter((x) => x.uploadsAudio)) {
      expect(transcriberUsable(t, nothing), t.id).toBe(false);
      expect(transcriberUsable(t, bundled), t.id).toBe(true);
    }
  });

  it('flags exactly the remote engines as uploading audio', () => {
    for (const t of TRANSCRIBERS) {
      expect(t.uploadsAudio, t.id).toBe(t.provider !== 'local');
    }
  });

  it('migrates a stored transcriber that no longer exists', async () => {
    store['nupta:settings'] = { v: 2, transcription: { model: 'whisper-that-was-removed' } };
    expect((await loadSettings()).transcription.model).toBe(DEFAULT_TRANSCRIBER);
  });

  it('gives settings saved before transcription existed a default', async () => {
    store['nupta:settings'] = { v: 1, features: {} };  // pre-transcription blob
    expect((await loadSettings()).transcription.model).toBe(DEFAULT_TRANSCRIBER);
  });
});

describe('parseBundledKey field selection', () => {
  const cfg = [
    'export const C = {',
    "  GEMINI_API_KEY: 'AIzaGGGGGGGGGGGGGGGGGGGG',",
    "  GROQ_API_KEY: 'gsk_QQQQQQQQQQQQQQQQQQQQ',",
    '};',
  ].join('\n');
  it('pulls each provider key independently', () => {
    expect(parseBundledKey(cfg, 'GEMINI_API_KEY')).toBe('AIzaGGGGGGGGGGGGGGGGGGGG');
    expect(parseBundledKey(cfg, 'GROQ_API_KEY')).toBe('gsk_QQQQQQQQQQQQQQQQQQQQ');
  });
  it('returns empty for a field that is absent', () => {
    expect(parseBundledKey("const C = { GEMINI_API_KEY: 'AIzaX0000000000000000' };", 'GROQ_API_KEY')).toBe('');
  });
});
