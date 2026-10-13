/* puzzles: rated puzzles, Puzzle Streak, Puzzle Rush and Your mistakes on the main board. GPL-3.0-or-later
   Puzzles come from the lichess puzzle database (CC0), see web/puzzles/README.md. A puzzle's first move is the
   opponent's; after that the solution alternates. Any move that mates also counts as solving it.
   Your mistakes: the positions where a game review found you went wrong; any move about as good as the engine's counts, and a
   position you solve at the first try twice in a row leaves the list. */
import * as C from './core.js';
import {$, el, toast, esc, api} from './util.js';
import {analyze} from './analysis.js';
import {winPct, finalEval} from './review-core.js';
import {S} from './state.js';
import {SET, saveSettings} from './settings.js';
import {ICONS, icon} from './icons.js';

let list = null, app = null, timer = 0, practice = null;
const MODES = {
  rated: {name: 'Puzzles', art: 'avatars/mode-puzzles.webp', sub: () => `Rated ${SET.puzzles.rating}. Puzzles at your level`},
  streak: {name: 'Puzzle Streak', art: 'avatars/streak.webp', sub: () => `One mistake ends it. Best ${SET.puzzles.streakBest || 0}`},
  rush: {name: 'Puzzle Rush', art: 'avatars/mode-bots.webp', sub: () => `5 minutes, 3 strikes. Best ${SET.puzzles.rushBest || 0}`},
  mistakes: {name: 'Your mistakes', art: 'avatars/coach.webp', sub: () => practice == null ? 'Positions from your own games' : practice.length
    ? `${practice.length} ${practice.length === 1 ? 'position' : 'positions'} from your games` : 'Your game reviews fill this up'},
};
async function loadPractice() {
  try { practice = (await api('/api/practice', {})).items || []; } catch (e) { practice = []; }
  return practice;
}
const CLS_NAME = {inaccuracy: 'an inaccuracy', miss: 'a miss', mistake: 'a mistake', blunder: 'a blunder'};
const seen = (() => { try { return new Set(JSON.parse(localStorage.getItem('aichess.pzseen') || '[]')); } catch (e) { return new Set(); } })();
function remember(id) {
  seen.add(id);
  try { localStorage.setItem('aichess.pzseen', JSON.stringify([...seen].slice(-600))); } catch (e) {}
}
async function load() {
  if (!list) list = await (await fetch('puzzles/puzzles.json')).json();
  return list;
}
/* a random unseen puzzle near the target rating */
function pick(target) {
  for (const w of [80, 160, 320, 3000]) {
    const c = list.filter(p => Math.abs(p.r - target) <= w && !seen.has(p.id));
    if (c.length) return c[Math.floor(Math.random() * c.length)];
  }
  seen.clear();
  return list[Math.floor(Math.random() * list.length)];
}
export function initPuzzles(api) { app = api; }

