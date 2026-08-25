// videoTracker.ts — runs in EVERY frame. Owns the <video>: tracks watched time,
// requests subtopic evaluations, pauses on quiz, resumes/seeks on command.
// The React UI (top frame only) never touches the video directly — frames
// coordinate through the background service worker.

const EVAL_INTERVAL_SECONDS = 120; // how often we ask "is there enough content yet?"
const TIME_REPORT_INTERVAL_MS = 2000; // matches the widget's status poll

let monitoring = false;
let video: HTMLVideoElement | null = null;
let watchedSeconds = 0;
let lastTime: number | null = null;
let quizActive = false;
let rescanTimer: number | null = null;
let lastTimeReport = 0;

function safeSend(message: Record<string, unknown>) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    /* extension context invalidated (extension reloaded) — ignore */
  }
}

function findMainVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = v; }
  }
  return best;
}

function onTimeUpdate() {
  if (!monitoring || quizActive || !video) return;
  const t = video.currentTime;
  if (lastTime !== null) {
    const delta = t - lastTime;
    // Count only normal forward playback; ignore seeks/jumps.
    if (delta > 0 && delta < 2) watchedSeconds += delta;
  }
  lastTime = t;

  // Publish position for the widget, which lives in the top frame and can't
  // reach this <video> when the player is inside an iframe.
  const now = Date.now();
  if (now - lastTimeReport >= TIME_REPORT_INTERVAL_MS) {
    lastTimeReport = now;
    safeSend({ type: 'VIDEO_TIME', time: t, progress: getProgress() });
  }

  if (watchedSeconds >= EVAL_INTERVAL_SECONDS) {
    watchedSeconds = 0;
    // Fire-and-forget: video keeps playing while Gemini decides.
    safeSend({ type: 'EVALUATE' });
  }
}

function onEnded() {
  // Video finished — quiz whatever content remains, even if no subtopic completed.
  if (!monitoring || quizActive) return;
  safeSend({ type: 'EVALUATE', final: true });
}

function attach(v: HTMLVideoElement | null) {
  if (video === v) return;
  if (video) {
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('ended', onEnded);
  }
  video = v;
  lastTime = null;
  if (v) {
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
  }
}

function start() {
  if (monitoring) return;
  monitoring = true;
  watchedSeconds = 0;
  lastTimeReport = 0; // report position on the very first tick
  attach(findMainVideo());
  // Handle SPAs (YouTube etc.): periodically re-check that we're on the right <video>.
  rescanTimer = window.setInterval(() => {
    if (!monitoring || quizActive) return;
    const v = findMainVideo();
    if (v && v !== video) attach(v);
  }, 3000);
}

function stop() {
  monitoring = false;
  quizActive = false;
  if (rescanTimer !== null) { clearInterval(rescanTimer); rescanTimer = null; }
  attach(null);
}

function pauseForQuiz() {
  if (!video) return; // this frame doesn't own the video
  quizActive = true;
  // The quiz panel lives in the top frame's DOM — leave fullscreen or it'd be invisible.
  if (document.fullscreenElement) {
    try { document.exitFullscreen(); } catch { /* ignore */ }
  }
  try { video.pause(); } catch { /* ignore */ }
}

function resume() {
  quizActive = false;
  if (video) { try { video.play(); } catch { /* ignore */ } }
}

function seekTo(time: number) {
  if (!video || !isFinite(time)) return;
  try { video.currentTime = Math.max(0, time); } catch { /* ignore */ }
}

/** Current playback progress (0-100), or null if this frame has no video. */
export function getProgress(): number | null {
  if (!video || !video.duration || !isFinite(video.duration)) return null;
  return Math.round((video.currentTime / video.duration) * 100);
}

/** Current playback position in seconds, or null if this frame has no video. */
export function getCurrentTime(): number | null {
  return video ? video.currentTime : null;
}

export function hasVideo(): boolean {
  return video !== null;
}

export function initTracker() {
  chrome.runtime.onMessage.addListener((message: any) => {
    switch (message && message.type) {
      case 'MONITORING_STARTED': start(); break;
      case 'MONITORING_STOPPED': stop(); break;
      // QUIZ_READY starts the UI's warning pulse; the actual pause arrives a
      // few seconds later as PAUSE_VIDEO from the top frame.
      case 'PAUSE_VIDEO': if (monitoring) pauseForQuiz(); break;
      case 'RESUME_VIDEO': resume(); break;
      case 'SEEK_VIDEO': seekTo(Number(message.time)); break;
    }
  });
}
