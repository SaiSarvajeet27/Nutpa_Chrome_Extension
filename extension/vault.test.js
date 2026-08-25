// Tests for the encrypted key vault. These assert the security properties the
// options page promises the user — most importantly that nothing readable is
// left on disk, and that a wrong passphrase cannot open the vault.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// chrome.storage.local stands in for disk; chrome.storage.session for the
// memory-backed store that is cleared when the browser closes.
const local = {};
const session = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (k) => ({ [k]: local[k] }),
      set: async (items) => Object.assign(local, items),
      remove: async (k) => { delete local[k]; },
    },
    session: {
      get: async (k) => ({ [k]: session[k] }),
      set: async (items) => Object.assign(session, items),
      remove: async (k) => { delete session[k]; },
    },
  },
});

const vault = await import('./vault.js');

const PASS = 'correct horse battery';
const KEY = 'sk-ant-api03-REDACTED-EXAMPLE-KEY-000000';

beforeEach(async () => {
  for (const k of Object.keys(local)) delete local[k];
  for (const k of Object.keys(session)) delete session[k];
});

describe('lifecycle', () => {
  it('starts with no vault', async () => {
    expect(await vault.vaultExists()).toBe(false);
    expect(await vault.isUnlocked()).toBe(false);
  });

  it('creates, stores, and reads back a key', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    expect(await vault.getSecret('anthropic')).toBe(KEY);
  });

  it('is unlocked immediately after creation', async () => {
    await vault.createVault(PASS);
    expect(await vault.isUnlocked()).toBe(true);
  });

  it('rejects a short passphrase', async () => {
    await expect(vault.createVault('short')).rejects.toThrow(/at least 8/);
  });

  it('refuses to clobber an existing vault', async () => {
    await vault.createVault(PASS);
    await expect(vault.createVault('another passphrase')).rejects.toThrow(/already exists/);
  });

  it('survives a lock/unlock cycle', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('openai', KEY);
    await vault.lockVault();

    expect(await vault.isUnlocked()).toBe(false);
    expect(await vault.getSecret('openai')).toBe(''); // unreadable while locked

    await vault.unlockVault(PASS);
    expect(await vault.getSecret('openai')).toBe(KEY);
  });
});

describe('confidentiality', () => {
  it('writes no plaintext key to disk', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    // The single most important assertion in this file.
    const onDisk = JSON.stringify(local);
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain(PASS);
  });

  it('keeps the passphrase out of the session store too', async () => {
    await vault.createVault(PASS);
    expect(JSON.stringify(session)).not.toContain(PASS);
  });

  it('stores a salt and iteration count alongside the ciphertext', async () => {
    await vault.createVault(PASS);
    const blob = local['nupta:vault'];
    expect(blob.salt).toBeTruthy();
    expect(blob.iterations).toBeGreaterThanOrEqual(600000);
    expect(blob.iv).toBeTruthy();
    expect(blob.ct).toBeTruthy();
  });

  it('uses a fresh IV per write, so identical values differ on disk', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('openai', KEY);
    const first = { ...local['nupta:vault'] };
    await vault.setSecret('openai', KEY); // same value again
    expect(local['nupta:vault'].iv).not.toBe(first.iv);
    expect(local['nupta:vault'].ct).not.toBe(first.ct);
  });
});

describe('passphrase enforcement', () => {
  it('rejects the wrong passphrase', async () => {
    await vault.createVault(PASS);
    await vault.lockVault();
    await expect(vault.unlockVault('wrong passphrase')).rejects.toThrow(/Incorrect passphrase/);
    expect(await vault.isUnlocked()).toBe(false);
  });

  it('will not write a key while locked', async () => {
    await vault.createVault(PASS);
    await vault.lockVault();
    await expect(vault.setSecret('openai', KEY)).rejects.toThrow(/locked/i);
  });

  it('cannot be opened by tampering with the stored blob', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    await vault.lockVault();
    // Flip a byte of ciphertext — AES-GCM's tag check must reject it.
    const blob = local['nupta:vault'];
    const ct = blob.ct;
    local['nupta:vault'] = { ...blob, ct: (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1) };
    await expect(vault.unlockVault(PASS)).rejects.toThrow(/Incorrect passphrase/);
  });
});

describe('key management', () => {
  it('removes a key when set to empty', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('openai', KEY);
    await vault.setSecret('openai', '');
    expect(await vault.getSecret('openai')).toBe('');
    expect(await vault.listConfiguredProviders()).not.toContain('openai');
  });

  it('lists provider names without exposing key material', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    await vault.setSecret('openai', 'sk-openai-example-key-0000000000');
    const listed = await vault.listConfiguredProviders();
    expect(listed.sort()).toEqual(['anthropic', 'openai']);
    expect(JSON.stringify(listed)).not.toContain(KEY);
  });

  it('keeps other providers intact when one key changes', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    await vault.setSecret('openai', 'sk-openai-example-key-0000000000');
    await vault.setSecret('anthropic', 'sk-ant-replacement-key-000000000');
    expect(await vault.getSecret('openai')).toBe('sk-openai-example-key-0000000000');
    expect(await vault.getSecret('anthropic')).toBe('sk-ant-replacement-key-000000000');
  });
});

describe('changePassphrase', () => {
  it('re-encrypts the same secrets under a new passphrase', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    await vault.changePassphrase(PASS, 'a brand new passphrase');
    await vault.lockVault();

    await expect(vault.unlockVault(PASS)).rejects.toThrow(/Incorrect passphrase/);
    await vault.unlockVault('a brand new passphrase');
    expect(await vault.getSecret('anthropic')).toBe(KEY);
  });

  it('rotates the salt, so old precomputation is useless', async () => {
    await vault.createVault(PASS);
    const before = local['nupta:vault'].salt;
    await vault.changePassphrase(PASS, 'a brand new passphrase');
    expect(local['nupta:vault'].salt).not.toBe(before);
  });

  it('rejects a wrong current passphrase', async () => {
    await vault.createVault(PASS);
    await expect(vault.changePassphrase('nope', 'a brand new passphrase')).rejects.toThrow(
      /Incorrect passphrase/
    );
  });
});

describe('resetVault', () => {
  it('erases the blob and locks', async () => {
    await vault.createVault(PASS);
    await vault.setSecret('anthropic', KEY);
    await vault.resetVault();
    expect(await vault.vaultExists()).toBe(false);
    expect(await vault.isUnlocked()).toBe(false);
    expect(JSON.stringify(local)).not.toContain(KEY);
  });
});
