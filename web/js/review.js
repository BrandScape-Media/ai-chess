/* Game Review, in its own tab: like the review on chess sites.
   Stockfish (it ships with the game) looks at every position twice: a quick pass fills the result card in seconds, then a deep
   pass (depth 18) refines every number. The finished review is saved with the game in the history, so it opens instantly later.
   Everything the coach says comes from the engine's numbers; your AI model can explain a move too, but it only gets those facts.
   Retry your mistakes: the position before each one becomes a little puzzle, and the ones you miss come back in Puzzles.
   GPL-3.0-or-later */
import * as C from './core.js';
import {$, el, api, relayOK} from './util.js';
import {S, SIDE, seatName} from './state.js';
import {SET, openSettings} from './settings.js';
import {ICONS, icon} from './icons.js';
import {analyze, analysisEngine, fmtEval} from './analysis.js';
import {CLASSES, TABLE, RETRY, PHASES, reviewOf, openingOf, winPct, finalEval} from './review-core.js';
import {llmRequest, stripThink} from './players.js';

const QUICK_MS = 120, DEEP = {depth: 18, ms: 1500}, DEEPER = {depth: 22, ms: 4000};
const VAL = [0, 1, 3, 3, 5, 9, 0], PIECE = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
let app = null, table = null;
/* app: goView, curPly, render, showTab, activeTab, tick, clearSel, exploreMove, humanSide, winPly */
export function initReview(a) { app = a; }
async function openings() {
  if (!table) { try { table = await (await fetch('openings.json')).json(); } catch (e) { table = {names: [], pos: {}}; } }
  return table;
}
const posOf = (G, k) => { const p = new C.Pos(G.startFen, G.variant, G.c960); for (let i = 0; i < k; i++) p.make(G.moves[i]); return p; };
const mine = (r, side) => side ? 100 - winPct(r) : winPct(r);
const pct = v => Math.round(v) + '%';
const isMine = (V, k) => V.R && V.R.plies[k] && V.R.plies[k].mover === V.me;
export const reviewReady = () => !!(S.review && S.review.ready && S.review.gid === S.gameId);

/* ================= analysis ================= */
function newReview(gid) {
  const G = {startFen: S.startFen, variant: S.variant, c960: S.c960, moves: S.moves.slice(), sans: S.sans.slice()}, n = G.moves.length;
  return {gid, id: S.gameKey, me: app.humanSide(), G, res: [], R: null, open: {book: 0}, ready: false, view: 'summary', ai: {}, fresh: true,
    deep: {state: 'idle', done: 0, total: n + 1, depth: 0, engine: ''},
    /* what the result card reads */
    done: 0, total: n + 1, counts: {}, acc: null, key: null, keys: []};
}
/* review the game on the board: from a saved review (instant) or by analysing it */
export async function startReview(gid, saved) {
  if (S.moves.length < 2 || S.pz) return;
  const V = S.review = newReview(gid);
  V.open = openingOf(V.G, await openings());
  if (S.review !== V) return;
  if (saved && restore(V, saved)) {
    rebuild(V); V.ready = true; V.done = V.total; V.fresh = false; app.render();
    if (V.deep.depth < DEEP.depth && analysisEngine()) deepPass(V, DEEP);
    return;
  }
  for (let k = 0; k <= V.G.moves.length; k++) {   /* quick pass: the card fills in while you look at the result */
    const r = await analyze(posOf(V.G, k), QUICK_MS);
    if (S.review !== V) return;
    V.res[k] = r; V.done = k + 1;
    if (k % 6 === 5) app.render();
  }
  rebuild(V); V.ready = true; app.render();
  if (analysisEngine()) await deepPass(V, DEEP);
  else { V.deep.state = 'none'; save(V); app.render(); }
}
async function deepPass(V, lvl) {
  const e = analysisEngine(); if (!e) return;
  Object.assign(V.deep, {state: 'running', done: 0, depth: lvl.depth, engine: e.name});
  app.render();
  for (let k = 0; k <= V.G.moves.length; k++) {
    const r = await analyze(posOf(V.G, k), lvl.ms, lvl.depth);
    if (S.review !== V) return;
    if (r) V.res[k] = r;
    V.deep.done = k + 1;
    if (k % 8 === 7) { rebuild(V); app.render(); }
  }
  V.deep.state = 'done'; rebuild(V); app.render();
  save(V); practiseLater(V);
}
/* classes, accuracy, key moments from the analysis; the marks go on the board and in the move lists */
function rebuild(V) {
  V.R = reviewOf(V.G, V.res, V.open.book);
  if (V.gid === S.gameId) {
    S.fb = new Map();
    V.R.plies.forEach((p, k) => { if (k && p && p.cls) S.fb.set(k, {cls: p.cls, best: p.best, played: p.played}); });
  }
  V.keys = V.R.keys;
  if (V.me >= 0) {
    V.counts = V.R.counts[V.me]; V.acc = V.R.acc[V.me];
    V.key = V.R.keys.find(k => isMine(V, k) && ['blunder', 'mistake', 'miss'].includes(V.R.plies[k].cls)) ?? null;
  }
}
/* saved with the game in the history: the engine's answer for every position */
function pack(V) {
  return {v: 1, depth: V.deep.state === 'done' ? V.deep.depth : 0, engine: V.deep.engine || V.res.find(r => r)?.by || '', date: Date.now(),
    acc: V.R ? V.R.acc.map(a => a == null ? null : Math.round(a * 10) / 10) : null, me: V.me, book: V.open.book,   /* for the history list */
    evals: V.res.map((r, k) => r ? [r.white ?? null, r.mate ?? null, r.best ? posOf(V.G, k).toUci(r.best) : '', (r.pv || []).slice(0, 8).join(' ')] : null)};
}
function restore(V, s) {
  if (!s || s.v !== 1 || !Array.isArray(s.evals) || s.evals.length !== V.G.moves.length + 1) return false;
  try {
    V.res = s.evals.map((e, k) => {
      if (!e) return null;
      const p = posOf(V.G, k);
      return {white: e[0], mate: e[1], best: e[2] ? p.fromUci(e[2]) || 0 : 0, pv: e[3] ? e[3].split(' ') : [], by: s.engine, depth: s.depth};
    });
  } catch (e) { return false; }
  Object.assign(V.deep, {state: s.depth ? 'done' : 'none', done: V.total, depth: s.depth || 0, engine: s.engine || ''});
  return true;
}
/* a history game's saved review with its accuracy: newer reviews carry it, older ones get it worked out once from the saved
   evaluations (the same way the Review tab does it, opening book included). null when the game has no review. */
