// providers.js — one adapter per LLM vendor, behind a single `generate()` call.
//
// Every provider here can be asked for JSON matching a schema, but each spells
// that differently, so the engine writes ONE canonical JSON Schema and each
// adapter translates. Adding a vendor means adding an entry to ADAPTERS and
// nothing else — background.js never learns which vendor it's talking to.
//
// The API key is a parameter, never a module-level value: it is read from
// storage at call time and goes out of scope when the call returns.

const MAX_OUTPUT_TOKENS = 8192; // the structured payload is small; keeps latency low

/**
 * Per-provider output cap, where the default would break the request.
 *
 * Groq's free tier bills INPUT + OUTPUT against one 8,000 tokens-per-minute
 * budget, and rejects the request outright (HTTP 413) if the declared
 * max_completion_tokens alone could exceed it. At 8192 every Groq call failed
 * before the model saw it. A checkpoint response is a couple of questions and a
 * handful of bullets — 2,048 is ample, and it leaves ~6,000 for the transcript,
 * comfortably above the ~4,000 the prompt window can reach.
 */
const PROVIDER_OUTPUT_TOKENS = { groq: 2048 };
const outputTokensFor = (provider) => PROVIDER_OUTPUT_TOKENS[provider] ?? MAX_OUTPUT_TOKENS;

/**
 * Gemini takes a dialect of JSON Schema with uppercase type names and no
 * `additionalProperties`. Translate rather than maintaining two schema copies.
 */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

/** Pull the first JSON object out of a response that may be fenced or prefaced. */
function parseJsonLoose(text, provider) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error(`${provider} returned an empty response.`);
  try {
    return JSON.parse(trimmed);
  } catch {
    // Structured output should make this unreachable, but a model that ignores
    // the schema shouldn't take the whole checkpoint down.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    throw new Error(`${provider} did not return valid JSON.`);
  }
}

/** Turn an HTTP failure into something a student can act on. */
function httpError(providerLabel, status, body) {
  const text = String(body || '');
  if (status === 401 || status === 403 || /api[_ -]?key|unauthor|permission|invalid_api/i.test(text)) {
    return new Error(`${providerLabel} rejected the API key — check it in Nupta's settings.`);
  }
  if (status === 413 || /request too large|reduce your message size/i.test(text)) {
    return new Error(
      `${providerLabel} rejected the request as too large for its free tier — ` +
        'the next checkpoint uses a shorter transcript window.'
    );
  }
  if (status === 429 || /quota|rate.?limit|insufficient_quota|tokens per minute/i.test(text)) {
    return new Error(`${providerLabel} rate limit reached — the next checkpoint will retry.`);
  }
  if (status === 402 || /billing|credit|payment/i.test(text)) {
    return new Error(`${providerLabel} reports a billing problem on your account.`);
  }
  if (status >= 500) {
    return new Error(`${providerLabel} is unavailable right now — retrying next checkpoint.`);
  }
  // Unexpected status: the raw body is the only useful diagnostic, but it is
  // provider-controlled text that ends up in session.lastError and on screen.
  // Some providers echo the submitted key back in an error ("Incorrect API key
  // provided: sk-…"), so scrub anything key-shaped before it can be displayed,
  // logged, or screenshotted.
  return new Error(`${providerLabel} error ${status}: ${redactKeys(text).slice(0, 200)}`);
}

/**
 * Replace anything shaped like a provider API key with a placeholder.
 * Deliberately broad — a false positive costs a less precise error message,
 * a false negative puts a live credential on screen.
 */
export function redactKeys(text) {
  return String(text || '')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[REDACTED]')
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, 'AIza[REDACTED]')
    .replace(/gsk_[A-Za-z0-9_-]{8,}/g, 'gsk_[REDACTED]');
}

async function readError(resp) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

// ── Google Gemini ────────────────────────────────────────────────────────────
async function generateGemini({ apiKey, model, system, prompt, schema }) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
        },
      }),
    }
  );
  if (!resp.ok) throw httpError('Gemini', resp.status, await readError(resp));
  const data = await resp.json();
  return parseJsonLoose(data?.candidates?.[0]?.content?.parts?.[0]?.text, 'Gemini');
}

