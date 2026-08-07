// Extension build — bundles the content script (React widget + video tracker)
// as a single IIFE file into extension/content.js.
// The extension/ folder is then directly loadable via chrome://extensions → Load unpacked.
// Run with: npm run build:ext
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
