/* puzzles without the page: the daily choice and its streak, Rush combos, the Battle bot, theme statistics and names.
   Pure functions (no DOM, no network), so tests/puzzles.test.js can run them. GPL-3.0-or-later */

/* ---------- dates (the local calendar day, as YYYY-MM-DD) ---------- */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const prevDay = k => { const d = dateOf(k); d.setDate(d.getDate() - 1); return dayKey(d); };
/* FNV-1a: the same day always gives the same number */
export const hash32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/* ---------- daily puzzle ---------- */
/* a puzzle a bit above your level, at least two moves of yours, not one of the recent daily puzzles */
export function dailyChoice(list, today, rating, recent = []) {
  const t = Math.max(800, Math.min(2300, rating + 100));
  const pool = list.filter(p => Math.abs(p.r - t) <= 200 && p.moves.split(' ').length >= 4 && !recent.includes(p.id));
  return pool.length ? pool[hash32(today) % pool.length] : null;
}
/* the first result of the day: 'clean' (no help), 'solved' (after a miss or a hint) or 'shown' (the solution).
   Finishing the line yourself keeps the streak going; seeing the solution does not. */
export function dailyMark(D, today, how) {
  if (D.date !== today || D.done) return false;
  D.done = how;
  if (how !== 'shown' && D.last !== today) {
    D.streak = (D.last === prevDay(today) ? D.streak || 0 : 0) + 1;
    D.last = today; D.best = Math.max(D.best || 0, D.streak);
    D.hist = [...(D.hist || []), today].slice(-60);
  }
  return true;
}
/* the streak as it stands today: it only breaks once a whole day is missed */
export const dailyStreak = (D, today) => D.last === today || D.last === prevDay(today) ? D.streak || 0 : 0;
/* the last seven days, oldest first: 'done', 'miss', or for today 'today' (still open) / 'shown' */
export function dailyWeek(D, today) {
  const out = [], hist = new Set(D.hist || []);
  for (let i = 6, k = today; i >= 0; i--) { out[i] = k; k = prevDay(k); }
  return out.map(k => ({k, dow: 'SMTWTFS'[dateOf(k).getDay()],
    state: hist.has(k) ? 'done' : k !== today ? 'miss' : D.date === today && D.done === 'shown' ? 'shown' : 'today'}));
}

/* ---------- Puzzle Rush combos (as lichess Puzzle Storm) ---------- */
/* correct moves in a row: 5 give 3 seconds, 12 give 5, 20 give 7, 30 give 10, then 10 more every 10 */
export const COMBO = [[5, 3], [12, 5], [20, 7], [30, 10]];
export function comboBonus(c) {
  const l = COMBO.find(([n]) => n === c);
  return l ? l[1] : c > 30 && (c - 30) % 10 === 0 ? 10 : 0;
}
/* the next level: {from, to, bonus}, for the meter */
export function comboLevel(c) {
  let from = 0;
  for (const [n, bonus] of COMBO) { if (c < n) return {from, to: n, bonus}; from = n; }
  const to = 40 + Math.floor((c - 30) / 10) * 10;
  return {from: to - 10, to, bonus: 10};
}

/* ---------- Puzzle Battle: the bot ---------- */
export const BOT_BASE = 3000;   /* ms per move on a puzzle at its own rating */
export const botOdds = (pr, br) => Math.min(.98, Math.max(.02, 1 / (1 + 10 ** ((pr - br) / 300))));
/* how the bot does on one puzzle: whether it solves it and when it is done. Simulated over the bundle:
   a 1200 bot scores about 10 in three minutes, a 1800 bot about 19. rnd is injectable for the tests. */
export function botPlan(rating, p, now, rnd = Math.random) {
  const n = Math.max(1, Math.floor(p.moves.split(' ').length / 2));   /* its moves in the line */
  const perMove = BOT_BASE * 2 ** Math.max(-1.3, Math.min(1.5, (p.r - rating) / 300));
  const jit = Math.exp((rnd() + rnd() + rnd() - 1.5) * .5);
  const solve = rnd() < botOdds(p.r, rating);
  const ms = 650 + 420 * (n - 1) + n * perMove * jit * (solve ? 1 : .5 + rnd());   /* the same waits as your auto-moves */
  return {solve, t0: now, until: now + ms};
}
/* three opponents around your puzzle rating */
export const botChoices = rating => [-300, 0, 300].map(d => ({d, rating: Math.max(400, Math.round((rating + d) / 50) * 50)}));
/* is the battle over? a and b are {score, out}; returns null or {res: 'win'|'loss'|'draw', why} */
export function battleEnd(a, b, timeUp) {
  const why = timeUp ? 'time' : a.out && b.out ? 'both' : a.out && b.score > a.score ? 'you-out' : b.out && a.score > b.score ? 'bot-out' : null;
  if (!why) return null;
  return {res: a.score > b.score ? 'win' : a.score < b.score ? 'loss' : 'draw', why};
}

