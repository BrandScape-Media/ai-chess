/* app settings (kept by the server in data/settings.json) and the Settings dialog. GPL-3.0-or-later */
import {$, api, toast, esc, el} from './util.js';
import {ICONS} from './icons.js';
import {S, hooks} from './state.js';
import {BOARD_THEMES, PIECE_SETS, applyAppearance, isImageSet} from './theme.js';
import {DEFAULT_PERSONALITIES, BOT_STYLES, OLD_PROMPTS} from './personas.js';

export const SET = {
  appearance: {board: 'brown', custom: ['#f0d9b5', '#b58863'], pieces: 'cburnett', coords: true, dots: true, animate: true, sound: true, customPieces: {}},
  chat: {enabled: true, engineTalk: true},
  personalities: DEFAULT_PERSONALITIES.map(p => ({...p, on: true})),
  defaultPersonality: 'random',
  modelPersonality: {},
  providers: [],
  profile: {rating: 1200, games: 0},
};
export const onSettings = {changed: null};   // app.js: refresh seat menus etc.

export async function loadSettings() {
  try {
    const s = await api('/api/settings');
    if (s.appearance) Object.assign(SET.appearance, s.appearance);
    if (s.chat) Object.assign(SET.chat, s.chat);
    if (Array.isArray(s.personalities) && s.personalities.length) {
      SET.personalities = s.personalities;
      for (const p of SET.personalities) if (OLD_PROMPTS[p.id] && p.prompt === OLD_PROMPTS[p.id]) p.prompt = DEFAULT_PERSONALITIES.find(d => d.id === p.id).prompt;
    }
    if (s.defaultPersonality) SET.defaultPersonality = s.defaultPersonality;
    if (s.modelPersonality) SET.modelPersonality = s.modelPersonality;
    SET.providers = s.providers || [];
    if (s.profile && s.profile.rating) SET.profile = s.profile;
  } catch (e) { console.warn('settings', e); }
  applyAppearance(SET.appearance);
}
let saveT = 0;
export function saveSettings(now) {
  clearTimeout(saveT);
  const go = async () => {
    try {
      const body = {appearance: SET.appearance, chat: SET.chat, personalities: SET.personalities, defaultPersonality: SET.defaultPersonality,
        modelPersonality: SET.modelPersonality, profile: SET.profile, providers: SET.providers.map(p => ({id: p.id, base: p.base, name: p.name, kind: p.kind, custom: p.custom, key: p._key || '', clearKey: p._clear}))};
      const s = await api('/api/settings', body);
      SET.providers = s.providers;
      if (onSettings.changed) onSettings.changed();
    } catch (e) { toast('Could not save settings: ' + e.message); }
  };
  if (now) return go();
  saveT = setTimeout(go, 400);
}

/* ================= dialog ================= */
const TABS = [['look', 'Appearance'], ['ai', 'AI providers'], ['engines', 'Chess engines'], ['chat', 'Chat & personalities'], ['about', 'About']];
let tab = 'look';
export function openSettings(which) {
  const d = $('settings');
  if (which) tab = which;
  d.innerHTML = '';
  const nav = el('nav', {}, el('h2', {}, 'Settings'));
  for (const [id, name] of TABS) nav.append(el('button', {class: tab === id ? 'on' : '', onclick: () => openSettings(id)}, name));
  nav.append(el('span', {class: 'sp'}), el('button', {onclick: () => d.close()}, 'Close'));
  const sec = el('section');
  d.append(el('div', {class: 'dlg'}, nav, sec));
  ({look: lookTab, ai: aiTab, engines: enginesTab, chat: chatTab, about: aboutTab})[tab](sec);
  if (!d.open) d.showModal();
}
$('settings').addEventListener('close', () => { clearInterval(pollT); hooks.render && hooks.render(); });
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').close(); });

function check(label, get, set, title) {
  const i = el('input', {type: 'checkbox'}); i.checked = !!get();
  i.onchange = () => { set(i.checked); saveSettings(); };
  return el('label', {class: 'chk', title}, i, ' ' + label);
}

