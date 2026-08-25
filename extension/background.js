// background.js — orchestrates capture, subtopic evaluation, and generation.
//
// Each of the four AI features (quiz, summary, flashcards, auto-notes) can be
// pointed at a different model. Features that share a model are served by ONE
// request, so the default configuration — everything on Gemini — still costs a
// single call per checkpoint, exactly as before per-feature selection existed.
//
// The user's own API keys live in an encrypted vault (vault.js) and are read
// only here, in the service worker, at the moment of the call.

import { generate, verifyKey } from './providers.js';
import { buildRequest, normalize } from './checkpoint.js';
import {
  FEATURES,
  MODELS,
  PROVIDERS,
  DEFAULT_MODEL,
  getModel,
  loadSettings,
  saveSettings,
  groupFeaturesByModel,
} from './models.js';
import {
  vaultExists,
  isUnlocked,
  createVault,
  unlockVault,
  lockVault,
  getSecret,
  setSecret,
  listConfiguredProviders,
  resetVault,
  changePassphrase,
} from './vault.js';

// config.js is the shipped free-tier Gemini key (machine-local, gitignored).
// It is a fallback only — a key entered in Settings always wins.
let bundledGeminiKey = '';
const bundledConfigReady = import('./config.js')
  .then((m) => {
    const cfg = m.LCQ_CONFIG || m.default || {};
    if (cfg.GEMINI_API_KEY && cfg.GEMINI_API_KEY !== 'PASTE_YOUR_KEY_HERE') {
      bundledGeminiKey = cfg.GEMINI_API_KEY;
    }
  })
  .catch(() => {
    // Absent or not an ES module — fine. The user can add a key in Settings.
    console.info('[nupta] No extension/config.js; using keys from Settings.');
  });

/**
 * Resolve the API key for a provider.
 * Precedence: the user's own key (encrypted vault) → the bundled free-tier key.
 * Returns '' when nothing is available, so callers can fall back rather than throw.
 */
async function resolveKey(provider) {
  const own = await getSecret(provider);
  if (own) return own;
  if (provider === 'gemini') {
    await bundledConfigReady;
    return bundledGeminiKey;
  }
  return '';
}

// Session state survives service-worker restarts via chrome.storage.session
// (MV3 kills the worker after ~30s idle; in-memory state alone gets wiped).
function emptySession() {
  return {
    active: false,
    tabId: null,
    whisper: { status: 'idle', detail: '' },
    // Latest playback position reported by whichever frame owns the <video>.
    // The widget lives in the top frame, which can't reach a video inside an
    // iframe — so the owning frame reports here and the widget reads it back.
    video: { time: null, progress: null, at: 0 },
    // Last hard engine failure (bad key, quota) — surfaced in the widget.
    lastError: '',
    // A checkpoint that still succeeded but not as configured (a locked vault,
    // one provider down). Distinct from lastError because the success path
    // clears errors — a degradation notice must survive that.
    notice: '',
  };
}

let session = emptySession();
let sessionLoaded = false;

async function getSession() {
  if (!sessionLoaded) {
    const { lcqSession } = await chrome.storage.session.get('lcqSession');
    // Merge over a fresh shape so a session stored by an older version (missing
    // newer fields) can't leave holes that later reads assume are present.
    if (lcqSession) session = { ...emptySession(), ...lcqSession };
    sessionLoaded = true;
  }
  return session;
}

function saveSession() {
  chrome.storage.session.set({ lcqSession: session });
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio to transcribe the lecture locally with Whisper',
  });
}

