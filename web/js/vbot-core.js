/* the variant bot: a small alpha-beta search on top of the rules library, for when Fairy-Stockfish is not installed
   (and for the few variants it does not play). It counts material, knows a few variant goals, and that is all:
   a beginner to club-level opponent. Runs in a worker (vbot-worker.js) and in node tests. GPL-3.0-or-later */
import {parseFen, pieceLook} from './variant-catalog.js';

export const VBOT_LEVELS = [
  {name: 'Easy', depth: 1, noise: 160, elo: 600},
  {name: 'Medium', depth: 2, noise: 50, elo: 900},
  {name: 'Hard', depth: 4, noise: 12, elo: 1200},
];
const VAL = {pawn: 100, knight: 300, bishop: 320, rook: 500, queen: 900, king: 0, archbishop: 800, chancellor: 850, amazon: 1200, centaur: 700,
  grasshopper: 250, nightrider: 450, cannon: 450, elephant: 250, ferz: 150, alfil: 120, khon: 250, wazir: 120, mann: 300, royalknight: 0, stone: 100};
const XQV = {chariot: 900, horse: 400, elephant: 200, advisor: 200, cannon: 450, soldier: 100, banner: 1500, general: 0};
const SGV = {pawn: 100, lance: 300, knight: 350, silver: 500, gold: 550, bishop: 800, rook: 1000, king: 0, tokin: 550, 'promoted lance': 550,
  'promoted knight': 550, 'promoted silver': 550, horse: 1050, dragon: 1250};
const DBV = {chick: 100, hen: 400, elephant: 300, giraffe: 400, lion: 0};
const MATE = 100000;

const memo = new Map();
function value(vid, l, promo) {
  const key = vid + l + (promo ? '+' : '');
  let v = memo.get(key);
  if (v == null) {
    const look = pieceLook(vid, l, l === l.toUpperCase() ? 0 : 1, promo);
    v = look.animal ? DBV[look.animal] ?? 200 : look.cjk ? (look.shogi ? SGV[look.name] : XQV[look.name]) ?? 200 : VAL[look.kind] ?? 300;
    memo.set(key, v);
  }
  return v;
}
/* score for the side to move */
export function evaluate(vid, fen) {
  const P = parseFen(fen);
  let s = 0;
  const sign = side => side === 0 ? 1 : -1;
  for (let r = 0; r < P.ranks; r++) for (let f = 0; f < P.files; f++) {
    const c = P.cells[r][f];
    if (!c || c.wall) continue;
    let v = value(vid, c.l, c.promo);
    const lower = c.l.toLowerCase();
    /* a little positional sense: central squares, advanced pawns, a few variant goals */
    const cf = Math.abs(f - (P.files - 1) / 2), cr = Math.abs(r - (P.ranks - 1) / 2), centre = 12 - 3 * (cf + cr);
    if (lower !== 'k') v += centre;
    const adv = c.side === 0 ? r : P.ranks - 1 - r;
    if (lower === 'p') v += adv * (vid === 'breakthrough' ? 40 : 6);
    if (lower === 'k' && vid === 'racingkings') v += adv * 120;
    if (lower === 'n' && vid === 'jesonmor') v += Math.max(0, 40 - 10 * (cf + cr));
    s += sign(c.side) * v;
  }
  for (const side of [0, 1]) for (const l of P.pockets[side]) s += sign(side) * value(vid, side ? l.toLowerCase() : l, false) * 1.1;
  if (vid === 'antichess') s = -s;   /* fewer pieces is better */
  return P.turn === 0 ? s : -s;
}
/* the game result for the side to move: 1 won, 0 lost, .5 draw, null still going */
function outcome(b) {
  if (!b.isGameOver(true)) return null;
  const r = b.result(true), white = b.turn();   /* turn(): true when White is to move */
  if (r === '1/2-1/2') return .5;
  return (r === '1-0') === white ? 1 : 0;
}
/* the best move for the position after `moves` from `fen` (or the variant's start); {move, score, depth} */
export function vbotMove(ff, vid, fen, moves, opts = {}) {
  const lv = VBOT_LEVELS[opts.level ?? 1] || VBOT_LEVELS[1];
  const b = fen ? new ff.Board(vid, fen) : new ff.Board(vid);
  try {
    if (moves && moves.length) b.pushMoves(moves.join(' '));
    const root = b.legalMoves().split(' ').filter(Boolean);
    if (!root.length) return null;
    if (root.length === 1) return {move: root[0], score: 0, depth: 0};
    const deadline = Date.now() + (opts.maxMs || 1500);
    let stop = false, nodes = 0;
    const order = list => list.map(m => [m, b.isCapture(m) ? 1 : 0]).sort((x, y) => y[1] - x[1]).map(x => x[0]);
    const search = (depth, alpha, beta, ply) => {
      if ((++nodes & 255) === 0 && Date.now() > deadline) stop = true;
      const o = outcome(b);
      if (o != null) return o === .5 ? 0 : o === 1 ? MATE - ply : -MATE + ply;
      if (depth <= 0) return evaluate(vid, b.fen());
      let best = -Infinity;
      for (const m of order(b.legalMoves().split(' ').filter(Boolean))) {
        b.push(m);
        const s = -search(depth - 1, -beta, -alpha, ply + 1);
        b.pop();
        if (stop) return 0;
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
      return best;
    };
    let ranked = order(root).map(m => ({m, s: 0})), done = 0;
    for (let d = 1; d <= lv.depth; d++) {
      const out = [];
      for (const r of ranked) {
        b.push(r.m);
        const s = -search(d - 1, -Infinity, Infinity, 1);
        b.pop();
        if (stop) break;
        out.push({m: r.m, s});
      }
      if (stop && out.length < ranked.length) { if (out.length) { const seen = new Set(out.map(x => x.m)); ranked = out.concat(ranked.filter(r => !seen.has(r.m))); } break; }
      ranked = out.sort((x, y) => y.s - x.s);
      done = d;
      if (Math.abs(ranked[0].s) > MATE - 1000) break;
    }
    /* noise for the easy levels: pick among moves that are close enough */
    let pick = ranked[0];
    if (lv.noise) {
      let bs = -Infinity;
      for (const r of ranked) { const n = r.s + (Math.random() * 2 - 1) * lv.noise; if (n > bs) { bs = n; pick = r; } }
    }
    return {move: pick.m, score: pick.s, depth: done, nodes};
  } finally { b.delete(); }
}
