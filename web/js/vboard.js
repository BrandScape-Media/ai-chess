/* the variant board: any size from 3 by 4 to 12 by 10, pockets and drops, promotion and gating choices, the duck,
   xiangqi points and shogi tokens. Moves are the rules library's strings; the board only offers legal ones.
   GPL-3.0-or-later */
import {parseFen, splitMove, sqName, sqParse, pieceLook, boardStyle} from './variant-catalog.js';
import {pieceImg} from './theme.js';
import {el} from './util.js';

/* ---------- pieces ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function token(look, side) {
  /* xiangqi / janggi discs and shogi pentagons, drawn here so they stay sharp at any size */
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 100 100');
  const ink = look.tone === 'red' ? '#a8322a' : look.tone === 'blue' ? '#285a86' : '#221f1c';
  if (look.shogi) {
    s.innerHTML = `<polygon points="50,6 80,18 90,94 10,94 20,18" fill="#e7d2a3" stroke="#7d6235" stroke-width="3.5" stroke-linejoin="round"/>`
      + `<polygon points="50,12 75,22 83,88 17,88 25,22" fill="none" stroke="#fff6" stroke-width="2"/>`
      + `<text x="50" y="64" text-anchor="middle" dominant-baseline="middle" font-size="44" fill="${ink}">${look.cjk}</text>`;
  } else {
    s.innerHTML = `<circle cx="50" cy="50" r="45" fill="#ece2cd" stroke="#6e5a3e" stroke-width="3"/>`
      + `<circle cx="50" cy="50" r="36" fill="none" stroke="${ink}" stroke-width="3"/>`
      + `<text x="50" y="53" text-anchor="middle" dominant-baseline="middle" font-size="42" fill="${ink}">${look.cjk}</text>`;
  }
  return s;
}
/* a piece element for a letter (as written in the FEN) of a side in a variant */
export function pieceEl(vid, l, side, promo, cls = 'vp') {
  const look = pieceLook(vid, l, side, promo), c = side ? 'b' : 'w';
  const e = el('div', {class: cls, title: look.name || ''});
  if (look.cjk) { e.classList.add('tok'); if (side) e.classList.add('rot'); if (look.size) e.style.setProperty('--tk', look.size); e.append(token(look, side)); }
  else if (look.animal) { e.classList.add('ani', side ? 'rot' : 'up'); e.append(el('img', {src: `avatars/dob-${look.animal}.webp`, alt: '', draggable: 'false'})); }
  else if (look.stone) e.classList.add('stone', c);
  else {
    e.append(el('img', {class: 'main' + (look.mod ? ' ' + look.mod : ''), src: pieceImg(c, look.set), alt: '', draggable: 'false'}));
    if (look.split) e.append(el('img', {class: 'badge', src: pieceImg(c, look.split), alt: '', draggable: 'false'}));
    if (look.crown) e.append(el('img', {class: 'badge crown', src: pieceImg(c, 'K'), alt: '', draggable: 'false'}));
  }
  return e;
}

