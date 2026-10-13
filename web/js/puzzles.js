/* puzzles: rated puzzles, Puzzle Streak and Puzzle Rush on the main board. GPL-3.0-or-later
   Puzzles come from the lichess puzzle database (CC0), see web/puzzles/README.md. A puzzle's first move is the
   opponent's; after that the solution alternates. Any move that mates also counts as solving it. */
import * as C from './core.js';
import {$, el, toast, esc} from './util.js';
import {S} from './state.js';
import {SET, saveSettings} from './settings.js';
import {ICONS, icon} from './icons.js';

let list = null, app = null, timer = 0;
const MODES = {
  rated: {name: 'Puzzles', art: 'avatars/mode-puzzles.webp', sub: () => `Rated ${SET.puzzles.rating}. Puzzles at your level`},
  streak: {name: 'Puzzle Streak', art: 'avatars/streak.webp', sub: () => `One mistake ends it. Best ${SET.puzzles.streakBest || 0}`},
  rush: {name: 'Puzzle Rush', art: 'avatars/mode-bots.webp', sub: () => `5 minutes, 3 strikes. Best ${SET.puzzles.rushBest || 0}`},
};
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
  if (R.mode === 'rated') {
    if (!pz.failed) { pz.failed = true; rate(pz, 0); }
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
  S.circles = [{s: m & 127, c: 'b'}]; app.render(); renderPanel();
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
    box.append(el('h2', {class: 'hubh'}, 'Puzzles'),
      el('p', {class: 'pzsub'}, `Your puzzle rating ${SET.puzzles.rating}` + (SET.puzzles.played ? ` · ${SET.puzzles.solved || 0} of ${SET.puzzles.played} solved` : '')));
    for (const [k, M] of Object.entries(MODES))
      box.append(el('button', {type: 'button', class: 'mode', onclick: () => startRun(k)}, el('img', {src: M.art, alt: ''}),
        el('span', {}, el('b', {}, M.name), el('small', {}, M.sub())), el('span', {class: 'ic', html: ICONS['caret-right']})));
    box.append(el('p', {class: 'hint pzfoot'}, `${list ? list.length : 'About 3,000'} puzzles from the lichess puzzle database (CC0), from beginner to master.`));
    return;
  }
  const M = MODES[R.mode], you = pz ? (new C.Pos(pz.p.fen, 0, false).turn ^ 1) : 0;
  box.append(el('div', {class: 'modehead'}, el('button', {class: 'ib', type: 'button', title: 'Back to the puzzle modes', html: icon('caret-left'), onclick: () => { clearInterval(timer); S.pzRun = null; S.pz = null; renderPanel(); }}), el('b', {}, M.name)));
  /* the scoreboard for the run */
  const stats = el('div', {class: 'pzstats'});
  if (R.mode === 'rated') stats.append(stat(String(SET.puzzles.rating), 'Rating', pz?.delta != null ? pz.delta : null));
  if (R.mode === 'streak') stats.append(stat(String(R.score), 'Streak', null, 'streak'), stat(String(SET.puzzles.streakBest || 0), 'Best'));
  if (R.mode === 'rush') {
    stats.append(stat('5:00', 'Time', null, 'time'), stat(String(R.score), 'Solved'));
    const st = el('div', {class: 'pzstat strikes'}, el('b', {}, ...[0, 1, 2].map(i => el('i', {class: i < R.strikes ? 'on' : '', html: ICONS.x}))), el('small', {}, 'Strikes'));
    stats.append(st);
  }
  box.append(stats);
  /* what to do now */
  let head = '', cls = '', sub = '';
  if (R.over) { head = R.msg; cls = R.best ? 'good' : ''; sub = R.best ? 'New personal best.' : ''; }
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
  else if (R.mode === 'rated') {
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
