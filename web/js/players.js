/* computer players: the built-in engine (web worker), UCI engines (through the server) and AI models.
   GPL-3.0-or-later */
import * as C from './core.js';
import {S, SIDE, VARIANT_UCI, hooks, humanCount, timed, rulesOff, sqOf, shortModel, ascii, histText} from './state.js';
import {api, toast, sleep} from './util.js';
import {canvasPiece} from './theme.js';
import {BOTS} from './historic.js';

/* ================= engines ================= */
let worker = null, reqId = 0;
function ensureWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = onWorker;
    worker.onerror = ev => { console.error('engine worker', ev.message); worker = null; toast('Engine error: ' + (ev.message || 'worker failed')); };
  } catch (e) { worker = null; }
  return worker;
}
export function cancelThinking() {
  reqId++; S.thinking = false; S.eng = null;
  if (S.llmCtl) { S.llmCtl.abort(); S.llmCtl = null; }
  if (worker) { worker.terminate(); worker = null; }
}
const stale = (gid, len) => gid !== S.gameId || len !== S.moves.length;
/* a short pause so engine moves don't feel instant; on the clock it would cost time, so it is shorter */
const minDelay = () => S.clock && timed(S.pos.turn) ? 120 : humanCount() ? 350 : 800;
/* thinking time an engine may use on the clock: a slice of what is left plus most of the increment */
function clockBudget(side) {
  if (!S.clock || !timed(side)) return 0;
  const left = S.clock.ms[side], inc = S.clock.inc;
  return Math.max(60, Math.min(left / 25 + inc * .8, left * .4));
}

function fmtScore(cp, mate) {
  if (mate != null) return 'M' + (mate > 0 ? '+' : '-') + Math.abs(mate);
  if (cp == null) return '';
  const v = cp / 100; return (v > 0 ? '+' : '') + v.toFixed(2);
}
const fmtNodes = n => n > 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round((n || 0) / 1e3) + 'k';

export const isBrowserEngine = id => !id || id === 'builtin' || !!BOTS[id];
export function askEngine(P) {
  if (!isBrowserEngine(P.engine)) return askExternal(P);
  S.thinking = true; S.info = ''; hooks.render();
  const id = ++reqId, gid = S.gameId, len = S.moves.length, t0 = performance.now(), side = S.pos.turn;
  S.eng = {id, gid, len, t0, P, side};
  const bot = BOTS[P.engine] ? P.engine : null;
  const msg = {id, fen: S.startFen, variant: S.variant, c960: S.c960, moves: S.moves.slice(), level: P.level ?? 3, bot, maxMs: clockBudget(side) || null};
  const w = ensureWorker();
  if (w) w.postMessage(msg);
  else setTimeout(() => {
    const p = new C.Pos(S.startFen, S.variant, S.c960); for (const m of msg.moves) p.make(m);
    const lv = C.LEVELS[msg.level];
    onWorker({data: {id, done: true, res: bot ? BOTS[bot].fn(p) : C.search(p, msg.maxMs ? {...lv, time: Math.min(lv.time, msg.maxMs)} : lv)}});
  }, 60);
}
function onWorker(e) {
  const d = e.data;
  if (!S.eng || d.id !== S.eng.id) return;
  if (d.info) { S.info = `depth ${d.info.depth} · ${fmtScore(d.info.mate == null ? d.info.score : null, d.info.mate)} · ${fmtNodes(d.info.nodes)} nodes`; document.getElementById('einfo').textContent = S.info; return; }
  if (!d.done) return;
  const {gid, len, t0, P, side} = S.eng; S.eng = null;
  if (stale(gid, len)) return;
  if (!d.res) { S.thinking = false; hooks.afterMove(); return; }
  const r = d.res;
  P.lastInfo = {white: r.mate != null ? (r.mate > 0 ? 9999 : -9999) : r.score, side};
  S.info = `depth ${r.depth} · ${fmtScore(r.mate == null ? r.score : null, r.mate)} · ${fmtNodes(r.nodes)} nodes · ${(r.ms / 1000).toFixed(1)}s`;
  setTimeout(() => {
    if (stale(gid, len) || S.paused) return;
    S.thinking = false;
    if (S.pos.legalMoves().includes(r.move)) hooks.play(r.move); else hooks.render();
  }, Math.max(0, minDelay() - (performance.now() - t0)));
}

