// checkpoint.js — builds the request for one checkpoint: what to ask for, in
// what shape. Provider-agnostic; providers.js translates the schema per vendor.
//
// One canonical JSON Schema serves all three vendors, so it is written to the
// strictest common denominator: every property listed in `required` and
// `additionalProperties: false` at every level, which is what OpenAI's strict
// mode demands. Fields that are conceptually optional are required-but-empty
// (empty string / empty array) rather than absent.

/** Object schema with every key required and no extras — the strict shape. */
function obj(properties) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const str = (description) => ({ type: 'string', description });
const arr = (items, description) => ({ type: 'array', items, description });

/**
 * Per-feature schema fragment + the prompt lines that explain it. Keeping the
 * two together is deliberate: a schema change that isn't explained in the
 * prompt produces confidently-shaped nonsense.
 */
const FEATURE_SPECS = {
  quiz: {
    schema: arr(
      obj({
        subtopic: str('The subtopic this question checks'),
        question: str('A self-contained multiple-choice question'),
        options: arr(str(), 'Exactly 4 options, one of them correct'),
        answerIndex: { type: 'integer', description: '0-based index of the correct option' },
        explanation: str('Why the correct option is correct'),
      }),
      'One question per completed subtopic (1-2 total)'
    ),
    instructions:
      'questions — EXACTLY ONE multiple-choice question per completed subtopic (1-2 total; if more ' +
      'than 2 subtopics completed, pick the 2 most important). Per question: name the subtopic; ' +
      '4 options with exactly one correct; plausible distractors; keep it self-contained and ' +
      'focused on the key point of the subtopic.',
  },

  summary: {
    schema: obj({
      bullets: arr(str(), '1-2 concise sentences on what was actually taught'),
      concepts: arr(str(), '2-4 short key terms covered'),
    }),
    instructions:
      'summary — bullets: 1-2 concise sentences capturing what was actually taught in this segment; ' +
      'concepts: 2-4 short key terms covered.',
  },

  flashcards: {
    schema: arr(
      obj({
        subtopic: str('The subtopic this card covers'),
        front: str('A standalone recall prompt'),
        back: str('The complete, concise answer'),
      }),
      'Exactly one study card per completed subtopic'
    ),
    instructions:
      'flashcards — EXACTLY ONE study card per completed subtopic. Cards must be INDEPENDENT of the ' +
      'quiz questions: never reuse or rephrase one. front = a standalone recall prompt for the core ' +
      'idea ("Define: X", "What is the formula for Y?"); back = the answer a student should recall.',
  },

  notes: {
    schema: arr(
      obj({
        subtopic: str('The subtopic these notes cover'),
        points: arr(str(), '2-5 short, factual note lines a student would write down'),
      }),
      'Structured notes per completed subtopic'
    ),
    instructions:
      'notes — per completed subtopic, 2-5 short factual note lines a student would actually write ' +
      'down: definitions, formulas, cause-and-effect, worked steps. Terse and concrete, not prose. ' +
      'These sit alongside the student\'s own typed notes, so do not editorialise.',
  },
};

const SYSTEM_PROMPT =
  'You are a tutor monitoring a live video lecture, checking that the student stays attentive. ' +
  'You are given an imperfect, auto-generated transcript of what the lecturer has said since the ' +
  'last checkpoint. The lecture may be in English, Hindi, or Hinglish, but you ALWAYS write your ' +
  'output in English only; standard technical terms used by the lecturer stay as-is. Ignore ' +
  'transcription glitches and never refer to "the transcript" in anything you write.';

/**
 * Build one request.
 *
 * @param {string[]} features       which outputs this call should produce
 * @param {string}   transcript     speech since the last checkpoint
 * @param {boolean}  isFinal        the video just ended — last chance to quiz
 * @param {boolean}  decidesReadiness
 *        When true this call judges whether a subtopic actually completed, and
 *        may answer ready=false to produce nothing. When false, a previous call
 *        already decided a subtopic completed and this one just does its job —
 *        that's what keeps two models from disagreeing about whether the
 *        checkpoint is happening at all.
 */
export function buildRequest({ features, transcript, isFinal = false, decidesReadiness = true }) {
  const wanted = features.filter((f) => FEATURE_SPECS[f]);
  const properties = {
    ready: {
      type: 'boolean',
      description: decidesReadiness
        ? 'true only if at least one subtopic is fully covered'
        : 'always true — a subtopic has already been confirmed complete',
    },
  };
  for (const f of wanted) properties[f] = FEATURE_SPECS[f].schema;

  const asks = wanted.map((f) => FEATURE_SPECS[f].instructions).join('\n');

  const gate = decidesReadiness
    ? (isFinal
        ? 'The video has ENDED — this is the last chance to quiz. If there is ANY testable content ' +
          'at all, answer ready=true. '
        : '') +
      'First decide: has the lecturer COMPLETED at least one coherent subtopic with enough ' +
      'substance to test? A subtopic is complete when its explanation has clearly concluded — not ' +
      'mid-explanation. If no subtopic is complete yet, or the content is too thin, answer ' +
      'ready=false with every other field empty, and the student simply keeps watching. ' +
      'If 1-2 subtopics are complete, answer ready=true and provide:'
    : 'A subtopic has already been confirmed complete for this segment. Set ready=true and provide:';

  const prompt =
    `${gate}\n\n${asks}\n\n` +
    'When ready=false, every array must be empty.\n\nTRANSCRIPT:\n' +
    transcript;

  return {
    system: SYSTEM_PROMPT,
    prompt,
    schema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

/** Coerce one raw model response into the shape the rest of the engine expects. */
export function normalize(result, features) {
  const out = { ready: !!result?.ready };
  const has = (f) => features.includes(f);

  if (has('quiz')) {
    out.questions = (Array.isArray(result?.quiz) ? result.quiz : []).filter(
      (q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2
    );
  }
  if (has('summary')) {
    const s = result?.summary || {};
    out.summaryBullets = Array.isArray(s.bullets) ? s.bullets.filter(Boolean) : [];
    out.keyConcepts = Array.isArray(s.concepts) ? s.concepts.filter(Boolean) : [];
  }
  if (has('flashcards')) {
    out.flashcards = (Array.isArray(result?.flashcards) ? result.flashcards : []).filter(
      (f) => f && f.front && f.back
    );
  }
  if (has('notes')) {
    out.notes = (Array.isArray(result?.notes) ? result.notes : [])
      .filter((n) => n && Array.isArray(n.points) && n.points.length)
      .map((n) => ({ subtopic: n.subtopic || '', points: n.points.filter(Boolean) }));
  }
  return out;
}
