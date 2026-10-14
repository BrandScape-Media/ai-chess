/* weekly leagues: pure logic, tested in tests/league.test.js. GPL-3.0-or-later

   Every week (Monday to Sunday, your local time) you are in a group of 30 with 29 rivals from the bot pool. Rated
   games against the computer earn league points; the rivals' points grow through the week on their own schedule.
   When the week ends, the top 5 move up a division and the bottom 5 move down. A week without games changes nothing.
   Rivals are simulated from a seed (the week and the division), so they are the same every time you look. */

export const DIVISIONS = [
  {id: 'pawn', name: 'Pawn League', target: 18},
  {id: 'knight', name: 'Knight League', target: 24},
  {id: 'bishop', name: 'Bishop League', target: 30},
  {id: 'rook', name: 'Rook League', target: 36},
  {id: 'queen', name: 'Queen League', target: 44},
  {id: 'king', name: 'King League', target: 52},
  {id: 'legend', name: 'Legend League', target: 62},
];
export const GROUP = 30, UP = 5, DOWN = 5, WEEK_MS = 7 * 864e5;

/* the bot pool the rivals come from: [name, avatar key] */
const POOL = [['Built-in Beginner', 'builtin'], ['Built-in Casual', 'builtin'], ['Built-in Club', 'builtin'], ['Built-in Strong', 'builtin'], ['Built-in Maximum', 'builtin'],
  ['Turochamp', 'turochamp'], ['Random mover', 'random'], ['Leela', 'lc0'], ['Weiss', 'weiss'], ['Arasan', 'arasan'], ['Velvet', 'velvet'], ['Seer', 'seer'],
  ['Altair', 'altair'], ['Clover', 'clover'], ['Halogen', 'halogen'], ['Caissa', 'caissa'], ['Obsidian', 'obsidian'], ['Koivisto', 'koivisto'],
  ['Berserk', 'berserk'], ['FabChess', 'fabchess'], ['Fairy-Stockfish', 'fairy-stockfish'],
  ...[1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900].map(r => ['Maia ' + r, 'maia']),
  ...[1350, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2600].map(r => ['Stockfish ' + r, 'stockfish'])];

/* ---------- time ---------- */
/* the Monday (local) that starts the week of `now`, as "YYYY-MM-DD" */
export function weekKey(now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function weekStart(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
export const weekEnd = key => { const s = new Date(weekStart(key)); s.setDate(s.getDate() + 7); return s.getTime(); };
export const weekFrac = (key, now) => Math.max(0, Math.min(1, (now - weekStart(key)) / (weekEnd(key) - weekStart(key))));

/* ---------- seeded randomness ---------- */
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = hash(seed);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- rivals ---------- */
/* 29 rivals for a week and division: each has a final weekly score and a playing pattern over the seven days */
export function rivals(key, div) {
  const r = rng(key + ':' + div), target = DIVISIONS[div].target, pool = POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, GROUP - 1).map(([name, av], i) => {
    const idle = r() < .1, act = .25 + r() * .9;
    const final = idle ? 0 : Math.max(1, Math.round(target * act * (.7 + r() * .6)));
    const days = Array.from({length: 7}, () => { const x = r(); return x * x; }), sum = days.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const cum = days.map(d => (acc += d / sum));
    return {id: 'r' + i, name, av, final, cum};
  });
}
/* a rival's points at a moment of the week (fraction 0..1): the days played so far, the current one in proportion */
export function rivalPoints(rv, frac) {
  if (frac >= 1) return rv.final;
  const day = Math.min(6, Math.floor(frac * 7)), within = frac * 7 - day, before = day ? rv.cum[day - 1] : 0;
  return Math.floor(rv.final * (before + (rv.cum[day] - before) * within));
}

/* ---------- your league ---------- */
export function newLeague(now) { return {v: 1, div: 0, week: weekKey(now), pts: 0, games: 0, best: 0, history: [], result: null}; }
/* points for one rated game: a win 3 (+1 against someone rated 100 or more above you), a draw 1, a loss 0;
   a tournament game is worth one more */
export function gamePoints({score, me, opp, tourney}) {
  let p = score === 1 ? 3 : score === .5 ? 1 : 0;
  if (score === 1 && opp >= me + 100) p++;
  if (tourney && score > 0) p++;
  return p;
}
export const placeBonus = place => ({1: 10, 2: 6, 3: 4}[place] || 0);
/* the table now: rivals and you, ranked (ties go your way) */
export function table(L, now) {
  const f = weekFrac(L.week, now), rows = rivals(L.week, L.div).map(rv => ({id: rv.id, name: rv.name, av: rv.av, pts: rivalPoints(rv, f)}));
  rows.push({id: 'you', name: 'You', av: 'human', pts: L.pts, you: true});
  rows.sort((a, b) => b.pts - a.pts || (b.you ? 1 : 0) - (a.you ? 1 : 0) || a.name.localeCompare(b.name));
  rows.forEach((x, i) => { x.rank = i + 1; x.zone = i < UP && L.div < DIVISIONS.length - 1 ? 'up' : i >= GROUP - DOWN && L.div > 0 ? 'down' : ''; });
  return rows;
}
/* a new week: settle the old one (your final place, up or down a division) and start fresh. Returns true when it changed */
export function rollover(L, now) {
  const key = weekKey(now);
  if (L.week === key) return false;
  const final = table(L, weekEnd(L.week)), me = final.find(x => x.you);
  let move = 'stay', div = L.div;
  if (!L.games) move = 'rest';
  else if (me.zone === 'up') { move = 'up'; div++; }
  else if (me.zone === 'down') { move = 'down'; div--; }
  const entry = {week: L.week, div: L.div, rank: me.rank, pts: L.pts, games: L.games, move};
  L.history = [...(L.history || []), entry].slice(-52);
  L.result = L.games ? entry : null;   /* shown once when you come back */
  L.best = Math.max(L.best || 0, div);
  Object.assign(L, {div, week: key, pts: 0, games: 0});
  return true;
}
export function addPoints(L, pts, now) {
  rollover(L, now);
  L.pts += pts; L.games++;
  return L;
}