// The offscreen page registers its listener asynchronously — retry briefly.
async function sendToOffscreen(message, retries = 10, delayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Content script may not be in the tab yet (e.g. page loaded before the
// extension was reloaded) — inject it on demand, then message it.
async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

async function startMonitoring(tabId) {
  await getSession();
  if (session.active) await stopMonitoring();
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    // A stale capture from a previous session is still holding the tab —
    // tear it down and retry once.
    await stopMonitoring();
    await new Promise((r) => setTimeout(r, 500));
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  }
  await ensureOffscreenDocument();
  const res = await sendToOffscreen({ target: 'offscreen', type: 'OFFSCREEN_START', streamId });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Offscreen capture failed to start');
  session = { ...session, active: true, tabId, lastError: '', video: { time: null, progress: null, at: 0 } };
  saveSession();
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#00d4c8' });
  // Best-effort: capture is already running, and the widget also discovers the
  // session on its own via GET_STATUS. Failing the whole start here would
  // report an error for a session that is, in fact, live.
  try {
    await sendToTab(tabId, { type: 'MONITORING_STARTED' });
  } catch (e) {
    console.warn('[nupta] Could not notify the tab; the widget will pick it up on its next poll.', e);
  }
}

async function stopMonitoring() {
  await getSession();
  // Stop the capture but keep the offscreen document alive — the Whisper model
  // stays warm in memory, so restarting monitoring is instant.
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_STOP' }); } catch (e) {}
  if (session.tabId != null) {
    try { await chrome.tabs.sendMessage(session.tabId, { type: 'MONITORING_STOPPED' }); } catch (e) {}
  }
  session = emptySession();
  saveSession();
  chrome.action.setBadgeText({ text: '' });
}

// Adaptive checkpoints: Gemini looks at the transcript accumulated since the
// last quiz and decides whether 1-2 subtopics are complete. If yes, it returns
// one MCQ per completed subtopic (plus summary/concepts/flashcards) and the
// transcript window resets.
let evaluating = false;

// If Gemini keeps answering "not ready" (rambling lecturer, noisy transcript),
// the pending window would otherwise grow for the whole lecture and get re-sent
// in full every 2 minutes. Past this many words we drop the oldest speech so the
// prompt — and the token cost — stay bounded.
const MAX_PROMPT_WORDS = 3000;

async function handleEvaluate(tabId, isFinal = false) {
  if (evaluating) return; // an evaluation is already in flight
  evaluating = true;
  try {
    // Each checkpoint re-derives its own degradation state — a notice from the
    // last one must not linger after the user fixes the cause.
    await getSession();
    if (session.notice) { session.notice = ''; saveSession(); }

    // Peek at the transcript without consuming it. `seq` is an absolute
    // position in the transcript stream, so it stays correct even if the
    // offscreen page trims old parts while Gemini is thinking.
    const res = await sendToOffscreen({ target: 'offscreen', type: 'GET_TRANSCRIPT', consume: false });
    if (!res || !res.ok) return;

    let transcript = (res.text || '').trim();
    const words = transcript ? transcript.split(/\s+/) : [];
    // A quizzable subtopic needs some substance; at video end, quiz whatever remains.
    if (words.length < (isFinal ? 60 : 120)) return;
    // Keep the most recent speech — that's where the unquizzed subtopic is.
    if (words.length > MAX_PROMPT_WORDS) transcript = words.slice(-MAX_PROMPT_WORDS).join(' ');

    const result = await runCheckpoint(transcript, isFinal);

    // A checkpoint fires when the gating call says a subtopic completed. The
    // quiz may still be empty (e.g. the student turned quizzes off but left
    // notes on) — the other outputs are still worth delivering.
    const produced =
      result.ready &&
      ((result.questions || []).length ||
        (result.summaryBullets || []).length ||
        (result.flashcards || []).length ||
        (result.notes || []).length);

    if (produced) {
      // Consume only what we quizzed on; speech that arrived meanwhile is kept.
      await sendToOffscreen({ target: 'offscreen', type: 'CONSUME_TRANSCRIPT', seq: res.seq });
      await sendToTab(tabId, {
        type: 'QUIZ_READY',
        questions: (result.questions || []).slice(0, 2),
        summaryBullets: result.summaryBullets || [],
        keyConcepts: result.keyConcepts || [],
        flashcards: result.flashcards || [],
        aiNotes: result.notes || [],
      });
    } else if (words.length > MAX_PROMPT_WORDS) {
      // Nothing quizzable and the window is over budget — retire the oldest
      // speech so it isn't paid for again on every future checkpoint.
      await sendToOffscreen({ target: 'offscreen', type: 'TRIM_TRANSCRIPT', maxWords: MAX_PROMPT_WORDS });
    }

    // A successful round trip clears any previously shown error.
    await getSession();
    if (session.lastError) { session.lastError = ''; saveSession(); }
  } catch (e) {
    // Surface real failures (bad API key, quota) without pausing the lecture.
    const error = String(e.message || e);
    await getSession();
    session.lastError = error;
    saveSession();
    try { await chrome.tabs.sendMessage(tabId, { type: 'QUIZ_ERROR', error }); } catch (_) {}
  } finally {
    evaluating = false;
  }
}

/**
 * Run one checkpoint across however many models the user has configured.
 *
 * Ordering matters. The group that owns `quiz` also answers the gating
 * question — "did a subtopic actually finish?" — because that judgement is
 * what decides whether a checkpoint happens at all. It runs first, alone. Only
 * if it says yes do the remaining groups run, in parallel, told that a subtopic
 * is already confirmed complete. Two models never get to disagree about whether
 * the checkpoint is happening, and nothing is spent on summaries or cards for a
 * segment that turned out not to have finished a subtopic.
 *
 * With the default settings every feature shares one model, so there is exactly
 * one group and this is a single API call — the original cost model, unchanged.
 */
async function runCheckpoint(transcript, isFinal) {
  const settings = await loadSettings();
  const groups = await resolveGroups(groupFeaturesByModel(settings));
  if (!groups.length) throw new Error('Every AI feature is turned off in Nupta settings.');

  // The gating group is whichever one owns the quiz; absent that (quiz off),
  // the first group takes on the decision.
  const gateIndex = Math.max(0, groups.findIndex((g) => g.features.includes('quiz')));
  const gate = groups[gateIndex];
  const rest = groups.filter((_, i) => i !== gateIndex);

  const merged = { ready: false };
  const gateResult = await runGroup(gate, transcript, isFinal, true);
  Object.assign(merged, gateResult);
  if (!gateResult.ready) return merged;

  if (rest.length) {
    // One slow or failing provider must not cost the student the whole
    // checkpoint — the gate already succeeded, so deliver what we can.
    const others = await Promise.allSettled(
      rest.map((g) => runGroup(g, transcript, isFinal, false))
    );
    others.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        Object.assign(merged, outcome.value, { ready: true });
      } else {
        console.warn(`[nupta] ${rest[i].features.join('+')} failed:`, outcome.reason);
        noteDegraded(rest[i], outcome.reason);
      }
    });
  }
  return merged;
}

