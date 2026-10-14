/* puzzles: the daily puzzle, rated puzzles, Puzzle Streak, Puzzle Rush, Puzzle Battle, themes and Your mistakes, on the main board.
   GPL-3.0-or-later. Puzzles come from the lichess puzzle database (CC0), see web/puzzles/README.md: the bundled list, or the
   full database when it is installed (server.py /api/puzzles). A puzzle's first move is the opponent's; after that the
   solution alternates. Any move that mates also counts as solving it.
   Your mistakes: the positions where a game review found you went wrong; any move about as good as the engine's counts, and a
   position you solve at the first try twice in a row leaves the list. The pure logic lives in puzzle-core.js. */
import * as C from './core.js';
import {$, el, toast, api} from './util.js';
import {analyze} from './analysis.js';
import {winPct, finalEval} from './review-core.js';
import {S} from './state.js';
import {SET, saveSettings} from './settings.js';
import {ICONS, icon} from './icons.js';
import * as K from './puzzle-core.js';

const RUSH_MS = 5 * 60e3, BATTLE_MS = 3 * 60e3, STRIKES = 3, PRACTISE_MIN = 15;
const RATED = new Set(['rated', 'theme']);                      /* these move your puzzle rating */
const TALLY = new Set(['rated', 'theme', 'daily', 'streak']);   /* these count for the themes (no clock pressure) */
const AUTO = new Set(['streak', 'rush', 'battle']);             /* the next puzzle comes by itself */
const FROM_DB = new Set(['rated', 'theme', 'streak', 'rush', 'battle']);
let list = null, counts = {}, app = null, timer = 0, practice = null, view = 'home', lastMsg = '';
const mins = ms => ms / 60e3;
const P = () => prefs();
const MODES = {
  rated: {name: 'Puzzles', art: 'avatars/mode-puzzles.webp', sub: () => `Rated ${P().rating}. Puzzles at your level`},
  streak: {name: 'Puzzle Streak', art: 'avatars/streak.webp', sub: () => `One mistake ends it. Best ${P().streakBest || 0}`},
  rush: {name: 'Puzzle Rush', art: 'avatars/pz-rush.webp', sub: () => `${mins(RUSH_MS)} minutes, 3 strikes, combos add time. Best ${P().rushBest || 0}`},
  battle: {name: 'Puzzle Battle', art: 'avatars/pz-bot.webp', sub: () => { const B = P().battle; return `Race a bot for ${mins(BATTLE_MS)} minutes.` + (B.played ? ` Won ${B.won} of ${B.played}` : ' Same puzzles, most solved wins'); }},
  mistakes: {name: 'Your mistakes', art: 'avatars/coach.webp', sub: () => practice == null ? 'Positions from your own games' : practice.length
    ? `${practice.length} ${practice.length === 1 ? 'position' : 'positions'} from your games` : 'Your game reviews fill this up'},
  daily: {name: 'Daily puzzle', list: false},
  theme: {name: 'Theme', list: false},
};

/* SET.puzzles may come from an older save: fill in what is missing (loading settings replaces nested objects whole) */
const DAILY0 = {date: '', id: '', done: '', last: '', streak: 0, best: 0, hist: [], recent: [], scored: ''};
const BATTLE0 = {played: 0, won: 0, lost: 0, drawn: 0, best: 0, pick: 0};
const normed = new WeakSet();
function prefs() {
  const p = SET.puzzles;
  if (!normed.has(p.daily || {})) { p.daily = Object.assign(structuredClone(DAILY0), p.daily); normed.add(p.daily); }
  if (!normed.has(p.battle || {})) { p.battle = Object.assign({...BATTLE0}, p.battle); normed.add(p.battle); }
  if (!Array.isArray(p.tally) || p.tally.length !== 3) p.tally = [0, 0, 0];
  if (!p.themes || typeof p.themes !== 'object') p.themes = {};
  return p;
}

async function loadPractice() {
  try { practice = (await api('/api/practice', {})).items || []; } catch (e) { practice = []; }
  return practice;
}
const CLS_NAME = {inaccuracy: 'an inaccuracy', miss: 'a miss', mistake: 'a mistake', blunder: 'a blunder'};
const seen = (() => { try { return new Set(JSON.parse(localStorage.getItem('aichess.pzseen') || '[]')); } catch (e) { return new Set(); } })();
function remember(id) {
  seen.delete(id); seen.add(id);
  const last = [...seen].slice(-600);
  if (seen.size > 900) { seen.clear(); for (const x of last) seen.add(x); }
  try { localStorage.setItem('aichess.pzseen', JSON.stringify(last)); } catch (e) {}
}
const prep = p => { p.ts = (p.t || '').split(' ').filter(Boolean); return p; };
/* one fetch at a time: the home panel draws several times while it opens */
let loading = null;
function load() {
  if (list) return Promise.resolve(list);
  if (!loading) loading = fetch('puzzles/puzzles.json').then(r => r.json()).then(l => {
    const c = {};
    for (const p of l) { prep(p); for (const t of p.ts) c[t] = (c[t] || 0) + 1; }
    counts = c; return list = l;
  }).finally(() => { loading = null; });
  return loading;
}
/* a random puzzle near the target from the bundled list: unseen ones at your level, then older ones at your level, then further away */
const pick = (target, {theme, exclude} = {}) => K.pickNear(list, target, {theme, seen, exclude: new Set(exclude || [])});
export function initPuzzles(api) { app = api; }

/* ---------- the full lichess database (optional, see server.py /api/puzzles) ---------- */
/* db: undefined (not asked yet), null (ask again), false (this version has none), or the status object */
let db, dbAt = 0, dbPoll = 0, dbThemes = null, dbAsk = null;
function dbStatus(force) {
  if (db === false || (!force && db && Date.now() - dbAt < 4000)) return Promise.resolve(db);
  if (!dbAsk) dbAsk = api('/api/puzzles').then(setDb).catch(e => { db = e.status && e.status !== 404 ? null : false; })   /* 404 or no server: not in this version, hide the card */
    .then(() => db).finally(() => { dbAsk = null; });
  return dbAsk;
}
function setDb(s) {
  const was = db && db.job && db.job.state === 'running';
  db = s; dbAt = Date.now();
  dbThemes = s.installed && Array.isArray(s.themes) ? new Map(s.themes.map(x => [x.name, x.n])) : null;
  if (was && s.installed) toast('The puzzle database is ready');
}
const dbOn = () => !!(db && db.installed);
async function dbPick(rating, {theme, exclude = [], count = 1, window} = {}) {
  const body = {rating: Math.round(rating), exclude: [...new Set([...seen, ...exclude])].slice(-600), count};
  if (theme) body.themes = [theme];
  if (window) body.window = window;
  const r = await api('/api/puzzles/pick', body);
  return (r.puzzles || []).filter(p => p && p.id && p.fen && p.moves).map(prep);
}
function dbFail(e) {
  console.warn('puzzle database', e);
  if (e && e.status === 400 && /not installed/i.test(e.message)) { db = null; dbThemes = null; }
}
/* how many puzzles there are for a theme: enough to practise it? */
const themeCount = t => dbThemes ? dbThemes.get(t) || 0 : counts[t] || 0;
const practisable = t => themeCount(t) >= PRACTISE_MIN;

