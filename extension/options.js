// options.js — the API keys screen.
//
// One job: let the user paste a key per provider. No passphrase, no unlock.
//
// This page never receives a stored key. It can write one and ask whether a
// provider is configured, which is why every field is a blank write-only input
// showing a placeholder rather than the stored value.

const $ = (id) => document.getElementById(id);

async function rpc(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
  return res;
}

let state = null;

function toast(message, kind = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3400);
}

async function refresh() {
  state = await rpc('SETTINGS_GET');
  render();
}

function render() {
  const { providers } = state.catalog;
  const configured = state.configured || [];
  const host = $('providers');
  host.textContent = '';

  for (const p of Object.values(providers)) {
    const isSet = configured.includes(p.id);
    // Gemini works with the key that ships with the build, so it is usable
    // even with nothing stored here.
    const freeReady = p.free && state.bundledGemini && !isSet;

    const card = document.createElement('section');
    card.className = 'card provider';

    const head = document.createElement('div');
    head.className = 'provider-head';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'provider-name';
    name.textContent = p.label;
    const hint = document.createElement('div');
    hint.className = 'provider-hint';
    hint.textContent = p.keyHint + ' ';
    const link = document.createElement('a');
    link.href = p.keyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = isSet ? 'Manage keys ↗' : 'Get a key ↗';
    hint.appendChild(link);
    left.append(name, hint);

    const pill = document.createElement('span');
    if (isSet) { pill.className = 'pill set'; pill.textContent = 'KEY SAVED'; }
    else if (freeReady) { pill.className = 'pill free'; pill.textContent = 'FREE — READY'; }
    else { pill.className = 'pill unset'; pill.textContent = 'NO KEY'; }

    head.append(left, pill);

    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = isSet
      ? '•••••••••••••  saved — type a new key to replace'
      : `Paste your ${p.label} key`;

    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save';

    const doSave = async () => {
      const apiKey = input.value.trim();
      if (!apiKey) return toast('Paste a key first.', 'err');
      save.disabled = true;
      save.textContent = 'Checking…';
      try {
        // Verified against the provider before storing, so a bad paste fails
        // here rather than silently in the middle of a lecture.
        await rpc('KEY_VERIFY', { provider: p.id, apiKey });
        await rpc('KEY_SET', { provider: p.id, apiKey });
        input.value = '';
        toast(`${p.label} key saved and verified.`);
        await refresh();
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        save.disabled = false;
        save.textContent = 'Save';
      }
    };
    save.onclick = doSave;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });

    row.append(input, save);

    if (isSet) {
      const remove = document.createElement('button');
      remove.className = 'ghost danger';
      remove.textContent = 'Remove';
      remove.onclick = async () => {
        try {
          await rpc('KEY_SET', { provider: p.id, apiKey: '' });
          toast(`${p.label} key removed.`);
          await refresh();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
      row.append(remove);
    }

    card.append(head, row);
    host.append(card);
  }
}

$('clearAll').onclick = async () => {
  if (!confirm('Remove every stored API key?\n\nYou will need to paste them again to use paid models.')) return;
  try {
    await rpc('KEYS_CLEAR');
    toast('All stored keys removed.');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
};

refresh().catch((e) => toast(e.message, 'err'));
