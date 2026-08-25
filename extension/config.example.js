// Optional. Copy this file to config.js to bake in a default Gemini key so the
// extension works out of the box without anyone opening Settings.
//
// This is a FALLBACK only — a Gemini key entered in Nupta's Settings page always
// wins, and keys for Claude/OpenAI live exclusively in the encrypted vault and
// are never read from this file.
//
// Get a free key at https://aistudio.google.com/apikey
//
// NOTE: this must be an ES module (`export const`) — the service worker imports
// it. A pre-0.2 config.js that says only `const LCQ_CONFIG = ...` needs `export`
// added in front.
export const LCQ_CONFIG = {
  GEMINI_API_KEY: 'PASTE_YOUR_KEY_HERE',
};
