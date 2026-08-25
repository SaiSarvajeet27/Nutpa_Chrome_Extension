// content-script entry — runs in every frame.
// All frames: video tracker (pause/resume/evaluate).
// Top frame only: mounts the React widget (ball + panel) inside a Shadow DOM
// so Tailwind styles and host-page CSS can't interfere with each other.

import React from 'react';
import { createRoot } from 'react-dom/client';
import ContentApp from './ContentApp';
import { initTracker } from './videoTracker';
// Vite inlines these as strings; injected into the shadow root below.
import indexCss from '../index.css?inline';
import gooeyCss from '../components/GooeyNav.css?inline';

// This bundle can run twice in one frame, for two very different reasons, and
// telling them apart is the whole job of the probe below:
//
//   1. The background re-injects via chrome.scripting when a tab has no
//      listener, which also lands in frames that are already running a LIVE
//      copy. The second copy must stand down, or every EVALUATE fires twice.
//   2. The extension was reloaded while this page stayed open. The previous
//      copy is orphaned — its chrome.* APIs are dead and its listeners never
//      fire again — but anything it left on `window` survives. The new copy
//      MUST take over, or the widget never comes back until a page reload.
//
// A boolean "already injected" flag cannot tell these apart, and treating (2)
// as (1) is why the ball would silently fail to appear after reloading the
// extension. So each instance leaves behind a probe that reports whether its
// own extension context is still alive.
declare global {
  interface Window { __nuptaAlive?: () => boolean }
}

const previousStillAlive = (() => {
  try {
    return typeof window.__nuptaAlive === 'function' && window.__nuptaAlive();
  } catch {
    return false; // probe belonged to a dead context
  }
})();

if (!previousStillAlive) {
  // Closes over THIS instance's chrome reference: once this context is
  // orphaned, chrome.runtime.id goes undefined and the probe reports false.
  window.__nuptaAlive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  // A dead predecessor may have left its ball in the DOM, wired to listeners
  // that no longer fire. Clear it out before mounting a working one.
  document.getElementById('nupta-host')?.remove();

  initTracker();
  mountWidget();
}

function mountWidget() {
  if (window.top !== window) return;
  const host = document.createElement('div');
  host.id = 'nupta-host';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  document.documentElement.appendChild(host);

  // Keep page-level hotkeys (YouTube: k, j, l, digits, f…) from firing while
  // the student types in the widget — key events must not escape the host.
  for (const evt of ['keydown', 'keyup', 'keypress'] as const) {
    host.addEventListener(evt, e => e.stopPropagation());
  }

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  // Strip remote font @import — host-page CSP (e.g. YouTube) may block it and
  // spam the console; system-ui fallback looks fine.
  let cssText = (indexCss + '\n' + gooeyCss).replace(/@import url\([^)]*\);?/g, '');
  // Host pages often change the root font-size (YouTube uses 10px), which
  // shrinks every rem-based Tailwind size inside the widget. Convert rem →
  // fixed px at 17.5px/rem (≈10% larger than the design default) so the
  // widget renders identically and readably on every site.
  cssText = cssText.replace(/(\d*\.?\d+)rem\b/g, (_m, n) => `${parseFloat(n) * 17.5}px`);
  style.textContent = cssText;
  shadow.appendChild(style);

  const mount = document.createElement('div');
  shadow.appendChild(mount);

  createRoot(mount).render(React.createElement(ContentApp));
}