export async function historyReview(g) {
  const s = g.review;
  if (!s || s.v !== 1) return null;
  if (Array.isArray(s.acc)) return s;
  try {
    const G = {startFen: g.startFen || C.START_FEN, variant: g.variant | 0, c960: !!g.c960, moves: g.movesRaw || [], sans: []};
    const p = new C.Pos(G.startFen, G.variant, G.c960);
    for (const m of G.moves) { G.sans.push(p.san(m)); p.make(m); }
    const V = {G, res: [], deep: {}, total: G.moves.length + 1};
    if (!restore(V, s)) return null;
    const open = openingOf(G, await openings()), R = reviewOf(G, V.res, open.book);
    const humans = (g.players || []).filter(q => q.type === 'human').length;
    return {...s, acc: R.acc.map(a => a == null ? null : Math.round(a * 10) / 10), me: humans === 1 ? g.players.findIndex(q => q.type === 'human') : -1, book: open.book};
  } catch (e) { return null; }
}
function save(V) {
  if (!relayOK || !V.id || V.G.moves.length < 2) return;
  api('/api/history', {update: {id: V.id, review: pack(V)}}).catch(() => {});
}
/* your misses, mistakes and blunders come back later in Puzzles ("Your mistakes") */
function practiseLater(V) {
  if (!relayOK || V.me < 0 || V.G.variant || V.G.c960 || V.G.startFen !== C.START_FEN) return;
  const items = [];
  for (let k = 1; k < V.R.plies.length; k++) {
    const p = V.R.plies[k];
    if (!isMine(V, k) || !['miss', 'mistake', 'blunder'].includes(p.cls) || !V.res[k - 1]?.best) continue;
    const pos = posOf(V.G, k - 1);
    items.push({id: `${V.id}:${k}`, fen: pos.fen(), side: p.mover, best: pos.toUci(V.res[k - 1].best), bestSan: p.best, played: p.played, cls: p.cls,
      move: Math.floor((S.startPly + k - 1) / 2) + 1, opp: seatName(V.me ^ 1), date: Date.now(), tries: 0, solved: 0, streak: 0});
  }
  if (items.length) api('/api/practice', {add: items}).catch(() => {});
}

