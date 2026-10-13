/* AI Chess: page wiring, setup panel, board, game flow, saved game. GPL-3.0-or-later */
import * as C from './core.js';
import {$, api, toast, el, esc, relayOK} from './util.js';
import {S, SIDE, VARIANT_NAME, VARIANT_UCI, hooks, isAI, timed, humanCount, rulesOff, seatName, shortModel, ascii, histText, remember} from './state.js';
import {applyAppearance, setPiece, preloadCanvasPieces, isImageSet, glyph} from './theme.js';
import {SET, loadSettings, saveSettings, openSettings, refreshEngines, onSettings} from './settings.js';
import {askEngine, askLLM, cancelThinking, resolveIllegal, arrowGeom, sqXY, ARROW_COL, bestMoveHint} from './players.js';
import {ICONS, icon} from './icons.js';
import {BOTS} from './historic.js';
import {initPuzzles, puzzleMove, renderPanel as renderPuzzles} from './puzzles.js';
import {analyze, threat, classify, winPct, fmtEval, CLASSES} from './analysis.js';
import {initChat, assignPersonas, onGameStart, onMove, onGameOver, onTakeback, say, sysMsg, chatVisible, restoreChat, showTab, activeTab} from './chat.js';
import {initReview, startReview, renderReviewTab, reviewArrows, checkRetry, reviewReady, openReview} from './review.js';

const VAL = [0, 1, 3, 3, 5, 9, 0];
const START_COUNT = [0, 8, 2, 2, 2, 1, 1];
const PAGE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
const SHOT = /shot/.test(location.hash);   /* screenshot mode (README images): read-only, no long-poll */
const ELO_STEPS = [0, 3000, 2700, 2500, 2300, 2100, 1900, 1700, 1500, 1400, 1320];
const TIMES = [[200, '0.2 s'], [500, '0.5 s'], [1000, '1 s'], [2000, '2 s'], [5000, '5 s'], [10000, '10 s']];
const BUILTIN_ELO = [400, 800, 1200, 1800, 2200];   /* rough estimates for the built-in levels */
/* rough full-strength estimates (CCRL-like scale) */
const FULL_ELO = {stockfish: 3600, 'fairy-stockfish': 3400, berserk: 3550, koivisto: 3450, obsidian: 3600, caissa: 3550, clover: 3550, halogen: 3450,
  arasan: 3450, weiss: 3050, fabchess: 2900, seer: 3400, velvet: 3300, altair: 3300};
/* player-card pictures: an icon and a colour per engine */
const AVATAR = {builtin: ['cpu-fill', '#46505a'], turochamp: ['scroll-fill', '#5a4d3c'], random: ['dice-five-fill', '#54465c'],
  stockfish: ['fish-fill', '#3c5a49'], 'fairy-stockfish': ['magic-wand-fill', '#4f4866'], lc0: ['brain-fill', '#5e3f3a'], maia: ['graduation-cap-fill', '#5e4c33'],
  berserk: ['flame-fill', '#5e3d33'], koivisto: ['tree-fill', '#435a3e'], obsidian: ['diamond-fill', '#8a8299'], caissa: ['crown-fill', '#5c5235'],
  clover: ['clover-fill', '#3b5a47'], halogen: ['atom-fill', '#5c5634'], arasan: ['castle-turret-fill', '#5e473b'], weiss: ['snowflake-fill', '#405766'],
  fabchess: ['gear-six-fill', '#5e4733'], seer: ['eye-fill', '#3a5856'], velvet: ['feather-fill', '#5a3a45'], altair: ['star-four-fill', '#3a4660']};
const TC_GROUPS = [['Bullet', 'flame-fill', [['60+0', '1 min'], ['60+1', '1 | 1'], ['120+1', '2 | 1']]],
  ['Blitz', 'lightning', [['180+0', '3 min'], ['180+2', '3 | 2'], ['300+0', '5 min']]],
  ['Rapid', 'timer', [['600+0', '10 min'], ['600+5', '10 | 5'], ['900+10', '15 | 10']]],
  ['Other', 'clock', [['1800+0', '30 min'], ['0', 'No clock']]]];
const LC0_ELO = {1: 1900, 10: 2300, 100: 2700, 800: 3000, 5000: 3250, 30000: 3400};
const DEPTH_OPTS = [0, 1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30];
/* very rough strength of a depth-limited engine */
const depthElo = d => 900 + d * 125;
const NODES = [[1, '1 node (pure instinct)'], [10, '10 nodes'], [100, '100 nodes'], [800, '800 nodes'], [5000, '5000 nodes'], [30000, '30k nodes']];

