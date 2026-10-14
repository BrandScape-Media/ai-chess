/* the Compete tab: tournaments (with the background match runner) and the weekly league. GPL-3.0-or-later
   The logic lives in tourney-core.js and league-core.js; this file is the screens and the scheduler. */
import * as C from './core.js';
import {$, el, api, toast, relayOK} from './util.js';
import {S} from './state.js';
import {SET, saveSettings} from './settings.js';
import {ICONS, icon} from './icons.js';
import {setPiece} from './theme.js';
import * as T from './tourney-core.js';
import * as L from './league-core.js';
import {Lane} from './tourney-runner.js';
import {start as vStart, replay as vReplay, vstate, yourVRating, variantEngine} from './variants.js';
import {VARIANTS, GROUPS, byId as variantById, parseFen} from './variant-catalog.js';
import {pieceEl} from './vboard.js';
import {VBOT_LEVELS} from './vbot-core.js';

let app = null, list = [], loaded = false, tick = 0;
const view = {sec: 'tourneys', page: 'home', tid: null, fmt: null};
const lanes = [new Lane('t1'), new Lane('t2')];
const live = new Map();          /* game id -> {fen, last, plies, white, black} while a background game runs */
const saving = new Map();        /* tournament id -> timer */
let youReady = true, field = null;

const ART = {rr: 't-roundrobin', swiss: 't-swiss', ko: 't-knockout', arena: 't-arena', climb: 't-climb'};
const TCS = [['60+1', '1 | 1', 'Bullet'], ['180+2', '3 | 2', 'Blitz'], ['300+0', '5 min', 'Blitz'], ['600+0', '10 min', 'Rapid'], ['900+10', '15 | 10', 'Rapid']];
const COUNTS = {rr: [4, 6, 8], swiss: [6, 8, 12, 16], ko: [4, 8, 16], arena: [6, 8, 12], climb: [6, 8, 12]};
const tcOf = v => { const [b, i] = v.split('+').map(Number); return {base: b * 1000, inc: (i || 0) * 1000}; };
const tcLabel = c => !c ? 'no clock' : c.inc ? `${c.base / 60000} | ${c.inc / 1000}` : `${c.base / 60000} min`;

export function initCompete(api_) { app = api_; }

/* ================= data ================= */
async function load() {
  if (loaded || !relayOK) return;
  try { list = (await api('/api/tournaments', {})).tournaments || []; } catch (e) { list = []; }
  loaded = true;
  for (const t of list) heal(t);
  schedule();
}
const current = () => list.find(t => t.status === 'live') || null;
const byId = id => list.find(t => t.id === id) || null;
function save(t, now = false) {
  clearTimeout(saving.get(t.id));
  const go = () => { saving.delete(t.id); api('/api/tournaments', {save: t}).catch(() => {}); };
  if (now) go(); else saving.set(t.id, setTimeout(go, 800));
}
/* after a reload nothing is running: background games start again from the first move; your game waits for you,
   unless it is the one on the board right now */
function heal(t) {
  for (const g of t.games) {
    if (g.status !== 'playing') continue;
    const mine = g.w === T.YOU || g.b === T.YOU, onBoard = S.tourney && S.tourney.gid === g.id && !S.over;
    if (!mine || !onBoard) g.status = 'pending';
  }
}

/* ================= building a field ================= */
/* opponents around your rating from everything you have: built-in levels, Stockfish and other engines at a set Elo,
   Maia, the historic bots (if wanted), your AI model (if wanted). Several sources mix so the field has some variety. */