/* ---------- a run (one mode, many puzzles) ---------- */
export async function startRun(mode, opts = {}) {
  if (mode === 'mistakes') return startPractice();
  try { await load(); } catch (e) { toast('Could not load the puzzles'); return; }
  clearInterval(timer);
  view = 'home';
  idleBoard();
  if (mode === 'battle' && opts.rating == null) { S.pzRun = {mode, setup: true, over: false}; renderPanel(); return; }
  const now = performance.now();
  const R = S.pzRun = {mode, n: 0, k: 0, done: 0, strikes: 0, score: 0, over: false, ids: new Set(), pre: null,
    skip: mode === 'streak' ? 1 : 0, startBest: P().streakBest || 0, theme: opts.theme || null, replay: !!opts.replay,
    combo: 0, comboBest: 0, mod: null, end: mode === 'rush' ? now + RUSH_MS : 0};
  if (mode === 'battle') return startBattle(R, opts.rating);
  if (mode === 'rush') timer = setInterval(tick, 200);
  next();
}
/* the board keeps the last puzzle but takes no moves (app.js: S.pzBoard without S.pz), and old timers see S.pz change and stop */
function idleBoard() { S.pz = null; }

async function puzzleFor(R) {
  if (R.mode === 'daily') return dailyPuzzle(R);
  if (R.mode === 'battle') return seqAt(R, R.n);
  const target = K.targetRating(R.mode, R.n, P().rating);
  if (dbOn() && FROM_DB.has(R.mode)) {
    const pre = R.pre && R.pre.k === R.k + 1 ? R.pre.p : null;
    R.pre = null;
    try {
      let p = (pre ? await pre : []).find(q => !R.ids.has(q.id));
      if (!p) p = (await dbPick(target, {theme: R.theme, exclude: [...R.ids]})).find(q => !R.ids.has(q.id));
      if (p) return p;
    } catch (e) { dbFail(e); }
  }
  return pick(target, {theme: R.theme, exclude: R.ids});
}
/* ask the database for the next one while this one is solved */
function prefetch(R) {
  if (!dbOn() || !FROM_DB.has(R.mode) || R.mode === 'battle') return;
  R.pre = {k: R.k + 1, p: dbPick(K.targetRating(R.mode, R.n + 1, P().rating), {theme: R.theme, exclude: [...R.ids]}).catch(e => { dbFail(e); return []; })};
}
async function next() {
  const R = S.pzRun;
  if (!R || R.over || R.loading || R.setup || R.out) return;
  if (R.mode === 'mistakes') return nextPractice();
  R.loading = true;
  retire(R); renderPanel();   /* a slow database: the old puzzle takes no more moves while the next one comes */
  let p = null;
  try { p = await puzzleFor(R); } catch (e) { console.warn('puzzle', e); }
  R.loading = false;
  if (S.pzRun !== R || R.over) return;
  if (!p) { endRun('No puzzle could be loaded.'); return; }
  R.k++; R.ids.add(p.id); remember(p.id);
  const pz = S.pz = {p, moves: p.moves.split(' '), idx: 0, state: 'opp', failed: false,
    rated: RATED.has(R.mode) && !R.replay, tally: TALLY.has(R.mode) && !R.replay && !(R.mode === 'daily' && P().daily.scored === p.id)};
  app.board(p.fen);
  app.setSides(new C.Pos(p.fen, 0, false).turn ^ 1);   /* you play the side that moves after the opponent's first move */
  if (R.k === 1) boardInView();
  prefetch(R);
  renderPanel();
  setTimeout(() => autoPlay(pz), 650);   /* this puzzle, whatever is on the board by then */
}
function autoPlay(pz) {
  if (S.pz !== pz || (pz.state !== 'opp' && pz.state !== 'busy') || pz.idx >= pz.moves.length) return;
  const m = S.pos.fromUci(pz.moves[pz.idx]);
  if (!m) { toast('This puzzle could not be loaded'); return broken(pz); }
  pz.idx++; pz.state = 'busy';
  app.play(m);
  if (pz.idx >= pz.moves.length) return broken(pz);   /* a line that ends on the opponent's move leaves you nothing to find */
  pz.state = 'you';
  renderPanel();
}
/* a puzzle that cannot be played: move on without a result */
function broken(pz) {
  const R = S.pzRun; pz.scored = true; pz.state = 'busy';
  if (!R || R.over) return;
  if (R.mode === 'daily') { endRun('This puzzle could not be loaded.'); return; }
  R.n++; next();
}
/* called by the board after any move while a puzzle is on */
export function puzzleMove(m, mover) {
  const pz = S.pz, R = S.pzRun;
  if (!pz || !R || pz.state !== 'you' || (mover != null && S.seats[mover]?.type !== 'human')) return;   /* only your own moves answer a puzzle */
  const want = pz.moves[pz.idx], uci = C.uci(m, false), mate = S.pos.status().over && S.pos.inCheck();
  if (pz.practice) {
    if (uci === want || mate) return practiceDone(pz, '');
    pz.state = 'busy'; renderPanel();
    goodEnough(pz, S.pos).then(ok => {
      if (S.pz !== pz) return;
      if (ok) practiceDone(pz, `Also good. The engine's move was ${pz.practice.bestSan}.`);
      else { app.takeBack(); wrong(pz); }
    });
    return;
  }
  if (uci === want || mate) {
    pz.idx++; pz.msg = '';
    if (R.mode === 'rush') comboUp(R);
    if (pz.idx >= pz.moves.length || mate) return solved(pz);
    pz.state = 'busy'; renderPanel();
    setTimeout(() => autoPlay(pz), 420);
  } else {
    pz.state = 'busy';
    if (R.mode === 'rush') { R.combo = 0; paintCombo(R); }   /* a wrong move ends the combo at once */
    renderPanel();
    setTimeout(() => { if (S.pz === pz && pz.state === 'busy') { app.takeBack(); wrong(pz); } }, 450);
  }
}
function solved(pz) {
  const R = S.pzRun;
  pz.state = 'solved'; app.sound(true);
  outcome(pz, !pz.failed);
  R.n++; R.done++; if (!pz.failed) R.score++;
  if (R.mode === 'daily' && !R.replay) dailyResult(R, pz.failed ? 'solved' : 'clean');
  if (R.mode === 'streak' && R.score > (P().streakBest || 0)) { P().streakBest = R.score; saveSettings(); }
  if (R.mode === 'battle') { R.log.push(1); paintRace(); if (battleCheck()) return; }
  renderPanel();
  if (AUTO.has(R.mode)) setTimeout(() => { if (S.pz === pz && S.pzRun === R) next(); }, 700);
}
function wrong(pz) {
  const R = S.pzRun;
  if (!R || R.over) return;
  pz.state = 'you';
  if (!pz.practice) outcome(pz, false);
  if (R.mode === 'streak') { endRun(`Streak over at ${R.score}.`); return; }
  if (R.mode === 'rush' || R.mode === 'battle') {
    R.strikes++; R.n++; R.done++;
    if (R.mode === 'battle') {
      R.log.push(0); R.out = R.strikes >= STRIKES; paintRace();
      if (battleCheck()) return;
      if (R.out) { retire(R); renderPanel(); return; }   /* you are out: the bot may still catch up */
    } else if (R.strikes >= STRIKES) { endRun(`Three strikes. You solved ${R.score}.`); return; }
    pz.state = 'busy'; renderPanel();
    setTimeout(() => { if (S.pzRun === R && S.pz === pz && !R.over) next(); }, 500);
    return;
  }
  pz.failed = true;
  pz.msg = 'Not the move. Try again, or see the solution.';
  renderPanel();
}
/* the one place a puzzle's result counts: the first result only, for the rating and the themes */
function outcome(pz, ok) {
  if (pz.scored) return;
  pz.scored = true;
  if (pz.rated) rate(pz, ok ? 1 : 0);
  if (pz.tally && pz.p.r) {
    const p = P(); K.tallyAdd(p.themes, p.tally, pz.p, ok);
    if (S.pzRun && S.pzRun.mode === 'daily') p.daily.scored = pz.p.id;   /* coming back to it later does not count twice */
    saveSettings();
  }
}
function rate(pz, score) {
  const p = P(), k = (p.played || 0) < 20 ? 40 : 20;
  const exp = 1 / (1 + Math.pow(10, (pz.p.r - p.rating) / 400));
  pz.delta = Math.round(k * (score - exp));
  p.rating = Math.max(100, p.rating + pz.delta); p.played = (p.played || 0) + 1; if (score) p.solved = (p.solved || 0) + 1;
  for (const Q of S.seats) if (Q && Q.type === 'human') Q.rating = p.rating;   /* the player strip shows the new rating */
  app.render();
  saveSettings();
}
function endRun(msg) {
  const R = S.pzRun; if (!R || R.over) return;
  R.over = true; R.msg = msg; clearInterval(timer);
  const p = P();
  if (R.mode === 'rush') {
    if (R.score > (p.rushBest || 0)) { p.rushBest = R.score; R.best = true; }
    if (R.comboBest > (p.rushCombo || 0)) { p.rushCombo = R.comboBest; R.bestCombo = true; }
    saveSettings();
  }
  if (R.mode === 'streak' && R.score > R.startBest) R.best = true;   /* a tie is not a new best */
  settle(R);
  renderPanel();
}
/* the run is over: the last puzzle stays on the board, which takes no more moves */
function settle(R) {
  R.left = R.end ? Math.max(0, R.end - performance.now()) : 0;
  retire(R);
}
/* done with the puzzle on the board: it stays there (as R.last) but takes no moves, and its timers stop (they see S.pz change) */
function retire(R) {
  if (S.pz) { S.pz.state = 'ended'; R.last = S.pz; }
  S.pz = null;
}
/* the clock for Rush and Battle, and the bot in Battle */
function tick() {
  const R = S.pzRun; if (!R || R.over || !R.end) { clearInterval(timer); return; }
  const now = performance.now();
  if (R.mode === 'battle') { botTick(R, now); if (R.over) return; }
  if (now >= R.end) { if (R.mode === 'battle') battleCheck(true); else endRun(`Time! You solved ${R.score}.`); return; }
  paintClock(R, now);
}
async function showSolution() {
  const pz = S.pz, R = S.pzRun; if (!pz || !R || pz.state !== 'you') return;
  if (pz.practice) record(pz, false);
  else outcome(pz, false);
  pz.failed = true;
  if (R.mode === 'daily' && !R.replay) dailyResult(R, 'shown');
  pz.state = 'busy'; renderPanel();
  while (S.pz === pz && pz.state === 'busy' && pz.idx < pz.moves.length) {
    await new Promise(r => setTimeout(r, 650));
    if (S.pz !== pz || pz.state !== 'busy') return;
    const m = S.pos.fromUci(pz.moves[pz.idx]); if (!m) break;
    pz.idx++; app.play(m);
  }
  if (S.pz === pz && pz.state === 'busy') { pz.state = 'shown'; R.done++; renderPanel(); }
}
function hint() {
  const pz = S.pz; if (!pz || pz.state !== 'you') return;
  const m = S.pos.fromUci(pz.moves[pz.idx]); if (!m) return;
  if (!pz.practice) outcome(pz, false);
  pz.failed = true; pz.hintAt = pz.idx; pz.msg = '';   /* solved with a hint: not at the first try. The circle is for this move only */
  S.circles = [{s: m & 127, c: 'b'}]; app.render(); renderPanel();
}
function skip() {
  const R = S.pzRun, pz = S.pz;
  if (!R || R.loading) return;
  if (pz && pz.state === 'you') { outcome(pz, false); R.done++; }   /* skipping one you have tried counts as a miss */
  next();
}

