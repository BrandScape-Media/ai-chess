/* app settings (kept by the server in data/settings.json) and the Settings dialog. GPL-3.0-or-later */
import {$, api, toast, esc, el} from './util.js';
import {ICONS} from './icons.js';
import {S, hooks} from './state.js';
import {BOARD_THEMES, PIECE_SETS, applyAppearance, isImageSet} from './theme.js';
import {DEFAULT_PERSONALITIES, BOT_STYLES, OLD_PROMPTS} from './personas.js';
import {TIERS, tierById, tierFor} from './levels.js';

export const SET = {
  appearance: {board: 'brown', custom: ['#f0d9b5', '#b58863'], pieces: 'cburnett', coords: true, dots: true, animate: true, sound: true, customPieces: {}},
  chat: {enabled: true, engineTalk: true},
  personalities: DEFAULT_PERSONALITIES.map(p => ({...p, on: true})),
  defaultPersonality: 'random',
  modelPersonality: {},
  providers: [],
  profile: {rating: 1200, games: 0},
  /* assistance while playing (chess.com-style options; can be switched before and during a game) */
  assist: {evalbar: false, feedback: false, suggest: false, threat: false, lines: false},
  /* puzzles (puzzles.js): daily.done is ''|'clean'|'solved'|'shown', hist the days solved; tally and themes[t] are [played, firstTry, ratingSum] */
  puzzles: {rating: 1200, played: 0, solved: 0, streakBest: 0, rushBest: 0, rushCombo: 0,
    daily: {date: '', id: '', done: '', last: '', streak: 0, best: 0, hist: [], recent: [], scored: ''},
    tally: [0, 0, 0], themes: {}, battle: {played: 0, won: 0, lost: 0, drawn: 0, best: 0, pick: 0}},
  /* the AI model that explains moves in the game review (empty: the model you played, if any) */
  coach: {provider: '', model: '', think: 'none'},
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
    if (s.assist) Object.assign(SET.assist, s.assist);
    if (s.puzzles) Object.assign(SET.puzzles, s.puzzles);
    if (s.coach) Object.assign(SET.coach, s.coach);
    SET._loaded = true;   /* the server answered (an empty answer is a first start) */
  } catch (e) { console.warn('settings', e); }
  applyAppearance(SET.appearance);
}
let saveT = 0;
export function saveSettings(now) {
  clearTimeout(saveT);
  const go = async () => {
    try {
      const body = {appearance: SET.appearance, chat: SET.chat, personalities: SET.personalities, defaultPersonality: SET.defaultPersonality,
        modelPersonality: SET.modelPersonality, profile: SET.profile, assist: SET.assist, puzzles: SET.puzzles, coach: SET.coach, providers: SET.providers.map(p => ({id: p.id, base: p.base, name: p.name, kind: p.kind, custom: p.custom, key: p._key || '', clearKey: p._clear}))};
      const s = await api('/api/settings', body);
      SET.providers = s.providers;
      if (onSettings.changed) onSettings.changed();
    } catch (e) { toast('Could not save settings: ' + e.message); }
  };
  if (now) return go();
  saveT = setTimeout(go, 400);
}

/* ================= dialog ================= */
const TABS = [['you', 'You'], ['look', 'Appearance'], ['ai', 'AI providers'], ['engines', 'Chess engines'], ['chat', 'Chat & personalities'], ['about', 'About']];
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
  ({you: youTab, look: lookTab, ai: aiTab, engines: enginesTab, chat: chatTab, about: aboutTab})[tab](sec);
  if (!d.open) d.showModal();
}
$('settings').addEventListener('close', () => { clearInterval(pollT); hooks.render && hooks.render(); });
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').close(); });

/* a setting with an on/off switch; the explanation shows on hover */
function toggle(name, get, set, tip) {
  const i = el('input', {type: 'checkbox', class: 'switch', 'aria-label': name}); i.checked = !!get();
  i.onchange = () => { set(i.checked); saveSettings(); };
  return el('label', {class: 'swl', title: tip || ''}, el('span', {}, name), i);
}

