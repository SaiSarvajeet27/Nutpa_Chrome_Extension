// offscreen.js — captures tab audio and turns it into a rolling transcript.
// Runs in the extension's offscreen document.
//
// Two engines, chosen by the user (see TRANSCRIBERS in models.js):
//   • local (DEFAULT) — Whisper via transformers.js, on-device. Audio never
//     leaves the machine. This is the privacy promise and it stays the default.
//   • groq            — audio is UPLOADED to Groq's Whisper endpoint. Faster and
//     more accurate, no model download, but the audio does leave the machine.
//     The UI must say so before anyone picks it.

import { transcribeRemote } from './providers.js';

// transformers.js is loaded lazily so the message listener below registers
// immediately — otherwise the background's first message can arrive before
// this page is ready ("Receiving end does not exist").
let tfPromise = null;
function loadTransformers() {
  if (!tfPromise) {
    tfPromise = import('./libs/transformers.min.js').then((m) => {
      // Serve onnxruntime wasm from the extension bundle (no remote code).
      m.env.allowLocalModels = false;
      m.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('libs/');
      return m;
    });
  }
  return tfPromise;
}

// Multilingual model — handles English, Hindi, and Hinglish lectures.
// Swap to 'onnx-community/whisper-tiny.en' (smaller/faster) for English-only,
// or 'onnx-community/whisper-small' (~250 MB) for higher accuracy on a GPU machine.
const WHISPER_MODEL = 'onnx-community/whisper-base';
const CHUNK_SECONDS = 30;        // Whisper's native window
const TARGET_SAMPLE_RATE = 16000;
const SILENCE_RMS = 0.0025;      // skip near-silent chunks (whisper hallucinates on silence)

let transcriber = null;
let audioCtx = null;
let playbackCtx = null;
let mediaStream = null;
let workletNode = null;

let sampleRate = 48000;          // actual rate, set when capture starts
let pcmBuffer = [];              // Float32Array blocks
let pcmLength = 0;

let chunkQueue = [];             // Float32Array chunks awaiting transcription
let processing = false;
let transcriptParts = [];        // transcribed strings, in order
// Absolute count of parts retired from the front of transcriptParts. The
// background addresses the stream by absolute position (`seq`) rather than by
// array index, so trimming old speech can never make it consume the wrong parts.
let consumedOffset = 0;
let capturing = false;

function reportStatus(status, detail = '') {
  chrome.runtime.sendMessage({ type: 'WHISPER_STATUS', status, detail }).catch(() => {});
}

// Aggregate download progress across model files, throttled to 2 updates/sec.
const dlProgress = {};
let lastProgressReport = 0;
function onModelProgress(p) {
  if (p.status !== 'progress' || !p.total) return;
  dlProgress[p.file] = [p.loaded, p.total];
  const now = Date.now();
  if (now - lastProgressReport < 500) return;
  lastProgressReport = now;
  let loaded = 0, total = 0;
  for (const f in dlProgress) { loaded += dlProgress[f][0]; total += dlProgress[f][1]; }
  const pct = Math.min(99, Math.round((100 * loaded) / total));
  reportStatus('loading-model', `Downloading Whisper model… ${pct}% (first run only)`);
}

/**
 * Which engine transcribes this session, set by the background on OFFSCREEN_START.
 *   { provider: 'local' }                                   → on-device Whisper
 *   { provider: 'groq', model, apiKey }                      → uploaded to Groq
 *
 * The API key lives here only for the life of the session. That is a widening
 * of "keys stay in the service worker", and a deliberate one: the offscreen
 * document is privileged EXTENSION code, not a content script, so the property
 * that actually protects users — a key is never reachable from a web page —
 * still holds. The alternative was shuttling ~1 MB of base64 audio per chunk
 * through the worker, which is slower and no safer.
 */
let engine = { provider: 'local' };

/** Float32 PCM → a 16-bit mono WAV blob, the format Groq's endpoint expects. */
function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Idempotent under concurrent calls (capture start + first chunk both call it).
let modelPromise = null;
function loadModel() {
  if (!modelPromise) modelPromise = loadModelOnce();
  return modelPromise;
}

async function loadModelOnce() {
  if (transcriber) return;
  reportStatus('loading-model', 'Preparing Whisper model…');
  const { pipeline } = await loadTransformers();
  try {
    transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device: 'webgpu',
      dtype: 'fp32',
      progress_callback: onModelProgress,
    });
    reportStatus('ready', 'Whisper ready (WebGPU)');
  } catch (e) {
    console.warn('WebGPU unavailable, falling back to WASM:', e);
    transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: onModelProgress,
    });
    reportStatus('ready', 'Whisper ready (CPU)');
  }
}

async function startCapture(streamId) {
  if (capturing) return;
  // IMPORTANT: consume the streamId immediately — it expires within seconds.
  // The Whisper model loads in parallel; audio chunks queue up until it's ready.
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // 1) Pass audio through so the user still hears the tab (capture mutes it otherwise).
  playbackCtx = new AudioContext();
  playbackCtx.createMediaStreamSource(mediaStream).connect(playbackCtx.destination);
  await playbackCtx.resume().catch(() => {});

  // 2) Collect PCM for Whisper.
  audioCtx = new AudioContext();
  sampleRate = audioCtx.sampleRate;
  await audioCtx.audioWorklet.addModule('pcm-worklet.js');
  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, 'pcm-collector');
  workletNode.port.onmessage = (e) => onPCM(e.data);
  source.connect(workletNode);
  // Worklet needs a destination connection in some Chrome versions; use a muted gain.
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  workletNode.connect(mute).connect(audioCtx.destination);

  await audioCtx.resume().catch(() => {});
  capturing = true;
  reportStatus('capturing', 'Listening to tab audio');
  // Only the on-device engine has a model to fetch; starting that download when
  // the user picked a remote engine would waste ~75 MB for nothing.
  if (engine.provider === 'local') {
    loadModel().catch((e) => reportStatus('error', 'Model load failed: ' + e));
  }
}