/* ---------- daily puzzle ---------- */
/* from the bundled list, chosen by the date and your rating; the choice is kept for the day */
function dailyPuzzle(R) {
  const D = P().daily, today = K.dayKey();
  let p = D.date === today ? list.find(q => q.id === D.id) : null;
  if (!p) {
    p = K.dailyChoice(list, today, P().rating, D.recent) || pick(P().rating + 100);
    Object.assign(D, {date: today, id: p.id, done: ''});
    D.recent = [...D.recent, p.id].slice(-90);
    saveSettings();
  }
  R.day = D.date;
  return p;
}
function dailyResult(R, how) { if (K.dailyMark(P().daily, R.day, how)) saveSettings(); }

/* ---------- Puzzle Rush combos ---------- */
function comboUp(R) {
  R.combo++; R.comboBest = Math.max(R.comboBest, R.combo);
  const b = K.comboBonus(R.combo);
  if (b) { R.end += b * 1e3; R.mod = {s: b, at: performance.now()}; paintMod(R); paintClock(R, performance.now()); setTimeout(() => paintMod(R), 1500); }
  paintCombo(R);
}

/* ---------- Puzzle Battle ---------- */
async function startBattle(R, rating) {
  Object.assign(R, {log: [], out: false, seq: [], loading: true,
    bot: {name: 'Puzzle bot', rating, i: 0, score: 0, strikes: 0, out: false, cur: null, log: []}});
  P().battle.pick = K.botChoices(P().rating).find(b => b.rating === rating)?.d ?? P().battle.pick; saveSettings();
  renderPanel();
  R.seq = await battleSeq();
  if (S.pzRun !== R) return;
  for (const p of R.seq) R.ids.add(p.id);
  const now = performance.now();
  R.loading = false; R.end = now + BATTLE_MS;
  R.bot.cur = K.botPlan(rating, seqAt(R, 0), now);
  timer = setInterval(tick, 100);
  next();
}
/* the same sequence for both of you: easy at first, harder as you go */
async function battleSeq() {
  const seq = [], used = new Set(), add = p => { if (p && !used.has(p.id)) { used.add(p.id); seq.push(p); } };
  if (dbOn()) {
    try {
      const parts = await Promise.all(Array.from({length: 12}, (_, c) => dbPick(K.targetRating('battle', c * 5 + 2, 0), {count: 5, window: 100})));
      for (const part of parts) part.sort((a, b) => a.r - b.r).forEach(add);
    } catch (e) { dbFail(e); seq.length = 0; used.clear(); }
  }
  if (seq.length < 30) for (let k = seq.length; k < 60; k++) add(pick(K.targetRating('battle', k, 0), {exclude: used}));
  return seq;
}
function seqAt(R, i) {
  while (R.seq.length <= i) {
    const used = new Set(R.seq.map(p => p.id));
    R.seq.push(pick(K.targetRating('battle', R.seq.length, 0), {exclude: used}));
  }
  return R.seq[i];
}
/* the bot finishes its puzzle: a point or a strike, then the next one, planned from when it finished (no drift in a slow tab) */
function botStep(R) {
  const B = R.bot, c = B.cur;
  if (c.solve) B.score++; else B.strikes++;
  B.log.push(c.solve ? 1 : 0); B.i++;
  if (B.strikes >= STRIKES) { B.out = true; B.cur = null; }
  else B.cur = K.botPlan(B.rating, seqAt(R, B.i), c.until);
}
function botTick(R, now) {
  const B = R.bot; let moved = false;
  while (!B.out && B.cur && now >= B.cur.until && B.cur.until <= R.end) { botStep(R); moved = true; }
  if (moved) { paintRace(); if (battleCheck()) return; }
  paintThink(R, now);
}
function battleCheck(timeUp) {
  const R = S.pzRun; if (!R || R.mode !== 'battle' || R.over || R.setup) return false;
  const e = K.battleEnd({score: R.score, out: R.out}, R.bot, !!timeUp || performance.now() >= R.end);
  if (e) endBattle(e);
  return !!e;
}
/* you are out and the bot is not ahead: play its remaining puzzles at once */
function finishNow() {
  const R = S.pzRun; if (!R || R.over || R.mode !== 'battle') return;
  const B = R.bot, you = {score: R.score, out: true};
  while (!B.out && B.cur && B.cur.until <= R.end && !K.battleEnd(you, B, false)) botStep(R);
  endBattle(K.battleEnd(you, B, false) || K.battleEnd(you, B, true));
}
function endBattle(e) {
  const R = S.pzRun; if (!R || R.over) return;
  const B = P().battle;
  R.result = e;
  B.played++; B[{win: 'won', loss: 'lost', draw: 'drawn'}[e.res]]++;
  if (R.score > (B.best || 0)) { B.best = R.score; R.best = true; }
  saveSettings();
  R.over = true; clearInterval(timer);
  settle(R);
  renderPanel();
}
const WHY = {time: 'Time is up.', both: 'Three strikes each.', 'you-out': 'Three strikes for you.', 'bot-out': 'Three strikes for the bot.'};

