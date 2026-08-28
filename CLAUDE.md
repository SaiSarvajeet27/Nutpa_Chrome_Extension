# CLAUDE.md — project guide for Claude Code

nupta ("Learning Intelligence") is a Manifest V3 Chrome extension that keeps students
attentive during online lectures. It transcribes lecture audio **locally** and, when the
instructor finishes a subtopic, pauses the video and shows an AI quiz — while also
auto-building notes, a summary, and spaced-repetition flashcards.

---

## ⚠️ Critical workflow — read before editing

1. **`extension/content.js` is GENERATED, never hand-edit it.** It is the compiled bundle of
   everything under `src/`. To change the widget UI or content-script logic, edit `src/`, then run:
   ```bash
   npm run build:ext
   ```
   This rebuilds `extension/content.js` via `vite.config.ext.ts`. After building, reload the
   extension in `chrome://extensions` (click ↻) and reload the lecture tab.

2. **`extension/config.js` is the default Gemini key and is gitignored.** Never commit it, never
   print the key. It is what makes Gemini work out of the box; a Gemini key entered on the API keys
   screen overrides it. The worker **fetches it as text and parses it** (`parseBundledKey`) — it is
   never imported and never executed, so `const` or `export const` both work.
   **Do not switch this to `import()`**: service workers forbid dynamic import, so the call always
   rejects, and a static import would break the worker whenever this gitignored file is absent. That
   bug greyed out every model in every dropdown with "needs API key".

3. **The other `extension/` files ARE the shipped extension and are edited directly** (they're
   plain JS/HTML, not built): `background.js`, `models.js`, `providers.js`, `checkpoint.js`,
   `keys.js`, `options.*`, `offscreen.js`, `offscreen.html`, `pcm-worklet.js`, `manifest.json`.
   Only `content.js` comes from a build. The service worker is `"type": "module"`, so these use
   real `import`/`export` — not `importScripts`.

4. **To load/test:** `chrome://extensions` → Developer mode → Load unpacked → select the
   **`extension`** folder (NOT the repo root — the manifest lives in `extension/`).

---

## Architecture (data flow)

```
tab audio ─chrome.tabCapture→ offscreen doc ─Whisper (transformers.js, WebGPU)→ rolling transcript
video ─content script (all frames)→ every 2 min → background service worker
     └→ Gemini 2.5 Flash (free tier): "did a subtopic finish?" → ONE JSON response with
        quiz questions + summary bullets + key concepts + flashcards
     └→ React widget (top frame, Shadow DOM) renders it; results persist in chrome.storage.local
```

