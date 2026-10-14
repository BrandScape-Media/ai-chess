/* the variants: rules text, piece kinds, board look. Pure data and helpers, tested in tests/variants.test.js.
   GPL-3.0-or-later

   Rules, legal moves and results come from ffish (Fairy-Stockfish's rules in WebAssembly); every id here is a
   Fairy-Stockfish variant name, so the same id goes to the engine as UCI_Variant. `engine: false` marks the few that
   only the rules library knows: the variant bot and AI models play those. */

export const GROUPS = [
  {id: 'twist', name: 'Same pieces, new rules'},
  {id: 'fairy', name: 'New pieces'},
  {id: 'big', name: 'Bigger boards'},
  {id: 'east', name: 'Xiangqi and Shogi'},
  {id: 'old', name: 'Old and Southeast Asian chess'},
  {id: 'small', name: 'Small boards'},
];

/* [id, name, group, one line, the rules (shown on the card and given to AI models), how a variant win is called] */
const LIST = [
  ['crazyhouse', 'Crazyhouse', 'twist', 'Captured pieces join your army.',
    'Normal chess, except that a piece you capture changes colour and goes into your hand. Instead of a move you may drop a piece from your hand on any empty square (pawns not on the first or last rank). A promoted pawn goes back to the hand as a pawn.'],
  ['atomic', 'Atomic', 'twist', 'Every capture is an explosion.',
    'A capture explodes: the capturing piece and every piece next to the capture square disappear, except pawns. Blow up the enemy king to win. Kings cannot capture, and you may not explode your own king.', 'king exploded'],
  ['antichess', 'Antichess', 'twist', 'Lose all your pieces to win.',
    'Captures are compulsory: if you can take, you must. The king is an ordinary piece with no check, and pawns may promote to a king. The first side with no pieces left, or with no move, wins.', 'no pieces left'],
  ['horde', 'Horde', 'twist', 'Thirty-six pawns against a full army.',
    'White has 36 pawns and no king. Black wins by capturing every white piece; White wins by checkmating the black king. White pawns on the first rank may also move two squares.', 'the horde is gone'],
  ['racingkings', 'Racing Kings', 'twist', 'First king to the eighth rank wins.',
    'Both armies start on the first two ranks. Nobody may give check, ever. The first king to reach the eighth rank wins; if White gets there first, Black has one move to reach it too and draw.', 'king reached the eighth rank'],
  ['duck', 'Duck chess', 'twist', 'After every move, place the duck.',
    'After each move you must move the duck to a different empty square. Nothing can pass through or land on the duck. There is no check: you win by capturing the king.', 'king captured', false],
  ['5check', 'Five-check', 'twist', 'Give check five times to win.',
    'Normal chess, but the fifth check you give wins the game.', 'five checks'],
  ['extinction', 'Extinction', 'twist', 'Wipe out a whole kind of piece.',
    'There is no check. You win when your opponent has lost every piece of one kind: all pawns, all knights, all bishops, all rooks, the queen or the king. Pawns may promote to a king.', 'a whole kind of piece is gone'],
  ['knightmate', 'Knightmate', 'twist', 'The king moves like a knight.',
    'The royal piece moves like a knight, and the two "manns" in the knights\' place move like kings. Checkmate the royal knight to win.'],
  ['placement', 'Placement', 'twist', 'Set up your own back rank first.',
    'Only the pawns start on the board. The players take turns dropping their king, queen, rooks, bishops and knights on their own first rank (bishops on different colours), then play on as normal chess.'],
  ['pocketknight', 'Pocket Knight', 'twist', 'An extra knight in your pocket.',
    'Normal chess, but each side has one extra knight in hand that can be dropped on any empty square instead of a move, once.'],
  ['coregal', 'Coregal', 'twist', 'The queen is royal too.',
    'Normal chess, but both the king and the queen are royal: checkmating either one wins, and you may not leave either in check.'],
  ['hoppelpoppel', 'Hoppel-Poppel', 'twist', 'Knights and bishops swap captures.',
    'Knights move like knights but capture like bishops; bishops move like bishops but capture like knights.'],
  ['berolina', 'Berolina', 'twist', 'Pawns move diagonally.',
    'Pawns move one square diagonally forward (two from the start) and capture one square straight ahead. Everything else is normal chess.', '', false],
  ['breakthrough', 'Breakthrough', 'twist', 'Pawns only: break through.',
    'Each side has two rows of pawns that move one square straight or diagonally forward and capture diagonally. The first pawn to reach the far side wins.', 'a pawn broke through'],

  ['seirawan', 'Seirawan', 'fairy', 'Hawk and elephant enter from the back rank.',
    'Each side has a hawk (bishop and knight) and an elephant (rook and knight) in hand. When a piece leaves its starting square on the first rank for the first time, you may put the hawk or the elephant on the square it left.'],
  ['shouse', 'S-House', 'fairy', 'Seirawan with Crazyhouse drops.',
    'Seirawan chess (hawk and elephant enter the board behind a piece that leaves the back rank), plus Crazyhouse: captured pieces go to your hand and can be dropped.'],
  ['almost', 'Almost Chess', 'fairy', 'A chancellor instead of the queen.',
    'Normal chess, but each queen is replaced by a chancellor, which moves like a rook or a knight.'],
  ['amazon', 'Amazon', 'fairy', 'The queen also jumps like a knight.',
    'Normal chess, but the queens are amazons: they move like a queen or a knight.'],
  ['grasshopper', 'Grasshopper', 'fairy', 'A row of hopping grasshoppers.',
    'Each side has a row of grasshoppers in front of the pawns. A grasshopper moves along queen lines but must jump over exactly one piece and land on the square right behind it (capturing there if an enemy stands on it).'],
  ['nightrider', 'Nightrider', 'fairy', 'Knights that keep riding.',
    'The knights are nightriders: they make any number of knight jumps in the same direction, as long as the squares they land on in between are empty.'],
  ['chigorin', 'Chigorin', 'fairy', 'Knights and a chancellor against bishops and a queen.',
    'White has four knights and a chancellor (rook and knight); Black has four bishops and a queen. Pawns promote to pieces of their own side.'],

  ['capablanca', 'Capablanca', 'big', 'Ten files, archbishop and chancellor.',
    'Chess on a 10 by 8 board with two new pieces: the archbishop (bishop and knight) and the chancellor (rook and knight). The king castles three squares.'],
  ['capahouse', 'Capahouse', 'big', 'Capablanca with drops.',
    'Capablanca chess (10 by 8, archbishop and chancellor) with Crazyhouse rules: captured pieces go to your hand and can be dropped.'],
  ['gothic', 'Gothic', 'big', 'Capablanca with a sharper setup.',
    'Capablanca chess on 10 by 8 with archbishop and chancellor, from a setup where no pawn is undefended.'],
  ['embassy', 'Embassy', 'big', 'Marshal and cardinal on ten files.',
    'Chess on 10 by 8 with a marshal (rook and knight) and a cardinal (bishop and knight).'],
  ['janus', 'Janus', 'big', 'Two januses each.',
    'Chess on 10 by 8 with two januses (bishop and knight) per side, next to the rooks.'],
  ['grand', 'Grand chess', 'big', 'Ten by ten with a marshal and a cardinal.',
    'Chess on a 10 by 10 board. The rooks start in the corners behind the other pieces, and each side has a marshal (rook and knight) and a cardinal (bishop and knight). Pawns promote on the last three ranks, only to a piece you have lost. No castling.'],
  ['shako', 'Shako', 'big', 'Cannons and elephants on 10 by 10.',
    'Chess on 10 by 10 with two cannons (move like a rook, capture by jumping over one piece) and two elephants (one or two squares diagonally, jumping) per side.'],
  ['modern', 'Modern chess', 'big', 'Nine files and a minister.',
    'Chess on 9 by 9 with a minister that moves like a bishop or a knight.'],
  ['chancellor', 'Chancellor chess', 'big', 'Nine by nine with a chancellor.',
    'Chess on 9 by 9 with a chancellor (rook and knight) next to the king.'],
  ['centaur', 'Centaur', 'big', 'Ten files and two centaurs.',
    'Chess on 10 by 8 with two centaurs per side, moving like a king or a knight.'],
  ['courier', 'Courier chess', 'big', 'A medieval game on twelve files.',
    'A medieval German game on 12 by 8. Besides the modern pieces there are the courier (our bishop), the mann (one step any way), the schleich (one step straight), the alfil (jumps two diagonally) and the fers (one step diagonally). Pawns promote to a fers.'],

  ['xiangqi', 'Xiangqi', 'east', 'Chinese chess.',
    'Pieces stand on the points. The general and advisors stay in the palace; the generals may not face each other on an open file. Elephants cannot cross the river, horses can be blocked, and the cannon captures by jumping over exactly one piece. Soldiers move sideways too after crossing the river. Checkmate or stalemate the enemy general to win.'],
  ['manchu', 'Manchu', 'east', 'Xiangqi against a single banner.',
    'Xiangqi, but Red has only one super-piece, the banner, which moves like a chariot, a cannon or a horse, in place of the chariots, horses and cannons.'],
  ['janggi', 'Janggi', 'east', 'Korean chess.',
    'Korean chess on the points of a 9 by 10 board. No river: elephants move one straight and two diagonally, cannons must jump over a piece to move and cannot jump or take other cannons. Pieces in the palace may move along its diagonals.'],
  ['shogi', 'Shogi', 'east', 'Japanese chess with drops.',
    'Japanese chess on 9 by 9. Captured pieces change sides and can be dropped back. Most pieces may promote when they move into, out of or within the last three ranks. A pawn may not be dropped to give mate, or on a file with another of your pawns.'],
  ['minixiangqi', 'Mini Xiangqi', 'east', 'Xiangqi on a 7 by 7 board.',
    'Xiangqi on 7 by 7 without elephants, advisors or a river: soldiers move sideways from the start.'],
  ['minishogi', 'Minishogi', 'east', 'Shogi on 5 by 5.',
    'Shogi on 5 by 5 with one of each piece and one pawn; promotion on the last rank.'],
  ['kyotoshogi', 'Kyoto Shogi', 'east', 'Every piece flips after each move.',
    'Shogi on 5 by 5 where every piece turns into its other side after each move it makes (pawn and rook, silver and bishop, and so on). Dropped pieces may enter on either side.'],
  ['dobutsu', 'Dobutsu Shogi', 'east', 'Animal shogi for children.',
    'On a 3 by 4 board: the lion (king), giraffe (one step straight), elephant (one step diagonally) and chick, which becomes a hen on the far side. Captured animals can be dropped. Catch the lion, or walk your lion to the far side safely.', 'the lion is home'],

  ['shatranj', 'Shatranj', 'old', 'The medieval game.',
    'The Persian ancestor of chess. The fers moves one square diagonally, the alfil jumps two squares diagonally, pawns move one square and promote to a fers. You also win by stalemate or by capturing everything but the king.', 'bare king'],
  ['chaturanga', 'Chaturanga', 'old', 'The Indian ancestor of chess.',
    'The oldest form of chess: the mantri moves one square diagonally, the gaja jumps two squares diagonally, pawns move one square and promote to a mantri.'],
  ['makruk', 'Makruk', 'old', 'Thai chess.',
    'Thai chess. The met moves one square diagonally, the khon one square diagonally or straight forward, and pawns start on the third rank and promote to a met on the sixth. When one side has only a few pieces, a counting rule ends the game in a draw.'],
  ['cambodian', 'Ouk Chatrang', 'old', 'Cambodian chess.',
    'Makruk with a few extra first moves: the king may jump like a knight once, and the met may jump two squares forward once.'],
  ['sittuyin', 'Sittuyin', 'old', 'Burmese chess.',
    'Burmese chess. The players first place their pieces behind their pawns, then play. The sit-ke moves one square diagonally and the elephant one square diagonally or forward. A pawn promotes on the main diagonal.'],

  ['losalamos', 'Los Alamos', 'small', 'The first computer chess, 6 by 6.',
    'Chess on 6 by 6 without bishops, as played by the MANIAC computer in 1956. No castling, no double pawn step.'],
  ['gardner', 'Gardner', 'small', 'Minichess on 5 by 5.',
    'Normal chess on a 5 by 5 board with one of each piece.'],
  ['judkins', 'Judkins Shogi', 'small', 'Shogi on 6 by 6.',
    'Shogi on a 6 by 6 board with a knight added.'],
  ['gorogoro', 'Goro Goro Shogi', 'small', 'Shogi on 5 by 6.',
    'A small shogi on 5 by 6 with only kings, golds, silvers and pawns, and drops.'],
  ['jesonmor', 'Jeson Mor', 'small', 'Nine knights race for the centre.',
    'A Mongolian game: each side has nine knights on a 9 by 9 board. Move a knight onto the centre square and away from it again to win, or capture all the enemy knights.', 'left the centre'],
  ['ataxx', 'Ataxx', 'small', 'Clone and jump, flip the neighbours.',
    'Not quite chess: move a stone one step to clone it, or two steps to jump. Every enemy stone next to where it lands turns yours. The player with more stones when the board is full wins.', 'board full'],
];