/* ---------- your mistakes (from game reviews) ---------- */
async function startPractice() {
  clearInterval(timer);
  view = 'home';
  await loadPractice();
  idleBoard();
  /* the ones you haven't got right yet first, then the ones you saw longest ago */
  const queue = practice.slice().sort((a, b) => (a.streak || 0) - (b.streak || 0) || (a.last || 0) - (b.last || 0)).slice(0, 25);
  S.pzRun = {mode: 'mistakes', n: 0, k: 0, done: 0, strikes: 0, score: 0, queue, total: queue.length, over: false, ids: new Set()};
  if (!queue.length) { S.pzRun.over = true; S.pzRun.msg = 'Nothing to practise yet'; S.pzRun.empty = true; renderPanel(); return; }
  nextPractice();
}
function nextPractice() {
  const R = S.pzRun, it = R.queue[R.n];
  if (!it) { endRun(`You fixed ${R.score} of ${R.total} at the first try.`); return; }
  S.pz = {p: {id: it.id, fen: it.fen, r: null}, moves: [it.best], idx: 0, state: 'you', failed: false, rated: false, practice: it, you: it.side};
  app.board(it.fen);
  app.setSides(it.side);
  if (R.n === 0) boardInView();
  renderPanel();
}
/* on a narrow screen the panel is under the board: bring the board back up when a run starts */
function boardInView() { const b = $('board'); if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({block: 'nearest'}); }
/* a move other than the engine's counts when it keeps about the same chances (within 4%) */
async function goodEnough(pz, after) {
  const before = new C.Pos(pz.practice.fen, 0, false), q = new C.Pos(after.fen(), 0, false);
  const [b, a] = [await analyze(before, 600, 14), finalEval(q) || await analyze(q, 600, 14)];
  if (!b || !a) return false;
  const mine = r => pz.you ? 100 - winPct(r) : winPct(r);
  return mine(a) >= mine(b) - 4;
}
function practiceDone(pz, note) {
  const R = S.pzRun;
  pz.state = 'solved'; pz.note = note; app.sound(true);
  if (!pz.failed) R.score++;
  pz.learned = record(pz, !pz.failed);
  renderPanel();
}
/* remember how it went: solved at the first try twice in a row and it leaves the list */
function record(pz, first) {
  const it = pz.practice; if (pz.recorded) return false;
  pz.recorded = true;
  const streak = first ? (it.streak || 0) + 1 : 0;
  if (streak >= 2) { api('/api/practice', {remove: it.id}).catch(() => {}); practice = (practice || []).filter(x => x.id !== it.id); return true; }
  Object.assign(it, {tries: (it.tries || 0) + 1, solved: (it.solved || 0) + (first ? 1 : 0), streak, last: Date.now()});
  api('/api/practice', {update: {id: it.id, tries: it.tries, solved: it.solved, streak, last: it.last}}).catch(() => {});
  return false;
}

/* leave the run for the puzzle home (the board keeps the puzzle, but takes no moves) */
/* leaving a battle that is under way counts as giving up, the same as the Give up button */
function leaveBattle() { const R = S.pzRun; if (R && R.mode === 'battle' && !R.over && !R.setup && R.end) endBattle({res: 'loss', why: 'gaveup'}); }
function toHome(v = 'home') {
  leaveBattle();
  clearInterval(timer);
  S.pzRun = null; idleBoard(); stripNote('');
  view = v; renderPanel();
}
export function exitPuzzles() {
  leaveBattle();
  clearInterval(timer);
  S.pz = null; S.pzRun = null; view = 'home';
  renderPanel();
  app.backToGame();
}

/* ================= the panel ================= */
let screen = null;
export function renderPanel() {
  const box = $('pzBody'); if (!box) return;
  box.innerHTML = '';
  const R = S.pzRun;
  if ((R || view) !== screen) { screen = R || view; box.scrollTop = 0; }   /* a new screen opens at the top */
  if (R) renderRun(box, R);
  else if (view === 'themes') renderThemes(box);
  else renderHome(box);
}
const head = (title, back) => el('div', {class: 'modehead'},
  el('button', {class: 'ib', type: 'button', title: 'Back to the puzzle modes', 'aria-label': 'Back', html: icon('caret-left'), onclick: back}), el('b', {}, title));