/* ================= what the coach says (from the engine's numbers only) ================= */
/* a line of moves from p, in SAN with move numbers */
function sanLine(p, pv, max = 6) {
  const q = new C.Pos(p.fen(), S.review.G.variant, S.review.G.c960), out = [];
  for (const u of (pv || []).slice(0, max)) {
    const m = q.fromUci(u); if (!m) break;
    const n = q.full, w = q.turn === 0;
    out.push((w ? n + '. ' : out.length ? '' : n + '... ') + q.san(m).replace(/\?!$/, ''));
    q.make(m);
  }
  return out.join(' ');
}
/* what side `side` gains in material along a line (pawns) */
function lineGain(p, pv, side, max = 6) {
  const q = new C.Pos(p.fen(), S.review.G.variant, S.review.G.c960);
  let g = 0;
  for (const u of (pv || []).slice(0, max)) {
    const m = q.fromUci(u); if (!m) break;
    const to = (m >> 7) & 127, fl = m >> 17, cap = (fl & 2) ? C.PAWN : (fl & 1) ? q.b[to] & 7 : 0, pro = (m >> 14) & 7;
    const v = VAL[cap] + (pro ? VAL[pro] - 1 : 0);
    g += q.turn === side ? v : -v;
    q.make(m);
  }
  return g;
}
const gainWords = g => g >= 8 ? 'the queen' : g >= 5 ? 'a rook' : g >= 2.5 ? 'a piece' : g >= 2 ? 'two pawns' : g >= 1 ? 'a pawn' : '';
/* the move that refutes the one played: what it takes, or the mate it allows */
function refutation(V, k) {
  const after = V.res[k], p = posOf(V.G, k), pl = V.R.plies[k];
  if (!after || !after.best) return '';
  const rep = p.san(after.best).replace(/\?!$/, ''), opp = pl.mover ^ 1;
  if (after.mate != null && Math.sign(after.mate) === (opp === 0 ? 1 : -1)) return `It allows mate in ${Math.abs(after.mate)}: ${sanLine(p, after.pv, 7) || rep}.`;
  const g = lineGain(p, after.pv, opp), cap = (after.best >> 17) & 1 ? p.b[(after.best >> 7) & 127] & 7 : 0;
  if (g >= 1) return `The answer ${rep} wins ${gainWords(g)}${after.pv && after.pv.length > 1 ? ` (${sanLine(p, after.pv, 5)})` : ''}.`;
  if (cap) return `${rep} takes your ${PIECE[cap]}.`;
  return `The best answer is ${rep}.`;
}
/* why the engine's move was better */
function bestWhy(V, k) {
  const before = V.res[k - 1], pl = V.R.plies[k];
  if (!before || !before.best || !pl.best) return '';
  const p = posOf(V.G, k - 1);
  if (before.mate != null && Math.sign(before.mate) === (pl.mover === 0 ? 1 : -1)) return ` ${pl.best} mates in ${Math.abs(before.mate)}: ${sanLine(p, before.pv, 7) || pl.best}.`;
  const g = lineGain(p, before.pv, pl.mover);
  const line = before.pv && before.pv.length > 1 ? ` (${sanLine(p, before.pv, 5)})` : '';
  return g >= 1 ? ` ${pl.best} wins ${gainWords(g)}${line}.` : ` Best was ${pl.best}${line}.`;
}
/* for a good move: what it does, from the engine's line (it wins material, or the line is quiet) */
function bestNote(V, k) {
  const pl = V.R.plies[k], before = V.res[k - 1];
  if (!before || !before.pv) return 'The engine agrees.';
  const p = posOf(V.G, k - 1), g = lineGain(p, before.pv, pl.mover);
  if (before.mate != null && Math.sign(before.mate) === (pl.mover === 0 ? 1 : -1)) return `It leads to mate in ${Math.abs(before.mate)}: ${sanLine(p, before.pv, 7)}.`;
  return g >= 1 ? `It wins ${gainWords(g)}: ${sanLine(p, before.pv, 5)}.` : before.pv.length > 1 ? `The engine's line: ${sanLine(p, before.pv, 5)}.` : 'The engine agrees.';
}
export function coachText(k, lead = true) {
  const V = S.review;
  if (!V || !V.R) return '';
  if (k === 0) return V.open.name ? `The game opened with the ${V.open.name}.` : 'The starting position.';
  const pl = V.R.plies[k];
  if (!pl) return '';
  const who = V.me >= 0 && pl.mover === V.me ? 'Your' : `${SIDE[pl.mover]}'s`, before = V.res[k - 1], after = V.res[k] || finalEval(posOf(V.G, k));
  const swing = before && after ? ` ${who} winning chances went from ${pct(mine(before, pl.mover))} to ${pct(mine(after, pl.mover))}.` : '';
  if (k === app.winPly()) return lead ? `${pl.played} wins the game.` : `The game ends by ${S.over?.reason || 'this move'}.`;
  switch (pl.cls) {
    case 'illegal': return `${pl.played} broke the rules. ${pl.why || "That piece can't move like that."}`;
    case 'book': return lead ? `${pl.played} is a book move${V.open.ply >= k && V.open.name ? `, part of the ${V.open.name}` : ''}.` : V.open.name ? `Opening theory: the ${V.open.name}.` : 'Opening theory.';
    case 'brilliant': return `${pl.played}!! is brilliant: it leaves a piece to be taken, and it works.${swing}`;
    case 'great': return `${pl.played}! is a great move: the strongest answer to the opponent's slip.`;
    case 'best': return lead ? `${pl.played} is the best move.` : bestNote(V, k);
    case 'excellent': case 'good': return (lead ? `${pl.played} is ${pl.cls === 'good' ? 'a good move' : 'excellent'}.` : '') + (pl.best && pl.best !== pl.played ? ` ${pl.best} was a little more precise.` : lead ? '' : bestNote(V, k)).trim();
    case 'miss': return `${lead ? `${pl.played} misses the chance the opponent gave.` : 'It lets the chance the opponent gave slip.'}${bestWhy(V, k)}${swing}`.trim();
    case 'inaccuracy': case 'mistake': case 'blunder':
      return `${lead ? `${pl.played} is ${pl.cls === 'inaccuracy' ? 'an inaccuracy' : 'a ' + pl.cls}. ` : ''}${refutation(V, k)}${bestWhy(V, k)}${swing}`.replace(/\s+/g, ' ').trim();
    default: return `${pl.played}. The engine had no clear opinion here.`;
  }
}
function summaryText(V) {
  const R = V.R, o = S.over, w = o && o.result === '1-0' ? 0 : o && o.result === '0-1' ? 1 : -1;
  const out = [];
  if (V.me >= 0) {
    const a = R.acc[V.me];
    const how = {checkmate: w === V.me ? 'You won by checkmate.' : 'You were checkmated.', resignation: w === V.me ? 'Your opponent resigned.' : 'You resigned.',
      timeout: w === V.me ? 'You won on time.' : 'You lost on time.'}[o?.reason];
    out.push(w < 0 ? `A draw${o?.reason ? ' by ' + o.reason : ''}.` : how || (w === V.me ? 'You won.' : 'You lost this one.'));
    if (a != null) out.push(a >= 90 ? 'Very accurate play.' : a >= 78 ? 'Solid play, with a few slips.' : a >= 62 ? 'Some good ideas and some costly moments.' : 'A rough game, with clear lessons in it.');
    const ph = R.phases[V.me], rank = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
    const seen = ph.map((c, i) => [c, i]).filter(([c]) => c).sort((a, b) => rank.indexOf(a[0]) - rank.indexOf(b[0]));
    if (seen.length > 1 && seen[0][0] !== seen[seen.length - 1][0]) out.push(`Your ${PHASES[seen[0][1]].toLowerCase()} was your strongest phase; the ${PHASES[seen[seen.length - 1][1]].toLowerCase()} is where it slipped.`);
    const bad = myMistakes(V).length;
    if (bad) out.push(`${bad} ${bad === 1 ? 'move' : 'moves'} to retry.`);
  } else {
    out.push(w < 0 ? 'The game was drawn.' : `${seatName(w)} won.`);
    out.push(`Accuracy: ${seatName(0)} ${R.acc[0]?.toFixed(1) ?? '--'}, ${seatName(1)} ${R.acc[1]?.toFixed(1) ?? '--'}.`);
  }
  return out.join(' ');
}