/* positions that slipped through rules-off moves can crash real engines: let the built-in engine handle those */
export function sane(p) {
  if (p.ksq[0] === C.NOKING || p.ksq[1] === C.NOKING) return false;
  if (p.isAttacked(p.ksq[p.turn ^ 1], p.turn)) return false;
  let n = [0, 0];
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const q = p.b[s]; if (!q) continue;
    n[q >> 3]++;
    if ((q & 7) === C.PAWN && ((s >> 4) === 0 || (s >> 4) === 7)) return false;
  }
  return n[0] <= 16 && n[1] <= 16;
}
const warned = new Set();
function fallback(P, why) {
  const key = S.gameId + why;
  if (!warned.has(key)) { warned.add(key); toast(why + ': the built-in engine plays instead'); }
  askEngine(Object.assign({}, P, {engine: 'builtin', level: 4}));
}
async function askExternal(P) {
  const e = (S.engineList || []).find(x => x.id === P.engine);
  const variant = VARIANT_UCI[S.variant];
  if (!e) return fallback(P, 'That engine is not installed');
  if (!(e.variants || ['chess']).includes(variant)) return fallback(P, `${e.name} does not play ${['', 'King of the Hill', 'Three-check'][S.variant]}`);
  if (S.c960 && !e.chess960) return fallback(P, `${e.name} does not play Chess960`);
  const free = S.moves.some(m => (m >> 17) & C.FL_FREE);
  if (free && !sane(S.pos)) return fallback(P, 'This position is too broken for a real engine');
  S.thinking = true; S.info = ''; hooks.render();
  const gid = S.gameId, len = S.moves.length, t0 = performance.now(), side = S.pos.turn, ctl = new AbortController();
  S.llmCtl = ctl;
  /* three-check FENs carry the remaining checks ("3+3"); without it Fairy-Stockfish thinks the game is already over */
  const checksFen = (f, w, b) => { if (S.variant !== C.V_3CHECK) return f; const t = f.split(' '); t.splice(4, 0, `${w}+${b}`); return t.join(' '); };
  const req = {engine: e.id, game: S.gameId, variant, chess960: S.c960, fen: checksFen(S.startFen, 3, 3), moves: S.moves.map(m => C.uci(m, S.c960)),
    elo: e.kind === 'elo' ? (P.elo || null) : null, movetime: P.movetime || 1000, nodes: e.kind === 'nodes' ? P.nodes : null, maia: P.maia || 1500,
    depth: (e.kind === 'elo' || e.kind === 'time') && P.depth ? P.depth : null};
  /* on the clock the engine manages its own time from the real clocks */
  if (S.clock && timed(side)) req.clock = {wtime: Math.max(1, Math.round(S.clock.ms[0])), btime: Math.max(1, Math.round(S.clock.ms[1])), winc: S.clock.inc, binc: S.clock.inc};
  if (free) req.fen_now = checksFen(S.pos.fen(), Math.max(0, 3 - S.pos.checks[0]), Math.max(0, 3 - S.pos.checks[1]));
  let r;
  try { r = await api('/api/engine/go', req, ctl.signal); }
  catch (err) {
    if (err.name === 'AbortError' || stale(gid, len)) return;
    S.thinking = false; S.llmCtl = null;
    return fallback(P, `${e.name} failed (${err.message})`);
  }
  if (stale(gid, len)) return;
  const m = S.pos.fromUci(r.bestmove || '');
  S.llmCtl = null;
  if (!m) { S.thinking = false; return fallback(P, `${e.name} answered '${r.bestmove}'`); }
  const i = r.info || {};
  const white = i.mate != null ? (i.mate > 0 === (side === 0) ? 9999 : -9999) : i.cp != null ? (side === 0 ? i.cp : -i.cp) : null;
  P.lastInfo = {white, side, pv: i.pv};
  S.info = [i.depth ? 'depth ' + i.depth : '', fmtScore(white != null && Math.abs(white) < 9999 ? white : null, i.mate != null ? (side === 0 ? i.mate : -i.mate) : null),
    i.nodes ? fmtNodes(i.nodes) + ' nodes' : '', ((performance.now() - t0) / 1000).toFixed(1) + 's'].filter(Boolean).join(' · ');
  const wait = minDelay() - (performance.now() - t0);
  if (wait > 0) await sleep(wait);
  if (stale(gid, len) || S.paused) return;
  S.thinking = false;
  hooks.play(m);
}

