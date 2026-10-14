/* variant games: the second board for every variant beyond standard chess (Crazyhouse, Atomic, Duck chess,
   Capablanca, Xiangqi, Shogi and the rest). Rules from ffish, moves from Fairy-Stockfish, the variant bot or an AI
   model. A variant game takes over the stage while it lasts; your normal game waits, paused, behind it.
   GPL-3.0-or-later */
import {$, el, api, toast, esc} from './util.js';
import {icon} from './icons.js';
import {S, hooks, shortModel} from './state.js';
import {SET, saveSettings} from './settings.js';
import {getFF} from './ffish-load.js';
import {VARIANTS, GROUPS, byId, parseFen, splitMove, pieceNotes, sides, vrate, VSTART} from './variant-catalog.js';
import {VBOT_LEVELS} from './vbot-core.js';
import {VBoard, pieceEl} from './vboard.js';
import {llmRequest, stripThink} from './players.js';

let A = null;                 /* app helpers, from initVariants */
let ff = null, board = null;  /* the rules library and the game's position */
let vb = null;                /* the VBoard */
const V = {active: false, preview: null, vid: '', fen0: '', moves: [], sans: [], seats: [], clock: null, over: null, viewPly: null,
  flipped: false, key: '', token: 0, thinking: false, tourney: null, delta: null, league: null, resultClosed: false, last: null};

export const isFairy = vid => !!byId(vid);
export const vmode = () => V.active || !!V.preview;
export const yourVRating = vid => SET.variants.ratings[vid]?.r || VSTART;
export const vratingOf = vid => SET.variants.ratings[vid] || null;

export function initVariants(api_) {
  A = api_;
  vb = new VBoard($('vboard'), {onMove: u => humanMove(u), onRender: P => { const st = $('vstage').style; st.setProperty('--vf', P.files); st.setProperty('--vr', P.ranks); }});
  for (const [id, fn] of [['vFirst', () => go(0)], ['vPrev', () => go((V.viewPly ?? V.moves.length) - 1)], ['vNext', () => go((V.viewPly ?? V.moves.length) + 1)],
    ['vLast', () => go(V.moves.length)], ['vFlip', () => { V.flipped = !V.flipped; draw(); }], ['vFen', copyFen], ['vResign', resign], ['vLeave', leave]]) $(id).onclick = fn;
  hooks.vmode = vmode;
  hooks.vleave = () => { if (vmode()) leave(true); };
  hooks.vkey = key;
  setInterval(tick, 100);
}

/* ---------- loading ---------- */
async function rules() {
  if (!ff) ff = await getFF();
  return ff;
}
let botWorker = null, botReq = 0;
const botWait = new Map();
function bot() {
  if (botWorker) return botWorker;
  botWorker = new Worker(new URL('./vbot-worker.js', import.meta.url), {type: 'module'});
  botWorker.onmessage = e => { const d = e.data, r = botWait.get(d.id); if (r) { botWait.delete(d.id); r(d.res); } };
  botWorker.onerror = () => { for (const r of botWait.values()) r(null); botWait.clear(); botWorker = null; };
  return botWorker;
}
export function botMove(vid, fen, moves, level, maxMs) {
  const w = bot(), id = ++botReq;
  return new Promise(res => { botWait.set(id, res); w.postMessage({id, vid, fen, moves, level, maxMs}); });
}