/* ---------- you: your level and ratings ---------- */
/* the five levels as cards (the first-start dialog uses the same ones) */
export function levelCards(cur, onPick) {
  const box = el('div', {class: 'tiers', role: 'radiogroup', 'aria-label': 'Your level'});
  TIERS.forEach((t, i) => {
    const b = el('button', {type: 'button', class: 'tier' + (t.id === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(t.id === cur), onclick: () => {
      for (const x of box.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); }
      b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onPick(t);
    }},
    el('span', {class: 'lvbars', 'aria-hidden': 'true'}, ...TIERS.map((_, k) => el('i', {class: k <= i ? 'on' : ''}))),
    el('span', {class: 'tt'}, el('b', {}, t.name), el('small', {}, t.sub)),
    el('span', {class: 'tr', title: 'Starting rating'}, String(t.rating)));
    box.append(b);
  });
  return box;
}
function youTab(sec) {
  const pr = SET.profile || {rating: 1200, games: 0}, pz = SET.puzzles || {};
  const cur = tierById(pr.level) || tierFor(pr.rating || 1200);
  sec.append(el('h3', {}, 'You'),
    el('div', {class: 'youstats'},
      el('div', {}, el('b', {}, String(pr.rating || 1200)), el('small', {}, `Game rating · ${pr.games || 0} ${pr.games === 1 ? 'game' : 'games'}`)),
      el('div', {}, el('b', {}, String(pz.rating || 1200)), el('small', {}, `Puzzle rating · ${pz.played || 0} played`))));
  sec.append(group('you-level', 'Your level', cur.name, [
    el('p', {class: 'hint'}, 'Sets how strong your opponents are by default: the built-in engine, Stockfish, Maia and the AI you face first. Changing it later keeps your rating unless you ask to reset it.'),
    levelCards(cur.id, t => {
      const reset = !(pr.games > 0) || confirm(`Also set your rating to ${t.rating}? It is ${pr.rating} now, after ${pr.games} ${pr.games === 1 ? 'game' : 'games'}.`);
      if (hooks.applyLevel) hooks.applyLevel(t, {rating: reset});
      openSettings('you');
    })]));
}

