/* historical "engines" that run in the browser. GPL-3.0-or-later

   Turochamp: the paper machine Alan Turing and David Champernowne wrote in 1948, before any computer could run it.
   Turing played it by hand in 1952, taking about half an hour per move. Rules as described by Turing:
   - look at every move and every reply (2 plies), then keep following "considerable" moves (captures) until the position is quiet;
   - pick the move with the best material ratio (own material / opponent's, P=1 N=3 B=3.5 R=5 Q=10);
   - ties are broken by "position play" for the side that moved: mobility (square root of the moves, captures counting double),
     defended pieces, king mobility and safety, castling, pawn advances and defended pawns, giving check.
   Random mover: picks any legal move. */
import * as C from './core.js';

const TV = [0, 1, 3, 3.5, 5, 10, 0];
const N_D = [-33, -31, -18, -14, 14, 18, 31, 33], K_D = [-17, -16, -15, -1, 1, 15, 16, 17], B_D = [-17, -15, 15, 17], R_D = [-16, -1, 1, 16];

function material(p, c) {
  let m = 0;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = p.b[s]; if (q && (q >> 3) === c) m += TV[q & 7]; }
  return m;
}
/* material ratio from the point of view of `us`; mate is decisive */
function ratio(p, us) {
  const them = material(p, us ^ 1);
  return them ? material(p, us) / them : 50 + material(p, us);
}
/* how many pieces of colour c attack sq */
function attackers(p, sq, c) {
  const b = p.b; let n = 0, s;
  const pd = c ? [15, 17] : [-15, -17];
  for (const d of pd) { s = sq + d; if (!(s & 0x88) && b[s] === ((c << 3) | C.PAWN)) n++; }
  for (const d of N_D) { s = sq + d; if (!(s & 0x88) && b[s] === ((c << 3) | C.KNIGHT)) n++; }
  for (const d of K_D) { s = sq + d; if (!(s & 0x88) && b[s] === ((c << 3) | C.KING)) n++; }
  for (const [dirs, a, q] of [[B_D, C.BISHOP, C.QUEEN], [R_D, C.ROOK, C.QUEEN]])
    for (const d of dirs) { s = sq + d; while (!(s & 0x88)) { const x = b[s]; if (x) { if (x === ((c << 3) | a) || x === ((c << 3) | q)) n++; break; } s += d; } }
  return n;
}
/* mobility of the piece on sq (captures count as two), or of a queen standing there when asQueen */
function mobility(p, sq, asQueen) {
  const b = p.b, x = b[sq], c = x >> 3, t = asQueen ? C.QUEEN : x & 7;
  let n = 0;
  const step = (to) => { if (to & 0x88) return false; const y = b[to]; if (!y) { n++; return true; } if ((y >> 3) !== c) n += 2; return false; };
  if (t === C.KNIGHT) N_D.forEach(d => step(sq + d));
  else if (t === C.KING) K_D.forEach(d => step(sq + d));
  else {
    const dirs = t === C.BISHOP ? B_D : t === C.ROOK ? R_D : K_D;
    for (const d of dirs) { let to = sq + d; while (step(to)) to += d; }
  }
  return n;
}
/* Turing's "position play" value for colour c */
function positionPlay(p, c, castled) {
  let v = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const x = p.b[s]; if (!x || (x >> 3) !== c) continue;
    const t = x & 7;
    if (t === C.PAWN) {
      const adv = c ? 6 - (s >> 4) : (s >> 4) - 1;
      v += 0.2 * adv;
      /* defended by a piece that is not a pawn */
      const pawnDef = (c ? [15, 17] : [-15, -17]).some(d => !((s + d) & 0x88) && p.b[s + d] === ((c << 3) | C.PAWN));
      const def = attackers(p, s, c);
      if (def > (pawnDef ? 1 : 0)) v += 0.3;
    } else if (t === C.KING) {
      v += Math.sqrt(mobility(p, s)) - Math.sqrt(mobility(p, s, true));
    } else {
      v += Math.sqrt(mobility(p, s));
      if (t !== C.QUEEN) { const d = attackers(p, s, c); if (d) v += d > 1 ? 1.5 : 1; }
    }
  }
  if (p.castle & (c ? 12 : 3)) v += 1;
  if (castled) v += 1;
  if (p.turn !== c && p.inCheck()) v += 0.5;
  return v;
}
/* Turing's "considerable" moves: recaptures, captures of undefended pieces, and captures of a piece worth more than the capturer */
function considerable(p, m, last) {
  if (!((m >> 17) & 1)) return false;
  const from = m & 127, to = (m >> 7) & 127, victim = p.b[to];
  if (!victim) return true;   /* en passant */
  if (to === last) return true;
  if (TV[victim & 7] > TV[p.b[from] & 7]) return true;
  return attackers(p, to, victim >> 3) === 0;
}
/* material ratio for `us` after following considerable moves until the position is "dead" */
function quiet(p, us, depth, last) {
  const ml = p.legalMoves();
  if (!ml.length) return p.inCheck() ? (p.turn === us ? 0 : 1000) : 1;
  let best = ratio(p, us);
  if (depth <= 0) return best;
  const mine = p.turn === us;
  /* the side to move may also decline to capture */
  for (const m of ml) {
    if (!considerable(p, m, last)) continue;
    p.make(m); const v = quiet(p, us, depth - 1, (m >> 7) & 127); p.unmake();
    if (mine ? v > best : v < best) best = v;
  }
  return best;
}
export function turochamp(p) {
  const us = p.turn, ml = p.legalMoves();
  if (!ml.length) return null;
  const scored = [];
  for (const m of ml) {
    p.make(m);
    let worst = Infinity;
    const replies = p.legalMoves();
    if (!replies.length) worst = p.inCheck() ? 1000 : 1;
    for (const r of replies) {
      p.make(r); const v = quiet(p, us, 4, (r >> 7) & 127); p.unmake();
      if (v < worst) worst = v;
      if (worst <= 0) break;
    }
    const pp = positionPlay(p, us, !!((m >> 17) & C.FL_CASTLE));
    p.unmake();
    scored.push({m, v: worst, pp});
  }
  const top = Math.max(...scored.map(s => s.v));
  const cands = scored.filter(s => s.v >= top - 1e-9).sort((a, b) => b.pp - a.pp);
  const best = cands[0];
  return {move: best.m, score: Math.round((best.v - 1) * 300), depth: 2, nodes: scored.length, ms: 0};
}
export function randomMove(p) {
  const ml = p.legalMoves();
  return ml.length ? {move: ml[Math.floor(Math.random() * ml.length)], score: 0, depth: 0, nodes: 1, ms: 0} : null;
}
export const BOTS = {
  turochamp: {name: 'Turochamp (1948)', fn: turochamp, elo: 800, about: 'Alan Turing and David Champernowne\'s paper machine, the first chess program ever written'},
  random: {name: 'Random mover', fn: randomMove, elo: 250, about: 'plays any legal move'},
};
