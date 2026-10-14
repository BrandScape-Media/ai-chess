/* tournament logic: run with `node tests/tourney.test.js` */
import {createTournament, recordResult, readyGames, standings, arenaPair, seedOrder, winnerOf, yourGame, YOU} from '../web/js/tourney-core.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
const players = n => Array.from({length: n}, (_, i) => ({id: i === 0 ? YOU : 'p' + i, name: 'P' + i, rating: 2000 - i * 100}));
const rnd = () => ['1-0', '0-1', '1/2-1/2'][Math.floor(Math.random() * 3)];
function playOut(t, pick = rnd, limit = 500) {
  for (let i = 0; i < limit && t.status === 'live'; i++) {
    const g = readyGames(t)[0];
    if (!g) break;
    recordResult(t, g.id, pick(g), 'test', []);
  }
}

/* round-robin: everyone meets everyone exactly once, odd counts get one bye each */
for (const n of [4, 5, 7, 8]) {
  const t = createTournament(players(n), {format: 'rr'});
  playOut(t);
  ok(t.status === 'done', `rr ${n} finishes`);
  const seen = new Set();
  for (const g of t.games.filter(g => !g.bye)) { const k = [g.w, g.b].sort().join(); ok(!seen.has(k), `rr ${n} no repeat ${k}`); seen.add(k); }
  ok(seen.size === n * (n - 1) / 2, `rr ${n} all pairs (${seen.size})`);
  const byes = t.games.filter(g => g.bye);
  ok(byes.length === (n % 2 ? n : 0), `rr ${n} byes ${byes.length}`);
  const st = standings(t);
  ok(st.every(s => s.games === n - 1), `rr ${n} games each`);
  ok(Math.abs(st.reduce((a, s) => a + s.pts, 0) - (n * (n - 1) / 2 + byes.length)) < 1e-9, `rr ${n} points add up`);
}

/* Swiss: no rematch while avoidable, right number of rounds, one bye per odd round, colours roughly balanced */
for (const n of [6, 8, 9, 12]) {
  for (let rep = 0; rep < 20; rep++) {
    const t = createTournament(players(n), {format: 'swiss'});
    playOut(t);
    ok(t.status === 'done', `swiss ${n} finishes`);
    const seen = new Set();
    let rematches = 0;
    for (const g of t.games.filter(g => !g.bye)) { const k = [g.w, g.b].sort().join(); if (seen.has(k)) rematches++; seen.add(k); }
    ok(rematches <= (n <= 6 ? 1 : 0), `swiss ${n} rematches ${rematches}`);   /* tiny fields can run out of new opponents */
    const st = standings(t);
    ok(st.every(s => s.games + s.byes === t.rounds), `swiss ${n} each plays every round`);
    ok(st.every(s => s.byes <= 1), `swiss ${n} at most one bye`);
    ok(st.every(s => Math.abs(s.colors.filter(c => c === 'w').length - s.colors.filter(c => c === 'b').length) <= 2), `swiss ${n} colours`);
  }
}

/* knockout: seeding, byes, a champion, draws replayed with colours swapped, three draws go to the higher seed */
ok(JSON.stringify(seedOrder(8)) === '[1,8,4,5,2,7,3,6]', 'seed order 8');
for (const n of [4, 6, 8, 11, 16]) {
  const t = createTournament(players(n), {format: 'ko'});
  playOut(t);
  ok(t.status === 'done' && winnerOf(t), `ko ${n} has a champion`);
  const lost = new Set(t.ko.matches.filter(m => m.a && m.b).map(m => (m.winner === m.a ? m.b : m.a)));
  ok(lost.size === n - 1, `ko ${n} everyone but one lost once (${lost.size})`);
  ok(standings(t)[0].id === t.champion, `ko ${n} champion tops the standings`);
}
{
  const t = createTournament(players(4), {format: 'ko'});
  const first = readyGames(t)[0], m = t.ko.matches.find(x => x.id === first.match);
  recordResult(t, first.id, '1/2-1/2', 'test', []);
  const replay = readyGames(t).find(g => g.match === m.id);
  ok(replay && replay.w === first.b && replay.b === first.w, 'ko draw is replayed with colours swapped');
  recordResult(t, replay.id, '1/2-1/2', 'test', []);
  const third = readyGames(t).find(g => g.match === m.id);
  recordResult(t, third.id, '1/2-1/2', 'test', []);
  ok(m.winner === YOU, 'ko three draws: the higher seed goes through');
}

/* arena: points 2/1/0, double after two wins in a row; streak scoring ranks by the longest run */
{
  const t = createTournament(players(4), {format: 'arena', minutes: 10, now: 1000});
  ok(arenaPair(t, 1000, false).every(g => g.w !== YOU && g.b !== YOU), 'arena leaves you out unless ready');
  const t2 = createTournament([{id: 'a', rating: 1500}, {id: 'b', rating: 1500}], {format: 'arena', minutes: 10, now: 0});
  for (let i = 0; i < 4; i++) {
    const [g] = arenaPair(t2, 1, true);
    recordResult(t2, g.id, g.w === 'a' ? '1-0' : '0-1', 'test', [], 1);
  }
  const a = standings(t2).find(s => s.id === 'a');
  ok(a.pts === 2 + 2 + 4 + 4 && a.best === 4, `arena streak doubling (${a.pts}, best ${a.best})`);
  ok(arenaPair(t2, 10 * 60e3 + 1, true).length === 0, 'arena pairs nobody after the end');
  const t3 = createTournament(players(4), {format: 'arena', minutes: 10, scoring: 'streak', now: 0});
  ok(t3.arena.scoring === 'streak', 'arena streak scoring kept');
}

/* rating climb: every game moves ratings, the order follows the gain */
{
  const ps = players(8); ps[0].rating = 900;   /* you start as the lowest rated */
  const t = createTournament(ps, {format: 'climb'});
  playOut(t, g => (g.w === YOU || g.b === YOU) ? (g.w === YOU ? '1-0' : '0-1') : rnd());
  const st = standings(t);
  ok(t.status === 'done', 'climb finishes');
  ok(st[0].id === YOU && st[0].gain > 0, `climb: winning every game tops the table (${st[0].id} ${st[0].gain})`);
  ok(Math.abs(st.reduce((a, s) => a + s.gain, 0)) <= st.length, 'climb gains add up to about zero');
  for (let i = 1; i < st.length; i++) ok(st[i - 1].gain >= st[i].gain, 'climb sorted by gain');
}

/* your game is found among the ready ones */
{
  const t = createTournament(players(6), {format: 'swiss'});
  ok(!!yourGame(t), 'your first Swiss game is ready');
}

console.log(fails ? `${fails} failed` : 'tourney: all passed');
process.exit(fails ? 1 : 0);
