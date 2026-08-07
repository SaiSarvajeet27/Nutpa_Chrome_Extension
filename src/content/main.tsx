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

initTracker();

if (window.top === window && !document.getElementById('nupta-host')) {
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
