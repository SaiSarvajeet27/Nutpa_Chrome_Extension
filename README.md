# nupta — Learning Intelligence

A Chrome extension that keeps students attentive during online lectures and turns passive watching into active recall. It follows the lecture through a **live, on-device transcript** and, whenever the instructor finishes a subtopic, pauses the video and asks a quick comprehension question — then automatically builds the student's **notes, summary, and spaced-repetition flashcards** along the way.

Works on **any site with a video player**. The AI speech-to-text runs **entirely in the browser** (WebGPU/Whisper), so audio never leaves the machine and there is **no per-user transcription cost**.

---

## Features

- **Focus** — every time a subtopic completes, the video pauses and 1-2 multiple-choice questions appear (tagged by subtopic, with explanations). A ripple animation on the floating ball warns a few seconds before each quiz.
- **Notes** — jot notes tagged with the exact video timestamp; click a timestamp to jump the video back to that moment. Saved per lecture.
- **Summary** — key points and concept tags build up automatically as the lecture progresses. One-click copy.
- **Cards** — one flashcard per subtopic, generated automatically, with real spaced-repetition scheduling ("Got it" pushes a card further out; "Hard" brings it back). Questions answered wrong are surfaced for review.
- Everything persists locally per lecture via `chrome.storage.local` — no account, no backend.
- Handles **English, Hindi, and Hinglish** lectures (questions are always written in English).

---

## Architecture

```
tab audio ──tabCapture──▶ offscreen page ──Whisper (local, transformers.js, WebGPU)──▶ rolling transcript
video playback ──content script──▶ every 2 min ──▶ background service worker
        └─▶ Gemini (free tier): "is a subtopic done?" → quiz + summary + concepts + flashcards (ONE call)
        └─▶ React widget (ball + panel, Shadow DOM) shows the quiz; results persist locally
```

- **Manifest V3** extension. Engine is a vanilla JS service worker + an offscreen document; UI is **React 19 + TypeScript + Tailwind**, injected as a content script inside a **Shadow DOM** (so page styles and widget styles never collide).
- **Local transcription:** OpenAI Whisper (`base`, multilingual) via `transformers.js`, on WebGPU with a CPU/WASM fallback. 30-second chunks, silence auto-skipped.
- **One API call per checkpoint:** a single structured Gemini request returns the quiz question(s), summary bullets, key concepts, and flashcards together — keeping usage well inside the free tier.

---

## Repository layout

```
extension/            ← the loadable Chrome extension (point "Load unpacked" here)
  manifest.json
  background.js        engine: capture, evaluation, Gemini calls
  offscreen.js/html   local Whisper transcription
  pcm-worklet.js       audio capture worklet
  content.js           BUILT React widget bundle (do not edit by hand)
  libs/                Whisper runtime (transformers.js + onnxruntime wasm)
  config.example.js    copy to config.js and add your API key
src/                  ← React source (demo app + content-script code)
  components/          Sidebar + tabs (Focus, Notes, Summary, Cards)
  content/             extension entry, video tracker, storage layer
vite.config.ext.ts    builds src/content → extension/content.js
```

---

## Setup

### 1. Get a free Gemini API key
Create one at https://aistudio.google.com/apikey (no credit card required).

### 2. Add your key
In the `extension/` folder, copy `config.example.js` to **`config.js`** and paste your key:

```js
const LCQ_CONFIG = {
  GEMINI_API_KEY: 'YOUR_KEY_HERE',
  GEMINI_MODEL: 'gemini-2.5-flash',
};
```

> `config.js` is gitignored — never commit it. Each person adds their own key.

### 3. Load the extension
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the **`extension`** folder (not the repo root)

### 4. Use it
Open a lecture, click the nupta toolbar icon once (the badge shows **ON** and a floating ball appears), and play the video. The first run downloads the Whisper model (~75 MB, one time). Questions appear automatically as subtopics complete.

---

## Development

The extension ships with `content.js` prebuilt, so contributors don't need to build just to run it. To modify the React UI:

```bash
npm install
npm run dev        # live demo page at localhost:5173 (mock data)
npm run build:ext  # rebuild extension/content.js after UI changes
```

After `build:ext`, reload the extension in `chrome://extensions`.

---

## Tech stack (all free / open-source)

| Piece            | Tool                                            |
|------------------|-------------------------------------------------|
| Transcription    | Whisper (base, multilingual) via transformers.js, in-browser |
| Question / study generation | Google Gemini 2.5 Flash (free tier)  |
| UI               | React 19 + TypeScript + Tailwind (Vite)         |
| Runtime          | Chrome Manifest V3, `chrome.storage.local`      |

---

## Notes & limitations

- Needs a reasonably modern GPU for real-time transcription; falls back to CPU (slower) otherwise.
- YouTube ads get transcribed too and can occasionally influence a question.
- Each user currently supplies their own free API key — fine for a pilot; a hosted key would be the productization step.
