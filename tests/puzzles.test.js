// Puzzle logic (web/js/puzzle-core.js): daily choice and streak, Rush combos, the Battle bot, theme stats and names.
import {readFileSync} from 'fs';
import {dayKey, prevDay, hash32, dailyChoice, dailyMark, dailyStreak, dailyWeek, comboBonus, comboLevel, botPlan, botOdds, botChoices,
  battleEnd, targetRating, pickFrom, pickNear, META, themePerf, tallyAdd, themeDash, THEME_NAMES, THEME_GROUPS, themeName, fmtClock, fmtBytes} from '../web/js/puzzle-core.js';

let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
}
const list = JSON.parse(readFileSync(new URL('../web/puzzles/puzzles.json', import.meta.url)));
for (const p of list) p.ts = p.t.split(' ');
/* a seeded random source, so the bot tests are repeatable */
const seeded = (s = 1) => () => (s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0, (s >>> 8) / 16777216);

// ---- dates ----
check('dayKey is the local date', dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
check('prevDay over a month', prevDay('2026-03-01'), '2026-02-28');
check('prevDay over a leap day', prevDay('2028-03-01'), '2028-02-29');
check('prevDay over a year', prevDay('2027-01-01'), '2026-12-31');
check('hash32 is stable', hash32('2026-10-13'), hash32('2026-10-13'));
check('hash32 differs by day', hash32('2026-10-13') !== hash32('2026-10-14'), true);

// ---- daily puzzle ----
const d1 = dailyChoice(list, '2026-10-13', 1200);
check('daily: same day, same puzzle', dailyChoice(list, '2026-10-13', 1200).id, d1.id);
check('daily: near your level', Math.abs(d1.r - 1300) <= 200, true);
check('daily: at least two of your moves', d1.moves.split(' ').length >= 4, true);
check('daily: skips recent ones', dailyChoice(list, '2026-10-13', 1200, [d1.id]).id !== d1.id, true);
let days = new Set(); for (let k = '2026-10-13', i = 0; i < 30; i++, k = prevDay(k)) days.add(dailyChoice(list, k, 1200).id);
check('daily: a month of different puzzles', days.size >= 28, true);
check('daily: clamps a low rating', Math.abs(dailyChoice(list, '2026-10-13', 300).r - 800) <= 200, true);

const D = {date: '2026-10-12', id: 'a', done: '', last: '', streak: 0, best: 0, hist: []};
check('mark: only for today', dailyMark(D, '2026-10-13', 'clean'), false);
D.date = '2026-10-12';
check('mark: first day', [dailyMark(D, '2026-10-12', 'clean'), D.streak, D.last, D.hist], [true, 1, '2026-10-12', ['2026-10-12']]);
check('mark: once a day', [dailyMark(D, '2026-10-12', 'solved'), D.done], [false, 'clean']);
Object.assign(D, {date: '2026-10-13', done: ''});
dailyMark(D, '2026-10-13', 'solved');
check('mark: the next day adds one', [D.streak, D.best], [2, 2]);
check('streak shows on the day', dailyStreak(D, '2026-10-13'), 2);
check('streak shows the day after', dailyStreak(D, '2026-10-14'), 2);
check('streak is gone after a missed day', dailyStreak(D, '2026-10-15'), 0);
check('streak is gone once today\'s solution is seen', dailyStreak({...D, date: '2026-10-14', done: 'shown'}, '2026-10-14'), 0);
Object.assign(D, {date: '2026-10-15', done: ''});
dailyMark(D, '2026-10-15', 'clean');
check('mark: after a gap it starts again', [D.streak, D.best], [1, 2]);
Object.assign(D, {date: '2026-10-16', done: ''});
dailyMark(D, '2026-10-16', 'shown');
check('mark: the solution does not count', [D.done, D.streak, D.last], ['shown', 1, '2026-10-15']);
check('week: seven days, oldest first', dailyWeek(D, '2026-10-16').map(x => x.state), ['miss', 'miss', 'done', 'done', 'miss', 'done', 'shown']);
check('week: weekday letters', dailyWeek(D, '2026-10-16').map(x => x.dow).join(''), 'SSMTWTF');
check('week: today still open', dailyWeek({hist: []}, '2026-10-16').at(-1).state, 'today');

// ---- Rush combos ----
check('combo levels', [4, 5, 6, 12, 20, 30, 31, 40, 50].map(comboBonus), [0, 3, 0, 5, 7, 10, 0, 10, 10]);
check('combo meter at 0', comboLevel(0), {from: 0, to: 5, bonus: 3});
check('combo meter at 7', comboLevel(7), {from: 5, to: 12, bonus: 5});
check('combo meter at 30', comboLevel(30), {from: 30, to: 40, bonus: 10});
check('combo meter at 47', comboLevel(47), {from: 40, to: 50, bonus: 10});

// ---- Battle ----
check('bot odds: even', botOdds(1500, 1500), .5);
check('bot odds: capped', [botOdds(3000, 800), botOdds(400, 2800)], [.02, .98]);
const p1500 = {moves: 'a b c d', r: 1500};
const plan = botPlan(1500, p1500, 1000, seeded(7));
check('bot plan: starts now', plan.t0, 1000);
check('bot plan: takes a few seconds', plan.until - plan.t0 > 1500 && plan.until - plan.t0 < 20000, true);
check('bot plan: repeatable', botPlan(1500, p1500, 0, seeded(3)), botPlan(1500, p1500, 0, seeded(3)));
/* a whole battle for the bot alone: a stronger bot scores more */
function botRun(rating, seed) {
  const rnd = seeded(seed), used = new Set();
  let t = 0, score = 0, strikes = 0;
  for (let k = 0; t < 180e3 && strikes < 3; k++) {
    const p = pickFrom(list, targetRating('battle', k, 0), {exclude: used, rnd}); used.add(p.id);
    const c = botPlan(rating, p, t, rnd); t = c.until;
    if (t > 180e3) break;
    if (c.solve) score++; else strikes++;
  }
  return score;
}
const med = r => { const s = Array.from({length: 61}, (_, i) => botRun(r, i + 1)).sort((a, b) => a - b); return s[30]; };
const [m9, m15, m21] = [med(900), med(1500), med(2100)];
console.log(`     bot medians: 900 -> ${m9}, 1500 -> ${m15}, 2100 -> ${m21}`);
check('bot: stronger scores more', m9 < m15 && m15 < m21, true);
check('bot: a 1500 bot scores 10 to 20', m15 >= 10 && m15 <= 20, true);
check('bot choices', botChoices(1234).map(b => b.rating), [950, 1250, 1550]);
check('bot choices: floor', botChoices(500)[0].rating, 400);
check('battle: still going', battleEnd({score: 3, out: false}, {score: 5, out: false}, false), null);
check('battle: time', battleEnd({score: 6, out: false}, {score: 5, out: false}, true), {res: 'win', why: 'time'});
check('battle: you out, bot ahead', battleEnd({score: 4, out: true}, {score: 5, out: false}, false), {res: 'loss', why: 'you-out'});
check('battle: you out, bot behind keeps going', battleEnd({score: 6, out: true}, {score: 5, out: false}, false), null);
check('battle: you out, bot level keeps going', battleEnd({score: 5, out: true}, {score: 5, out: false}, false), null);
check('battle: bot out, you ahead', battleEnd({score: 6, out: false}, {score: 5, out: true}, false), {res: 'win', why: 'bot-out'});
check('battle: both out, draw', battleEnd({score: 5, out: true}, {score: 5, out: true}, false), {res: 'draw', why: 'both'});

// ---- picking ----
check('targets', ['streak', 'rush', 'battle', 'rated'].map(m => targetRating(m, 10, 1234)), [1150, 1250, 1200, 1234]);
check('battle target is capped', targetRating('battle', 80, 0), 2650);
const fk = pickFrom(list, 1500, {theme: 'fork', rnd: seeded(2)});
check('pick: theme', fk.ts.includes('fork') && Math.abs(fk.r - 1500) <= 80, true);
check('pick: no substring match', pickFrom(list, 1500, {theme: 'mat'}), null);
check('pick: exclude', pickFrom(list.slice(0, 1), 500, {exclude: new Set([list[0].id])}), null);
check('pick: widens', !!pickFrom(list, 3500), true);
check('pick: maxW caps the window', pickFrom(list, 4000, {maxW: 320}), null);
{
  /* everything near 400 already seen: an older puzzle at that level beats an unseen one far away */
  const near = list.filter(p => Math.abs(p.r - 400) <= 320), seen = new Set(near.map(p => p.id)), rnd = seeded(5);
  const rs = Array.from({length: 200}, () => pickNear(list, 400, {seen, rnd}).r);
  check('pickNear: seen near before unseen far', rs.every(r => Math.abs(r - 400) <= 320), true);
  const fresh = pickNear(list, 400, {seen: new Set(near.slice(1).map(p => p.id)), rnd});
  check('pickNear: the one unseen near puzzle first', fresh.id, near[0].id);
  /* this run used them all: then further away, never a repeat within the run */
  const far = pickNear(list, 400, {exclude: seen, rnd});
  check('pickNear: run puzzles excluded before widening', !seen.has(far.id) && Math.abs(far.r - 400) > 320, true);
  check('pickNear: theme kept', pickNear(list, 1500, {theme: 'fork', seen: new Set(list.map(p => p.id)), rnd}).ts.includes('fork'), true);
  check('pickNear: unknown theme still gives a puzzle', !!pickNear(list, 1500, {theme: 'nope', rnd}), true);
}

// ---- themes ----
check('META leaves out lengths and goals', ['short', 'mateIn2', 'crushing', 'superGM'].every(t => META.has(t)) && !META.has('mate') && !META.has('endgame'), true);
check('perf', themePerf([10, 5, 15000]), 1500);
check('perf of nothing', themePerf([0, 0, 0]), null);
const T = {}, tally = [0, 0, 0];
tallyAdd(T, tally, {t: 'fork middlegame short mateIn2', r: 1400}, true);
tallyAdd(T, tally, {t: 'fork endgame', r: 1600}, false);
check('tally: themes', T, {fork: [2, 1, 3000], middlegame: [1, 1, 1400], endgame: [1, 0, 1600]});
check('tally: overall', tally, [2, 1, 3000]);
const big = {fork: [20, 6, 30000], pin: [20, 18, 30000], skewer: [4, 0, 6000], mate: [20, 10, 30000], short: [40, 0, 60000]};
const dash = themeDash(big, [80, 40, 120000]);
check('dash: weak', dash.weak.map(x => x.t), ['fork']);
check('dash: strong', dash.strong.map(x => x.t), ['pin']);
check('dash: empty', themeDash({}, [0, 0, 0]), {weak: [], strong: [], perf: null});
const grouped = THEME_GROUPS.flatMap(g => g[1]);
check('groups: no duplicates', grouped.length, new Set(grouped).size);
check('groups: every bundled theme is named or meta', [...new Set(list.flatMap(p => p.ts))].filter(t => !THEME_NAMES[t]), []);
check('groups: every non-meta theme in a group', [...new Set(list.flatMap(p => p.ts))].filter(t => !META.has(t) && !grouped.includes(t)), []);
check('names', [themeName('xRayAttack'), themeName('mateIn5'), themeName('someNewTheme')], ['X-ray attack', 'Mate in 5 or more', 'Some new theme']);

// ---- formatting ----
check('clock', [fmtClock(300000), fmtClock(61001), fmtClock(-5)], ['5:00', '1:02', '0:00']);
check('bytes', [fmtBytes(3.2e8), fmtBytes(1.25e9)], ['320 MB', '1.3 GB']);

// ---- copy rules: no em or en dashes in the puzzle code ----
for (const f of ['../web/js/puzzles.js', '../web/js/puzzle-core.js', '../web/puzzles.css'])
  check('no long dashes in ' + f.slice(3), /[\u2013\u2014]/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), false);

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