export const VARIANTS = LIST.map(([id, name, group, blurb, rules, win, engine]) => ({id, name, group, blurb, rules, win: win || '', engine: engine !== false}));
export const byId = id => VARIANTS.find(v => v.id === id);

/* ---------- pieces ---------- */
/* how a piece kind is drawn:
   set: one of the piece set's images (P N B R Q K), optional mod: 'small' (a lesser piece: fers, alfil, mann...),
        'inv' (upside down, the problemists' sign for a new mover), split: a second image for the right half (compound
        pieces), crown: a small king over it (royal)
   cjk: a token with a character (xiangqi, janggi, shogi); animal: a picture (dobutsu); stone: a plain stone */
export const KINDS = {
  pawn: {set: 'P'}, knight: {set: 'N'}, bishop: {set: 'B'}, rook: {set: 'R'}, queen: {set: 'Q'}, king: {set: 'K'},
  archbishop: {set: 'B', split: 'N', name: 'archbishop (bishop and knight)'},
  chancellor: {set: 'R', split: 'N', name: 'chancellor (rook and knight)'},
  amazon: {set: 'Q', split: 'N', name: 'amazon (queen and knight)'},
  centaur: {set: 'K', split: 'N', name: 'centaur (king and knight)'},
  grasshopper: {set: 'Q', mod: 'inv', name: 'grasshopper'},
  nightrider: {set: 'N', mod: 'inv', name: 'nightrider'},
  cannon: {set: 'R', mod: 'inv', name: 'cannon'},
  elephant: {set: 'B', mod: 'inv', name: 'elephant'},
  ferz: {set: 'Q', mod: 'small', name: 'fers'},
  alfil: {set: 'B', mod: 'small', name: 'alfil'},
  khon: {set: 'B', mod: 'small', name: 'khon'},
  wazir: {set: 'R', mod: 'small', name: 'schleich'},
  mann: {set: 'K', mod: 'small', name: 'mann'},
  royalknight: {set: 'N', crown: true, name: 'royal knight'},
  stone: {stone: true, name: 'stone'},
};
/* xiangqi and janggi: [first player (red / Cho), second player] */
const XQ = {k: ['帥', '將'], a: ['仕', '士'], b: ['相', '象'], n: ['傌', '馬'], r: ['俥', '車'], c: ['炮', '砲'], p: ['兵', '卒'], m: ['旗', '旗']};
const JG = {k: ['楚', '漢'], a: ['士', '士'], b: ['象', '象'], n: ['馬', '馬'], r: ['車', '車'], c: ['包', '包'], p: ['卒', '兵']};
/* shogi: plain and promoted; the first player's king is 王, the second's 玉 */
const SG = {p: '歩', l: '香', n: '桂', s: '銀', g: '金', b: '角', r: '飛', k: ['王', '玉'], '+p': 'と', '+l': '杏', '+n': '圭', '+s': '全', '+b': '馬', '+r': '龍'};
const DOBUTSU = {c: 'chick', '+c': 'hen', e: 'elephant', g: 'giraffe', l: 'lion'};

