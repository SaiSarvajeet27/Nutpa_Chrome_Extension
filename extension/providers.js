// providers.js — one adapter per LLM vendor, behind a single `generate()` call.
//
// Every provider here can be asked for JSON matching a schema, but each spells
// that differently, so the engine writes ONE canonical JSON Schema and each
// adapter translates. Adding a vendor means adding an entry to ADAPTERS and
// nothing else — background.js never learns which vendor it's talking to.
//
// The API key is a parameter, never a module-level value: it is read from the
// encrypted vault at call time and goes out of scope when the call returns.

const MAX_OUTPUT_TOKENS = 8192; // the structured payload is small; keeps latency low

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
  if (status === 429 || /quota|rate.?limit|insufficient_quota/i.test(text)) {
    return new Error(`${providerLabel} rate limit or quota reached — try again shortly.`);
  }
  if (status === 402 || /billing|credit|payment/i.test(text)) {
    return new Error(`${providerLabel} reports a billing problem on your account.`);
  }
  if (status >= 500) {
    return new Error(`${providerLabel} is unavailable right now — retrying next checkpoint.`);
  }
  return new Error(`${providerLabel} error ${status}: ${text.slice(0, 200)}`);
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

const ADAPTERS = {
  gemini: generateGemini,
  anthropic: generateAnthropic,
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
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw httpError('OpenAI', r.status, await readError(r));
    return true;
  }
  throw new Error(`Unknown provider "${provider}".`);
}