/* ---------- appearance ---------- */
function lookTab(sec) {
  const a = SET.appearance;
  const apply = () => { applyAppearance(a); hooks.render(); saveSettings(); };
  sec.append(el('h3', {}, 'Appearance'), el('h4', {}, 'Board'));
  const sw = el('div', {class: 'swatches'});
  for (const [id, t] of Object.entries(BOARD_THEMES)) {
    const L = id === 'custom' ? a.custom[0] : t.light, D = id === 'custom' ? a.custom[1] : t.dark;
    const lb = `background:${t.lightbg || L}`, db = `background:${t.darkbg || D}`;
    const b = el('button', {class: 'swatch' + (a.board === id ? ' on' : ''), title: t.name, 'aria-pressed': a.board === id, onclick: () => { a.board = id; apply(); openSettings(); }},
      el('span', {class: 'mini'}, el('i', {style: lb}), el('i', {style: db}), el('i', {style: db}), el('i', {style: lb})), el('small', {}, t.name));
    sw.append(b);
  }
  sec.append(sw);
  if (a.board === 'custom') {
    const c1 = el('input', {type: 'color', value: a.custom[0]}), c2 = el('input', {type: 'color', value: a.custom[1]});
    c1.oninput = c2.oninput = () => { a.custom = [c1.value, c2.value]; applyAppearance(a); hooks.render(); };
    c1.onchange = c2.onchange = () => saveSettings();
    sec.append(el('div', {class: 'row', style: 'margin-top:8px'}, 'Light squares ', c1, ' Dark squares ', c2));
  }
  sec.append(el('h4', {}, 'Pieces'));
  const grid = el('div', {class: 'pieceSets'});
  for (const s of PIECE_SETS) {
    const pv = el('span', {class: 'pv'});
    for (const c of ['wK', 'wQ', 'bN']) {
      const i = el('i');
      if (s.id === 'glyph') i.textContent = {wK: '♔', wQ: '♕', bN: '♞'}[c];
      else if (s.id === 'letters') i.textContent = {wK: 'K', wQ: 'Q', bN: 'n'}[c];
      else if (s.id === 'blindfold') i.textContent = '';
      else if (s.id === 'custom') { if (a.customPieces?.[c]) i.style.backgroundImage = `url("${a.customPieces[c]}")`; else i.textContent = '?'; }
      else i.style.backgroundImage = `url("pieces/${s.id}/${c}.svg")`;
      pv.append(i);
    }
    grid.append(el('button', {class: 'pieceSet' + (a.pieces === s.id ? ' on' : ''), title: s.lic ? `${s.name} by ${s.by} (${s.lic})` : s.by,
      onclick: () => { if (s.id === 'custom' && Object.keys(a.customPieces || {}).length !== 12) { toast('Upload your 12 piece images first (below)'); return; } a.pieces = s.id; apply(); openSettings(); }},
    pv, el('small', {}, s.name)));
  }
  sec.append(grid);
  const up = el('input', {type: 'file', multiple: true, accept: '.svg,.png,.webp'});
  up.onchange = async () => {
    const map = {};
    for (const f of up.files) {
      const m = /^([wb])([KQRBNP])\./i.exec(f.name);
      if (!m) continue;
      map[m[1].toLowerCase() + m[2].toUpperCase()] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    }
    const n = Object.keys(map).length;
    if (n !== 12) { toast(`Found ${n} of 12 pieces. Name them wK, wQ, wR, wB, wN, wP, bK … bP (.svg or .png).`); return; }
    a.customPieces = map; a.pieces = 'custom'; apply(); openSettings();
  };
  sec.append(el('div', {class: 'row', style: 'margin-top:10px'}, el('span', {class: 'hint'}, 'Your own set: pick 12 images named wK, wQ, wR, wB, wN, wP, bK, bQ, bR, bB, bN, bP (.svg/.png)'), up));
  sec.append(el('h4', {}, 'Board options'),
    el('div', {class: 'grid2'},
      el('label', {}, 'Coordinates'), check('show a-h and 1-8 on the board', () => a.coords !== false, v => { a.coords = v; applyAppearance(a); }),
      el('label', {}, 'Move hints'), check('dots on the squares a piece can go to', () => a.dots !== false, v => { a.dots = v; applyAppearance(a); }),
      el('label', {}, 'Animation'), check('slide pieces when they move', () => a.animate !== false, v => { a.animate = v; applyAppearance(a); }),
      el('label', {}, 'Premoves'), check('queue your next move while the computer thinks (right-click cancels)', () => a.premoves !== false, v => { a.premoves = v; }),
      el('label', {}, 'Sound'), check('move and capture sounds', () => a.sound !== false, v => { a.sound = v; })));
}

