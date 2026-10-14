/* tournaments: pairings, results and standings for every format. Pure logic, no DOM, tested in tests/tourney.test.js.
   GPL-3.0-or-later

   Formats
   - rr      round-robin: everyone meets everyone once (circle method), most points wins
   - swiss   Swiss: a few rounds, each pairs players on the same score, no rematches; Buchholz breaks ties
   - ko      knockout: a bracket seeded by rating, the winner of each match goes on; a drawn game is replayed
             with colours swapped, after three draws the higher seed goes through
   - arena   arena: for a fixed time anyone free is paired again at once; a win is 2 points, a draw 1, and after
             two wins in a row every game counts double until you stop winning (lichess style). With scoring
             "streak" the longest run of wins takes the title instead
   - climb   rating climb: rounds paired by tournament rating; every game moves both ratings, the biggest gain wins

   A tournament is plain JSON (saved by the server): players, games and a few per-format fields. Standings are
   always recomputed from the finished games, so a result can never be counted twice. */

export const FORMATS = {
  rr: {name: 'Round-robin', short: 'Everyone plays everyone once', min: 3, max: 10},
  swiss: {name: 'Swiss', short: 'A few rounds, paired by score', min: 4, max: 16},
  ko: {name: 'Knockout', short: 'Lose and you are out', min: 4, max: 16},
  arena: {name: 'Arena', short: 'Nonstop games against the clock', min: 4, max: 16},
  climb: {name: 'Rating climb', short: 'Gain the most rating to win', min: 4, max: 16},
};
export const YOU = 'you';
const SCORE = {'1-0': [1, 0], '0-1': [0, 1], '1/2-1/2': [.5, .5]};

let seq = 0;
const gid = () => 'g' + Date.now().toString(36) + (seq++).toString(36);

/* ---------- creating ---------- */
/* players: [{id, name, rating, ...}] (the person, if playing, has id "you"); opts: {format, name, rounds, minutes, scoring, now} */
export function createTournament(players, opts) {
  const f = opts.format;
  if (!FORMATS[f]) throw new Error('unknown format');
  const t = {id: 't' + Date.now().toString(36), v: 1, format: f, name: opts.name || FORMATS[f].name, created: opts.now ?? Date.now(),
    status: 'live', round: 1, rounds: 0, players: players.map(p => ({...p})), games: [], doneSeq: 0, tc: opts.tc || null, speed: opts.speed || 'normal',
    variant: opts.variant || null};   /* null: standard chess; otherwise a variant id (variant-catalog.js) */
  const n = players.length;
  if (f === 'rr') { t.rounds = n % 2 ? n : n - 1; t.games = roundRobin(t.players); }
  else if (f === 'swiss' || f === 'climb') {
    t.rounds = Math.max(2, Math.min(opts.rounds || swissRounds(n), n - 1));
    if (f === 'climb') t.start = Object.fromEntries(t.players.map(p => [p.id, p.rating || 1500]));
    t.games = pairSwiss(t, 1);
  } else if (f === 'ko') {
    t.ko = {rounds: Math.ceil(Math.log2(n)), matches: []};
    t.rounds = t.ko.rounds;
    seedBracket(t);
  } else if (f === 'arena') {
    t.rounds = 0; t.round = 0;
    t.arena = {minutes: opts.minutes || 10, ends: (opts.now ?? Date.now()) + (opts.minutes || 10) * 60e3, scoring: opts.scoring === 'streak' ? 'streak' : 'points'};
  }
  return t;
}
/* the usual Swiss length: log2(players) + 1 rounds, and never so many that rematches become unavoidable */
export const swissRounds = n => Math.max(3, Math.min(n - 2, Math.ceil(Math.log2(n)) + 1));

/* circle method: player 0 stays, the rest rotate; colours alternate so nobody gets White every time */
function roundRobin(players) {
  const ids = players.map(p => p.id);
  if (ids.length % 2) ids.push(null);   /* a bye */
  const n = ids.length, games = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      if (a === null || b === null) { games.push(byeGame(a ?? b, r + 1)); continue; }
      const flip = (r + i) % 2 === 1;
      games.push(newGame(flip ? b : a, flip ? a : b, r + 1));
    }
    ids.splice(1, 0, ids.pop());
  }
  return games;
}
function newGame(w, b, round, extra = {}) { return {id: gid(), round, w, b, status: 'pending', result: null, reason: '', moves: [], ...extra}; }
function byeGame(p, round) { return {id: gid(), round, w: p, b: null, bye: true, status: 'done', result: '1-0', reason: 'bye', moves: [], seq: 0}; }