// ── Anthropic Claude ─────────────────────────────────────────────────────────
async function generateAnthropic({ apiKey, model, system, prompt, schema }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required when the caller looks like a browser. An MV3 service worker
      // with host_permissions isn't subject to page CORS, but the API also
      // gates on this header, and sending it costs nothing.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
      // Structured outputs are GA — no beta header. NOTE: do not add
      // `temperature` here; sampling parameters are rejected with a 400 on
      // Opus 5 / Sonnet 5 and the rest of the current generation.
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!resp.ok) throw httpError('Claude', resp.status, await readError(resp));
  const data = await resp.json();
  // Safety classifiers can decline with HTTP 200 — check before reading content.
  if (data?.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer for this lecture segment.');
  }
  const block = (data?.content || []).find((b) => b.type === 'text');
  return parseJsonLoose(block?.text, 'Claude');
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function generateOpenAI({ apiKey, model, system, prompt, schema }) {
  // Strict mode requires every property to be listed in `required` and
  // additionalProperties:false at each level — the canonical schemas already
  // satisfy that, which is why they're written that way.
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'nupta_checkpoint', strict: true, schema },
    },
  };

  const post = (tokenField) =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, [tokenField]: MAX_OUTPUT_TOKENS }),
    });

  // OpenAI renamed the output cap to `max_completion_tokens`, and which one a
  // model accepts depends on its generation. Try the current name, and fall
  // back once if this model only knows the old one.
  let resp = await post('max_completion_tokens');
  if (resp.status === 400) {
    const text = await readError(resp);
    if (/max_completion_tokens|unsupported_parameter|unknown_parameter/i.test(text)) {
      resp = await post('max_tokens');
    } else {
      throw httpError('OpenAI', 400, text);
    }
  }
  if (!resp.ok) throw httpError('OpenAI', resp.status, await readError(resp));
  const data = await resp.json();
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`OpenAI declined: ${choice.message.refusal}`);
  }
  return parseJsonLoose(choice?.message?.content, 'OpenAI');
}

/**
 * Groq speaks the OpenAI Chat Completions dialect, so this mirrors the OpenAI
 * adapter — but it is a SEPARATE function rather than a shared one with a
 * base-URL switch, because the two diverge in ways that matter: Groq always
 * wants `max_completion_tokens`, has its own error vocabulary, and its model ids
 * carry vendor prefixes (`openai/gpt-oss-120b`) that must be sent verbatim.
 */
async function generateGroq({ apiKey, model, system, prompt, schema }) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: outputTokensFor('groq'),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'nupta_checkpoint', strict: true, schema },
      },
    }),
  });
  if (!resp.ok) throw httpError('Groq', resp.status, await readError(resp));
  const data = await resp.json();
  return parseJsonLoose(data?.choices?.[0]?.message?.content, 'Groq');
}

/**
 * Remote speech-to-text (Groq Whisper).
 *
 * Takes a WAV the offscreen page has already encoded from captured PCM, and
 * returns plain text. `signal` lets a caller abandon a chunk that is taking too
 * long rather than stalling the whole transcript.
 */
export async function transcribeRemote({ provider, model, apiKey, wavBlob, signal }) {
  if (provider !== 'groq') throw new Error(`Unknown transcription provider: ${provider}`);
  const form = new FormData();
  form.append('file', wavBlob, 'audio.wav');
  form.append('model', model);
  form.append('response_format', 'json');
  // Nudges Whisper away from hallucinating punctuation-only output on silence.
  form.append('temperature', '0');

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!resp.ok) throw httpError('Groq', resp.status, await readError(resp));
  const data = await resp.json();
  return typeof data?.text === 'string' ? data.text : '';
}

const ADAPTERS = {
  gemini: generateGemini,
  anthropic: generateAnthropic,
  groq: generateGroq,
  openai: generateOpenAI,
};

/**
 * Ask `provider`'s `model` for JSON matching `schema`.
 * @returns {Promise<object>} the parsed object
 */
export async function generate({ provider, model, apiKey, system, prompt, schema }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown provider "${provider}".`);
  if (!apiKey) throw new Error(`No API key set for ${provider}.`);
  return adapter({ apiKey, model, system, prompt, schema });
}

/**
 * Cheap credential check for the options page: a 1-token round trip that
 * proves the key works without generating anything.
 */
export async function verifyKey(provider, apiKey) {
  if (!apiKey) throw new Error('Enter a key first.');
  if (provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!r.ok) throw httpError('Gemini', r.status, await readError(r));
    return true;
  }
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!r.ok) throw httpError('Claude', r.status, await readError(r));
    return true;
  }
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw httpError('Groq', r.status, await readError(r));
    return true;
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw httpError('OpenAI', r.status, await readError(r));
    return true;
  }
  throw new Error(`Unknown provider "${provider}".`);
}
