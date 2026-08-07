// background.js — orchestrates capture, subtopic evaluation, and Gemini generation.
// One Gemini call per checkpoint returns quiz questions + summary bullets +
// key concepts + flashcards (piggybacked — zero extra API cost).

// config.js defines LCQ_CONFIG (machine-local, gitignored). If it's missing,
// keep the worker alive — getApiConfig() reports a clear error at quiz time.
try {
  importScripts('config.js');
} catch (e) {
  console.warn('config.js not found. Copy config.example.js to config.js and paste your Gemini API key.');
}

const DEFAULT_MODEL = 'gemini-2.5-flash';

function getApiConfig() {
  const key = (typeof LCQ_CONFIG !== 'undefined' && LCQ_CONFIG.GEMINI_API_KEY) || '';
  const model = (typeof LCQ_CONFIG !== 'undefined' && LCQ_CONFIG.GEMINI_MODEL) || DEFAULT_MODEL;
  if (!key || key === 'PASTE_YOUR_KEY_HERE') {
    throw new Error('Gemini API key missing. Open config.js in the extension folder and paste your key.');
  }
  return { key, model };
}

// Session state survives service-worker restarts via chrome.storage.session
// (MV3 kills the worker after ~30s idle; in-memory state alone gets wiped).
let session = { active: false, tabId: null, whisper: { status: 'idle', detail: '' } };
let sessionLoaded = false;