/* ---------- picking ---------- */
/* the rating each puzzle of a run aims at */
export function targetRating(mode, n, rating) {
  if (mode === 'streak') return 700 + n * 45;
  if (mode === 'rush') return 550 + n * 70;
  if (mode === 'battle') return Math.min(2650, 600 + n * 60);
  return rating;
}
/* a random puzzle near the target, widening the window until something fits (no wider than maxW) */
export function pickFrom(list, target, {theme, exclude, maxW = 3000, rnd = Math.random} = {}) {
  const ok = p => (!theme || (p.ts || p.t.split(' ')).includes(theme)) && !(exclude && exclude.has(p.id));
  for (const w of [80, 160, 320, 3000]) {
    if (w > maxW) break;
    const c = list.filter(p => Math.abs(p.r - target) <= w && ok(p));
    if (c.length) return c[Math.floor(rnd() * c.length)];
  }
  return null;
}
/* nearest first: one you have not seen at about this level, then an older one at this level, and only then further away.
   exclude (this run's puzzles) is dropped last of all, the theme only when it has no puzzles at all */
export const NEAR = 320;
export function pickNear(list, target, {theme, seen = new Set(), exclude = new Set(), rnd} = {}) {
  const both = new Set([...seen, ...exclude]);
  return pickFrom(list, target, {theme, exclude: both, maxW: NEAR, rnd}) || pickFrom(list, target, {theme, exclude, maxW: NEAR, rnd})
    || pickFrom(list, target, {theme, exclude: both, rnd}) || pickFrom(list, target, {theme, exclude, rnd})
    || pickFrom(list, target, {theme, rnd}) || pickFrom(list, target, {rnd});
}

/* ---------- theme statistics (as the lichess puzzle dashboard) ---------- */
/* tags that say nothing about your skill: never counted (lichess PuzzleDashboard.irrelevantThemes, plus superGM) */
export const META = new Set(['oneMove', 'short', 'long', 'veryLong', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'equality', 'advantage', 'crushing', 'master', 'masterVsMaster', 'superGM', 'mix', 'checkFirst']);
export const MIN_PLAYED = 5;   /* a theme shows up as weak or strong after this many tries */
/* r = [played, firstTry, ratingSum]: the average rating, minus 500, plus 1000 times the share solved at the first try */
export const themePerf = r => r && r[0] ? Math.round(r[2] / r[0] - 500 + 1000 * r[1] / r[0]) : null;
/* record one result: every theme of the puzzle, plus the overall tally */
export function tallyAdd(themes, tally, p, ok) {
  for (const t of new Set(p.ts || p.t.split(' '))) {
    if (META.has(t) || !t) continue;
    const r = themes[t] || (themes[t] = [0, 0, 0]);
    r[0]++; r[1] += ok ? 1 : 0; r[2] += p.r;
  }
  tally[0]++; tally[1] += ok ? 1 : 0; tally[2] += p.r;
}
/* weak and strong themes, eight each: played enough, then below or above your overall performance */
export function themeDash(themes, tally, top = 8) {
  const perf = themePerf(tally);
  if (perf == null) return {weak: [], strong: [], perf};
  const all = Object.entries(themes || {}).filter(([t, r]) => !META.has(t) && r[0] >= MIN_PLAYED && r[0] > tally[0] / 40)
    .map(([t, r]) => ({t, n: r[0], first: r[1], failed: r[0] - r[1], perf: themePerf(r)}))
    .sort((a, b) => a.perf - b.perf || b.n - a.n);
  return {perf, weak: all.filter(x => x.failed >= 3 && x.perf < perf).slice(0, top),
    strong: all.filter(x => x.first >= 3 && x.perf > perf).slice(-top).reverse()};
}

