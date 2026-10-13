/* AI Chess: page wiring, setup panel, board, game flow, saved game. GPL-3.0-or-later */
import * as C from './core.js';
import {$, api, toast, el, esc, relayOK} from './util.js';
import {S, SIDE, VARIANT_NAME, hooks, isAI, humanCount, rulesOff, seatName, shortModel, ascii, histText, remember} from './state.js';
import {applyAppearance, setPiece, preloadCanvasPieces, isImageSet, glyph} from './theme.js';
import {SET, loadSettings, saveSettings, openSettings, refreshEngines, onSettings} from './settings.js';
import {askEngine, askLLM, cancelThinking, resolveIllegal, arrowGeom, sqXY, ARROW_COL, bestMoveHint} from './players.js';
import {ICONS, icon} from './icons.js';
import {BOTS} from './historic.js';
import {initChat, assignPersonas, onGameStart, onMove, onGameOver, onTakeback, say, sysMsg, chatVisible, restoreChat, showTab} from './chat.js';

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
const AVATAR = {builtin: ['cpu-fill', '#5d6b7a'], turochamp: ['scroll-fill', '#8a7350'], random: ['dice-five-fill', '#7a5d8a'],
  stockfish: ['fish-fill', '#3f7f5a'], 'fairy-stockfish': ['magic-wand-fill', '#6a5aa8'], lc0: ['brain-fill', '#b0574a'], maia: ['graduation-cap-fill', '#c08a3a'],
  berserk: ['flame-fill', '#c0533a'], koivisto: ['tree-fill', '#4f8a4a'], obsidian: ['diamond-fill', '#4a4f6a'], caissa: ['crown-fill', '#a8873a'],
  clover: ['clover-fill', '#3d8a63'], halogen: ['atom-fill', '#3a7fa8'], arasan: ['castle-turret-fill', '#7a6a55'], weiss: ['snowflake-fill', '#6f8fa8'],
  fabchess: ['gear-six-fill', '#8a6a3a'], seer: ['eye-fill', '#5a6fa8'], velvet: ['feather-fill', '#8a4a6a'], altair: ['star-four-fill', '#4a6a9a']};
const TC_GROUPS = [['Bullet', 'flame-fill', [['60+0', '1 min'], ['60+1', '1 | 1'], ['120+1', '2 | 1']]],
  ['Blitz', 'lightning', [['180+0', '3 min'], ['180+2', '3 | 2'], ['300+0', '5 min']]],
  ['Rapid', 'timer', [['600+0', '10 min'], ['600+5', '10 | 5'], ['900+10', '15 | 10']]],
  ['Other', 'clock', [['1800+0', '30 min'], ['0', 'No clock']]]];
const LC0_ELO = {1: 1900, 10: 2300, 100: 2700, 800: 3000, 5000: 3250, 30000: 3400};
const NODES = [[1, '1 node (pure instinct)'], [10, '10 nodes'], [100, '100 nodes'], [800, '800 nodes'], [5000, '5000 nodes'], [30000, '30k nodes']];

