// vault.js — passphrase-encrypted storage for the user's own API keys.
//
// THREAT MODEL — read this before changing anything here.
//
// What this protects against:
//   • Keys sitting in plaintext on disk. chrome.storage.local is an unencrypted
//     LevelDB under the Chrome profile; anyone who copies that directory (backup,
//     synced folder, stolen laptop, malware without code execution in Chrome)
//     gets a file that is useless without the passphrase.
//   • Keys reaching the page. Decryption happens only in the service worker;
//     the plaintext key never enters a content script, never enters the widget,
//     and never crosses into any web page's context.
//   • Keys reaching us. There is no backend. A key travels exactly one route:
//     the user's machine → that provider's own HTTPS endpoint.
//
// What this does NOT protect against, and we should not claim it does:
//   • Someone at the keyboard of an unlocked, already-unlocked Chrome. Once the
//     vault is open the derived key sits in chrome.storage.session, and anyone
//     who can open the service worker's devtools can read it. Locking the vault
//     (or quitting Chrome) clears it.
//   • A malicious extension with debugger permissions, or malware running as
//     the user. Nothing done in JS inside the browser can defend against that.
//
// The derived key lives in chrome.storage.session rather than a module variable
// because MV3 tears the service worker down after ~30s idle — holding it in
// memory alone would force a re-unlock every few minutes. storage.session is
// memory-backed, never written to disk, and cleared when the browser closes.

const VAULT_KEY = 'nupta:vault';       // encrypted blob (chrome.storage.local)
const SESSION_KEY = 'nupta:vaultKey';  // derived key while unlocked (session only)

// OWASP's floor for PBKDF2-HMAC-SHA256. Stored alongside the blob so the count
// can be raised later without locking existing users out of their own vault.
const PBKDF2_ITERATIONS = 600000;
const VAULT_VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  // Derived as raw bits (not a CryptoKey) because chrome.storage.session only
  // accepts JSON-serializable values — a CryptoKey cannot be stored there.
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    256
  );
}

async function aesKeyFromBits(bits) {
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function readVault() {
  const { [VAULT_KEY]: v } = await chrome.storage.local.get(VAULT_KEY);
  return v || null;
}

/** True once the user has created a vault (whether or not it's currently unlocked). */
export async function vaultExists() {
  return (await readVault()) !== null;
}

async function getSessionBits() {
  const { [SESSION_KEY]: b64 } = await chrome.storage.session.get(SESSION_KEY);
  return b64 ? fromB64(b64).buffer : null;
}

/** True when the vault is open and keys can be read this browser session. */
export async function isUnlocked() {
  return (await getSessionBits()) !== null;
}

async function encryptSecrets(bits, secrets) {
  const key = await aesKeyFromBits(bits);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(secrets))
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptSecrets(bits, vault) {
  const key = await aesKeyFromBits(bits);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(vault.iv) },
    key,
    fromB64(vault.ct)
  );
  return JSON.parse(dec.decode(plain));
}

/**
 * Create the vault. Fails rather than silently clobbering an existing one —
 * overwriting would destroy keys the user can no longer recover.
 */
export async function createVault(passphrase) {
  if (await vaultExists()) throw new Error('A vault already exists. Unlock it, or reset it first.');
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const { iv, ct } = await encryptSecrets(bits, {});
  await chrome.storage.local.set({
    [VAULT_KEY]: { v: VAULT_VERSION, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, iv, ct },
  });
  await chrome.storage.session.set({ [SESSION_KEY]: toB64(bits) });
  return true;
}

/**
 * Unlock for this browser session. A wrong passphrase surfaces as an AES-GCM
 * authentication failure — the tag check is what tells us the passphrase was
 * wrong, so never swallow that error into a generic one.
 */
export async function unlockVault(passphrase) {
  const vault = await readVault();
  if (!vault) throw new Error('No vault yet — set a passphrase first.');
  const bits = await deriveKey(passphrase, fromB64(vault.salt), vault.iterations || PBKDF2_ITERATIONS);
  try {
    await decryptSecrets(bits, vault);
  } catch {
    throw new Error('Incorrect passphrase.');
  }
  await chrome.storage.session.set({ [SESSION_KEY]: toB64(bits) });
  return true;
}

/** Forget the derived key. The encrypted blob on disk is untouched. */
export async function lockVault() {
  await chrome.storage.session.remove(SESSION_KEY);
}

/** Read every stored secret. Returns {} when locked — callers must handle that. */
export async function getSecrets() {
  const bits = await getSessionBits();
  const vault = await readVault();
  if (!bits || !vault) return {};
  try {
    return await decryptSecrets(bits, vault);
  } catch {
    // Blob written under a different passphrase (e.g. vault reset in another
    // window) — treat as locked rather than throwing into every call site.
    return {};
  }
}

/** Read one provider's key, or '' when absent or locked. */
export async function getSecret(providerId) {
  const secrets = await getSecrets();
  return secrets[providerId] || '';
}

/** Store (or, with an empty value, remove) one provider's key. */
export async function setSecret(providerId, apiKey) {
  const bits = await getSessionBits();
  const vault = await readVault();
  if (!bits || !vault) throw new Error('Vault is locked.');
  const secrets = await decryptSecrets(bits, vault);
  if (apiKey) secrets[providerId] = apiKey;
  else delete secrets[providerId];
  const { iv, ct } = await encryptSecrets(bits, secrets);
  await chrome.storage.local.set({ [VAULT_KEY]: { ...vault, iv, ct } });
  return true;
}

/** Which providers hold a key. Safe to send to the UI — no key material. */
export async function listConfiguredProviders() {
  return Object.keys(await getSecrets());
}

/**
 * Destroy the vault and everything in it. Irreversible: a forgotten passphrase
 * leaves no recovery path, so this is the only way out of that state.
 */
export async function resetVault() {
  await chrome.storage.local.remove(VAULT_KEY);
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function changePassphrase(currentPassphrase, newPassphrase) {
  const vault = await readVault();
  if (!vault) throw new Error('No vault yet.');
  if (!newPassphrase || newPassphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  const oldBits = await deriveKey(
    currentPassphrase,
    fromB64(vault.salt),
    vault.iterations || PBKDF2_ITERATIONS
  );
  let secrets;
  try {
    secrets = await decryptSecrets(oldBits, vault);
  } catch {
    throw new Error('Incorrect passphrase.');
  }
  // New salt too — reusing it would let an attacker reuse precomputed work.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveKey(newPassphrase, salt, PBKDF2_ITERATIONS);
  const { iv, ct } = await encryptSecrets(bits, secrets);
  await chrome.storage.local.set({
    [VAULT_KEY]: { v: VAULT_VERSION, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, iv, ct },
  });
  await chrome.storage.session.set({ [SESSION_KEY]: toB64(bits) });
  return true;
}