async function getSession() {
  if (!sessionLoaded) {
    const { lcqSession } = await chrome.storage.session.get('lcqSession');
    if (lcqSession) session = lcqSession;
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
  session = { ...session, active: true, tabId };
  saveSession();
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#00d4c8' });
  await sendToTab(tabId, { type: 'MONITORING_STARTED' });
}

async function stopMonitoring() {
  await getSession();
  // Stop the capture but keep the offscreen document alive — the Whisper model
  // stays warm in memory, so restarting monitoring is instant.
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_STOP' }); } catch (e) {}
  if (session.tabId != null) {
    try { await chrome.tabs.sendMessage(session.tabId, { type: 'MONITORING_STOPPED' }); } catch (e) {}
  }
  session = { active: false, tabId: null, whisper: { status: 'idle', detail: '' } };
  saveSession();
  chrome.action.setBadgeText({ text: '' });
}

// Adaptive checkpoints: Gemini looks at the transcript accumulated since the
// last quiz and decides whether 1-2 subtopics are complete. If yes, it returns
// one MCQ per completed subtopic (plus summary/concepts/flashcards) and the
// transcript window resets.
let evaluating = false;

async function handleEvaluate(tabId, isFinal = false) {
  if (evaluating) return; // an evaluation is already in flight
  evaluating = true;
  try {
    const { key, model } = getApiConfig();

    // Peek at the transcript without consuming it.
    const res = await sendToOffscreen({ target: 'offscreen', type: 'GET_TRANSCRIPT', consume: false });
    if (!res || !res.ok) return;

    const transcript = (res.text || '').trim();
    // A quizzable subtopic needs some substance; at video end, quiz whatever remains.
    if (transcript.split(/\s+/).length < (isFinal ? 60 : 120)) return;

    const result = await evaluateAndGenerate(transcript, key, model, isFinal);
    if (result.ready && Array.isArray(result.questions) && result.questions.length >= 1) {
      // Consume only what we quizzed on; speech that arrived meanwhile is kept.
      await sendToOffscreen({ target: 'offscreen', type: 'CONSUME_TRANSCRIPT', count: res.count });
      await chrome.tabs.sendMessage(tabId, {
        type: 'QUIZ_READY',
        questions: result.questions.slice(0, 2),
        summaryBullets: result.segmentSummary,
        keyConcepts: result.keyConcepts,
        flashcards: result.flashcards,
      });
    }
    // Not ready → do nothing; the next evaluation fires automatically.
  } catch (e) {
    // Surface real failures (bad API key, quota) without pausing the lecture.
    try { await chrome.tabs.sendMessage(tabId, { type: 'QUIZ_ERROR', error: String(e.message || e) }); } catch (_) {}
  } finally {
    evaluating = false;
  }
}

async function evaluateAndGenerate(transcript, apiKey, model, isFinal = false) {
  const finalNote = isFinal
    ? 'NOTE: The video has ENDED — this is the last chance to quiz. If there is ANY testable content at all, respond ready=true with 1-2 questions on what was covered. '
    : '';
  const prompt =
    'You are a tutor monitoring a live video lecture, checking that the student stays attentive. ' + finalNote +
    'Below is the (imperfect, auto-generated) transcript accumulated since the last quiz. ' +
    'First decide: has the lecturer COMPLETED at least one coherent subtopic with enough substance to test? ' +
    'A subtopic is complete when its explanation has clearly concluded — not mid-explanation. ' +
    'If no subtopic is complete yet, or the content is too thin, respond with ready=false and empty arrays — the student keeps watching. ' +
    'If 1-2 subtopics are complete, respond with ready=true and EXACTLY ONE multiple-choice question per completed subtopic (1-2 questions; if more than 2 subtopics completed, pick the 2 most important). ' +
    'These are quick attentiveness checks, so keep questions focused on the key point of each subtopic. ' +
    'Rules per question: name the subtopic; 4 options, exactly one correct; plausible distractors; ' +
    'do not reference "the transcript"; ignore transcription glitches; keep questions self-contained. ' +
    'The lecture may be in English, Hindi, or Hinglish, but ALWAYS write subtopics, questions, options, and explanations in English only. ' +
    'Standard technical terms used by the lecturer stay as-is. ' +
    'When (and only when) ready=true, ALSO return: segmentSummary — 1-2 concise bullet sentences capturing what was actually taught in this segment; ' +
    'keyConcepts — 2-4 short key terms covered; flashcards — EXACTLY ONE study card per completed subtopic. ' +
    'Flashcards must be INDEPENDENT of the quiz questions — never reuse or rephrase a quiz question. ' +
    'Each card: subtopic = the subtopic name; front = a standalone recall prompt for its core idea ' +
    '(e.g. "Define: X", "What is the formula for Y?", "Why is Z used?"); back = the complete, concise answer a student should recall. ' +
    'When ready=false these three arrays must be empty.\n\nTRANSCRIPT:\n' + transcript;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          ready: { type: 'BOOLEAN', description: 'true only if at least one subtopic is fully covered' },
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                subtopic: { type: 'STRING' },
                question: { type: 'STRING' },
                options: { type: 'ARRAY', items: { type: 'STRING' } },
                answerIndex: { type: 'INTEGER', description: '0-based index of the correct option' },
                explanation: { type: 'STRING' },
              },
              required: ['subtopic', 'question', 'options', 'answerIndex'],
            },
          },
          segmentSummary: { type: 'ARRAY', items: { type: 'STRING' } },
          keyConcepts: { type: 'ARRAY', items: { type: 'STRING' } },
          flashcards: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                subtopic: { type: 'STRING' },
                front: { type: 'STRING' },
                back: { type: 'STRING' },
              },
              required: ['subtopic', 'front', 'back'],
            },
          },
        },
        required: ['ready', 'questions'],
      },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response');

  const result = JSON.parse(text);
  return {
    ready: !!result.ready,
    questions: (result.questions || []).filter(
      (q) => q.question && Array.isArray(q.options) && q.options.length >= 2
    ),
    segmentSummary: Array.isArray(result.segmentSummary) ? result.segmentSummary : [],
    keyConcepts: Array.isArray(result.keyConcepts) ? result.keyConcepts : [],
    flashcards: Array.isArray(result.flashcards)
      ? result.flashcards.filter((f) => f && f.front && f.back)
      : [],
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return; // offscreen handles its own

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
    if (session.active) {
      await stopMonitoring();
    } else if (tab && tab.id != null) {
      await startMonitoring(tab.id);
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
