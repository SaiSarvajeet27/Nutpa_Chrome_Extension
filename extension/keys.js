// keys.js — storage for the user's own API keys.
//
// Deliberately simple: no passphrase, no unlock step, no vault. A key you
// pasted last week is just there and works, which is the point.
//
// WHAT THIS DOES PROTECT
//   • No backend. There is no server to hold a key even in principle; a key
//     travels exactly one route — this machine to that provider's HTTPS endpoint.
//   • Never in a web page. Keys are read only inside the service worker. They
//     are never sent to a content script, so no site you visit can reach them,
//     and the widget on the lecture page never holds one.
//   • Isolated from other extensions. chrome.storage.local is per-extension;
//     another extension cannot read this one's storage.
//   • Write-only from the UI. The settings page can store a key and ask whether
//     one exists, but reading a stored key back is not something the UI can do —
//     so a key cannot leak through the settings screen either.
//
// WHAT IT DOES NOT
//   • chrome.storage.local is NOT encrypted on disk. Anyone with access to your
//     Chrome profile directory — or to your unlocked machine — can read these
//     keys. This is the same posture as essentially every extension that stores
//     an API key, and it is the tradeoff for having no passphrase to type.
//     Treat these keys as you would a saved browser password.
//
// If a key is ever exposed, revoke it at the provider; that is the recovery
// path, and it is why `providerKeyUrl` is surfaced in the UI.

const KEYS_KEY = 'nupta:keys';

async function readAll() {
  try {
    const { [KEYS_KEY]: keys } = await chrome.storage.local.get(KEYS_KEY);
    return keys && typeof keys === 'object' ? keys : {};
  } catch {
    return {};
  }
}

/** One provider's key, or '' when none is stored. */
export async function getKey(providerId) {
  const all = await readAll();
  const k = all[providerId];
  return typeof k === 'string' ? k : '';
}

/** Store a key, or remove it when given an empty value. */
export async function setKey(providerId, apiKey) {
  const all = await readAll();
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (trimmed) all[providerId] = trimmed;
  else delete all[providerId];
  await chrome.storage.local.set({ [KEYS_KEY]: all });
  return true;
}

/**
 * Which providers have a key. This — not the keys themselves — is what the UI
 * is allowed to see, so the settings screen can show "configured" without any
 * key material crossing into a page.
 */
export async function listConfiguredProviders() {
  return Object.keys(await readAll());
}

/** Remove every stored key. */
export async function clearKeys() {
  await chrome.storage.local.remove(KEYS_KEY);
  return true;
}
