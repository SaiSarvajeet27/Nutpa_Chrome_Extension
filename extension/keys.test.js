// Tests for API key storage. The security property worth asserting here is the
// one the UI promises: the settings screen can learn WHICH providers are
// configured, but key material itself is never part of that answer.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const local = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (k) => ({ [k]: local[k] }),
      set: async (items) => Object.assign(local, items),
      remove: async (k) => { delete local[k]; },
    },
  },
});

const { getKey, setKey, listConfiguredProviders, clearKeys } = await import('./keys.js');

const ANTHROPIC = 'sk-ant-api03-EXAMPLE-KEY-0000000000';
const OPENAI = 'sk-EXAMPLE-OPENAI-KEY-000000000000';

beforeEach(() => {
  for (const k of Object.keys(local)) delete local[k];
});

describe('storage', () => {
  it('returns empty for a provider with no key', async () => {
    expect(await getKey('anthropic')).toBe('');
  });

  it('stores and reads back a key', async () => {
    await setKey('anthropic', ANTHROPIC);
    expect(await getKey('anthropic')).toBe(ANTHROPIC);
  });

  it('keeps providers independent', async () => {
    await setKey('anthropic', ANTHROPIC);
    await setKey('openai', OPENAI);
    await setKey('anthropic', 'sk-ant-replacement-000000000000');
    expect(await getKey('openai')).toBe(OPENAI);
    expect(await getKey('anthropic')).toBe('sk-ant-replacement-000000000000');
  });

  it('removes a key when set to empty', async () => {
    await setKey('openai', OPENAI);
    await setKey('openai', '');
    expect(await getKey('openai')).toBe('');
    expect(await listConfiguredProviders()).not.toContain('openai');
  });

  it('trims incidental whitespace from a pasted key', async () => {
    await setKey('openai', `  ${OPENAI}\n`);
    expect(await getKey('openai')).toBe(OPENAI);
  });

  it('treats a whitespace-only paste as a removal, not a key', async () => {
    await setKey('openai', OPENAI);
    await setKey('openai', '   ');
    expect(await getKey('openai')).toBe('');
  });

  it('survives corrupt stored data rather than throwing', async () => {
    local['nupta:keys'] = 'not-an-object';
    expect(await getKey('anthropic')).toBe('');
    expect(await listConfiguredProviders()).toEqual([]);
  });
});

describe('what the UI is allowed to see', () => {
  it('lists provider names without leaking key material', async () => {
    await setKey('anthropic', ANTHROPIC);
    await setKey('openai', OPENAI);
    const listed = await listConfiguredProviders();
    expect(listed.sort()).toEqual(['anthropic', 'openai']);
    // The single assertion that matters: this is what crosses to the UI.
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(ANTHROPIC);
    expect(serialized).not.toContain(OPENAI);
  });
});

describe('clearKeys', () => {
  it('removes every stored key', async () => {
    await setKey('anthropic', ANTHROPIC);
    await setKey('openai', OPENAI);
    await clearKeys();
    expect(await listConfiguredProviders()).toEqual([]);
    expect(JSON.stringify(local)).not.toContain(ANTHROPIC);
  });
});
