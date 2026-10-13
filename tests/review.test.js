// Game review logic (web/js/review-core.js): move classes, accuracy, openings, phases, estimated rating.
import * as C from '../web/js/core.js';
import {readFileSync} from 'fs';
import {classify, winPct, gameRating, reviewOf, openingOf, phaseOf, finalEval, accuracyOf, accClass} from '../web/js/review-core.js';

let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
}
/* a game from SAN moves: {startFen, moves, sans} */
function game(sans, fen = C.START_FEN) {
  const p = new C.Pos(fen, 0, false), moves = [], out = [];
  for (const s of sans) {
    const m = p.legalMoves().find(x => p.san(x).replace(/[+#]$/, '') === s.replace(/[+#]$/, ''));
    if (!m) throw new Error('no move ' + s);
    out.push(p.san(m)); moves.push(m); p.make(m);
  }
  return {startFen: fen, variant: 0, c960: false, moves, sans: out};
}
const mv = (fen, san) => { const p = new C.Pos(fen, 0, false); return p.legalMoves().find(x => p.san(x).replace(/[+#]$/, '') === san); };
const fenAfter = (G, k) => { const p = new C.Pos(G.startFen, 0, false); for (let i = 0; i < k; i++) p.make(G.moves[i]); return p.fen(); };

// ---- win chance and classes ----
check('winPct even', Math.round(winPct({white: 0})), 50);
check('winPct mate for White', winPct({mate: 3}), 100);
check('winPct mate for Black', winPct({mate: -2}), 0);
check('classify best move', classify({white: 20, best: 7}, {white: 20}, 0, 7), 'best');
check('classify small drop', classify({white: 20, best: 1}, {white: 10}, 0, 2), 'excellent');
check('classify blunder (White)', classify({white: 50, best: 1}, {white: -600}, 0, 2), 'blunder');
check('classify blunder (Black)', classify({white: -50, best: 1}, {white: 600}, 1, 2), 'blunder');
check('classify needs a score', classify({white: null, mate: null, best: 1}, {white: 10}, 0, 2), null);

// ---- accuracy and the estimated rating ----
check('accuracy of nothing', accuracyOf([]), null);
check('one blunder pulls accuracy down', accuracyOf([100, 100, 100, 10]) < 75, true);
check('game rating 50%', gameRating(50), 600);
check('game rating 100%', gameRating(100), 3100);
let mono = true; for (let a = 0, last = -1; a <= 100; a += 0.5) { const r = gameRating(a); if (r < last) mono = false; last = r; }
check('game rating rises with accuracy', mono, true);
check('accClass', [accClass(97), accClass(80), accClass(30), accClass(null)], ['best', 'good', 'blunder', null]);

// ---- a whole review: 1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? Nxe5 ----
const G = game(['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5']);
const res = [
  {white: 30, mate: null, best: mv(fenAfter(G, 0), 'e4'), pv: []},
  {white: 30, mate: null, best: mv(fenAfter(G, 1), 'e5'), pv: []},
  {white: 30, mate: null, best: mv(fenAfter(G, 2), 'Nf3'), pv: []},
  {white: 10, mate: null, best: mv(fenAfter(G, 3), 'Nc6'), pv: []},
  {white: 0, mate: null, best: mv(fenAfter(G, 4), 'Bc4'), pv: []},
  {white: -750, mate: null, best: mv(fenAfter(G, 5), 'Nxe5'), pv: []},
  {white: -760, mate: null, best: mv(fenAfter(G, 6), 'd4'), pv: []},
];
const R = reviewOf(G, res, 2);
check('book plies', [R.plies[1].cls, R.plies[2].cls], ['book', 'book']);
check('Qh5 is not best', ['excellent', 'good', 'inaccuracy'].includes(R.plies[3].cls), true);
check('Nc6 is best', R.plies[4].cls, 'best');
check('Qxe5+ is a blunder', R.plies[5].cls, 'blunder');
check('Nxe5 punishes it: great', R.plies[6].cls, 'great');
check('best move named', R.plies[5].best, 'Bc4');
check('key moments', R.keys, [5, 6]);
check('counts per side', [R.counts[0].blunder, R.counts[1].great], [1, 1]);
check('Black more accurate', R.acc[1] > R.acc[0], true);
check('no game rating from 2 moves', R.rating, [null, null]);
check('graph starts even-ish and ends lost for White', [R.wins[0] > 50, R.wins[6] < 10], [true, true]);

// ---- a miss: the opponent blunders and the reply lets it go ----
const G2 = game(['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Be7']);
const res2 = res.slice(0, 6).concat([{white: -280, mate: null, best: 0, pv: []}]);   /* still better for Black, but most of it gone */
check('letting most of a blunder go is a miss', reviewOf(G2, res2, 0).plies[6].cls, 'miss');

// ---- the final mate gets an evaluation of its own ----
const mate = game(['f3', 'e5', 'g4', 'Qh4#']);
const p = new C.Pos(fenAfter(mate, 4), 0, false);
check('finalEval of a mate (Black won)', finalEval(p).mate, -1);
const resM = [0, 1, 2, 3].map(k => ({white: k === 3 ? -2000 : 0, mate: k === 3 ? -1 : null, best: mv(fenAfter(mate, k), mate.sans[k].replace(/[+#]$/, '')), pv: []})).concat([null]);
const RM = reviewOf(mate, resM, 0);
check('mating move is best', RM.plies[4].cls, 'best');
check('graph ends at 0 for White', RM.wins[4], 0);

// ---- openings ----
const table = JSON.parse(readFileSync(new URL('../web/openings.json', import.meta.url)));
const ruy = openingOf(game(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h4']), table);
check('Ruy Lopez named', ruy.name, 'Ruy Lopez: Closed');
check('book across short gaps (4.Ba4 Nf6 are not named)', ruy.book, 16);
check('ECO code', ruy.eco[0], 'C');
check('Sicilian', /Sicilian/.test(openingOf(game(['e4', 'c5']), table).name), true);
check('a long gap ends the book', openingOf(game(['e4', 'e5', 'Nf3', 'Nc6', 'a3', 'a6', 'b3', 'b6', 'Bb5']), table).book <= 4, true);
check('no book from a custom start', openingOf({...game(['e4']), startFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', moves: []}, table).book, 0);

// ---- phases ----
check('start is the opening', phaseOf(new C.Pos(C.START_FEN, 0, false), 0), 0);
check('move 15 is the middlegame', phaseOf(new C.Pos(C.START_FEN, 0, false), 30), 1);
check('rooks only is an endgame', phaseOf(new C.Pos('4k3/r7/8/8/8/8/R7/4K3 w - - 0 1', 0, false), 60), 2);

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