const OVERRIDE = {
  capablanca: {a: 'archbishop', c: 'chancellor'}, capahouse: {a: 'archbishop', c: 'chancellor'}, gothic: {a: 'archbishop', c: 'chancellor'},
  embassy: {a: 'archbishop', c: 'chancellor'}, grand: {a: 'archbishop', c: 'chancellor'}, janus: {j: 'archbishop'}, modern: {m: 'archbishop'},
  chancellor: {c: 'chancellor'}, centaur: {c: 'centaur'}, seirawan: {h: 'archbishop', e: 'chancellor'}, shouse: {h: 'archbishop', e: 'chancellor'},
  almost: {c: 'chancellor'}, chigorin: {c: 'chancellor'}, amazon: {a: 'amazon'}, grasshopper: {g: 'grasshopper'}, nightrider: {n: 'nightrider'},
  knightmate: {k: 'royalknight', m: 'mann'}, shatranj: {q: 'ferz', b: 'alfil'}, chaturanga: {q: 'ferz', b: 'alfil'},
  makruk: {m: 'ferz', s: 'khon'}, cambodian: {m: 'ferz', s: 'khon'}, sittuyin: {f: 'ferz', s: 'khon'},
  courier: {e: 'alfil', m: 'mann', w: 'wazir', f: 'ferz'}, shako: {c: 'cannon', e: 'elephant'}, ataxx: {p: 'stone'},
};
const DEFAULT = {p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'};
const XQ_FAMILY = new Set(['xiangqi', 'manchu', 'minixiangqi']), SHOGI_FAMILY = new Set(['shogi', 'minishogi', 'kyotoshogi', 'judkins', 'gorogoro']);
/* the board's look: squares in two colours, plain squares with lines (shogi, makruk), or points (xiangqi, janggi) */
export function boardStyle(id) {
  if (XQ_FAMILY.has(id)) return 'points';
  if (id === 'janggi') return 'points';
  if (SHOGI_FAMILY.has(id) || id === 'dobutsu') return 'shogi';
  if (['makruk', 'cambodian', 'sittuyin'].includes(id)) return 'plain';
  return 'checker';
}
/* the drawing for a piece letter of a side (0 first player, 1 second) in a variant; `promo` is the shogi '+' */
export function pieceLook(id, letter, side, promo) {
  const l = letter.toLowerCase();
  if (XQ_FAMILY.has(id)) return {cjk: (XQ[l] || ['?', '?'])[side], tone: side ? 'ink' : 'red', name: XQ_NAME[l]};
  if (id === 'janggi') return {cjk: (JG[l] || ['?', '?'])[side], tone: side ? 'red' : 'blue', name: XQ_NAME[l], size: l === 'k' ? 1 : l === 'p' ? .78 : .88};
  if (id === 'dobutsu') return {animal: DOBUTSU[(promo ? '+' : '') + l] || 'chick', name: DOBUTSU[(promo ? '+' : '') + l]};
  if (SHOGI_FAMILY.has(id)) {
    const key = (promo ? '+' : '') + l, ch = SG[key];
    return {cjk: Array.isArray(ch) ? ch[side] : ch || l.toUpperCase(), tone: promo ? 'red' : 'ink', shogi: true, name: SG_NAME[key] || key};
  }
  const kind = (OVERRIDE[id] && OVERRIDE[id][l]) || DEFAULT[l] || 'pawn';
  return {...KINDS[kind], kind, name: KINDS[kind].name || kind};
}
const XQ_NAME = {k: 'general', a: 'advisor', b: 'elephant', n: 'horse', r: 'chariot', c: 'cannon', p: 'soldier', m: 'banner'};
const SG_NAME = {p: 'pawn', l: 'lance', n: 'knight', s: 'silver', g: 'gold', b: 'bishop', r: 'rook', k: 'king', '+p': 'tokin', '+l': 'promoted lance', '+n': 'promoted knight', '+s': 'promoted silver', '+b': 'horse', '+r': 'dragon'};
/* the piece names a variant uses beyond the usual six, for the rules card and AI models: "a = archbishop (bishop and knight)" */
export function pieceNotes(id, fen) {
  const letters = [...new Set(fen.split(' ')[0].replace(/[^A-Za-z]/g, '').toLowerCase())];
  const out = [];
  for (const l of letters) {
    const look = pieceLook(id, l, 0, false);
    if (DEFAULT[l] && look.kind === DEFAULT[l]) continue;
    out.push(`${l.toUpperCase()} = ${look.name}`);
  }
  return out;
}

/* ---------- FEN and squares ---------- */
/* files a..l, ranks 1..n (two-digit ranks on 10-rank boards: a10) */
export const sqName = (f, r) => String.fromCharCode(97 + f) + (r + 1);
export function sqParse(s) { const m = /^([a-l])(\d{1,2})$/.exec(s); return m ? {f: m[1].charCodeAt(0) - 97, r: +m[2] - 1} : null; }
/* the board part of a Fairy-Stockfish FEN: cells[r][f] = {l (letter as written), side, promo} or null; '*' is the
   duck (a wall); pockets in [..] after the board or in a ninth "rank" */
export function parseFen(fen) {
  const [board, turn] = fen.split(' ');
  let main = board, pocket = '';
  const m = /^(.*?)\[(.*)\]$/.exec(board);
  if (m) { main = m[1]; pocket = m[2]; }
  const rows = main.split('/');
  const cells = [];
  let files = 0;
  for (const row of rows) {
    const line = [];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (/\d/.test(ch)) { let n = ch; while (/\d/.test(row[i + 1] || '')) n += row[++i]; for (let k = 0; k < +n; k++) line.push(null); continue; }
      if (ch === '+') { const l = row[++i]; line.push({l, side: l === l.toUpperCase() ? 0 : 1, promo: true}); continue; }
      if (ch === '~') { if (line.length && line[line.length - 1]) line[line.length - 1].tilde = true; continue; }   /* crazyhouse: a promoted pawn */
      if (ch === '*') { line.push({l: '*', side: -1, wall: true}); continue; }
      line.push({l: ch, side: ch === ch.toUpperCase() ? 0 : 1, promo: false});
    }
    files = Math.max(files, line.length);
    cells.push(line);
  }
  cells.reverse();   /* cells[0] is rank 1 */
  const pockets = [[], []];
  for (const ch of pocket.replace(/-/g, '')) pockets[ch === ch.toUpperCase() ? 0 : 1].push(ch.toUpperCase());
  return {files, ranks: cells.length, cells, pockets, hasPocket: !!m, turn: turn === 'b' ? 1 : 0};
}
/* a legal move string from the rules library, split: from (a square, or "P@" for a drop), to, extra (promotion
   letter, "+", a gated piece) and wall (the duck's square after a comma) */
