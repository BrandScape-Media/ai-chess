import * as C from '../web/js/core.js';
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
}
const deep = !!process.env.DEEP;

// ---- standard perft (castling now encoded king->rook) ----
const std = [
  ['startpos', C.START_FEN, [20, 400, 8902, 197281].concat(deep ? [4865609] : [])],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862].concat(deep ? [4085603] : [])],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467].concat(deep ? [422333] : [])],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
for (const [name, fen, exp] of std) {
  for (const c960 of [false, true]) {
    const pos = new C.Pos(fen, 0, c960);
    const t = Date.now();
    check(`perft ${name}${c960 ? ' (as 960)' : ''} ${Date.now() - t}ms`, exp.map((_, i) => C.perft(pos, i + 1)), exp);
    if (!c960) check(`  fen roundtrip ${name}`, pos.fen().split(' ').slice(0, 4).join(' '), fen.split(' ').slice(0, 4).join(' '));
  }
}
// ---- Chess960 perft (positions from the standard chess960 perft suite) ----
const p960 = [
  ['bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', [21, 528, 12189, 326672]],
  ['2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', [21, 807, 18002, 667366]],
  ['b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9', [20, 479, 10471, 273318]],
  ['qbbnnrkr/2pp2pp/p7/1p2pp2/8/P3PP2/1PPP1KPP/QBBNNR1R w hf - 0 9', [22, 593, 13440, 382958]],
  ['1nbbnrkr/p1p1ppp1/3p4/1p3P1p/3Pq2P/8/PPP1P1P1/QNBBNRKR w HFhf - 0 9', [28, 1120, 31058, 1171749]],
  ['qnbnr1kr/ppp1b1pp/4p3/3p1p2/8/2NPP3/PPP1BPPP/QNB1R1KR w HEhe - 1 9', [29, 899, 26578, 824055]],
  ['q1bnrkr1/ppppp2p/2n2p2/4b1p1/2NP4/8/PPP1PPPP/QNB1RRKB w ge - 1 9', [30, 860, 24566, 732757]],
  ['qbn1brkr/ppp1p1p1/2n4p/3p1p2/P7/6PP/QPPPPP2/1BNNBRKR w HFhf - 0 9', [25, 635, 17054, 465806]],
];
for (const [fen, exp] of p960) {
  const pos = new C.Pos(fen, 0, true);
  check(`perft960 ${fen.split(' ')[0]}`, exp.map((_, i) => C.perft(pos, i + 1)), exp);
  const again = new C.Pos(pos.fen(), 0, true);
  check(`  X-FEN reparse same rights`, [again.castle, Array.from(again.crook)], [pos.castle, Array.from(pos.crook)]);
}
// castling rook shields the king's destination: illegal after the rook moves away
{
  const p = new C.Pos('4k3/8/8/8/8/8/8/rR3K2 w B - 0 1', 0, true);
  check('960: rook-shield castling is illegal', p.fromUci('f1b1'), 0);
  const q = new C.Pos('4k3/8/8/8/8/8/8/1R3K2 w B - 0 1', 0, true);
  const m = q.fromUci('f1b1');
  check('960: same castling without the attacker is legal', !!m, true);
  q.make(m);
  check('  king c1, rook d1 after O-O-O', [q.b[C.nameSq('c1')], q.b[C.nameSq('d1')], q.b[C.nameSq('b1')], q.b[C.nameSq('f1')]], [6, 4, 0, 0]);
  q.unmake();
  check('  unmake restores', q.fen().split(' ').slice(0, 3).join(' '), '4k3/8/8/8/8/8/8/1R3K2 w Q');
}
// king already on g1 castles (only the rook moves)
{
  const p = new C.Pos('1r4k1/8/8/8/8/8/8/1R4KR w Hb - 0 1', 0, true);
  const m = p.fromUci('g1h1');
  check('960: O-O with the king already on g1', !!m && p.san(m), 'O-O');
  p.make(m);
  check('  rook to f1, king stays', [p.b[C.nameSq('g1')], p.b[C.nameSq('f1')], p.b[C.nameSq('h1')]], [6, 4, 0]);
  p.unmake();
  const h = p.h1; p.computeHash(); check('  hash ok', p.h1, h);
}
// UCI spellings
{
  const p = new C.Pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const m = p.fromUci('e1g1');
  check('std castling prints e1g1', p.toUci(m), 'e1g1');
  check('std castling also accepts e1h1', p.fromUci('e1h1'), m);
  check('960 castling prints king-takes-rook', C.uci(m, true), 'e1h1');
  check('castling SAN', p.san(m), 'O-O');
  const q = new C.Pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 0, true);
  check('960 mode accepts e1g1 too', q.fromUci('e1g1'), m);
}
// 960 start positions
{
  check('backRank960(518)', C.backRank960(518), 'RNBQKBNR');
  const seen = new Set(); let bad = 0;
  for (let n = 0; n < 960; n++) {
    const r = C.backRank960(n); seen.add(r);
    const bs = [...r].map((c, i) => c === 'B' ? i % 2 : -1).filter(x => x >= 0);
    const k = r.indexOf('K'), r1 = r.indexOf('R'), r2 = r.lastIndexOf('R');
    if (bs.length !== 2 || bs[0] === bs[1] || !(r1 < k && k < r2) || r.length !== 8) bad++;
    if (n % 97 === 0) { const p = new C.Pos(C.fen960(n, n), 0, true); if (C.perft(p, 2) <= 0) bad++; }
  }
  check('960 positions distinct and valid', [seen.size, bad], [960, 0]);
}
// hash consistency in random games (std, 960 start, three-check, koth)
for (const [label, fen, v, c960] of [['std', C.START_FEN, 0, false], ['960', C.fen960(77, 77), 0, true], ['3check', C.START_FEN, 2, false], ['koth960', C.fen960(300, 300), 1, true], ['trans', C.fen960(5, 900, '-'), 0, false]]) {
  let bad = 0, castles = 0;
  for (let g = 0; g < 120; g++) {
    const p = new C.Pos(fen, v, c960);
    const start = p.fen();
    let n = 0;
    for (let i = 0; i < 140; i++) {
      if (p.status().over) break;
      const ml = p.legalMoves();
      const m = ml[Math.floor(Math.random() * ml.length)];
      if ((m >> 17) & C.FL_CASTLE) castles++;
      p.make(m); n++;
      const a = p.h1, b = p.h2; p.computeHash();
      if (p.h1 !== a || p.h2 !== b) { bad++; break; }
    }
    while (n--) p.unmake();
    if (p.fen() !== start) bad++;
  }
  check(`random games hash + unmake (${label}, ${castles} castles)`, bad, 0);
}
// King of the Hill
{
  const p = new C.Pos('4k3/8/8/8/8/3K4/8/8 w - - 0 1', 1);
  check('KotH: bare kings are not insufficient', p.status().over, false);
  const r = C.search(p, { depth: 5, noise: 0, time: 800 });
  check('KotH: engine walks onto the hill', ['d3d4', 'd3e4'].includes(C.uci(r.move)), true);
  p.make(p.fromUci('d3d4'));
  check('KotH: status', p.status(), { over: true, result: '1-0', reason: 'king reached the hill' });
  const q = new C.Pos('4k3/8/8/8/2r5/8/3K4/8 w - - 0 1', 1);
  check('KotH: cannot step into check on the hill', q.fromUci('d2d3') !== 0 && q.fromUci('d2c3') === 0, true);
}
// Three-check
{
  const p = new C.Pos('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', 2);
  const seq = ['a1a4', 'e8f7', 'a4b3', 'f7f8', 'b3b4'];
  const sans = seq.map(u => { const m = p.fromUci(u); if (!m) throw new Error('illegal ' + u); const s = p.san(m); p.make(m); return s; });
  check('3check: SAN', sans, ['Qa4+', 'Kf7', 'Qb3+', 'Kf8', 'Qb4+']);
  check('3check: counts', p.checks, [3, 0]);
  check('3check: status', p.status(), { over: true, result: '1-0', reason: 'three checks' });
  p.unmake();
  check('3check: unmake decrements', p.checks, [2, 0]);
  const r = C.search(p, { depth: 4, noise: 0, time: 800 });
  p.make(r.move);
  check('3check: engine finds the third check', p.checks[0], 3);
  check('3check: K+N vs K not insufficient', new C.Pos('4k3/8/8/8/8/8/8/N3K3 w - - 0 1', 2).insufficient(), false);
}
// free moves (rules off)
{
  const FREE = (from, to, sp = 0) => C.nameSq(from) | C.nameSq(to) << 7 | sp << 14 | C.FL_FREE << 17;
  const SPAWN = (to, sp) => C.SPAWN_SQ | C.nameSq(to) << 7 | sp << 14 | C.FL_FREE << 17;
  const p = new C.Pos();
  const snap = () => p.fen() + '|' + p.h1 + '|' + p.h2;
  const s0 = snap();
  p.make(FREE('d1', 'd8')); check('free: teleport capture', [p.b[C.nameSq('d8')], p.turn], [5, 1]); p.unmake(); check('free: unmake', snap(), s0);
  p.make(SPAWN('a4', C.QUEEN)); check('free: spawn', p.b[C.nameSq('a4')], 5); check('free: spawn UCI is a drop', C.uci(FREE('a1', 'a1') & 0 | SPAWN('a4', C.QUEEN)), 'Q@a4'); p.unmake(); check('free: unmake spawn', snap(), s0);
  const q = new C.Pos('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const qs = q.fen() + q.h1;
  q.make(FREE('a7', 'b8', C.QUEEN)); check('free: pawn promotes on a free move', q.b[C.nameSq('b8')], 5); q.unmake(); check('free: unmake promotion restores pawn', q.fen() + q.h1, qs);
  check('free: SAN', [new C.Pos().san(FREE('d1', 'h5')), new C.Pos().san(SPAWN('d4', C.QUEEN)), q.san(FREE('a7', 'b8', C.QUEEN))], ['Qd1-h5?!', 'Q@d4?!', 'a7-b8=Q?!']);
  const k = new C.Pos('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'); k.make(FREE('a1', 'e8'));
  check('free: king capture ends the game', k.status(), { over: true, result: '1-0', reason: 'king captured' });
  const t3 = new C.Pos('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', 2); t3.make(FREE('a1', 'e7'));
  check('free: a slip that checks counts in three-check', t3.checks, [1, 0]); t3.unmake(); check('  and unmakes', t3.checks, [0, 0]);
  const c = new C.Pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); c.make(FREE('a8', 'b5'));   // white moves a black rook (!)
  check('free: moving away a castling rook kills that right', c.fen().split(' ')[2], 'KQk');
  const e = new C.Pos(); e.make(e.fromUci('e2e4')); e.make(FREE('d8', 'h4')); e.make(e.fromUci('g1f3'));
  const res = C.search(e, { depth: 6, noise: 0, time: 300 }); check('free: engine searches after a slip', e.legalMoves().includes(res.move), true);
}
// engine sanity
{
  const best = (fen, v = 0) => { const p = new C.Pos(fen, v); return C.uci(C.search(p, { depth: 6, noise: 0, time: 1500 }).move); };
  check('engine: mate in 1', best('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'), 'a1a8');
  check('engine: Qxf7#', best('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'), 'h5f7');
  check('engine: exd5', best('rnb1kbnr/pppp1ppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3'), 'e4d5');
  const p = new C.Pos(C.fen960(0, 0), 0, true); const r = C.search(p, { depth: 64, noise: 0, time: 1000 });
  console.log('  960 #0 opening move:', C.uci(r.move, true), 'depth', r.depth, 'nps', Math.round(r.nodes / (r.ms / 1000)));
}
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
