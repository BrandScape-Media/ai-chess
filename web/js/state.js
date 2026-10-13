/* game state shared by the modules. GPL-3.0-or-later */
import * as C from './core.js';
import {BOTS} from './historic.js';

export const SIDE = ['White', 'Black'];
export const VARIANT_NAME = ['Standard', 'King of the Hill', 'Three-check'];
export const VARIANT_UCI = ['chess', 'kingofthehill', '3check'];

export const S = {
  seats: [null, null], variant: 0, c960: false, startFen: C.START_FEN, startName: '', startPly: 0, chaos: false,
  flipped: false, pos: null, moves: [], sans: [], lastMove: 0, over: null, gameId: 0,
  viewPly: null, sel: -1, selFree: false, targets: new Map(), tgtHide: new Set(), thinking: false, info: '', say: '', sayBy: -1,
  eng: null, llmCtl: null, llmT0: 0, lastOn: new Map(), arrows: [], circles: [], paused: false, peek: false, inactive: false,
  premove: null, preSel: -1,
  config: {agent: null},
};

/* callbacks filled in by app.js, so the other modules can drive the game without import cycles */
export const hooks = {play: null, render: null, afterMove: null, schedule: null};

export const isAI = P => P && (P.type === 'engine' || P.type === 'llm');
export const humanCount = () => S.seats.filter(P => P && P.type === 'human').length;
/* a side really plays without rules only when chaos mode is on and that side's switch is on */
export const rulesOff = P => !!(S.chaos && P && P.free);
export const sqOf = s => (typeof s === 'string' && /^[a-h][1-8]$/.test(s)) ? C.nameSq(s) : -1;

export function shortModel(P) { return (P.model || 'model').replace(/\.gguf$/i, '').replace(/^.*\//, '').slice(0, 28); }
export function engineName(P) {
  if (!P.engine || P.engine === 'builtin') return 'Engine · ' + C.LEVELS[P.level ?? 3].name;
  if (BOTS[P.engine]) return BOTS[P.engine].name;
  const e = S.engineList?.find(x => x.id === P.engine);
  if (e?.kind === 'maia') return 'Maia ' + (P.maia || 1500);
  const n = (e?.name || P.engine).replace(/\s+(dev|v?\d[\w.\-]*)$/i, '');
  return n;
}
export function seatName(i) {
  const P = S.seats[i]; if (!P) return SIDE[i];
  switch (P.type) {
    case 'human': return humanCount() === 2 ? SIDE[i] : 'You';
    case 'engine': return engineName(P);
    case 'agent': return S.config.agent || 'Agent';
    default: return shortModel(P);
  }
}
export function ascii(p) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    s += (r + 1) + ' ';
    for (let f = 0; f < 8; f++) { const q = p.b[r * 16 + f]; s += q ? ((q >> 3) ? C.PCH[(q & 7) - 1].toLowerCase() : C.PCH[(q & 7) - 1]) : '.'; s += f < 7 ? ' ' : ''; }
    s += '\n';
  }
  return s + '  a b c d e f g h';
}
/* "1. e4 e5 2. Nf3" (our ?! marks on unchecked moves are not shown to players) */
export function histText(sans, from = 0) {
  const out = [];
  for (let i = from; i < sans.length; i++) {
    const g = S.startPly + i, s = sans[i].replace(/\?!$/, '');
    if (g % 2 === 0) out.push((g / 2 + 1) + '. ' + s); else if (i === from) out.push(((g - 1) / 2 + 1) + '... ' + s); else out.push(s);
  }
  return out.join(' ');
}
/* remember which piece last stood on each square: a player that "forgets" a capture moves the dead piece, and it comes back */
export function remember(pos) { for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (pos.b[s]) S.lastOn.set(s, pos.b[s]); } }
