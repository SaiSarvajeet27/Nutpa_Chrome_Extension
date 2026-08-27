# nupta — Learning Intelligence

A Chrome extension that keeps students attentive during online lectures and turns passive watching
into active recall. It follows the lecture through a **live, on-device transcript** and, whenever the
instructor finishes a subtopic, pauses the video and asks a quick comprehension question — then
automatically builds the student's **notes, summary, and spaced-repetition flashcards** along the way.

Works on **any site with a video player**. Speech-to-text runs **entirely in the browser**
(Whisper on WebGPU), so lecture audio never leaves the machine and there is **no per-user
transcription cost**.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Choosing a model per feature](#choosing-a-model-per-feature)
- [API keys and how they are protected](#api-keys-and-how-they-are-protected)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Limitations](#limitations)

---

## Features

Four tabs in a floating panel you can drag anywhere on the page:

| Tab | What it does |
|---|---|
| **Focus** | When a subtopic completes, the video pauses and 1–2 multiple-choice questions appear, tagged by subtopic and with explanations. The floating ball ripples amber a few seconds beforehand, so a pause is never a surprise. |
| **Notes** | Type notes tagged with the exact video timestamp; click a timestamp to jump the video back to that moment. Optionally, AI-written notes are merged in alongside your own (marked `✦ AUTO`, and hideable). |
| **Summary** | Key points and concept tags accumulate as the lecture progresses. One-click copy. |
| **Cards** | One flashcard per subtopic, generated automatically, with real spaced-repetition scheduling — *"Got it"* pushes a card further out (1 → 2 → 4 days, capped at 30), *"Hard"* brings it back in 30 minutes. Questions you answer wrong become due immediately. |

Everything persists locally per lecture in `chrome.storage.local`. No account, no sign-in, no backend.
Handles **English, Hindi, and Hinglish** lectures (questions are always written in English).

---

## Quick start

### 1. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the **`extension`** folder — *not* the repo root; the manifest lives in
   `extension/`
4. Confirm the card shows the version you expect. If you have more than one copy of this repo
   checked out, check **Loaded from** on the details page — it is easy to reload the wrong folder and
   wonder why nothing changed.

### 2. Use it

Open a lecture, click the nupta toolbar icon once (the badge shows **ON** and a floating ball
appears), and play the video.

The first run downloads the Whisper model (~75 MB, once — progress is shown in the panel). After
that, questions appear on their own as subtopics complete.

Clicking the icon again stops monitoring. Clicking it on a *different* tab moves monitoring there.

### 3. That's it

**No API key is required.** The extension ships with free-tier Gemini access, and every feature
defaults to a free model. Keys are only needed if you want to run a feature on Claude, GPT, or
Gemini Pro — see below.

> **Maintainers:** the bundled key lives in `extension/config.js`, which is **gitignored**. Copy
> `extension/config.example.js` to `config.js` and paste a Gemini key
> ([free, no credit card](https://aistudio.google.com/apikey)). Without it the extension still runs,
> but users must add their own key. Never commit `config.js`.

---

## Choosing a model per feature

Each tab has a small dropdown at the top choosing the model that powers **that tab only**:

| Feature | Tab | What it generates |
|---|---|---|
| **Quiz** | Focus | The comprehension questions — and the judgment of *whether* a subtopic actually finished, which gates everything else |
| **Summary** | Summary | Running key points and concept tags |
| **Flashcards** | Cards | One spaced-repetition card per subtopic |
| **Auto-notes** | Notes | Structured notes written alongside your own (**off by default**) |

The first option in every dropdown is **Off**, which disables that feature. Turning something off
remembers the model, so switching back returns to what you chose.

### What's free and what isn't

Free tier is decided **per model, not per provider** — "Gemini is free" is not true of every Gemini
model:

| Model | Needs your own key? |
|---|---|
| **Gemini 3.7 Flash** *(default)* | No — free |
| **Gemini 3.5 Flash** | No — free |
| **Gemini 3.5 Flash Lite** | No — free |
| **Gemini 2.5 Flash** | No — free |
| Gemini 3.1 Pro | **Yes** — Gemini key with billing |
| Claude Opus 5 / Sonnet 5 / Haiku 4.5 | **Yes** — Anthropic key |
| GPT-5.2 / GPT-5 mini / GPT-4.1 | **Yes** — OpenAI key |

Models you can't use yet are shown but greyed out and labelled `— add key`, with an **＋ Key** button
beside the dropdown — so an unavailable option never silently disappears without explaining itself.

### What it costs

Features that share a model are answered in a **single request**. Leaving everything on Gemini is
therefore **one free call per checkpoint** — exactly as it was before per-feature selection existed.
Split features across three providers and you get three calls per checkpoint, two of them billed to
you.

If a key is missing, that feature quietly falls back to the free Gemini model and says so in the
panel's status line rather than interrupting the lecture.

---

## API keys and how they are protected

Keys are entered in the panel: **＋ Key** next to any model dropdown, or the ⚙ gear in the panel
header. Paste, **Save**, done — no passphrase, no unlock step. Each key is **verified against the
provider before it is stored**, so a bad paste fails immediately rather than silently mid-lecture.

### Who can access a stored key

**Can:**

| Who | How |
|---|---|
| You | It's your machine |
| Anyone with access to your **unlocked Chrome profile** | `chrome.storage.local` is a plain file in the profile directory, and is also readable via devtools |
| Malware running as your user | Reads the profile directory — no in-browser code can defend against this |
| The AI provider you chose | You are authenticating to them. Keys are never cross-sent between providers. |

**Cannot:**

| Who | Why |
|---|---|
| **Any website you visit** | The extension declares no `externally_connectable`, so pages cannot message it at all. Stored keys are read **only inside the service worker** and are never sent to a content script. |
| **Other extensions** | `chrome.storage.local` is per-extension |
| **Any server of ours** | There isn't one. Nupta is entirely on-device. |
| **The settings UI itself** | It can *store* a key and ask *whether* a provider is configured, but cannot read one back — which is why key fields are always blank with a placeholder rather than showing the saved value. |
| Anyone reading a URL or a log | Keys are sent in HTTP headers, never in query strings. Provider error messages are scrubbed of anything key-shaped before being displayed, because some providers echo the submitted key back in an error. |

### The honest limits

- **Not encrypted on disk.** `chrome.storage.local` is plaintext. This is the same posture as
  essentially every extension that stores an API key, and it is the tradeoff for having no
  passphrase to type. **Treat these keys like a saved browser password.**
- **Entry happens inside the page.** The keys screen lives in the widget, so a key being typed
  passes through the content script. The panel uses a **closed shadow root** and swallows key events,
  so an ordinary page cannot read the field or log the keystrokes — but a page that patches
  `Element.prototype.attachShadow` before the content script runs could capture it. This is inherent
  to typing a secret into an in-page UI. `extension/options.html` is the hardened alternative: an
  extension page with no host page in it at all.

### Practical advice

Set a **spend limit** at the provider. That caps the damage far more effectively than anything an
extension can do in-browser. If a key is ever exposed, **revoke it** — that's the recovery path, and
it's why a "Manage keys ↗" link sits next to every provider.

---

## Architecture

```
tab audio ──tabCapture──▶ offscreen page ──Whisper (local, transformers.js, WebGPU)──▶ rolling transcript
video playback ──content script (all frames)──▶ every 2 min ──▶ background service worker
        └─▶ model(s): "did a subtopic finish?" → quiz + summary + concepts + flashcards
        └─▶ React widget (ball + panel, closed Shadow DOM) shows the quiz; results persist locally
```

- **Manifest V3.** The engine is a vanilla-JS **module service worker** plus an offscreen document;
  the UI is **React 19 + TypeScript + Tailwind**, injected as a content script inside a **closed
  Shadow DOM** so page styles and widget styles cannot collide.
- **Local transcription:** OpenAI Whisper (`base`, multilingual) via `transformers.js`, WebGPU with a
  CPU/WASM fallback. 30-second chunks at 16 kHz, silence auto-skipped.
- **Subtopic detection is an AI judgment, not a timer.** The model decides whether the lecturer
  actually *concluded* a subtopic; if not, nothing interrupts and the transcript window keeps growing
  (bounded, so a rambling lecture can't inflate cost indefinitely).
- **Multi-model routing.** Enabled features are grouped by the model serving them. The group owning
  `quiz` runs first and alone, because it also answers the gating question; the rest run only if it
  says a subtopic finished, in parallel. One failing provider degrades that one feature rather than
  the whole checkpoint.

---

## Repository layout

```
extension/               ← the loadable Chrome extension ("Load unpacked" here)
  manifest.json
  background.js           service worker: capture, checkpoint routing, provider calls
  models.js               catalog of providers/models, per-feature settings, call grouping
  providers.js            one adapter per vendor (Gemini / Anthropic / OpenAI)
  checkpoint.js           canonical prompt + JSON Schema per feature, response normalization
  keys.js                 API key storage (read the header comment before changing it)
  options.html/.css/.js   standalone API keys page (the in-panel screen is the primary one)
  offscreen.js/.html      local Whisper transcription
  pcm-worklet.js          audio capture worklet
  content.js              ⚙️ BUILT React widget bundle — never edit by hand
  libs/                   Whisper runtime (transformers.js + onnxruntime wasm)
  config.example.js       copy to config.js to bundle a free Gemini key (config.js is gitignored)
src/                     ← React source (demo page + content-script code)
  components/             Sidebar, ModelPicker, KeysPanel, and the four tabs
  content/                extension entry, video tracker, storage layer
vite.config.ext.ts       builds src/content → extension/content.js
```

---

## Development

`extension/content.js` ships prebuilt, so the extension runs without a build step. To change the
React UI:

```bash
npm install
npm run dev        # demo page at localhost:5173 (mock data, no extension needed)
npm run build:ext  # rebuild extension/content.js — required after ANY src/ change
npm run check      # typecheck + lint + tests
```

After `build:ext`, reload the extension in `chrome://extensions` **and** reload the lecture tab.

`npm run build:ext` should leave `extension/content.js` as the only changed file in `extension/`.
Anything else appearing there is a regression in the build config.

See [`CLAUDE.md`](CLAUDE.md) for the invariants worth preserving — each one documents a bug that has
already been fixed once.

---

## Tech stack

| Piece | Tool |
|---|---|
| Transcription | Whisper (base, multilingual) via transformers.js — in-browser, WebGPU |
| Question / study generation | Gemini (free tier) by default; Claude and OpenAI optional |
| UI | React 19 + TypeScript + Tailwind (Vite) |
| Runtime | Chrome Manifest V3, `chrome.storage.local` |
| Tests | Vitest |

---

## Limitations

- Needs a reasonably modern GPU for real-time transcription; falls back to CPU, which is slower.
- YouTube ads get transcribed too and can occasionally colour a question.
- The content script is injected on `<all_urls>` so the widget works on any lecture site. It stays
  dormant on unmonitored tabs (an occasional cheap status check, nothing else), and the ball appears
  only on the tab you started monitoring.
- The offscreen document is kept alive after you stop monitoring so the Whisper model stays warm and
  restarting is instant — at the cost of holding the model in memory until Chrome closes.
- Model availability moves. Providers retire models (`gemini-2.5-pro` now returns 404) and change
  which tiers are free. `models.js` records what was true when last verified against the live API;
  re-check before adding a model or marking one `freeTier: true`.
- The OpenAI adapter has not been exercised against a live OpenAI key yet. Gemini and Anthropic
  request shapes follow current official documentation.