/* ================= hints ================= */
/* best move for the side to move, at full strength: Stockfish / Fairy-Stockfish when installed, else the built-in engine */
export async function bestMoveHint() {
  const variant = VARIANT_UCI[S.variant], free = S.moves.some(m => (m >> 17) & C.FL_FREE);
  const ext = (S.engineList || []).filter(e => e.kind === 'elo' && (e.variants || ['chess']).includes(variant) && (!S.c960 || e.chess960))
    .sort((a, b) => (a.id === 'stockfish' ? -1 : 0) - (b.id === 'stockfish' ? -1 : 0))[0];
  if (ext && (!free || sane(S.pos))) {
    try {
      const fen = S.variant === C.V_3CHECK ? (f => { const t = f.split(' '); t.splice(4, 0, '3+3'); return t.join(' '); })(S.startFen) : S.startFen;
      const req = {engine: ext.id, game: 'hint', variant, chess960: S.c960, fen, moves: S.moves.map(m => C.uci(m, S.c960)), movetime: 900};
      if (free) { const t = S.pos.fen().split(' '); if (S.variant === C.V_3CHECK) t.splice(4, 0, `${3 - S.pos.checks[0]}+${3 - S.pos.checks[1]}`); req.fen_now = t.join(' '); }
      const r = await api('/api/engine/go', req);
      const m = S.pos.fromUci(r.bestmove || '');
      if (m) return {move: m, by: ext.name};
    } catch (e) { /* fall back */ }
  }
  return new Promise(resolve => {
    const w = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module'});
    w.onmessage = e => { if (e.data.done) { w.terminate(); resolve(e.data.res ? {move: e.data.res.move, by: 'built-in engine'} : null); } };
    w.onerror = () => { w.terminate(); resolve(null); };
    w.postMessage({id: 1, fen: S.startFen, variant: S.variant, c960: S.c960, moves: S.moves.slice(), level: 3});
  });
}