/* ---------- standings ---------- */
const done = t => t.games.filter(g => g.status === 'done').sort((a, b) => (a.seq || 0) - (b.seq || 0));
export function standings(t) {
  const S = {};
  for (const p of t.players) S[p.id] = {id: p.id, p, pts: 0, score: 0, games: 0, w: 0, d: 0, l: 0, opps: [], colors: [], streak: 0, best: 0, fire: false, byes: 0,
    elo: t.start?.[p.id] ?? (p.rating || 1500), form: []};
  for (const g of done(t)) {
    if (g.bye) { const s = S[g.w]; if (s) { s.score += 1; s.pts += t.format === 'arena' ? 0 : 1; s.byes++; s.form.push('bye'); } continue; }
    const [sw, sb] = SCORE[g.result] || [0, 0], W = S[g.w], B = S[g.b];
    if (!W || !B) continue;
    const ew = 1 / (1 + Math.pow(10, (B.elo - W.elo) / 400)), k = 32;
    for (const [me, op, sc, col, exp] of [[W, B, sw, 'w', ew], [B, W, sb, 'b', 1 - ew]]) {
      me.games++; me.score += sc; me.opps.push(op.id); me.colors.push(col);
      if (sc === 1) me.w++; else if (sc === .5) me.d++; else me.l++;
      me.form.push(sc === 1 ? 'w' : sc === .5 ? 'd' : 'l');
      if (t.format === 'arena') {
        const base = sc === 1 ? 2 : sc === .5 ? 1 : 0;
        me.pts += me.fire ? base * 2 : base;
      } else me.pts += sc;
      me.eloNext = me.elo + k * (sc - exp);
    }
    for (const me of [W, B]) {
      me.elo = me.eloNext;
      const won = me.form[me.form.length - 1] === 'w';
      me.streak = won ? me.streak + 1 : 0;
      me.best = Math.max(me.best, me.streak);
      me.fire = me.streak >= 2;
    }
  }
  const list = Object.values(S);
  for (const s of list) {
    s.buchholz = s.opps.reduce((a, o) => a + (S[o]?.score || 0), 0);
    s.sb = done(t).reduce((a, g) => {
      if (g.bye) return a;
      if (g.w === s.id) return a + (SCORE[g.result]?.[0] || 0) * (S[g.b]?.score || 0);
      if (g.b === s.id) return a + (SCORE[g.result]?.[1] || 0) * (S[g.w]?.score || 0);
      return a;
    }, 0);
    s.gain = Math.round(s.elo - (t.start?.[s.id] ?? (s.p.rating || 1500)));
    s.elo = Math.round(s.elo);
  }
  const by = {
    rr: (a, b) => b.pts - a.pts || b.sb - a.sb || b.w - a.w,
    swiss: (a, b) => b.pts - a.pts || b.buchholz - a.buchholz || b.sb - a.sb,
    climb: (a, b) => b.gain - a.gain || b.pts - a.pts,
    arena: t.arena?.scoring === 'streak' ? (a, b) => b.best - a.best || b.pts - a.pts : (a, b) => b.pts - a.pts || b.best - a.best || b.w - a.w,
    ko: (a, b) => (koReach(t, b.id) - koReach(t, a.id)) || b.pts - a.pts,
  }[t.format];
  list.sort((a, b) => by(a, b) || (b.p.rating || 0) - (a.p.rating || 0));
  list.forEach((s, i) => { s.rank = i + 1; });
  return list;
}

/* ---------- Swiss and rating-climb pairing ---------- */
/* players on the same score (or, for the climb, close tournament ratings) meet; nobody plays the same opponent twice
   while there is another choice; with an odd number the lowest player without a bye yet gets one (a free point) */