/* ---------- a run (one mode, many puzzles) ---------- */
export async function startRun(mode) {
  if (mode === 'mistakes') return startPractice();
  await load();
  clearInterval(timer);
  S.pzRun = {mode, n: 0, strikes: 0, score: 0, skip: mode === 'streak' ? 1 : 0, end: mode === 'rush' ? performance.now() + 5 * 60e3 : 0, over: false};
  if (mode === 'rush') timer = setInterval(tickRush, 200);
  next();
}
function targetRating() {
  const R = S.pzRun;
  if (R.mode === 'streak') return 700 + R.n * 45;
  if (R.mode === 'rush') return 550 + R.n * 70;
  return SET.puzzles.rating;
}
function next() {
  const R = S.pzRun;
  if (!R || R.over) return;
  if (R.mode === 'mistakes') return nextPractice();
  const p = pick(targetRating());
  remember(p.id);
  const moves = p.moves.split(' ');
  S.pz = {p, moves, idx: 0, state: 'opp', failed: false, rated: R.mode === 'rated'};
  app.board(p.fen);
  const pos = new C.Pos(p.fen, 0, false);
  app.setSides(pos.turn ^ 1);   /* you play the side that moves after the opponent's first move */
  renderPanel();
  setTimeout(() => autoPlay(S.pz), 650);
}
function autoPlay(pz) {
  if (S.pz !== pz || pz.idx >= pz.moves.length) return;
  const m = S.pos.fromUci(pz.moves[pz.idx]);
  if (!m) { toast('This puzzle could not be loaded'); next(); return; }
  pz.idx++; pz.state = 'busy';
  app.play(m);
  pz.state = pz.idx >= pz.moves.length ? 'done' : 'you';
  renderPanel();
}
/* called by the board after any move while a puzzle is on */
export function puzzleMove(m, mover) {
  const pz = S.pz;
  if (!pz || pz.state !== 'you') return;
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
    pz.idx++;
    if (pz.idx >= pz.moves.length || mate) return solved(pz);
    pz.state = 'busy'; renderPanel();
    setTimeout(() => { if (S.pz === pz) { autoPlay(pz); } }, 420);
  } else {
    pz.state = 'busy';
    setTimeout(() => { if (S.pz === pz) { app.takeBack(); wrong(pz); } }, 450);
  }
}
function solved(pz) {
  const R = S.pzRun;
  pz.state = 'solved'; app.sound(true);
  if (pz.rated && !pz.failed) rate(pz, 1);
  R.n++; R.score++;
  if (R.mode === 'streak' && R.score > (SET.puzzles.streakBest || 0)) { SET.puzzles.streakBest = R.score; saveSettings(); }
  renderPanel();
  if (R.mode !== 'rated') setTimeout(() => { if (S.pz === pz) next(); }, 700);
}
function wrong(pz) {
  const R = S.pzRun;
  pz.state = 'you';
  if (R.mode === 'rated' || R.mode === 'mistakes') {
    if (!pz.failed) { pz.failed = true; if (pz.rated) rate(pz, 0); }
    pz.msg = 'Not the move. Try again, or see the solution.';
  } else if (R.mode === 'streak') {
    endRun(`Streak over at ${R.score}.`);
  } else {
    R.strikes++;
    if (R.strikes >= 3) endRun(`Three strikes. You solved ${R.score}.`);
    else { R.n++; pz.state = 'busy'; renderPanel(); setTimeout(next, 500); return; }
  }
  renderPanel();
}
function rate(pz, score) {
  const P = SET.puzzles, k = (P.played || 0) < 20 ? 40 : 20;
  const exp = 1 / (1 + Math.pow(10, (pz.p.r - P.rating) / 400));
  pz.delta = Math.round(k * (score - exp));
  P.rating = Math.max(100, P.rating + pz.delta); P.played = (P.played || 0) + 1; if (score) P.solved = (P.solved || 0) + 1;
  saveSettings();
}
function endRun(msg) {
  const R = S.pzRun; if (!R || R.over) return;
  R.over = true; R.msg = msg; clearInterval(timer);
  if (R.mode === 'rush' && R.score > (SET.puzzles.rushBest || 0)) { SET.puzzles.rushBest = R.score; R.best = true; saveSettings(); }
  if (R.mode === 'streak' && R.score >= (SET.puzzles.streakBest || 0) && R.score > 0) R.best = true;
  if (S.pz) S.pz.state = 'ended';
  renderPanel();
}
function tickRush() {
  const R = S.pzRun; if (!R || R.over) { clearInterval(timer); return; }
  const left = R.end - performance.now();
  if (left <= 0) endRun(`Time! You solved ${R.score}.`);
  const t = $('pzTime'); if (t) { const s = Math.max(0, Math.ceil(left / 1000)); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; t.classList.toggle('low', s <= 20); }
}
async function showSolution() {
  const pz = S.pz; if (!pz) return;
  if (pz.practice) record(pz, false);
  pz.failed = true; pz.state = 'busy'; renderPanel();
  while (S.pz === pz && pz.idx < pz.moves.length) {
    await new Promise(r => setTimeout(r, 650));
    if (S.pz !== pz) return;
    const m = S.pos.fromUci(pz.moves[pz.idx]); if (!m) break;
    pz.idx++; app.play(m);
  }
  if (S.pz === pz) { pz.state = 'shown'; renderPanel(); }
}
function hint() {
  const pz = S.pz; if (!pz || pz.state !== 'you') return;
  const m = S.pos.fromUci(pz.moves[pz.idx]); if (!m) return;
  if (pz.rated && !pz.failed) { pz.failed = true; rate(pz, 0); pz.msg = 'Hint used: this one no longer counts as solved.'; }
  if (pz.practice) pz.failed = true;   /* solved with a hint: not at the first try */
  S.circles = [{s: m & 127, c: 'b'}]; app.render(); renderPanel();
}
/* ---------- your mistakes (from game reviews) ---------- */
async function startPractice() {
  clearInterval(timer);
  await loadPractice();
  /* the ones you haven't got right yet first, then the ones you saw longest ago */
  const queue = practice.slice().sort((a, b) => (a.streak || 0) - (b.streak || 0) || (a.last || 0) - (b.last || 0)).slice(0, 25);
  S.pzRun = {mode: 'mistakes', n: 0, strikes: 0, score: 0, queue, total: queue.length, over: false};
  if (!queue.length) { S.pzRun.over = true; S.pzRun.msg = 'Nothing to practise yet'; S.pzRun.empty = true; renderPanel(); return; }
  nextPractice();
}
function nextPractice() {
  const R = S.pzRun, it = R.queue[R.n];
  if (!it) { endRun(`You fixed ${R.score} of ${R.total} at the first try.`); return; }
  S.pz = {p: {id: it.id, fen: it.fen, r: null}, moves: [it.best], idx: 0, state: 'you', failed: false, rated: false, practice: it, you: it.side};
  app.board(it.fen);
  app.setSides(it.side);
  renderPanel();
}
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