/* ---------- appearance ---------- */
function lookTab(sec) {
  const a = SET.appearance;
  const apply = () => { applyAppearance(a); hooks.render(); saveSettings(); };
  sec.append(el('h3', {}, 'Appearance'));
  const boardKids = [], pieceKids = [];
  const sw = el('div', {class: 'swatches'});
  for (const [id, t] of Object.entries(BOARD_THEMES)) {
    const L = id === 'custom' ? a.custom[0] : t.light, D = id === 'custom' ? a.custom[1] : t.dark;
    const lb = `background:${t.lightbg || L}`, db = `background:${t.darkbg || D}`;
    const b = el('button', {class: 'swatch' + (a.board === id ? ' on' : ''), title: t.name, 'aria-pressed': a.board === id, onclick: () => { a.board = id; apply(); openSettings(); }},
      el('span', {class: 'mini'}, el('i', {style: lb}), el('i', {style: db}), el('i', {style: db}), el('i', {style: lb})), el('small', {}, t.name));
    sw.append(b);
  }
  boardKids.push(sw);
  if (a.board === 'custom') {
    const c1 = el('input', {type: 'color', value: a.custom[0]}), c2 = el('input', {type: 'color', value: a.custom[1]});
    c1.oninput = c2.oninput = () => { a.custom = [c1.value, c2.value]; applyAppearance(a); hooks.render(); };
    c1.onchange = c2.onchange = () => saveSettings();
    boardKids.push(el('div', {class: 'row', style: 'margin-top:8px'}, 'Light squares ', c1, ' Dark squares ', c2));
  }
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
  pieceKids.push(grid);
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
  pieceKids.push(el('div', {class: 'row', style: 'margin-top:10px'}, el('span', {class: 'hint'}, 'Your own set: pick 12 images named wK, wQ, wR, wB, wN, wP, bK, bQ, bR, bB, bN, bP (.svg/.png)'), up));
  sec.append(group('look-board', 'Board', (BOARD_THEMES[a.board] || {}).name || '', boardKids),
    group('look-pieces', 'Pieces', (PIECE_SETS.find(p => p.id === a.pieces) || {}).name || '', pieceKids),
    group('look-options', 'Board options', 'Coordinates, move hints, animation, premoves, sound', [el('div', {class: 'swlist'},
      toggle('Coordinates', () => a.coords !== false, v => { a.coords = v; applyAppearance(a); }, 'Show a-h and 1-8 on the board'),
      toggle('Move hints', () => a.dots !== false, v => { a.dots = v; applyAppearance(a); }, 'Dots on the squares a piece can go to'),
      toggle('Animation', () => a.animate !== false, v => { a.animate = v; applyAppearance(a); }, 'Slide pieces when they move'),
      toggle('Premoves', () => a.premoves !== false, v => { a.premoves = v; }, 'Queue moves while the computer thinks (right-click cancels them)'),
      toggle('Sound', () => a.sound !== false, v => { a.sound = v; }, 'Move and capture sounds'),
      toggle('Confetti', () => a.confetti !== false, v => { a.confetti = v; }, 'A little celebration when you win'))]));
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
  const n = el('input', {type: 'text', placeholder: 'Name (e.g. My GPU box)'}), u = el('input', {type: 'url', placeholder: 'http://192.168.1.20:8080/v1', spellcheck: 'false'});
  const k = el('input', {type: 'password', placeholder: 'API key (optional)', autocomplete: 'off'});
  const kind = el('select', {}, el('option', {value: 'openai'}, 'OpenAI-compatible'), el('option', {value: 'anthropic'}, 'Anthropic API'));
  const addCard = el('div', {class: 'card'}, el('span', {class: 't'}, 'Add a custom provider'),
    el('div', {class: 'grid2'}, el('label', {}, 'Name'), n, el('label', {}, 'URL'), u, el('label', {}, 'API type'), kind, el('label', {}, 'API key'), k),
    el('div', {class: 'row'}, el('button', {class: 'primary', onclick: async () => {
      if (!u.value.trim()) { toast('Enter the URL'); return; }
      const id = 'custom-' + Date.now().toString(36);
      SET.providers.push({id, name: n.value.trim() || u.value.trim(), base: u.value.trim(), kind: kind.value, custom: true, _key: k.value.trim()});
      openGroups.add('custom');
      await saveSettings(true); openSettings();
    }}, 'Add provider')));
  sec.append(coachGroup());
  sec.append(group('local', 'Local apps', `${local.length} apps on this computer`, local.map(card)),
    group('cloud', 'Cloud', cloud.some(p => p.keySet) ? `${cloud.filter(p => p.keySet).length} of ${cloud.length} with a key` : `${cloud.length} services, need an API key`, cloud.map(card)),
    group('custom', 'Custom providers', custom.length ? `${custom.length} added` : 'Any OpenAI-compatible or Anthropic API', [...custom.map(card), addCard]));
}
/* the AI coach of the game review: which model explains the moves (it only gets the engine's facts) */
function coachGroup() {
  const c = SET.coach, prov = el('select', {}, el('option', {value: ''}, 'The model I played against'), ...SET.providers.map(p => el('option', {value: p.id}, p.name)));
  prov.value = c.provider || '';
  const list = el('datalist', {id: 'coachModels'}), model = el('input', {type: 'text', list: 'coachModels', spellcheck: 'false', placeholder: 'model name', value: c.model || '', style: 'width:100%'});
  const think = el('select', {}, el('option', {value: 'none'}, 'Off (fast)'), el('option', {value: 'low'}, 'Low'), el('option', {value: 'medium'}, 'Medium'));
  think.value = c.think || 'none';
  const status = el('span', {class: 's'});
  const fill = async () => {
    list.innerHTML = ''; model.disabled = !prov.value;
    if (!prov.value) { status.textContent = 'Uses the AI model from your game, when there is one.'; return; }
    status.textContent = 'loading the models…';
    try {
      const r = await api('/api/llm/models', {provider: prov.value});
      for (const m of r.data.filter(m => !/embed/i.test(m.id))) list.append(el('option', {value: m.id, label: m.loaded ? '● loaded' : ''}));
      if (!model.value && r.data.length) { model.value = (r.data.find(m => m.loaded) || r.data[0]).id; save(); }
      status.textContent = `${r.data.length} models`;
    } catch (e) { status.textContent = e.message; }
  };
  const save = () => { SET.coach = {provider: prov.value, model: prov.value ? model.value.trim() : '', think: think.value}; saveSettings(); };
  prov.onchange = () => { model.value = ''; save(); fill(); };
  model.onchange = think.onchange = save;
  fill();
  const sub = c.provider && c.model ? c.model : 'The model you played against';
  return group('coach', 'Game review coach', sub, [el('div', {class: 'card'},
    el('span', {class: 's'}, 'In a game review, Explain asks this model about a move. It only gets the engine\'s facts (the best move, the lines, the chances), so it explains instead of guessing.'),
    el('div', {class: 'grid2'}, el('label', {}, 'Provider'), prov, el('label', {}, 'Model'), el('span', {}, model, list), el('label', {}, 'Thinking'), think), status)]);
}
/* collapsible group of cards; remembers which ones are open */
const openGroups = new Set(['local', 'look-board', 'eng-installed', 'chat-defaults', 'you-level']);
function group(key, title, sub, kids) {
  const d = el('details', {class: 'grp'}, el('summary', {}, el('span', {class: 'chev', html: ICONS['caret-down']}), el('b', {}, title), el('small', {}, sub)), el('div', {class: 'grpbody'}, ...kids));
  d.open = openGroups.has(key);
  d.ontoggle = () => { if (d.open) openGroups.add(key); else openGroups.delete(key); };
  return d;
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
    const inst = [];
    if (!r.installed.length) inst.push(el('p', {class: 'hint'}, 'Nothing yet besides the built-in engine.'));
    for (const e of r.installed) {
      const plays = (e.variants || ['chess']).map(v => ({chess: 'standard', kingofthehill: 'King of the Hill', '3check': 'Three-check'}[v] || v)).join(', ') + (e.chess960 ? ', Chess960' : '');
      inst.push(el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, e.name), el('span', {class: 'tag'}, {elo: 'Elo slider', nodes: 'neural net', maia: 'human-like', time: 'time per move'}[e.kind] || e.kind),
        el('span', {class: 'grow'}), el('button', {class: 'danger', onclick: async () => { if (confirm(`Remove ${e.name}?`)) { await api('/api/engines/remove', {id: e.id}); draw(); } }}, 'Remove')),
      el('span', {class: 's'}, 'Plays: ' + plays + (e.elo ? ` · strength ${e.elo[0]}-${e.elo[1]} Elo or full` : '')),
      e.kind === 'maia' ? el('span', {class: 's'}, 'Ratings: ' + Object.keys(e.weights || {}).join(', ')) : null));
    }
    box.append(group('eng-installed', 'Installed', r.installed.length ? `${r.installed.length} installed, plus the built-in engine` : 'Only the built-in engine', inst));
    let running = false;
    const addPath = el('input', {type: 'text', placeholder: 'C:\\Engines\\myengine.exe', spellcheck: 'false', style: 'flex:1'});
    const groups = [['top', 'Get engines', 'eng-top'], ['veteran', 'Veterans and lesser-known engines', 'eng-vet']];
    for (const [g, head, key] of groups) {
      const kids = [], cat = r.catalog.filter(x => (x.group || 'top') === g);
      for (const c of cat) {
        const job = r.jobs[c.id];
        const card = el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, c.name), el('span', {class: 'grow'}),
          c.installed && !(job && job.state === 'running') ? el('span', {class: 'ok'}, 'installed') : null,
          !c.available ? el('span', {class: 's'}, 'no download for this system') :
            el('button', {class: c.installed ? '' : 'primary', disabled: job && job.state === 'running', onclick: async () => { await api('/api/engines/install', {id: c.id}); draw(); }}, c.installed ? 'Reinstall' : 'Install')),
        el('span', {class: 's'}, c.about + (c.requires ? ` (installs ${c.requires} too)` : '')));
        if (job && job.state === 'running') {
          running = true; openGroups.add(key);
          const pct = job.total ? Math.round(job.done / job.total * 100) : 0;
          card.append(el('span', {class: 's'}, job.step + (job.total ? ` · ${(job.done / 1e6).toFixed(1)} of ${(job.total / 1e6).toFixed(1)} MB` : '')), el('div', {class: 'bar'}, el('i', {style: `width:${pct}%`})));
        } else if (job && job.state === 'error') card.append(el('span', {class: 'err'}, job.step));
        kids.push(card);
      }
      if (g === 'top') for (const u of r.unavailable)   /* commercial engines: no download, but you can add your own copy */
        kids.push(el('div', {class: 'card'}, el('div', {class: 'row'}, el('span', {class: 't'}, u.name), el('span', {class: 'tag'}, 'Commercial'), el('span', {class: 'grow'}),
          el('button', {onclick: () => { const d = addPath.closest('details'); if (d) d.open = true; addPath.scrollIntoView({behavior: 'smooth', block: 'center'}); addPath.focus(); }}, 'Add your copy')), el('span', {class: 's'}, u.about)));
      const n = cat.filter(c => c.installed).length;
      box.append(group(key, head, `${cat.length} engines` + (n ? `, ${n} installed` : ''), kids));
    }
    box.append(group('eng-builtin', 'Built into the game', 'Turochamp (1948) and a random mover, no download', [
      el('div', {class: 'card'}, el('span', {class: 't'}, 'Turochamp (1948)'), el('span', {class: 's'}, 'The first chess program ever written, by Alan Turing and David Champernowne, before any computer could run it. Turing played it by hand in 1952. Recreated from their rules: it looks at its move and your reply, then follows the captures until things calm down.')),
      el('div', {class: 'card'}, el('span', {class: 't'}, 'Random mover'), el('span', {class: 's'}, 'Plays any legal move. Good for testing chaos mode, or your patience.'))]));
    const path = addPath;
    const name = el('input', {type: 'text', placeholder: 'Name (optional)'});
    const msg = el('span', {class: 's'});
    box.append(group('eng-add', 'Add your own UCI engine', 'Komodo, Ethereal, Rubichess or any other UCI engine', [el('div', {class: 'card'},
      el('div', {class: 'row'}, path, el('button', {onclick: async () => { const r2 = await api('/api/engines/browse', {}); if (r2.path) path.value = r2.path; }}, 'Browse…')),
      el('div', {class: 'row'}, name, el('button', {class: 'primary', onclick: async () => {
        msg.className = 's'; msg.textContent = 'starting the engine…';
        try { const r2 = await api('/api/engines/add', {path: path.value, name: name.value}); msg.className = 'ok'; msg.textContent = 'Added ' + r2.engine.name; setTimeout(draw, 800); }
        catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      }}, 'Add engine')), msg,
      el('span', {class: 's'}, 'Any engine that speaks UCI works (Komodo, Ethereal, Rubichess, Obsidian, …).'))]));
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
    el('div', {class: 'swlist'},
      toggle('Chat', () => c.enabled, v => { c.enabled = v; S.chatOn = v; hooks.render(); }, 'Opponents chat with you: AI models in character, engines with canned lines'),
      toggle('Engine remarks', () => c.engineTalk !== false, v => { c.engineTalk = v; }, 'Engines sometimes comment on moves and captures')),
    el('p', {class: 'hint'}, 'Every computer opponent gets a personality at the start of a game. It is never shown during play: it just changes how they talk.'));
  const opts = sel => [el('option', {value: 'random'}, 'Random each game'), ...SET.personalities.map(p => el('option', {value: p.id, selected: sel === p.id}, p.name))];
  const def = el('select', {}, ...opts(SET.defaultPersonality)); def.value = SET.defaultPersonality;
  def.onchange = () => { SET.defaultPersonality = def.value; saveSettings(); };
  const defKids = [el('div', {class: 'grid2'}, el('label', {}, 'Default for everyone'), def)];
  const known = new Map();
  for (const P of S.seats) if (P && (P.type === 'llm' || P.type === 'engine')) known.set(personaKey(P), P.type === 'llm' ? P.model : (P.engine || 'built-in engine'));
  for (const k of Object.keys(SET.modelPersonality)) if (!known.has(k)) known.set(k, k.replace(/^(llm|engine):([^|]*\|)?/, ''));
  const g = el('div', {class: 'grid2', style: 'margin-top:8px'});
  for (const [k, label] of known) {
    const s = el('select', {}, el('option', {value: ''}, 'Use the default'), ...opts(SET.modelPersonality[k])); s.value = SET.modelPersonality[k] || '';
    s.onchange = () => { if (s.value) SET.modelPersonality[k] = s.value; else delete SET.modelPersonality[k]; saveSettings(); };
    g.append(el('label', {title: k}, label), s);
  }
  if (known.size) defKids.push(el('p', {class: 'hint'}, 'Per player (the models and engines you have played):'), g);
  const defName = SET.defaultPersonality === 'random' ? 'Random each game' : (SET.personalities.find(p => p.id === SET.defaultPersonality) || {}).name || '';
  sec.append(group('chat-defaults', 'Defaults', defName + (known.size ? ` · ${known.size} per player` : ''), defKids));
  const list = el('div', {class: 'plist'});
  for (const p of SET.personalities) {
    const name = el('input', {type: 'text', value: p.name, style: 'flex:1'}), prompt = el('textarea', {}, p.prompt);
    const bot = el('select', {}, ...BOT_STYLES.map(b => el('option', {value: b, selected: p.bot === b}, b)));
    const on = el('input', {type: 'checkbox', class: 'switch sm', title: 'In the random pool: picked when opponents get a random personality', 'aria-label': 'In the random pool'}); on.checked = p.on !== false;
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
  const persBtns = el('div', {class: 'row'}, el('button', {class: 'primary', onclick: () => {
    const id = 'p' + Date.now().toString(36);
    openGroups.add('chat-pers');
    SET.personalities.push({id, name: 'New personality', prompt: 'Describe how they type in the chat: short or chatty, friendly or rude, and what they ignore.', bot: 'friendly', on: true});
    openPersona = id; saveSettings(); openSettings();
  }}, 'Add personality'), el('button', {onclick: () => { if (confirm('Restore the built-in personalities? Your own ones are kept.')) {
    const mine = SET.personalities.filter(p => !DEFAULT_PERSONALITIES.some(d => d.id === p.id));
    SET.personalities = DEFAULT_PERSONALITIES.map(p => ({...p, on: true})).concat(mine); saveSettings(); openSettings();
  } }}, 'Restore built-in'));
  sec.append(group('chat-pers', 'Personalities', `${SET.personalities.filter(p => p.on !== false).length} of ${SET.personalities.length} in the random pool`, [list, persBtns]));
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
    el('p', {class: 'hint'}, 'Stockfish (GPL-3.0) comes with the game. The other engines (Leela Chess Zero, Maia, Arasan and the rest) are separate programs with their own licenses, downloaded from their official releases only when you click Install.'),
    el('h4', {}, 'Data'),
    el('p', {class: 'hint'}, 'Puzzles from the lichess puzzle database, opening names from lichess-org/chess-openings (both CC0).'));
}
export {isImageSet};