function pairSwiss(t, round) {
  const st = standings(t), key = t.format === 'climb' ? (a, b) => b.elo - a.elo : (a, b) => b.score - a.score || (b.p.rating || 0) - (a.p.rating || 0);
  const pool = st.slice().sort(key), games = [];
  if (pool.length % 2) {
    let i = pool.length - 1;
    while (i > 0 && pool[i].byes) i--;
    games.push(byeGame(pool[i].id, round));
    pool.splice(i, 1);
  }
  const pairs = matchPool(pool);
  for (const [a, b] of pairs) {
    /* White goes to whoever has had it less often; on a tie, to whoever had Black last */
    const da = colorDiff(a), db = colorDiff(b), la = a.colors[a.colors.length - 1], lb = b.colors[b.colors.length - 1];
    const aWhite = da !== db ? da < db : la !== lb ? la === 'b' : Math.random() < .5;
    games.push(newGame(aWhite ? a.id : b.id, aWhite ? b.id : a.id, round));
  }
  return games;
}
const whites = s => s.colors.filter(c => c === 'w').length;
const colorDiff = s => whites(s) - s.colors.filter(c => c === 'b').length;
/* top-down greedy pairing with backtracking, so a late player is never left with only a rematch when a swap avoids it */
function matchPool(pool) {
  let out = [], steps = 0;
  /* try the strictest rules first: no rematch and colours that work for both (two players who both need the same
     colour badly are not paired), then no rematch, and only as a last resort a rematch (backtracking, capped) */
  const fits = (a, b, level) => (level >= 2 || !a.opps.includes(b.id)) && (level >= 1 || !clash(a, b));
  const go = (rest, level) => {
    if (!rest.length) return true;
    if (++steps > 20000) return false;
    const [a, ...others] = rest;
    /* under relaxed rules still try the least bad opponents first */
    const order = others.map((b, j) => [j, (a.opps.includes(b.id) ? 2 : 0) + (clash(a, b) ? 1 : 0)]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
    for (const j of order) {
      const b = others[j];
      if (!fits(a, b, level)) continue;
      out.push([a, b]);
      if (go(others.filter((_, k) => k !== j), level)) return true;
      out.pop();
    }
    return false;
  };
  for (let level = 0; level <= 2; level++) { out = []; steps = 0; if (go(pool, level)) break; }
  return out;
}
const clash = (a, b) => (colorDiff(a) >= 2 && colorDiff(b) >= 2) || (colorDiff(a) <= -2 && colorDiff(b) <= -2);

/* ---------- knockout ---------- */
/* standard seeding: 1 meets the lowest seed, and the top two seeds can only meet in the final; empty slots are byes */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) order = order.flatMap(s => [s, order.length * 2 + 1 - s]);
  return order;
}
function seedBracket(t) {
  const size = 1 << t.ko.rounds, seeds = t.players.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
  t.ko.seed = Object.fromEntries(seeds.map((p, i) => [p.id, i + 1]));
  const order = seedOrder(size).map(s => seeds[s - 1]?.id ?? null);
  for (let i = 0; i < size / 2; i++) {
    const m = {id: 'm1-' + i, round: 1, slot: i, a: order[2 * i], b: order[2 * i + 1], winner: null, games: []};
    t.ko.matches.push(m);
    if (!m.a || !m.b) m.winner = m.a || m.b;   /* a bye goes straight through */
    else koGame(t, m);
  }
  koAdvance(t);
}
function koGame(t, m) {
  const n = m.games.length, aw = n % 2 === 0;   /* colours swap on each replay */
  const g = newGame(aw ? m.a : m.b, aw ? m.b : m.a, m.round, {match: m.id});
  m.games.push(g.id); t.games.push(g);
}
/* how far a player got: the round they lost in, or one past the last round for the champion */
function koReach(t, pid) {
  let reach = 0;
  for (const m of t.ko?.matches || []) {
    if (m.a !== pid && m.b !== pid) continue;
    reach = Math.max(reach, m.winner === pid ? m.round + 1 : m.round);
  }
  return reach;
}
function koAdvance(t) {
  for (let r = 1; r <= t.ko.rounds; r++) {
    const ms = t.ko.matches.filter(m => m.round === r);
    if (ms.some(m => !m.winner)) { t.round = r; return; }
    if (r === t.ko.rounds) { t.round = r; t.status = 'done'; t.champion = ms[0].winner; return; }
    if (t.ko.matches.some(m => m.round === r + 1)) continue;
    for (let i = 0; i < ms.length / 2; i++) {
      const m = {id: `m${r + 1}-${i}`, round: r + 1, slot: i, a: ms[2 * i].winner, b: ms[2 * i + 1].winner, winner: null, games: []};
      t.ko.matches.push(m);
      koGame(t, m);
    }
  }
}