/* ================= setup panel ================= */
const pendingModel = ['', ''];
function seatHTML(i) {
  const agent = S.config.agent ? `<option value="agent">${esc(S.config.agent)} (agent)</option>` : '';
  return `<div class="seat-h"><img class="sw" src="pieces/cburnett/${i ? 'b' : 'w'}K.svg" alt=""><b>${SIDE[i]}</b>
    <select id="type${i}"><option value="human">Human</option><option value="engine">Chess engine</option><option value="llm">Local AI model</option>${agent}</select></div>
  <div class="set">
    <label data-t="engine">Engine</label><select id="engine${i}" data-t="engine"></select>
    <label data-k="builtin">Level</label><select id="level${i}" data-k="builtin"></select>
    <label data-k="elo">Strength</label><select id="elo${i}" data-k="elo"></select>
    <label data-k="maia">Rating</label><select id="maia${i}" data-k="maia"></select>
    <label data-k="nodes">Search</label><select id="nodes${i}" data-k="nodes"></select>
    <label data-k="time elo">Think</label><select id="movetime${i}" data-k="time elo"></select>
    <label data-t="llm">Provider</label><select id="prov${i}" data-t="llm"></select>
    <label data-t="llm">Model</label><span data-t="llm" style="display:flex;gap:6px;min-width:0"><input id="model${i}" type="text" list="models${i}" spellcheck="false" placeholder="model name" style="flex:1;min-width:0"><datalist id="models${i}"></datalist><button id="reload${i}" class="ib" title="Reload the model list">${icon('arrow-counter-clockwise')}</button></span>
    <label data-t="llm">Thinking</label><select id="think${i}" data-t="llm"><option value="none">Off (fast)</option><option value="low">Low</option><option value="medium">Medium</option><option value="xhigh">Max</option></select>
    <label data-t="llm">Sees</label><select id="sees${i}" data-t="llm" title="Fresh prompt: the full position every turn. One chat: a single growing conversation, like playing an AI in a chat window; with 'moves only' it has to track the board itself (that's where it loses the plot)."><option value="board">Fresh prompt, full board each turn</option><option value="chatboard">One chat, board each turn</option><option value="chat">One chat, moves only (blindfold)</option></select>
    <label data-t="llm">Picture</label><select id="img${i}" data-t="llm" title="Attach a picture of the board for vision models. Text-only models are detected and get text only."><option value="last">Board picture, latest turn only</option><option value="all">Board picture every turn (big context)</option><option value="off">No picture</option></select>
    <label data-t="llm">Hints</label><label class="chk" data-t="llm"><input type="checkbox" id="hint${i}"> list the legal moves</label>
    <label data-chaos>Illegal</label><label class="chk" data-chaos title="This side's illegal moves are played as-is: pieces teleport, capture their own side, come back from the dead or appear from nowhere. The player is never told."><input type="checkbox" id="free${i}"> allowed for this side</label>
  </div>`;
}
function fillSelect(sel, items, keep) {
  sel.innerHTML = '';
  for (const [v, t] of items) sel.append(el('option', {value: v}, t));
  if (keep != null && items.some(([v]) => String(v) === String(keep))) sel.value = keep;
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
  fillSelect($('elo' + i), ELO_STEPS.filter(v => !v || (v >= elo[0] && v <= elo[1])).map(v => [v, v ? v + ' Elo' : 'Full strength']), want ? want.elo || 0 : ($('elo' + i).value || 0));
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
  if (!relayOK) $('type' + i).querySelector('option[value="llm"]').disabled = true;
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
  for (const k of ['level', 'elo', 'maia', 'nodes', 'movetime', 'think', 'sees', 'img', 'hint', 'free']) $(k + i).onchange = () => { saveSetup(); liveApply(i, k); };
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
}
function readSeat(i) {
  return {type: $('type' + i).value, engine: $('engine' + i).value || 'builtin', level: +$('level' + i).value, elo: +$('elo' + i).value || 0, maia: $('maia' + i).value || '1500',
    nodes: +$('nodes' + i).value, movetime: +$('movetime' + i).value, provider: $('prov' + i).value, model: $('model' + i).value.trim(),
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
    clock: S.clock ? {base: S.clock.base, inc: S.clock.inc} : null, delta: S.resultDelta, pgn: pgn()};
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
  S.over = {result: g.result, reason: g.reason}; S.resultClosed = true; S.resultDelta = g.delta || null; S.replay = g.id; S.gameKey = g.id;
  S.clock = null; S.paused = false; S.say = ''; S.sayBy = -1; S.info = ''; S.arrows = []; S.circles = []; S.anim = null; S.hint = null;
  S.flipped = g.players[1].type === 'human' && g.players[0].type !== 'human';
  restoreChat([]); clearSel();
  S.viewPly = 0;
  showTab('play'); render(); syncRelay();
  toast('Replaying: use the arrows or the move list');
}
/* a different player (or model/engine) takes over side i right away, from the current position */
function applySeat(i) {
  const P = S.seats[i];
  if (!P || !S.pos) { render(); return; }
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
  const P = S.seats[i]; if (!P) return;
  const c = readSeat(i);
  if (c.type !== P.type) return;
  if (k === 'sees' && P.sees !== c.sees) { P.convo = []; P.lastPly = -1; }
  for (const key of ['level', 'elo', 'maia', 'nodes', 'movetime', 'think', 'sees', 'img', 'hint', 'free']) P[key] = c[key];
  rate(P);
  render(); syncRelay();
}
function saveSetup() {
  try {
    localStorage.setItem('aichess.setup', JSON.stringify({seats: [readSeat(0), readSeat(1)], variant: $('variant').value, start: $('start').value,
      fen: $('fenIn').value, peek: $('peek').checked, rnd: $('rnd').checked, chaos: $('chaos').checked, tc: $('tc').value, tcAI: $('tcAI').checked, hints: $('allowHints').checked, undo: $('allowUndo').checked}));
  } catch (e) {}
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
  setTc(j.tc ?? '600+0'); $('tcAI').checked = !!j.tcAI;
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
  S.gameKey = newKey(); S.replay = null;
  for (const P of seats) rate(P, true);
  const tc = timeControl();
  S.clock = tc ? {...tc, ms: [tc.base, tc.base], ai: $('tcAI').checked, last: performance.now()} : null;
  S.resultClosed = false; S.resultDelta = null;
  S.seats = seats; S.variant = variant; S.c960 = c960; S.startFen = fen; S.startName = name; S.chaos = $('chaos').checked;
  S.pos = new C.Pos(fen, variant, c960); S.startPly = (S.pos.full - 1) * 2 + S.pos.turn;
  S.moves = []; S.sans = []; S.lastMove = 0; S.over = null; S.viewPly = null; S.say = ''; S.sayBy = -1; S.info = ''; S.paused = false;
  S.lastOn = new Map(); S.arrows = []; S.circles = []; S.anim = null; S.hint = null; S.hintsUsed = 0;
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
  const me = humanSide();
  return me >= 0 && SET.appearance.premoves !== false && !S.over && S.viewPly == null && !S.inactive && S.pos.turn !== me;
}
function cancelPremove() { const had = S.premove || S.preSel >= 0; S.premove = null; S.preSel = -1; return had; }
function runPremove() {
  const pm = S.premove;
  if (!pm) return;
  if (S.over) { cancelPremove(); return; }
  const me = S.pos.turn;
  if (S.seats[me].type !== 'human') return;
  S.premove = null;
  const gid = S.gameId, len = S.moves.length;
  setTimeout(() => {
    if (gid !== S.gameId || len !== S.moves.length || S.over || S.pos.turn !== me) return;
    const pc = S.pos.b[pm.f];
    if (!pc || (pc >> 3) !== me) { render(); return; }   /* the piece was captured */
    select(pm.f);
    const ms = (S.targets.get(pm.t) || []).filter(m => (m & 127) === pm.f);
    if (ms.length) play(ms.find(m => ((m >> 14) & 7) === C.QUEEN) || ms[0]);
    else if (S.selFree && pm.t !== pm.f) playFree(pm.f, pm.t);
    else { clearSel(); render(); }
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
  if (S.clock && timed(mover) && S.moves.length > 1) S.clock.ms[mover] += S.clock.inc;
  if (S.clock) S.clock.last = performance.now();
  remember(S.pos);
  S.sans.push(S.pos.san(m));
  S.pos.make(m); S.moves.push(m); S.lastMove = m; S.viewPly = null;
  S.anim = opts.dragged ? null : m; S.hint = null;
  clearSel();
  tick(!!captured);
  if (P.type !== 'human' && (S.arrows.length || S.circles.length)) { S.arrows = []; S.circles = []; }   /* the opponent answered: your sketch is stale */
  onMove({mover, m, captured, check: S.pos.inCheck(), free: !!(fl & C.FL_FREE), prevEval: prevEval[mover ^ 1]});
  afterMove();
}
function canMove(color) {
  if (S.over || S.viewPly != null || S.thinking || S.inactive) return false;
  return S.pos.turn === color && S.seats[color].type === 'human';
}
function clearSel() { S.sel = -1; S.selFree = false; S.targets = new Map(); S.tgtHide = new Set(); }
function select(sq) {
  clearSel(); S.sel = sq;
  S.selFree = rulesOff(S.seats[S.pos.turn]) && S.seats[S.pos.turn].type === 'human';
  const add = (to, m, hide) => { if (!S.targets.has(to)) S.targets.set(to, []); S.targets.get(to).push(m); if (hide) S.tgtHide.add(to); };
  const ml = S.pos.legalMoves().filter(m => (m & 127) === sq);
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
function choosePromo(ms) {
  const box = $('promoBox'); box.innerHTML = '';
  for (const t of [C.QUEEN, C.ROOK, C.BISHOP, C.KNIGHT]) {
    const m = ms.find(x => ((x >> 14) & 7) === t);
    const b = el('button', {onclick: () => { $('promo').hidden = true; play(m); }}, setPiece(el('div'), (S.pos.turn << 3) | t));
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
  for (const P of S.seats) if (P.convo.length || P.lastPly >= 0) {
    P.convo = P.convo.filter(m => m.ply < S.moves.length);
    P.lastPly = P.convo.length ? P.convo[P.convo.length - 1].ply : -1;
  }
  S.lastMove = S.moves.length ? S.moves[S.moves.length - 1] : 0; S.info = ''; S.say = ''; S.anim = null; S.hint = null;
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
  if (k == null || k >= S.moves.length) S.viewPly = null; else S.viewPly = Math.max(0, k);
  S.anim = null; clearSel(); render();
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
  const vp = viewPos(), live = S.viewPly == null;
  const lastM = curPly() > 0 ? S.moves[curPly() - 1] : 0;
  const kingChk = vp.inCheck() ? vp.ksq[vp.turn] : -1;
  const bd = $('board'); bd.innerHTML = '';
  const pieceEls = new Map();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = S.flipped ? i : 7 - i, f = S.flipped ? 7 - j : j, sq = r * 16 + f, p = vp.b[sq];
    const tgt = live && S.targets.has(sq) && !S.tgtHide.has(sq);
    const e = el('div', {class: 'sq' + (((r + f) & 1) ? '' : ' d') + (S.variant === C.V_KOTH && C.isHill(sq) ? ' hill' : '') + (lastM && (sq === (lastM & 127) || sq === ((lastM >> 7) & 127)) ? ' last' : '')
      + (live && S.sel === sq ? ' sel' : '') + (sq === kingChk ? ' chk' : '')
      + (live && S.premove && (sq === S.premove.f || sq === S.premove.t) ? ' pre' : '') + (live && S.preSel === sq ? ' presel' : '') + (tgt ? (' tgt' + ((p || ((S.targets.get(sq)[0] >> 17) & 1)) ? ' cap' : '')) : '')});
    e.dataset.sq = sq;
    if (j === 0) e.append(el('span', {class: 'co r'}, r + 1));
    if (i === 7) e.append(el('span', {class: 'co f'}, C.FILES[f]));
    if (p) { const pe = setPiece(el('div'), p); pe.dataset.sq = sq; e.append(pe); pieceEls.set(sq, pe); }
    bd.append(e);
  }
  if (live && S.anim) animate(S.anim, pieceEls);
  S.anim = null;
  renderShapes();
  renderStrips(vp); renderMoves(); renderStatus();
  const vtag = [S.variant ? VARIANT_NAME[S.variant] : '', S.startName].filter(Boolean).join(', ');
  document.title = `${seatName(0)} vs ${seatName(1)}${vtag ? ' (' + vtag + ')' : ''} | AI Chess`;
  $('einfo').textContent = S.info;
  const bub = $('bubble');
  if (S.say && (S.sayBy >= 0 || S.sayBy === -2)) { bub.hidden = false; bub.innerHTML = ''; bub.append(el('b', {}, (S.sayBy === -2 ? 'Hint' : seatName(S.sayBy)) + ': '), S.say); } else bub.hidden = true;
  $('bUndo').disabled = !S.moves.length || !!S.replay;
  const hc = humanCount();
  label($('bResign'), 'flag', hc ? 'Resign' : 'Stop');
  $('bResign').disabled = !!S.over || (!S.moves.length && hc > 0);
  $('bPause').hidden = !!S.over || !S.seats.some(isAI) || (hc > 0 && S.seats[S.pos.turn].type === 'human' && !S.paused);
  label($('bPause'), S.paused ? 'play' : 'pause', S.paused ? 'Resume' : 'Pause');
  const vsComputer = S.seats.some(P => P.type !== 'human') && hc > 0;
  $('bUndo').hidden = vsComputer && !$('allowUndo').checked;
  $('bHint').hidden = !$('allowHints').checked || !!S.over || !hc || S.viewPly != null || S.seats[S.pos.turn].type !== 'human';
  chatVisible();
  renderLive();
  renderHint();
  renderResult();
  drawClocks();
}
function animate(m, els) {
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
/* change an engine's strength in the middle of a game (same menus as the setup panel) */
const STRENGTH_SEL = {builtin: 'level', elo: 'elo', maia: 'maia', nodes: 'nodes', time: 'movetime'};
function renderLive() {
  const box = $('live'), rows = [];
  for (const i of [0, 1]) {
    const P = S.seats[i];
    if (!P || P.type !== 'engine') continue;
    const kind = engineEntry(P.engine || 'builtin')?.kind || 'builtin', k = STRENGTH_SEL[kind];
    if (k) rows.push([i, k]);
  }
  const key = rows.map(([i, k]) => i + k + S.seats[i].engine + $(k + i).options.length).join('|') + (S.over ? 'x' : '');
  if (box.dataset.key === key) {   /* just keep the values current */
    for (const s of box.querySelectorAll('select')) s.value = $(s.dataset.src).value;
    return;
  }
  box.dataset.key = key; box.innerHTML = '';
  box.hidden = !rows.length || !!S.over;
  for (const [i, k] of rows) {
    const src = $(k + i), s = el('select', {'data-src': k + i, 'aria-label': 'Strength'});
    for (const o of src.options) s.append(el('option', {value: o.value}, o.textContent));
    s.value = src.value;
    s.onchange = () => {
      src.value = s.value; saveSetup(); liveApply(i, k);
      toast(`${seatName(i)} now plays at about ${S.seats[i].rating || '?'}` + (k === 'movetime' ? '' : ' Elo'));
    };
    box.append(el('label', {class: 'liverow'}, el('span', {class: 'lv'}, el('span', {class: 'ic', html: ICONS['sliders-horizontal']}), (humanCount() === 1 ? 'Opponent' : SIDE[i]) + (k === 'movetime' ? ' think time' : ' strength')), s));
  }
}
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
    $('name' + pfx).textContent = seatName(c);
    $('rating' + pfx).textContent = P && P.rating ? `(${P.rating})` : '';
    $('badge' + pfx).textContent = P && P.illegal ? `${P.illegal} illegal` : '';
    const av = $('av' + pfx), type = P ? P.type : 'human', [ic, col] = avatarOf(P);
    if (av.dataset.key !== type + ic + col) {
      av.dataset.key = type + ic + col; av.className = 'avatar ' + type; av.innerHTML = ICONS[ic] || '';
      av.style.background = col || ''; av.style.color = col ? '#f3f0ea' : '';
    }
    av.title = {human: 'Human', engine: 'Chess engine', llm: 'AI model', agent: 'Agent'}[type] || '';
    $('name' + pfx).title = P && P.type === 'llm' ? P.model + ' @ ' + P.provider : '';
    $('strip' + pfx).classList.toggle('turn', !S.over && vp.turn === c);
    $('clock' + pfx).dataset.side = c;
  };
  fill('Top', S.flipped ? 0 : 1); fill('Bot', S.flipped ? 1 : 0);
}
/* [icon, colour] for a player card: each engine has its own picture, AI models a colour from their name */
function avatarOf(P) {
  if (!P || P.type === 'human') return ['user-fill', ''];
  if (P.type === 'agent') return ['sparkle-fill', ''];
  if (P.type === 'llm') {
    let h = 0; for (const ch of P.model || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ['robot-fill', `hsl(${h % 360} 32% 42%)`];
  }
  const id = P.engine || 'builtin', e = engineEntry(id) || {};
  const a = AVATAR[id] || AVATAR[e.catalog];
  if (a) return a;
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ['cpu-fill', `hsl(${h % 360} 25% 40%)`];
}
function renderMoves() {
  const mv = $('moves'); mv.innerHTML = '';
  const cur = curPly(), off = S.startPly & 1, base = S.startPly - off;
  if (!S.sans.length) mv.append(el('div', {class: 'empty'}, 'No moves yet.'));
  const img = isImageSet(SET.appearance.pieces);
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
      else if (idx < S.sans.length) mv.append(el('div', {class: 'm' + odd + (cur === idx + 1 ? ' cur' : '') + (S.sans[idx].endsWith('?!') ? ' free' : ''), onclick: () => goView(idx + 1)}, ...sanNode(S.sans[idx], (S.startPly + idx) & 1)));
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
const timed = side => !!S.clock && !!S.seats[side] && (S.seats[side].type === 'human' || S.clock.ai);
function fmtClock(ms) {
  ms = Math.max(0, ms);
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  if (ms < 10000) return `0:0${s}.${Math.floor(ms / 100) % 10}`;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
function drawClocks() {
  for (const pfx of ['Top', 'Bot']) {
    const e = $('clock' + pfx), side = +e.dataset.side;
    if (!S.clock || !S.pos || !timed(side)) { e.hidden = true; continue; }
    e.hidden = false;
    const ms = S.clock.ms[side], run = !S.over && !S.paused && S.pos.turn === side && S.moves.length > 0;
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
setInterval(() => {
  if (!S.clock || !S.pos) return;
  const now = performance.now(), dt = now - S.clock.last; S.clock.last = now;
  if (S.over || S.paused || S.inactive || SHOT || !S.moves.length) { drawClocks(); return; }
  const side = S.pos.turn;
  if (timed(side)) {
    S.clock.ms[side] -= dt;
    if (S.clock.ms[side] <= 0) {
      S.clock.ms[side] = 0;
      cancelThinking();
      finish(canMate(side ^ 1) ? {result: side ? '1-0' : '0-1', reason: 'timeout'} : {result: '1/2-1/2', reason: 'timeout against insufficient material'});
      render(); syncRelay(); return;
    }
  }
  drawClocks();
}, 100);

/* ================= result card ================= */
function renderResult() {
  const box = $('result');
  if (!S.over || S.resultClosed || S.viewPly != null) { box.hidden = true; return; }
  if (!box.hidden && box.dataset.game === String(S.gameId)) return;
  const o = S.over, w = o.result === '1-0' ? 0 : o.result === '0-1' ? 1 : -1, hum = [0, 1].filter(i => S.seats[i].type === 'human');
  let title = w < 0 ? 'Draw' : SIDE[w] + ' wins', ic = w < 0 ? 'handshake' : 'trophy';
  if (o.result === '*') { title = 'Game stopped'; ic = 'flag'; }
  else if (hum.length === 1 && w >= 0) { const won = S.seats[w].type === 'human'; title = won ? 'You won' : 'You lost'; ic = won ? 'trophy' : 'flag'; }
  const d = S.resultDelta;
  box.dataset.game = String(S.gameId);
  box.innerHTML = '';
  const card = el('div', {class: 'card'},
    el('div', {class: 'head'}, el('span', {class: 'ic'}), el('h2', {}, title), el('p', {}, o.result === '*' ? '' : 'by ' + o.reason)),
    d ? el('div', {class: 'delta'}, 'Your rating ', el('b', {}, String(d.rating)), ' ', el('span', {class: d.delta >= 0 ? 'up' : 'down'}, (d.delta >= 0 ? '+' : '') + d.delta)) : null,
    el('div', {class: 'btns'},
      el('button', {class: 'primary', onclick: () => startGame()}, 'Rematch'),
      el('button', {onclick: () => { S.resultClosed = true; showTab('new'); render(); }}, 'New game'),
      el('button', {onclick: () => { S.resultClosed = true; render(); }}, 'Review the game')));
  card.querySelector('.ic').innerHTML = ICONS[ic] || '';
  box.append(card);
  box.hidden = false;
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
  if (S.hint && S.viewPly == null) list.push({f: S.hint.f, t: S.hint.t, c: 'h'});
  if (adraw && adraw.to !== adraw.from) list.push({f: adraw.from, t: adraw.to, c: adraw.col, tmp: true});
  for (const a of list) {
    const {line, head} = arrowGeom(a.f, a.t, S.flipped), col = a.c === 'h' ? '#2f7fd8' : ARROW_COL[a.c];
    h += `<g opacity="${a.tmp ? .55 : .8}"><polyline points="${P(line)}" fill="none" stroke="${col}" stroke-width=".16" stroke-linejoin="round"/><polygon points="${P(head)}" fill="${col}"/></g>`;
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
  if (S.viewPly != null) { goView(null); return; }
  const p = S.pos.b[sq];
  if (canPremove()) {
    const me = humanSide(), mine = p && (p >> 3) === me;
    if (S.preSel >= 0 && !mine && sq !== S.preSel) { S.premove = {f: S.preSel, t: sq}; S.preSel = -1; render(); return; }
    if (mine) {
      const was = S.preSel === sq;
      S.premove = null; S.preSel = was ? -1 : sq; render();
      drag = {sq, pre: true, was, moved: false, x: e.clientX, y: e.clientY, ghost: null, pe: boardEl.querySelector('.pc[data-sq="' + sq + '"]')};
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
    const g = setPiece(el('div'), S.pos.b[drag.sq], 'ghost'); document.body.append(g); drag.ghost = g;
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
  if (d.pre) {
    const t = d.moved ? sqAt(e.clientX, e.clientY) : -1;
    if (t >= 0 && t !== d.sq && canPremove()) { S.premove = {f: d.sq, t}; S.preSel = -1; }
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
    legal: lu, board: ascii(p), clock: S.clock ? {base: S.clock.base, inc: S.clock.inc, ms: S.clock.ms, ai: S.clock.ai} : null,
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
    S.gameKey = d.gameKey || newKey(); S.replay = null;
    S.seats = d.seats.map(seatFrom).map(P => rate(P));
    S.clock = d.clock ? {...d.clock, ms: d.clock.ms.slice(), last: performance.now()} : null; S.resultClosed = false; S.variant = variant; S.c960 = c960; S.startFen = fen; S.startName = d.startName || ''; S.chaos = !!d.chaos;
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
$('tcAI').onchange = saveSetup;
$('bSwap').onclick = () => { swapSeats(); saveSetup(); applySeat(0); applySeat(1); };
$('bUndo').onclick = undo;
$('bFlip').onclick = () => { S.flipped = !S.flipped; render(); };
$('bResign').onclick = resign;
$('bPause').onclick = togglePause;
$('bHint').onclick = hint;
for (const id of ['allowHints', 'allowUndo']) $(id).onchange = () => { saveSetup(); render(); };
$('bFirst').onclick = () => goView(0);
$('bPrev').onclick = () => goView(curPly() - 1);
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
  if (e.key === 'ArrowLeft') { goView(curPly() - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goView(curPly() + 1); e.preventDefault(); }
  else if (e.key === 'Home') { goView(0); e.preventDefault(); }
  else if (e.key === 'End') { goView(null); e.preventDefault(); }
  else if (e.key === 'f' || e.key === 'F') { S.flipped = !S.flipped; render(); }
  else if (e.key === 'p' || e.key === 'P') { if (!$('bPause').hidden) togglePause(); }
  else if (e.key === 'h' || e.key === 'H') { if (!$('bHint').hidden) hint(); }
  else if (e.key === 'Escape') { clearSel(); cancelPremove(); $('promo').hidden = true; S.arrows = []; S.circles = []; shapesChanged(); render(); }
});
onSettings.changed = () => {
  S.chatOn = SET.chat.enabled !== false;
  for (const i of [0, 1]) { engineMenus(i); providerMenu(i); seatVis(i); }
  render();
};

/* ================= boot ================= */
Object.assign(hooks, {play, render, afterMove, schedule, sync: () => syncRelay(), history: renderHistory});
for (const e of document.querySelectorAll('[data-ic]')) e.insertAdjacentHTML('afterbegin', icon(e.dataset.ic));
(async () => {
  if (relayOK) { try { S.config = await api('/api/config'); } catch (e) {} }
  await loadSettings();
  S.chatOn = SET.chat.enabled !== false;
  preloadCanvasPieces();
  if (relayOK) { await refreshEngines(); if (!SHOT) await hello(); }
  buildSeat(0); buildSeat(1); buildTcPick();
  loadSetup();
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
