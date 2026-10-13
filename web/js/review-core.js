/* game review without the page: move classes, accuracy, key moments, game phases and an estimated game rating.
   Everything here works from the engine's numbers only (no page, no network), so the tests can run it. GPL-3.0-or-later */
import * as C from './core.js';

/* the move classes, from best to worst, with the mark each one gets in the move list and on the board */
export const CLASSES = {
  brilliant: {name: 'Brilliant', glyph: '!!', col: '#3fb6a8'},
  great: {name: 'Great', glyph: '!', col: '#6a9fd8'},
  best: {name: 'Best', icon: 'star-fill', col: '#5fb85a'},
  excellent: {name: 'Excellent', icon: 'thumbs-up-fill', col: '#5fb85a'},
  good: {name: 'Good', icon: 'check', col: '#8fae7a'},
  book: {name: 'Book', icon: 'book-open-fill', col: '#a88b6a'},
  inaccuracy: {name: 'Inaccuracy', glyph: '?!', col: '#e0b443'},
  miss: {name: 'Miss', icon: 'x-bold', col: '#de6b7e'},
  mistake: {name: 'Mistake', glyph: '?', col: '#e3893c'},
  blunder: {name: 'Blunder', glyph: '??', col: '#d9483b'},
  illegal: {name: 'Illegal move', glyph: '???', col: '#b04fc4'},
  win: {name: 'Winning move', icon: 'crown-fill', col: '#d9a93a'},
};
/* the order of the table on the review screen */
export const TABLE = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'miss', 'mistake', 'blunder', 'illegal'];
/* the moves worth stopping at: the big swings and the ones that took skill */
export const KEY = ['brilliant', 'great', 'miss', 'mistake', 'blunder', 'illegal'];
/* your moves you can retry (and practise later) */
export const RETRY = ['inaccuracy', 'miss', 'mistake', 'blunder'];
const VAL = [0, 1, 3, 3, 5, 9, 0];

/* White's chance to win, 0-100, from an analysis {white (centipawns), mate} (the lichess curve) */
export function winPct(r) {
  if (!r) return 50;
  if (r.mate != null) return r.mate > 0 ? 100 : r.mate < 0 ? 0 : 50;
  const cp = Math.max(-1500, Math.min(1500, r.white || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const forSide = (w, side) => side ? 100 - w : w;
/* classify a move from the analysis before and after it: the drop in the mover's chance to win (as lichess does) */
export function classify(before, after, mover, move) {
  if (!before || !after) return null;
  if (move === before.best) return 'best';
  if ((before.white == null && before.mate == null) || (after.white == null && after.mate == null)) return null;   /* no score (opening book) */
  const drop = forSide(winPct(before), mover) - forSide(winPct(after), mover);
  if (drop < 2) return 'excellent';
  if (drop < 6) return 'good';
  if (drop < 12) return 'inaccuracy';
  if (drop < 22) return 'mistake';
  return 'blunder';
}
/* lichess move accuracy from the drop in win chance (0-100) */
export function moveAccuracy(before, after, mover) {
  const drop = forSide(winPct(before), mover) - forSide(winPct(after), mover);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669));
}
/* a sacrifice: a knight or more left where it can be taken for less (and nothing defends it), not a fair trade */
export function isSacrifice(prev, m, variant = 0, c960 = false) {
  const from = m & 127, to = (m >> 7) & 127, pc = prev.b[from], t = pc & 7;
  if (t < C.KNIGHT || t === C.KING || ((m >> 14) & 7)) return false;
  const victim = prev.b[to];
  if (victim && VAL[victim & 7] >= VAL[t]) return false;   /* an even or winning trade */
  let q; try { q = new C.Pos(prev.fen(), variant, c960); } catch (e) { return false; }
  q.make(m);
  const me = prev.turn;
  return q.isAttacked(to, me ^ 1) && !q.isAttacked(to, me);
}
/* accuracy over a list of move accuracies: the mean, pulled toward the harmonic mean so one blunder still shows */
export function accuracyOf(list) {
  if (!list.length) return null;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harm = list.length / list.reduce((a, b) => a + 1 / Math.max(1, b), 0);
  return (mean + harm) / 2;
}
/* a rough rating for how a game was played, from its accuracy (a fun estimate, rounded to 50) */
const RATING = [[0, 100], [30, 250], [40, 400], [50, 600], [60, 850], [70, 1150], [75, 1350], [80, 1550], [85, 1800], [90, 2100], [93, 2350], [96, 2650], [98, 2900], [100, 3100]];
export function gameRating(acc) {
  if (acc == null) return null;
  const a = Math.max(0, Math.min(100, acc));
  for (let i = 1; i < RATING.length; i++) {
    const [x1, y1] = RATING[i - 1], [x2, y2] = RATING[i];
    if (a <= x2) return Math.round((y1 + (a - x1) / (x2 - x1) * (y2 - y1)) / 50) * 50;
  }
  return 3100;
}
/* opening, middlegame or endgame for the position a move is played from */
export const PHASES = ['Opening', 'Middlegame', 'Endgame'];
export function phaseOf(pos, ply) {
  let mat = 0;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const t = pos.b[s] & 7; if (t > C.PAWN && t < C.KING) mat += VAL[t]; }
  if (mat <= 26) return 2;
  return ply < 20 ? 0 : 1;
}
/* the class that stands for an accuracy (the icon for a phase) */
export function accClass(acc) {
  if (acc == null) return null;
  return acc >= 95 ? 'best' : acc >= 85 ? 'excellent' : acc >= 75 ? 'good' : acc >= 60 ? 'inaccuracy' : acc >= 45 ? 'mistake' : 'blunder';
}
/* the position key the opening table uses: placement, side to move, castling */
export const epd3 = p => p.fen().split(' ').slice(0, 3).join(' ');
/* book moves from the start and the name of the opening reached. The table names positions, not every move of theory, so a short
   gap between two named positions (up to 3 plies) is still book; a longer one ends it. */