async function runGroup(group, transcript, isFinal, decidesReadiness) {
  const { system, prompt, schema } = buildRequest({
    features: group.features,
    transcript,
    isFinal,
    decidesReadiness,
  });
  const raw = await generate({
    provider: group.provider,
    model: group.model,
    apiKey: group.apiKey,
    system,
    prompt,
    schema,
  });
  return normalize(raw, group.features);
}

/**
 * Attach an API key to each group, falling back to the free default model when
 * the user's own key isn't available.
 *
 * A locked vault or a removed key shouldn't silently stop the lecture working,
 * and Gemini's free tier costs nothing to fall back to — so we degrade to it and
 * say so in the status line rather than failing the checkpoint.
 */
async function resolveGroups(groups) {
  const fallbackModel = getModel(DEFAULT_MODEL);
  const resolved = [];
  const degradedFrom = [];

  for (const g of groups) {
    const apiKey = await resolveKey(g.provider);
    if (apiKey) {
      resolved.push({ ...g, apiKey });
      continue;
    }
    const fallbackKey = await resolveKey(fallbackModel.provider);
    if (!fallbackKey) continue; // nothing usable at all — drop this group
    degradedFrom.push(`${g.features.join(', ')} → ${fallbackModel.label}`);
    resolved.push({
      provider: fallbackModel.provider,
      model: fallbackModel.id,
      features: g.features,
      apiKey: fallbackKey,
    });
  }

  if (degradedFrom.length) {
    const locked = (await vaultExists()) && !(await isUnlocked());
    await setDegradedNote(
      locked
        ? 'Key vault is locked — using the free model until you unlock it.'
        : `No API key for: ${degradedFrom.join('; ')}`
    );
  }

  // Merge any groups that collapsed onto the same fallback model, so the
  // degraded path doesn't issue two identical calls.
  const byModel = new Map();
  for (const g of resolved) {
    const key = `${g.provider}:${g.model}`;
    if (byModel.has(key)) byModel.get(key).features.push(...g.features);
    else byModel.set(key, { ...g, features: [...g.features] });
  }
  return [...byModel.values()];
}

async function setDegradedNote(note) {
  await getSession();
  session.notice = note;
  saveSession();
}

function noteDegraded(group, reason) {
  const detail = String(reason?.message || reason || '').slice(0, 160);
  setDegradedNote(`${group.features.join(' + ')}: ${detail}`);
}

/**
 * Options-page RPC. These are the only messages that touch the vault, and they
 * deliberately never return key material — the page can learn THAT a provider
 * is configured, never what its key is. Editing a key is write-only from the
 * UI's point of view.
 */