/* ================= your AI model as coach (given only the engine's facts) ================= */
function coachModel() {
  const c = SET.coach;
  if (c && c.provider && c.model) return {provider: c.provider, model: c.model, think: c.think || 'none'};
  const P = S.seats.find(Q => Q && Q.type === 'llm' && Q.model);
  return P ? {provider: P.provider, model: P.model, think: 'none'} : null;
}
const COACH_SYS = 'You are a friendly chess coach going through a game with a student. Explain the move in 2 to 4 short sentences of plain English: ' +
  'what it does, what it allows, and what the better move achieves. Use ONLY the moves, lines and numbers given. Never invent other moves, ' +
  'variations, evaluations or piece positions; if the facts do not say why, describe what the given moves do. No headings, no lists, no move numbers you were not given.';
function facts(V, k) {
  const pl = V.R.plies[k], before = V.res[k - 1], after = V.res[k], p = posOf(V.G, k - 1), q = posOf(V.G, k);
  const n = Math.floor((S.startPly + k - 1) / 2) + 1, L = [];
  L.push(`${seatName(0)} (White) against ${seatName(1)} (Black).` + (V.open.name ? ` Opening: ${V.open.name}.` : ''));
  L.push(`Position before the move (FEN): ${p.fen()}`);
  L.push(`Move ${n}${pl.mover ? '...' : '.'} ${SIDE[pl.mover]} played ${pl.played}. Engine verdict: ${(CLASSES[pl.cls] || {}).name || 'no opinion'}.`);
  if (before && after) L.push(`${SIDE[pl.mover]}'s chance to win: ${pct(mine(before, pl.mover))} before the move, ${pct(mine(after, pl.mover))} after it.`);
  if (before && before.best) L.push(`The engine's best move here: ${pl.best}. Its line: ${sanLine(p, before.pv, 8) || pl.best}.`);
  if (after && after.best) L.push(`After ${pl.played}, the opponent's best reply: ${q.san(after.best).replace(/\?!$/, '')}. The line: ${sanLine(q, after.pv, 8)}.`);
  const g = before && before.pv ? lineGain(p, before.pv, pl.mover) : 0, h = after && after.pv ? lineGain(q, after.pv, pl.mover ^ 1) : 0;
  if (g >= 1) L.push(`The engine's line wins ${gainWords(g)} for ${SIDE[pl.mover]}.`);
  if (h >= 1) L.push(`After the move played, the opponent's line wins ${gainWords(h)}.`);
  L.push(`Explain this move to ${V.me === pl.mover ? 'the student, who played it' : 'the student'}.`);
  return L.join('\n');
}
async function explainAI(k) {
  const V = S.review, P = coachModel();
  if (!P) { openSettings('ai'); return; }
  V.ai[k] = {state: 'busy', by: P.model}; app.render();
  try {
    const t = stripThink(await llmRequest(P, [{role: 'system', content: COACH_SYS}, {role: 'user', content: facts(V, k)}], undefined, {maxTokens: 900, think: P.think, temperature: 0.3}));
    V.ai[k] = {state: 'ok', by: P.model, text: t.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 900) || 'The model gave no answer.'};
  } catch (e) { V.ai[k] = {state: 'err', by: P.model, text: e.message}; }
  if (S.review === V) app.render();
}