/* ---------- arena ---------- */
/* everybody free is paired again right away: high scores meet each other, never the same opponent twice in a row.
   You are paired only while you are ready (the "pair me" switch); a game for you waits until you start it. */
export function arenaPair(t, now, youReady) {
  if (t.format !== 'arena' || t.status !== 'live' || now >= t.arena.ends) return [];
  const busy = new Set(t.games.filter(g => g.status !== 'done').flatMap(g => [g.w, g.b]));
  const st = standings(t), last = {};
  for (const g of done(t)) { last[g.w] = g.b; last[g.b] = g.w; }
  const free = st.filter(s => !busy.has(s.id) && (s.id !== YOU || youReady));
  const out = [];
  while (free.length >= 2) {
    const a = free.shift();
    let j = free.findIndex(b => last[a.id] !== b.id);
    if (j < 0) j = 0;
    const b = free.splice(j, 1)[0];
    const aWhite = whites(a) <= whites(b);
    const g = newGame(aWhite ? a.id : b.id, aWhite ? b.id : a.id, 0);
    t.games.push(g); out.push(g);
  }
  return out;
}

/* ---------- results ---------- */
/* record a finished game, then move the tournament on (next round, next knockout game, or the end) */
export function recordResult(t, id, result, reason, moves, now) {
  const g = t.games.find(x => x.id === id);
  if (!g || g.status === 'done' || !SCORE[result]) return false;
  Object.assign(g, {status: 'done', result, reason: reason || '', moves: moves || g.moves, seq: ++t.doneSeq, at: now || Date.now()});
  if (t.format === 'ko') {
    const m = t.ko.matches.find(x => x.id === g.match);
    if (m && !m.winner) {
      if (result !== '1/2-1/2') m.winner = result === '1-0' ? g.w : g.b;
      else if (m.games.length >= 3) m.winner = (t.ko.seed[m.a] || 99) < (t.ko.seed[m.b] || 99) ? m.a : m.b;   /* three draws: the higher seed */
      else koGame(t, m);
    }
    koAdvance(t);
    return true;
  }
  advance(t, now);
  return true;
}
/* a game that could not be played (for example you left the arena) is dropped without a result */
export function dropGame(t, id) {
  const i = t.games.findIndex(x => x.id === id && x.status !== 'done');
  if (i >= 0) t.games.splice(i, 1);
}
export function advance(t, now) {
  if (t.status !== 'live') return;
  if (t.format === 'arena') {
    if ((now || Date.now()) >= t.arena.ends && !t.games.some(g => g.status === 'playing')) {
      for (const g of t.games.filter(x => x.status === 'pending')) dropGame(t, g.id);
      t.status = 'done';
    }
    return;
  }
  const open = t.games.filter(g => g.round === t.round && g.status !== 'done');
  if (open.length) return;
  if (t.round >= t.rounds) { t.status = 'done'; return; }
  t.round++;
  if (t.format === 'swiss' || t.format === 'climb') t.games.push(...pairSwiss(t, t.round));
}
/* games that can start now: this round's (or the arena's) pending games */
export function readyGames(t) {
  if (t.status !== 'live') return [];
  return t.games.filter(g => g.status === 'pending' && (t.format === 'arena' || t.format === 'ko' || g.round === t.round));
}
/* the person's next game, if there is one waiting */
export const yourGame = t => readyGames(t).find(g => g.w === YOU || g.b === YOU) || null;
export const winnerOf = t => t.status === 'done' ? (t.format === 'ko' ? t.champion : standings(t)[0]?.id) : null;
export const playerById = (t, id) => t.players.find(p => p.id === id) || null;
