// Extension build — bundles the content script (React widget + video tracker)
// as a single IIFE file into extension/content.js.
// The extension/ folder is then directly loadable via chrome://extensions → Load unpacked.
// Run with: npm run build:ext
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The widget injects its styles as a string into the Shadow DOM (see
 * main.tsx's `?inline` imports), so the stylesheet Vite emits for components
 * that `import './x.css'` directly is dead weight — nothing in the extension
 * ever loads it. Drop it rather than leave an orphan file in extension/.
 */
function dropEmittedCss() {
  return {
    name: 'nupta-drop-emitted-css',
    enforce: 'post' as const, // must run after Vite's own css plugin emits it
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      for (const file of Object.keys(bundle)) {
        if (file.endsWith('.css')) delete bundle[file];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dropEmittedCss()],
  // public/ holds demo-page assets (favicon, icons.svg); copying them into the
  // extension folder would ship files the manifest never references.
  publicDir: false,
  define: {
    // React reads this at runtime; content scripts have no build-time env.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'extension',
    emptyOutDir: false, // extension/ holds static engine files (manifest, background, libs…)
    lib: {
      entry: 'src/content/main.tsx',
      formats: ['iife'],
      name: 'NuptaContent',
      fileName: () => 'content.js',
    },
  },
})