- **Local transcription:** OpenAI Whisper `onnx-community/whisper-base` (multilingual: EN/HI/Hinglish)
  via transformers.js. WebGPU first, CPU/WASM fallback. 30s chunks, 16 kHz, silence skipped.
  Runtime + wasm live in `extension/libs/` (committed; large but under GitHub's 100 MB/file limit).
- **One Gemini call per checkpoint** returns quiz + summary + concepts + flashcards together
  (structured `responseSchema`). This keeps everything inside the free tier (~30 calls/hr).
- **Free tier is per MODEL, not per provider** (`modelUsable()` in models.js). Gemini *Flash* and
  all Groq models answer on a bundled key; Gemini *Pro* returns 429 without billing, so it needs
  the user's own key like Claude and GPT. Verify against the live API before marking a new model
  `freeTier: true` — do not infer it from the provider.
- **Transcription is a separate axis** (`TRANSCRIBERS`): one engine per session, not per feature.
  `local` (on-device Whisper) is the default and the privacy promise; the Groq engines UPLOAD
  audio, so every remote entry carries `uploadsAudio: true` and the UI must show it.
  `resolveTranscriptionEngine()` fails **closed to local** when a remote engine has no key —
  the worst case must be slower transcription, never unexpected upload.
- **Groq's free tier is 8,000 tokens/minute for input + output combined**, and rejects a request
  whose declared `max_completion_tokens` alone could exceed it (HTTP 413). `PROVIDER_OUTPUT_TOKENS`
  in providers.js caps Groq at 2,048 for exactly this reason — the default 8,192 made every Groq
  call fail before the model saw it. Only models verified to honour a **strict** `json_schema` are
  in the catalog (`qwen3.6-27b` fails validation, `groq/compound*` reject it outright).
- **Subtopic detection is an AI judgment, not a timer** — Gemini decides if a subtopic *concluded*.

---

## File map

```
extension/                     the loadable extension (Load unpacked → here)
  manifest.json                MV3 config; content script injected on <all_urls>, all_frames
  background.js                service worker (ES module): capture, checkpoint routing, message relay
  models.js                    catalog of providers/models + per-feature settings + call grouping
  providers.js                 one adapter per vendor (Gemini / Anthropic / OpenAI) behind generate()
  checkpoint.js                canonical prompt + JSON Schema per feature; response normalization
  keys.js                      plain per-provider API key storage (chrome.storage.local)
  options.html/.css/.js        API keys screen
  *.test.js                    vitest suites for the engine and key storage
  offscreen.js / offscreen.html  local Whisper transcription (offscreen document)
  pcm-worklet.js               AudioWorklet that forwards PCM to the offscreen page
  content.js                   ⚙️ BUILT bundle of src/content/* + components — DO NOT EDIT
  libs/                        Whisper runtime (transformers.min.js + onnxruntime wasm variants)
  config.example.js            template; copy to config.js and add key (config.js is gitignored)
src/
  content/
    main.tsx                   content-script entry: mounts widget in Shadow DOM (top frame only),
                               inits the video tracker (all frames). Handles rem→px scaling + hotkey blocking.
    ContentApp.tsx             bridges engine messages ↔ Sidebar; owns quiz/notes/summary/cards state
    videoTracker.ts            per-frame <video> control: watched-time, pause/resume/seek, evaluate triggers
    storage.ts                 chrome.storage.local persistence + SM-2-lite flashcard scheduling
    storage.test.ts            vitest: videoKey, SM-2 scheduling, due labels, write serialization
  components/
    Sidebar.tsx                the floating ball + resizable/draggable panel + tab bar (GooeyNav)
    ModelPicker.tsx            the small per-tab model dropdown (one feature each)
    KeysPanel.tsx              API key entry, in-panel — never opens a browser tab
    tabs/FocusTab.tsx          live MCQ quiz UI (also has demo-mode fallback)
    tabs/NotesTab.tsx          timestamped, seekable, persisted notes
    tabs/SummaryTab.tsx        live-building summary + concept chips
    tabs/FlashcardsTab.tsx     spaced-repetition deck, one card per subtopic
  App.tsx                      DEMO PAGE ONLY (npm run dev) — mock data, not part of the extension
vite.config.ext.ts            builds src/content/main.tsx → extension/content.js (IIFE)
vite.config.ts                builds the demo page (npm run dev / npm run build)
```

---

## Message protocol (background ↔ content ↔ offscreen)

- UI/tracker → background: `START_MONITORING`, `STOP_MONITORING`, `GET_STATUS`, `EVALUATE`,
  `VIDEO_TIME`, `PAUSE_VIDEO`, `RESUME_VIDEO`, `SEEK_VIDEO`
- background → tab (all frames): `MONITORING_STARTED/STOPPED`, `QUIZ_READY` (carries questions +
  summaryBullets + keyConcepts + flashcards), `QUIZ_ERROR`, `PAUSE_VIDEO`, `RESUME_VIDEO`, `SEEK_VIDEO`
- background ↔ offscreen (`target:'offscreen'`): `OFFSCREEN_START/STOP`, `GET_TRANSCRIPT`,
  `CONSUME_TRANSCRIPT`, `TRIM_TRANSCRIPT`, and `WHISPER_STATUS` back to background

`GET_STATUS` returns the whole session, so it also carries `whisper` (model/capture state),
`video` (position reported by whichever frame owns the player) and `lastError` (Gemini failures,
shown in the widget's status line).

Quiz sequence: Gemini returns → `QUIZ_READY` → ball ripples ~4s (heads-up) → `PAUSE_VIDEO` →
panel auto-opens on Focus → answer/skip → `RESUME_VIDEO`.

---

## Multi-model routing (how a checkpoint actually runs)

Each of the four AI features — `quiz`, `summary`, `flashcards`, `notes` — is independently
assigned a model from that tab's dropdown. `background.js` then:

1. `groupFeaturesByModel()` buckets the **enabled** features by the model serving them.
2. The group owning `quiz` runs **first, alone**, and answers the gating question ("did a subtopic
   actually finish?"). If quiz is disabled, the first group inherits that job.
3. Only if the gate says ready do the remaining groups run — in parallel, with
   `decidesReadiness: false`, so no two models can disagree about whether the checkpoint is
   happening, and nothing is spent on a segment that didn't finish a subtopic.
4. `Promise.allSettled` — one failing provider degrades that feature, never the whole checkpoint.

**The cost invariant:** when every feature points at one model (the default), step 1 yields ONE
group, so a checkpoint is still a single API call returning everything — exactly the original
design. Only a user who deliberately splits features pays for more calls. `engine.test.js` asserts
this; don't let a refactor break it.

One canonical JSON Schema serves all three vendors, written to the strictest common denominator
(every property in `required`, `additionalProperties: false`, recursively) because that is what
OpenAI's strict mode demands. `providers.js` translates it — Gemini needs uppercase type names.

## API keys

`keys.js` stores one key per provider in `chrome.storage.local`. Deliberately
plain — no passphrase, no unlock step. Read the header comment there for exactly
what that protects and what it does not, and don't let the UI overclaim it.

- Keys are read **only in the service worker**. A key must never be sent to a
  content script.
- `SETTINGS_GET` returns `configured` — provider names only. Key material never
  crosses to any UI, which is why every key field is a blank write-only input.
- Keys are verified against the provider before being stored, so a bad paste
  fails at entry rather than mid-lecture.
- Key entry lives **inside the panel** (`KeysPanel.tsx`), taking over the content
  area with a back arrow. Do not route it to the options page: sending someone to
  a separate browser tab mid-lecture loses their place. `options.html` remains as
  a standalone fallback, but nothing in the widget opens it.

## Invariants worth keeping (each one is a bug that was fixed)

- **The transcript window is bounded.** If Gemini keeps saying "not ready", `background.js` caps the
  prompt at `MAX_PROMPT_WORDS` and sends `TRIM_TRANSCRIPT` so the same speech isn't paid for on every
  future checkpoint. Don't remove the cap.
- **The offscreen transcript is addressed by absolute `seq`, not array index.** Trimming can retire
  parts while Gemini is thinking; an index would then consume the wrong ones.
- **The widget's poll is idle-cheap.** `content.js` is injected into every frame of every page, so
  `ContentApp` polls at `ACTIVE_POLL_MS` only on the monitored tab and `IDLE_POLL_MS` everywhere
  else. Never go back to an unconditional fast `setInterval`.
- **Storage writes go through `updateCards` / `updateLecture`.** They serialize the whole
  read-modify-write cycle. Calling `loadCards` + `saveCards` directly re-introduces lost updates.
- **Flashcard identity is scoped by `videoKey`.** Two courses may both cover "Fourier Transform" and
  each needs its own card; global dedupe silently dropped the second one.
- **`main.tsx` guards on `window.__nuptaInjected`.** The background re-injects the bundle via
  `chrome.scripting` when a tab has no listener; without the guard the tracker registers twice and
  every `EVALUATE` fires twice.

## Gotchas learned the hard way (don't re-introduce these)

- **rem units break on YouTube.** YouTube sets root font-size to 10px, shrinking rem-based Tailwind.
  `main.tsx` converts rem→px at injection (`* 17.5`). Keep that; don't rely on rem sizing in the widget.
- **Shadow-DOM hotkey leak.** Key events bubble to YouTube's shortcuts (k/j/l/f/digits) while typing
  in the panel. `main.tsx` stops keydown/keyup/keypress propagation at the host element. Keep it.
- **The ball only mounts on the monitored tab** and only while monitoring (`activeHere` from GET_STATUS).
- **All tabs stay mounted** (display toggled, not conditional render) so switching tabs doesn't lose quiz progress.
- **Tailwind v4 gradient classes** (`bg-gradient-to-r from-… to-…`) don't generate here — use inline `linear-gradient`.
- **GitHub push protection** false-positives on `libs/transformers.min.js` (matches a "Mistral key" pattern).
  It's a public library, not a secret — use the unblock link if it ever blocks a push.
- **SPA navigation** (YouTube next video) doesn't reload the page — `ContentApp` polls `location.href`
  and reloads per-lecture data on change.

---

## Commands

```bash
npm install            # once
npm run dev            # demo page at localhost:5173 (mock data, for UI work)
npm run build:ext      # rebuild extension/content.js  ← run after ANY src/ change
npm run check          # tsc + oxlint + vitest — run before committing
npm test               # vitest only
npm run lint           # oxlint only
```

`npm run build:ext` must leave `extension/content.js` as the ONLY changed file there — the config
drops the dead CSS chunk and skips `public/`, so anything else appearing is a regression.

## Cost / privacy model
Transcription is 100% on-device (no audio leaves the machine, no per-user cost). The only external
call is Gemini for generation; the free tier (~1,500 req/day) covers heavy daily use. Notes/summaries/
cards live in `chrome.storage.local` — no backend, no account.