const settingsHandlers = {
  SETTINGS_GET: async () => ({
    settings: await loadSettings(),
    catalog: { features: FEATURES, providers: PROVIDERS, models: MODELS },
    vault: {
      exists: await vaultExists(),
      unlocked: await isUnlocked(),
      // Names only. No secrets cross this boundary.
      configured: await listConfiguredProviders(),
      bundledGemini: !!(await bundledConfigReady.then(() => bundledGeminiKey)),
    },
  }),
  SETTINGS_SAVE: async (m) => {
    await saveSettings(m.settings);
    return { ok: true };
  },
  VAULT_CREATE: async (m) => ({ ok: await createVault(m.passphrase) }),
  VAULT_UNLOCK: async (m) => ({ ok: await unlockVault(m.passphrase) }),
  VAULT_LOCK: async () => {
    await lockVault();
    return { ok: true };
  },
  VAULT_RESET: async () => {
    await resetVault();
    return { ok: true };
  },
  VAULT_CHANGE_PASSPHRASE: async (m) => ({
    ok: await changePassphrase(m.current, m.next),
  }),
  KEY_SET: async (m) => {
    await setSecret(m.provider, m.apiKey);
    return { ok: true, configured: await listConfiguredProviders() };
  },
  KEY_VERIFY: async (m) => {
    // Verify the key the user just typed, before storing it, so a typo is
    // caught here rather than mid-lecture.
    const key = m.apiKey || (await getSecret(m.provider));
    await verifyKey(m.provider, key);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return; // offscreen handles its own

  const settingsHandler = settingsHandlers[message.type];
  if (settingsHandler) {
    // Only the extension's own pages may reach the vault. A content script has
    // a `sender.tab`; the options page does not — that's the boundary.
    if (sender.tab) {
      sendResponse({ ok: false, error: 'Not permitted from a page.' });
      return false;
    }
    settingsHandler(message)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }

  switch (message.type) {
    case 'START_MONITORING':
      startMonitoring(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case 'STOP_MONITORING':
      stopMonitoring().then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_STATUS':
      getSession().then((s) => {
        const senderTabId = sender.tab && sender.tab.id;
        sendResponse({
          ok: true,
          session: s,
          // true only when THIS tab is the monitored one — the widget ball
          // shows only on the tab being monitored.
          activeHere: !!(s.active && senderTabId != null && senderTabId === s.tabId),
        });
      });
      return true;

    case 'WHISPER_STATUS':
      getSession().then(() => {
        session.whisper = { status: message.status, detail: message.detail || '' };
        saveSession();
      });
      return false;

    // Whichever frame owns the <video> reports playback position here, so the
    // widget in the top frame can show progress and timestamp notes even when
    // the player lives inside an iframe.
    case 'VIDEO_TIME': {
      const senderTabId = sender.tab && sender.tab.id;
      getSession().then((s) => {
        if (!s.active || senderTabId !== s.tabId) return;
        session.video = {
          time: typeof message.time === 'number' ? message.time : null,
          progress: typeof message.progress === 'number' ? message.progress : null,
          at: Date.now(),
        };
        saveSession();
      });
      return false;
    }

    // The widget's settings button. Content scripts can't call
    // openOptionsPage themselves, so the request is relayed through here.
    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case 'EVALUATE': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) handleEvaluate(tabId, !!message.final);
      sendResponse({ ok: true });
      return false;
    }

    // Notes tab: jump the lecture to a saved timestamp (relayed to all frames
    // so whichever frame owns the <video> performs the seek).
    case 'SEEK_VIDEO': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'SEEK_VIDEO', time: message.time }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    // Warning pulse finished — pause the video in whichever frame owns it.
    case 'PAUSE_VIDEO': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'PAUSE_VIDEO' }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    // The React UI (top frame) finished/skipped a quiz — relay to every frame
    // in the tab so whichever frame owns the <video> resumes playback.
    case 'RESUME_VIDEO': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO' }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }
  }
});

// No popup: clicking the extension icon toggles monitoring for the tab.
// (The icon click is required — Chrome only grants tab-audio capture after
// the user invokes the extension on that tab.)
chrome.action.onClicked.addListener(async (tab) => {
  await getSession();
  try {
    if (!tab || tab.id == null) return;
    if (session.active && session.tabId === tab.id) {
      await stopMonitoring();          // clicking the monitored tab turns it off
    } else {
      await startMonitoring(tab.id);   // a different tab moves monitoring there
    }
  } catch (e) {
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
    if (tab && tab.id != null) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'QUIZ_ERROR', error: String(e.message || e) }); } catch (_) {}
    }
  }
});

// If the monitored tab is closed, stop the capture instead of transcribing
// a dead tab forever.
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  await getSession();
  if (session.active && session.tabId === closedTabId) stopMonitoring();
});
