/* board themes and piece sets. GPL-3.0-or-later
   Piece artwork: see web/pieces/LICENSES.md (all GPL-compatible sets from the lichess project). */
const GLYPH = ['', '♟︎', '♞︎', '♝︎', '♜︎', '♛︎', '♚︎'];
const LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];

const wood = (a, b, c) => `repeating-linear-gradient(97deg,${a} 0 3px,${b} 3px 7px,${c} 7px 9px,${a} 9px 13px)`;
const marble = (a, b) => `radial-gradient(circle at 30% 20%,${b} 0 18%,transparent 40%),radial-gradient(circle at 75% 70%,${b} 0 12%,transparent 35%),${a}`;
export const BOARD_THEMES = {
  brown: {name: 'Brown', light: '#f0d9b5', dark: '#b58863'},
  green: {name: 'Green', light: '#eeeed2', dark: '#769656'},
  blue: {name: 'Blue', light: '#dee3e6', dark: '#8ca2ad'},
  ice: {name: 'Ice', light: '#e6eef5', dark: '#7f9cbf'},
  purple: {name: 'Purple', light: '#e9e1f0', dark: '#8f75b0'},
  coral: {name: 'Coral', light: '#f4e3d7', dark: '#cc7a6a'},
  grey: {name: 'Grey', light: '#dadada', dark: '#8e8e8e'},
  sand: {name: 'Sand', light: '#ecd8b4', dark: '#b3855c'},
  night: {name: 'Night', light: '#8a909c', dark: '#4b515d', coordl: '#2b2f36', coordd: '#c9ced8'},
  wood: {name: 'Wood', light: '#e8c99b', dark: '#a8713e', lightbg: wood('#e8c99b', '#e2c191', '#edd1a6'), darkbg: wood('#a8713e', '#9d6835', '#b07a47')},
  marble: {name: 'Marble', light: '#e7e5df', dark: '#7f8c8a', lightbg: marble('#e7e5df', '#f4f3ef'), darkbg: marble('#7f8c8a', '#93a09e')},
  custom: {name: 'Custom'},
};

export const PIECE_SETS = [
  {id: 'cburnett', name: 'Classic', by: 'Colin M.L. Burnett', lic: 'GPLv2+'},
  {id: 'merida', name: 'Merida', by: 'Armando Hernandez Marroquin', lic: 'GPLv2+'},
  {id: 'chessnut', name: 'Chessnut', by: 'Alexis Luengas', lic: 'Apache-2.0'},
  {id: 'mpchess', name: 'MPChess', by: 'Maxime Chupin', lic: 'GPLv3+'},
  {id: 'fantasy', name: 'Fantasy', by: 'Maurizio Monge', lic: 'MIT'},
  {id: 'spatial', name: 'Spatial', by: 'Maurizio Monge', lic: 'MIT'},
  {id: 'celtic', name: 'Celtic', by: 'Maurizio Monge', lic: 'MIT'},
  {id: 'kiwen-suwi', name: 'Kiwen-suwi', by: 'neverRare', lic: 'CC BY 4.0'},
  {id: 'totoy', name: 'Totoy', by: 'Kosal Sen', lic: 'CC BY 4.0'},
  {id: 'papercut', name: 'Papercut', by: 'Nikolay Anzarov', lic: 'CC BY 4.0'},
  {id: 'rhosgfx', name: 'RhosGFX', by: 'RhosGFX', lic: 'CC0'},
  {id: 'shapes', name: 'Shapes', by: 'flugsio', lic: 'CC BY-SA 4.0'},
  {id: 'glyph', name: 'Unicode', by: 'your system font'},
  {id: 'letters', name: 'Letters', by: 'plain text'},
  {id: 'blindfold', name: 'Blindfold', by: 'invisible pieces'},
  {id: 'custom', name: 'Your own', by: 'upload in Appearance'},
];

export const code = p => ((p >> 3) ? 'b' : 'w') + LETTER[p & 7];
let current = {pieces: 'cburnett'};
let custom = {};

export function applyAppearance(a) {
  current = a;
  custom = a.customPieces || {};
  const t = a.board === 'custom' ? {light: a.custom?.[0] || '#f0d9b5', dark: a.custom?.[1] || '#b58863'} : (BOARD_THEMES[a.board] || BOARD_THEMES.brown);
  const r = document.documentElement.style;
  r.setProperty('--light', t.light); r.setProperty('--dark', t.dark);
  r.setProperty('--lightbg', t.lightbg || t.light); r.setProperty('--darkbg', t.darkbg || t.dark);
  r.setProperty('--coordl', t.coordl || t.dark); r.setProperty('--coordd', t.coordd || t.light);
  r.setProperty('--lastmove', a.lastmove || '#f2e24a66');
  r.setProperty('--animms', (a.animate === false ? 0 : (a.animMs || 180)) + 'ms');
  document.body.classList.toggle('nocoords', a.coords === false);
  document.body.classList.toggle('nodots', a.dots === false);
  document.body.classList.toggle('blindfold', a.pieces === 'blindfold');
  let css = '';
  const set = a.pieces;
  if (isImageSet(set)) {
    for (const c of ['w', 'b']) for (const l of LETTER.slice(1)) {
      const url = set === 'custom' ? custom[c + l] : `pieces/${set}/${c}${l}.svg`;
      if (url) css += `.pc.${c}${l},.ghost.${c}${l},.caps i.${c}${l},.fig.${c}${l}{background-image:url("${url}")}\n`;
    }
  }
  document.getElementById('pieceCss').textContent = css;
}
export const isImageSet = s => s !== 'glyph' && s !== 'letters' && s !== 'blindfold' && (s !== 'custom' || Object.keys(custom).length === 12);

/* fill a piece element (board square, drag ghost, promotion button, captured strip) */
export function setPiece(el, p, base = 'pc') {
  const c = code(p);
  if (isImageSet(current.pieces)) { el.className = `${base} img ${c}`; el.textContent = ''; }
  else if (current.pieces === 'letters') { el.className = `${base} glyph ${c[0]}`; el.textContent = c[0] === 'w' ? LETTER[p & 7] : LETTER[p & 7].toLowerCase(); el.style.fontWeight = '700'; }
  else { el.className = `${base} glyph ${c[0]}`; el.textContent = GLYPH[p & 7]; }
  return el;
}
export const glyph = p => GLYPH[p & 7];

/* images for the board picture sent to vision models: always the clear Classic set */
const canvasImgs = {};
export function preloadCanvasPieces() {
  for (const c of ['w', 'b']) for (const l of LETTER.slice(1)) {
    const im = new Image(); im.src = `pieces/cburnett/${c}${l}.svg`; canvasImgs[c + l] = im;
  }
}
export const canvasPiece = p => { const im = canvasImgs[code(p)]; return im && im.complete && im.naturalWidth ? im : null; };