/* ---------- AI providers ---------- */
function aiTab(sec) {
  sec.append(el('h3', {}, 'AI providers'),
    el('p', {class: 'hint'}, 'Local apps work out of the box on their default ports (start the app and load a model). Cloud providers need an API key; keys stay on this computer, in the data folder, and are only sent to that provider.'));
  const local = SET.providers.filter(p => p.local && !p.custom), cloud = SET.providers.filter(p => !p.local && !p.custom), custom = SET.providers.filter(p => p.custom);
  const card = p => {
    const base = el('input', {type: 'url', value: p.base || '', spellcheck: 'false', style: 'flex:1;min-width:220px'});
    base.onchange = () => { p.base = base.value.trim(); saveSettings(); };
    const status = el('span', {class: 's'});
    const test = el('button', {onclick: async () => {
      status.className = 's'; status.textContent = 'testing…';
      try { await saveSettings(true); const r = await api('/api/llm/models', {provider: p.id}); status.className = 'ok'; status.textContent = `OK: ${r.data.length} model${r.data.length === 1 ? '' : 's'}` + (r.data.some(m => m.loaded) ? ', ' + r.data.filter(m => m.loaded).length + ' loaded' : ''); }
      catch (e) { status.className = 'err'; status.textContent = e.message; }
    }}, 'Test');
    const c = el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, p.name), p.kind === 'anthropic' ? el('span', {class: 'tag'}, 'Anthropic API') : null, el('span', {class: 'grow'}), test,
      p.custom ? el('button', {class: 'danger', onclick: () => { SET.providers = SET.providers.filter(x => x !== p); saveSettings(true).then(() => openSettings()); }}, 'Remove') : null),
    el('div', {class: 'row'}, base));
    if (!p.local || p.custom) {
      const key = el('input', {type: 'password', placeholder: p.keySet ? `key saved (${p.keyHint}), type to replace` : 'API key', autocomplete: 'off', style: 'flex:1'});
      key.onchange = () => { p._key = key.value.trim(); p._clear = false; saveSettings(true).then(() => { key.value = ''; openSettings(); }); };
      c.append(el('div', {class: 'row'}, key, p.keySet ? el('button', {onclick: () => { p._clear = true; saveSettings(true).then(() => openSettings()); }}, 'Forget key') : null));
    }
    c.append(status);
    return c;
  };
  sec.append(el('h4', {}, 'Local apps'), ...local.map(card), el('h4', {}, 'Cloud'), ...cloud.map(card));
  sec.append(el('h4', {}, 'Custom providers'), ...custom.map(card));
  const n = el('input', {type: 'text', placeholder: 'Name (e.g. My GPU box)'}), u = el('input', {type: 'url', placeholder: 'http://192.168.1.20:8080/v1', spellcheck: 'false'});
  const k = el('input', {type: 'password', placeholder: 'API key (optional)', autocomplete: 'off'});
  const kind = el('select', {}, el('option', {value: 'openai'}, 'OpenAI-compatible'), el('option', {value: 'anthropic'}, 'Anthropic API'));
  sec.append(el('div', {class: 'card'}, el('span', {class: 't'}, 'Add a custom provider'),
    el('div', {class: 'grid2'}, el('label', {}, 'Name'), n, el('label', {}, 'URL'), u, el('label', {}, 'API type'), kind, el('label', {}, 'API key'), k),
    el('div', {class: 'row'}, el('button', {class: 'primary', onclick: async () => {
      if (!u.value.trim()) { toast('Enter the URL'); return; }
      const id = 'custom-' + Date.now().toString(36);
      SET.providers.push({id, name: n.value.trim() || u.value.trim(), base: u.value.trim(), kind: kind.value, custom: true, _key: k.value.trim()});
      await saveSettings(true); openSettings();
    }}, 'Add provider'))));
}