/* ---------- home: the daily puzzle, the modes, themes and the database ---------- */
function renderHome(box) {
  const p = P(); lastMsg = '';
  if (practice == null) loadPractice().then(() => { if (!S.pzRun && view === 'home') renderPanel(); });
  if (!list) load().then(() => { if (!S.pzRun && view === 'home') renderPanel(); }).catch(() => {});
  box.append(el('h2', {class: 'hubh'}, 'Puzzles'),
    el('p', {class: 'pzsub'}, `Your puzzle rating ${p.rating}` + (p.played ? ` · ${p.solved || 0} of ${p.played} solved` : '')));
  box.append(dailyCard());
  for (const [k, M] of Object.entries(MODES)) if (M.list !== false)
    box.append(el('button', {type: 'button', class: 'mode', onclick: () => startRun(k)}, el('img', {src: M.art, alt: ''}),
      el('span', {}, el('b', {}, M.name), el('small', {}, M.sub())), el('span', {class: 'ic', html: ICONS['caret-right']})));
  const dash = K.themeDash(p.themes, p.tally);
  const tsub = dash.weak.length ? `Needs work: ${dash.weak.slice(0, 2).map(x => K.themeName(x.t)).join(', ')}` : 'Forks, pins, mates: see where you are strong and practise the rest';
  box.append(el('button', {type: 'button', class: 'mode pzthemesbtn', onclick: () => { view = 'themes'; renderPanel(); }},
    el('img', {class: 'pzart', src: 'avatars/pz-themes.webp', alt: ''}), el('span', {}, el('b', {}, 'Themes'), el('small', {}, tsub)), el('span', {class: 'ic', html: ICONS['caret-right']})));
  box.append(el('div', {id: 'pzDb'}));
  box.append(el('p', {class: 'hint pzfoot'}, `${list ? list.length.toLocaleString('en') : 'About 3,000'} puzzles come with the game, from the lichess puzzle database (CC0), from beginner to master.`));
  paintDb();
  if (S.pzBoard) box.append(el('button', {class: 'pzexit', type: 'button', onclick: exitPuzzles}, 'Back to my game'));
  if (db !== false) dbStatus().then(paintDb);   /* cached for a few seconds */
}
function dailyCard() {
  const D = P().daily, today = K.dayKey(), done = D.date === today && D.done;
  const streak = K.dailyStreak(D, today);
  const days = el('div', {class: 'pzdays', role: 'list', 'aria-label': 'The last seven days'},
    ...K.dailyWeek(D, today).map(d => el('span', {class: 'pzday ' + d.state + (d.k === today ? ' now' : ''), role: 'listitem', title: dayTitle(d), 'aria-label': dayTitle(d)},
      el('small', {'aria-hidden': 'true'}, d.dow), el('i', {}))));
  let status, btns;
  if (!done) {
    status = streak ? `Solve it to make it ${streak + 1} days in a row.` : 'A new puzzle every day. Solve it to start a streak.';
    btns = [el('button', {class: 'primary', type: 'button', onclick: () => startRun('daily')}, 'Solve')];
  } else {
    status = D.done === 'shown' ? 'You saw the solution. A new puzzle tomorrow.' : 'Solved today, back tomorrow.';
    btns = [el('button', {type: 'button', title: 'Play it again, without stats', onclick: () => startRun('daily', {replay: true})}, 'Play again')];
  }
  return el('div', {class: 'pzdaily' + (done ? ' done' : '')},
    el('div', {class: 'pzdhead'}, el('img', {class: 'pzart sm', src: 'avatars/pz-daily.webp', alt: ''}),
      el('span', {class: 'pzdt'}, el('b', {}, 'Daily puzzle'), el('small', {}, new Date().toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'long'}))),
      el('span', {class: 'pzflame' + (streak ? ' on' : ''), title: `Days in a row. Best ${D.best || 0}`}, el('span', {class: 'ic', html: ICONS['flame-fill']}), el('b', {}, String(streak)), el('small', {}, streak === 1 ? 'day' : 'days'))),
    days,
    el('div', {class: 'pzdfoot'}, done && D.done !== 'shown' ? el('span', {class: 'ok', html: icon('check-circle-fill')}) : null, el('span', {class: 'grow'}, status), ...btns));
}
const dayTitle = d => ({done: 'Solved', miss: 'Missed', today: 'Today', shown: 'Solution seen'}[d.state]) + ' · ' + new Date(d.k + 'T12:00').toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'short'});

/* the database card: not installed / installing / installed */
function paintDb() {
  const box = $('pzDb'); if (!box) return;
  clearTimeout(dbPoll);
  box.replaceChildren();
  if (!db) return;   /* not in this version (or not known yet): just the bundled list */
  const job = db.job, running = job && job.state === 'running';
  const card = el('div', {class: 'pzdb'}), add = (...k) => card.append(...k.filter(Boolean));
  const top = (title, sub) => el('div', {class: 'pzdbhead'}, el('img', {class: 'pzart sm', src: 'avatars/pz-db.webp', alt: ''}), el('span', {class: 'pzdt'}, el('b', {}, title), sub ? el('small', {}, sub) : null));
  const act = async (path, label) => {
    try { setDb(await api(path, {})); } catch (e) { toast(`Could not ${label}: ${e.message}`); }
    paintDb();
  };
  if (running) {
    const pct = job.total ? Math.min(100, job.done / job.total * 100) : 0;
    add(top('Installing the puzzle database', 'You can keep solving meanwhile'),
      el('div', {class: 'pzdbstep'}, el('span', {class: 'grow'}, cap(job.step || 'starting')), job.total ? el('span', {class: 'n'}, `${K.fmtBytes(job.done)} of ${K.fmtBytes(job.total)}`) : null),
      el('div', {class: 'bar' + (job.total ? '' : ' wait'), role: 'progressbar', 'aria-valuenow': Math.round(pct)}, el('i', {style: `width:${job.total ? pct.toFixed(1) : 100}%`})));
  } else if (db.installed) {
    add(top(`${K.fmtCount(db.rows || 0)} puzzles`, 'The full lichess database is installed'),
      el('p', {class: 'pzdbtxt'}, 'Every mode picks from it, except the daily puzzle and Your mistakes.' + (db.built ? ` Built ${new Date(db.built).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})}.` : '')),
      el('div', {class: 'pzdbbtns'}, el('span', {class: 'grow n'}, db.size ? `${K.fmtBytes(db.size)} on disk` : ''),
        el('button', {class: 'danger', type: 'button', onclick: () => { if (confirm('Remove the puzzle database? The puzzles that come with the game stay.')) act('/api/puzzles/remove', 'remove it'); }}, 'Remove')));
  } else {
    const short = db.free != null && db.need != null && db.free < db.need;
    const why = !db.zstd ? 'Installing needs Python 3.14 or the zstandard package (pip install zstandard). The release build has it.'
      : short ? `Not enough disk space: ${K.fmtBytes(db.free)} free, ${K.fmtBytes(db.need)} needed.` : '';
    add(top('Get all lichess puzzles', 'Over 5 million, for offline play'),
      el('p', {class: 'pzdbtxt'}, `A one-time download of about 300 MB. It needs ${db.need ? K.fmtBytes(db.need) : 'about 1 GB'} free while it installs and about 600 MB after.`),
      job && job.state === 'error' ? el('p', {class: 'pzdberr'}, `The last install stopped: ${job.step}`) : null,
      why ? el('p', {class: 'pzdbwhy'}, why) : null,
      el('div', {class: 'pzdbbtns'}, el('span', {class: 'grow'}),
        el('button', {class: 'primary', type: 'button', disabled: !!why, onclick: () => act('/api/puzzles/install', 'start the install')},
          el('span', {class: 'ic', html: ICONS['download-simple'] || ''}), job && job.state === 'error' ? 'Try again' : 'Install')));
  }
  box.append(card);
  /* poll while the install runs and the card is on screen */
  if (running) dbPoll = setTimeout(async () => {
    if (!$('pzDb')?.isConnected || $('tab-puzzles')?.hidden) return;
    await dbStatus(true); paintDb();
    if (dbOn() && !S.pzRun && view === 'home') renderPanel();
  }, 1000);
}
const cap = s => String(s).replace(/^./, c => c.toUpperCase());

