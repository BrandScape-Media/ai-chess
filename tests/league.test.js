/* weekly league logic: run with `node tests/league.test.js` */
import {DIVISIONS, GROUP, weekKey, weekStart, weekEnd, weekFrac, rivals, rivalPoints, newLeague, table, rollover, addPoints, gamePoints} from '../web/js/league-core.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
const day = 864e5;
const mon = new Date(2026, 9, 12, 10).getTime();   /* Monday 12 Oct 2026 */

ok(weekKey(mon) === '2026-10-12', 'week key on a Monday ' + weekKey(mon));
ok(weekKey(mon + 6 * day) === '2026-10-12', 'Sunday is the same week');
ok(weekKey(mon + 7 * day) === '2026-10-19', 'next Monday is a new week');
ok(weekEnd('2026-10-12') - weekStart('2026-10-12') >= 6.9 * day, 'a week is seven days');
ok(weekFrac('2026-10-12', weekStart('2026-10-12')) === 0 && weekFrac('2026-10-12', weekEnd('2026-10-12')) === 1, 'week fraction');

/* rivals: deterministic, 29 of them, points never go down during the week and end at the final score */
const a = rivals('2026-10-12', 2), b = rivals('2026-10-12', 2);
ok(a.length === GROUP - 1, 'twenty-nine rivals');
ok(JSON.stringify(a) === JSON.stringify(b), 'rivals are the same every time');
ok(new Set(a.map(r => r.name)).size === a.length, 'rival names are unique');
ok(JSON.stringify(a) !== JSON.stringify(rivals('2026-10-19', 2)), 'a new week brings new rivals');
for (const rv of a) {
  let last = 0;
  for (let f = 0; f <= 1.0001; f += 1 / 70) { const p = rivalPoints(rv, Math.min(1, f)); ok(p >= last, 'rival points never drop'); last = p; }
  ok(rivalPoints(rv, 1) === rv.final, 'rival ends on the final score');
}

/* points per game */
ok(gamePoints({score: 1, me: 1200, opp: 1200}) === 3, 'win 3');
ok(gamePoints({score: 1, me: 1200, opp: 1350}) === 4, 'win against a stronger player 4');
ok(gamePoints({score: .5, me: 1200, opp: 1200}) === 1, 'draw 1');
ok(gamePoints({score: 0, me: 1200, opp: 1200}) === 0, 'loss 0');
ok(gamePoints({score: 1, me: 1200, opp: 1200, tourney: true}) === 4, 'tournament win 4');

/* promotion, relegation, a week off */
{
  const L = newLeague(mon);
  addPoints(L, 200, mon + day);   /* far ahead of everybody */
  ok(table(L, mon + day)[0].you, 'top of the table with many points');
  rollover(L, mon + 8 * day);
  ok(L.div === 1 && L.result.move === 'up' && L.pts === 0 && L.week === '2026-10-19', 'promoted after a great week');
  ok(L.history.length === 1, 'the week is in the history');
}
{
  const L = newLeague(mon); L.div = 3;
  addPoints(L, 0, mon + day);     /* played, but scored nothing */
  rollover(L, mon + 7 * day + 1);
  ok(L.div === 2 && L.result.move === 'down', 'relegated from the bottom');
}
{
  const L = newLeague(mon); L.div = 4;
  rollover(L, mon + 7 * day + 1);
  ok(L.div === 4 && L.result === null && L.history[0].move === 'rest', 'a week without games changes nothing');
}
{
  const L = newLeague(mon); L.div = DIVISIONS.length - 1;
  addPoints(L, 500, mon);
  rollover(L, mon + 7 * day + 1);
  ok(L.div === DIVISIONS.length - 1, 'nobody goes above the top division');
  const P = newLeague(mon);
  addPoints(P, 0, mon);
  rollover(P, mon + 7 * day + 1);
  ok(P.div === 0, 'nobody goes below the first division');
}

console.log(fails ? `${fails} failed` : 'league: all passed');
process.exit(fails ? 1 : 0);