/* ---------- engines ---------- */
let pollT = 0;
export async function refreshEngines() {
  try { const r = await api('/api/engines'); S.engineList = r.installed; S.engineCatalog = r; return r; }
  catch (e) { S.engineList = S.engineList || []; return null; }
}
async function enginesTab(sec) {
  sec.append(el('h3', {}, 'Chess engines'), el('p', {class: 'hint'}, 'The built-in engine always works (all variants, levels 1-5). Install real engines with one click: they are downloaded from their official GitHub releases into the data folder.'));
  const box = el('div'); sec.append(box);
  const draw = async () => {
    const r = await refreshEngines();
    box.innerHTML = '';
    if (!r) { box.append(el('p', {class: 'err'}, 'Engine list unavailable (is the server running?)')); return; }
    box.append(el('h4', {}, 'Installed'));
    if (!r.installed.length) box.append(el('p', {class: 'hint'}, 'Nothing yet besides the built-in engine.'));
    for (const e of r.installed) {
      const plays = (e.variants || ['chess']).map(v => ({chess: 'standard', kingofthehill: 'King of the Hill', '3check': 'Three-check'}[v] || v)).join(', ') + (e.chess960 ? ', Chess960' : '');
      box.append(el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, e.name), el('span', {class: 'tag'}, {elo: 'Elo slider', nodes: 'neural net', maia: 'human-like', time: 'time per move'}[e.kind] || e.kind),
        el('span', {class: 'grow'}), el('button', {class: 'danger', onclick: async () => { if (confirm(`Remove ${e.name}?`)) { await api('/api/engines/remove', {id: e.id}); draw(); } }}, 'Remove')),
      el('span', {class: 's'}, 'Plays: ' + plays + (e.elo ? ` · strength ${e.elo[0]}-${e.elo[1]} Elo or full` : '')),
      e.kind === 'maia' ? el('span', {class: 's'}, 'Ratings: ' + Object.keys(e.weights || {}).join(', ')) : null));
    }
    let running = false;
    const groups = [['top', 'Get engines: the strongest'], ['veteran', 'Veterans and lesser-known engines']];
    for (const [g, head] of groups) {
    box.append(el('h4', {}, head));
    for (const c of r.catalog.filter(x => (x.group || 'top') === g)) {
      const job = r.jobs[c.id];
      const card = el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, c.name), el('span', {class: 'grow'}),
        c.installed && !(job && job.state === 'running') ? el('span', {class: 'ok'}, 'installed') : null,
        !c.available ? el('span', {class: 's'}, 'no download for this system') :
          el('button', {class: c.installed ? '' : 'primary', disabled: job && job.state === 'running', onclick: async () => { await api('/api/engines/install', {id: c.id}); draw(); }}, c.installed ? 'Reinstall' : 'Install')),
      el('span', {class: 's'}, c.about + (c.requires ? ` (installs ${c.requires} too)` : '')));
      if (job && job.state === 'running') {
        running = true;
        const pct = job.total ? Math.round(job.done / job.total * 100) : 0;
        card.append(el('span', {class: 's'}, job.step + (job.total ? ` · ${(job.done / 1e6).toFixed(1)} of ${(job.total / 1e6).toFixed(1)} MB` : '')), el('div', {class: 'bar'}, el('i', {style: `width:${pct}%`})));
      } else if (job && job.state === 'error') card.append(el('span', {class: 'err'}, job.step));
      box.append(card);
    }
    }
    box.append(el('h4', {}, 'Built into the game (no download)'),
      el('div', {class: 'card'}, el('span', {class: 't'}, 'Turochamp (1948)'), el('span', {class: 's'}, 'The first chess program ever written, by Alan Turing and David Champernowne, before any computer could run it. Turing played it by hand in 1952. Recreated from their rules: it looks at its move and your reply, then follows the captures until things calm down.')),
      el('div', {class: 'card'}, el('span', {class: 't'}, 'Random mover'), el('span', {class: 's'}, 'Plays any legal move. Good for testing chaos mode, or your patience.')));
    box.append(el('h4', {}, 'Not available'));
    for (const u of r.unavailable) box.append(el('div', {class: 'card'}, el('span', {class: 't'}, u.name), el('span', {class: 's'}, u.about)));
    const path = el('input', {type: 'text', placeholder: 'C:\\Engines\\myengine.exe', spellcheck: 'false', style: 'flex:1'});
    const name = el('input', {type: 'text', placeholder: 'Name (optional)'});
    const msg = el('span', {class: 's'});
    box.append(el('h4', {}, 'Add your own UCI engine'), el('div', {class: 'card'},
      el('div', {class: 'row'}, path, el('button', {onclick: async () => { const r2 = await api('/api/engines/browse', {}); if (r2.path) path.value = r2.path; }}, 'Browse…')),
      el('div', {class: 'row'}, name, el('button', {class: 'primary', onclick: async () => {
        msg.className = 's'; msg.textContent = 'starting the engine…';
        try { const r2 = await api('/api/engines/add', {path: path.value, name: name.value}); msg.className = 'ok'; msg.textContent = 'Added ' + r2.engine.name; setTimeout(draw, 800); }
        catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      }}, 'Add engine')), msg,
      el('span', {class: 's'}, 'Any engine that speaks UCI works (Komodo, Ethereal, Rubichess, Obsidian, …).')));
    clearInterval(pollT);
    if (running) pollT = setInterval(() => { if ($('settings').open && tab === 'engines') draw(); else clearInterval(pollT); }, 1000);
    if (onSettings.changed) onSettings.changed();
  };
  draw();
}

