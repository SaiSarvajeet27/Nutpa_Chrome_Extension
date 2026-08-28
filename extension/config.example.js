// Optional. Copy this file to config.js and paste a Gemini key so the extension
// works out of the box, with nothing for the user to set up.
//
// This is the free-tier default. A Gemini key entered on Nupta's API keys screen
// overrides it, and keys for Claude/OpenAI are never read from this file.
//
// Get a free key at https://aistudio.google.com/apikey
//
// The service worker reads this file as text and pulls out GEMINI_API_KEY — it
// is never executed, so either `const` or `export const` works.
const LCQ_CONFIG = {
  // Free tier, no credit card: https://aistudio.google.com/apikey
  GEMINI_API_KEY: 'PASTE_YOUR_KEY_HERE',
  // Free tier: https://console.groq.com/keys
  // Powers the Groq LLM models AND remote Whisper transcription.
  GROQ_API_KEY: 'PASTE_YOUR_KEY_HERE',
};