export function splitMove(u) {
  const [main, wallPart] = u.split(',');
  const m = /^(\+?[A-Za-z]@|[a-l]\d{1,2})([a-l]\d{1,2})(.*)$/.exec(main);
  if (!m) return null;
  const wall = wallPart ? wallPart.slice(-(/\d\d$/.test(wallPart) ? 3 : 2)) : '';
  return {from: m[1], to: m[2], extra: m[3] || '', wall, drop: m[1].includes('@') ? m[1].slice(0, -1).toUpperCase() : ''};
}

/* ---------- ratings ---------- */
export const VSTART = 1200;
/* your rating in one variant after a game; provisional (bigger steps) for the first 20 games */
export function vrate(cur, opp, score) {
  const r = cur || {r: VSTART, n: 0, w: 0, d: 0, l: 0, best: VSTART};
  const expect = 1 / (1 + Math.pow(10, (opp - r.r) / 400)), k = r.n < 20 ? 40 : 20, delta = Math.round(k * (score - expect));
  const nr = Math.max(100, r.r + delta);
  return {next: {r: nr, n: r.n + 1, w: r.w + (score === 1), d: r.d + (score === .5), l: r.l + (score === 0), best: Math.max(r.best || nr, nr)}, delta};
}
/* what the two sides are called: Red and Black in xiangqi, Blue and Red in janggi, Sente and Gote in shogi */
export function sides(id) {
  if (XQ_FAMILY.has(id)) return ['Red', 'Black'];
  if (id === 'janggi') return ['Blue', 'Red'];
  if (SHOGI_FAMILY.has(id) || id === 'dobutsu') return ['Sente', 'Gote'];
  return ['White', 'Black'];
}