function candidates(historic) {
  const out = [], add = c => out.push(c);
  C.LEVELS.forEach((lv, i) => add({src: 'builtin', name: 'Built-in ' + lv.name, type: 'engine', engine: 'builtin', level: i, rating: app.BUILTIN_ELO[i]}));
  if (historic) { add({src: 'turochamp', name: 'Turochamp', type: 'engine', engine: 'turochamp', rating: 800}); add({src: 'random', name: 'Random mover', type: 'engine', engine: 'random', rating: 250}); }
  for (const e of S.engineList || []) {
    const short = e.name.split(/\s+/)[0];
    if (e.kind === 'elo' && e.elo) {
      const step = e.id === 'stockfish' ? 50 : 100;
      for (let r = Math.ceil(e.elo[0] / step) * step; r <= Math.min(e.elo[1], 3000); r += step) add({src: e.id, name: `${short} ${r}`, type: 'engine', engine: e.id, elo: r, rating: r});
    } else if (e.kind === 'maia') {
      for (const k of Object.keys(e.weights || {}).filter(x => /^\d+$/.test(x))) add({src: 'maia', name: 'Maia ' + k, type: 'engine', engine: e.id, maia: k, rating: +k});
    } else if (e.kind === 'nodes') {
      for (const n of [1, 10, 100]) { const P = app.rate({type: 'engine', engine: e.id, nodes: n}); add({src: e.id, name: `${short} ${n === 1 ? 'instinct' : n + ' nodes'}`, type: 'engine', engine: e.id, nodes: n, rating: P.rating}); }
    } else add({src: e.id, name: short, type: 'engine', engine: e.id, rating: app.rate({type: 'engine', engine: e.id}).rating});
  }
  return out;
}
function myRating(variant) { return variant ? yourVRating(variant) : SET.profile?.rating || 1200; }
function variantCandidates(vid) {
  const out = [];
  VBOT_LEVELS.forEach((lv, i) => out.push({src: 'vbot', name: 'Variant bot ' + lv.name, type: 'vbot', level: i, rating: lv.elo}));
  const e = variantById(vid).engine ? variantEngine(vid) : null;
  if (e && e.elo) for (let r = Math.ceil(e.elo[0] / 100) * 100; r <= Math.min(e.elo[1], 2800); r += 100) out.push({src: e.id + r % 300, name: `Fairy-Stockfish ${r}`, type: 'engine', engine: e.id, elo: r, rating: r});
  return out;
}
function llmSeat() {
  for (const i of [0, 1]) { const c = app.readSeat(i); if (c.type === 'llm' && c.model) return c; }
  return null;
}
export function buildField(o) {
  const vid = o.variant && o.variant !== 'chess' && variantById(o.variant) ? o.variant : null;
  const center = o.you ? myRating(vid) : 1500;
  const [lo, hi] = o.spread === 'wide' ? [center - 700, center + 700] : o.spread === 'strong' ? [center + 50, center + 700] : [center - 300, center + 300];
  const seats = [];
  if (o.you) seats.push({id: T.YOU, name: 'You', type: 'human', rating: myRating(vid)});
  const llm = o.llm ? llmSeat() : null;
  if (llm) seats.push({id: 'llm', name: llm.model.replace(/\.gguf$/i, '').replace(/^.*\//, '').slice(0, 24), type: 'llm', provider: llm.provider, model: llm.model, rating: 400 + Math.round(Math.random() * 110) * 10});
  const n = Math.max(0, o.count - seats.length), pool = vid ? variantCandidates(vid) : candidates(o.historic), used = new Set(), srcUse = {};
  for (let k = 0; k < n; k++) {
    const target = n === 1 ? center : lo + (hi - lo) * k / (n - 1);
    let best = null, bs = Infinity;
    for (const c of pool) {
      if (used.has(c.name)) continue;
      const s = Math.abs(c.rating - target) + (srcUse[c.src] || 0) * 110 + Math.random() * 30;
      if (s < bs) { bs = s; best = c; }
    }
    if (!best) break;
    used.add(best.name); srcUse[best.src] = (srcUse[best.src] || 0) + 1;
    seats.push({...best, id: 'p' + k + '-' + best.name.replace(/\W+/g, '').toLowerCase()});
  }
  return seats.sort((a, b) => b.rating - a.rating);
}

/* ================= the scheduler ================= */
/* once a second: arena pairings, the end of an arena, background games into free lanes, your game's notice */
function schedule() {
  clearInterval(tick);
  tick = setInterval(step, 1000);
  step();
}
let notified = '';
function step() {
  const t = current();
  if (!t) return;
  const now = Date.now();
  /* your game left the board unfinished (you started another game): it waits for you again */
  const onBoard = gid => (S.tourney && S.tourney.gid === gid && !S.over) || (vstate.active && vstate.tourney && vstate.tourney.gid === gid && !vstate.over);
  for (const g of t.games) if (g.status === 'playing' && (g.w === T.YOU || g.b === T.YOU) && !onBoard(g.id)) { g.status = 'pending'; notified = ''; save(t); }
  if (t.format === 'arena') {
    if (T.arenaPair(t, now, youReady && !S.tourney?.gid).length) save(t);
    const before = t.status;
    T.advance(t, now);
    if (before !== t.status) finished(t);
  }
  for (const lane of lanes) {
    if (lane.game) continue;
    const g = T.readyGames(t).find(x => x.w !== T.YOU && x.b !== T.YOU && !x.bye && x.status === 'pending' && !busyLlm(t, x));
    if (!g) break;
    runGame(t, g, lane);
  }
  const yg = T.yourGame(t);
  if (yg && notified !== yg.id && !(S.tourney && S.tourney.gid === yg.id)) {
    notified = yg.id;
    toast(`${t.name}: your game is ready`);
    badge(true);
  }
  if (!yg) badge(false);
  if (visible()) refreshLive(t);
}
/* AI models play one game at a time: don't start a second game that needs one while another is going */
function busyLlm(t, g) {
  const isLlm = id => T.playerById(t, id)?.type === 'llm';
  if (!isLlm(g.w) && !isLlm(g.b)) return false;
  return t.games.some(x => x.status === 'playing' && (isLlm(x.w) || isLlm(x.b)));
}
async function runGame(t, g, lane) {
  g.status = 'playing';
  const w = T.playerById(t, g.w), b = T.playerById(t, g.b);
  const r = await lane.play(g, w, b, {speed: t.speed, engines: S.engineList || [], variant: t.variant}, st => { live.set(g.id, st); if (visible()) paintBoards(t); });
  live.delete(g.id);
  if (!r) { if (byId(t.id) && g.status === 'playing') g.status = 'pending'; return; }   /* stopped */
  if (!byId(t.id)) return;
  T.recordResult(t, g.id, r.result, r.reason, r.moves);
  if (t.status === 'done') finished(t);
  save(t);
  if (visible()) render();
}
/* your game on the main board */
function playYours(t, g) {
  if (S.tourney && S.tourney.gid === g.id && !S.over) { app.showTab('play'); return; }
  if (app.gameOn() && !confirm('Leave the game you are playing to start your tournament game?')) return;
  const seat = p => p.type === 'human' ? {type: 'human', rating: myRating()}
    : p.type === 'llm' ? {type: 'llm', provider: p.provider, model: p.model, think: 'none', sees: 'board', img: 'off', rating: p.rating}
      : {type: 'engine', engine: p.engine, level: p.level, elo: p.elo, maia: p.maia, nodes: p.nodes, rating: p.rating};
  g.status = 'playing'; save(t, true); badge(false);
  if (t.variant) {   /* a variant tournament: your game is on the variant board */
    const vseat = p => p.type === 'vbot' ? {type: 'vbot', level: p.level} : seat(p);
    vStart({vid: t.variant, seats: [vseat(T.playerById(t, g.w)), vseat(T.playerById(t, g.b))], tc: t.tc, tourney: {tid: t.id, gid: g.id}});
  } else app.startGame({tourney: {tid: t.id, gid: g.id, white: seat(T.playerById(t, g.w)), black: seat(T.playerById(t, g.b)), tc: t.tc}});
  app.showTab('play');
}
/* called by the board when your tournament game ends */
export function tourneyDone(tag, over, moves) {
  const t = byId(tag.tid);
  if (!t) return;
  const g = t.games.find(x => x.id === tag.gid);
  if (!g || g.status === 'done') return;
  if (over.result === '*') { g.status = 'pending'; save(t); return; }   /* stopped: it can be played again */
  T.recordResult(t, g.id, over.result, over.reason, moves);
  if (t.status === 'done') finished(t);
  save(t, true);
  if (visible()) render();
}
function finished(t) {
  for (const lane of lanes) if (lane.game && t.games.some(g => g.id === lane.game)) lane.stop();
  const st = T.standings(t), me = st.find(s => s.id === T.YOU);
  if (me) {
    const bonus = L.placeBonus(me.rank);
    if (bonus) { leagueAdd(bonus, false); toast(`${t.name}: you finished ${ordinal(me.rank)}. +${bonus} league points`); }
    else toast(`${t.name} is over: you finished ${ordinal(me.rank)}`);
  } else toast(`${t.name} is over`);
  save(t, true);
}
const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
function badge(on) { const b = document.querySelector('.railbtn[data-tab="compete"]'); if (b) b.classList.toggle('dot', !!on); }
const visible = () => !$('tab-compete')?.hidden;

/* ================= league ================= */
function league() {
  if (!SET.league) SET.league = L.newLeague(Date.now());
  if (L.rollover(SET.league, Date.now())) saveSettings();
  return SET.league;
}
function leagueAdd(pts, game = true) {
  const Lg = league();
  if (game) L.addPoints(Lg, pts, Date.now()); else Lg.pts += pts;
  saveSettings();
}
/* points for a rated game (called by the board); returns the points for the result card */
export function leagueGame(info) {
  const pts = L.gamePoints(info);
  leagueAdd(pts, true);
  return pts;
}

/* ================= screens ================= */
export function render() {
  const box = $('cmpBody'); if (!box) return;
  if (!loaded) { load().then(render); }
  box.innerHTML = '';
  box.append(el('h2', {class: 'hubh'}, 'Compete'),
    el('div', {class: 'seg cmpseg', role: 'tablist'},
      ...[['tourneys', 'Tournaments', 't-trophy'], ['league', 'League', 'lg-' + L.DIVISIONS[league().div].id]].map(([k, name, art]) =>
        el('button', {type: 'button', role: 'tab', class: view.sec === k ? 'on' : '', 'aria-selected': view.sec === k, onclick: () => { view.sec = k; view.page = 'home'; render(); }},
          el('img', {src: `avatars/${art}.webp`, alt: ''}), el('span', {}, name)))));
  if (view.sec === 'league') return renderLeague(box);
  if (view.page === 'new') return renderNew(box);
  if (view.page === 'view' && byId(view.tid)) return renderTourney(box, byId(view.tid));
  renderHome(box);
}
const head = (title, back) => el('div', {class: 'modehead'}, el('button', {class: 'ib', type: 'button', 'aria-label': 'Back', title: 'Back', html: icon('caret-left'), onclick: back}), el('b', {}, title));

function renderHome(box) {
  const t = current();
  if (t) {
    const yg = T.yourGame(t), running = t.games.filter(g => g.status === 'playing').length;
    box.append(el('button', {type: 'button', class: 'mode cmplive', onclick: () => open(t)},
      el('img', {src: `avatars/${ART[t.format]}.webp`, alt: ''}),
      el('span', {}, el('b', {}, t.name), el('small', {}, statusLine(t) + (running ? ` · ${running} playing` : ''))),
      yg ? el('span', {class: 'cmpready'}, 'Your game') : el('span', {class: 'ic', html: ICONS['caret-right']})));
  }
  box.append(el('h3', {class: 'gh'}, t ? 'Start another' : 'Start a tournament'));
  for (const [k, F] of Object.entries(T.FORMATS))
    box.append(el('button', {type: 'button', class: 'mode', disabled: !!t, title: t ? 'Finish or stop the tournament that is running first' : '', onclick: () => { view.page = 'new'; view.fmt = k; field = null; render(); }},
      el('img', {src: `avatars/${ART[k]}.webp`, alt: ''}), el('span', {}, el('b', {}, F.name), el('small', {}, FMT_SUB[k])), el('span', {class: 'ic', html: ICONS['caret-right']})));
  const past = list.filter(x => x.status === 'done').slice().reverse();
  if (past.length) {
    box.append(el('h3', {class: 'gh'}, 'Past tournaments'));
    for (const x of past.slice(0, 12)) {
      const st = T.standings(x), me = st.find(s => s.id === T.YOU), win = T.playerById(x, T.winnerOf(x));
      box.append(el('button', {type: 'button', class: 'cmppast', onclick: () => open(x)},
        el('img', {src: `avatars/${ART[x.format]}.webp`, alt: ''}),
        el('span', {class: 'grow'}, el('b', {}, x.name), el('small', {}, new Date(x.created).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) + ' · won by ' + (win ? win.name : '?'))),
        me ? el('span', {class: 'place' + (me.rank <= 3 ? ' top' : '')}, ordinal(me.rank)) : null));
    }
  }
}
const FMT_SUB = {
  rr: 'Everyone plays everyone once. Most points wins.',
  swiss: 'A few rounds, paired by score. No rematches.',
  ko: 'A bracket: win to go on, lose and you are out.',
  arena: 'Nonstop games against the clock. Win streaks score double.',
  climb: 'Rounds paired by rating. Gain the most rating to win.',
};
function open(t) { view.page = 'view'; view.tid = t.id; render(); }
function statusLine(t) {
  if (t.status === 'done') { const w = T.playerById(t, T.winnerOf(t)); return 'Finished, won by ' + (w ? w.name : '?'); }
  if (t.format === 'arena') { const s = Math.max(0, Math.ceil((t.arena.ends - Date.now()) / 1000)); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left` : 'Last games'; }
  if (t.format === 'ko') return koRoundName(t, t.round);
  return `Round ${t.round} of ${t.rounds}`;
}
function koRoundName(t, r) {
  const left = t.ko.rounds - r;
  return left === 0 ? 'Final' : left === 1 ? 'Semifinals' : left === 2 ? 'Quarterfinals' : `Round of ${2 ** (t.ko.rounds - r + 1)}`;
}

/* ---------- a new tournament ---------- */
function renderNew(box) {
  const o = SET.tourney, f = view.fmt;
  if (!COUNTS[f].includes(o.count)) o.count = COUNTS[f].includes(8) ? 8 : COUNTS[f][0];
  if (!field) field = buildField(o);
  const re = () => { saveSettings(); field = buildField(o); render(); };
  const seg = (items, cur, setv, label) => el('div', {class: 'seg small', role: 'radiogroup', 'aria-label': label},
    ...items.map(([v, txt]) => el('button', {type: 'button', role: 'radio', class: String(cur) === String(v) ? 'on' : '', 'aria-checked': String(cur) === String(v), onclick: () => setv(v)}, txt)));
  const row = (label, ctl) => el('div', {class: 'cmprow'}, el('span', {class: 'l'}, label), ctl);
  box.append(head('New tournament', () => { view.page = 'home'; render(); }),
    el('div', {class: 'cmphero'}, el('img', {src: `avatars/${ART[f]}.webp`, alt: ''}), el('div', {}, el('b', {}, T.FORMATS[f].name), el('small', {}, FMT_SUB[f]))));
  const form = el('div', {class: 'cmpform'});
  form.append(row('Players', seg(COUNTS[f].map(n => [n, String(n)]), o.count, v => { o.count = v; re(); }, 'Players')));
  form.append(row('Opponents', seg([['close', 'Near my level'], ['wide', 'Wide range'], ['strong', 'Stronger']], o.spread, v => { o.spread = v; re(); }, 'Opponents')));
  if (f === 'arena') {
    form.append(row('Length', seg([[5, '5 min'], [10, '10 min'], [20, '20 min']], o.minutes, v => { o.minutes = v; saveSettings(); render(); }, 'Length')));
    form.append(row('Winner', seg([['points', 'Most points'], ['streak', 'Longest streak']], o.scoring, v => { o.scoring = v; saveSettings(); render(); }, 'Winner')));
  }
  const vsel = el('select', {class: 'cmpsel', 'aria-label': 'Variant'}, el('option', {value: 'chess'}, 'Standard chess'),
    ...GROUPS.map(g => el('optgroup', {label: g.name}, ...VARIANTS.filter(v => v.group === g.id).map(v => el('option', {value: v.id}, v.name)))));
  vsel.value = o.variant || 'chess';
  vsel.onchange = () => { o.variant = vsel.value; re(); };
  form.append(row('Variant', vsel));
  form.append(row('Your games', seg(TCS.map(([v, txt]) => [v, txt]), o.tc, v => { o.tc = v; saveSettings(); render(); }, 'Your games')));
  form.append(row('Other games', seg([['quick', 'Quick'], ['normal', 'Normal']], o.speed, v => { o.speed = v; saveSettings(); render(); }, 'Other games')));
  const llm = llmSeat();
  const chip = (key, ic, txt, tip, dis) => {
    const inp = el('input', {type: 'checkbox', disabled: !!dis}); inp.checked = !!o[key] && !dis;
    inp.onchange = () => { o[key] = inp.checked; re(); };
    return el('label', {class: 'chip', title: tip}, inp, el('span', {class: 'ic', html: ICONS[ic] || ''}), el('span', {}, txt));
  };
  form.append(el('div', {class: 'chips'},
    chip('you', 'user', 'I play in it', 'Take part yourself: your games are played on the main board'),
    chip('historic', 'scroll-fill', 'Historic bots', 'Add Turochamp (1948) and the Random mover to the field'),
    chip('llm', 'robot', 'My AI model', llm ? `Add ${llm.model} to the field. Models are slow and play one game at a time` : 'Pick an AI model for one side in New game first', !llm)));
  box.append(form);
  /* the field: who plays */
  box.append(el('div', {class: 'cmpfieldh'}, el('h3', {class: 'gh'}, `The field (${field.length})`), el('button', {type: 'button', class: 'ib', title: 'Pick other opponents', 'aria-label': 'Shuffle', html: icon('shuffle'), onclick: () => { field = buildField(o); render(); }})));
  const grid = el('div', {class: 'cmpfield'});
  for (const p of field) grid.append(seatChip(p));
  box.append(grid);
  if (field.length < T.FORMATS[f].min) box.append(el('p', {class: 'hint'}, 'Not enough opponents: install an engine in Settings, Chess engines, or turn on the historic bots.'));
  box.append(el('div', {class: 'startbar cmpstart'}, el('button', {type: 'button', class: 'primary', disabled: field.length < T.FORMATS[f].min, html: icon('play') + '<span>Start tournament</span>', onclick: () => create(f)})));
}
function seatChip(p, extra) {
  const av = el('span'); app.paintAvatar(av, p, 'avatar');
  return el('div', {class: 'seatchip' + (p.id === T.YOU ? ' me' : '')}, av, el('span', {class: 'bt'}, el('b', {}, p.name), el('small', {}, extra ?? String(p.rating || ''))));
}
function create(f) {
  if (current()) { toast('A tournament is already running'); return; }
  const o = SET.tourney;
  const names = {rr: 'Round-robin', swiss: 'Swiss open', ko: 'Knockout cup', arena: 'Arena', climb: 'Rating climb'};
  const day = new Date().toLocaleDateString('en-GB', {weekday: 'long'});
  const vid = o.variant && o.variant !== 'chess' ? o.variant : null;
  const t = T.createTournament(field, {format: f, name: `${day} ${vid ? variantById(vid).name + ' ' : ''}${names[f]}`, tc: tcOf(o.tc), speed: o.speed, minutes: o.minutes, scoring: o.scoring, variant: vid});
  list.push(t); save(t, true);
  field = null; youReady = true;
  open(t); step();
}

/* ---------- a tournament ---------- */
function renderTourney(box, t) {
  const st = T.standings(t), me = st.find(s => s.id === T.YOU), running = t.games.filter(g => g.status === 'playing');
  box.append(head(t.name, () => { view.page = 'home'; render(); }));
  box.append(el('div', {class: 'cmphero'}, el('img', {src: `avatars/${ART[t.format]}.webp`, alt: ''}),
    el('div', {}, el('b', {id: 'cmpStatus'}, statusLine(t)),
      el('small', {}, `${T.FORMATS[t.format].name} · ${t.players.length} players · your games ${tcLabel(t.tc)}` + (t.format === 'arena' && t.arena.scoring === 'streak' ? ' · longest streak wins' : '')))));
  /* the champion, or your game */
  if (t.status === 'done') {
    const w = T.playerById(t, T.winnerOf(t)), av = el('span'); app.paintAvatar(av, w || {}, 'avatar big');
    box.append(el('div', {class: 'cmpchamp'}, el('img', {class: 'cup', src: 'avatars/t-trophy.webp', alt: ''}),
      el('div', {}, el('small', {}, 'Champion'), el('b', {}, w ? w.name : '?'), me ? el('span', {class: 'you'}, `You finished ${ordinal(me.rank)} of ${st.length}`) : null), av));
  } else if (me) box.append(yourCard(t, me));
  box.append(t.format === 'ko' ? bracket(t) : table(t, st));
  /* the games being played in the background */
  const boards = el('div', {class: 'cmpboards', id: 'cmpBoards'});
  box.append(el('h3', {class: 'gh', hidden: !running.filter(g => live.has(g.id)).length}, 'Playing now'), boards);
  paintBoards(t, boards);
  /* every result */
  const fin = t.games.filter(g => g.status === 'done' && !g.bye).slice().sort((a, b) => (b.seq || 0) - (a.seq || 0));
  if (fin.length) {
    const d = el('details', {class: 'grp cmpgames'}, el('summary', {}, el('span', {class: 'chev', html: ICONS['caret-down']}), el('b', {}, 'Games'), el('small', {}, `${fin.length} played`)));
    const body = el('div', {class: 'grpbody'});
    for (const g of fin.slice(0, 80)) body.append(gameRow(t, g));
    d.append(body); box.append(d);
  }
  box.append(el('div', {class: 'cmpfoot'}, t.status === 'live'
    ? el('button', {type: 'button', class: 'quiet danger', onclick: () => stop(t)}, 'Stop tournament')
    : el('button', {type: 'button', class: 'quiet danger', onclick: () => remove(t)}, 'Delete')));
}
function yourCard(t, me) {
  const g = T.yourGame(t), onBoard = S.tourney && S.tourney.tid === t.id && !S.over;
  const card = el('div', {class: 'cmpyou'});
  if (onBoard) {
    card.append(el('div', {class: 'grow'}, el('b', {}, 'Your game is on the board'), el('small', {}, 'Finish it there; the result counts here.')),
      el('button', {type: 'button', class: 'primary', onclick: () => app.showTab('play')}, 'Go to the board'));
  } else if (g) {
    const opp = T.playerById(t, g.w === T.YOU ? g.b : g.w), white = g.w === T.YOU, av = el('span'); app.paintAvatar(av, opp, 'avatar');
    card.classList.add('ready');
    card.append(av, el('div', {class: 'grow'}, el('b', {}, opp.name + (opp.rating ? ` (${opp.rating})` : '')),
      el('small', {}, el('i', {class: 'dot ' + (white ? 'w' : 'b')}), `You play ${white ? 'White' : 'Black'} · ${tcLabel(t.tc)}` + (t.format === 'ko' && g.match ? matchNote(t, g) : ''))),
    el('button', {type: 'button', class: 'primary', html: icon('play') + '<span>Play</span>', onclick: () => playYours(t, g)}));
  } else {
    let msg = 'Waiting for the other games of this round';
    if (t.format === 'ko' && !t.ko.matches.some(m => !m.winner && (m.a === T.YOU || m.b === T.YOU))) msg = t.ko.matches.some(m => m.winner === T.YOU && m.round === t.ko.rounds) ? 'You won the cup' : 'You are out. The cup goes on without you';
    if (t.format === 'arena') msg = youReady ? 'Looking for an opponent' : 'Paused: switch on "Pair me" to get games';
    card.append(el('div', {class: 'grow'}, el('b', {}, msg), el('small', {}, `You: ${ordinal(me.rank)} with ${fmtPts(t, me)}`)));
  }
  if (t.format === 'arena' && t.status === 'live') {
    const inp = el('input', {type: 'checkbox', class: 'switch sm', 'aria-label': 'Pair me'}); inp.checked = youReady;
    inp.onchange = () => {
      youReady = inp.checked;
      if (!youReady) { const yg = T.yourGame(t); if (yg) { T.dropGame(t, yg.id); save(t); } }
      render();
    };
    card.append(el('label', {class: 'swi pairme', title: 'Get paired as soon as you are free'}, inp, el('span', {}, 'Pair me')));
  }
  return card;
}
function matchNote(t, g) {
  const m = t.ko.matches.find(x => x.id === g.match);
  return m && m.games.length > 1 ? ` · decider ${m.games.length}` : ` · ${koRoundName(t, m.round)}`;
}
const fmtPts = (t, s) => t.format === 'climb' ? `${s.gain >= 0 ? '+' : ''}${s.gain} rating` : t.format === 'arena' && t.arena.scoring === 'streak' ? `best streak ${s.best}` : `${s.pts} point${s.pts === 1 ? '' : 's'}`;

/* standings: rank, player, the last results, points and the tie-break */
function table(t, st) {
  const climb = t.format === 'climb', arena = t.format === 'arena', streak = arena && t.arena.scoring === 'streak';
  const cols = climb ? ['Rating', 'Gain'] : arena ? (streak ? ['Points', 'Best'] : ['Best', 'Points']) : [t.format === 'swiss' ? 'Buch.' : 'SB', 'Points'];
  const box = el('div', {class: 'cmptable', role: 'table', 'aria-label': 'Standings'});
  box.append(el('div', {class: 'tr th', role: 'row'}, el('span', {class: 'rk'}, '#'), el('span', {class: 'pl'}, 'Player'), el('span', {class: 'fm'}, 'Form'), el('span', {class: 'n'}, cols[0]), el('span', {class: 'n big'}, cols[1])));
  for (const s of st) {
    const av = el('span'); app.paintAvatar(av, s.p, 'avatar');
    const form = el('span', {class: 'fm'}, ...s.form.slice(-5).map(r => el('i', {class: 'f-' + r, title: {w: 'Win', d: 'Draw', l: 'Loss', bye: 'Bye'}[r]})));
    const playing = t.games.some(g => g.status === 'playing' && (g.w === s.id || g.b === s.id));
    const vals = climb ? [String(s.elo), (s.gain >= 0 ? '+' : '') + s.gain] : arena ? (streak ? [String(s.pts), String(s.best)] : [String(s.best), String(s.pts)]) : [fmtNum(t.format === 'swiss' ? s.buchholz : s.sb), fmtNum(s.pts)];
    box.append(el('div', {class: 'tr' + (s.id === T.YOU ? ' me' : '') + (s.rank === 1 && t.status === 'done' ? ' champ' : ''), role: 'row'},
      el('span', {class: 'rk'}, String(s.rank)),
      el('span', {class: 'pl'}, av, el('span', {class: 'bt'}, el('b', {}, s.p.name), el('small', {}, (s.p.rating ? String(s.p.rating) : '') + (playing ? ' · playing' : '')))),
      form,
      el('span', {class: 'n'}, vals[0]),
      el('span', {class: 'n big' + (climb ? (s.gain > 0 ? ' up' : s.gain < 0 ? ' down' : '') : '')}, arena && s.fire ? el('span', {class: 'fire', title: 'On a streak: wins count double', html: ICONS['flame-fill']}) : null, vals[1])));
  }
  return box;
}
const fmtNum = x => Number.isInteger(x) ? String(x) : x.toFixed(1);

/* ---------- the knockout bracket ----------
   Matches are small two-row tickets in columns, one column per round; the lines between them are drawn in one SVG
   underneath, with rounded elbows. The path a player took to the final is lit in bone white as they advance. */
const BK = {w: 150, h: 56, gap: 12, col: 30, top: 26};
function bracket(t) {
  const R = t.ko.rounds, size = 2 ** R, slot = BK.h + BK.gap;
  const W = R * (BK.w + BK.col) + 96, H = BK.top + slot * size / 2;
  const x = r => (r - 1) * (BK.w + BK.col), y = (r, i) => BK.top + slot * 2 ** (r - 1) * (i + .5) - BK.h / 2;
  const wrap = el('div', {class: 'bracket', role: 'figure', 'aria-label': 'Knockout bracket'});
  const inner = el('div', {class: 'bk-inner', style: `width:${W}px;height:${H}px`});
  let paths = '';
  for (let r = 1; r <= R; r++) inner.append(el('div', {class: 'bk-round', style: `left:${x(r)}px;width:${BK.w}px`}, koRoundName(t, r)));
  for (let r = 1; r <= R; r++) {
    for (let i = 0; i < size / 2 ** r; i++) {
      const m = t.ko.matches.find(q => q.round === r && q.slot === i);
      inner.append(ticket(t, m, x(r), y(r, i), r, i));
      /* the line to the next round */
      const x1 = x(r) + BK.w, y1 = y(r, i) + BK.h / 2, x2 = r < R ? x(r + 1) : x(r) + BK.w + BK.col, xm = x1 + BK.col / 2;
      const y2 = r < R ? y(r + 1, i >> 1) + (i % 2 ? BK.h * .75 : BK.h * .25) : y1;
      const lit = m && m.winner ? ' lit' : '', k = Math.min(7, Math.abs(y2 - y1) / 2);
      if (Math.abs(y2 - y1) < 1) paths += `<path class="bk-line${lit}" d="M${x1} ${y1} H${x2}"/>`;
      else {
        const dir = y2 > y1 ? 1 : -1;
        paths += `<path class="bk-line${lit}" d="M${x1} ${y1} H${xm - k} Q${xm} ${y1} ${xm} ${y1 + dir * k} V${y2 - dir * k} Q${xm} ${y2} ${xm + k} ${y2} H${x2}"/>`;
      }
    }
  }
  const champ = t.status === 'done' ? T.playerById(t, t.champion) : null, cx = x(R) + BK.w + BK.col, cy = y(R, 0);
  const cup = el('div', {class: 'bk-cup' + (champ ? ' won' : ''), style: `left:${cx}px;top:${cy - 6}px`}, el('img', {src: 'avatars/t-trophy.webp', alt: ''}), el('small', {}, champ ? champ.name : 'Champion'));
  inner.insertAdjacentHTML('afterbegin', `<svg class="bk-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${paths}</svg>`);
  inner.append(cup);
  wrap.append(inner);
  return wrap;
}
function ticket(t, m, left, top, r, slot) {
  if (!m && r > 1) {   /* not drawn yet: show whoever already won their way here */
    const prev = i => t.ko.matches.find(q => q.round === r - 1 && q.slot === i)?.winner || null;
    m = {a: prev(slot * 2), b: prev(slot * 2 + 1), games: [], winner: null, pending: true};
  }
  const card = el('div', {class: 'bk-ticket', style: `left:${left}px;top:${top}px;width:${BK.w}px;height:${BK.h}px`});
  const games = m ? m.games.map(id => t.games.find(g => g.id === id)).filter(Boolean) : [];
  const playing = games.some(g => g.status === 'playing');
  if (playing) card.classList.add('live');
  for (const side of ['a', 'b']) {
    const pid = m ? m[side] : null, p = pid ? T.playerById(t, pid) : null;
    const rowEl = el('div', {class: 'bk-row' + (m && m.winner && pid && m.winner !== pid ? ' out' : '') + (m && m.winner === pid && pid ? ' win' : '') + (pid === T.YOU ? ' me' : '')});
    if (!p) { rowEl.append(el('span', {class: 'bk-name tbd'}, m && !m.pending && (m.a || m.b) && r === 1 ? 'Bye' : 'To be decided')); card.append(rowEl); continue; }
    const av = el('span'); app.paintAvatar(av, p, 'avatar');
    const pips = el('span', {class: 'bk-pips'}, ...games.filter(g => g.status === 'done').map(g => {
      const mine = g.w === pid ? 0 : 1, sc = g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (mine === 0) ? 'w' : 'l';
      return el('i', {class: 'p-' + sc});
    }));
    rowEl.append(av, el('span', {class: 'bk-name'}, p.name), el('span', {class: 'bk-seed'}, String(t.ko.seed[pid] || '')), pips);
    card.append(rowEl);
  }
  return card;
}

/* ---------- live boards ---------- */
function paintBoards(t, box = $('cmpBoards')) {
  if (!box) return;
  const ids = t.games.filter(g => g.status === 'playing' && live.has(g.id)).map(g => g.id);
  for (const n of [...box.children]) if (!ids.includes(n.dataset.id)) n.remove();
  for (const id of ids) {
    const st = live.get(id);
    let card = box.querySelector(`[data-id="${id}"]`);
    if (!card) {
      card = el('div', {class: 'mbcard', 'data-id': id}, el('div', {class: 'mbname b'}), el('div', {class: 'mb'}), el('div', {class: 'mbname w'}));
      box.append(card);
    }
    card.querySelector('.mbname.b').textContent = st.black.name;
    card.querySelector('.mbname.w').textContent = st.white.name;
    if (st.variant) miniVBoard(card.querySelector('.mb'), st.variant, st.fen, st.last); else miniBoard(card.querySelector('.mb'), st.fen, st.last);
  }
  const h = box.previousElementSibling; if (h) h.hidden = !ids.length;
}
/* a variant's small board: any size, the variant's own pieces */
function miniVBoard(node, vid, fen, last) {
  const P = parseFen(fen);
  node.innerHTML = '';
  node.classList.add('mv');
  node.style.setProperty('--mf', P.files); node.style.setProperty('--mr', P.ranks);
  for (let r = P.ranks - 1; r >= 0; r--) for (let f = 0; f < P.files; f++) {
    const name = String.fromCharCode(97 + f) + (r + 1), c = P.cells[r][f];
    const s = el('span', {class: 'ms' + ((r + f) % 2 ? '' : ' d') + (last && (name === last.from || name === last.to) ? ' last' : '')});
    if (c && !c.wall) s.append(pieceEl(vid, c.l, c.side, c.promo, 'vp'));
    node.append(s);
  }
}
const FENP = {p: 1, n: 2, b: 3, r: 4, q: 5, k: 6};
function miniBoard(node, fen, last) {
  const rows = fen.split(' ')[0].split('/'), from = last & 127, to = (last >> 7) & 127;
  node.innerHTML = ''; node.classList.remove('mv'); node.style.removeProperty('--mf'); node.style.removeProperty('--mr');
  rows.forEach((row, ri) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) node.append(sq(7 - ri, f++)); continue; }
      const s = sq(7 - ri, f++), p = FENP[ch.toLowerCase()] | (ch === ch.toLowerCase() ? 8 : 0);
      s.append(setPiece(el('i'), p, 'mpc'));
      node.append(s);
    }
  });
  function sq(r, f) {
    const s = r * 16 + f;
    return el('span', {class: 'ms' + ((r + f) % 2 ? '' : ' d') + (last && (s === from || s === to) ? ' last' : '')});
  }
}
function refreshLive(t) {
  const s = $('cmpStatus'); if (s && view.page === 'view' && view.tid === t.id) s.textContent = statusLine(t);
}
function gameRow(t, g) {
  const w = T.playerById(t, g.w), b = T.playerById(t, g.b);
  const res = {'1-0': '1-0', '0-1': '0-1', '1/2-1/2': '½-½'}[g.result] || '';
  return el('button', {type: 'button', class: 'cmpgame', title: 'Replay this game on the board', onclick: () => replay(t, g)},
    el('span', {class: 'gw' + (g.result === '1-0' ? ' won' : '')}, w?.name || '?'), el('span', {class: 'gr'}, res), el('span', {class: 'gb' + (g.result === '0-1' ? ' won' : '')}, b?.name || '?'),
    el('small', {}, `${Math.ceil((g.moves?.length || 0) / 2)} moves`));
}
function replay(t, g) {
  if (t.variant) {
    const P = p => ({name: p.name, type: p.type === 'vbot' ? 'engine' : p.type, engine: p.type === 'vbot' ? 'builtin' : p.engine, model: p.model, provider: p.provider, rating: p.rating});
    if (!(g.moves || []).length) { toast('No moves to replay'); return; }
    vReplay({id: 'tg-' + g.id, fairy: t.variant, startFen: undefined, movesUci: g.moves, players: [P(T.playerById(t, g.w)), P(T.playerById(t, g.b))], result: g.result, reason: g.reason});
    return;
  }
  const pos = new C.Pos(C.START_FEN, 0, false), raw = [];
  for (const u of g.moves || []) { const m = pos.fromUci(u); if (!m) break; raw.push(m); pos.make(m); }
  if (raw.length < 1) { toast('No moves to replay'); return; }
  const P = p => ({name: p.name, type: p.type === 'human' ? 'human' : p.type, engine: p.engine, level: p.level, elo: p.elo, maia: p.maia, nodes: p.nodes, model: p.model, provider: p.provider, rating: p.rating});
  app.replayGame({id: 'tg-' + g.id, players: [P(T.playerById(t, g.w)), P(T.playerById(t, g.b))], movesRaw: raw, result: g.result, reason: g.reason, startFen: C.START_FEN});
}
function stop(t) {
  if (!confirm('Stop this tournament? The standings so far are kept.')) return;
  for (const lane of lanes) if (lane.game && t.games.some(g => g.id === lane.game)) lane.stop();
  for (const g of t.games.filter(x => x.status !== 'done')) T.dropGame(t, g.id);
  t.status = 'done'; t.stopped = true;
  if (t.format === 'ko' && !t.champion) t.champion = T.standings(t)[0]?.id;
  save(t, true); render();
}
function remove(t) {
  if (!confirm('Delete this tournament?')) return;
  list = list.filter(x => x !== t);
  api('/api/tournaments', {remove: t.id}).catch(() => {});
  view.page = 'home'; render();
}