export function exitPuzzles() {
  clearInterval(timer);
  S.pz = null; S.pzRun = null;
  renderPanel();
  app.backToGame();
}

/* ---------- the panel ---------- */
export function renderPanel() {
  const box = $('pzBody'); if (!box) return;
  const R = S.pzRun, pz = S.pz;
  box.innerHTML = '';
  if (!R) {
    if (practice == null) loadPractice().then(() => { if (!S.pzRun) renderPanel(); });
    box.append(el('h2', {class: 'hubh'}, 'Puzzles'),
      el('p', {class: 'pzsub'}, `Your puzzle rating ${SET.puzzles.rating}` + (SET.puzzles.played ? ` · ${SET.puzzles.solved || 0} of ${SET.puzzles.played} solved` : '')));
    for (const [k, M] of Object.entries(MODES))
      box.append(el('button', {type: 'button', class: 'mode', onclick: () => startRun(k)}, el('img', {src: M.art, alt: ''}),
        el('span', {}, el('b', {}, M.name), el('small', {}, M.sub())), el('span', {class: 'ic', html: ICONS['caret-right']})));
    box.append(el('p', {class: 'hint pzfoot'}, `${list ? list.length : 'About 3,000'} puzzles from the lichess puzzle database (CC0), from beginner to master.`));
    return;
  }
  const M = MODES[R.mode], you = pz ? pz.you ?? (new C.Pos(pz.p.fen, 0, false).turn ^ 1) : 0, it = pz && pz.practice;
  box.append(el('div', {class: 'modehead'}, el('button', {class: 'ib', type: 'button', title: 'Back to the puzzle modes', html: icon('caret-left'), onclick: () => { clearInterval(timer); S.pzRun = null; S.pz = null; renderPanel(); }}), el('b', {}, M.name)));
  /* the scoreboard for the run */
  const stats = el('div', {class: 'pzstats'});
  if (R.mode === 'rated') stats.append(stat(String(SET.puzzles.rating), 'Rating', pz?.delta != null ? pz.delta : null));
  if (R.mode === 'streak') stats.append(stat(String(R.score), 'Streak', null, 'streak'), stat(String(SET.puzzles.streakBest || 0), 'Best'));
  if (R.mode === 'mistakes' && R.total) stats.append(stat(`${Math.min(R.n + 1, R.total)} / ${R.total}`, 'Position'), stat(String(R.score), 'First try'));
  if (R.mode === 'rush') {
    stats.append(stat('5:00', 'Time', null, 'time'), stat(String(R.score), 'Solved'));
    const st = el('div', {class: 'pzstat strikes'}, el('b', {}, ...[0, 1, 2].map(i => el('i', {class: i < R.strikes ? 'on' : '', html: ICONS.x}))), el('small', {}, 'Strikes'));
    stats.append(st);
  }
  box.append(stats);
  /* what to do now */
  let head = '', cls = '', sub = '';
  if (R.over) { head = R.msg; cls = R.best ? 'good' : ''; sub = R.best ? 'New personal best.' : R.empty ? 'After a game review, the moves where you went wrong come back here as puzzles.' : ''; }
  else if (it && pz.state === 'solved') { head = pz.failed ? 'Solved' : 'Fixed'; cls = 'good'; sub = [pz.note, pz.learned ? 'Twice in a row: this one leaves your list.' : ''].filter(Boolean).join(' '); }
  else if (it && pz.state === 'shown') { head = 'That was the move'; sub = `${it.bestSan}. In the game you played ${it.played}.`; }
  else if (it && pz.state === 'busy') { head = 'Checking…'; sub = 'The engine looks at your move.'; }
  else if (it && !(pz.msg && pz.state === 'you')) { head = `${you ? 'Black' : 'White'} to move`; sub = `Against ${it.opp}, move ${it.move}, you played ${it.played}: ${CLS_NAME[it.cls] || 'a mistake'}. Find a better move.`; }
  else if (!pz || pz.state === 'opp') { head = 'Get ready'; sub = 'Your opponent moves first.'; }
  else if (pz.state === 'solved') { head = 'Solved'; cls = 'good'; sub = pz.rated ? (pz.failed ? 'Not counted: you needed help.' : `Puzzle rated ${pz.p.r}.`) : ''; }
  else if (pz.state === 'shown') { head = 'That was the solution'; sub = `Puzzle rated ${pz.p.r}.`; }
  else if (pz.msg && pz.state === 'you') { head = 'Try again'; cls = 'bad'; sub = pz.msg; }
  else { head = `${you ? 'Black' : 'White'} to move`; sub = 'Find the best move.'; }
  box.append(el('div', {class: 'pzmsg ' + cls}, el('span', {class: 'side ' + (you ? 'b' : 'w')}), el('div', {}, el('b', {}, head), sub ? el('small', {}, sub) : null)));
  if (pz && pz.p.t && (pz.state === 'solved' || pz.state === 'shown')) box.append(el('p', {class: 'pzthemes'}, pz.p.t.split(' ').map(themeName).join(' · ')));
  /* buttons */
  const btns = el('div', {class: 'pzbtns'});
  if (R.over) btns.append(el('button', {class: 'primary', onclick: () => startRun(R.mode)}, 'Play again'), el('button', {onclick: () => { S.pzRun = null; S.pz = null; renderPanel(); }}, 'Other modes'));
  else if (R.mode === 'mistakes') {
    if (pz && (pz.state === 'solved' || pz.state === 'shown')) btns.append(el('button', {class: 'primary', onclick: () => { R.n++; next(); }}, R.n + 1 < R.total ? 'Next position' : 'Finish'));
    else {
      btns.append(el('button', {onclick: hint, disabled: !pz || pz.state !== 'you'}, 'Hint'));
      btns.append(el('button', {onclick: showSolution, disabled: !pz || pz.state !== 'you'}, 'Solution'));
      btns.append(el('button', {onclick: () => { R.n++; next(); }}, 'Skip'));
    }
  } else if (R.mode === 'rated') {
    if (pz && (pz.state === 'solved' || pz.state === 'shown')) btns.append(el('button', {class: 'primary', onclick: () => next()}, 'Next puzzle'));
    else {
      btns.append(el('button', {onclick: hint, disabled: !pz || pz.state !== 'you'}, 'Hint'));
      btns.append(el('button', {onclick: showSolution, disabled: !pz || pz.state !== 'you'}, 'Solution'));
      btns.append(el('button', {onclick: () => { if (pz && !pz.failed && pz.state === 'you') rate(pz, 0); next(); }}, 'Skip'));
    }
  } else if (R.mode === 'streak') btns.append(el('button', {disabled: !R.skip || !pz || pz.state !== 'you', title: 'One skip per streak', onclick: () => { R.skip = 0; next(); }}, `Skip (${R.skip})`), el('button', {onclick: () => endRun(`You stopped at ${R.score}.`)}, 'End'));
  else btns.append(el('button', {onclick: () => endRun(`You solved ${R.score}.`)}, 'End run'));
  box.append(btns);
  box.append(el('button', {class: 'pzexit', type: 'button', onclick: exitPuzzles}, 'Back to my game'));
  if (R.mode === 'rush') tickRush();
}
function stat(v, label, delta, kind) {
  return el('div', {class: 'pzstat' + (kind ? ' ' + kind : '')},
    el('b', {id: kind === 'time' ? 'pzTime' : null}, kind === 'streak' ? el('span', {class: 'flame', html: ICONS['flame-fill']}) : null, v,
      delta != null ? el('span', {class: delta >= 0 ? 'up' : 'down'}, (delta >= 0 ? ' +' : ' ') + delta) : null), el('small', {}, label));
}
const THEMES = {mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mate: 'Checkmate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
  hangingPiece: 'Hanging piece', discoveredAttack: 'Discovered attack', sacrifice: 'Sacrifice', endgame: 'Endgame', middlegame: 'Middlegame', opening: 'Opening',
  short: 'Short', long: 'Long', veryLong: 'Very long', oneMove: 'One move', advantage: 'Advantage', crushing: 'Crushing', backRankMate: 'Back-rank mate',
  deflection: 'Deflection', attraction: 'Attraction', promotion: 'Promotion', advancedPawn: 'Advanced pawn', kingsideAttack: 'Kingside attack', defensiveMove: 'Defence',
  quietMove: 'Quiet move', trappedPiece: 'Trapped piece', exposedKing: 'Exposed king', rookEndgame: 'Rook endgame', pawnEndgame: 'Pawn endgame', equality: 'Equality'};
const themeName = t => THEMES[t] || t.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
