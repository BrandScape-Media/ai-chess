/* live analysis for the assistance options: evaluation bar, move feedback, suggestion and threat arrows, engine line.
   Uses Stockfish (or another Elo-capable engine) through the server in its own process slot, else the built-in engine
   in a separate web worker. Results are cached per position. GPL-3.0-or-later */
import * as C from './core.js';
import {S, VARIANT_UCI} from './state.js';
import {api} from './util.js';
import {sane} from './players.js';
import {isSacrifice as sac} from './review-core.js';

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
/* analyse a position; resolves {white, mate, best (move number for p), pv, by, depth} or null.
   depth: search that deep (Stockfish or another installed engine), stopping after ms at the latest; without depth, ms per position.
   Results are cached per position; a deeper result answers a quicker request too. */
export async function analyze(p, ms = 350, depth = 0) {
  const key = p.fen() + '|' + S.variant, want = depth * 1e5 + ms;
  const hit = cache.get(key);
  if (hit && hit.q >= want) return hit.r;
  if (!p.legalMoves().length || !sane(p)) return null;
  let out = null;
  const e = engineFor();
  if (e) {
    try {
      const r = await api('/api/engine/go', {engine: e.id, game: 'analysis', slot: 'analysis', variant: VARIANT_UCI[S.variant], chess960: S.c960, fen: uciFen(p), moves: [],
        ...(depth ? {depth, movetime: ms} : {movetime: ms})});
      const i = r.info || {}, sgn = p.turn === 0 ? 1 : -1, best = p.fromUci(r.bestmove || '');
      if (best) out = {white: i.cp != null ? i.cp * sgn : null, mate: i.mate != null ? i.mate * sgn : null, best, pv: i.pv || [], by: e.name, depth: i.depth || 0};
    } catch (err) { /* fall back to the built-in engine */ }
  }
  if (!out) {
    if (hit) return hit.r;   /* no engine for a deeper look: the quick answer stays */
    const r = await builtin(p.fen(), Math.max(200, Math.min(ms, 1500)));
    if (r && r.move) out = {white: r.mate != null ? null : r.score, mate: r.mate, best: r.move, pv: [], by: 'built-in engine', depth: 0};
  }
  if (out) {
    cache.set(key, {r: out, q: out.by === 'built-in engine' ? Math.min(want, 1500) : want});
    if (cache.size > 1500) cache.delete(cache.keys().next().value);
  }
  return out;
}
/* the engine the analysis uses (null: the built-in one) */
export function analysisEngine() { return engineFor(); }
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

/* move classes and win chances live in review-core.js (no page needed there, so the tests can use them) */
export {winPct, classify, moveAccuracy, CLASSES} from './review-core.js';
/* a sacrifice in the current game (see review-core.js) */
export const isSacrifice = (prev, m) => sac(prev, m, S.variant, S.c960);
export function fmtEval(r) {
  if (!r) return '';
  if (r.mate != null) return 'M' + Math.abs(r.mate);
  const v = (r.white || 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