/* ---------- the board ---------- */
export class VBoard {
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.st = null; this.sel = null; this.pending = null; this.drag = null;
    root.classList.add('vb');
    root.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    root.addEventListener('contextmenu', e => { e.preventDefault(); this.clear(); this.render(); });
  }
  /* state: {vid, fen, legal: [...], flipped, last: {from, to}, check: [squares], mine: side that may move or -1, anim} */
  set(st) {
    const keep = this.st && st.fen === this.st.fen && st.mine === this.st.mine;
    this.st = st;
    if (!keep) this.clear();
    this.render();
  }
  clear() { this.sel = null; this.pending = null; }
  moves() { return (this.st.legal || []).map(u => ({u, ...splitMove(u)})).filter(m => m.from); }
  /* ---- drawing ---- */
  render() {
    const st = this.st, root = this.root;
    if (!st) return;
    const P = parseFen(st.fen), style = boardStyle(st.vid);
    if (this.pending && this.pending.wall) {   /* the duck is next: show the move already made */
      const a = sqParse(this.pending.from), b = sqParse(this.pending.to);
      if (a && b) { P.cells[b.r][b.f] = P.cells[a.r][a.f]; P.cells[a.r][a.f] = null; }
    }
    this.P = P;
    root.innerHTML = '';
    root.dataset.style = style;
    root.style.setProperty('--vf', P.files); root.style.setProperty('--vr', P.ranks);
    root.classList.toggle('flip', !!st.flipped);
    const ms = this.moves(), targets = new Map();
    if (this.pending && this.pending.wall) for (const m of this.pending.cands) targets.set(m.wall, 'wall');
    else if (this.sel) for (const m of ms) if (m.from === this.sel) targets.set(m.to, 'to');
    const last = st.last || {}, chk = new Set(st.check || []);
    if (style !== 'checker') root.append(this.lines(P, style));
    for (let i = 0; i < P.ranks; i++) for (let j = 0; j < P.files; j++) {
      const r = st.flipped ? i : P.ranks - 1 - i, f = st.flipped ? P.files - 1 - j : j, name = sqName(f, r), cell = P.cells[r][f];
      const sq = el('div', {class: 'vsq' + ((r + f) & 1 ? ' l' : ' d') + (name === last.from || name === last.to ? ' last' : '') + (name === this.sel ? ' sel' : '')
        + (chk.has(name) ? ' chk' : '') + (targets.has(name) ? ' tgt' + (cell && !cell.wall ? ' cap' : '') + (targets.get(name) === 'wall' ? ' wallt' : '') : '')});
      sq.dataset.sq = name;
      if (j === 0 && style === 'checker') sq.append(el('span', {class: 'co r'}, String(r + 1)));
      if (i === P.ranks - 1 && style === 'checker') sq.append(el('span', {class: 'co f'}, String.fromCharCode(97 + f)));
      if (cell) {
        const pe = cell.wall ? el('div', {class: 'vp duck', title: 'the duck', html: DUCK}) : pieceEl(st.vid, cell.l, cell.side, cell.promo);
        if (cell.tilde) pe.classList.add('was-pawn');
        pe.dataset.sq = name;
        sq.append(pe);
      }
      root.append(sq);
    }
    if (st.anim && st.anim.to) this.animate(st.anim);
    st.anim = null;
    if (this.pending && !this.pending.wall) root.append(this.chooser());
    this.opts.onRender && this.opts.onRender(P);
  }
  /* grid lines for points (xiangqi, janggi: river and palaces) and plain boards (shogi, makruk) */
  lines(P, style) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'vlines'); s.setAttribute('viewBox', `0 0 ${P.files * 10} ${P.ranks * 10}`); s.setAttribute('preserveAspectRatio', 'none');
    let d = '';
    if (style === 'points') {
      const x = f => f * 10 + 5, y = r => (P.ranks - 1 - r) * 10 + 5, river = this.st.vid !== 'janggi' && P.ranks === 10;
      for (let r = 0; r < P.ranks; r++) d += `M${x(0)} ${y(r)}H${x(P.files - 1)}`;
      for (let f = 0; f < P.files; f++) {
        if (river && f > 0 && f < P.files - 1) d += `M${x(f)} ${y(0)}V${y(4)}M${x(f)} ${y(5)}V${y(P.ranks - 1)}`;
        else d += `M${x(f)} ${y(0)}V${y(P.ranks - 1)}`;
      }
      /* palaces: the three middle files, three ranks at each end */
      const m = (P.files - 1) / 2;
      for (const [a, b] of [[0, 2], [P.ranks - 3, P.ranks - 1]]) d += `M${x(m - 1)} ${y(a)}L${x(m + 1)} ${y(b)}M${x(m + 1)} ${y(a)}L${x(m - 1)} ${y(b)}`;
      s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width=".55" vector-effect="non-scaling-stroke"/>`
        + `<rect x="${x(0)}" y="${y(P.ranks - 1)}" width="${x(P.files - 1) - x(0)}" height="${y(0) - y(P.ranks - 1)}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
    } else {
      for (let r = 0; r <= P.ranks; r++) d += `M0 ${r * 10}H${P.files * 10}`;
      for (let f = 0; f <= P.files; f++) d += `M${f * 10} 0V${P.ranks * 10}`;
      let dots = '';
      if (style === 'shogi' && P.files === 9) for (const a of [3, 6]) for (const b of [3, 6]) dots += `<circle cx="${a * 10}" cy="${b * 10}" r=".9" fill="currentColor"/>`;
      s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width=".6" vector-effect="non-scaling-stroke"/>${dots}`;
    }
    return s;
  }
  animate(a) {
    if (!a.from || a.from.includes('@')) return;
    const to = this.root.querySelector(`.vsq[data-sq="${a.to}"] .vp`), fromSq = this.root.querySelector(`.vsq[data-sq="${a.from}"]`), toSq = this.root.querySelector(`.vsq[data-sq="${a.to}"]`);
    if (!to || !fromSq || !toSq) return;
    const fr = fromSq.getBoundingClientRect(), tr = toSq.getBoundingClientRect();
    to.style.transition = 'none';
    to.style.transform = `translate(${fr.left - tr.left}px, ${fr.top - tr.top}px)`;
    to.getBoundingClientRect();
    to.style.transition = '';
    to.style.transform = '';
  }
  /* promotion, gating and "promote or not": the options for the chosen from and to squares */
  chooser() {
    const p = this.pending, side = this.st.mine, box = el('div', {class: 'vchoose'});
    const inner = el('div', {class: 'vcbox'}, el('b', {}, p.title));
    const row = el('div', {class: 'vcrow'});
    for (const m of p.cands) {
      const x = m.extra;
      let face;
      if (!x) face = el('span', {class: 'vctxt'}, p.kind === 'gate' ? 'Nothing' : p.kind === 'promo+' ? 'Stay' : 'Move');
      else if (x === '+') face = el('span', {class: 'vctxt'}, 'Promote');
      else if (x === '-') face = el('span', {class: 'vctxt'}, 'Unpromote');
      else face = pieceEl(this.st.vid, side ? x.toLowerCase() : x.toUpperCase(), side, false, 'vp mini');
      row.append(el('button', {type: 'button', title: x ? (x === '+' ? 'Promote' : 'Choose') : 'No choice', onclick: e => { e.stopPropagation(); this.finish(m); }}, face));
    }
    inner.append(row, el('button', {type: 'button', class: 'vccancel', onclick: e => { e.stopPropagation(); this.clear(); this.render(); }}, 'Cancel'));
    box.append(inner);
    return box;
  }
  /* ---- input ---- */
  canMove() { return this.st && this.st.mine >= 0 && this.st.legal && this.st.legal.length; }
  pickFrom(from) {
    const ms = this.moves();
    if (!ms.some(m => m.from === from)) return false;
    this.sel = from; this.pending = null; this.render();
    return true;
  }
  pickTo(to) {
    if (!this.sel) return false;
    const cands = this.moves().filter(m => m.from === this.sel && m.to === to);
    if (!cands.length) return false;
    /* moves that differ only by the duck's square: the next click places the duck */
    const byExtra = new Map();
    for (const m of cands) { if (!byExtra.has(m.extra)) byExtra.set(m.extra, []); byExtra.get(m.extra).push(m); }
    if (byExtra.size === 1 && cands.length === 1) { this.finish(cands[0]); return true; }
    if (byExtra.size === 1 && cands[0].wall) {
      this.pending = {wall: true, cands, from: this.sel, to};   /* the piece shows on its new square while you place the duck */
      this.render();
      return true;
    }
    const opts = [...byExtra.keys()].map(x => byExtra.get(x)[0]);
    const kind = opts.some(m => m.extra === '+') ? 'promo+' : opts.every(m => /^[a-z]?$/i.test(m.extra)) && opts.some(m => !m.extra) ? 'gate' : 'promo';
    this.pending = {cands: opts.sort((a, b) => (a.extra ? 1 : 0) - (b.extra ? 1 : 0)), kind, title: kind === 'gate' ? 'Bring in a piece?' : kind === 'promo+' ? 'Promote?' : 'Promote to'};
    this.render();
    return true;
  }
  pickWall(sq) {
    const m = this.pending.cands.find(c => c.wall === sq);
    if (!m) return false;
    this.finish(m);
    return true;
  }
  finish(m) {
    this.clear();
    this.opts.onMove && this.opts.onMove(m.u);
  }
  /* a pocket piece was clicked: drops come from "P@" */
  pickDrop(letter) {
    if (!this.canMove()) return;
    const from = letter + '@';
    if (this.sel === from) { this.clear(); this.render(); return; }
    this.pickFrom(from);
  }
  sqAt(e) { const t = document.elementFromPoint(e.clientX, e.clientY); const s = t && t.closest && t.closest('.vsq'); return s && this.root.contains(s) ? s.dataset.sq : null; }
  down(e) {
    if (e.button !== 0 || !this.canMove() || e.target.closest('.vchoose')) return;
    const sq = e.target.closest('.vsq');
    if (!sq) return;
    const name = sq.dataset.sq;
    if (this.pending && this.pending.wall) { if (!this.pickWall(name)) { this.clear(); this.render(); } return; }
    if (this.sel && this.pickTo(name)) return;
    if (this.pickFrom(name)) {
      const pe = sq.querySelector('.vp');
      if (pe) this.drag = {from: name, pe, x: e.clientX, y: e.clientY, moved: false};
      return;
    }
    this.clear(); this.render();
  }
  move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    if (!d.moved) {
      d.moved = true;
      const r = d.pe.getBoundingClientRect();
      d.ghost = d.pe.cloneNode(true); d.ghost.classList.add('vghost');
      d.ghost.style.width = r.width + 'px'; d.ghost.style.height = r.height + 'px';
      document.body.append(d.ghost);
      d.pe.style.opacity = '.25';
      d.w = r.width; d.h = r.height;
    }
    d.ghost.style.transform = `translate(${e.clientX - d.w / 2}px, ${e.clientY - d.h / 2}px)`;
  }
  up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.moved) return;
    d.ghost.remove();
    const to = this.sqAt(e);
    if (!to || to === d.from || !this.pickTo(to)) this.render();
  }
}
/* the duck: a plain shape, no emoji */
const DUCK = '<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="52" cy="66" rx="34" ry="22" fill="#e6c650" stroke="#6e5a1e" stroke-width="3"/>'
  + '<circle cx="36" cy="38" r="17" fill="#e6c650" stroke="#6e5a1e" stroke-width="3"/><path d="M20 38 L6 42 L20 46 Z" fill="#d9822b" stroke="#6e5a1e" stroke-width="2.5" stroke-linejoin="round"/>'
  + '<circle cx="34" cy="34" r="3" fill="#221f1c"/><path d="M58 60 q14 -4 22 6" fill="none" stroke="#6e5a1e" stroke-width="3" stroke-linecap="round"/></svg>';