/* ================= AI models ================= */
const IMG_ERR = /image|vision|mmproj|multimodal|modalit/i;
export async function llmRequest(P, messages, signal, {maxTokens, think, temperature = 0.7} = {}) {
  think = think || P.think || 'none';
  const max = maxTokens || {none: 800, low: 3000, medium: 5000, xhigh: 9000}[think] || 3000;
  const j = await api('/api/llm/chat', {provider: P.provider, model: P.model, messages, max_tokens: max, temperature, think}, signal);
  const m = j.choices && j.choices[0] && j.choices[0].message;
  return (m && m.content) || '';
}
export function stripThink(t) {
  t = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const k = t.lastIndexOf('</think>'); return k >= 0 ? t.slice(k + 8) : t;
}
/* "Say: ..." table talk goes to the chat, the rest holds the move */
export function splitSay(t) {
  let say = '';
  const rest = t.split('\n').filter(line => {
    const m = /^\s*[*_]*(say|chat)[*_]*\s*[:\-]\s*[*_]*\s*(.+)$/i.exec(line);
    if (m && !say) { say = m[2].replace(/[*_]+$/, '').trim().replace(/^["“']|["”']$/g, '').trim().slice(0, 240); return false; }
    return !m;
  }).join('\n');
  return {rest, say};
}
const SAN_RE = /^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)$/;
export function parseLLMMove(txt, legal) {
  const p = S.pos, uciMap = new Map(), sanMap = new Map();
  for (const m of legal) { uciMap.set(p.toUci(m), m); sanMap.set(p.san(m).replace(/[+#]/g, ''), m); }
  for (const m of legal) if ((m >> 17) & C.FL_CASTLE) { const alt = C.uci(m, !S.c960); if (!uciMap.has(alt)) uciMap.set(alt, m); }
  const toks = txt.split(/[^A-Za-z0-9=@\-]+/).filter(Boolean).reverse();
  let cand = null;
  for (let t of toks) {
    t = t.replace(/^[0Oo]-[0Oo]-[0Oo]$/, 'O-O-O').replace(/^[0Oo]-[0Oo]$/, 'O-O').replace(/^([a-h][1-8])-([a-h][1-8])/i, '$1$2');
    const lu = t.toLowerCase();
    if (uciMap.has(lu)) return {ok: true, move: uciMap.get(lu)};
    if (sanMap.has(t)) return {ok: true, move: sanMap.get(t)};
    if (!cand && (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(t) || SAN_RE.test(t) || /^[KQRBNP]@[a-h][1-8]$/.test(t))) cand = t;
  }
  return {ok: false, cand};
}
function whyIllegal(cand) {
  if (!cand) return 'I could not find a move in your reply.';
  const m = /^([a-h][1-8])([a-h][1-8])/i.exec(cand);
  if (m) {
    const b = S.pos.b[sqOf(m[1].toLowerCase())];
    if (!b) return `There is no piece on ${m[1]}.`;
    if ((b >> 3) !== S.pos.turn) return `The piece on ${m[1]} is not yours.`;
    return `${cand} is not legal for that piece here (blocked, wrong geometry, or it leaves your king in check).`;
  }
  return `${cand} is not a legal move in this position.`;
}
/* Turn an illegal move text into an unchecked move (or null if it can't be understood). No rule lecture: it just happens. */
export function resolveIllegal(cand, side) {
  const b = S.pos.b, mk = (from, to, sp) => from | to << 7 | sp << 14 | C.FL_FREE << 17;
  const lastRank = (pc, to) => (pc & 7) === C.PAWN && (to >> 4) === ((pc >> 3) ? 0 : 7);
  let m = /^([KQRBNP])@([a-h][1-8])$/i.exec(cand);
  if (m) { const type = 'PNBRQK'.indexOf(m[1].toUpperCase()) + 1, t = sqOf(m[2].toLowerCase()); return mk(C.SPAWN_SQ, t, type === C.PAWN && (t >> 4) === (side ? 0 : 7) ? C.QUEEN : type); }
  m = /^([a-h][1-8])-?([a-h][1-8])([qrbn])?/i.exec(cand);
  if (m) {
    const f = sqOf(m[1].toLowerCase()), t = sqOf(m[2].toLowerCase()), pr = m[3] ? 'pnbrqk'.indexOf(m[3].toLowerCase()) + 1 : 0;
    if (f === t) return null;
    if (b[f]) return mk(f, t, lastRank(b[f], t) ? (pr || C.QUEEN) : 0);
    const mem = S.lastOn.get(f);
    if (mem && (mem >> 3) === side) return mk(f, t, lastRank(mem, t) ? (pr || C.QUEEN) : (mem & 7));
    return null;
  }
  m = /^([KQRBN])?[a-h]?[1-8]?x?([a-h][1-8])(?:=?([QRBN]))?/.exec(cand);
  if (!m) return null;
  const type = m[1] ? 'PNBRQK'.indexOf(m[1]) + 1 : C.PAWN, t = sqOf(m[2]), pr = m[3] ? 'PNBRQK'.indexOf(m[3]) + 1 : 0;
  let best = -1, bd = 99;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    if (b[s] !== ((side << 3) | type) || s === t) continue;
    const d = Math.max(Math.abs((s >> 4) - (t >> 4)), Math.abs((s & 7) - (t & 7)));
    if (d < bd) { bd = d; best = s; }
  }
  const promo = type === C.PAWN && (t >> 4) === (side ? 0 : 7) ? (pr || C.QUEEN) : 0;
  return best >= 0 ? mk(best, t, promo) : mk(C.SPAWN_SQ, t, promo || type);
}

function variantRules() {
  const t = [];
  if (S.startName.startsWith('Chess960')) t.push('This is Chess960 (Fischer Random Chess): the pieces on the back rank start in a shuffled order, the same for both sides. All the usual rules apply, castling included: after castling the king and rook stand where they would in normal chess (O-O: king g1, rook f1; O-O-O: king c1, rook d1; the same on rank 8 for Black). Every square between the king and its destination, and between the rook and its destination, must be empty apart from those two pieces, and the king may not be in check, pass through check or land in check.');
  else if (S.startName === 'Transcendental') t.push('This is Transcendental Chess: each side\'s back rank starts in its own random order (the two sides do not mirror each other). Castling is not allowed. All other rules are normal.');
  else if (S.startFen !== C.START_FEN) t.push('This game started from a custom position. Normal chess rules apply.');
  if (S.startFen !== C.START_FEN) t.push('Starting position (FEN): ' + S.startFen + '\n' + ascii(new C.Pos(S.startFen)));
  if (S.variant === C.V_KOTH) t.push('Variant: King of the Hill. Normal chess rules, plus: you also win at once if your king reaches one of the four center squares d4, e4, d5 or e5 (the move must be legal: no walking into check). Checkmate still wins.');
  if (S.variant === C.V_3CHECK) t.push('Variant: Three-check. Normal chess rules, plus: you also win at once by giving check for the third time in the game. Checkmate still wins.');
  return t.join('\n\n');
}
const variantStatus = p => S.variant === C.V_3CHECK ? `Checks given so far: White ${p.checks[0]}, Black ${p.checks[1]} (the third one wins).` : '';
function oppDesc(side) {
  const o = S.seats[side ^ 1];
  return o.type === 'human' ? 'a human player' : o.type === 'engine' ? 'a chess engine' : o.type === 'agent' ? 'another AI' : 'another AI model';
}
function arrowsText(side) {
  if (!S.peek || (!S.arrows.length && !S.circles.length)) return '';
  const who = S.seats[side ^ 1].type === 'human' ? 'your opponent drew on their screen while thinking (they do not know you can see them)' : 'someone watching the game drew on the board';
  const names = {g: '', r: ' (red)', b: ' (blue)', y: ' (yellow)'};
  const parts = [];
  if (S.arrows.length) parts.push('arrows ' + S.arrows.map(a => C.sqName(a.f) + '→' + C.sqName(a.t) + names[a.c]).join(', '));
  if (S.circles.length) parts.push('circled squares ' + S.circles.map(c => C.sqName(c.s)).join(', '));
  return `You can secretly see what ${who}: ${parts.join('; ')}.`;
}
function persona(P) {
  if (!S.chatOn || !P.persona) return '';
  return `Your character: ${P.persona.prompt}\n\nThere is a chat box next to the board, like on chess.com. Real players almost never type during a game. ` +
    `Only when a turn message says "You may chat this turn", you may add ONE line after your move that starts with "Say:": a few words, in character, the way people type in online chess. ` +
    `Skipping it is normal. Never describe the position, never comment on every move, never reveal which move you plan next.`;
}
/* table talk while moving is rare: only right after a big moment
   (chat.js marks S.bigMoment: a piece won or lost, a promotion, a blunder), at most 3 times a game and never twice in 10 plies */
export function mayChat(P) {
  if (!S.chatOn || !P.persona) return {ok: false};
  const t = P.talk || (P.talk = {last: -99, count: 0});   /* messages from the opponent are answered separately (chat.js) */
  if (t.count >= 3 || S.moves.length - t.last < 10) return {ok: false};
  const b = S.bigMoment;
  return {ok: !!b && b.ply === S.moves.length && Math.random() < .6};
}
export function llmSystem(P, side) {
  let t = `You are a chess player. You play ${SIDE[side]} against ${oppDesc(side)}.`;
  const vr = variantRules(); if (vr) t += '\n\n' + vr;
  if (P.sees === 'chat') t += '\n\nYou will not be shown the board: keep track of the position yourself from the moves.';
  else if (P.sees === 'chatboard') t += '\n\nAfter each move you will get the current position.';
  t += '\n\nAnswer with a single move in UCI notation (from-square then to-square, like e2e4 or g1f3; add the piece for a promotion, like e7e8q)' + (S.c960 ? '; to castle, move the king onto its own rook (like e1h1)' : '') + '.';
  const pz = persona(P);
  t += pz ? ' Put the move on its own line, with nothing else on that line.\n\n' + pz : ' Reply with the move only, no explanation.';
  return t;
}
function boardBlock(p) { return `Position (FEN): ${p.fen()}\n\nBoard (uppercase = White, lowercase = Black):\n${ascii(p)}`; }
export const PIC_LINE = 'The attached picture shows the current board, White at the bottom.';
function chatSince(side, sincePly) {
  if (!S.chatOn) return '';
  const lines = (S.chatLog || []).filter(c => c.ply >= sincePly && c.from !== side && c.from !== 'sys').slice(-4);
  return lines.length ? 'Chat since your last move:\n' + lines.map(c => `${c.from === 'you' ? 'Opponent' : SIDE[c.from]}: ${c.text}`).join('\n') : '';
}
export function turnText(P, side, legal, first, withImg, chatOk = {}) {
  const p = S.pos, L = [], vs = variantStatus(p);
  if (P.sees === 'board') {
    L.push(`You are playing ${SIDE[side]}. It is your move.`);
    if (vs) L.push(vs);
    L.push(boardBlock(p));
    L.push('Moves so far: ' + (histText(S.sans) || '(none yet)'));
  } else {
    if (first) L.push(S.moves.length ? `Let's play chess. You are ${SIDE[side]}. The moves so far: ${histText(S.sans)}` : `Let's play chess. You are ${SIDE[side]}.`);
    else if (S.sans.length > P.lastPly + 1) L.push(`${SIDE[side ^ 1]} played ${histText(S.sans, P.lastPly + 1)}.`);
    if (P.note) { L.push(P.note); P.note = ''; }
    if (P.sees === 'chatboard') L.push(boardBlock(p));
    if (vs) L.push(vs);
  }
  const ct = chatSince(side, P.sees === 'board' ? Math.max(0, S.moves.length - 2) : P.lastPly + 1); if (ct) L.push(ct);
  const at = arrowsText(side); if (at) L.push(at);
  if (withImg) L.push(PIC_LINE);
  if (P.hint) L.push('Legal moves (UCI): ' + legal.map(m => p.toUci(m)).join(' '));
  if (chatOk.ok) L.push('You may chat this turn: something big just happened. Only if your character would react.');
  L.push((S.moves.length || !first || P.sees === 'board' ? 'Your move.' : 'Make the first move.') + ' Give the move in UCI notation.');
  return L.filter(Boolean).join('\n\n');
}
function apiMsg(m, keepImg) {
  if (!m.img) return {role: m.role, content: m.content};
  if (keepImg) return {role: m.role, content: [{type: 'text', text: m.content}, {type: 'image_url', image_url: {url: m.img}}]};
  return {role: m.role, content: m.content.replace('\n\n' + PIC_LINE, '')};
}
/* a long chat game would overflow the model's context: drop old turns in big chunks (keeps the server's prompt cache useful) */
function trimConvo(P) {
  if (P.convo.length <= 120) return;
  let i = P.convo.length - 60;
  while (i < P.convo.length && P.convo[i].role !== 'assistant') i++;
  P.convo = [P.convo[0]].concat(P.convo.slice(i));
}
export async function askLLM(P) {
  const side = S.pos.turn;
  S.thinking = true; S.info = 'waiting for ' + shortModel(P) + '…'; S.llmT0 = performance.now(); hooks.render();
  const gid = S.gameId, len = S.moves.length, ctl = new AbortController(); S.llmCtl = ctl;
  const legal = S.pos.legalMoves(), chat = P.sees !== 'board', first = chat && !P.convo.length;
  const wantImg = P.img !== 'off' && !P.noImage, chatOk = mayChat(P);
  if (chat) trimConvo(P);
  const userMsg = {role: 'user', content: turnText(P, side, legal, first, wantImg, chatOk), img: wantImg ? boardPng(S.pos, S.lastMove, S.peek) : null, ply: len};
  const local = [];
  const build = () => {
    const out = [{role: 'system', content: llmSystem(P, side)}];
    for (const m of (chat ? P.convo : [])) out.push(apiMsg(m, P.img === 'all' && !P.noImage));
    out.push(apiMsg(userMsg, !P.noImage));
    for (const m of local) out.push(apiMsg(m, false));
    return out;
  };
  const free = rulesOff(P);
  let chosen = 0, bad = 0, slip = 0, say = '';
  const t0 = performance.now();
  try {
    for (let a = 0; a < 4 && !chosen; a++) {
      let txt;
      try { txt = await llmRequest(P, build(), ctl.signal); }
      catch (e) {
        if (e.name !== 'AbortError' && userMsg.img && !P.noImage && IMG_ERR.test(e.message)) {
          P.noImage = true; toast(shortModel(P) + ' does not take pictures: text only from now on');
          userMsg.content = userMsg.content.replace('\n\n' + PIC_LINE, ''); userMsg.img = null; a--; continue;
        }
        throw e;
      }
      if (stale(gid, len)) return;
      const sp = splitSay(stripThink(txt));
      if (sp.say) say = sp.say;
      const r = parseLLMMove(sp.rest, legal);
      local.push({role: 'assistant', content: stripThink(txt).trim().slice(-400) || '?', ply: len});
      if (r.ok) { chosen = r.move; break; }
      bad++;
      if (free) {
        const fm = r.cand && resolveIllegal(r.cand, side);
        if (fm) { slip = fm; P.illegal++; break; }
        local.push({role: 'user', content: 'I could not read a move from that. Give one move in UCI notation, for example e2e4.', ply: len});
        continue;
      }
      if (r.cand) P.illegal++;
      S.say = `Tried ${r.cand || '(nothing readable)'}, illegal!`; S.sayBy = side; hooks.render();
      local.push({role: 'user', content: `Illegal move. ${whyIllegal(r.cand)} Try again and give one legal move in UCI notation.`, ply: len});
    }
  } catch (e) {
    if (e.name === 'AbortError' || stale(gid, len)) return;
    S.say = 'Model error: ' + e.message; S.sayBy = side;
    S.thinking = false; S.llmCtl = null; S.paused = true; S.info = '';
    toast('Model error: paused. Fix the provider or switch the player, then Resume.');
    hooks.render(); return;
  }
  if (stale(gid, len)) return;
  const secs = ((performance.now() - t0) / 1000).toFixed(1) + 's';
  if (!humanCount()) {
    const wait = 700 - (performance.now() - t0);
    if (wait > 0) { await sleep(wait); if (stale(gid, len) || S.paused) return; }
  }
  S.thinking = false; S.llmCtl = null;
  if (local.length && local[local.length - 1].role === 'user') local.pop();
  if (chat) { P.convo.push(userMsg, ...local); P.lastPly = len; }
  S.info = secs; S.sayBy = side; S.say = '';
  if (say && chatOk.ok && !NO_REPLY.test(say) && hooks.say) {
    hooks.say(side, say);
    P.talk.count++; P.talk.last = len;
  }
  if (slip) { S.say = 'Slipped: ' + S.pos.san(slip).replace(/\?!$/, ''); hooks.play(slip); return; }
  if (!chosen) {
    chosen = legal[Math.floor(Math.random() * legal.length)];
    S.say = (bad ? `${bad} illegal attempts. ` : '') + 'Gave up; a random legal move was played.';
    if (chat) P.note = `(Your last move could not be played, so ${S.pos.san(chosen)} was played for you.)`;
  } else if (bad) S.say = `${bad} illegal attempt${bad > 1 ? 's' : ''} first, then found a real move.`;
  if (S.paused) { hooks.render(); return; }
  hooks.play(chosen);
}

/* chat reply in character (no move talk); history = [{from, text}] */
export async function llmTalk(P, side, history) {
  const material = (() => {
    const v = [0, 1, 3, 3, 5, 9, 0]; let w = 0, b = 0;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = S.pos.b[s]; if (q) (q >> 3 ? (b += v[q & 7]) : (w += v[q & 7])); }
    const d = side ? b - w : w - b;
    return d > 0 ? `you are ahead by ${d} points of material` : d < 0 ? `you are behind by ${-d} points of material` : 'material is level';
  })();
  const sys = `You are playing ${SIDE[side]} in an online chess game and this is the game's chat box, like on chess.com or lichess.` +
    (P.persona ? `\n\nYour character (stay in it): ${P.persona.prompt}` : '') +
    `\n\nGame so far: ${histText(S.sans) || 'no moves yet'}. Right now ${material}.` +
    `\n\nHow people really chat during online games:` +
    `\n- Very short: usually 1 to 8 words, one sentence at most. Lowercase and chat slang are fine.` +
    `\n- Mostly silence. "hi" or "gl" at the start, "gg" at the end, a quick reaction to a big moment.` +
    `\n- Your character decides whether to answer at all. A cocky, grumpy or aloof player ignores small talk or brushes it off; a friendly one answers briefly.` +
    `\n- Do not get pulled into long off-topic conversations (life, philosophy, coding, ...): brush it off in character or don't answer.` +
    `\n- Never narrate moves, never describe the position, never reveal your plans.` +
    `\n\nIf you would not answer, reply with exactly: (no reply)`;
  const msgs = [{role: 'system', content: sys}];
  for (const c of history.slice(-10)) {
    const role = c.from === side ? 'assistant' : 'user', text = c.from === 'sys' ? `(${c.text})` : c.text;
    if (msgs.length > 1 && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + text;
    else msgs.push({role, content: text});
  }
  if (msgs[msgs.length - 1].role !== 'user') return '';
  if (msgs[1].role === 'assistant') msgs.splice(1, 0, {role: 'user', content: '(the chat opens)'});   /* some APIs want a user turn first */
  const txt = await llmRequest(P, msgs, undefined, {maxTokens: 200, think: 'none', temperature: 0.9});
  const out = splitSay(stripThink(txt)).rest.replace(/^\s*(say|chat)\s*:\s*/i, '').trim().split('\n').filter(Boolean)[0] || '';
  if (NO_REPLY.test(out)) return '';
  /* keep it to the first sentence or two, like a real chat line */
  const short = (out.match(/^(.{1,140}?[.!?…])(\s|$)/) || [out])[0].trim();
  return (short.length >= 2 ? short : out).replace(/^["“']|["”']$/g, '').slice(0, 160);
}
export const NO_REPLY = /^\W*\(?\s*(no reply|no response|silence|ignores?( it)?|\.\.\.)\s*\)?\W*$/i;

/* ---------- board picture for vision models ---------- */
export function sqXY(s, flip) { const f = s & 7, r = s >> 4; return [(flip ? 7 - f : f) + .5, (flip ? r : 7 - r) + .5]; }
/* shaft polyline (knight moves get an L) and head triangle, in square units */
export function arrowGeom(from, to, flip) {
  const a = sqXY(from, flip), b = sqXY(to, flip), df = Math.abs((from & 7) - (to & 7)), dr = Math.abs((from >> 4) - (to >> 4));
  const pts = (df === 1 && dr === 2) ? [a, [a[0], b[1]], b] : (df === 2 && dr === 1) ? [a, [b[0], a[1]], b] : [a, b];
  const n = pts.length, [px, py] = pts[n - 2], [tx, ty] = pts[n - 1], L = Math.hypot(tx - px, ty - py), ux = (tx - px) / L, uy = (ty - py) / L;
  const tip = [tx - ux * .08, ty - uy * .08], hl = .42, hw = .3, base = [tip[0] - ux * hl, tip[1] - uy * hl];
  return {line: pts.slice(0, n - 1).concat([base]), head: [tip, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]]};
}
export const ARROW_COL = {g: '#15781B', r: '#882020', b: '#003088', y: '#e68f00'};
const GL = ['', '♟︎', '♞︎', '♝︎', '♜︎', '♛︎', '♚︎'];
export function boardPng(p, last, withShapes) {
  const sq = 56, mg = 26, W = sq * 8 + mg * 2, cv = document.createElement('canvas'); cv.width = W; cv.height = W;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2d31'; g.fillRect(0, 0, W, W);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const x = mg + f * sq, y = mg + (7 - r) * sq, s = r * 16 + f;
    g.fillStyle = ((r + f) & 1) ? '#f0d9b5' : '#b58863'; g.fillRect(x, y, sq, sq);
    if (last && (s === (last & 127) || s === ((last >> 7) & 127))) { g.fillStyle = 'rgba(242,226,74,.45)'; g.fillRect(x, y, sq, sq); }
  }
  g.fillStyle = '#e9e9ec'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    g.fillText(C.FILES[i], mg + i * sq + sq / 2, mg / 2); g.fillText(C.FILES[i], mg + i * sq + sq / 2, W - mg / 2);
    g.fillText(String(8 - i), mg / 2, mg + i * sq + sq / 2); g.fillText(String(8 - i), W - mg / 2, mg + i * sq + sq / 2);
  }
  g.font = `${Math.round(sq * .84)}px "Segoe UI Symbol","Noto Sans Symbols 2","DejaVu Sans",sans-serif`; g.lineJoin = 'round';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const q = p.b[r * 16 + f]; if (!q) continue;
    const x = mg + f * sq, y = mg + (7 - r) * sq, im = canvasPiece(q);
    if (im) { g.drawImage(im, x + 2, y + 2, sq - 4, sq - 4); continue; }
    const cx = x + sq / 2, cy = y + sq / 2 + 2;
    if (q >> 3) { g.lineWidth = 2; g.strokeStyle = '#e8e8ea'; g.strokeText(GL[q & 7], cx, cy); g.fillStyle = '#202023'; }
    else { g.lineWidth = 3.5; g.strokeStyle = '#1b1b1d'; g.strokeText(GL[q & 7], cx, cy); g.fillStyle = '#fff'; }
    g.fillText(GL[q & 7], cx, cy);
  }
  if (withShapes) {
    const tr = ([x, y]) => [mg + x * sq, mg + y * sq];
    for (const c of S.circles) { const [x, y] = tr(sqXY(c.s, false)); g.strokeStyle = ARROW_COL[c.c]; g.globalAlpha = .8; g.lineWidth = sq * .08; g.beginPath(); g.arc(x, y, sq * .44, 0, 7); g.stroke(); }
    for (const a of S.arrows) {
      const {line, head} = arrowGeom(a.f, a.t, false);
      g.globalAlpha = .8; g.strokeStyle = g.fillStyle = ARROW_COL[a.c]; g.lineWidth = sq * .16; g.lineJoin = 'round';
      g.beginPath(); line.forEach((pt, k) => { const [x, y] = tr(pt); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      g.beginPath(); head.forEach((pt, k) => { const [x, y] = tr(pt); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }
  return cv.toDataURL('image/png');
}