/* ================= setup panel ================= */
const pendingModel = ['', ''];
function seatHTML(i) {
  const agent = S.config.agent ? `<option value="agent">${esc(S.config.agent)} (agent)</option>` : '';
  const agentBtn = S.config.agent ? `<button type="button" data-v="agent" title="${esc(S.config.agent)} (agent)"><img src="avatars/logo.webp" alt=""><span>Agent</span></button>` : '';
  return `<div class="seat-h"><img class="sw" src="pieces/cburnett/${i ? 'b' : 'w'}K.svg" alt=""><b>${SIDE[i]}</b></div>
    <div class="seg types" id="seg${i}" role="radiogroup" aria-label="${SIDE[i]} player">
      <button type="button" data-v="human" title="A person at this computer"><img src="avatars/human.webp" alt=""><span>Human</span></button>
      <button type="button" data-v="engine" title="A chess engine"><img src="avatars/builtin.webp" alt=""><span>Engine</span></button>
      <button type="button" data-v="llm" title="A local or cloud AI model"><img src="avatars/llm.webp" alt=""><span>AI model</span></button>${agentBtn}
    </div>
    <select id="type${i}" hidden><option value="human">Human</option><option value="engine">Chess engine</option><option value="llm">Local AI model</option>${agent}</select>
  <div class="set">
    <label data-t="engine">Engine</label><select id="engine${i}" data-t="engine"></select>
    <div class="sliders" id="sl${i}" data-t="engine"></div>
    <div hidden><select id="level${i}"></select><select id="elo${i}"></select><select id="maia${i}"></select><select id="nodes${i}"></select><select id="depth${i}"></select><select id="movetime${i}"></select></div>
    <label data-t="llm">Provider</label><select id="prov${i}" data-t="llm"></select>
    <label data-t="llm">Model</label><span data-t="llm" class="modelrow"><input id="model${i}" type="text" list="models${i}" spellcheck="false" placeholder="model name"><datalist id="models${i}"></datalist><button id="reload${i}" class="ib" type="button" title="Reload the model list">${icon('arrow-counter-clockwise')}</button></span>
    <label data-t="llm">Thinking</label><select id="think${i}" data-t="llm"><option value="none">Off (fast)</option><option value="low">Low</option><option value="medium">Medium</option><option value="xhigh">Max</option></select>
    <label data-t="llm">Sees</label><select id="sees${i}" data-t="llm" title="Fresh prompt: the full position every turn. One chat: a single growing conversation, like playing an AI in a chat window; with 'moves only' it has to track the board itself (that's where it loses the plot)."><option value="board">Full board, every turn</option><option value="chatboard">One chat + board</option><option value="chat">Moves only (blindfold)</option></select>
    <label data-t="llm">Picture</label><select id="img${i}" data-t="llm" title="Also send a picture of the board. Needs a vision model with vision enabled (in LM Studio / llama.cpp: the mmproj file loaded). Text-only models are detected and get text only."><option value="last">Latest turn</option><option value="all">Every turn (big context)</option><option value="off">Off</option></select>
    <span data-t="llm"></span><small class="note" data-t="llm">Pictures need a vision model with vision enabled.</small>
    <label data-t="llm">Hints</label><label class="swi" data-t="llm" title="List all legal moves in the prompt: fewer illegal moves, weaker challenge"><input type="checkbox" class="switch sm" id="hint${i}"><span>List the legal moves</span></label>
    <label data-chaos>Illegal</label><label class="swi" data-chaos title="This side's illegal moves are played as-is: pieces teleport, capture their own side, come back from the dead or appear from nowhere. The player is never told."><input type="checkbox" class="switch sm" id="free${i}"><span>Allowed for this side</span></label>
  </div>`;
}
function fillSelect(sel, items, keep) {
  sel.innerHTML = '';
  for (const [v, t] of items) sel.append(el('option', {value: v}, t));
  if (keep != null && items.some(([v]) => String(v) === String(keep))) sel.value = keep;
}
/* select an option, adding it first when the menu does not have that value (sliders can pick any value) */
function setOpt(sel, v, text) {
  if (![...sel.options].some(o => o.value === String(v))) sel.append(el('option', {value: v}, text));
  sel.value = String(v);
}
function engineEntry(id) { return id === 'builtin' ? {kind: 'builtin'} : BOTS[id] ? {kind: 'bot'} : (S.engineList || []).find(e => e.id === id); }
function engineMenus(i, want) {
  const sel = $('engine' + i), keep = (want && want.engine) || sel.value || sel.dataset.want || 'builtin';
  sel.innerHTML = '';
  const group = (label, items) => { const g = el('optgroup', {label}); for (const [v, t] of items) g.append(el('option', {value: v}, t)); sel.append(g); };
  group('In the game', [['builtin', 'Built-in engine (all variants)'], ...Object.entries(BOTS).map(([id, b]) => [id, b.name])]);
  if ((S.engineList || []).length) group('Installed', S.engineList.map(e => [e.id, e.name]));
  sel.append(el('option', {value: '__more'}, 'Get more engines…'));
  sel.value = [...sel.options].some(o => o.value === keep) && keep !== '__more' ? keep : 'builtin';
  const e = engineEntry($('engine' + i).value) || {kind: 'builtin'};
  const elo = e.elo || [1320, 3190];
  const wantElo = want ? want.elo || 0 : +($('elo' + i).value || 0);
  fillSelect($('elo' + i), ELO_STEPS.filter(v => !v || (v >= elo[0] && v <= elo[1])).map(v => [v, v ? v + ' Elo' : 'Full strength']), wantElo);
  if (wantElo >= elo[0] && wantElo <= elo[1]) setOpt($('elo' + i), wantElo, wantElo + ' Elo');
  fillSelect($('maia' + i), Object.keys(e.weights || {}).filter(k => /^\d+$/.test(k)).map(k => [k, k]), want ? want.maia || 1500 : ($('maia' + i).value || 1500));
}
function providerMenu(i, want) {
  const sel = $('prov' + i), keep = want || sel.value || sel.dataset.want || 'lmstudio';
  sel.innerHTML = '';
  const groups = [['Local apps', SET.providers.filter(p => p.local && !p.custom)], ['Cloud (API key)', SET.providers.filter(p => !p.local && !p.custom)], ['Custom providers', SET.providers.filter(p => p.custom)]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const g = el('optgroup', {label});
    for (const p of list) g.append(el('option', {value: p.id}, p.name + (!p.local && !p.keySet && !p.custom ? ' (no key)' : '')));
    sel.append(g);
  }
  sel.append(el('option', {value: '__custom'}, 'Custom provider…'));
  sel.value = SET.providers.some(p => p.id === keep) ? keep : 'lmstudio';
}
function buildSeat(i) {
  $('seat' + i).innerHTML = seatHTML(i);
  fillSelect($('level' + i), C.LEVELS.map((l, k) => [k, `${k + 1} · ${l.name} (about ${BUILTIN_ELO[k]})`]), 3);
  fillSelect($('movetime' + i), TIMES, 1000);
  fillSelect($('nodes' + i), NODES, 800);
  fillSelect($('depth' + i), DEPTH_OPTS.map(d => [d, d ? 'depth ' + d : 'No limit']), 0);
  if (!relayOK) { $('type' + i).querySelector('option[value="llm"]').disabled = true; $('seg' + i).querySelector('[data-v="llm"]').disabled = true; }
  for (const b of $('seg' + i).querySelectorAll('button')) b.onclick = () => {
    const sel = $('type' + i), o = sel.querySelector(`option[value="${b.dataset.v}"]`);
    if (!o || o.disabled || sel.value === b.dataset.v) return;
    sel.value = b.dataset.v; sel.onchange();
  };
  $('type' + i).onchange = async () => {
    const t = $('type' + i).value;
    $('free' + i).checked = t === 'llm' || t === 'agent';
    seatVis(i); if (t === 'llm') await loadModels(i);
    saveSetup(); applySeat(i);
  };
  $('engine' + i).onchange = () => {
    if ($('engine' + i).value === '__more') { $('engine' + i).value = $('engine' + i).dataset.want || 'builtin'; openSettings('engines'); return; }
    $('engine' + i).dataset.want = $('engine' + i).value;
    engineMenus(i); seatVis(i); saveSetup(); applySeat(i);
  };
  for (const k of ['level', 'elo', 'maia', 'nodes', 'depth', 'movetime', 'think', 'sees', 'img', 'hint', 'free']) $(k + i).onchange = () => { saveSetup(); liveApply(i, k); };
  $('prov' + i).onchange = async () => {
    if ($('prov' + i).value === '__custom') { $('prov' + i).value = $('prov' + i).dataset.want || 'lmstudio'; openSettings('ai'); return; }
    $('prov' + i).dataset.want = $('prov' + i).value;
    $('model' + i).value = ''; await loadModels(i); saveSetup(); applySeat(i);
  };
  $('model' + i).onchange = () => { saveSetup(); applySeat(i); };
  $('reload' + i).onclick = async () => { await loadModels(i, true); toast('Model list reloaded'); };
}
function seatVis(i) {
  const t = $('type' + i).value, kind = t === 'engine' ? (engineEntry($('engine' + i).value)?.kind || 'builtin') : '';
  for (const e of $('seat' + i).querySelectorAll('[data-t]')) e.style.display = e.dataset.t.split(' ').includes(t) ? '' : 'none';
  for (const e of $('seat' + i).querySelectorAll('[data-k]')) e.style.display = kind && e.dataset.k.split(' ').includes(kind) ? '' : 'none';
  for (const e of $('seat' + i).querySelectorAll('[data-chaos]')) e.style.display = $('chaos').checked && t !== 'engine' ? '' : 'none';
  for (const b of $('seg' + i).querySelectorAll('button')) { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  renderSeatSliders(i);
  renderMatchup();
}
/* engine strength sliders inside the seat card (the same ones as on the player card during a game) */
function renderSeatSliders(i) {
  const box = $('sl' + i);
  if ($('type' + i).value !== 'engine') { box.innerHTML = ''; return; }
  const P = readSeat(i), rows = strengthSliders(P, $('tc').value !== '0');
  box.innerHTML = '';
  if (!rows.length) { const b = BOTS[P.engine]; box.append(el('p', {class: 'hint'}, b ? b.about[0].toUpperCase() + b.about.slice(1) + '.' : 'Fixed strength.')); return; }
  for (const r of rows) box.append(sliderRow(r, P, v => { setOpt($(r.key + i), v, r.fmt(v)); saveSetup(); liveApply(i, r.key); renderMatchup(); }));
}
function sliderRow(r, P, onSet) {
  const cur = r.key === 'maia' ? +(P.maia || 1500) : r.key === 'level' ? (P.level ?? 3) : (P[r.key] ?? 0);
  let idx = r.values.indexOf(cur); if (idx < 0) idx = r.key === 'depth' || r.key === 'elo' ? r.values.length - 1 : 0;
  const val = el('span', {class: 'v'}, r.fmt(r.values[idx]));
  const range = el('input', {type: 'range', min: 0, max: r.values.length - 1, step: 1, value: idx, 'aria-label': r.label});
  const paint = () => range.style.setProperty('--p', (r.values.length > 1 ? +range.value / (r.values.length - 1) * 100 : 100) + '%');
  paint();
  range.oninput = () => { val.textContent = r.fmt(r.values[+range.value]); paint(); };
  range.onchange = () => onSet(r.values[+range.value]);
  return el('label', {class: 'spr'}, el('span', {class: 'l'}, r.label, r.hint ? el('small', {}, ' ' + r.hint) : null), val, range);
}
/* ================= Play hub: bots, variants, playground ================= */
/* bots and variants are "you against one opponent" with a colour choice; the playground is the full setup.
   Choices made in bots / variants mode wait for the next game instead of changing the one being played. */
const MODES = {bots: 'Play bots', variants: 'Play variants', playground: 'Playground'};
const VARIANTS = [
  ['960', 'Chess960', 'The back rank is shuffled. Castling still works.', 'shuffle', {variant: 0, start: '960'}],
  ['koth', 'King of the Hill', 'Walk your king to one of the four centre squares to win.', 'crown-fill', {variant: 1, start: 'std'}],
  ['3check', 'Three-check', 'Give check three times to win.', 'target', {variant: 2, start: 'std'}],
  ['trans', 'Transcendental', 'Each side gets its own shuffled back rank, no castling.', 'arrows-down-up', {variant: 0, start: 'trans'}],
  ['fen', 'Custom position', 'Start from any position you paste (FEN).', 'list-dashes', {variant: 0, start: 'fen'}],
];
let mode = 'hub';
const gameOn = () => S.pos && S.moves.length > 0 && !S.over && !S.replay;
function showMode(m) {
  mode = MODES[m] ? m : 'hub';
  const tab = $('tab-new');
  tab.dataset.mode = mode;
  $('modeTitle').textContent = MODES[mode] || '';
  label($('bNew'), 'play', mode === 'playground' ? 'Start game' : 'Play');
  if (mode === 'bots' || mode === 'variants') {
    const ts = [0, 1].map(i => $('type' + i).value), hum = ts.filter(t => t === 'human').length;
    if (hum !== 1) {   /* you against one opponent */
      if (gameOn()) S.setupDirty = true;
      const opp = ts[1] !== 'human' ? readSeat(1) : ts[0] !== 'human' ? readSeat(0) : {type: 'engine', engine: 'builtin', level: 2};
      writeSeat(0, {...readSeat(0), type: 'human'}); writeSeat(1, opp); seatVis(0); seatVis(1);
      if (!S.setupDirty) { applySeat(0); applySeat(1); }
    }
    if (mode === 'bots') { $('variant').value = '0'; $('start').value = 'std'; startVis(); }
    if (mode === 'variants' && $('variant').value === '0' && $('start').value === 'std') { $('start').value = '960'; startVis(); }
    saveSetup();
  }
  renderModeLists();
  $('tab-new').querySelector('.setupBody').scrollTop = 0;
}
const oppSide = () => { const i = [0, 1].findIndex(k => $('type' + k).value === 'human'); return i < 0 ? 1 : i ^ 1; };
/* opponents: built-in engines, the historic bots, installed engines, your AI model */
function botEntries() {
  const out = [{key: 'builtin', type: 'engine', engine: 'builtin', name: 'Built-in engine', short: 'Built-in', sub: 'Five levels, about 400 to 2200'}];
  for (const [id, b] of Object.entries(BOTS)) out.push({key: id, type: 'engine', engine: id, name: b.name, short: b.name.replace(/\s*\(.*\)$/, '').replace(' mover', ''), sub: 'About ' + b.elo + ', ' + b.about.split(',')[0]});
  for (const e of S.engineList || []) {
    const r = e.kind === 'elo' && e.elo ? `${e.elo[0]} to ${e.elo[1]} Elo or full` : e.kind === 'maia' ? 'Plays like a human, 1100 to 1900' : `About ${FULL_ELO[e.catalog || e.id] || 3000}`;
    out.push({key: e.id, type: 'engine', engine: e.id, name: e.name.replace(/\s+(dev|v?\d[\w.\-]*)$/i, ''), short: e.kind === 'maia' ? 'Maia' : e.name.split(/\s+/)[0], sub: r, eng: e});
  }
  out.push({key: '__llm', type: 'llm', name: 'Your AI model', short: 'AI model', sub: 'A local or cloud model, with a personality'});
  return out;
}
function playsVariant(entry) {
  if (!entry.eng) return true;
  const v = VARIANT_UCI[+$('variant').value], st = $('start').value;
  return (entry.eng.variants || ['chess']).includes(v) && (st !== '960' || entry.eng.chess960);
}
function renderModeLists() {
  if (mode !== 'bots' && mode !== 'variants') return;
  const i = oppSide(), c = readSeat(i), box = $('botList');
  const cur = c.type === 'llm' ? '__llm' : c.type === 'engine' ? (c.engine || 'builtin') : '';
  box.innerHTML = '';
  for (const b of botEntries()) {
    const P = b.type === 'llm' ? {type: 'llm', model: c.model} : {type: 'engine', engine: b.engine};
    const av = el('span'); paintAvatar(av, P, 'avatar');
    const ok = mode !== 'variants' || playsVariant(b);
    const btn = el('button', {type: 'button', class: 'bot' + (cur === b.key ? ' on' : '') + (ok ? '' : ' off'), role: 'radio', 'aria-checked': cur === b.key,
      title: b.name + ': ' + (ok ? b.sub : 'plays standard chess only; the built-in engine takes over in this variant'), onclick: () => pickOpponent(b)},
    av, el('span', {class: 'bt'}, el('b', {}, b.short || b.name), el('small', {}, ok ? b.sub : 'Standard chess only')));
    box.append(btn);
  }
  box.append(el('button', {type: 'button', class: 'bot more', title: 'Get more engines: Stockfish, Leela, Maia and more, one click', onclick: () => openSettings('engines')}, el('span', {class: 'avatar more', html: ICONS.plus}), el('span', {class: 'bt'}, el('b', {}, 'Get more'))));
  if (mode === 'variants') {
    const vb = $('varList'); vb.innerHTML = '';
    const vcur = VARIANTS.find(v => +$('variant').value === v[4].variant && $('start').value === v[4].start)?.[0];
    for (const [key, name, sub, ic, set] of VARIANTS) {
      vb.append(el('button', {type: 'button', class: 'var' + (vcur === key ? ' on' : ''), role: 'radio', 'aria-checked': vcur === key, onclick: () => {
        $('variant').value = set.variant; $('start').value = set.start; startVis(); saveSetup(); renderModeLists();
      }}, el('span', {class: 'ic', html: ICONS[ic] || ''}), el('span', {class: 'bt'}, el('b', {}, name), el('small', {}, sub))));
    }
    $('fenIn2').hidden = vcur !== 'fen'; $('fenIn2').value = $('fenIn').value;
  }
}
function pickOpponent(b) {
  const i = oppSide();
  if (gameOn()) S.setupDirty = true;   /* for the next game */
  const c = readSeat(i);
  writeSeat(i, b.type === 'llm' ? {...c, type: 'llm'} : {...c, type: 'engine', engine: b.engine});
  seatVis(i); saveSetup();
  if (!S.setupDirty) applySeat(i);
  if (b.type === 'llm') loadModels(i);
  renderModeLists();
}
for (const b of document.querySelectorAll('#modeHub .mode')) b.onclick = () => showMode(b.dataset.mode);
$('bModeBack').onclick = () => showMode('hub');
$('fenIn2').oninput = () => { $('fenIn').value = $('fenIn2').value; saveSetup(); };

/* "You vs Stockfish (1500)" at the top of the setup tab */
function renderMatchup() {
  const box = $('matchup'); if (!box || !$('type1')) return;
  const ps = [0, 1].map(i => { const c = readSeat(i); if (c.type === 'engine') rate(c); return c; });
  const hc = ps.filter(c => c.type === 'human').length;
  const nm = (c, i) => c.type === 'human' ? (hc === 1 ? 'You' : SIDE[i]) : c.type === 'engine' ? (BOTS[c.engine]?.name || (c.engine === 'builtin' ? 'Built-in engine' : engineEntry(c.engine)?.name || c.engine).replace(/\s+(dev|v?\d[\w.\-]*)$/i, ''))
    : c.type === 'agent' ? (S.config.agent || 'Agent') : (c.model ? shortModel(c) : 'AI model');
  const sub = c => c.type === 'engine' ? (c.rating ? 'about ' + c.rating : '') : c.type === 'human' ? (hc === 1 ? 'rated ' + (SET.profile?.rating || 1200) : '') : c.type === 'llm' ? 'rating drawn at the start' : '';
  const card = (c, i) => {
    const av = el('span');
    paintAvatar(av, c, 'avatar big');
    return el('div', {class: 'mu'}, av, el('div', {class: 'mut'}, el('b', {}, nm(c, i)), el('small', {}, el('i', {class: 'dot ' + (i ? 'b' : 'w')}), (i ? 'Black' : 'White') + (sub(c) ? ' · ' + sub(c) : ''))));
  };
  box.innerHTML = '';
  box.append(card(ps[0], 0), el('span', {class: 'muvs'}, 'vs'), card(ps[1], 1));
}
/* your colour: White / Random / Black (when exactly one side is human), otherwise just a swap button */
function renderSidePick() {
  const ts = [0, 1].map(i => $('type' + i).value), one = ts.filter(t => t === 'human').length === 1;
  $('colorSeg').hidden = !one || mode === 'playground';
  for (const i of [0, 1]) $('seat' + i).classList.toggle('me', one && ts[i] === 'human');
  const me = ts.indexOf('human'), c = $('rnd').checked ? 'r' : me === 1 ? 'b' : 'w';
  for (const b of $('colorSeg').querySelectorAll('button')) { b.classList.toggle('on', b.dataset.c === c); b.setAttribute('aria-checked', b.dataset.c === c); }
}
for (const b of $('colorSeg').querySelectorAll('button')) b.onclick = () => {
  const me = [0, 1].findIndex(i => $('type' + i).value === 'human');
  if (b.dataset.c === 'r') $('rnd').checked = true;
  else {
    $('rnd').checked = false;
    if ((b.dataset.c === 'w' && me === 1) || (b.dataset.c === 'b' && me === 0)) {
      swapSeats();
      /* before the first move (or after the game) the sides switch right away; mid-game it is for the next game */
      if (!S.moves.length || S.over) { applySeat(0); applySeat(1); }
      else { S.setupDirty = true; toast('Your colour changes with the next game'); }
    }
  }
  saveSetup(); renderSidePick(); renderMatchup();
};
function readSeat(i) {
  return {type: $('type' + i).value, engine: $('engine' + i).value || 'builtin', level: +$('level' + i).value, elo: +$('elo' + i).value || 0, maia: $('maia' + i).value || '1500',
    nodes: +$('nodes' + i).value, depth: +$('depth' + i).value || 0, movetime: +$('movetime' + i).value, provider: $('prov' + i).value, model: $('model' + i).value.trim(),
    think: $('think' + i).value, sees: $('sees' + i).value, img: $('img' + i).value, hint: $('hint' + i).checked, free: $('free' + i).checked};
}
function writeSeat(i, c = {}) {
  let t = c.type || 'human';
  if (t === 'agent' && !S.config.agent) t = 'llm';
  if (!relayOK && t === 'llm') t = 'engine';
  $('type' + i).value = t;
  $('engine' + i).dataset.want = c.engine || 'builtin';
  engineMenus(i, {engine: c.engine || 'builtin', elo: c.elo || 0, maia: c.maia || 1500});
  $('level' + i).value = c.level ?? 3; $('nodes' + i).value = c.nodes || 800; $('movetime' + i).value = c.movetime || 1000;
  setOpt($('depth' + i), c.depth || 0, 'depth ' + c.depth);
  $('prov' + i).dataset.want = c.provider || 'lmstudio'; providerMenu(i, c.provider || 'lmstudio');
  $('model' + i).value = c.model || ''; pendingModel[i] = c.model || '';
  $('think' + i).value = c.think || 'low'; $('sees' + i).value = c.sees || 'board'; $('img' + i).value = c.img || 'last';
  $('hint' + i).checked = !!c.hint; $('free' + i).checked = c.free ?? (t === 'llm' || t === 'agent');
  seatVis(i);
}
const modelCache = new Map();
async function loadModels(i, force) {
  const pid = $('prov' + i).value, dl = $('models' + i), inp = $('model' + i);
  if (!relayOK || !pid || pid === '__custom') return;
  try {
    if (force || !modelCache.has(pid)) modelCache.set(pid, api('/api/llm/models', {provider: pid}).then(r => r.data));
    const list = (await modelCache.get(pid)).filter(m => m.kind !== 'embeddings' && !/embed/i.test(m.id));
    setTimeout(() => modelCache.delete(pid), 3000);
    list.sort((a, b) => (b.loaded ? 1 : 0) - (a.loaded ? 1 : 0));
    dl.innerHTML = '';
    for (const m of list) dl.append(el('option', {value: m.id, label: (m.loaded ? '● loaded' : m.loaded === false ? 'not loaded' : '') + (m.vision ? ' · sees images' : '')}));
    const keep = inp.value || pendingModel[i];
    if (keep && list.some(m => m.id === keep)) inp.value = keep;
    else if (!keep && list.length) inp.value = (list.find(m => m.loaded) || list[0]).id;
    inp.placeholder = list.length ? `${list.length} models: type to search` : 'no models listed';
  } catch (e) {
    modelCache.delete(pid);
    dl.innerHTML = '';
    inp.placeholder = e.message.slice(0, 80);
    if (!inp.value) toast(e.message);
  }
}
function seatFrom(c) {
  return Object.assign({}, c, {rating: c.rating || null, illegal: c.illegal | 0, convo: [], noImage: false, lastPly: -1, note: '', lastInfo: null, persona: null});
}
/* ratings: engines get a realistic estimate, AI models (and agents) a random rating for the game, you your own */
function rate(P, reroll) {
  if (P.type === 'human') P.rating = SET.profile?.rating || 1200;
  else if (P.type === 'engine') {
    const e = P.engine && P.engine !== 'builtin' ? engineEntry(P.engine) || {} : null;
    P.rating = !e ? BUILTIN_ELO[P.level] ?? 1500 : BOTS[P.engine] ? BOTS[P.engine].elo : e.kind === 'maia' ? +P.maia || 1500 : e.kind === 'nodes' ? LC0_ELO[P.nodes] || 2800
      : e.kind === 'elo' && P.elo ? P.elo : FULL_ELO[e.catalog || e.id] || 3000;
    if (e && (e.kind === 'elo' || e.kind === 'time') && P.depth) P.rating = Math.min(P.rating, depthElo(P.depth));
  } else if (reroll || !P.rating) P.rating = 400 + Math.round(Math.random() * 130) * 10;
  return P;
}
/* the game ends: remember the result once, update your rating against a single computer opponent */
function finish(over) {
  if (S.over) return;
  S.over = over; S.resultClosed = false; S.resultDelta = null;
  const hum = [0, 1].filter(i => S.seats[i].type === 'human');
  if (hum.length === 1 && over.result !== '*' && S.moves.length >= 2) {
    const me = hum[0], opp = S.seats[me ^ 1], pr = SET.profile || (SET.profile = {rating: 1200, games: 0});
    const score = over.result === '1/2-1/2' ? .5 : (over.result === '1-0') === (me === 0) ? 1 : 0;
    const expect = 1 / (1 + Math.pow(10, ((opp.rating || 1500) - pr.rating) / 400));
    const k = pr.games < 20 ? 40 : 20, delta = Math.round(k * (score - expect));
    pr.rating = Math.max(100, pr.rating + delta); pr.games++;
    S.resultDelta = {delta, rating: pr.rating};
    S.seats[me].rating = pr.rating;
    saveSettings();
  }
  recordGame(over);
  if (humanSide() >= 0 && S.moves.length >= 4 && !S.replay) startReview(S.gameId);   /* Game Review: starts right away, the card fills in */
  onGameOver(over);
}

/* ================= game history ================= */
function recordGame(over) {
  if (!relayOK || SHOT || S.replay || S.moves.length < 2 || over.result === '*') return;
  const w = over.result === '1-0' ? 0 : over.result === '0-1' ? 1 : -1;
  const rec = {id: S.gameKey, date: Date.now(), result: over.result, reason: over.reason, winner: w < 0 ? null : seatName(w), winnerSide: w,
    players: S.seats.map((P, i) => ({name: seatName(i), type: P.type, rating: P.rating || null, engine: P.engine, model: P.model, provider: P.provider,
      level: P.level, elo: P.elo, maia: P.maia, nodes: P.nodes, illegal: P.illegal | 0})),
    variant: S.variant, c960: S.c960, startFen: S.startFen, startName: S.startName, movesRaw: S.moves.slice(), plies: S.moves.length,
    clock: S.clock ? {base: S.clock.base, inc: S.clock.inc, llmFree: !!S.clock.llmFree} : null, delta: S.resultDelta, pgn: pgn(),
    times: S.times.slice(), clockAt: S.clock ? S.clockAt.slice() : null};
  api('/api/history', {add: rec}).catch(() => {});
}
const tcName = c => !c ? '' : c.inc ? `${c.base / 60000} | ${c.inc / 1000}` : `${c.base / 60000} min`;
function fmtDate(t) {
  const d = new Date(t), now = new Date(), same = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  return same ? 'Today ' + hm : d.toLocaleDateString([], {day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'}) + ' ' + hm;
}
async function renderHistory() {
  const list = $('histList'), stats = $('histStats');
  let games = [];
  try { games = (await api('/api/history', {})).games || []; } catch (e) { list.innerHTML = ''; list.append(el('p', {class: 'empty'}, 'History unavailable: ' + e.message)); return; }
  const vs = games.filter(g => g.players.filter(p => p.type === 'human').length === 1);
  const score = {W: 0, D: 0, L: 0};
  for (const g of vs) { const me = g.players.findIndex(p => p.type === 'human'); score[g.winnerSide < 0 ? 'D' : g.winnerSide === me ? 'W' : 'L']++; }
  stats.innerHTML = '';
  stats.append(el('span', {}, 'Rating ', el('b', {}, String(SET.profile?.rating || 1200))),
    el('span', {}, el('b', {}, String(score.W)), ' won'), el('span', {}, el('b', {}, String(score.D)), ' drawn'), el('span', {}, el('b', {}, String(score.L)), ' lost'));
  list.innerHTML = '';
  if (!games.length) { list.append(el('div', {class: 'empty'}, el('p', {}, 'No finished games yet.'), el('p', {}, 'Every game that ends with a result shows up here, with its winner, so you can replay it or copy its PGN.'))); return; }
  for (const g of games.slice().reverse()) {
    const hum = g.players.findIndex(p => p.type === 'human'), single = g.players.filter(p => p.type === 'human').length === 1;
    const out = g.winnerSide < 0 ? 'D' : single ? (g.winnerSide === hum ? 'W' : 'L') : g.winnerSide ? 'B' : 'W';
    const badge = el('span', {class: 'res ' + (g.winnerSide < 0 ? 'draw' : single ? (out === 'W' ? 'win' : 'loss') : 'side'), title: g.result}, single || g.winnerSide < 0 ? (out === 'D' ? '½' : out === 'W' ? '1' : '0') : g.winnerSide ? '0-1' : '1-0');
    const pl = (p, i) => el('span', {class: 'hp' + (g.winnerSide === i ? ' won' : '')}, el('i', {class: 'dot ' + (i ? 'b' : 'w')}), p.name, p.rating ? el('small', {}, ` ${p.rating}`) : null);
    const what = g.winnerSide < 0 ? `Draw by ${g.reason}` : `${g.winner} won by ${g.reason}`;
    const meta = [Math.ceil(g.plies / 2) + ' moves', tcName(g.clock), g.variant ? VARIANT_NAME[g.variant] : g.startName, fmtDate(g.date)].filter(Boolean).join(' · ');
    const row = el('div', {class: 'hrow'}, badge,
      el('div', {class: 'hmain'}, el('div', {class: 'hplayers'}, pl(g.players[0], 0), el('span', {class: 'hvs'}, 'vs'), pl(g.players[1], 1)),
        el('div', {class: 'hwhat'}, what, g.delta ? el('span', {class: g.delta.delta >= 0 ? 'up' : 'down'}, ` ${g.delta.delta >= 0 ? '+' : ''}${g.delta.delta}`) : null),
        el('div', {class: 'hmeta'}, meta)),
      el('div', {class: 'hbtns'},
        el('button', {class: 'ib', title: 'Replay this game', html: icon('play'), onclick: () => replayGame(g)}),
        el('button', {class: 'ib', title: 'Copy PGN', html: icon('copy'), onclick: () => copy(g.pgn, 'PGN')}),
        el('button', {class: 'ib', title: 'Delete from history', html: icon('trash'), onclick: async () => { await api('/api/history', {remove: g.id}); renderHistory(); }})));
    list.append(row);
  }
  list.append(el('div', {class: 'histfoot'}, el('button', {class: 'danger', onclick: async () => { if (confirm('Delete the whole game history? Your rating stays.')) { await api('/api/history', {clear: true}); renderHistory(); } }}, 'Clear history')));
}
/* open a finished game from the history in review mode */
function replayGame(g) {
  if (!S.over && S.moves.length && !confirm('Leave the current game to replay this one?')) return;
  let pos, sans = [];
  try {
    pos = new C.Pos(g.startFen || C.START_FEN, g.variant | 0, !!g.c960);
    S.lastOn = new Map();
    for (const m of g.movesRaw) { remember(pos); sans.push(pos.san(m)); pos.make(m); }
  } catch (e) { toast('This game could not be loaded'); return; }
  S.gameId++; cancelThinking(); cancelPremove();
  S.seats = g.players.map(p => Object.assign(seatFrom({type: p.type === 'agent' && !S.config.agent ? 'llm' : p.type, engine: p.engine, model: p.model, provider: p.provider,
    level: p.level, elo: p.elo, maia: p.maia, nodes: p.nodes, illegal: p.illegal}), {rating: p.rating}));
  S.variant = g.variant | 0; S.c960 = !!g.c960; S.startFen = g.startFen || C.START_FEN; S.startName = g.startName || ''; S.chaos = false;
  S.pos = pos; S.startPly = (() => { const q = new C.Pos(S.startFen, S.variant, S.c960); return (q.full - 1) * 2 + q.turn; })();
  S.moves = g.movesRaw.slice(); S.sans = sans; S.lastMove = S.moves[S.moves.length - 1];
  S.setupDirty = false; S.fb = new Map(); S.explore = null; S.pz = null; S.pzRun = null; S.retry = null; S.review = null;
  S.over = {result: g.result, reason: g.reason}; S.resultClosed = true; S.resultDelta = g.delta || null; S.replay = g.id; S.gameKey = g.id;
  S.times = Array.isArray(g.times) ? g.times : [];
  S.clockAt = Array.isArray(g.clockAt) && g.clockAt.length === S.moves.length + 1 ? g.clockAt : [];
  S.clock = g.clock && S.clockAt.length ? {...g.clock, ms: S.clockAt[S.clockAt.length - 1].slice()} : null;
  S.paused = false; S.say = ''; S.sayBy = -1; S.info = ''; S.arrows = []; S.circles = []; S.anim = null; S.hint = null;
  S.flipped = g.players[1].type === 'human' && g.players[0].type !== 'human';
  restoreChat([]); clearSel();
  S.viewPly = 0;
  showTab('play'); render(); syncRelay();
  if (S.moves.length >= 2) startReview(S.gameId, g.review);   /* saved with the game: opens instantly */
  toast('Replaying: use the arrows or the move list');
}
/* a different player (or model/engine) takes over side i right away, from the current position */
function applySeat(i) {
  const P = S.seats[i];
  if (!P || !S.pos || S.setupDirty) { render(); return; }
  const c = readSeat(i);
  const same = c.type === P.type && (c.type !== 'llm' || (c.model === P.model && c.provider === P.provider)) && (c.type !== 'engine' || c.engine === P.engine);
  if (same) { liveApply(i); return; }
  if (c.type === 'llm' && !c.model) { render(); return; }
  const myTurn = !S.over && S.pos.turn === i;
  if (myTurn && S.thinking) cancelThinking();
  S.seats[i] = rate(seatFrom(c));
  assignPersonas();
  if (S.sayBy === i) { S.say = ''; S.sayBy = -1; }
  if (humanCount() === 1) S.flipped = S.seats[1].type === 'human';
  toast(SIDE[i] + ' is now played by ' + seatName(i));
  render(); syncRelay();
  if (myTurn) schedule();
}
/* options that change how the current player plays */
function liveApply(i, k) {
  const P = S.seats[i]; if (!P || S.setupDirty) return;
  const c = readSeat(i);
  if (c.type !== P.type) return;
  if (k === 'sees' && P.sees !== c.sees) { P.convo = []; P.lastPly = -1; }
  for (const key of ['level', 'elo', 'maia', 'nodes', 'depth', 'movetime', 'think', 'sees', 'img', 'hint', 'free']) P[key] = c[key];
  rate(P);
  render(); syncRelay();
}
function saveSetup() {
  try {
    localStorage.setItem('aichess.setup', JSON.stringify({seats: [readSeat(0), readSeat(1)], variant: $('variant').value, start: $('start').value,
      fen: $('fenIn').value, peek: $('peek').checked, rnd: $('rnd').checked, chaos: $('chaos').checked, tc: $('tc').value, tcLLM: $('tcLLM').checked, hints: $('allowHints').checked, undo: $('allowUndo').checked}));
  } catch (e) {}
  renderSidePick(); renderMatchup();
}
function loadSetup() {
  let j = null;
  try { j = JSON.parse(localStorage.getItem('aichess.setup') || 'null'); } catch (e) {}
  j = j || {seats: [{type: 'human'}, {type: 'engine', level: 3}]};
  for (const i of [0, 1]) writeSeat(i, j.seats?.[i]);
  if (j.variant != null) $('variant').value = j.variant;
  if (j.start) $('start').value = j.start;
  if (j.fen) $('fenIn').value = j.fen;
  $('peek').checked = !!j.peek; $('rnd').checked = !!j.rnd; $('chaos').checked = !!j.chaos;
  $('allowHints').checked = j.hints !== false; $('allowUndo').checked = j.undo !== false;
  setTc(j.tc ?? '600+0'); $('tcLLM').checked = !!j.tcLLM;
  startVis(); seatVis(0); seatVis(1);
}
/* time control buttons, grouped like on chess sites */
function buildTcPick() {
  const box = $('tcPick'); box.innerHTML = '';
  for (const [name, ic, list] of TC_GROUPS) {
    const row = el('div', {class: 'tcrow'}, el('span', {class: 'tch'}, el('span', {class: 'ic', html: ICONS[ic] || ''}), name));
    for (const [v, t] of list) row.append(el('button', {type: 'button', class: 'tcb', 'data-tc': v, role: 'radio', onclick: () => { setTc(v); saveSetup(); }}, t));
    box.append(row);
  }
}
function setTc(v) {
  if (!TC_GROUPS.some(g => g[2].some(([x]) => x === v))) v = '600+0';
  $('tc').value = v;
  for (const b of $('tcPick').querySelectorAll('.tcb')) { const on = b.dataset.tc === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  $('tcAIrow').hidden = v === '0';
  if ($('sl0')) { renderSeatSliders(0); renderSeatSliders(1); }
}
function startVis() { const f = $('start').value === 'fen'; $('fenLabel').style.display = f ? '' : 'none'; $('fenIn').style.display = f ? '' : 'none'; }
function swapSeats() { const a = readSeat(0), b = readSeat(1); writeSeat(0, b); writeSeat(1, a); }

/* ================= game flow ================= */
const rand960 = () => Math.floor(Math.random() * 960);
const newKey = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function startGame() {
  const variant = +$('variant').value, st = $('start').value;
  let fen = C.START_FEN, c960 = false, name = '';
  if (st === '960') { const n = rand960(); fen = C.fen960(n, n, 'KQkq'); c960 = true; name = 'Chess960 #' + n; }
  else if (st === 'trans') { fen = C.fen960(rand960(), rand960(), '-'); name = 'Transcendental'; }
  else if (st === 'fen') {
    fen = $('fenIn').value.trim() || C.START_FEN;
    try { const p = new C.Pos(fen, variant, false); c960 = p.c960Needed; if (p.status().over) throw new Error('that position is already over'); }
    catch (e) { toast('Bad FEN: ' + e.message); return; }
    name = 'Custom start';
  }
  if ($('rnd').checked && Math.random() < .5) swapSeats();
  const seats = [0, 1].map(i => seatFrom(readSeat(i)));
  for (const i of [0, 1]) {
    const P = seats[i];
    if (P.type === 'llm' && !P.model) { toast(`No model chosen for ${SIDE[i]}: the built-in engine plays instead`); Object.assign(P, {type: 'engine', engine: 'builtin', level: 3}); }
  }
  S.gameId++; cancelThinking();
  S.pz = null; S.pzRun = null;
  S.gameKey = newKey(); S.replay = null; S.setupDirty = false;
  for (const P of seats) rate(P, true);
  const tc = timeControl();
  S.clock = tc ? {...tc, ms: [tc.base, tc.base], llmFree: $('tcLLM').checked} : null;
  S.times = []; S.clockAt = [S.clock ? S.clock.ms.slice() : null]; S.turnMs = 0; S.tickT = performance.now();
  S.resultClosed = false; S.resultDelta = null;
  S.seats = seats; S.variant = variant; S.c960 = c960; S.startFen = fen; S.startName = name; S.chaos = $('chaos').checked;
  S.pos = new C.Pos(fen, variant, c960); S.startPly = (S.pos.full - 1) * 2 + S.pos.turn;
  S.moves = []; S.sans = []; S.lastMove = 0; S.over = null; S.viewPly = null; S.say = ''; S.sayBy = -1; S.info = ''; S.paused = false;
  S.lastOn = new Map(); S.arrows = []; S.circles = []; S.anim = null; S.hint = null; S.hintsUsed = 0;
  S.fb = new Map(); S.an = null; S.threatA = null; S.explore = null; S.retry = null; S.review = null;
  cancelPremove(); clearSel();
  S.flipped = seats[1].type === 'human' && seats[0].type !== 'human';
  assignPersonas(); onGameStart();
  saveSetup();
  afterMove();
}
function checkOver() {
  if (S.over) return;
  const st = S.pos.status();
  if (st.over) finish({result: st.result, reason: st.reason});
}
function afterMove() { checkOver(); render(); syncRelay(); schedule(); runPremove(); }

/* ================= premoves ================= */
/* while the computer thinks you can queue your next move; it is played the moment your turn comes.
   In chaos mode (with illegal moves allowed for you) it is played even when it is no longer legal. */
const humanSide = () => humanCount() === 1 ? S.seats.findIndex(P => P.type === 'human') : -1;
function canPremove() {
  if (S.pz) return false;
  const me = humanSide();
  return me >= 0 && SET.appearance.premoves !== false && !S.over && S.viewPly == null && !S.inactive && S.pos.turn !== me;
}
/* several premoves can be queued; one is played each time your turn comes. If one fails, the rest are dropped. */
function cancelPremove() { const had = S.premoves.length || S.preSel >= 0; S.premoves = []; S.preSel = -1; return had; }
/* the board as it will look after the queued premoves (what you see and pick pieces from while premoving) */
function preBoard() {
  const b = S.pos.b.slice();
  for (const {f, t} of S.premoves) {
    const p = b[f]; if (!p) continue;
    const ks = (p & 7) === C.KING && Math.abs((t & 7) - (f & 7)) === 2 && (t >> 4) === (f >> 4);
    b[f] = 0; b[t] = p;
    if (ks) { const r = t > f ? (f & 0x70) + 7 : (f & 0x70), rd = t > f ? t - 1 : t + 1; if (b[r] && (b[r] & 7) === C.ROOK) { b[rd] = b[r]; b[r] = 0; } }
  }
  return b;
}
function addPremove(f, t) { if (S.premoves.length < 20) S.premoves.push({f, t}); S.preSel = -1; }
function runPremove() {
  if (!S.premoves.length) return;
  if (S.over) { cancelPremove(); return; }
  const me = S.pos.turn;
  if (S.seats[me].type !== 'human') return;
  const pm = S.premoves.shift();
  const gid = S.gameId, len = S.moves.length;
  setTimeout(() => {
    if (gid !== S.gameId || len !== S.moves.length || S.over || S.pos.turn !== me) return;
    const pc = S.pos.b[pm.f];
    if (!pc || (pc >> 3) !== me) { cancelPremove(); render(); return; }   /* the piece was captured */
    select(pm.f);
    const ms = (S.targets.get(pm.t) || []).filter(m => (m & 127) === pm.f);
    if (ms.length) play(ms.find(m => ((m >> 14) & 7) === C.QUEEN) || ms[0]);
    else if (S.selFree && pm.t !== pm.f) playFree(pm.f, pm.t);
    else { cancelPremove(); clearSel(); render(); toast('Premove was not legal any more'); }
  }, 40);
}
function schedule() {
  if (S.over || S.paused || S.thinking || !S.pos || S.inactive) return;
  const P = S.seats[S.pos.turn];
  if (P.type === 'engine') askEngine(P);
  else if (P.type === 'llm') askLLM(P);
}
function play(m, opts = {}) {
  const mover = S.pos.turn, P = S.seats[mover], fl = m >> 17, to = (m >> 7) & 127;
  const captured = (fl & C.FL_FREE) ? S.pos.b[to] : (fl & 2) ? (C.PAWN | ((mover ^ 1) << 3)) : (fl & 1) ? S.pos.b[to] : 0;
  const prevEval = S.seats.map((Q, i) => Q?.lastInfo?.white != null ? (i === 0 ? Q.lastInfo.white : -Q.lastInfo.white) / 100 : null);
  tickClock(true);
  S.times.length = S.moves.length; S.times.push(Math.round(S.turnMs)); S.turnMs = 0;
  if (S.clock && timed(mover) && S.moves.length > 1) S.clock.ms[mover] += S.clock.inc;
  remember(S.pos);
  S.sans.push(S.pos.san(m));
  S.pos.make(m); S.moves.push(m); S.lastMove = m; S.viewPly = null;
  S.clockAt.length = S.moves.length; S.clockAt.push(S.clock ? S.clock.ms.map(Math.round) : null);
  S.anim = opts.dragged ? null : m; S.hint = null;
  clearSel();
  tick(!!captured);
  if (S.pz) { S.circles = []; render(); puzzleMove(m, mover); return; }   /* puzzles check the move themselves */
  if (P.type !== 'human' && (S.arrows.length || S.circles.length)) { S.arrows = []; S.circles = []; }   /* the opponent answered: your sketch is stale */
  onMove({mover, m, captured, check: S.pos.inCheck(), free: !!(fl & C.FL_FREE), prevEval: prevEval[mover ^ 1]});
  afterMove();
}
function canMove(color) {
  if (S.over || S.viewPly != null || S.thinking || S.inactive) return false;
  return S.pos.turn === color && S.seats[color].type === 'human';
}
function clearSel() { S.sel = -1; S.selFree = false; S.targets = new Map(); S.tgtHide = new Set(); }
function select(sq, pos = S.pos) {
  clearSel(); S.sel = sq;
  S.selFree = pos === S.pos && rulesOff(S.seats[S.pos.turn]) && S.seats[S.pos.turn].type === 'human';
  const add = (to, m, hide) => { if (!S.targets.has(to)) S.targets.set(to, []); S.targets.get(to).push(m); if (hide) S.tgtHide.add(to); };
  const ml = pos.legalMoves().filter(m => (m & 127) === sq);
  for (const m of ml) if (!((m >> 17) & C.FL_CASTLE)) add((m >> 7) & 127, m, false);
  for (const m of ml) if ((m >> 17) & C.FL_CASTLE) {
    const r = (m >> 7) & 127, kd = (sq & 0x70) + (r > sq ? 6 : 2);
    if (kd !== sq && !S.targets.has(kd)) add(kd, m, false);
    add(r, m, !S.c960);
  }
}
function freeTarget(sq) {
  if (!S.selFree || S.sel < 0 || sq === S.sel) return false;
  const p = S.pos.b[sq]; return !(p && (p >> 3) === S.pos.turn);
}
function attempt(from, to, dragged) {
  const ms = (S.targets.get(to) || []).filter(m => (m & 127) === from);
  if (!ms.length) {
    if (S.selFree && to !== from && (dragged || freeTarget(to))) { playFree(from, to, dragged); return; }
    clearSel(); render(); return;
  }
  if (ms.length > 1) { choosePromo(ms); return; }
  play(ms[0], {dragged});
}
function playFree(from, to, dragged) {
  const p = S.pos.b[from];
  const promo = (p & 7) === C.PAWN && (to >> 4) === ((p >> 3) ? 0 : 7) ? C.QUEEN : 0;
  S.seats[S.pos.turn].illegal++;
  play(from | to << 7 | promo << 14 | C.FL_FREE << 17, {dragged});
}
function choosePromo(ms, done = play, side = S.pos.turn) {
  const box = $('promoBox'); box.innerHTML = '';
  for (const t of [C.QUEEN, C.ROOK, C.BISHOP, C.KNIGHT]) {
    const m = ms.find(x => ((x >> 14) & 7) === t);
    const b = el('button', {onclick: () => { $('promo').hidden = true; done(m); }}, setPiece(el('div'), (side << 3) | t));
    box.append(b);
  }
  $('promo').hidden = false;
}
$('promo').addEventListener('pointerdown', e => { if (e.target === $('promo')) { $('promo').hidden = true; clearSel(); render(); } });

let actx = null;
function tick(cap) {
  if (SET.appearance.sound === false) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(cap ? 170 : 240, t); o.frequency.exponentialRampToValueAtTime(70, t + .09);
    g.gain.setValueAtTime(cap ? .35 : .22, t); g.gain.exponentialRampToValueAtTime(.001, t + .11);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .12);
  } catch (e) {}
}

function undo() {
  if (!S.moves.length) return;
  cancelThinking(); cancelPremove(); S.over = null; S.viewPly = null; S.resultClosed = false;
  const hum = S.seats.map(P => P.type === 'human'), any = hum[0] || hum[1];
  do { S.pos.unmake(); S.moves.pop(); S.sans.pop(); }
  while (any && S.moves.length && !hum[S.pos.turn]);
  if (!any || !hum[S.pos.turn]) S.paused = true;
  /* the clocks go back too: to what they showed when that move was first reached */
  const n = S.moves.length;
  if (S.times.length > n) S.times.length = n;
  if (S.clockAt.length > n + 1) S.clockAt.length = n + 1;
  if (S.clock && S.clockAt[n]) S.clock.ms = S.clockAt[n].slice();
  S.turnMs = 0; S.tickT = performance.now();
  for (const P of S.seats) if (P.convo.length || P.lastPly >= 0) {
    P.convo = P.convo.filter(m => m.ply < S.moves.length);
    P.lastPly = P.convo.length ? P.convo[P.convo.length - 1].ply : -1;
  }
  S.lastMove = S.moves.length ? S.moves[S.moves.length - 1] : 0; S.info = ''; S.say = ''; S.anim = null; S.hint = null;
  if (S.fb) for (const k of [...S.fb.keys()]) if (k > S.moves.length) S.fb.delete(k);
  onTakeback();
  clearSel(); afterMove();
}
function resign() {
  if (S.over) return;
  const hum = [0, 1].filter(i => S.seats[i].type === 'human');
  if (!hum.length) finish({result: '*', reason: 'stopped'});
  else { const loser = hum.length === 2 ? S.pos.turn : hum[0]; finish({result: loser ? '1-0' : '0-1', reason: 'resignation'}); }
  cancelThinking(); render(); syncRelay();
}
async function hint() {
  if (!S.pos || S.over || S.seats[S.pos.turn].type !== 'human' || $('bHint').disabled) return;
  const gid = S.gameId, len = S.moves.length;
  $('bHint').disabled = true; label($('bHint'), 'lightbulb', 'Thinking');
  try {
    const r = await bestMoveHint();
    if (!r || gid !== S.gameId || len !== S.moves.length) return;
    const m = r.move, to = (m >> 17) & C.FL_CASTLE ? (m & 0x70) + (((m >> 7) & 127) > (m & 127) ? 6 : 2) : (m >> 7) & 127;
    S.hint = {f: m & 127, t: to}; S.hintsUsed = (S.hintsUsed || 0) + 1;
    S.say = `${S.pos.san(m)} (${r.by})` + (S.hintsUsed > 1 ? ` · hint ${S.hintsUsed} this game` : ''); S.sayBy = -2;
    render();
  } finally { $('bHint').disabled = false; label($('bHint'), 'lightbulb', 'Hint'); }
}
function togglePause() {
  if (S.over) return;
  S.paused = !S.paused;
  if (S.paused) { cancelThinking(); render(); syncRelay(); }
  else { render(); syncRelay(); schedule(); }
}
function goView(k) {
  S.explore = null;
  if (S.retry && k !== S.retry.ply) S.retry = null;
  if (k == null || k >= S.moves.length) S.viewPly = null; else S.viewPly = Math.max(0, k);
  S.anim = null; clearSel(); render();
}
/* ================= review board: try your own moves from any position of the game ================= */
/* while reviewing (or after the game) you can move the pieces; the board washes out a little to show it is a side line,
   and the evaluation, feedback and suggestions follow your line. The arrows or Esc go back to the game. */
const reviewing = () => !!S.pos && (S.viewPly != null || !!S.over || !!S.explore);
function explorePos(k) {
  const e = S.explore, p = posAt(e.ply);
  for (let i = 0; i < (k ?? e.line.length); i++) p.make(e.line[i]);
  return p;
}
const boardPos = () => S.explore ? explorePos() : viewPos();
/* what the analysis is about: a game ply, or a position of the side line */
const curKey = () => S.explore ? `x${S.explore.ply}:${S.explore.line.join('.')}` : String(curPly());
function exploreMove(m) {
  const retry = S.retry && !S.retry.solved && !S.explore && curPly() === S.retry.ply;
  if (!S.explore) S.explore = {ply: curPly(), line: [], sans: []};
  const p = boardPos();
  S.explore.sans.push(p.san(m).replace(/\?!$/, '')); S.explore.line.push(m);
  tick(!!((m >> 17) & 1));
  S.anim = m; clearSel(); render();
  if (retry) checkRetry(m);
}
function exploreAttempt(from, to) {
  const ms = (S.targets.get(to) || []).filter(m => (m & 127) === from);
  if (!ms.length) { clearSel(); render(); return; }
  if (ms.length > 1) { choosePromo(ms, exploreMove, boardPos().turn); return; }
  exploreMove(ms[0]);
}
function exploreBack() {
  if (!S.explore) return false;
  S.explore.line.pop(); S.explore.sans.pop();
  if (!S.explore.line.length) S.explore = null;
  clearSel(); render(); return true;
}
function viewPos() {
  if (S.viewPly == null) return S.pos;
  const p = new C.Pos(S.startFen, S.variant, S.c960);
  for (let i = 0; i < S.viewPly; i++) p.make(S.moves[i]);
  return p;
}
const curPly = () => S.viewPly == null ? S.moves.length : S.viewPly;

/* ================= rendering ================= */
function render() {
  if (!S.pos) return;
  const vp = boardPos(), live = S.viewPly == null && !S.explore, rv = reviewing();
  const lastM = S.explore && S.explore.line.length ? S.explore.line[S.explore.line.length - 1] : curPly() > 0 ? S.moves[curPly() - 1] : 0;
  const kingChk = vp.inCheck() ? vp.ksq[vp.turn] : -1;
  const bd = $('board'); bd.innerHTML = '';
  const pieceEls = new Map(), queued = live && S.premoves.length;
  const B = queued ? preBoard() : vp.b, preSq = new Set(queued ? S.premoves.flatMap(m => [m.f, m.t]) : []);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = S.flipped ? i : 7 - i, f = S.flipped ? 7 - j : j, sq = r * 16 + f, p = B[sq];
    const tgt = (live || rv) && S.targets.has(sq) && !S.tgtHide.has(sq);
    const e = el('div', {class: 'sq' + (((r + f) & 1) ? '' : ' d') + (S.variant === C.V_KOTH && C.isHill(sq) ? ' hill' : '') + (lastM && (sq === (lastM & 127) || sq === ((lastM >> 7) & 127)) ? ' last' : '')
      + ((live || rv) && S.sel === sq ? ' sel' : '') + (sq === kingChk ? ' chk' : '')
      + (preSq.has(sq) ? ' pre' : '') + (live && S.preSel === sq ? ' presel' : '') + (tgt ? (' tgt' + ((p || ((S.targets.get(sq)[0] >> 17) & 1)) ? ' cap' : '')) : '')});
    e.dataset.sq = sq;
    if (j === 0) e.append(el('span', {class: 'co r'}, r + 1));
    if (i === 7) e.append(el('span', {class: 'co f'}, C.FILES[f]));
    if (p) { const pe = setPiece(el('div'), p); pe.dataset.sq = sq; e.append(pe); pieceEls.set(sq, pe); }
    bd.append(e);
  }
  if ((live || S.explore) && S.anim) animate(S.anim, pieceEls);
  S.anim = null;
  bd.classList.toggle('explore', !!S.explore);
  if (S.explore) bd.append(el('div', {class: 'wash'}));
  feedbackBadge(pieceEls);
  drawAssist();
  renderStrips(vp); renderMoves(); renderStatus();
  const vtag = [S.variant ? VARIANT_NAME[S.variant] : '', S.startName].filter(Boolean).join(', ');
  document.title = `${seatName(0)} vs ${seatName(1)}${vtag ? ' (' + vtag + ')' : ''} | AI Chess`;
  $('einfo').textContent = S.info;
  const bub = $('bubble');
  if (S.sayBy === -3) { if (S.fbShown !== curKey()) { bub.hidden = true; bub.className = ''; S.say = ''; S.sayBy = -1; } }   /* move feedback */
  else if (S.say && (S.sayBy >= 0 || S.sayBy === -2)) { bub.className = ''; bub.hidden = false; bub.innerHTML = ''; bub.append(el('b', {}, (S.sayBy === -2 ? 'Hint' : seatName(S.sayBy)) + ': '), S.say); } else bub.hidden = true;
  $('bUndo').disabled = !S.moves.length || !!S.replay || !!S.pz;
  $('bResign').hidden = !!S.pz;
  const hc = humanCount();
  label($('bResign'), 'flag', hc ? 'Resign' : 'Stop');
  $('bResign').disabled = !!S.over || (!S.moves.length && hc > 0);
  $('bPause').hidden = !!S.over || !S.seats.some(isAI) || (hc > 0 && S.seats[S.pos.turn].type === 'human' && !S.paused);
  label($('bPause'), S.paused ? 'play' : 'pause', S.paused ? 'Resume' : 'Pause');
  const vsComputer = S.seats.some(P => P.type !== 'human') && hc > 0;
  $('bUndo').hidden = vsComputer && !$('allowUndo').checked;
  $('bHint').hidden = !$('allowHints').checked || !!S.over || !hc || S.viewPly != null || S.seats[S.pos.turn].type !== 'human';
  chatVisible();
  renderHint();
  renderResult();
  renderReviewTab();
  drawClocks();
  assistKick();
}
/* the move that won the game on the board (mate, king taken, king on the hill, third check): it gets a crown */
function winPly() {
  const o = S.over, n = S.moves.length;
  if (!o || !n || S.pz) return 0;
  const w = o.result === '1-0' ? 0 : o.result === '0-1' ? 1 : -1;
  if (w < 0 || /resign|time|stop/i.test(o.reason || '')) return 0;
  return ((S.startPly + n - 1) & 1) === w ? n : 0;
}
/* the move-feedback marker on the square the last shown move went to (and a line in the bubble) */
function feedbackBadge() {
  const rv = reviewing(), A = assistOn(), wp = winPly();
  S.fbShown = null;
  if (!(A.feedback && S.fb) && !(wp && !S.explore && curPly() === wp)) return;
  let key, m;
  if (S.explore) { if (!S.explore.line.length) return; key = curKey(); m = S.explore.line[S.explore.line.length - 1]; }
  else {
    /* during play the feedback stays up while the opponent answers: the latest or the one before */
    const cur = curPly(), ply = rv || S.fb.has(cur) ? cur : cur - 1;
    if (ply < 1) return;
    key = ply; m = S.moves[ply - 1];
  }
  const f = !S.explore && key === wp ? {cls: 'win', played: S.sans[key - 1].replace(/\?!$/, '')} : S.fb && S.fb.get(key), c = f && CLASSES[f.cls];
  if (!f || !c) return;
  const to = (m >> 17) & C.FL_CASTLE ? (m & 0x70) + (((m >> 7) & 127) > (m & 127) ? 6 : 2) : (m >> 7) & 127;
  const sq = $('board').querySelector(`.sq[data-sq="${to}"]`);
  if (!sq) return;
  const b = el('span', {class: 'fbadge', title: c.name, style: `background:${c.col}`});
  if (c.icon) b.innerHTML = ICONS[c.icon] || ''; else { b.textContent = c.glyph; if (c.glyph.length > 2) b.classList.add('g3'); }
  sq.append(b);
  if (rv || (S.viewPly == null && !S.over)) {
    S.say = f.cls === 'win' ? `${f.played} wins the game.` : f.cls === 'illegal' ? `${f.played} broke the rules: that piece can't move like that.`
      : `${f.played} is ${f.cls === 'best' ? 'the best move' : f.cls === 'excellent' ? 'excellent' : f.cls === 'good' ? 'a good move' : 'a' + (f.cls === 'inaccuracy' ? 'n ' : ' ') + f.cls}` + (f.cls !== 'best' && f.best && f.best !== f.played ? `. Best was ${f.best}.` : '.');
    S.sayBy = -3; S.fbShown = curKey();
    const bub = $('bubble'); bub.hidden = false; bub.innerHTML = ''; bub.className = 'fb-' + f.cls;
    bub.append(el('b', {style: `color:${c.col}`}, c.name + ': '), S.say);
  }
}function animate(m, els) {
  if (SET.appearance.animate === false || ((m >> 17) & C.FL_FREE && (m & 0x88))) return;
  const from = m & 127, to = (m >> 7) & 127, size = $('board').clientWidth / 8;
  const slide = (a, b) => {
    const pe = els.get(b); if (!pe) return;
    const [ax, ay] = sqXY(a, S.flipped), [bx, by] = sqXY(b, S.flipped);
    pe.style.transform = `translate(${(ax - bx) * size}px,${(ay - by) * size}px)`; pe.style.zIndex = 5;
    requestAnimationFrame(() => requestAnimationFrame(() => { pe.classList.add('anim'); pe.style.transform = ''; }));
    pe.addEventListener('transitionend', () => { pe.classList.remove('anim'); pe.style.zIndex = ''; }, {once: true});
  };
  if ((m >> 17) & C.FL_CASTLE) { const base = from & 0x70, ks = to > from; slide(from, base + (ks ? 6 : 2)); slide(to, base + (ks ? 5 : 3)); }
  else slide(from, to);
}
/* the strength chip on an engine's player card: click it for sliders that change the engine on the fly */
const engKind = P => engineEntry(P.engine || 'builtin')?.kind || 'builtin';
function strengthLabel(P) {
  const k = engKind(P);
  if (k === 'builtin') return C.LEVELS[P.level ?? 3].name;
  if (k === 'elo') return (P.elo ? P.elo + ' Elo' : 'Full') + (P.depth ? ' · depth ' + P.depth : '');
  if (k === 'time') return P.depth ? 'depth ' + P.depth : 'Full';
  if (k === 'maia') return 'Maia ' + (P.maia || 1500);
  if (k === 'nodes') return (P.nodes || 800) + ' nodes';
  return '';
}
function strengthSliders(P, clockOn = !!S.clock) {
  const k = engKind(P), e = engineEntry(P.engine) || {}, out = [];
  const depth = {key: 'depth', label: 'Depth', hint: 'moves it looks ahead', values: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 0], fmt: v => v ? String(v) : 'No limit'};
  const think = {key: 'movetime', label: 'Think time', hint: 'per move (no clock)', values: TIMES.map(t => t[0]), fmt: v => (TIMES.find(t => t[0] === v) || [0, v + ' ms'])[1]};
  if (k === 'builtin') out.push({key: 'level', label: 'Level', values: [0, 1, 2, 3, 4], fmt: v => `${v + 1} · ${C.LEVELS[v].name} (about ${BUILTIN_ELO[v]})`});
  if (k === 'elo') {
    const [lo, hi] = e.elo || [1320, 3190], vals = [];
    for (let v = Math.ceil(lo / 50) * 50; v <= hi; v += 50) vals.push(v);
    out.push({key: 'elo', label: 'Strength', values: [...vals, 0], fmt: v => v ? v + ' Elo' : 'Full strength'});
  }
  if (k === 'elo' || k === 'time') { out.push(depth); if (!clockOn) out.push(think); }
  if (k === 'maia') out.push({key: 'maia', label: 'Rating', values: Object.keys(e.weights || {}).filter(x => /^\d+$/.test(x)).map(Number), fmt: v => String(v)});
  if (k === 'nodes') out.push({key: 'nodes', label: 'Search', values: NODES.map(n => n[0]), fmt: v => (NODES.find(n => n[0] === v) || [0, v + ' nodes'])[1]});
  return out;
}
/* the player card: click a player's picture, name or strength chip (like the profile card on chess sites).
   Shows who it is, and lets you change things for this game: an engine's strength, illegal moves for that side, hints for a model. */
