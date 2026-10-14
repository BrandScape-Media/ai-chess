/* the background match runner: plays tournament games between computer players while you play your own game.
   GPL-3.0-or-later

   Two lanes run at once. Each lane has its own web worker for the built-in engine and the historic bots, and its own
   copy of every UCI engine on the server (slots "t1" and "t2", one thread each), so the background never slows your
   game's engine or the analysis. AI models answer one at a time across both lanes: a local server runs one model. */
import * as C from './core.js';
import {api} from './util.js';
import {BOTS} from './historic.js';
import {llmRequest, stripThink} from './players.js';
import {getFF} from './ffish-load.js';
import {byId as variantById, splitMove, sides} from './variant-catalog.js';
import {botMove} from './variants.js';

const SPEED = {quick: {ms: 120, pace: 60}, normal: {ms: 350, pace: 260}};
const MAX_PLIES = 240;   /* a game that long is adjudicated a draw */

let llmBusy = Promise.resolve();   /* AI models take turns */

export class Lane {
  constructor(slot) { this.slot = slot; this.worker = null; this.req = 0; this.wait = new Map(); this.game = null; this.stopped = false; }
  workerFor() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module'});
    this.worker.onmessage = e => { const d = e.data; if (!d.done) return; const r = this.wait.get(d.id); if (r) { this.wait.delete(d.id); r(d.res); } };
    this.worker.onerror = () => { for (const r of this.wait.values()) r(null); this.wait.clear(); this.worker = null; };
    return this.worker;
  }
  stop() {
    this.stopped = true;
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    for (const r of this.wait.values()) r(null);
    this.wait.clear();
    this.ctl?.abort();
  }
  /* play one game; onMove(state) after every move; resolves {result, reason, moves (UCI)} or null when stopped */
  async play(game, white, black, opts, onMove) {
    if (opts.variant) return this.playVariant(game, white, black, opts, onMove);
    this.stopped = false; this.game = game.id;
    const sp = SPEED[opts.speed] || SPEED.normal, engines = opts.engines || [];
    const pos = new C.Pos(C.START_FEN, 0, false), raw = [], uci = [];
    const live = {id: game.id, fen: pos.fen(), last: 0, plies: 0, white, black};
    onMove && onMove(live);
    while (!this.stopped) {
      const st = pos.status();
      if (st.over) return this.finish({result: st.result, reason: st.reason, moves: uci});
      if (raw.length >= MAX_PLIES) return this.finish({result: '1/2-1/2', reason: 'move limit', moves: uci});
      const P = pos.turn === 0 ? white : black, t0 = performance.now();
      let m = 0;
      try { m = await this.move(P, pos, raw, uci, sp, engines, game.id); } catch (e) { m = 0; }
      if (this.stopped) break;
      const legal = pos.legalMoves();
      if (!m || !legal.includes(m)) m = legal[Math.floor(Math.random() * legal.length)];   /* a broken answer: any legal move */
      uci.push(C.uci(m, false)); raw.push(m); pos.make(m);
      Object.assign(live, {fen: pos.fen(), last: m, plies: raw.length});
      onMove && onMove(live);
      const wait = sp.pace - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    this.game = null;
    return null;
  }
  finish(r) { this.game = null; return r; }
  /* a variant game: rules from ffish, moves from Fairy-Stockfish, the variant bot or an AI model */
  async playVariant(game, white, black, opts, onMove) {
    this.stopped = false; this.game = game.id;
    const vid = opts.variant, sp = SPEED[opts.speed] || SPEED.normal, ff = await getFF();
    const b = new ff.Board(vid), fen0 = b.fen(), moves = [];
    const live = {id: game.id, fen: fen0, last: null, plies: 0, white, black, variant: vid};
    onMove && onMove(live);
    try {
      while (!this.stopped) {
        if (b.isGameOver(true)) {
          const res = b.result(true), n = b.numberLegalMoves();
          const reason = n === 0 && b.isCheck() ? 'checkmate' : res === '1/2-1/2' ? (n === 0 ? 'stalemate' : 'draw') : (variantById(vid).win || 'the variant rule');
          return this.finish({result: res, reason, moves});
        }
        if (moves.length >= MAX_PLIES) return this.finish({result: '1/2-1/2', reason: 'move limit', moves});
        const side = b.turn() ? 0 : 1, P = side ? black : white, t0 = performance.now(), legal = b.legalMoves().split(' ').filter(Boolean);
        let u = null;
        try { u = await this.vmove(P, vid, fen0, moves, b, legal, sp, opts.engines || [], game.id); } catch (e) { u = null; }
        if (this.stopped) break;
        if (!u || !legal.includes(u)) u = legal[Math.floor(Math.random() * legal.length)];
        b.push(u); moves.push(u);
        const s = splitMove(u);
        Object.assign(live, {fen: b.fen(), last: s ? {from: s.from, to: s.to} : null, plies: moves.length});
        onMove && onMove(live);
        const wait = sp.pace - (performance.now() - t0);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
    } finally { b.delete(); }
    this.game = null;
    return null;
  }
  async vmove(P, vid, fen0, moves, b, legal, sp, engines, gameId) {
    if (P.type === 'llm') {
      const prev = llmBusy; let release; llmBusy = new Promise(r => { release = r; }); await prev;
      try {
        const v = variantById(vid), names = sides(vid), side = b.turn() ? 0 : 1;
        const msgs = [{role: 'system', content: `You are playing a tournament game of ${v.name}, a chess variant, as ${names[side]}. Rules: ${v.rules} Answer with one move from the list of legal moves, exactly as written, and nothing else.`},
          {role: 'user', content: `Position (FEN): ${b.fen()}\nBoard:\n${b.toString()}\nLegal moves: ${legal.slice(0, 300).join(' ')}\nYour move:`}];
        this.ctl = new AbortController();
        const txt = stripThink(await llmRequest({...P, think: 'none'}, msgs, this.ctl.signal, {maxTokens: 600, think: 'none', temperature: .4}));
        return txt.split(/[\s`'"(),.;:!?]+/).find(t => legal.includes(t)) || null;
      } finally { release(); }
    }
    if (P.type === 'vbot' || !P.engine || P.engine === 'builtin') {
      const r = await botMove(vid, fen0, moves.slice(), P.level ?? 1, sp.ms * 2);
      return r && r.move;
    }
    this.ctl = new AbortController();
    const r = await api('/api/engine/go', {engine: P.engine, game: 'tourney-' + gameId, slot: this.slot, variant: vid, chess960: false, fen: fen0,
      moves: moves.slice(), movetime: sp.ms, elo: P.elo || null}, this.ctl.signal);
    return r.bestmove;
  }
  async move(P, pos, raw, uci, sp, engines, gameId) {
    if (P.type === 'llm') return this.llmMove(P, pos);
    const id = P.engine || 'builtin';
    if (id === 'builtin' || BOTS[id]) {
      const w = this.workerFor(), rid = ++this.req;
      const res = await new Promise(resolve => {
        this.wait.set(rid, resolve);
        w.postMessage({id: rid, fen: C.START_FEN, variant: 0, c960: false, moves: raw.slice(), level: P.level ?? 2, bot: BOTS[id] ? id : null, maxMs: sp.ms});
      });
      return res && res.move;
    }
    const e = engines.find(x => x.id === id);
    if (!e) throw new Error('engine missing');
    this.ctl = new AbortController();
    const r = await api('/api/engine/go', {engine: id, game: 'tourney-' + gameId, slot: this.slot, variant: 'chess', chess960: false, fen: C.START_FEN,
      moves: uci.slice(), movetime: sp.ms, elo: e.kind === 'elo' ? (P.elo || null) : null, nodes: e.kind === 'nodes' ? (P.nodes || 100) : null, maia: P.maia || 1500}, this.ctl.signal);
    return pos.fromUci(r.bestmove || '');
  }
  /* an AI model: the board, the legal moves and three tries; models take turns so a local server runs one at a time */
  async llmMove(P, pos) {
    const prev = llmBusy;
    let release;
    llmBusy = new Promise(r => { release = r; });
    await prev;
    try {
      const legal = pos.legalMoves(), side = pos.turn ? 'Black' : 'White';
      const list = legal.map(m => pos.toUci(m)).join(' ');
      const msgs = [{role: 'system', content: `You are playing a tournament game of chess as ${side}. Answer with one move in UCI notation (from-square then to-square, like e2e4; add the piece for a promotion, like e7e8q) and nothing else.`},
        {role: 'user', content: `Position (FEN): ${pos.fen()}\nLegal moves: ${list}\nYour move as ${side}:`}];
      for (let i = 0; i < 3 && !this.stopped; i++) {
        this.ctl = new AbortController();
        const txt = stripThink(await llmRequest({...P, think: 'none'}, msgs, this.ctl.signal, {maxTokens: 600, think: 'none', temperature: .4}));
        const m = pickMove(txt, pos, legal);
        if (m) return m;
        msgs.push({role: 'assistant', content: txt.slice(-200) || '?'}, {role: 'user', content: 'That is not one of the legal moves. Answer with one legal move in UCI notation.'});
      }
      return 0;
    } finally { release(); }
  }
}
/* the first token in the reply that is a legal move (UCI or SAN) */
function pickMove(txt, pos, legal) {
  const uciMap = new Map(), sanMap = new Map();
  for (const m of legal) { uciMap.set(pos.toUci(m), m); sanMap.set(pos.san(m).replace(/[+#?!]/g, ''), m); }
  for (const t of String(txt).split(/[^A-Za-z0-9=\-]+/).filter(Boolean)) {
    const u = t.toLowerCase().replace(/^([a-h][1-8])-([a-h][1-8])/, '$1$2');
    if (uciMap.has(u)) return uciMap.get(u);
    if (sanMap.has(t)) return sanMap.get(t);
  }
  return 0;
}
