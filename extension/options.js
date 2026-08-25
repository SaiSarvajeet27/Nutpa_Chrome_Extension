// options.js — the settings page.
//
// This page never sees an API key it didn't just receive from the user's own
// keystrokes: it can write a key and ask whether one exists, but the background
// worker never sends key material back. That's why every input here is
// write-only and shows a placeholder rather than a stored value.

const $ = (id) => document.getElementById(id);

/** Send an RPC to the background worker; reject on the worker's own error. */
async function rpc(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
  return res;
}

let state = null; // { settings, catalog, vault }

function toast(message, kind = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function refresh() {
  state = await rpc('SETTINGS_GET');
  renderVault();
  renderFeatures();
}

/* ── Vault ─────────────────────────────────────────────────────────────── */

function renderVault() {
  const { exists, unlocked } = state.vault;
  $('vaultSetup').hidden = exists;
  $('vaultLocked').hidden = !exists || unlocked;
  $('vaultOpen').hidden = !exists || !unlocked;

  const badge = $('vaultBadge');
  badge.hidden = !exists;
  badge.textContent = unlocked ? '🔓 Keys unlocked' : '🔒 Keys locked';
  badge.className = `badge ${unlocked ? 'open' : 'shut'}`;

  if (exists && unlocked) renderProviders();
}

function renderProviders() {
  const { providers } = state.catalog;
  const { configured, bundledGemini } = state.vault;
  const host = $('providers');
  host.textContent = '';

  for (const p of Object.values(providers)) {
    const isSet = configured.includes(p.id);
    // Gemini is usable with the bundled free-tier key even with nothing stored.
    const usableFree = p.free && bundledGemini && !isSet;

    const card = document.createElement('div');
    card.className = 'provider';

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
    link.textContent = 'Get a key ↗';
    hint.appendChild(link);
    left.append(name, hint);

    const pill = document.createElement('span');
    if (isSet) { pill.className = 'pill set'; pill.textContent = 'YOUR KEY'; }
    else if (usableFree) { pill.className = 'pill free'; pill.textContent = 'FREE TIER'; }
    else { pill.className = 'pill unset'; pill.textContent = 'NOT SET'; }

    head.append(left, pill);

    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = isSet ? '•••••••••••••  (stored — type to replace)' : `Paste your ${p.label} key`;

    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save';
    save.onclick = async () => {
      const apiKey = input.value.trim();
      if (!apiKey) return toast('Paste a key first.', 'err');
      if (p.keyPattern && !p.keyPattern.test(apiKey)) {
        // Phrased to avoid an a/an agreement bug across provider names.
        return toast(`That doesn't look like an API key for ${p.label}.`, 'err');
      }
      save.disabled = true;
      try {
        // Verify before storing so a bad paste fails here, not mid-lecture.
        await rpc('KEY_VERIFY', { provider: p.id, apiKey });
        await rpc('KEY_SET', { provider: p.id, apiKey });
        input.value = '';
        toast(`${p.label} key saved and verified.`);
        await refresh();
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        save.disabled = false;
      }
    };
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

$('createVault').onclick = async () => {
  const a = $('newPass').value;
  const b = $('newPass2').value;
  if (a !== b) return toast('Passphrases do not match.', 'err');
  try {
    await rpc('VAULT_CREATE', { passphrase: a });
    $('newPass').value = $('newPass2').value = '';
    toast('Vault created and unlocked.');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
};

$('unlockVault').onclick = async () => {
  try {
    await rpc('VAULT_UNLOCK', { passphrase: $('unlockPass').value });
    $('unlockPass').value = '';
    toast('Unlocked for this browser session.');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
};

$('unlockPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('unlockVault').click();
});

$('lockVault').onclick = async () => {
  await rpc('VAULT_LOCK');
  toast('Locked. Nupta will use the free model until you unlock.');
  await refresh();
};

$('resetVault').onclick = async () => {
  // Irreversible and unrecoverable — make the consequence explicit, not a
  // generic "are you sure".
  const ok = confirm(
    'Reset the vault?\n\nEvery stored API key is permanently deleted. There is no way to ' +
      'recover them — you will need to paste your keys again.\n\nThis cannot be undone.'
  );
  if (!ok) return;
  await rpc('VAULT_RESET');
  toast('Vault reset. All stored keys were deleted.');
  await refresh();
};

$('changePass').onclick = async () => {
  const current = prompt('Current passphrase:');
  if (current === null) return;
  const next = prompt('New passphrase (min 8 characters):');
  if (next === null) return;
  try {
    await rpc('VAULT_CHANGE_PASSPHRASE', { current, next });
    toast('Passphrase changed.');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
};

/* ── Per-feature model selection ───────────────────────────────────────── */

function renderFeatures() {
  const { features, models, providers } = state.catalog;
  const host = $('features');
  host.textContent = '';

  for (const f of features) {
    const conf = state.settings.features[f.id];

    const row = document.createElement('div');
    row.className = 'feature';

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    toggle.title = `Turn ${f.label} ${conf.enabled ? 'off' : 'on'}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = conf.enabled;
    box.setAttribute('aria-label', `Enable ${f.label}`);
    const knob = document.createElement('span');
    toggle.append(box, knob);

    const main = document.createElement('div');
    main.className = 'feature-main';
    const name = document.createElement('div');
    name.className = 'feature-name';
    name.textContent = f.label;
    const blurb = document.createElement('div');
    blurb.className = 'feature-blurb';
    blurb.textContent = f.blurb;
    main.append(name, blurb);

    const select = document.createElement('select');
    select.disabled = !conf.enabled;
    select.setAttribute('aria-label', `Model for ${f.label}`);
    for (const [pid, p] of Object.entries(providers)) {
      const group = document.createElement('optgroup');
      group.label = p.label;
      for (const m of models.filter((x) => x.provider === pid)) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.label} — ${m.note}`;
        opt.selected = m.id === conf.model;
        group.append(opt);
      }
      select.append(group);
    }

    box.onchange = () => {
      state.settings.features[f.id].enabled = box.checked;
      select.disabled = !box.checked;
      persist();
    };
    select.onchange = () => {
      state.settings.features[f.id].model = select.value;
      persist();
    };

    row.append(toggle, main, select);
    host.append(row);
  }

  renderCallNote();
}

/**
 * Show the cost consequence of the current choices. Splitting features across
 * models is a real tradeoff — the student should see it before a lecture, not
 * discover it on a bill.
 */
function renderCallNote() {
  const { models } = state.catalog;
  const active = Object.entries(state.settings.features).filter(([, c]) => c.enabled);
  const note = $('callNote');

  if (!active.length) {
    note.className = 'callnote warn';
    note.textContent = 'Every feature is off — Nupta will not generate anything at checkpoints.';
    return;
  }

  const distinct = new Set(active.map(([, c]) => c.model));
  const paid = [...distinct].filter((id) => {
    const m = models.find((x) => x.id === id);
    return m && !state.catalog.providers[m.provider].free;
  });

  const calls = distinct.size;
  const plural = calls === 1 ? 'request' : 'requests';
  let text = `${calls} API ${plural} per checkpoint.`;
  if (calls === 1) text += ' Features sharing a model are answered together.';
  if (paid.length) {
    text += ` ${paid.length} of them billed to your own account.`;
    note.className = 'callnote warn';
  } else {
    text += ' All on free-tier models.';
    note.className = 'callnote';
  }
  note.textContent = text;
}

let saveTimer = 0;
function persist() {
  renderCallNote();
  // Coalesce rapid toggling into one write.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await rpc('SETTINGS_SAVE', { settings: state.settings });
      toast('Settings saved.');
    } catch (e) {
      toast(e.message, 'err');
    }
  }, 350);
}

refresh().catch((e) => toast(e.message, 'err'));
