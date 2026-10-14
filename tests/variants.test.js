/* variants: the catalog against the rules library, FEN and move parsing, the variant bot, ratings, and the review's
   illegal-move notes. Run with `node tests/variants.test.js` */
import fs from 'fs';
import Module from '../web/vendor/ffish/ffish.js';
import {VARIANTS, GROUPS, parseFen, splitMove, pieceLook, sides, vrate, VSTART} from '../web/js/variant-catalog.js';
import {vbotMove, evaluate} from '../web/js/vbot-core.js';
import * as C from '../web/js/core.js';
import {describeIllegal, reviewOf} from '../web/js/review-core.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
const ff = await Module({wasmBinary: fs.readFileSync(new URL('../web/vendor/ffish/ffish.wasm', import.meta.url))});

/* every variant: the rules library knows it, every piece has a drawing, every move can be read, a few random games run */
const ENGINE = new Set('3check 5check almost amazon antichess atomic breakthrough cambodian capablanca capahouse centaur chancellor chaturanga chigorin coregal courier crazyhouse dobutsu embassy extinction gardner gorogoro gothic grand grasshopper hoppelpoppel horde janggi janus jesonmor judkins knightmate kyotoshogi losalamos makruk manchu minishogi minixiangqi modern nightrider placement pocketknight racingkings seirawan shako shatranj shogi shouse sittuyin xiangqi ataxx'.split(' '));
ok(new Set(VARIANTS.map(v => v.id)).size === VARIANTS.length, 'variant ids are unique');
for (const v of VARIANTS) {
  ok(GROUPS.some(g => g.id === v.group), v.id + ': known group');
  ok(v.rules.length > 40 && v.blurb.length > 5, v.id + ': rules text');
  ok(!/—|–/.test(v.rules + v.blurb + v.name), v.id + ': no long dashes');
  ok(v.engine === ENGINE.has(v.id), v.id + ': engine flag matches Fairy-Stockfish\'s list');
  let b;
  try { b = new ff.Board(v.id); } catch (e) { ok(false, v.id + ': the rules library knows it'); continue; }
  const P = parseFen(b.fen());
  ok(P.files >= 3 && P.ranks >= 3 && P.cells.every(r => r.length === P.files), v.id + ': board parsed ' + P.files + 'x' + P.ranks);
  for (const row of P.cells) for (const c of row) if (c && !c.wall) {
    const look = pieceLook(v.id, c.l, c.side, c.promo);
    ok(look.set || look.cjk || look.animal || look.stone, `${v.id}: piece ${c.l} has a drawing`);
  }
  ok(sides(v.id).length === 2, v.id + ': side names');
  for (let g = 0; g < 2; g++) {
    b.reset();
    for (let i = 0; i < 80 && !b.isGameOver(true); i++) {
      const ms = b.legalMoves().split(' ').filter(Boolean);
      for (const m of ms) if (!splitMove(m)) { ok(false, `${v.id}: move ${m} can be read`); break; }
      b.push(ms[Math.floor(Math.random() * ms.length)]);
      parseFen(b.fen());
    }
    if (b.isGameOver(true)) ok(['1-0', '0-1', '1/2-1/2'].includes(b.result(true)), v.id + ': a result at the end');
  }
  b.delete();
}

/* move strings */
ok(JSON.stringify(splitMove('e2e4')) === JSON.stringify({from: 'e2', to: 'e4', extra: '', wall: '', drop: ''}), 'plain move');
ok(splitMove('P@e4').drop === 'P' && splitMove('P@e4').to === 'e4', 'drop');
ok(splitMove('+S@c1').drop === '+S', 'promoted drop (kyoto)');
ok(splitMove('h7h8+').extra === '+', 'shogi promotion');
ok(splitMove('a10a9').from === 'a10', 'two-digit rank');
ok(splitMove('e2e4,e4d5').wall === 'd5', 'duck square');
ok(splitMove('b1c3h').extra === 'h', 'seirawan gating');
/* FEN details */
const zh = parseFen('rnbqkbnr/pppppppp/8/8/4Q~3/8/PPPPPPPP/RNB1KBNR[Pnp] b KQkq - 0 1');
ok(zh.hasPocket && zh.pockets[0].join('') === 'P' && zh.pockets[1].join('') === 'NP', 'pockets');
ok(zh.cells[3][4].l === 'Q' && zh.cells[3][4].tilde, 'promoted pawn marker');
const sg = parseFen('lnsgkgsnl/1r5+b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL[-] w 0 1');
ok(sg.cells[7][7].promo && sg.cells[7][7].l === 'b', 'shogi promoted piece');

/* the variant bot: finds a mate in one, plays every variant fast */
const r = vbotMove(ff, 'chess', 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', [], {level: 2, maxMs: 3000});
ok(r && r.move === 'h5f7', 'bot finds the mate in one ' + (r && r.move));
const e0 = evaluate('crazyhouse', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[Q] w KQkq - 0 1');
ok(e0 > 500, 'a queen in hand counts as material');
for (const vid of ['xiangqi', 'shogi', 'duck', 'atomic']) {
  const t = Date.now(), m = vbotMove(ff, vid, null, [], {level: 1, maxMs: 800});
  ok(m && m.move && Date.now() - t < 3000, `bot plays ${vid}`);
}

/* ratings */
const a = vrate(null, 1200, 1);
ok(a.next.r === VSTART + 20 && a.next.n === 1 && a.next.w === 1, 'first win against an equal: +20');
const b2 = vrate({r: 1500, n: 30, w: 10, d: 10, l: 10, best: 1500}, 1500, .5);
ok(b2.delta === 0 && b2.next.d === 11, 'a draw against an equal changes nothing');

/* the review: what illegal moves did, and a rating per game phase */
const p = new C.Pos(C.START_FEN, 0, false), FREE = 16 << 17, sq = C.nameSq;
const mv = (f, t, sp = 0) => f | t << 7 | sp << 14 | FREE;
ok(/out of nowhere/.test(describeIllegal(p, mv(C.SPAWN_SQ, sq('h4'), C.QUEEN))), 'spawned piece');
ok(/already standing/.test(describeIllegal(p, mv(sq('g1'), sq('g1')))), 'a move to its own square');
ok(/its own pawn/.test(describeIllegal(p, mv(sq('g1'), sq('e2')))), 'capturing its own piece');
ok(/can't move like that/.test(describeIllegal(p, mv(sq('c1'), sq('c4')))), 'a wrong shape');
ok(/jumped over/.test(describeIllegal(p, mv(sq('d1'), sq('d7')))), 'jumping over pieces');
{
  const g = {startFen: C.START_FEN, variant: 0, c960: false, moves: [], sans: []}, q = new C.Pos(C.START_FEN, 0, false), res = [{white: 20, mate: null, best: 0}];
  for (let i = 0; i < 30; i++) { const lm = q.legalMoves(), m = lm[i % lm.length]; g.sans.push(q.san(m)); g.moves.push(m); q.make(m); res.push({white: 20 - i, mate: null, best: 0}); }
  const R = reviewOf(g, res, 0);
  ok(Array.isArray(R.phaseRating) && R.phaseRating[0].length === 3, 'a rating per phase');
  ok(R.phaseRating[0][0] > 0 && R.phaseRating[0][2] == null, 'opening rated, no endgame played');
}

console.log(fails ? `${fails} failed` : 'variants: all passed');
process.exit(fails ? 1 : 0);