/* ================= retry your mistakes ================= */
const retryable = (V, k) => isMine(V, k) && RETRY.includes(V.R.plies[k].cls) && !!V.res[k - 1]?.best;
function myMistakes(V) { const out = []; for (let k = 1; k < V.R.plies.length; k++) if (retryable(V, k)) out.push(k); return out; }
function startRetry(k, drill = null) {
  const V = S.review, pl = V.R.plies[k];
  S.retry = {k, ply: k - 1, side: pl.mover, best: pl.best, bestMove: V.res[k - 1].best, played: pl.played, tries: 0, solved: false, revealed: false, msg: '', drill};
  V.view = 'moves'; S.resultClosed = true;
  app.goView(k - 1);
}
function startDrill() {
  const V = S.review, list = myMistakes(V);
  if (list.length) startRetry(list[0], {list, i: 0, fixed: 0});
}
function nextRetry() {
  const T = S.retry, V = S.review; if (!T) return;
  if (T.drill) {
    const d = T.drill;
    if (d.i + 1 < d.list.length) { d.i++; startRetry(d.list[d.i], d); }
    else { d.done = true; app.render(); }
    return;
  }
  const n = myMistakes(V).find(j => j > T.k);
  if (n) startRetry(n); else { S.retry = null; app.goView(T.k); }
}
/* the board calls this after your first move from the retry position */
export async function checkRetry(m) {
  const T = S.retry, V = S.review;
  if (!T || !V || T.solved) return;
  const before = V.res[T.ply], p = posOf(V.G, T.ply), san = p.san(m).replace(/\?!$/, '');
  let ok = m === T.bestMove;
  if (!ok) {
    p.make(m);
    const after = finalEval(p) || await analyze(p, 700, 14);
    if (S.retry !== T) return;
    ok = !!after && mine(after, T.side) >= mine(before, T.side) - 4;
  }
  if (ok) { T.solved = true; T.found = san; app.tick(true); if (T.drill && !T.revealed) T.drill.fixed++; }
  else {
    T.tries++;
    T.msg = T.tries >= 2 ? `${san} isn't it either.` : `${san} isn't it. Try again.`;
    setTimeout(() => {
      if (S.retry !== T) return;
      if (S.explore) { S.explore = null; app.clearSel(); }
      if (T.tries >= 2) T.revealed = true;
      app.render();
    }, 750);
  }
  app.render();
}
/* the arrows the review adds to the board: the move that was better, and the answer once it is shown */
export function reviewArrows() {
  const V = S.review, T = S.retry;
  if (!reviewReady() || S.explore) return [];
  const arrow = m => { const to = (m >> 17) & C.FL_CASTLE ? (m & 0x70) + (((m >> 7) & 127) > (m & 127) ? 6 : 2) : (m >> 7) & 127; return {f: m & 127, t: to, c: 'v'}; };
  if (T) return T.revealed && app.curPly() === T.ply ? [arrow(T.bestMove)] : [];
  if (app.activeTab() !== 'review' || V.view !== 'moves') return [];
  const k = app.curPly(), pl = V.R.plies[k];
  if (!pl || !pl.cls || ['best', 'brilliant', 'great', 'book', 'illegal'].includes(pl.cls) || k === app.winPly()) return [];
  const b = V.res[k - 1]?.best;
  return b ? [arrow(b)] : [];
}