export function openingOf(game, table) {
  const out = {book: 0, name: null, eco: null, ply: 0};
  if (!table || game.variant || game.c960 || game.startFen !== C.START_FEN) return out;
  const p = new C.Pos(C.START_FEN, 0, false);
  let inBook = true;
  for (let k = 1; k <= Math.min(game.moves.length, 40); k++) {
    p.make(game.moves[k - 1]);
    const i = table.pos[epd3(p)];
    if (i == null) { if (k - out.book > 3) inBook = false; continue; }
    if (inBook) out.book = k;
    const nm = table.names[i];
    out.eco = nm.slice(0, 3); out.name = nm.slice(4); out.ply = k;
  }
  return out;
}
/* the analysis of a finished position (no moves left, so the engine has nothing to say): mate is a win, the rest a draw */
export function finalEval(p) {
  if (p.legalMoves().length) return null;
  return p.inCheck() ? {white: null, mate: p.turn ? 1 : -1, best: 0, pv: []} : {white: 0, mate: null, best: 0, pv: []};
}

/* the whole review of a game.
   game: {startFen, variant, c960, moves, sans}; res[k]: the analysis of the position after k plies (res[0] = the start);
   book: the number of opening-book plies from the start.
   Returns per ply k (1..n): cls, best (SAN), played; plus the counts, accuracy, estimated rating and phases per side, the key moments
   and White's win chance after every ply (for the graph). */
export function reviewOf(game, res, book = 0) {
  const n = game.moves.length, p = new C.Pos(game.startFen, game.variant, game.c960);
  const plies = [null], counts = [{}, {}], accs = [[], []], phaseAcc = [[[], [], []], [[], [], []]], keys = [], wins = [winPct(res[0])];
  for (let k = 1; k <= n; k++) {
    const m = game.moves[k - 1], mover = p.turn, before = res[k - 1], phase = phaseOf(p, k - 1);
    const best = before && before.best ? p.san(before.best).replace(/\?!$/, '') : '';
    const sac = (m >> 17) & C.FL_FREE ? false : isSacrifice(p, m, game.variant, game.c960);
    const played = game.sans[k - 1].replace(/\?!$/, '');
    p.make(m);
    const after = res[k] || finalEval(p);
    wins[k] = after ? winPct(after) : wins[k - 1];
    let cls;
    if ((m >> 17) & C.FL_FREE) cls = 'illegal';
    else if (k <= book) cls = 'book';
    else {
      cls = classify(before, after, mover, m);
      const prevCls = plies[k - 1]?.cls, wb = before ? forSide(winPct(before), mover) : 50, wa = after ? forSide(winPct(after), mover) : 50;
      if (cls === 'best' && sac && wa >= 45 && wb < 90) cls = 'brilliant';
      else if (cls === 'best' && ['mistake', 'blunder', 'miss'].includes(prevCls)) cls = 'great';   /* punished the opponent's slip */
      else if ((cls === 'inaccuracy' || cls === 'mistake') && ['mistake', 'blunder'].includes(prevCls) && wb >= 60) cls = 'miss';   /* let it go */
      if (cls && before && after) { const a = moveAccuracy(before, after, mover); accs[mover].push(a); phaseAcc[mover][phase].push(a); }
    }
    plies[k] = cls ? {cls, best, played, mover, phase, drop: before && after ? forSide(winPct(before), mover) - forSide(winPct(after), mover) : 0} : {cls: null, best, played, mover, phase, drop: 0};
    if (cls) counts[mover][cls] = (counts[mover][cls] || 0) + 1;
    if (KEY.includes(cls)) keys.push(k);
  }
  const acc = accs.map(accuracyOf);
  /* the estimated rating needs enough moves to mean anything */
  const rating = acc.map((a, i) => accs[i].length >= 8 ? gameRating(a) : null);
  return {plies, counts, acc, rating, rated: accs.map(l => l.length), phases: phaseAcc.map(side => side.map(l => accClass(accuracyOf(l)))), keys, wins};
}