function openPlayer(i, anchor) {
  const pop = $('strengthPop'), P = S.seats[i];
  if (!P || P.type === 'puzzle') return;
  if (!pop.hidden && pop.dataset.side === String(i)) { pop.hidden = true; return; }
  pop.dataset.side = i; pop.innerHTML = ''; pop.classList.add('playerpop');
  const live = !S.over && !S.replay && !S.pz;
  const av = el('div'); paintAvatar(av, P, 'avatar');
  const est = el('span', {class: 'est'});
  const what = {human: humanCount() === 1 ? 'Your side' : 'Human', engine: 'Chess engine', llm: 'AI model', agent: 'Agent'}[P.type] || '';
  const showEst = () => { est.textContent = [what, P.type === 'llm' ? `${P.model} @ ${P.provider}` : '', P.type === 'engine' && P.rating ? `about ${P.rating} Elo` : '', P.illegal ? `${P.illegal} illegal` : ''].filter(Boolean).join(' · '); };
  pop.append(el('div', {class: 'pc-head'}, av, el('div', {class: 'pc-who'},
    el('div', {}, el('b', {}, seatName(i)), P.rating ? el('span', {class: 'rating'}, ` (${P.rating})`) : null, el('span', {class: 'side'}, ' · ' + SIDE[i])), est)));
  if (P.type === 'engine') {
    const rows = strengthSliders(P);
    if (!rows.length) pop.append(el('p', {class: 'hint'}, 'This one has a fixed strength.'));
    else if (!live) pop.append(el('p', {class: 'hint'}, strengthLabel(P)));
    else {
      for (const r of rows) pop.append(sliderRow(r, P, v => {
        if (S.setupDirty) { P[r.key] = v; rate(P); render(); }   /* the setup is already for the next game: change only this game */
        else { setOpt($(r.key + i), v, r.fmt(v)); saveSetup(); liveApply(i, r.key); seatVis(i); }
        showEst();
      }));
      pop.append(el('p', {class: 'hint'}, 'Strength changes take effect from its next move.'));
    }
  }
  const sw = (name, tip, on, set) => {
    const inp = el('input', {type: 'checkbox', class: 'switch sm', 'aria-label': name, disabled: !live}); inp.checked = !!on;
    inp.onchange = () => { set(inp.checked); showEst(); };
    return el('label', {class: 'swl', title: tip}, el('span', {}, name), inp);
  };
  const list = el('div', {class: 'swlist'});
  if (P.type !== 'engine') list.append(sw('Illegal moves', 'This side\'s illegal moves are played as they are: pieces teleport, capture their own side, come back or appear. Nobody is told.', rulesOff(P), v => setFree(i, v)));
  if (P.type === 'llm') list.append(sw('List the legal moves', 'Put all legal moves in the prompt: fewer illegal moves, a weaker challenge', P.hint, v => {
    P.hint = v; if (!S.setupDirty) { $('hint' + i).checked = v; saveSetup(); } syncRelay();
  }));
  if (list.childNodes.length) pop.append(list);
  const btns = el('div', {class: 'pc-btns'});
  if (isAI(P) && S.chatOn !== false) btns.append(el('button', {html: icon('chat-circle-text') + '<span>Chat</span>', onclick: () => { pop.hidden = true; showTab('chat'); }}));
  if (!S.replay && !S.pz) btns.append(el('button', {html: icon('arrows-down-up') + '<span>Change player</span>', onclick: () => { pop.hidden = true; showTab('new'); }}));
  if (btns.childNodes.length) pop.append(btns);
  showEst();
  pop.hidden = false;
  const a = anchor.getBoundingClientRect(), w = Math.min(330, innerWidth - 16);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(a.left, innerWidth - w - 8)) + 'px';
  const below = a.bottom + 6, h = pop.offsetHeight;
  pop.style.top = (below + h < innerHeight - 8 ? below : Math.max(8, a.top - h - 6)) + 'px';
}
/* illegal moves on or off for one side during the game. Switching chaos on here starts with only this side free. */
function setFree(i, v) {
  const P = S.seats[i]; if (!P) return;
  if (v && !S.chaos) { S.chaos = true; for (const Q of S.seats) if (Q !== P) Q.free = false; }
  P.free = v;
  if (!S.setupDirty) {
    $('chaos').checked = S.chaos;
    for (const k of [0, 1]) { $('free' + k).checked = !!S.seats[k].free; seatVis(k); }
    saveSetup();
  }
  toast(`${seatName(i)}: illegal moves ${v ? 'allowed' : 'off'}`);
  clearSel(); render(); syncRelay();
}
const pcardOpen = (pfx, e) => { e.stopPropagation(); const side = +$('clock' + pfx).dataset.side; openPlayer(side, $('av' + pfx)); };
for (const pfx of ['Top', 'Bot']) {
  $('lvl' + pfx).onclick = e => pcardOpen(pfx, e);
  $('av' + pfx).onclick = e => pcardOpen(pfx, e);
  $('name' + pfx).onclick = e => pcardOpen(pfx, e);
}
document.addEventListener('pointerdown', e => { const pop = $('strengthPop'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.lvl, .player .avatar, .player .name')) pop.hidden = true; });
function renderHint() {
  const L = [], types = S.seats.map(P => P?.type);
  const ci = types.indexOf('agent');
  if (ci >= 0) L.push(`${S.config.agent || 'The agent'} plays ${types[0] === 'agent' && types[1] === 'agent' ? 'both sides' : SIDE[ci]} through the relay.`);
  const ui = [0, 1].map(readSeat);
  if (ui[0].type === 'llm' && ui[1].type === 'llm' && ui[0].provider === ui[1].provider && ui[0].model !== ui[1].model && ['llamacpp', 'lmstudio', 'ollama'].includes(ui[0].provider))
    L.push('Two different models on one local server may mean a model swap every move (slow). Same model on both sides is fast.');
  L.push('Right-drag on the board draws arrows (Shift red, Alt blue, Ctrl yellow), right-click circles a square; left-click an empty square or Esc clears.');
  $('hint').innerHTML = L.map(x => '<p>' + esc(x) + '</p>').join('');
}
function renderStrips(vp) {
  const cnt = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = vp.b[s]; if (p) cnt[p >> 3][p & 7]++; }
  let mat = [0, 0]; for (let t = 1; t < 6; t++) { mat[0] += cnt[0][t] * VAL[t]; mat[1] += cnt[1][t] * VAL[t]; }
  const img = isImageSet(SET.appearance.pieces);
  const fill = (pfx, c) => {
    const caps = $('caps' + pfx); caps.innerHTML = '';
    for (const t of [5, 4, 3, 2, 1]) for (let k = Math.max(0, START_COUNT[t] - cnt[c ^ 1][t]); k > 0; k--) {
      const p = ((c ^ 1) << 3) | t, i = el('i', {class: img ? 'img ' + ((c ^ 1) ? 'b' : 'w') + 'PNBRQK'[t - 1] : ''});
      if (!img) { i.textContent = glyph(p); i.style.color = (c ^ 1) ? '#55565c' : '#f4f4f4'; }
      caps.append(i);
    }
    const adv = mat[c] - mat[c ^ 1], extra = [];
    if (adv > 0) extra.push('+' + adv);
    if (S.variant === C.V_3CHECK) extra.push('checks ' + vp.checks[c] + '/3');
    $('adv' + pfx).textContent = extra.join(' · ');
    const P = S.seats[c];
    const builtinEng = P && P.type === 'engine' && (!P.engine || P.engine === 'builtin');
    $('name' + pfx).textContent = builtinEng ? 'Engine' : seatName(c);
    $('rating' + pfx).textContent = P && P.rating ? `(${P.rating})` : '';
    const chip = $('lvl' + pfx), ct = P && P.type === 'engine' && !S.replay ? strengthLabel(P) : '';
    chip.hidden = !ct; chip.dataset.side = c;
    if (ct && chip.dataset.t !== ct) { chip.dataset.t = ct; chip.innerHTML = esc(ct) + icon('caret-down'); }
    chip.title = 'Change ' + seatName(c) + '’s strength';
    $('badge' + pfx).textContent = P && P.illegal ? `${P.illegal} illegal` : '';
    const av = $('av' + pfx), type = P ? P.type : 'human';
    paintAvatar(av, P, 'avatar');
    av.title = {human: 'Human', engine: 'Chess engine', llm: 'AI model', agent: 'Agent'}[type] || '';
    $('name' + pfx).title = P && P.type === 'llm' ? P.model + ' @ ' + P.provider : '';
    $('strip' + pfx).classList.toggle('turn', !S.over && vp.turn === c);
    $('clock' + pfx).dataset.side = c;
  };
  fill('Top', S.flipped ? 0 : 1); fill('Bot', S.flipped ? 1 : 0);
}
/* [icon, colour] for a player card: each engine has its own picture, AI models a colour from their name */
/* [icon, tile colour, picture]: every player gets an illustrated avatar (web/avatars, made for this app) on a muted tile */
const hue = s => { let h = 0; for (const ch of s || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
function avatarOf(P) {
  if (!P || P.type === 'human') return ['user-fill', '#4a453f', 'avatars/human.webp'];
  if (P.type === 'agent') return ['sparkle-fill', '#4a453f', 'avatars/logo.webp'];
  if (P.type === 'puzzle') return ['puzzle-piece', '#5e4733', 'avatars/mode-puzzles.webp'];
  if (P.type === 'llm') return ['robot-fill', `hsl(${hue(P.model)} 18% 34%)`, 'avatars/llm.webp'];
  const id = P.engine || 'builtin', e = engineEntry(id) || {}, key = AVATAR[id] ? id : AVATAR[e.catalog] ? e.catalog : null;
  if (key) return [AVATAR[key][0], AVATAR[key][1], `avatars/${key}.webp`];
  return ['cpu-fill', `hsl(${hue(id)} 16% 34%)`, 'avatars/custom.webp'];
}
function paintAvatar(av, P, cls) {
  const [ic, col, img] = avatarOf(P), key = (P?.type || 'human') + img + col;
  if (av.dataset.key === key) return;
  av.dataset.key = key; av.className = cls + ' ' + (P?.type || 'human');
  av.innerHTML = img ? `<img src="${img}" alt="" draggable="false">` : (ICONS[ic] || '');
  av.style.background = col || '';
}
function renderMoves() {
  const mv = $('moves'); mv.innerHTML = '';
  const cur = curPly(), off = S.startPly & 1, base = S.startPly - off;
  if (!S.sans.length) mv.append(el('div', {class: 'empty'}, 'No moves yet.'));
  const img = isImageSet(SET.appearance.pieces), wp = winPly();
  const sanNode = (san, side) => {
    const m = /^([KQRBN])(.*)$/.exec(san);
    if (!m) return [san];
    const t = 'PNBRQK'.indexOf(m[1]) + 1, f = el('i', {class: 'fig' + (img ? ' img w' + m[1] : '')});   /* light figurines for both sides, readable on the dark list */
    if (!img) f.textContent = glyph(t);
    return [f, m[2]];
  };
  for (let k = 0, row = 0; k < S.sans.length + off; k += 2, row++) {
    const odd = row & 1 ? ' row-odd' : '';
    mv.append(el('div', {class: 'n' + odd}, ((base + k) / 2 + 1) + '.'));
    for (let j = 0; j < 2; j++) {
      const idx = k + j - off;
      if (idx < 0) mv.append(el('div', {class: 'm' + odd}, '…'));
      else if (idx < S.sans.length) {
        /* illegal moves are always marked; the feedback marks show when feedback is on (always in a review) */
        const illegal = (S.moves[idx] >> 17) & C.FL_FREE;
        const fb = illegal ? {cls: 'illegal'} : idx + 1 === wp ? {cls: 'win'} : assistOn().feedback && S.fb && S.fb.get(idx + 1), c = fb && CLASSES[fb.cls];
        const mark = c && !['good', 'excellent'].includes(fb.cls) ? el('span', {class: 'fbm', title: c.name, style: `color:${c.col}`, html: c.icon ? ICONS[c.icon] : esc(c.glyph)}) : null;
        const spent = S.times[idx] != null ? el('span', {class: 'mt', title: 'Time spent on this move'}, fmtSpent(S.times[idx])) : null;
        mv.append(el('div', {class: 'm' + odd + (cur === idx + 1 ? ' cur' : '') + (S.sans[idx].endsWith('?!') ? ' free' : ''), onclick: () => goView(idx + 1)}, ...sanNode(S.sans[idx], (S.startPly + idx) & 1), mark, spent));
      }
      else mv.append(el('div', {class: odd.trim()}));
    }
  }
  const c = mv.querySelector('.cur');
  if (c) { const cr = c.getBoundingClientRect(), mr = mv.getBoundingClientRect(); if (cr.top < mr.top) mv.scrollTop -= mr.top - cr.top; else if (cr.bottom > mr.bottom) mv.scrollTop += cr.bottom - mr.bottom; }
  else mv.scrollTop = mv.scrollHeight;
}
function resultText() {
  const o = S.over, r = o.result, w = r === '1-0' ? 0 : r === '0-1' ? 1 : -1;
  if (r === '*') return 'Game stopped';
  if (w < 0) return 'Draw by ' + o.reason;
  const hc = humanCount();
  if (hc === 1) return (S.seats[w].type === 'human' ? 'You won' : seatName(w) + ' won') + ' by ' + o.reason;
  return `${hc === 2 ? SIDE[w] : seatName(w) + ' (' + SIDE[w] + ')'} won by ${o.reason}`;
}
function renderStatus() {
  const st = $('status'); st.className = '';
  if (S.explore) {
    const e = S.explore, k = e.ply;
    st.textContent = `Your line from move ${Math.floor((S.startPly + k) / 2) + 1}: ${e.sans.join(' ')}`;
    st.className = 'explore'; st.title = 'Esc or the arrows go back to the game'; return;
  }
  st.title = '';
  if (S.over) { st.textContent = resultText() + (S.viewPly != null ? ` · move ${S.viewPly} of ${S.moves.length}` : ''); st.className = 'over'; return; }
  if (S.viewPly != null) { st.textContent = `Reviewing move ${S.viewPly} of ${S.moves.length} (End to return)`; return; }
  const P = S.seats[S.pos.turn], side = SIDE[S.pos.turn], chk = S.pos.inCheck();
  if (S.paused && P.type !== 'human') st.textContent = 'Paused. Press Resume to continue';
  else if (P.type === 'engine') st.textContent = seatName(S.pos.turn) + ' is thinking…';
  else if (P.type === 'llm') st.textContent = shortModel(P) + ' (' + side + ') is thinking…';
  else if (P.type === 'agent') st.textContent = seatName(S.pos.turn) + '’s move (' + side + ')…';
  else st.textContent = (humanCount() === 2 ? side + ' to move' : 'Your move') + (chk ? ', check' : '');
  if (chk) st.className = 'warn';
}
setInterval(() => {   /* a visible clock while a model works (a cold model load can take a minute) */
  if (!S.thinking || !S.llmCtl || !S.pos) return;
  const P = S.seats[S.pos.turn]; if (P.type !== 'llm') return;
  const s = Math.round((performance.now() - S.llmT0) / 1000);
  $('einfo').textContent = `waiting for ${shortModel(P)} · ${s}s` + (s >= 30 ? ' (the server may be loading the model)' : '');
}, 1000);

/* ================= clocks ================= */
function timeControl() { const v = $('tc').value; if (!v || v === '0') return null; const [b, inc] = v.split('+').map(Number); return {base: b * 1000, inc: (inc || 0) * 1000}; }
function fmtClock(ms) {
  ms = Math.max(0, ms);
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  if (ms < 10000) return `0:0${s}.${Math.floor(ms / 100) % 10}`;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
/* time spent on one move, for the move list */
function fmtSpent(ms) {
  const s = ms / 1000;
  return s < 10 ? s.toFixed(1) + 's' : s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + ':' + String(Math.round(s) % 60).padStart(2, '0');
}
function drawClocks() {
  for (const pfx of ['Top', 'Bot']) {
    const e = $('clock' + pfx), side = +e.dataset.side;
    if (!S.clock || !S.pos || !timed(side)) { e.hidden = true; continue; }
    e.hidden = false;
    /* reviewing an earlier move: the clocks as they were then */
    const vk = S.explore ? S.explore.ply : S.viewPly, then = vk != null ? S.clockAt[vk] : null;
    const ms = then ? then[side] : S.clock.ms[side], run = !then && !S.over && !S.paused && S.pos.turn === side && S.moves.length > 0;
    e.textContent = fmtClock(ms);
    e.classList.toggle('run', run);
    e.classList.toggle('low', ms < Math.min(20000, S.clock.base / 4));
    e.classList.toggle('flag', ms <= 0);
  }
}
/* mating material left for `side`? (running out of time against a lone king is a draw) */
function canMate(side) {
  let minors = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const q = S.pos.b[s]; if (!q || (q >> 3) !== side) continue;
    const t = q & 7;
    if (t === C.PAWN || t === C.ROOK || t === C.QUEEN) return true;
    if (t !== C.KING) minors++;
  }
  return minors >= 2;
}
/* counts the time since the last tick: for the move being thought about (shown in the move list) and on the clock.
   play() calls it first so the mover is charged up to the moment the move is made. */
function tickClock(noFlag) {
  if (!S.pos) return false;
  const now = performance.now(), dt = S.tickT ? now - S.tickT : 0; S.tickT = now;
  if (S.over || S.paused || S.inactive || SHOT || S.pz || S.replay) return false;
  S.turnMs += dt;
  if (!S.clock || !S.moves.length) return false;
  const side = S.pos.turn;
  if (!timed(side)) return false;
  S.clock.ms[side] = noFlag ? Math.max(0, S.clock.ms[side] - dt) : S.clock.ms[side] - dt;
  return !noFlag && S.clock.ms[side] <= 0;
}
setInterval(() => {
  if (!S.pos) return;
  if (tickClock()) {
    const side = S.pos.turn;
    S.clock.ms[side] = 0;
    cancelThinking();
    finish(canMate(side ^ 1) ? {result: side ? '1-0' : '0-1', reason: 'timeout'} : {result: '1/2-1/2', reason: 'timeout against insufficient material'});
    render(); syncRelay(); return;
  }
  drawClocks();
}, 100);

/* ================= assistance: evaluation bar, move feedback, arrows, engine line ================= */
const ASSIST = [
  ['evalbar', 'scales', 'Evaluation bar', 'Who is better, according to the engine'],
  ['feedback', 'chat-teardrop-dots', 'Move feedback', 'Best, good, mistake or blunder after each of your moves'],
  ['suggest', 'arrow-bend-up-right', 'Suggestions', 'An arrow for the best move when it is your turn'],
  ['threat', 'target', 'Threats', 'An arrow for what your opponent threatens (captures and checks)'],
  ['lines', 'list-dashes', 'Engine line', 'The evaluation and the best line under the status', true],
];
/* an option chip: lit when on, greyed out when off */
function switchRow(ic, name, tip, checked, onChange, extra = {}, wide = false) {
  const inp = el('input', {type: 'checkbox', ...extra}); inp.checked = !!checked;
  inp.onchange = () => onChange(inp.checked);
  return el('label', {class: 'chip' + (wide ? ' wide' : ''), title: tip || name}, inp, el('span', {class: 'ic', html: ICONS[ic] || ''}), el('span', {}, name));
}
const assistRow = ([k, ic, name, sub, wide]) => switchRow(ic, name, sub, SET.assist[k], v => {
  SET.assist[k] = v; saveSettings();
  for (const i of document.querySelectorAll(`input[data-assist="${k}"]`)) i.checked = v;
  render();
}, {'data-assist': k}, wide);
function buildAssist() { const box = $('assistSw'); box.innerHTML = ''; for (const a of ASSIST) box.append(assistRow(a)); }
/* the gear in the move panel: the same options during a game */
function openOpts() {
  const pop = $('optsPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = '';
  pop.append(el('div', {class: 'sph'}, el('b', {}, 'Game options')));
  const box = el('div', {class: 'chips'});
  for (const a of ASSIST) box.append(assistRow(a));
  const mirror = (id, ic, name, wide) => switchRow(ic, name, '', $(id).checked, v => { $(id).checked = v; $(id).dispatchEvent(new Event('change')); }, {}, wide);
  box.append(mirror('allowHints', 'lightbulb', 'Hints'), mirror('allowUndo', 'arrow-counter-clockwise', 'Takebacks'),
    switchRow('speaker-high', 'Sound', '', SET.appearance.sound !== false, v => { SET.appearance.sound = v; saveSettings(); }),
    mirror('peek', 'eye', 'Peek at my arrows'));
  pop.append(box);
  pop.hidden = false;
  const a = $('bOpts').getBoundingClientRect(), w = Math.min(340, innerWidth - 16);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(a.right - w, innerWidth - w - 8)) + 'px';
  pop.style.top = Math.max(8, a.top - pop.offsetHeight - 8) + 'px';
}
$('bOpts').onclick = e => { e.stopPropagation(); openOpts(); };
document.addEventListener('pointerdown', e => { const pop = $('optsPop'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#bOpts')) pop.hidden = true; });

function posAt(k) { const p = new C.Pos(S.startFen, S.variant, S.c960); for (let i = 0; i < k; i++) p.make(S.moves[i]); return p; }
let assistKey = '', anSeq = 0;
/* which aids are on: your choices while playing; in a review the evaluation, feedback and suggestions are always on */
function assistOn() {
  if (S.pz) return {};   /* no engine help while solving puzzles */
  const A = SET.assist, rv = reviewing();
  return {evalbar: A.evalbar || rv, feedback: A.feedback || rv, suggest: A.suggest || rv, threat: A.threat && !rv, lines: A.lines, review: rv};
}
/* called after every render: (re)analyse when the shown position or the options changed */
function assistKick() {
  const A = assistOn(), on = A.evalbar || A.feedback || A.suggest || A.threat || A.lines;
  const key = on ? [S.gameId, curKey(), S.moves.length, A.evalbar, A.feedback, A.suggest, A.threat, A.lines, S.variant].join(':') : 'off';
  if (key === assistKey) return;
  assistKey = key;
  if (!on || !S.pos || S.inactive || SHOT) { S.an = null; S.threatA = null; drawAssist(); return; }
  runAssist(++anSeq, S.gameId, curKey());
}
async function runAssist(seq, gid, key) {
  const A = assistOn(), live = key === String(S.moves.length) && !S.explore, cur = () => seq === anSeq && gid === S.gameId;
  if (!S.an || S.an.key !== key) { S.an = null; S.threatA = null; drawAssist(); }
  /* the shown position, the one before it and the move between them */
  let pos, prev = null, move = 0, san = '', fbKey;
  if (S.explore) {
    const n = S.explore.line.length;
    pos = explorePos(); fbKey = key;
    if (n) { prev = explorePos(n - 1); move = S.explore.line[n - 1]; san = S.explore.sans[n - 1]; }
  } else {
    const n = curPly();
    pos = posAt(n); fbKey = n;
    if (n) { prev = posAt(n - 1); move = S.moves[n - 1]; san = S.sans[n - 1].replace(/\?!$/, ''); }
  }
  try {
    const res = await analyze(pos);
    if (!cur()) return;
    S.an = res ? {key, res} : null; drawAssist();
    /* feedback on the move that led here: always in a review, during play only for people's moves */
    const fb = S.fb || (S.fb = new Map());
    if (A.feedback && prev && !fb.has(fbKey) && (A.review || S.seats[prev.turn]?.type === 'human')) {
      if ((move >> 17) & C.FL_FREE) { fb.set(fbKey, {cls: 'illegal', played: san}); render(); }
      else {
        const before = await analyze(prev);
        if (!cur()) return;
        const cls = classify(before, res, prev.turn, move);
        if (cls) {
          fb.set(fbKey, {cls, best: before.best ? prev.san(before.best).replace(/\?!$/, '') : '', played: san});
          render();
        }
      }
    }
    if (A.threat && live && !S.over && S.seats[S.pos.turn]?.type === 'human') {
      const t = await threat(pos);
      if (!cur()) return;
      S.threatA = t ? {key, ...t} : null; drawAssist();
    }
  } catch (e) { console.warn('analysis', e); }
}
/* eval bar, engine line, arrows: drawn from the latest analysis */
function drawAssist() {
  const A = assistOn(), key = curKey(), r = S.an && S.an.key === key ? S.an.res : null;
  const bar = $('evalbar');
  bar.hidden = !A.evalbar;
  if (A.evalbar) {
    const w = r ? winPct(r) : 50;
    bar.classList.toggle('flipped', !!S.flipped); bar.classList.toggle('wait', !r);
    bar.style.setProperty('--w', w + '%');
    bar.querySelector('.ev').textContent = r ? fmtEval(r) : '';
    bar.classList.toggle('blackahead', w < 50);
  }
  const line = $('eline');
  line.hidden = !A.lines;
  if (A.lines) {
    if (!r) line.textContent = S.over && !S.explore && curPly() === S.moves.length ? 'Game over' : 'analysing…';
    else {
      const q = S.explore ? explorePos() : posAt(curPly()), sans = [];   /* a copy: the line is played out on it */
      const pv = r.pv && r.pv.length ? r.pv : [];
      if (pv.length) { for (const u of pv.slice(0, 7)) { const m = q.fromUci(u); if (!m) break; sans.push(q.san(m).replace(/\?!$/, '')); q.make(m); } }
      else if (r.best) sans.push(q.san(r.best).replace(/\?!$/, ''));
      line.textContent = `${fmtEval(r)}  ${sans.join(' ')}  · ${r.by}`;
    }
  }
  renderShapes();
}
/* ================= result card and the quick review behind it ================= */
const COUNT_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good'];
function renderReviewStats() {
  const box = document.querySelector('#result .rstats'), acc = document.querySelector('#result .racc');
  if (!box || !S.review || S.review.gid !== S.gameId) return;
  const R = S.review;
  if (acc) acc.innerHTML = R.ready && R.acc != null ? `<b>${R.acc.toFixed(1)}</b><small>Accuracy</small>` : `<b class="skel">--.-</b><small>Accuracy</small>`;
  box.innerHTML = '';
  if (!R.ready) {
    box.classList.add('loading');
    for (let i = 0; i < 3; i++) box.append(el('div', {class: 'rc skel'}, el('b', {}, ' '), el('small', {}, i === 1 ? `Reviewing ${Math.round(R.done / R.total * 100)}%` : ' ')));
    return;
  }
  box.classList.remove('loading');
  /* the three best categories you actually played (chess sites keep this positive and short) */
  let pick = COUNT_ORDER.filter(k => R.counts[k]).slice(0, 3);
  if (pick.length < 3) pick = pick.concat(['inaccuracy', 'mistake', 'blunder'].filter(k => R.counts[k]).slice(0, 3 - pick.length));
  for (const k of pick) {
    const c = CLASSES[k];
    box.append(el('div', {class: 'rc', title: c.name},
      el('b', {}, el('span', {class: 'rci', style: `background:${c.col}`, html: c.icon ? ICONS[c.icon] : esc(c.glyph)}), String(R.counts[k])), el('small', {style: `color:${c.col}`}, c.name)));
  }
}
function coachLine(won, draw, R) {
  const acc = R && R.ready ? R.acc : null;
  if (won) return acc != null && acc >= 85 ? 'Clean game. You barely gave anything away.' : 'A win is a win. Let\'s look at where it could have been easier.';
  if (draw) return 'A fair result. Let\'s see where either side could have pushed for more.';
  return R && R.key ? 'That game didn\'t go your way, but there\'s a clear turning point. Let\'s review it together.' : 'That game didn\'t go your way. Let\'s review it and find what to improve.';
}
function renderResult() {
  const box = $('result');
  if (!S.over || S.resultClosed || S.viewPly != null || S.explore) { box.hidden = true; return; }
  if (!box.hidden && box.dataset.game === String(S.gameId)) { renderReviewStats(); return; }
  const o = S.over, w = o.result === '1-0' ? 0 : o.result === '0-1' ? 1 : -1, hum = [0, 1].filter(i => S.seats[i].type === 'human');
  let title = w < 0 ? 'Draw' : SIDE[w] + ' won';
  if (o.result === '*') title = 'Game stopped';
  else if (hum.length === 1 && w >= 0) title = S.seats[w].type === 'human' ? 'You won' : 'You lost';
  const won = title === 'You won', d = S.resultDelta, rv = S.review && S.review.gid === S.gameId;
  const reason = o.result === '*' ? '' : o.reason === 'timeout' ? 'on time' : 'by ' + o.reason;
  box.dataset.game = String(S.gameId);
  box.innerHTML = '';
  const close = el('button', {class: 'x', title: 'Close', 'aria-label': 'Close', html: icon('x'), onclick: () => { S.resultClosed = true; render(); }});
  const rating = d ? el('div', {class: 'rnum'}, el('b', {}, String(d.rating), el('span', {class: d.delta >= 0 ? 'up' : 'down'}, (d.delta >= 0 ? ' +' : ' ') + d.delta)), el('small', {}, 'Rating')) : null;
  const card = el('div', {class: 'card' + (won ? ' won' : '')}, close,
    el('div', {class: 'head'}, el('h2', {}, title), el('p', {}, reason)),
    rating || rv ? el('div', {class: 'rrow'}, rating, rv ? el('div', {class: 'rnum racc'}) : null) : null,
    rv ? el('div', {class: 'coach'}, el('img', {src: 'avatars/coach.webp', alt: ''}), el('p', {class: 'say'}, coachLine(won, w < 0, S.review))) : null,
    rv ? el('div', {class: 'rstats'}) : null,
    el('div', {class: 'btns'},
      rv ? el('button', {class: 'primary', html: icon('star-fill') + '<span>Game review</span>', onclick: () => openReview()}) : null,
      el('div', {class: 'two'},
        el('button', {onclick: () => { S.resultClosed = true; showTab('new'); render(); }}, 'New game'),
        el('button', {class: rv ? '' : 'primary', onclick: () => startGame()}, 'Rematch'))));
  box.append(card);
  box.hidden = false;
  renderReviewStats();
  if (won && !S.replay) confetti();
}
/* a short burst of confetti over the board when you win (skipped with reduced motion or when switched off) */
function confetti() {
  if (SET.appearance.confetti === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.querySelector('.boardwrap'), cv = el('canvas', {class: 'confetti'});
  wrap.append(cv);
  const W = cv.width = wrap.clientWidth * devicePixelRatio, H = cv.height = wrap.clientHeight * devicePixelRatio, g = cv.getContext('2d');
  const cols = ['#e9e2d4', '#8fbf73', '#e3a04a', '#e6c650', '#d98a7a', '#8fa8c0'], s = devicePixelRatio;
  /* one burst from behind the result card, flying outward in every direction (a little upward bias) */
  const ps = Array.from({length: 160}, (_, i) => {
    const a = Math.random() * Math.PI * 2, v = (7 + Math.random() * 11) * s;
    return {x: W / 2, y: H * .45, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * s,
      w: (5 + Math.random() * 5) * s, h: (8 + Math.random() * 8) * s, r: Math.random() * 6, vr: (Math.random() - .5) * .35, c: cols[i % cols.length], t: Math.random() * 10};
  });
  const t0 = performance.now();
  const step = now => {
    const dt = Math.min(2, (now - (step.last || now)) / 16.7); step.last = now;
    const age = now - t0; g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += .32 * s * dt; p.vx *= .985; p.vy *= .99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.t += .12 * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.t)); g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1800) / 900);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    }
    if (age < 2700) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

/* icon + text button label */
function label(btn, ic, text) {
  const key = ic + '|' + text;
  if (btn.dataset.lbl === key) return;
  btn.dataset.lbl = key;
  btn.innerHTML = icon(ic) + (text ? `<span>${esc(text)}</span>` : '');
}

/* ================= arrows ================= */
let adraw = null;
function arrowColor(e) { return e.shiftKey && (e.ctrlKey || e.metaKey) ? 'y' : e.shiftKey ? 'r' : e.altKey ? 'b' : (e.ctrlKey || e.metaKey) ? 'y' : 'g'; }
function renderShapes() {
  const bd = $('board'); let svg = bd.querySelector('svg.ov');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ov'); svg.setAttribute('viewBox', '0 0 8 8'); bd.append(svg); }
  const P = pts => pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
  let h = '';
  for (const c of S.circles) { const [x, y] = sqXY(c.s, S.flipped); h += `<circle cx="${x}" cy="${y}" r=".44" fill="none" stroke="${ARROW_COL[c.c]}" stroke-width=".08" opacity=".8"/>`; }
  const list = S.arrows.slice();
  if (S.hint && S.viewPly == null && !S.explore) list.push({f: S.hint.f, t: S.hint.t, c: 'h'});
  /* aid arrows: the best move (on your turn, or always in a review), and what the opponent threatens */
  const A = assistOn(), rv = reviewing(), key = curKey();
  const live = S.viewPly == null && !S.over && S.pos && S.seats[S.pos.turn]?.type === 'human';
  const rva = rv ? reviewArrows() : [];
  list.push(...rva);
  if ((live || rv) && A.suggest && S.an && S.an.key === key && S.an.res.best && !(S.hint && !rv) && !rva.length && !(S.retry && !S.retry.solved)) {
    const m = S.an.res.best, to = (m >> 17) & C.FL_CASTLE ? (m & 0x70) + (((m >> 7) & 127) > (m & 127) ? 6 : 2) : (m >> 7) & 127;
    list.push({f: m & 127, t: to, c: 's'});
  }
  if (live && A.threat && S.threatA && S.threatA.key === key) list.push({f: S.threatA.f, t: S.threatA.t, c: 't'});
  if (adraw && adraw.to !== adraw.from) list.push({f: adraw.from, t: adraw.to, c: adraw.col, tmp: true});
  for (const a of list) {
    const {line, head} = arrowGeom(a.f, a.t, S.flipped), col = {h: '#2f7fd8', s: '#3f9fe0', t: '#e0473a', v: '#5fb85a'}[a.c] || ARROW_COL[a.c];
    h += `<g opacity="${a.tmp ? .55 : a.c === 's' || a.c === 't' ? .62 : a.c === 'v' ? .72 : .8}"><polyline points="${P(line)}" fill="none" stroke="${col}" stroke-width=".16" stroke-linejoin="round"/><polygon points="${P(head)}" fill="${col}"/></g>`;
  }
  svg.innerHTML = h;
}
function toggleArrow(f, t, c) { const i = S.arrows.findIndex(a => a.f === f && a.t === t); if (i >= 0) { const same = S.arrows[i].c === c; S.arrows.splice(i, 1); if (same) return; } S.arrows.push({f, t, c}); }
function toggleCircle(s, c) { const i = S.circles.findIndex(x => x.s === s); if (i >= 0) { const same = S.circles[i].c === c; S.circles.splice(i, 1); if (same) return; } S.circles.push({s, c}); }
function shapesChanged() { renderShapes(); syncRelay(); }
function clearShapes() { if (S.arrows.length || S.circles.length) { S.arrows = []; S.circles = []; shapesChanged(); } }

/* ================= board input ================= */
let drag = null;
const boardEl = $('board');
boardEl.addEventListener('contextmenu', e => e.preventDefault());
boardEl.addEventListener('pointerdown', e => {
  const sqe = e.target.closest('.sq'); if (!sqe) return;
  const sq = +sqe.dataset.sq;
  if (e.button === 2) {
    if (cancelPremove()) { render(); e.preventDefault(); return; }   /* right-click cancels a premove, like on chess sites */
    adraw = {from: sq, to: sq, col: arrowColor(e)}; e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  if (reviewing()) {   /* review board: move pieces to try a side line */
    const bp = boardPos(), q = bp.b[sq];
    if (S.sel >= 0 && S.targets.has(sq)) { exploreAttempt(S.sel, sq); return; }
    if (q && (q >> 3) === bp.turn) {
      const was = S.sel === sq;
      select(sq, bp); render();
      drag = {sq, explore: true, piece: q, was, moved: false, x: e.clientX, y: e.clientY, ghost: null, pe: boardEl.querySelector('.pc[data-sq="' + sq + '"]')};
      e.preventDefault(); return;
    }
    clearSel(); render(); return;
  }
  const p = S.pos.b[sq];
  if (canPremove()) {
    const me = humanSide(), q = preBoard()[sq], mine = q && (q >> 3) === me;
    if (S.preSel >= 0 && !mine && sq !== S.preSel) { addPremove(S.preSel, sq); render(); return; }
    if (mine) {
      const was = S.preSel === sq;
      S.preSel = was ? -1 : sq; render();
      drag = {sq, pre: true, piece: q, was, moved: false, x: e.clientX, y: e.clientY, ghost: null, pe: boardEl.querySelector('.pc[data-sq="' + sq + '"]')};
      e.preventDefault(); return;
    }
    cancelPremove(); clearShapes(); render(); return;
  }
  if (S.sel >= 0 && (S.targets.has(sq) || freeTarget(sq))) { attempt(S.sel, sq, false); return; }
  if (p && canMove(p >> 3)) {
    const was = S.sel === sq;
    select(sq); render();
    drag = {sq, was, moved: false, x: e.clientX, y: e.clientY, ghost: null, pe: boardEl.querySelector('.pc[data-sq="' + sq + '"]')};
    e.preventDefault();
  } else { clearSel(); clearShapes(); render(); }
});
function sqAt(x, y) { const e = document.elementFromPoint(x, y), s = e && e.closest && e.closest('#board .sq'); return s ? +s.dataset.sq : -1; }
window.addEventListener('pointermove', e => {
  if (adraw) { const s = sqAt(e.clientX, e.clientY); if (s >= 0 && s !== adraw.to) { adraw.to = s; renderShapes(); } return; }
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
    drag.moved = true;
    const g = setPiece(el('div'), drag.piece || S.pos.b[drag.sq], 'ghost'); document.body.append(g); drag.ghost = g;
    if (drag.pe) drag.pe.classList.add('lift');
  }
  if (drag.ghost) { drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px'; }
});
window.addEventListener('pointerup', e => {
  if (adraw && e.button === 2) {
    const a = adraw; adraw = null;
    const s = sqAt(e.clientX, e.clientY), to = s >= 0 ? s : a.to;
    if (to === a.from) toggleCircle(to, a.col); else toggleArrow(a.from, to, a.col);
    shapesChanged(); return;
  }
  if (!drag) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  if (d.explore) {
    const t = d.moved ? sqAt(e.clientX, e.clientY) : -1;
    if (t >= 0 && S.targets.has(t)) exploreAttempt(d.sq, t);
    else if (d.moved || d.was) { clearSel(); render(); }
    return;
  }
  if (d.pre) {
    const t = d.moved ? sqAt(e.clientX, e.clientY) : -1;
    if (t >= 0 && t !== d.sq && canPremove()) addPremove(d.sq, t);
    render(); return;
  }
  if (d.moved) {
    const t = sqAt(e.clientX, e.clientY);
    if (t >= 0 && (S.targets.has(t) || (S.selFree && t !== d.sq))) attempt(d.sq, t, true);
    else { clearSel(); render(); }
  } else if (d.was) { clearSel(); render(); }
});

/* ================= saved game, window ownership, agent relay ================= */
function relayState() {
  const p = S.pos, legal = S.over ? [] : p.legalMoves(), P = S.seats[p.turn];
  const lu = legal.map(m => p.toUci(m));
  if (S.c960) for (const m of legal) if ((m >> 17) & C.FL_CASTLE) lu.push(C.uci(m, false));
  const agentToMove = !S.over && !S.paused && P.type === 'agent';
  const st = {
    fmt: 3, ts: Date.now(), page: PAGE_ID, gameKey: S.gameKey,
    seats: S.seats.map(Q => { const {convo, persona, lastInfo, noImage, note, lastPly, ...cfg} = Q; return cfg; }),
    players: S.seats.map((Q, i) => ({side: SIDE[i].toLowerCase(), type: Q.type, name: seatName(i), rulesFree: rulesOff(Q), illegal: Q.illegal})),
    variant: S.variant, variantName: VARIANT_NAME[S.variant], c960: S.c960, startFen: S.startFen, startName: S.startName, chaos: S.chaos,
    fen: p.fen(), turn: p.turn ? 'black' : 'white', agentToMove, agentColor: agentToMove ? (p.turn ? 'black' : 'white') : null,
    rulesFree: P.type === 'agent' ? rulesOff(P) : false, paused: S.paused,
    over: S.over, fullmove: p.full, inCheck: p.inCheck(), checks: S.variant === C.V_3CHECK ? p.checks.slice() : undefined,
    moves: S.moves.map(m => C.uci(m, S.c960)), movesRaw: S.moves.slice(), san: S.sans, lastSan: S.sans.length ? S.sans[S.sans.length - 1] : null,
    legal: lu, board: ascii(p), clock: S.clock ? {base: S.clock.base, inc: S.clock.inc, ms: S.clock.ms, llmFree: !!S.clock.llmFree} : null,
    times: S.times, clockAt: S.clockAt,
    chatLog: (S.chatLog || []).slice(-100), shapes: {arrows: S.arrows, circles: S.circles},
  };
  if (S.config.agent) {
    st.legalSan = legal.map(m => p.san(m));
    st.arrows = S.peek ? S.arrows.map(a => C.sqName(a.f) + C.sqName(a.t)) : [];
    st.circles = S.peek ? S.circles.map(c => C.sqName(c.s)) : [];
    st.chat = (S.chatLog || []).slice(-8).map(c => ({from: c.from === 'you' ? 'opponent' : c.from === 'sys' ? 'system' : SIDE[c.from], text: c.text}));
  }
  return st;
}
let syncT = 0;
function syncRelay() {
  if (S.pz) return;   /* puzzles never replace the saved game */
  if (!relayOK || !S.pos || S.inactive || SHOT) return;
  clearTimeout(syncT);
  syncT = setTimeout(async () => {
    try {
      const r = await fetch('/api/sync', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(relayState())});
      if (r.status === 409) goInactive();
    } catch (e) {}
  }, 0);
}
async function tryRestore() {
  if (!relayOK) return false;
  try {
    const d = await api('/api/state');
    if (d.fmt !== 3 || !d.ts || Date.now() - d.ts > 7 * 24 * 3600e3 || d.over || !Array.isArray(d.movesRaw) || !d.movesRaw.length) return false;
    const variant = d.variant | 0, c960 = !!d.c960, fen = d.startFen || C.START_FEN;
    const pos = new C.Pos(fen, variant, c960), sans = [];
    S.lastOn = new Map();
    for (const m of d.movesRaw) { remember(pos); sans.push(pos.san(m)); pos.make(m); }
    for (const i of [0, 1]) writeSeat(i, d.seats[i]);
    $('variant').value = variant; $('chaos').checked = !!d.chaos; seatVis(0); seatVis(1);
    S.gameId++; cancelThinking(); cancelPremove();
    S.gameKey = d.gameKey || newKey(); S.replay = null; S.setupDirty = false; S.fb = new Map(); S.an = null; S.explore = null; S.pz = null; S.pzRun = null;
    S.seats = d.seats.map(seatFrom).map(P => rate(P));
    S.clock = d.clock ? {...d.clock, ms: d.clock.ms.slice()} : null;
    S.times = Array.isArray(d.times) ? d.times.slice(0, d.movesRaw.length) : [];
    S.clockAt = Array.isArray(d.clockAt) && d.clockAt.length === d.movesRaw.length + 1 ? d.clockAt : [];
    S.turnMs = 0; S.tickT = performance.now(); S.resultClosed = false; S.variant = variant; S.c960 = c960; S.startFen = fen; S.startName = d.startName || ''; S.chaos = !!d.chaos;
    S.pos = pos; S.startPly = (() => { const q = new C.Pos(fen, variant, c960); return (q.full - 1) * 2 + q.turn; })();
    S.moves = d.movesRaw.slice(); S.sans = sans; S.lastMove = S.moves[S.moves.length - 1]; S.over = null; S.viewPly = null;
    S.say = ''; S.sayBy = -1; S.info = ''; S.paused = !!d.paused; S.arrows = []; S.circles = []; S.anim = null;
    S.flipped = S.seats[1].type === 'human' && S.seats[0].type !== 'human';
    assignPersonas(); restoreChat(Array.isArray(d.chatLog) ? d.chatLog : []);
    if (d.shapes) { S.arrows = d.shapes.arrows || []; S.circles = d.shapes.circles || []; }
    clearSel(); toast('Game restored'); afterMove();
    return true;
  } catch (e) { console.error(e); return false; }
}
async function hello() { try { await api('/api/hello', {page: PAGE_ID}); } catch (e) {} }
function goInactive() {
  if (S.inactive) return;
  S.inactive = true; cancelThinking();
  const d = el('div', {id: 'inactive'}, el('div', {class: 'box'}, el('b', {}, 'This game is open in another window.'), el('p', {}, 'Only one window plays at a time.'),
    el('button', {class: 'primary', onclick: async () => { await hello(); d.remove(); S.inactive = false; if (!(await tryRestore())) render(); pollRelay(); }}, 'Continue here')));
  document.body.append(d);
}
let polling = false;
async function pollRelay() {
  if (polling || !relayOK) return; polling = true;
  for (;;) {
    if (S.inactive) { polling = false; return; }
    try {
      const j = await api(`/api/pending?wait=20&page=${PAGE_ID}`);
      if (j.inactive) { goInactive(); continue; }
      const mv = j.move;
      if (mv && S.pos && !S.over && !S.paused) {
        const side = S.pos.turn, P = S.seats[side];
        if (P.type === 'agent') {
          let m = S.pos.fromUci(mv.uci);
          if (!m && rulesOff(P)) { m = resolveIllegal(mv.uci, side) || 0; if (m) P.illegal++; }
          if (m) { if (mv.say) say(side, mv.say); play(m); }
        }
      }
    } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
  }
}

/* ================= buttons and keys ================= */
function pgn() {
  const d = new Date(), ds = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  const nm = i => { const P = S.seats[i]; return P.type === 'human' ? 'Player' : P.type === 'llm' ? P.model : seatName(i); };
  const res = S.over && S.over.result !== '*' ? S.over.result : '*';
  const tags = [['Event', 'AI Chess game'], ['Site', 'https://github.com/BrandScape-Media/ai-chess'], ['Date', ds], ['White', nm(0)], ['Black', nm(1)], ['Result', res]];
  if (S.variant) tags.push(['Variant', VARIANT_NAME[S.variant]]); else if (S.c960) tags.push(['Variant', 'Chess960']);
  if (S.startFen !== C.START_FEN) tags.push(['SetUp', '1'], ['FEN', S.startFen]);
  const t = histText(S.sans);
  return tags.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n' + t + (t ? ' ' : '') + res;
}
async function copy(txt, what) {
  try { await navigator.clipboard.writeText(txt); toast(what + ' copied'); }
  catch (e) { window.prompt('Copy ' + what + ':', txt); }
}
$('bNew').onclick = () => { startGame(); showTab('play'); };
$('tcLLM').onchange = saveSetup;
$('bSwap').onclick = () => {
  swapSeats(); saveSetup();
  if (!S.moves.length || S.over) { applySeat(0); applySeat(1); }
  else { S.setupDirty = true; toast('The sides swap with the next game'); }
  renderSidePick(); renderMatchup();
};
$('bUndo').onclick = undo;
$('bFlip').onclick = () => { S.flipped = !S.flipped; render(); };
$('bResign').onclick = resign;
$('bPause').onclick = togglePause;
$('bHint').onclick = hint;
for (const id of ['allowHints', 'allowUndo']) $(id).onchange = () => { saveSetup(); render(); };
$('bFirst').onclick = () => goView(0);
$('bPrev').onclick = () => { if (!exploreBack()) goView(curPly() - 1); };
$('bNext').onclick = () => goView(curPly() + 1);
$('bLast').onclick = () => goView(null);
$('bFen').onclick = () => copy(S.pos.fen(), 'FEN');
$('bPgn').onclick = () => copy(pgn(), 'PGN');
$('bSettings').onclick = () => openSettings();
for (const id of ['rnd', 'variant', 'fenIn']) $(id).onchange = saveSetup;
$('start').onchange = () => { startVis(); saveSetup(); };
$('peek').onchange = () => { S.peek = $('peek').checked; saveSetup(); syncRelay(); };
$('chaos').onchange = () => { S.chaos = $('chaos').checked; seatVis(0); seatVis(1); saveSetup(); render(); syncRelay(); };
window.addEventListener('keydown', e => {
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || $('settings').open) return;
  if (e.key === 'ArrowLeft') { if (!exploreBack()) goView(curPly() - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goView(curPly() + 1); e.preventDefault(); }
  else if (e.key === 'Home') { goView(0); e.preventDefault(); }
  else if (e.key === 'End') { goView(null); e.preventDefault(); }
  else if ((e.key === '[' || e.key === ']') && reviewReady()) {
    const cur = curPly(), K = S.review.keys, k = e.key === '[' ? [...K].reverse().find(j => j < cur) : K.find(j => j > cur);
    if (k != null) goView(k);
  }
  else if (e.key === 'f' || e.key === 'F') { S.flipped = !S.flipped; render(); }
  else if (e.key === 'p' || e.key === 'P') { if (!$('bPause').hidden) togglePause(); }
  else if (e.key === 'h' || e.key === 'H') { if (!$('bHint').hidden) hint(); }
  else if (e.key === 'Escape') { if (S.explore) { S.explore = null; clearSel(); render(); return; } clearSel(); cancelPremove(); $('strengthPop').hidden = true; $('promo').hidden = true; S.arrows = []; S.circles = []; shapesChanged(); render(); }
});
onSettings.changed = () => {
  S.chatOn = SET.chat.enabled !== false;
  for (const i of [0, 1]) { engineMenus(i); providerMenu(i); seatVis(i); }
  renderModeLists();
  render();
};

/* ================= puzzles: the board side ================= */
/* a puzzle is a small game on the main board: you against the "Puzzle" seat, whose moves come from the solution */
initPuzzles({
  board(fen) {
    S.gameId++; cancelThinking(); cancelPremove();
    const pos = new C.Pos(fen, 0, false);
    S.gameKey = newKey(); S.replay = null; S.setupDirty = false; S.explore = null; S.review = null; S.retry = null;
    S.variant = 0; S.c960 = false; S.startFen = fen; S.startName = 'Puzzle'; S.chaos = false; S.clock = null;
    S.times = []; S.clockAt = [null]; S.turnMs = 0;
    S.pos = pos; S.startPly = (pos.full - 1) * 2 + pos.turn;
    S.moves = []; S.sans = []; S.lastMove = 0; S.over = null; S.viewPly = null; S.say = ''; S.sayBy = -1; S.info = ''; S.paused = false;
    S.lastOn = new Map(); S.arrows = []; S.circles = []; S.anim = null; S.hint = null; S.fb = new Map(); S.an = null; S.threatA = null; S.resultClosed = true;
    clearSel();
  },
  setSides(me) {
    S.seats = [0, 1].map(i => Object.assign(seatFrom({type: i === me ? 'human' : 'puzzle'}), {rating: i === me ? SET.puzzles.rating : null}));
    S.flipped = me === 1; render();
  },
  play: m => play(m),
  render: () => render(),
  takeBack() { S.pos.unmake(); S.moves.pop(); S.sans.pop(); S.lastMove = S.moves.length ? S.moves[S.moves.length - 1] : 0; clearSel(); render(); },
  sound: cap => tick(cap),
  async backToGame() { if (!(await tryRestore())) startGame(); showTab('play'); },
});

/* Stockfish is set up in the background on the first start: once it is there, the analysis and the game review use it */
async function watchStockfish() {
  let waited = false;
  for (let i = 0; i < 400 && S.engineCatalog?.jobs?.stockfish?.state === 'running'; i++) {
    waited = true;
    await new Promise(r => setTimeout(r, 1500));
    await refreshEngines();
  }
  if (waited && S.engineList?.some(e => e.id === 'stockfish')) { toast('Stockfish is ready: the evaluation and game reviews use it now'); render(); }
}

/* ================= boot ================= */
Object.assign(hooks, {play, render, afterMove, schedule, sync: () => syncRelay(), history: renderHistory, newTab: () => showMode('hub'), puzzles: () => renderPuzzles(), review: () => renderReviewTab()});
initReview({goView, curPly, render, showTab, activeTab, tick, clearSel, exploreMove, humanSide, winPly, paintAvatar});
for (const e of document.querySelectorAll('[data-ic]')) e.insertAdjacentHTML('afterbegin', icon(e.dataset.ic));
(async () => {
  if (relayOK) { try { S.config = await api('/api/config'); } catch (e) {} }
  await loadSettings();
  S.chatOn = SET.chat.enabled !== false;
  preloadCanvasPieces();
  if (relayOK) { await refreshEngines(); if (!SHOT) await hello(); watchStockfish(); }
  buildSeat(0); buildSeat(1); buildTcPick(); buildAssist();
  loadSetup(); showMode('hub');
  S.peek = $('peek').checked;
  initChat();
  await Promise.all([0, 1].filter(i => $('type' + i).value === 'llm').map(i => loadModels(i)));
  if (!(await tryRestore())) startGame();
  if (!SHOT) pollRelay();
  const h = /settings(?:=(\w+))?/.exec(location.hash);   /* e.g. #settings=engines */
  if (h) openSettings(h[1]);
  if (/tab=chat/.test(location.hash)) showTab('chat');
  window.aichess = {S, C, SET, startGame, play, render, readSeat, writeSeat, toggleArrow, toggleCircle, shapesChanged, undo, togglePause, relayState, applySeat, loadModels};
})();