/* ================= the Review tab ================= */
const ic = name => el('span', {class: 'ic', html: ICONS[name] || ''});
const badge = (cls, size = '') => { const c = CLASSES[cls]; return c ? el('span', {class: 'rv-b' + (size ? ' ' + size : '') + (c.glyph && c.glyph.length > 2 ? ' g3' : ''), title: c.name, style: `background:${c.col}`, html: c.icon ? ICONS[c.icon] : c.glyph}) : el('span', {class: 'rv-b none'}, '-'); };
function avatar(i) { const a = el('div', {class: 'avatar'}); app.paintAvatar(a, S.seats[i], 'avatar'); return a; }
/* the Review button in the tab bar shows for any finished game */
export function reviewTabVisible() { return !!(S.pos && S.over && S.moves.length >= 2 && !S.pz); }
export function openReview(view = 'summary') {
  const V = S.review;
  if (!V || V.gid !== S.gameId) startReview(S.gameId);
  if (S.review) S.review.view = view;
  S.resultClosed = true;
  app.showTab('review'); app.render();
}
export function renderReviewTab() {
  const btn = document.querySelector('.ptabs [data-tab="review"]');
  if (btn) btn.hidden = !reviewTabVisible();
  if (app.activeTab() !== 'review') return;
  const box = $('rvBody'); if (!box) return;
  const keep = box.querySelector('.rv-moves')?.scrollTop;
  box.innerHTML = '';
  const V = S.review && S.review.gid === S.gameId ? S.review : null;
  if (!reviewTabVisible()) { box.append(el('div', {class: 'rv-empty'}, el('img', {src: 'avatars/coach.webp', alt: ''}), el('p', {}, 'Finish a game to review it here. Every game you play can be reviewed, and so can the ones in your history.'))); return; }
  if (!V) {
    box.append(el('div', {class: 'rv-empty'}, el('img', {src: 'avatars/coach.webp', alt: ''}), el('p', {}, 'Go through this game with the coach: accuracy, the key moments, and a second try at your mistakes.'),
      el('button', {class: 'primary', html: icon('chart-line') + '<span>Review this game</span>', onclick: () => openReview()})));
    return;
  }
  box.append(head(V));
  if (!V.ready) { box.append(skeleton(V)); return; }
  if (V.view === 'summary' && !S.retry) summary(box, V); else moveView(box, V);
  const mv = box.querySelector('.rv-moves');
  if (mv) { if (keep != null) mv.scrollTop = keep; const c = mv.querySelector('.cur'); if (c) c.scrollIntoView({block: 'nearest'}); }
  V.fresh = false;
}
function head(V) {
  const d = V.deep, e = analysisEngine();
  let chip;
  if (!V.ready) chip = el('span', {class: 'rv-eng'}, `Analysing ${Math.round(V.done / V.total * 100)}%`);
  else if (d.state === 'running') chip = el('span', {class: 'rv-eng run', title: `${d.engine} looks deeper at every position`}, `${d.engine} · depth ${d.depth} · ${Math.round(d.done / d.total * 100)}%`);
  else if (d.state === 'done') chip = el('span', {class: 'rv-eng', title: 'Every position analysed at this depth'}, `${d.engine} · depth ${d.depth}`);
  else chip = el('span', {class: 'rv-eng', title: 'A quick look by the built-in engine'}, 'Quick review');
  const more = V.ready && d.state !== 'running' && e && d.depth < DEEPER.depth
    ? el('button', {class: 'ib rv-deeper', title: d.state === 'done' ? `Look even deeper (depth ${DEEPER.depth}, slower)` : `Deep review with ${e.name}`, html: icon('magnifying-glass-plus'),
      onclick: () => deepPass(V, d.state === 'done' ? DEEPER : DEEP)}) : null;
  const h = el('div', {class: 'rv-head'}, el('h2', {}, 'Game review'), chip, more);
  const prog = !V.ready ? V.done / V.total : d.state === 'running' ? d.done / d.total : null;
  if (prog != null) h.append(el('i', {class: 'rv-prog', style: `--p:${(prog * 100).toFixed(1)}%`}));
  return h;
}
function skeleton(V) {
  return el('div', {class: 'rv-skel'},
    coach(el('p', {}, `Looking at every move… ${Math.round(V.done / V.total * 100)}%`)),
    el('div', {class: 'rv-players'}, el('div', {class: 'rv-pl sk'}), el('div', {class: 'rv-pl sk'})),
    el('div', {class: 'rv-graph sk', style: 'height:92px'}), el('div', {class: 'sk', style: 'height:180px;border-radius:var(--r-box)'}));
}
function coach(...kids) { return el('div', {class: 'rv-coach'}, el('img', {src: 'avatars/coach.webp', alt: ''}), el('div', {class: 'rv-say'}, ...kids)); }
function graph(V, h) {
  const W = 300, n = V.R.wins.length - 1, x = k => n ? k / n * W : 0, y = v => h - v / 100 * h, cur = S.explore ? S.explore.ply : app.curPly();
  let d = `M0,${h}`; for (let k = 0; k <= n; k++) d += `L${x(k).toFixed(2)},${y(V.R.wins[k]).toFixed(2)}`; d += `L${W},${h}Z`;
  let dots = '';
  for (const k of V.R.keys) { const c = CLASSES[V.R.plies[k].cls]; if (c) dots += `<circle cx="${x(k).toFixed(1)}" cy="${y(V.R.wins[k]).toFixed(1)}" r="3.4" fill="${c.col}" stroke="#161514" stroke-width="1.2"/>`; }
  const g = el('div', {class: 'rv-graph' + (V.fresh ? ' enter' : ''), style: `height:${h}px`, title: 'Click to jump to a move', html:
    `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none"><path d="${d}" class="wt"/><line x1="0" x2="${W}" y1="${h / 2}" y2="${h / 2}" class="mid"/>`
    + (V.view === 'moves' || S.retry ? `<line x1="${x(cur)}" x2="${x(cur)}" y1="0" y2="${h}" class="cur"/>` : '') + `</svg><svg class="dots" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">${dots}</svg>`});
  g.onclick = e => { const r = g.getBoundingClientRect(); V.view = 'moves'; S.retry = null; app.goView(Math.max(0, Math.min(n, Math.round((e.clientX - r.left) / r.width * n)))); };
  return g;
}
function summary(box, V) {
  const R = V.R;
  box.append(coach(el('p', {}, summaryText(V)), V.open.name ? el('p', {class: 'rv-open'}, ic('book-open-fill'), el('span', {}, V.open.name)) : null));
  const pl = el('div', {class: 'rv-players'});
  for (const i of [0, 1]) pl.append(el('div', {class: 'rv-pl' + (i === V.me ? ' me' : '')}, avatar(i),
    el('div', {class: 'who'}, el('span', {class: 'nm'}, seatName(i)), el('small', {}, SIDE[i])),
    el('b', {class: 'acc', title: 'Accuracy'}, R.acc[i] == null ? '--' : R.acc[i].toFixed(1)),
    el('small', {class: 'gr', title: R.rating[i] ? 'A rough estimate from the accuracy of this game' : 'Too few moves for a game rating'}, R.rating[i] ? `Game rating ${R.rating[i]}` : 'Accuracy')));
  box.append(pl, graph(V, 92));
  /* every class, with both sides' counts */
  const tb = el('div', {class: 'rv-table'});
  for (const k of TABLE) {
    const a = R.counts[0][k] || 0, b = R.counts[1][k] || 0;
    if (k === 'illegal' && !a && !b) continue;
    const c = CLASSES[k];
    tb.append(el('span', {class: 'nm', style: `color:${c.col}`}, c.name), el('span', {class: 'n' + (a ? '' : ' z')}, String(a)), badge(k), el('span', {class: 'n' + (b ? '' : ' z')}, String(b)));
  }
  tb.append(el('span', {class: 'sep'}));
  /* each phase: the accuracy icon and, with enough moves, a rating for how that phase was played */
  const phr = (side, i) => R.phaseRating && R.phaseRating[side][i] ? el('small', {class: 'phr', title: `Played like a ${R.phaseRating[side][i]} player in the ${PHASES[i].toLowerCase()}`}, String(R.phaseRating[side][i])) : null;
  PHASES.forEach((name, i) => tb.append(el('span', {class: 'nm ph'}, name), el('span', {class: 'n'}, badge(R.phases[0][i], 'sm'), phr(0, i)), el('span'), el('span', {class: 'n'}, badge(R.phases[1][i], 'sm'), phr(1, i))));
  box.append(tb);
  const n = V.me >= 0 ? myMistakes(V).length : 0;
  box.append(el('div', {class: 'rv-actions'},
    el('button', {class: 'primary', html: icon('play') + '<span>Start review</span>', onclick: () => { V.view = 'moves'; app.goView(R.keys[0] ? Math.max(1, R.keys[0]) : 1); }}),
    n ? el('button', {html: icon('arrow-u-up-left') + `<span>Retry my mistakes (${n})</span>`, onclick: startDrill}) : null));
}
function moveView(box, V) {
  const R = V.R, T = S.retry, k = S.explore ? null : app.curPly(), pl = k != null ? R.plies[k] : null;
  /* the coach: a retry task, or what happened on this move */
  if (T) box.append(retryCard(V, T));
  else if (S.explore) box.append(coach(el('p', {}, `Your own line: ${S.explore.sans.join(' ')}. The evaluation and arrows follow it; the arrows or Esc go back to the game.`)));
  else {
    const cls = k === app.winPly() ? 'win' : pl && pl.cls, c = CLASSES[cls];
    const ev = V.res[k] || (k ? finalEval(posOf(V.G, k)) : null);
    const top = k ? el('div', {class: 'rv-verdict'}, cls ? badge(cls) : null,
      el('b', {style: c ? `color:${c.col}` : ''}, c ? `${pl.played} ${cls === 'win' ? 'wins the game' : cls === 'book' ? 'is a book move' : 'is ' + (cls === 'best' ? 'the best move' : cls === 'excellent' ? 'excellent' : cls === 'good' ? 'good' : (/^[aeiou]/.test(c.name.toLowerCase()) ? 'an ' : 'a ') + c.name.toLowerCase())}` : pl.played),
      ev ? el('span', {class: 'rv-ev ' + (winPct(ev) >= 50 ? 'w' : 'b')}, fmtEval(ev) || (ev.mate === 0 ? '0.0' : '')) : null) : null;
    const say = coach(top, el('p', {}, coachText(k, !top || !cls)));
    const btns = el('div', {class: 'rv-btns'});
    if (k && retryable(V, k)) btns.append(el('button', {class: 'primary', html: icon('arrow-u-up-left') + '<span>Retry</span>', onclick: () => startRetry(k)}));
    if (k && pl && pl.cls && pl.cls !== 'book') {
      const ai = V.ai[k], P = coachModel();
      if (!ai || ai.state === 'err') btns.append(el('button', {html: icon('sparkle') + `<span>${P ? 'Explain' : 'Set up an AI coach'}</span>`, title: P ? `Ask ${P.model} to explain, from the engine's facts` : 'Choose a model in Settings, AI providers', onclick: () => explainAI(k)}));
    }
    if (btns.childNodes.length) say.querySelector('.rv-say').append(btns);
    const ai = k && V.ai[k];
    if (ai) say.querySelector('.rv-say').append(el('div', {class: 'rv-ai' + (ai.state === 'busy' ? ' busy' : ai.state === 'err' ? ' err' : '')},
      el('small', {}, ic('sparkle'), `${ai.by}`), el('p', {}, ai.state === 'busy' ? 'Thinking…' : ai.text)));
    box.append(say);
  }
  box.append(graph(V, 60));
  box.append(moveList(V));
  /* navigation: moves, key moments, back to the summary */
  const cur = app.curPly(), n = V.G.moves.length, prevK = [...R.keys].reverse().find(j => j < cur), nextK = R.keys.find(j => j > cur);
  const nb = (ic, title, on, fn) => el('button', {class: 'ib', title, html: icon(ic), disabled: !on, onclick: fn});
  box.append(el('div', {class: 'rv-nav'},
    nb('caret-double-left', 'First move (Home)', cur > 0, () => app.goView(0)),
    nb('caret-left', 'Previous move (Left arrow)', cur > 0, () => app.goView(cur - 1)),
    nb('caret-right', 'Next move (Right arrow)', cur < n, () => app.goView(cur + 1)),
    nb('caret-double-right', 'Last move (End)', cur < n, () => app.goView(n)),
    el('span', {class: 'gap'}),
    el('button', {class: 'ib key', title: 'Previous key moment ([)', html: icon('caret-left') + ICONS['star-four-fill'], disabled: prevK == null, onclick: () => { S.retry = null; app.goView(prevK); }}),
    el('button', {class: 'ib key', title: 'Next key moment (])', html: ICONS['star-four-fill'] + icon('caret-right'), disabled: nextK == null, onclick: () => { S.retry = null; app.goView(nextK); }}),
    el('button', {class: 'ib', title: 'Back to the summary', html: icon('list-dashes'), onclick: () => { S.retry = null; V.view = 'summary'; app.goView(null); }})));
}
function retryCard(V, T) {
  const d = T.drill, step = d ? el('small', {class: 'rv-step'}, d.done ? 'Drill finished' : `Mistake ${d.i + 1} of ${d.list.length}`) : null;
  if (d && d.done) {
    return coach(step, el('p', {}, `You fixed ${d.fixed} of ${d.list.length}. The ones you missed come back in Puzzles, under Your mistakes.`),
      el('div', {class: 'rv-btns'}, el('button', {class: 'primary', onclick: () => { S.retry = null; V.view = 'summary'; app.goView(null); }}, 'Back to the summary')));
  }
  const side = SIDE[T.side];
  let text, btns = [];
  if (T.solved) {
    text = `Yes! ${T.found} works.` + (T.best && T.found !== T.best ? ` The engine's choice was ${T.best}.` : '');
    btns.push(el('button', {class: 'primary', onclick: nextRetry}, d ? (d.i + 1 < d.list.length ? 'Next mistake' : 'Finish') : 'Next mistake'));
  } else if (T.revealed) {
    const p = posOf(V.G, T.ply), line = sanLine(p, V.res[T.ply]?.pv, 6);
    text = `The answer was ${T.best}${line ? `: ${line}` : ''}. In the game you played ${T.played}.`;
    btns.push(el('button', {onclick: () => app.exploreMove(T.bestMove)}, 'Play it'), el('button', {class: 'primary', onclick: nextRetry}, d ? (d.i + 1 < d.list.length ? 'Next mistake' : 'Finish') : 'Next mistake'));
  } else {
    text = T.msg || `In the game you played ${T.played}. Find a better move for ${side}.`;
    btns.push(el('button', {onclick: () => { T.revealed = true; S.explore = null; app.render(); }}, 'Show the answer'), el('button', {onclick: nextRetry}, 'Skip'));
  }
  return el('div', {class: 'rv-retry'}, coach(step, el('div', {class: 'rv-verdict'}, el('img', {class: 'rv-side', src: `pieces/cburnett/${T.side ? 'b' : 'w'}K.svg`, alt: ''}), el('b', {}, T.solved ? 'Solved' : T.revealed ? 'The answer' : `${side} to move`)),
    el('p', {class: T.msg && !T.solved && !T.revealed ? 'bad' : ''}, text), el('div', {class: 'rv-btns'}, ...btns)));
}
function moveList(V) {
  const mv = el('div', {class: 'rv-moves'}), off = S.startPly & 1, base = S.startPly - off, cur = S.explore ? S.explore.ply : app.curPly(), wp = app.winPly();
  for (let k = 0, row = 0; k < V.G.sans.length + off; k += 2, row++) {
    mv.append(el('span', {class: 'n'}, ((base + k) / 2 + 1) + '.'));
    for (let j = 0; j < 2; j++) {
      const idx = k + j - off;
      if (idx < 0) { mv.append(el('span', {class: 'm e'}, '…')); continue; }
      if (idx >= V.G.sans.length) { mv.append(el('span')); continue; }
      const ply = idx + 1, cls = ply === wp ? 'win' : V.R.plies[ply]?.cls, c = CLASSES[cls];
      mv.append(el('button', {class: 'm' + (cur === ply ? ' cur' : ''), onclick: () => { S.retry = null; app.goView(ply); }},
        el('span', {}, V.G.sans[idx].replace(/\?!$/, '')), c && !['good', 'excellent'].includes(cls) ? el('i', {style: `color:${c.col}`, title: c.name, html: c.icon ? ICONS[c.icon] : c.glyph}) : null));
    }
  }
  return mv;
}