/* ---------- themes: how you do by theme, and practice ---------- */
function renderThemes(box) {
  const p = P(), dash = K.themeDash(p.themes, p.tally), [n, first] = p.tally; lastMsg = '';
  if (!list) load().then(() => { if (!S.pzRun && view === 'themes') renderPanel(); }).catch(() => {});
  box.append(head('Themes', () => { view = 'home'; renderPanel(); }));
  box.append(el('p', {class: 'pzsub'}, 'How you do by theme, at the first try. Rated, daily and streak puzzles count.'));
  if (n) box.append(el('div', {class: 'pzstats'}, stat(`${Math.round(first / n * 100)}%`, 'First try'), stat(String(dash.perf), 'Performance', null, null, 'Average puzzle rating, minus 500, plus 1000 times your first-try share'), stat(String(n), 'Puzzles')));
  if (!dash.weak.length && !dash.strong.length)
    box.append(el('div', {class: 'pzempty'}, el('span', {class: 'ic', html: ICONS['chart-bar'] || ''}),
      el('span', {}, el('b', {}, n ? 'Not enough yet' : 'Nothing here yet'), el('small', {}, `Solve a few more puzzles. A theme shows up as a strength or a weak spot after ${K.MIN_PLAYED} tries.`))));
  if (dash.weak.length) box.append(themeList('Needs work', dash.weak.map(x => x.t)));
  if (dash.strong.length) box.append(themeList('Strengths', dash.strong.map(x => x.t)));
  for (const [g, ts] of K.THEME_GROUPS) box.append(themeList(g, ts));
}
function themeList(title, ts) {
  const T = P().themes;
  return el('section', {class: 'pzgroup'}, el('h3', {}, title), el('div', {class: 'pzrows'}, ...ts.map(t => {
    const r = T[t], can = practisable(t), pct = r && r[0] ? Math.round(r[1] / r[0] * 100) : null;
    const tip = r ? `${K.themeName(t)}: ${r[1]} of ${r[0]} at the first try, puzzles rated ${Math.round(r[2] / r[0])} on average` : `${K.themeName(t)}: not tried yet`;
    return el('div', {class: 'pzt' + (r ? '' : ' untried'), title: tip},
      el('span', {class: 'nm'}, el('b', {}, K.themeName(t)), el('small', {}, r ? `${r[0]} played` : 'Not tried yet')),
      el('span', {class: 'acc'}, el('span', {class: 'v'}, pct == null ? '' : pct + '%'), pct == null ? null : el('span', {class: 'track'}, pct ? el('i', {style: `width:${pct}%`}) : null)),
      el('button', {type: 'button', class: 'pzgo', disabled: !can, title: can ? `Practise ${K.themeName(t)}` : 'Not enough puzzles for this theme yet', onclick: () => startRun('theme', {theme: t})}, 'Practise'));
  })));
  if (S.pzBoard) box.append(el('button', {class: 'pzexit', type: 'button', onclick: exitPuzzles}, 'Back to my game'));
}