/* ---------- players ---------- */
/* an installed engine that plays this variant (Fairy-Stockfish, big-board build for the big boards) */
export const variantEngine = vid => (S.engineList || []).find(e => (e.variants || []).includes(vid));
/* turn a seat from the setup into a variant player: engines that don't know the variant become the variant bot */
export function playerFrom(c, vid) {
  if (c.type === 'human') return {type: 'human'};
  if (c.type === 'llm' && c.model) return {type: 'llm', provider: c.provider, model: c.model, think: c.think || 'none'};
  if (c.type === 'vbot') return {type: 'vbot', level: c.level ?? 1};
  if (c.type === 'engine' && c.engine && c.engine !== 'builtin') {
    const e = (S.engineList || []).find(x => x.id === c.engine);
    if (e && (e.variants || []).includes(vid) && byId(vid).engine) return {type: 'engine', engine: e.id, elo: e.kind === 'elo' ? (c.elo || 0) : 0};
  }
  return {type: 'vbot', level: [0, 0, 1, 2, 2][c.level ?? 2] ?? 1};
}
function rateP(P, vid) {
  if (P.type === 'human') P.rating = yourVRating(vid);
  else if (P.type === 'vbot') P.rating = VBOT_LEVELS[P.level]?.elo || 900;
  else if (P.type === 'engine') P.rating = P.elo || 2700;
  else if (!P.rating) P.rating = 400 + Math.round(Math.random() * 130) * 10;
  return P;
}
export function pName(P, seats) {
  if (P.name && P.type !== 'human') return P.name;
  if (P.type === 'human') return (seats || V.seats).filter(x => x.type === 'human').length === 1 ? 'You' : 'Player';
  if (P.type === 'vbot') return 'Variant bot';
  if (P.type === 'engine') return ((S.engineList || []).find(e => e.id === P.engine)?.name || P.engine).replace(/\s+\d+(\.\d+)*(\s+(LB|XQ))?$/i, '').replace(/\s+(dev|v?\d[\w.\-]*)$/i, '');
  return shortModel(P);
}
const avatarP = P => P.type === 'vbot' ? {type: 'engine', engine: 'builtin', level: P.level} : P;

/* ---------- start, preview, leave ---------- */
/* the stage shows a variant's start position while you pick it in the Play hub */
export async function preview(vid) {
  if (V.active && !V.over) return;   /* a game is on: the picker changes the next one */
  await rules();
  V.preview = vid; V.active = false;
  const b = new ff.Board(vid);
  V.pfen = b.fen(); b.delete();
  enter();
  draw();
}
export function endPreview() {
  if (!V.preview) return;
  V.preview = null;
  if (!V.active) exit();
}
/* opts: {vid, seats: [setup seat 0, setup seat 1], tc: {base, inc} | null, llmFree, tourney: {tid, gid}} */
export async function start(opts) {
  const v = byId(opts.vid);
  if (!v) return;
  if (V.active && !V.over && V.moves.length) {   /* a game is still going: it ends here */
    if (!abandon()) return;
  }
  try { await rules(); } catch (e) { toast('The variant rules could not be loaded: ' + e.message); return; }
  V.token++;
  if (board) board.delete();
  board = new ff.Board(v.id);
  V.vid = v.id; V.fen0 = board.fen(); V.moves = []; V.sans = []; V.over = null; V.viewPly = null; V.delta = null; V.league = null; V.resultClosed = false;
  V.seats = opts.seats.map(c => rateP(playerFrom(c, v.id), v.id));
  V.clock = opts.tc ? {base: opts.tc.base, inc: opts.tc.inc, ms: [opts.tc.base, opts.tc.base], llmFree: !!opts.llmFree, t: 0} : null;
  V.tourney = opts.tourney || null;
  V.flipped = V.seats[1].type === 'human' && V.seats[0].type !== 'human';
  V.key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  V.last = null; V.preview = null; V.active = true;
  SET.variants.last = v.id; saveSettings();
  enter();
  save(); draw(); schedule();
}
function enter() {
  if (hooks.suspend) hooks.suspend();
  document.querySelector('.shell').classList.add('vmode');
  if (A.render) A.render();
  if (A.activeTab() === 'play') A.showTab('play');
}
function exit() {
  document.querySelector('.shell').classList.remove('vmode');
  $('vresult').hidden = true;
  if (A.activeTab() === 'play') A.showTab('play');
  if (A.render) A.render();
}
/* back to the normal board; a running variant game is stopped (or kept, for a quiet leave from code) */
/* end a running game: a resignation when you play one computer opponent, otherwise just stopped */
function abandon(quiet) {
  const hum = [0, 1].filter(human), counts = hum.length === 1 && V.moves.length >= 2;
  if (!quiet && !confirm(counts ? 'Leave the variant game you are playing? You resign it.' : 'Stop the variant game that is running?')) return false;
  finish(counts ? {result: hum[0] ? '1-0' : '0-1', reason: 'resignation'} : {result: '*', reason: 'stopped'});
  return true;
}
export function leave(quiet) {
  if (V.active && !V.over && V.moves.length && !abandon(quiet)) return;
  V.token++; V.active = false; V.preview = null; V.thinking = false;
  localStorage.removeItem('aichess.vgame');
  exit();
}