function onPCM(block) {
  if (!capturing) return;
  pcmBuffer.push(block);
  pcmLength += block.length;
  if (pcmLength >= CHUNK_SECONDS * sampleRate) flushBuffer();
}

const MAX_QUEUED_CHUNKS = 40; // ~20 min of audio — cap memory if the CPU can't keep up

function flushBuffer() {
  if (pcmLength === 0) return;
  const merged = new Float32Array(pcmLength);
  let offset = 0;
  for (const b of pcmBuffer) { merged.set(b, offset); offset += b.length; }
  pcmBuffer = [];
  pcmLength = 0;
  chunkQueue.push(merged);
  if (chunkQueue.length > MAX_QUEUED_CHUNKS) {
    chunkQueue.shift(); // drop the oldest chunk rather than growing unboundedly
    console.warn('Transcription is falling behind — dropped the oldest audio chunk.');
  }
  processQueue();
}

function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    // Only the on-device engine needs a model download; a remote one is ready
    // immediately, which is most of why it feels faster on a cold start.
    if (engine.provider === 'local') await loadModel();
    while (chunkQueue.length > 0) {
      const chunk = chunkQueue.shift();
      if (rms(chunk) < SILENCE_RMS) continue; // skip silence/paused stretches
      const audio = downsample(chunk, sampleRate, TARGET_SAMPLE_RATE);
      try {
        const text = (await transcribeChunk(audio)).trim();
        if (text && !/^[\s.,!?]*$/.test(text)) transcriptParts.push(text);
      } catch (e) {
        console.error('Transcription chunk failed:', e);
        reportStatus('error', shortErr(e));
      }
    }
  } finally {
    processing = false;
  }
}

function shortErr(e) {
  return String((e && e.message) || e).slice(0, 120);
}

/** Transcribe one downsampled chunk with whichever engine is configured. */
async function transcribeChunk(audio) {
  if (engine.provider === 'local') {
    // language: null → Whisper auto-detects per chunk (English/Hindi/Hinglish).
    const result = await transcriber(audio, { language: null, task: 'transcribe' });
    return result.text || '';
  }
  // Remote: a stuck upload must not wedge the queue, so bound every request.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    return await transcribeRemote({
      provider: engine.provider,
      model: engine.model,
      apiKey: engine.apiKey,
      wavBlob: encodeWav(audio, TARGET_SAMPLE_RATE),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Retire parts from the front until the pending transcript fits in maxWords.
function trimTranscript(maxWords) {
  let total = 0;
  for (const p of transcriptParts) total += p.split(/\s+/).length;
  while (transcriptParts.length > 1 && total > maxWords) {
    total -= transcriptParts[0].split(/\s+/).length;
    transcriptParts.shift();
    consumedOffset++;
  }
}

async function drainAndGetTranscript(consume) {
  flushBuffer();                      // include the partial chunk at evaluation time
  await processQueue();               // no-op if already running…
  // …so wait until the queue empties — but never hang forever: if a chunk is
  // stuck (slow CPU, wedged wasm), return whatever transcript we already have.
  // Kept short: the MV3 service worker awaiting this call can be torn down if
  // it idles too long, which would silently drop the whole evaluation.
  const deadline = Date.now() + 30000;
  while ((processing || chunkQueue.length > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const text = transcriptParts.join(' ');
  const seq = consumedOffset + transcriptParts.length; // absolute end position
  if (consume) {
    consumedOffset = seq;
    transcriptParts = [];
  }
  return { text, seq };
}

function stopCapture() {
  capturing = false;
  try { if (workletNode) workletNode.disconnect(); } catch (e) { /* already torn down */ }
  try { if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* already stopped */ }
  try { if (audioCtx) audioCtx.close(); } catch (e) { /* already closed */ }
  try { if (playbackCtx) playbackCtx.close(); } catch (e) { /* already closed */ }
  workletNode = null; mediaStream = null; audioCtx = null; playbackCtx = null;
  pcmBuffer = []; pcmLength = 0; chunkQueue = [];
  transcriptParts = []; consumedOffset = 0;
  engine = { provider: 'local' }; // drop any API key with the session
  reportStatus('stopped');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;

  if (message.type === 'OFFSCREEN_START') {
    engine = message.engine && message.engine.provider ? message.engine : { provider: 'local' };
    if (engine.provider !== 'local') {
      reportStatus('ready', `Transcribing via ${engine.label || engine.provider}`);
    }
    startCapture(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => { reportStatus('error', String(e)); sendResponse({ ok: false, error: String(e) }); });
    return true;
  }

  if (message.type === 'GET_TRANSCRIPT') {
    drainAndGetTranscript(message.consume !== false)
      .then(({ text, count }) => sendResponse({ ok: true, text, count }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.type === 'CONSUME_TRANSCRIPT') {
    // Remove the parts already quizzed on; keep speech that arrived meanwhile.
    // `seq` is absolute, so this stays correct even if trimming ran in between.
    const seq = typeof message.seq === 'number'
      ? message.seq
      : consumedOffset + transcriptParts.length;
    const n = Math.max(0, Math.min(seq - consumedOffset, transcriptParts.length));
    transcriptParts.splice(0, n);
    consumedOffset += n;
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'TRIM_TRANSCRIPT') {
    trimTranscript(Number(message.maxWords) || 3000);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'OFFSCREEN_STOP') {
    stopCapture();
    sendResponse({ ok: true });
    return false;
  }
});