/* ---------- a run ---------- */
function renderRun(box, R) {
  const M = MODES[R.mode], pz = S.pz || (R.over || R.out || R.loading ? R.last : null), it = pz && pz.practice;
  const you = pz && pz.p.fen ? pz.you ?? (new C.Pos(pz.p.fen, 0, false).turn ^ 1) : 0;
  const title = R.mode === 'theme' ? K.themeName(R.theme) : R.mode === 'daily' && R.replay ? 'Daily puzzle (again)' : M.name;
  box.append(head(title, () => toHome(R.mode === 'theme' ? 'themes' : 'home')));
  if (R.setup) return renderSetup(box, R);
  /* the scoreboard */
  const p = P(), stats = el('div', {class: 'pzstats'});
  if (R.mode === 'rated') stats.append(stat(String(p.rating), 'Rating', pz?.delta));
  if (R.mode === 'theme') stats.append(stat(String(p.rating), 'Rating', pz?.delta), stat(`${R.score}/${R.done}`, 'First try'));
  if (R.mode === 'daily') { const D = p.daily; stats.append(stat(String(K.dailyStreak(D, K.dayKey())), 'Days in a row', null, 'streak'), stat(String(D.best || 0), 'Best')); }
  if (R.mode === 'streak') stats.append(stat(String(R.score), 'Streak', null, 'streak'), stat(String(p.streakBest || 0), 'Best'));
  if (R.mode === 'mistakes' && R.total) stats.append(stat(`${Math.min(R.n + 1, R.total)} / ${R.total}`, 'Position'), stat(String(R.score), 'First try'));
  if (R.mode === 'rush') stats.append(stat(K.fmtClock(R.over ? R.left : R.end - performance.now()), 'Time', null, 'time'), stat(String(R.score), 'Solved'), strikes(R.strikes));
  if (stats.childNodes.length) box.append(stats);
  if (R.mode === 'rush') box.append(comboMeter(R));
  if (R.mode === 'battle') box.append(raceCard(R));
  /* what to do now */
  let h = '', cls = '', sub = '';
  if (R.over && R.result) {
    const [a, b] = [R.score, R.bot.score];
    h = R.result.why === 'gaveup' ? 'You gave up' : R.result.res === 'win' ? `You win ${a}-${b}` : R.result.res === 'loss' ? `Puzzle bot wins ${b}-${a}` : `Draw ${a}-${b}`;
    cls = R.result.res === 'win' ? 'good' : R.result.res === 'loss' ? 'bad' : '';
    sub = (R.result.why === 'gaveup' ? `It counts as a loss. The score was ${a}-${b}.` : WHY[R.result.why]) + (R.best ? ' Your best battle score.' : '');
  } else if (R.over) {
    h = R.msg; cls = R.best ? 'good' : '';
    sub = [R.best ? 'New personal best.' : '', R.mode === 'rush' && R.comboBest ? `Best combo ${R.comboBest}${R.bestCombo ? ', your best yet' : ''}.` : '',
      R.empty ? 'After a game review, the moves where you went wrong come back here as puzzles.' : ''].filter(Boolean).join(' ');
  } else if (R.mode === 'battle' && R.out) { h = 'You are out'; sub = outLine(R); }
  else if (R.loading) { h = pz ? 'Getting the next puzzle' : 'Getting puzzles ready'; sub = !pz && R.mode === 'battle' ? 'The same ones for you and the bot.' : ''; }
  else if (it && pz.state === 'solved') { h = pz.failed ? 'Solved' : 'Fixed'; cls = 'good'; sub = [pz.note, pz.learned ? 'Twice in a row: this one leaves your list.' : ''].filter(Boolean).join(' '); }
  else if (it && pz.state === 'shown') { h = 'That was the move'; sub = `${it.bestSan}. In the game you played ${it.played}.`; }
  else if (it && pz.state === 'busy') { h = 'Checking…'; sub = 'The engine looks at your move.'; }
  else if (it && !(pz.msg && pz.state === 'you') && pz.hintAt !== pz.idx) { h = `${you ? 'Black' : 'White'} to move`; sub = `Against ${it.opp}, move ${it.move}, you played ${it.played}: ${CLS_NAME[it.cls] || 'a mistake'}. Find a better move.`; }
  else if (!pz || pz.state === 'opp') { h = 'Get ready'; sub = 'Your opponent moves first.'; }
  else if (pz.state === 'solved') { h = 'Solved'; cls = 'good'; sub = R.mode === 'daily' ? (R.replay ? 'No stats this time.' : dailyLine()) : pz.rated ? (pz.failed ? 'Not counted: you needed help.' : `Puzzle rated ${pz.p.r}.`) : pz.p.r ? `Puzzle rated ${pz.p.r}.` : ''; }
  else if (pz.state === 'shown') { h = 'That was the solution'; sub = (pz.p.r ? `Puzzle rated ${pz.p.r}.` : '') + (R.mode === 'daily' && !R.replay ? ' The streak needs you to finish it yourself.' : ''); }
  else if (pz.msg && pz.state === 'you') { h = 'Try again'; cls = 'bad'; sub = pz.msg; }
  else if (pz.hintAt === pz.idx && pz.state === 'you') { h = 'Hint: the circled piece moves'; sub = pz.rated ? 'This one no longer counts as solved.' : ''; }
  else { h = `${you ? 'Black' : 'White'} to move`; sub = R.mode === 'daily' ? 'Find the best move. Take your time.' : 'Find the best move.'; }
  const key = h + cls, msg = el('div', {class: 'pzmsg ' + cls + (key === lastMsg ? ' still' : ''), role: 'status'},
    el('span', {class: 'side ' + (you ? 'b' : 'w')}), el('div', {}, el('b', {}, h), sub ? el('small', {id: 'pzSub'}, sub) : null));
  lastMsg = key;   /* the message pops in only when it changes */
  box.append(msg);
  /* the puzzle's themes: each one starts a practice run */
  const showThemes = pz && pz.p.ts && ((['rated', 'theme', 'daily'].includes(R.mode) && (pz.state === 'solved' || pz.state === 'shown')) || (R.over && ['streak', 'rush'].includes(R.mode)));
  if (showThemes) {
    const ts = pz.p.ts.filter(t => !K.META.has(t));
    if (ts.length) box.append(el('div', {class: 'pzchips', 'aria-label': 'Themes of this puzzle'}, ...ts.map(t => practisable(t) && t !== R.theme
      ? el('button', {type: 'button', class: 'pzchip', title: `Practise ${K.themeName(t)}`, onclick: () => startRun('theme', {theme: t})}, K.themeName(t))
      : el('span', {class: 'pzchip'}, K.themeName(t)))));
  }
  box.append(buttons(R, pz));
  box.append(el('button', {class: 'pzexit', type: 'button', onclick: exitPuzzles}, 'Back to my game'));
  if (R.mode === 'rush') paintCombo(R);
  if (R.mode === 'battle') paintRace();
  if (R.end && !R.over) { const now = performance.now(); paintClock(R, now); paintMod(R); if (R.mode === 'battle') paintThink(R, now); }
}
const outLine = R => `Puzzle bot is still going: ${R.bot.score} to your ${R.score}.`;
const dailyLine = () => { const s = K.dailyStreak(P().daily, K.dayKey()); return s > 1 ? `${s} days in a row. Back tomorrow.` : 'Back tomorrow for the next one.'; };
function buttons(R, pz) {
  const btns = el('div', {class: 'pzbtns'}), B = (label, onclick, o = {}) => el('button', {type: 'button', onclick, ...o}, label);
  const waiting = !pz || pz.state !== 'you', after = pz && (pz.state === 'solved' || pz.state === 'shown');
  if (R.over && R.mode === 'battle') btns.append(B('Rematch', () => startRun('battle', {rating: R.bot.rating}), {class: 'primary'}), B('Other modes', () => toHome()));
  else if (R.over && R.mode === 'daily') btns.append(B('Back to puzzles', () => toHome(), {class: 'primary'}));
  else if (R.over) btns.append(B('Play again', () => startRun(R.mode, {theme: R.theme}), {class: 'primary'}), B('Other modes', () => toHome()));
  else if (R.mode === 'mistakes') {
    if (after) btns.append(B(R.n + 1 < R.total ? 'Next position' : 'Finish', () => { R.n++; next(); }, {class: 'primary'}));
    else btns.append(B('Hint', hint, {disabled: waiting}), B('Solution', showSolution, {disabled: waiting}), B('Skip', () => { R.n++; next(); }));
  } else if (R.mode === 'daily') {
    if (after) btns.append(B('Back to puzzles', () => toHome(), {class: 'primary'}));
    else btns.append(B('Hint', hint, {disabled: waiting}), B('Solution', showSolution, {disabled: waiting}));
  } else if (RATED.has(R.mode)) {
    if (after) btns.append(B('Next puzzle', () => next(), {class: 'primary', disabled: !!R.loading}));
    else btns.append(B('Hint', hint, {disabled: waiting}), B('Solution', showSolution, {disabled: waiting}),
      B('Skip', skip, {disabled: waiting || !!R.loading, title: 'Counts as a miss'}));
  } else if (R.mode === 'streak') btns.append(B(`Skip (${R.skip})`, () => { R.skip = 0; next(); }, {disabled: !R.skip || waiting, title: 'One skip per streak'}), B('End', () => endRun(`You stopped at ${R.score}.`)));
  else if (R.mode === 'battle') {
    if (R.out) btns.append(B('Finish now', finishNow, {class: 'primary', title: 'Play out the bot\'s remaining puzzles at once'}));
    else btns.append(B('Give up', () => endBattle({res: 'loss', why: 'gaveup'}), {disabled: !!R.loading, title: 'Counts as a loss'}));
  } else btns.append(B('End run', () => endRun(`You solved ${R.score}.`)));
  return btns;
}
function stat(v, label, delta, kind, title) {
  return el('div', {class: 'pzstat' + (kind ? ' ' + kind : ''), title: title || null},
    el('b', {id: kind === 'time' ? 'pzTime' : null}, kind === 'streak' ? el('span', {class: 'flame', html: ICONS['flame-fill']}) : null, v,
      delta != null ? el('span', {class: delta >= 0 ? 'up' : 'down'}, (delta >= 0 ? ' +' : ' ') + delta) : null,
      kind === 'time' ? el('span', {class: 'pzmod', id: 'pzMod', 'aria-live': 'polite'}) : null), el('small', {}, label));
}
const pipsLabel = n => `${n} of ${STRIKES} strikes`;
const pips = n => el('b', {class: 'pips', role: 'img', 'aria-label': pipsLabel(n)}, ...Array.from({length: STRIKES}, (_, i) => el('i', {class: i < n ? 'on' : '', html: ICONS.x})));
const strikes = n => el('div', {class: 'pzstat strikes'}, pips(n), el('small', {}, 'Strikes'));
/* ---------- in-place painting (no rebuild, so nothing pops in again) ---------- */
function paintClock(R, now) {
  const t = $('pzTime'); if (!t) return;
  const left = R.end - now, txt = K.fmtClock(left);
  if (t.firstChild && t.firstChild.nodeType === 3) t.firstChild.textContent = txt; else t.prepend(txt);
  t.classList.toggle('low', left <= 20e3);
}
/* "+5s" next to the clock: drawn from R.mod's time, so a rebuilt panel keeps it where it was */
function paintMod(R) {
  const e = $('pzMod'); if (!e || !R.mod) return;
  const age = performance.now() - R.mod.at;
  if (age > 1400) { e.textContent = ''; return; }
  e.textContent = `+${R.mod.s}s`;
  e.style.animation = 'none'; void e.offsetWidth;
  e.style.animation = `pzMod 1.4s var(--ease) ${-Math.round(age)}ms both`;
}
function comboMeter(R) {
  return el('div', {class: 'pzcombo', id: 'pzCombo'}, el('div', {class: 'row'}, el('span', {}, 'Combo ', el('b', {class: 'n'})), el('span', {class: 'nx'})),
    el('div', {class: 'meter'}, el('i', {})));
}
function paintCombo(R) {
  const box = $('pzCombo'); if (!box) return;
  const L = K.comboLevel(R.combo);
  box.querySelector('.n').textContent = R.combo;
  box.querySelector('.nx').textContent = `+${L.bonus}s at ${L.to}`;
  box.querySelector('.meter i').style.transform = `scaleX(${(R.combo - L.from) / (L.to - L.from)})`;
  box.classList.toggle('hot', R.combo >= 5);
}
function raceCard(R) {
  const lane = (who, name, rating, img) => el('div', {class: 'lane', id: 'lane' + who},
    el('img', {class: 'av', src: img, alt: ''}), el('span', {class: 'who'}, el('b', {}, name), el('small', {}, String(rating))),
    pips(0), el('b', {class: 'score'}, '0'),
    el('span', {class: 'row2'}, el('span', {class: 'trail', role: 'img', 'aria-label': 'No results yet'}),
      who === 'Bot' ? el('span', {class: 'think', title: 'The bot working on its puzzle'}, el('i', {id: 'botThink'})) : null));
  const card = el('div', {class: 'pzrace'}, el('div', {class: 'racehead'}, el('small', {}, 'Time left'), el('b', {id: R.over ? null : 'pzTime', class: 'rclock'}, K.fmtClock(R.over ? R.left : R.end ? R.end - performance.now() : BATTLE_MS))),
    lane('You', 'You', P().rating, 'avatars/human.webp'), lane('Bot', R.bot.name, R.bot.rating, 'avatars/pz-bot.webp'));
  return card;
}
const dot = ok => el('i', {class: ok ? 'ok' : 'no', html: ok ? '' : ICONS.x});
function paintRace() {
  const R = S.pzRun; if (!R || R.mode !== 'battle' || R.setup) return;
  for (const [who, L] of [['You', {score: R.score, strikes: R.strikes, log: R.log || [], out: R.out}], ['Bot', R.bot]]) {
    const lane = $('lane' + who); if (!lane) continue;
    lane.querySelector('.score').textContent = L.score;
    lane.querySelectorAll('.pips i').forEach((e, i) => e.classList.toggle('on', i < L.strikes));
    lane.querySelector('.pips').setAttribute('aria-label', pipsLabel(L.strikes));
    lane.classList.toggle('out', !!L.out);
    lane.classList.toggle('lead', !!R.over && L.score > (who === 'You' ? R.bot.score : R.score));
    const tr = lane.querySelector('.trail');
    if (tr.childElementCount !== Math.min(12, L.log.length) || tr.dataset.n !== String(L.log.length)) {
      const last = L.log.slice(-12), ok = last.filter(Boolean).length;
      tr.dataset.n = L.log.length; tr.replaceChildren(...last.map(dot));
      tr.setAttribute('aria-label', last.length ? `Last results: ${ok} solved, ${last.length - ok} missed` : 'No results yet');
    }
  }
  if (R.out && !R.over && $('pzSub')) $('pzSub').textContent = outLine(R);   /* you are out: the bot's score in the message keeps up */
  stripNote(R.over ? '' : `Puzzle bot ${R.bot.score}` + (R.bot.strikes ? ` · ${R.bot.strikes} ${R.bot.strikes === 1 ? 'strike' : 'strikes'}` : ''));
}
/* the bot's score on the opponent's player strip too, for narrow windows where the panel is under the board (app.js shows pzNote) */
function stripNote(note) {
  const Q = S.seats.find(x => x && x.type === 'puzzle');
  if (Q && (Q.pzNote || '') !== note) { Q.pzNote = note; app.render(); }
}
function paintThink(R, now) {
  const b = $('botThink'), c = R.bot && R.bot.cur; if (!b) return;
  const f = !c || R.over || R.bot.out ? 0 : Math.max(0, Math.min(1, (now - c.t0) / (c.until - c.t0)));
  b.style.transform = `scaleX(${f})`;
}
/* ---------- Battle: choose the bot ---------- */
function renderSetup(box, R) {
  const p = P(), B = p.battle, bots = K.botChoices(p.rating), LABEL = {'-300': 'Easier', 0: 'About your level', 300: 'Harder'};
  let sel = bots.some(b => b.d === B.pick) ? B.pick : 0;
  box.append(el('p', {class: 'pzsub'}, `Race a puzzle bot through the same puzzles for ${mins(BATTLE_MS)} minutes. Three wrong moves and you are out. The most solved wins.`));
  const opts = el('div', {class: 'pzbots', role: 'radiogroup', 'aria-label': 'Your opponent'});
  const paint = () => { for (const b of opts.children) { const on = +b.dataset.d === sel; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); } };
  for (const b of bots) opts.append(el('button', {type: 'button', class: 'pzbot', role: 'radio', 'data-d': b.d, onclick: () => { sel = b.d; paint(); }},
    el('img', {src: 'avatars/pz-bot.webp', alt: ''}), el('span', {class: 'who'}, el('b', {}, 'Puzzle bot'), el('small', {}, LABEL[b.d])), el('span', {class: 'r'}, String(b.rating))));
  paint();
  box.append(opts);
  if (B.played) box.append(el('p', {class: 'pzrec'}, `Played ${B.played} · won ${B.won} · lost ${B.lost}` + (B.drawn ? ` · drawn ${B.drawn}` : '') + ` · best score ${B.best}`));
  box.append(el('div', {class: 'pzbtns'}, el('button', {type: 'button', class: 'primary', onclick: () => startRun('battle', {rating: bots.find(b => b.d === sel).rating})}, el('span', {class: 'ic', html: ICONS['sword-fill'] || ''}), 'Start battle')));
  box.append(el('button', {class: 'pzexit', type: 'button', onclick: exitPuzzles}, 'Back to my game'));
}