/* ---------- the league screen ---------- */
function renderLeague(box) {
  const Lg = league(), D = L.DIVISIONS[Lg.div], rows = L.table(Lg, Date.now()), me = rows.find(r => r.you);
  const left = L.weekEnd(Lg.week) - Date.now(), dd = Math.floor(left / 864e5), hh = Math.floor(left % 864e5 / 36e5);
  if (Lg.result) {
    const r = Lg.result, moved = r.move === 'up' ? `Promoted to the ${L.DIVISIONS[Lg.div].name}` : r.move === 'down' ? `Down to the ${L.DIVISIONS[Lg.div].name}` : `You stay in the ${L.DIVISIONS[Lg.div].name}`;
    box.append(el('div', {class: 'lgresult ' + r.move}, el('img', {src: `avatars/lg-${L.DIVISIONS[Lg.div].id}.webp`, alt: ''}),
      el('div', {class: 'grow'}, el('b', {}, moved), el('small', {}, `Last week you finished ${ordinal(r.rank)} in the ${L.DIVISIONS[r.div].name} with ${r.pts} points.`)),
      el('button', {type: 'button', class: 'ib', 'aria-label': 'Close', title: 'Close', html: icon('x'), onclick: () => { Lg.result = null; saveSettings(); render(); }})));
  }
  box.append(el('div', {class: 'lghero'}, el('img', {src: `avatars/lg-${D.id}.webp`, alt: ''}),
    el('div', {}, el('b', {}, D.name), el('small', {}, `Week ends in ${dd ? dd + 'd ' : ''}${hh}h`),
      el('span', {class: 'lgme'}, el('b', {}, ordinal(me.rank)), ` of ${rows.length} · ${me.pts} point${me.pts === 1 ? '' : 's'}`))));
  /* the ladder of divisions */
  box.append(el('div', {class: 'lgladder', role: 'list', 'aria-label': 'Divisions'}, ...L.DIVISIONS.map((d, i) =>
    el('span', {role: 'listitem', class: 'lgstep' + (i === Lg.div ? ' on' : '') + (i > Math.max(Lg.best || 0, Lg.div) ? ' locked' : ''), title: d.name},
      el('img', {src: `avatars/lg-${d.id}.webp`, alt: d.name})))));
  const tbl = el('div', {class: 'lgtable', role: 'table', 'aria-label': D.name});
  rows.forEach((r, i) => {
    if (i === L.UP && Lg.div < L.DIVISIONS.length - 1) tbl.append(el('div', {class: 'lgline up'}, el('span', {}, 'Promotion zone above')));
    if (i === L.GROUP - L.DOWN && Lg.div > 0) tbl.append(el('div', {class: 'lgline down'}, el('span', {}, 'Relegation zone below')));
    const av = el('span'); app.paintAvatar(av, r.you ? {type: 'human'} : {type: 'engine', engine: r.av}, 'avatar');
    tbl.append(el('div', {class: 'lgrow' + (r.you ? ' me' : '') + (r.zone ? ' ' + r.zone : ''), role: 'row'},
      el('span', {class: 'rk'}, String(r.rank)), av, el('span', {class: 'nm'}, r.name), el('span', {class: 'pt'}, String(r.pts))));
  });
  box.append(tbl);
  box.append(el('p', {class: 'hint lgnote'}, 'Rated games against the computer earn points: a win 3 (4 against someone rated 100 or more above you), a draw 1. Tournament games are worth one more, and a tournament podium adds 10, 6 or 4. The top 5 move up when the week ends, the bottom 5 move down. Your rivals are bots from the pool.'));
}