/* ---------- moving ---------- */
const human = side => V.seats[side] && V.seats[side].type === 'human';
const turn = () => board.turn() ? 0 : 1;
function legal() { return board.legalMoves().split(' ').filter(Boolean); }
function humanMove(u) {
  if (!V.active || V.over || V.viewPly != null || !human(turn())) return;
  play(u);
}
function play(u) {
  const legalNow = legal();
  if (!legalNow.includes(u)) { console.warn('variant: not legal', u); return false; }
  const sm = splitMove(u);
  let san = u;
  try { san = board.sanMove(u); } catch (e) {}
  const side = turn();
  board.push(u);
  V.moves.push(u); V.sans.push(san);
  V.last = sm ? {from: sm.from, to: sm.to, anim: true} : null;
  if (V.clock) {
    if (V.moves.length > 1 && timedSide(side)) V.clock.ms[side] += V.clock.inc;
    V.clock.t = performance.now();
  }
  if (A.sound) A.sound(board.isCheck() ? 'check' : sm && /x/.test(san) ? 'capture' : 'move');
  checkOver();
  save(); draw(); schedule();
  return true;
}
function checkOver() {
  if (V.over || !board.isGameOver(true)) return;
  const res = board.result(true), v = byId(V.vid);
  let reason;
  const n = board.numberLegalMoves();
  if (n === 0 && board.isCheck()) reason = 'checkmate';
  else if (n === 0) reason = res === '1/2-1/2' ? 'stalemate' : (v.win || 'no moves left');
  else if (res === '1/2-1/2') reason = board.isInsufficientMaterial() ? 'insufficient material' : board.halfmoveClock() >= 100 ? 'fifty-move rule' : 'repetition';
  else reason = v.win || 'the variant rule';
  finish({result: res, reason});
}
async function schedule() {
  if (!V.active || V.over || V.viewPly != null) return;
  const side = turn(), P = V.seats[side];
  if (P.type === 'human') return;
  const tok = ++V.token;
  V.thinking = true; draw();
  let u = null;
  try { u = await think(P, side, tok); } catch (e) { console.warn('variant move', e); }
  if (tok !== V.token || !V.active || V.over) return;
  V.thinking = false;
  const L = legal();
  if (!u || !L.includes(u)) { if (u) console.warn('variant: illegal answer', u); u = L[Math.floor(Math.random() * L.length)]; }
  /* a small pause so fast answers don't feel instant */
  setTimeout(() => { if (tok === V.token && V.active && !V.over) play(u); }, P.type === 'llm' ? 0 : 160);
}
async function think(P, side, tok) {
  const moves = V.moves.slice();
  if (P.type === 'engine') {
    /* a think time from the clock: Fairy-Stockfish budgets long variants (shogi) generously and would use 20 s a move */
    const ms = V.clock ? Math.max(300, Math.min(3000, V.clock.ms[side] / 40 + V.clock.inc * .7)) : 700;
    const r = await api('/api/engine/go', {engine: P.engine, game: 'v-' + V.key, variant: V.vid, chess960: false, fen: V.fen0, moves, movetime: Math.round(ms), elo: P.elo || null});
    return r.bestmove;
  }
  if (P.type === 'vbot') {
    const ms = V.clock ? Math.max(200, Math.min(1500, V.clock.ms[side] / 30 + V.clock.inc * .5)) : 1200;
    const r = await botMove(V.vid, V.fen0, moves, P.level, ms);
    return r && r.move;
  }
  if (P.type === 'llm') return llmMove(P, side, tok);
  return null;
}
/* an AI model: the rules, the board, the legal moves, three tries */
async function llmMove(P, side, tok) {
  const v = byId(V.vid), names = sides(V.vid), L = legal();
  const fen = board.fen(), Pf = parseFen(fen);
  const notes = pieceNotes(V.vid, V.fen0);
  const pockets = Pf.hasPocket ? `\nIn hand: ${names[0]} ${Pf.pockets[0].join('') || '-'}, ${names[1]} ${Pf.pockets[1].join('').toLowerCase() || '-'}` : '';
  /* duck chess has hundreds of move + duck pairs: list the moves and the duck squares apart */
  let list;
  if (L.length > 220 && L[0].includes(',')) {
    const mains = [...new Set(L.map(u => u.split(',')[0]))];
    list = `${mains.join(' ')}\nAfter your move, add a comma and the square the duck goes to, written as the piece's square followed by the duck's square, like e2e4,e4d5 (any empty square).`;
  } else list = L.join(' ');
  const sys = `You are playing ${v.name}, a chess variant, as ${names[side]} (${side ? 'lowercase' : 'uppercase'} letters). Rules: ${v.rules}`
    + (notes.length ? ` Pieces: ${notes.join('; ')}.` : '')
    + ` Answer with exactly one move from the list of legal moves, written as in the list, and nothing else.`;
  const msgs = [{role: 'system', content: sys}, {role: 'user', content: `Position (FEN): ${fen}${pockets}\nBoard (${names[0]} at the bottom, uppercase):\n${board.toString()}\nMoves so far: ${V.sans.join(' ') || 'none'}\nLegal moves: ${list}\nYour move as ${names[side]}:`}];
  const set = new Set(L), san = new Map();
  for (const u of L.slice(0, 400)) { try { san.set(board.sanMove(u).replace(/[+#]/g, ''), u); } catch (e) {} }
  for (let i = 0; i < 3; i++) {
    if (tok !== V.token) return null;
    const txt = stripThink(await llmRequest(P, msgs, null, {maxTokens: P.think && P.think !== 'none' ? undefined : 700, temperature: .4}));
    for (const t of txt.split(/[\s`'"(),.;:!?]+/).filter(Boolean)) {
      if (set.has(t)) return t;
      if (set.has(t.toLowerCase())) return t.toLowerCase();
      if (san.has(t.replace(/[+#!?]/g, ''))) return san.get(t.replace(/[+#!?]/g, ''));
    }
    /* "e2e4,d5" style duck answers */
    const m = /([a-l]\d{1,2}[a-l]\d{1,2}[a-z+]?)\s*,\s*([a-l]\d{1,2})(?:([a-l]\d{1,2}))?/.exec(txt);
    if (m) { const want = m[3] || m[2]; const hit = L.find(u => u.startsWith(m[1] + ',') && u.endsWith(want)); if (hit) return hit; }
    msgs.push({role: 'assistant', content: txt.slice(-300) || '?'}, {role: 'user', content: 'That is not one of the legal moves. Answer with one move from the list, exactly as written.'});
  }
  return null;
}

/* ---------- clock ---------- */
const timedSide = side => V.clock && !(V.clock.llmFree && V.seats[side]?.type === 'llm');
function tick() {
  if (!V.active || !V.clock) return;
  if (!V.over && V.moves.length > 0 && V.clock.t) {
    const now = performance.now(), side = turn(), dt = now - V.clock.t;
    V.clock.t = now;
    if (timedSide(side)) {
      V.clock.ms[side] = Math.max(0, V.clock.ms[side] - dt);
      if (V.clock.ms[side] <= 0) { V.token++; V.thinking = false; finish({result: side ? '1-0' : '0-1', reason: 'timeout'}); draw(); return; }
    }
  }
  drawClocks();
}
const fmtClock = ms => { const s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return ms < 10000 ? (ms / 1000).toFixed(1) : `${m}:${String(s % 60).padStart(2, '0')}`; };
function drawClocks() {
  for (const [pfx, side] of stripSides()) {
    const c = $('vClock' + pfx);
    if (!V.clock || !V.active) { c.hidden = true; continue; }
    c.hidden = false;
    const run = !V.over && V.moves.length > 0 && turn() === side && timedSide(side);
    c.textContent = timedSide(side) ? fmtClock(V.clock.ms[side]) : 'no clock';
    c.classList.toggle('run', run); c.classList.toggle('low', timedSide(side) && V.clock.ms[side] < 20000);
  }
}
const stripSides = () => V.flipped ? [['Top', 0], ['Bot', 1]] : [['Top', 1], ['Bot', 0]];

/* ---------- the end ---------- */
function finish(over) {
  if (V.over) return;
  V.over = over; V.thinking = false; V.token++;
  const hum = [0, 1].filter(human);
  const scoreFor = me => over.result === '1/2-1/2' ? .5 : (over.result === '1-0') === (me === 0) ? 1 : 0;
  if (hum.length === 1 && over.result !== '*' && V.moves.length >= 2) {
    const me = hum[0], opp = V.seats[me ^ 1], {next, delta} = vrate(SET.variants.ratings[V.vid], opp.rating || 1200, scoreFor(me));
    SET.variants.ratings[V.vid] = next;
    V.delta = {delta, rating: next.r};
    V.seats[me].rating = next.r;
    if (hooks.leagueGame) V.league = hooks.leagueGame({score: scoreFor(me), me: next.r, opp: opp.rating || 1200, tourney: !!V.tourney});
    saveSettings();
  }
  if (V.tourney && hooks.tourneyDone) hooks.tourneyDone(V.tourney, over, V.moves.slice());
  record(over);
  localStorage.removeItem('aichess.vgame');
  if (A.sound) A.sound('end');
}
function resign() {
  if (!V.active || V.over) return;
  const hum = [0, 1].filter(human);
  if (hum.length === 1) {
    if (!V.moves.length) { leave(true); return; }
    if (!confirm('Resign this game?')) return;
    finish({result: hum[0] ? '1-0' : '0-1', reason: 'resignation'});
  } else finish({result: '*', reason: 'stopped'});
  draw();
}
function pgnText(over) {
  const v = byId(V.vid), names = [0, 1].map(i => pName(V.seats[i]));
  let s = `[Event "AI Chess: ${v.name}"]\n[Variant "${v.name}"]\n[White "${names[0]}"]\n[Black "${names[1]}"]\n[FEN "${V.fen0}"]\n[Result "${over.result}"]\n\n`;
  V.sans.forEach((m, i) => { s += (i % 2 ? '' : (i / 2 + 1) + '. ') + m + ' '; });
  return s + over.result;
}
function record(over) {
  if (V.moves.length < 2 || over.result === '*') return;
  const w = over.result === '1-0' ? 0 : over.result === '0-1' ? 1 : -1;
  const rec = {id: V.key, date: Date.now(), result: over.result, reason: over.reason, winner: w < 0 ? null : pName(V.seats[w]), winnerSide: w,
    players: V.seats.map(P => ({name: pName(P), type: P.type === 'vbot' ? 'engine' : P.type, rating: P.rating || null, engine: P.type === 'vbot' ? 'builtin' : P.engine,
      level: P.type === 'vbot' ? [0, 2, 3][P.level] : undefined, model: P.model, provider: P.provider, elo: P.elo})),
    variant: 0, fairy: V.vid, startFen: V.fen0, startName: byId(V.vid).name, movesRaw: [], movesUci: V.moves.slice(), sans: V.sans.slice(), plies: V.moves.length,
    clock: V.clock ? {base: V.clock.base, inc: V.clock.inc, llmFree: V.clock.llmFree} : null, delta: V.delta, pgn: pgnText(over)};
  api('/api/history', {add: rec}).catch(() => {});
}

/* ---------- replay from the history ---------- */
export async function replay(g) {
  if (!byId(g.fairy)) { toast('This variant is not available'); return false; }
  await rules();
  V.token++;
  if (board) board.delete();
  board = g.startFen ? new ff.Board(g.fairy, g.startFen) : new ff.Board(g.fairy);
  for (const u of g.movesUci || []) board.push(u);
  V.vid = g.fairy; V.fen0 = g.startFen || (() => { const b = new ff.Board(g.fairy), f = b.fen(); b.delete(); return f; })(); V.moves = (g.movesUci || []).slice(); V.sans = (g.sans || V.moves).slice();
  V.seats = g.players.map(p => ({type: p.type === 'human' ? 'human' : p.type === 'llm' ? 'llm' : p.engine === 'builtin' ? 'vbot' : 'engine', engine: p.engine, model: p.model, provider: p.provider, level: 1, rating: p.rating, name: p.name}));
  if (!g.sans) { const b = new ff.Board(V.vid, V.fen0); V.sans = V.moves.map(u => { let x = u; try { x = b.sanMove(u); } catch (e) {} b.push(u); return x; }); b.delete(); }
  V.over = {result: g.result, reason: g.reason}; V.resultClosed = true; V.delta = g.delta; V.clock = null; V.tourney = null;
  V.flipped = g.players[1].type === 'human' && g.players[0].type !== 'human';
  V.viewPly = 0; V.active = true; V.preview = null; V.key = g.id; V.last = null;
  enter(); A.showTab('play'); draw();
  return true;
}

/* ---------- keeping a game over a reload ---------- */
function save() {
  if (!V.active || V.over) return;
  try { localStorage.setItem('aichess.vgame', JSON.stringify({vid: V.vid, fen0: V.fen0, moves: V.moves, sans: V.sans, seats: V.seats, clock: V.clock && {...V.clock, t: 0},
    flipped: V.flipped, key: V.key, tourney: V.tourney})); } catch (e) {}
}
export async function restore() {
  let d;
  try { d = JSON.parse(localStorage.getItem('aichess.vgame') || 'null'); } catch (e) { d = null; }
  if (!d || !byId(d.vid)) return;
  try { await rules(); } catch (e) { return; }
  board = new ff.Board(d.vid, d.fen0);
  try { for (const u of d.moves) board.push(u); } catch (e) { localStorage.removeItem('aichess.vgame'); return; }
  Object.assign(V, {vid: d.vid, fen0: d.fen0, moves: d.moves, sans: d.sans, seats: d.seats, clock: d.clock, flipped: d.flipped, key: d.key, tourney: d.tourney,
    over: null, viewPly: null, active: true, preview: null, delta: null, resultClosed: false, last: null});
  if (V.clock && V.moves.length) V.clock.t = performance.now();
  enter(); draw(); schedule();
}

/* ---------- navigation and keys ---------- */
function go(n) {
  if (!V.active) return;
  n = Math.max(0, Math.min(V.moves.length, n));
  V.viewPly = n >= V.moves.length ? null : n;
  if (V.viewPly == null && V.over) V.resultClosed = true;
  draw();
  if (V.viewPly == null) schedule();
}
function key(e) {
  if (!vmode() || /input|textarea|select/i.test(e.target.tagName)) return false;
  if (e.key === 'ArrowLeft') { go((V.viewPly ?? V.moves.length) - 1); return true; }
  if (e.key === 'ArrowRight') { go((V.viewPly ?? V.moves.length) + 1); return true; }
  if (e.key === 'Home') { go(0); return true; }
  if (e.key === 'End') { go(V.moves.length); return true; }
  if (e.key === 'f' || e.key === 'F') { V.flipped = !V.flipped; draw(); return true; }
  if (e.key === 'Escape') { vb.clear(); draw(); return true; }
  return false;
}
function copyFen() {
  const f = shownFen();
  navigator.clipboard?.writeText(f).then(() => toast('FEN copied'), () => toast(f));
}
function shownFen() {
  if (V.preview && !V.active) return V.pfen;
  if (V.viewPly == null) return board.fen();
  const b = new ff.Board(V.vid, V.fen0);
  for (let i = 0; i < V.viewPly; i++) b.push(V.moves[i]);
  const f = b.fen(); b.delete();
  return f;
}
function shownCheck() {
  if (V.viewPly != null || !V.active) return [];
  try { return board.checkedPieces().split(' ').filter(Boolean); } catch (e) { return []; }
}

/* ---------- drawing ---------- */
function draw() {
  if (!vmode()) return;
  const vid = V.active ? V.vid : V.preview, v = byId(vid), names = sides(vid);
  const live = V.active && V.viewPly == null && !V.over;
  const side = V.active ? turn() : 0;
  const lastMove = V.viewPly == null ? V.last : V.viewPly > 0 ? (() => { const s = splitMove(V.moves[V.viewPly - 1]); return s && {from: s.from, to: s.to}; })() : null;
  vb.set({vid, fen: shownFen(), legal: live && human(side) ? legal() : [], flipped: V.flipped, mine: live && human(side) ? side : -1,
    last: lastMove, check: shownCheck(), anim: lastMove && lastMove.anim ? lastMove : null});
  if (V.last) V.last.anim = false;
  /* player strips and pockets */
  const P = parseFen(shownFen());
  for (const [pfx, s] of stripSides()) {
    const strip = $('vStrip' + pfx), seat = V.active ? V.seats[s] : previewSeat(s);
    strip.classList.toggle('turn', V.active && !V.over && side === s);
    const av = $('vAv' + pfx);
    if (seat) A.paintAvatar(av, avatarP(seat), 'avatar');
    $('vName' + pfx).textContent = seat ? pName(seat, V.active ? V.seats : [previewSeat(0), previewSeat(1)]) + (seat.type === 'vbot' ? ' · ' + (VBOT_LEVELS[seat.level]?.name || '') : '') : names[s];
    $('vRating' + pfx).textContent = seat && seat.rating ? `(${seat.rating}${seat.type === 'human' && (vratingOf(vid)?.n || 0) < 5 ? '?' : ''})` : '';
    $('vSide' + pfx).textContent = names[s];
    const pk = $('vPocket' + pfx); pk.innerHTML = '';
    pk.hidden = !P.hasPocket;
    if (P.hasPocket) {
      const counts = new Map();
      for (const l of P.pockets[s]) counts.set(l, (counts.get(l) || 0) + 1);
      const mine = live && human(s) && side === s;
      for (const [l, n] of counts) {
        const pe = pieceEl(vid, s ? l.toLowerCase() : l, s, false, 'vp mini');
        const b = el('button', {type: 'button', class: 'pk' + (mine ? ' can' : '') + (vb.sel === l + '@' ? ' on' : ''), title: `Drop a ${pe.title || l}`, disabled: !mine}, pe, n > 1 ? el('i', {}, String(n)) : null);
        b.onclick = () => { vb.pickDrop(l); draw(); };
        pk.append(b);
      }
      if (!counts.size) pk.append(el('span', {class: 'pkempty'}, 'Nothing in hand'));
    }
  }
  drawClocks();
  drawPanel(v);
  drawResult();
}
function previewSeat(s) {
  const seats = A.previewSeats ? A.previewSeats() : null;
  if (!seats) return null;
  return rateP(playerFrom(seats[s], V.preview), V.preview);
}
function drawPanel(v) {
  $('vArt').src = `avatars/v-${v.id}.webp`;
  $('vArt').onerror = () => { $('vArt').src = 'avatars/mode-variants.webp'; };
  $('vTitle').textContent = v.name;
  const r = vratingOf(v.id);
  $('vMine').textContent = r ? `Your rating ${r.r}${r.n < 5 ? '?' : ''} · ${r.n} game${r.n === 1 ? '' : 's'}` : 'Not rated yet';
  $('vRules').textContent = v.rules;
  const notes = pieceNotes(v.id, V.active ? V.fen0 : V.pfen);
  $('vNotes').textContent = notes.length ? notes.join(' · ') : '';
  $('vNotes').hidden = !notes.length;
  const st = $('vStatus');
  if (!V.active) st.textContent = 'Start position. Press Play in the New game tab to begin.';
  else if (V.over) st.textContent = V.over.result === '*' ? 'Game stopped' : `${V.over.result === '1/2-1/2' ? 'Draw' : (V.over.result === '1-0' ? sides(v.id)[0] : sides(v.id)[1]) + ' won'} by ${V.over.reason}`;
  else if (V.viewPly != null) st.textContent = `Looking at move ${Math.ceil(V.viewPly / 2) || 0}. Press End to go back to the game.`;
  else {
    const s = turn(), P = V.seats[s];
    st.textContent = P.type === 'human' ? (V.seats.filter(x => x.type === 'human').length === 1 ? 'Your move' : sides(v.id)[s] + ' to move') : `${pName(P)} is thinking…`;
    if (board.isCheck() && P.type === 'human') st.textContent += '. Check';
  }
  /* the moves */
  const box = $('vMoves'); box.innerHTML = '';
  const cur = V.viewPly ?? V.moves.length;
  for (let i = 0; i < V.sans.length; i += 2) {
    const row = el('div', {class: 'vmrow'}, el('span', {class: 'n'}, (i / 2 + 1) + '.'));
    for (const k of [i, i + 1]) if (k < V.sans.length) row.append(el('button', {type: 'button', class: 'mv' + (k + 1 === cur ? ' on' : ''), onclick: () => go(k + 1)}, V.sans[k]));
    box.append(row);
  }
  if (!V.sans.length) box.append(el('div', {class: 'vmempty'}, V.active ? 'No moves yet.' : ''));
  const on = box.querySelector('.mv.on'); if (on) on.scrollIntoView({block: 'nearest'});
  $('vResign').hidden = !V.active || !!V.over;
  $('vResign').innerHTML = icon('flag') + `<span>${V.seats.filter(x => x.type === 'human').length ? 'Resign' : 'Stop'}</span>`;
  $('vLeave').innerHTML = icon('caret-left') + '<span>Back to the board</span>';
}
function drawResult() {
  const box = $('vresult');
  if (!V.active || !V.over || V.resultClosed || V.viewPly != null || V.over.result === '*') { box.hidden = true; return; }
  if (!box.hidden && box.dataset.key === V.key) return;
  const o = V.over, w = o.result === '1-0' ? 0 : o.result === '0-1' ? 1 : -1, hum = [0, 1].filter(human);
  let title = w < 0 ? 'Draw' : sides(V.vid)[w] + ' won';
  if (hum.length === 1 && w >= 0) title = human(w) ? 'You won' : 'You lost';
  const d = V.delta;
  box.dataset.key = V.key; box.innerHTML = '';
  const close = el('button', {class: 'x', title: 'Close', 'aria-label': 'Close', html: icon('x'), onclick: () => { V.resultClosed = true; draw(); }});
  const rating = d ? el('div', {class: 'rnum'}, el('b', {}, String(d.rating), el('span', {class: d.delta >= 0 ? 'up' : 'down'}, (d.delta >= 0 ? ' +' : ' ') + d.delta)), el('small', {}, byId(V.vid).name + ' rating')) : null;
  box.append(el('div', {class: 'card' + (title === 'You won' ? ' won' : '')}, close,
    el('div', {class: 'head'}, el('img', {class: 'vrart', src: `avatars/v-${V.vid}.webp`, alt: '', onerror: "this.style.display='none'"}), el('h2', {}, title), el('p', {}, o.reason === 'timeout' ? 'on time' : 'by ' + o.reason)),
    rating || V.league ? el('div', {class: 'rrow'}, rating, V.league ? el('div', {class: 'rnum rleague', title: 'Points for your weekly league'}, el('b', {}, '+' + V.league), el('small', {}, 'League')) : null) : null,
    el('div', {class: 'btns'}, el('div', {class: 'two'},
      el('button', {onclick: () => { V.resultClosed = true; draw(); A.showTab('new'); if (A.showMode) A.showMode('variants'); }}, 'Other variant'),
      V.tourney ? el('button', {class: 'primary', onclick: () => { V.resultClosed = true; leave(true); A.showTab('compete'); }}, 'Tournament')
        : el('button', {class: 'primary', onclick: () => rematch()}, 'Rematch')))));
  box.hidden = false;
  if (title === 'You won' && A.confetti) A.confetti($('vwrap'));
}
function rematch() {
  const seats = V.seats.slice().reverse().map(P => P.type === 'vbot' ? {type: 'vbot', level: P.level} : P.type === 'engine' ? {type: 'engine', engine: P.engine, elo: P.elo} : {...P});
  start({vid: V.vid, seats, tc: V.clock ? {base: V.clock.base, inc: V.clock.inc} : null, llmFree: V.clock?.llmFree});
}

/* ---------- the picker in the Play hub ---------- */
/* the variant grid: one card per variant with its picture and your rating, grouped */
export function pickerCards(cur, onPick) {
  const wrap = el('div', {class: 'vgroups'});
  for (const g of GROUPS) {
    const list = VARIANTS.filter(v => v.group === g.id);
    if (!list.length) continue;
    const grid = el('div', {class: 'vgrid'});
    for (const v of list) {
      const r = vratingOf(v.id), eng = !!variantEngine(v.id);
      grid.append(el('button', {type: 'button', class: 'vcard' + (cur === v.id ? ' on' : ''), role: 'radio', 'aria-checked': cur === v.id,
        title: v.name + ': ' + v.blurb + (v.engine ? (eng ? '' : ' (Fairy-Stockfish not installed for it: the variant bot plays)') : ' (no engine plays it: the variant bot or an AI model does)'),
        onclick: () => onPick(v.id)},
      el('img', {src: `avatars/v-${v.id}.webp`, alt: '', loading: 'lazy', onerror: "this.src='avatars/mode-variants.webp'"}),
      el('span', {class: 'vct'}, el('b', {}, v.name), el('small', {}, v.blurb)),
      r ? el('span', {class: 'vcr', title: 'Your rating in ' + v.name}, String(r.r)) : null));
    }
    wrap.append(el('h4', {class: 'vgh'}, g.name), grid);
  }
  return wrap;
}
export {V as vstate};
