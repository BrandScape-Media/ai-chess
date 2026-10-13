/* live analysis for the assistance options: evaluation bar, move feedback, suggestion and threat arrows, engine line.
   Uses Stockfish (or another Elo-capable engine) through the server in its own process slot, else the built-in engine
   in a separate web worker. Results are cached per position. GPL-3.0-or-later */
import * as C from './core.js';
import {S, VARIANT_UCI} from './state.js';
import {api} from './util.js';
import {sane} from './players.js';

const cache = new Map();   /* fen -> {white, mate, best, pv} (white = centipawns from White's side) */
let worker = null, wid = 0;
const pending = new Map();

function builtin(fen, ms = 450) {
  return new Promise(resolve => {
    if (!worker) {
      worker = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module'});
      worker.onmessage = e => { const d = e.data; if (!d.done) return; const r = pending.get(d.id); if (r) { pending.delete(d.id); r(d.res); } };
      worker.onerror = () => { for (const r of pending.values()) r(null); pending.clear(); worker = null; };
    }
    const id = ++wid; pending.set(id, resolve);
    worker.postMessage({id, fen, variant: S.variant, c960: S.c960, moves: [], level: 3, maxMs: ms});
  });
}
function engineFor() {
  const v = VARIANT_UCI[S.variant];
  const list = (S.engineList || []).filter(e => (e.kind === 'elo' || e.kind === 'time') && (e.variants || ['chess']).includes(v) && (!S.c960 || e.chess960));
  /* steadiest evaluations first */
  const pref = ['stockfish', 'obsidian', 'caissa', 'berserk', 'clover', 'halogen', 'koivisto', 'fairy-stockfish', 'seer', 'velvet', 'weiss', 'altair', 'arasan', 'fabchess'];
  return list.sort((a, b) => ((pref.indexOf(a.catalog || a.id) + 1) || 99) - ((pref.indexOf(b.catalog || b.id) + 1) || 99))[0] || null;
}
/* the side to move's FEN, with the three-check field the UCI engines expect */
function uciFen(p) {
  const t = p.fen().split(' ');
  if (S.variant === C.V_3CHECK) t.splice(4, 0, `${Math.max(0, 3 - p.checks[0])}+${Math.max(0, 3 - p.checks[1])}`);
  return t.join(' ');
}
/* analyse a position; resolves {white, mate, best (move number for p), pv} or null */
export async function analyze(p, ms = 350) {
  const key = p.fen() + '|' + S.variant;
  if (cache.has(key)) return cache.get(key);
  if (!p.legalMoves().length || !sane(p)) return null;
  let out = null;
  const e = engineFor();
  if (e) {
    try {
      const r = await api('/api/engine/go', {engine: e.id, game: 'analysis', slot: 'analysis', variant: VARIANT_UCI[S.variant], chess960: S.c960, fen: uciFen(p), moves: [], movetime: ms});
      const i = r.info || {}, sgn = p.turn === 0 ? 1 : -1, best = p.fromUci(r.bestmove || '');
      if (best) out = {white: i.cp != null ? i.cp * sgn : null, mate: i.mate != null ? i.mate * sgn : null, best, pv: i.pv || [], by: e.name};
    } catch (err) { /* fall back to the built-in engine */ }
  }
  if (!out) {
    const r = await builtin(p.fen(), Math.max(200, ms));
    if (r && r.move) out = {white: r.mate != null ? null : r.score, mate: r.mate, best: r.move, pv: [], by: 'built-in engine'};
  }
  if (out) { cache.set(key, out); if (cache.size > 400) cache.delete(cache.keys().next().value); }
  return out;
}
/* the opponent's best move if it were their turn now (null move), for threat arrows */
export async function threat(p) {
  if (p.inCheck()) return null;
  const t = p.fen().split(' ');
  t[1] = t[1] === 'w' ? 'b' : 'w'; t[3] = '-';
  let q;
  try { q = new C.Pos(t.join(' '), S.variant, S.c960); } catch (e) { return null; }
  if (q.isAttacked(q.ksq[q.turn ^ 1], q.turn)) return null;
  const r = await analyze(q, 250);
  if (!r) return null;
  /* only real threats: a capture or a check (a quiet "best move" isn't a threat) */
  const m = r.best, cap = (m >> 17) & 1;
  q.make(m); const chk = q.inCheck(); q.unmake();
  return cap || chk ? {f: m & 127, t: (m >> 7) & 127} : null;
}

/* Lichess win chance (0-100) for White from an evaluation */
export function winPct(r) {
  if (!r) return 50;
  if (r.mate != null) return r.mate > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, r.white || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
/* classify a move from the analysis before and after it (win-chance drop for the mover, as lichess does) */
export const CLASSES = {
  brilliant: {name: 'Brilliant', glyph: '!!', col: '#3fb6a8'},
  great: {name: 'Great', glyph: '!', col: '#6a9fd8'},
  best: {name: 'Best move', icon: 'star-fill', col: '#5fb85a'},
  excellent: {name: 'Excellent', icon: 'thumbs-up-fill', col: '#5fb85a'},
  good: {name: 'Good', icon: 'check', col: '#8fae7a'},
  inaccuracy: {name: 'Inaccuracy', glyph: '?!', col: '#e0b443'},
  mistake: {name: 'Mistake', glyph: '?', col: '#e3893c'},
  blunder: {name: 'Blunder', glyph: '??', col: '#d9483b'},
  illegal: {name: 'Illegal move', glyph: '???', col: '#b04fc4'},
  win: {name: 'Winning move', icon: 'crown-fill', col: '#d9a93a'},
};
export function classify(before, after, mover, move) {
  if (!before || !after) return null;
  if (move === before.best) return 'best';
  if ((before.white == null && before.mate == null) || (after.white == null && after.mate == null)) return null;   /* no score (opening book) */
  const sgn = mover === 0 ? 1 : 0;
  const wb = sgn ? winPct(before) : 100 - winPct(before), wa = sgn ? winPct(after) : 100 - winPct(after);
  const drop = wb - wa;
  if (move === before.best) return 'best';
  if (drop < 2) return 'excellent';
  if (drop < 6) return 'good';
  if (drop < 12) return 'inaccuracy';
  if (drop < 22) return 'mistake';
  return 'blunder';
}
/* lichess move accuracy from the drop in win chance (0-100) */
export function moveAccuracy(before, after, mover) {
  const wb = mover === 0 ? winPct(before) : 100 - winPct(before), wa = mover === 0 ? winPct(after) : 100 - winPct(after);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, wb - wa)) - 3.1669));
}
/* a "brilliant" move is a sound sacrifice: the best move, it leaves a piece (knight or more) hanging, and you are not losing after it */
export function isSacrifice(prev, m) {
  const from = m & 127, to = (m >> 7) & 127, pc = prev.b[from], t = pc & 7;
  if (t < C.KNIGHT || t === C.KING || ((m >> 14) & 7)) return false;
  const victim = prev.b[to];
  let q; try { q = new C.Pos(prev.fen(), S.variant, S.c960); } catch (e) { return false; }
  if (victim && [0, 1, 3, 3, 5, 9][victim & 7] >= [0, 1, 3, 3, 5, 9][t]) return false;   /* an even or winning trade */
  q.make(m);
  const me = prev.turn;
  return q.isAttacked(to, me ^ 1) && !q.isAttacked(to, me);
}
export function fmtEval(r) {
  if (!r) return '';
  if (r.mate != null) return 'M' + Math.abs(r.mate);
  const v = (r.white || 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