/* ---------- chat & personalities ---------- */
let openPersona = null;   /* a freshly added personality opens expanded */
function chatTab(sec) {
  const c = SET.chat;
  sec.append(el('h3', {}, 'Chat & personalities'),
    el('div', {class: 'grid2'},
      el('label', {}, 'Chat'), check('opponents chat with you (AI models in character, engines with canned lines)', () => c.enabled, v => { c.enabled = v; S.chatOn = v; hooks.render(); }),
      el('label', {}, 'Engine remarks'), check('engines sometimes comment on moves and captures', () => c.engineTalk !== false, v => { c.engineTalk = v; })),
    el('p', {class: 'hint'}, 'Every computer opponent gets a personality at the start of a game. It is never shown during play: it just changes how they talk.'));
  const opts = sel => [el('option', {value: 'random'}, 'Random each game'), ...SET.personalities.map(p => el('option', {value: p.id, selected: sel === p.id}, p.name))];
  const def = el('select', {}, ...opts(SET.defaultPersonality)); def.value = SET.defaultPersonality;
  def.onchange = () => { SET.defaultPersonality = def.value; saveSettings(); };
  sec.append(el('h4', {}, 'Defaults'), el('div', {class: 'grid2'}, el('label', {}, 'Default for everyone'), def));
  const known = new Map();
  for (const P of S.seats) if (P && (P.type === 'llm' || P.type === 'engine')) known.set(personaKey(P), P.type === 'llm' ? P.model : (P.engine || 'built-in engine'));
  for (const k of Object.keys(SET.modelPersonality)) if (!known.has(k)) known.set(k, k.replace(/^(llm|engine):([^|]*\|)?/, ''));
  const g = el('div', {class: 'grid2', style: 'margin-top:8px'});
  for (const [k, label] of known) {
    const s = el('select', {}, el('option', {value: ''}, 'Use the default'), ...opts(SET.modelPersonality[k])); s.value = SET.modelPersonality[k] || '';
    s.onchange = () => { if (s.value) SET.modelPersonality[k] = s.value; else delete SET.modelPersonality[k]; saveSettings(); };
    g.append(el('label', {title: k}, label), s);
  }
  if (known.size) sec.append(el('p', {class: 'hint'}, 'Per player (the models and engines you have played):'), g);
  sec.append(el('h4', {}, `Personalities (${SET.personalities.filter(p => p.on !== false).length} of ${SET.personalities.length} in the random pool)`));
  const list = el('div', {class: 'plist'});
  for (const p of SET.personalities) {
    const name = el('input', {type: 'text', value: p.name, style: 'flex:1'}), prompt = el('textarea', {}, p.prompt);
    const bot = el('select', {}, ...BOT_STYLES.map(b => el('option', {value: b, selected: p.bot === b}, b)));
    const on = el('input', {type: 'checkbox', title: 'In the random pool'}); on.checked = p.on !== false;
    const title = el('span', {class: 'pname'}, p.name), sum = el('span', {class: 'psum'}, p.prompt);
    name.onchange = () => { p.name = name.value; title.textContent = p.name; saveSettings(); };
    prompt.onchange = () => { p.prompt = prompt.value; sum.textContent = p.prompt; saveSettings(); };
    bot.onchange = () => { p.bot = bot.value; saveSettings(); };
    on.onchange = () => { p.on = on.checked; saveSettings(); };
    on.onclick = e => e.stopPropagation();
    const d = el('details', {class: 'pcard'},
      el('summary', {}, el('span', {class: 'chev', html: ICONS['caret-down']}), on, title, sum),
      el('div', {class: 'pbody'},
        el('div', {class: 'row'}, name, el('button', {class: 'danger', onclick: () => { SET.personalities = SET.personalities.filter(x => x !== p); saveSettings(); openSettings(); }}, 'Delete')),
        el('span', {class: 's'}, 'How an AI model plays this character (keep it about how they chat: short, and whether they bother to answer):'), prompt,
        el('div', {class: 'row'}, el('span', {class: 's'}, 'Engine chat style'), bot)));
    if (p.id === openPersona) d.open = true;
    list.append(d);
  }
  sec.append(list);
  sec.append(el('div', {class: 'row'}, el('button', {class: 'primary', onclick: () => {
    const id = 'p' + Date.now().toString(36);
    SET.personalities.push({id, name: 'New personality', prompt: 'Describe how they type in the chat: short or chatty, friendly or rude, and what they ignore.', bot: 'friendly', on: true});
    openPersona = id; saveSettings(); openSettings();
  }}, 'Add personality'), el('button', {onclick: () => { if (confirm('Restore the built-in personalities? Your own ones are kept.')) {
    const mine = SET.personalities.filter(p => !DEFAULT_PERSONALITIES.some(d => d.id === p.id));
    SET.personalities = DEFAULT_PERSONALITIES.map(p => ({...p, on: true})).concat(mine); saveSettings(); openSettings();
  } }}, 'Restore built-in')));
}
export function personaKey(P) { return P.type === 'llm' ? `llm:${P.provider}|${P.model}` : `engine:${P.engine || 'builtin'}`; }

/* ---------- about ---------- */
function aboutTab(sec) {
  sec.append(el('h3', {}, 'AI Chess ' + (S.config.version || '')),
    el('p', {}, 'Play chess against your local AI models, cloud models and real chess engines, or let them play each other.'),
    el('p', {}, el('a', {href: 'https://github.com/BrandScape-Media/ai-chess', target: '_blank', rel: 'noopener'}, 'github.com/BrandScape-Media/ai-chess'), ' · GPL-3.0-or-later'),
    el('h4', {}, 'Piece artwork'),
    el('p', {class: 'hint'}, 'From the lichess project; see web/pieces/LICENSES.md.'),
    el('div', {}, ...PIECE_SETS.filter(s => s.lic).map(s => el('div', {class: 'hint'}, `${s.name}: ${s.by} (${s.lic})`))),
    el('h4', {}, 'Engines'),
    el('p', {class: 'hint'}, 'The installable engines (Stockfish, Leela Chess Zero, Maia, Arasan and the rest) are separate programs with their own licenses, downloaded from their official releases only when you click Install.'));
}
export {isImageSet};