/* ---------- theme names and groups (every lichess theme) ---------- */
export const THEME_NAMES = {
  opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame', rookEndgame: 'Rook endgame', bishopEndgame: 'Bishop endgame',
  pawnEndgame: 'Pawn endgame', knightEndgame: 'Knight endgame', queenEndgame: 'Queen endgame', queenRookEndgame: 'Queen and rook endgame',
  advancedPawn: 'Advanced pawn', attackingF2F7: 'Attacking f2 or f7', capturingDefender: 'Capture the defender', discoveredAttack: 'Discovered attack',
  doubleCheck: 'Double check', exposedKing: 'Exposed king', fork: 'Fork', hangingPiece: 'Hanging piece', kingsideAttack: 'Kingside attack', pin: 'Pin',
  queensideAttack: 'Queenside attack', sacrifice: 'Sacrifice', skewer: 'Skewer', trappedPiece: 'Trapped piece',
  attraction: 'Attraction', clearance: 'Clearance', collinearMove: 'Collinear move', discoveredCheck: 'Discovered check', defensiveMove: 'Defensive move',
  deflection: 'Deflection', interference: 'Interference', intermezzo: 'Intermezzo', quietMove: 'Quiet move', xRayAttack: 'X-ray attack', zugzwang: 'Zugzwang',
  mate: 'Checkmate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5 or more',
  anastasiaMate: 'Anastasia\'s mate', arabianMate: 'Arabian mate', backRankMate: 'Back-rank mate', balestraMate: 'Balestra mate',
  blindSwineMate: 'Blind swine mate', bodenMate: 'Boden\'s mate', cornerMate: 'Corner mate', doubleBishopMate: 'Double bishop mate',
  dovetailMate: 'Dovetail mate', epauletteMate: 'Epaulette mate', hookMate: 'Hook mate', killBoxMate: 'Kill box mate', pillsburysMate: 'Pillsbury\'s mate',
  morphysMate: 'Morphy\'s mate', operaMate: 'Opera mate', swallowstailMate: 'Swallow\'s tail mate', triangleMate: 'Triangle mate',
  vukovicMate: 'Vukovic mate', smotheredMate: 'Smothered mate',
  castling: 'Castling', enPassant: 'En passant', promotion: 'Promotion', underPromotion: 'Underpromotion',
  equality: 'Equality', advantage: 'Advantage', crushing: 'Crushing', oneMove: 'One move', short: 'Short', long: 'Long', veryLong: 'Very long',
  master: 'Master games', masterVsMaster: 'Master against master', superGM: 'Super GM games', mix: 'Healthy mix', checkFirst: 'Check first',
};
export const themeName = t => THEME_NAMES[t] || t.replace(/([A-Z0-9]+)/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
/* the dashboard's groups, in lichess order (the mate patterns join Checkmate) */
export const THEME_GROUPS = [
  ['Phases', ['opening', 'middlegame', 'endgame', 'rookEndgame', 'bishopEndgame', 'pawnEndgame', 'knightEndgame', 'queenEndgame', 'queenRookEndgame']],
  ['Motifs', ['advancedPawn', 'attackingF2F7', 'capturingDefender', 'discoveredAttack', 'doubleCheck', 'exposedKing', 'fork', 'hangingPiece',
    'kingsideAttack', 'pin', 'queensideAttack', 'sacrifice', 'skewer', 'trappedPiece']],
  ['Advanced', ['attraction', 'clearance', 'collinearMove', 'discoveredCheck', 'defensiveMove', 'deflection', 'interference', 'intermezzo',
    'quietMove', 'xRayAttack', 'zugzwang']],
  ['Mates', ['mate', 'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'balestraMate', 'blindSwineMate', 'bodenMate', 'cornerMate',
    'doubleBishopMate', 'dovetailMate', 'epauletteMate', 'hookMate', 'killBoxMate', 'morphysMate', 'operaMate', 'pillsburysMate',
    'swallowstailMate', 'triangleMate', 'vukovicMate']],
  ['Special moves', ['promotion', 'underPromotion', 'castling', 'enPassant']],
];

/* ---------- formatting ---------- */
export const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const fmtBytes = b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
/* "5.1 M" (or "5,1 M", as your system writes numbers) */
export const fmtCount = n => n >= 1e6 ? `${(n / 1e6).toLocaleString(undefined, {maximumFractionDigits: 1})} M` : n.toLocaleString();
