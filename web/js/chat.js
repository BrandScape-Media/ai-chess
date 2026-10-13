/* the chat tab: players talk in character; engines use canned lines and the ELIZA-style bot. GPL-3.0-or-later */
import * as C from './core.js';
import {$, el, pick, sleep} from './util.js';
import {S, SIDE, hooks, seatName, isAI} from './state.js';
import {SET, personaKey} from './settings.js';
import {eventLine, botReply, pieceName} from './personas.js';
import {llmTalk} from './players.js';

let unread = 0, tabNow = 'play';
const VAL = [0, 1, 3, 3, 5, 9, 0];

export function initChat() {
  for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
  $('chatForm').onsubmit = e => { e.preventDefault(); const t = $('chatIn').value.trim(); if (t) { $('chatIn').value = ''; userSays(t); } };
  hooks.say = (side, text) => say(side, text);
}
/* side panel tabs: play (moves + controls), new (game setup), chat */
export function showTab(t) {
  if (t === 'chat' && !S.chatOn) t = 'play';
  if (t === 'new' && tabNow !== 'new' && hooks.newTab) hooks.newTab();   /* coming from elsewhere: start at the Play hub */
  tabNow = t;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  for (const id of ['play', 'review', 'new', 'chat', 'history', 'puzzles']) $('tab-' + id).hidden = id !== t;
  if (t === 'history' && hooks.history) hooks.history();
  if (t === 'review' && hooks.review) hooks.review();
  if (t === 'puzzles' && hooks.puzzles) hooks.puzzles();
  if (t === 'chat') { unread = 0; $('chatBadge').textContent = ''; $('chatIn').focus(); const l = $('chatLog'); l.scrollTop = l.scrollHeight; }
  if (t === 'play') { const mv = $('moves'); mv.scrollTop = mv.scrollHeight; }
}
export const activeTab = () => tabNow;
export function chatVisible() {
  for (const b of document.querySelectorAll('[data-tab="chat"]')) b.hidden = !S.chatOn;
  if (!S.chatOn && tabNow === 'chat') showTab('play');
}

function add(from, text, cls = '') {
  if (!S.chatOn) return;
  S.chatLog.push({from, text, ply: S.moves.length});
  const log = $('chatLog');
  const name = from === 'you' ? (S.seats.filter(P => P.type === 'human').length === 2 ? 'Players' : 'You') : from === 'sys' ? '' : seatName(from);
  const m = el('div', {class: 'msg ' + (from === 'you' ? 'me ' : '') + (from === 'sys' ? 'sys' : '') + cls}, name ? el('b', {}, name + ': ') : null, text);
  log.append(m);
  log.scrollTop = log.scrollHeight;
  if (tabNow !== 'chat' && from !== 'you') { unread++; $('chatBadge').textContent = unread; }
  if (hooks.sync) hooks.sync();
}
export function say(side, text) { if (text) add(side, text); }
/* after a reload: put the saved chat back */
export function restoreChat(list) {
  S.chatLog = []; $('chatLog').innerHTML = ''; unread = 0; $('chatBadge').textContent = '';
  S.bigMoment = null; S.remarks = [{n: 0, last: -99}, {n: 0, last: -99}];
  for (const c of list) add(c.from, c.text);
  unread = 0; $('chatBadge').textContent = '';
}
export function sysMsg(text) { add('sys', text); }

/* ---------- personalities ---------- */
export function assignPersonas() {
  const used = new Set();
  for (const P of S.seats) {
    if (!P || !(P.type === 'llm' || P.type === 'engine')) continue;
    const pool = SET.personalities.filter(p => p.on !== false);
    let id = SET.modelPersonality[personaKey(P)] || SET.defaultPersonality;
    let p = SET.personalities.find(x => x.id === id);
    if (!p || id === 'random') p = pick(pool.filter(x => !used.has(x.id)).length ? pool.filter(x => !used.has(x.id)) : (pool.length ? pool : SET.personalities));
    P.persona = p || null; used.add(p?.id);
  }
}
const botStyle = P => P.persona?.bot || 'friendly';

/* my evaluation in pawns (null if unknown) */
function myEval(i) {
  const P = S.seats[i], w = P.lastInfo?.white;
  if (w == null) return null;
  return (i === 0 ? w : -w) / 100;
}
function material(i) {
  let d = 0;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = S.pos.b[s]; if (q) d += ((q >> 3) === i ? 1 : -1) * VAL[q & 7]; }
  return d;
}
function lastMoveBy(i) {
  for (let k = S.moves.length - 1; k >= 0; k--) if (((S.startPly + k) & 1) === i) return k;
  return -1;
}
function ctx(i) {
  const k = lastMoveBy(i), san = k >= 0 ? S.sans[k].replace(/\?!$/, '') : null, m = k >= 0 ? S.moves[k] : 0;
  let reason = pick(['it improves my position', 'it felt right', 'I like where that piece stands now', 'it keeps everything protected']);
  if (m && ((m >> 17) & 1)) reason = 'free material is free material';
  else if (san && san.includes('+')) reason = 'I like keeping your king busy';
  else if (san && san.startsWith('O-O')) reason = 'king safety comes first';
  else if (S.seats[i].lastInfo?.pv?.length > 2) reason = `it prepares ${S.seats[i].lastInfo.pv[2]}`;
  return {name: seatName(i), myMove: san, reason, myEval: myEval(i), material: material(i), myTurn: S.pos.turn === i};
}

/* ---------- game events ---------- */
/* like real players: hello at the start, gg at the end, the odd reaction in between, silence the rest of the time */
export function onGameStart() {
  S.chatLog = []; S.bigMoment = null; S.remarks = [{n: 0, last: -99}, {n: 0, last: -99}];
  $('chatLog').innerHTML = ''; unread = 0; $('chatBadge').textContent = '';
  for (let i = 0; i < 2; i++) {
    const P = S.seats[i];
    if (P?.type === 'engine' && SET.chat.engineTalk !== false) {
      const t = Math.random() < .8 && eventLine(botStyle(P), 'start');
      if (t) setTimeout(() => add(i, t), 600 + i * 900);
    } else if (P?.type === 'llm' && Math.random() < .8) greetLLM(P, i);
  }
}
async function greetLLM(P, i) {
  const gid = S.gameId;
  await sleep(400 + Math.random() * 1200);
  try {
    const t = await llmTalk(P, i, [{from: 'sys', text: 'The game is starting. Greet your opponent the way people do in online chess ("hi", "gl", "have fun"), in character, or say nothing.'}]);
    if (gid === S.gameId && t) add(i, t);
  } catch (e) { /* the move request will report problems */ }
}
/* engines' canned remarks: only some events, with a cool-down and a cap per game */
const CHANCE = {capture: .3, lost: .35, check: .12, checked: .12, castle: .08, promote: .7, blunder: .7, winning: .35, losing: .35, slip: .8};
const BIG = {capture: 1, lost: 1, promote: 1, blunder: 1, slip: 1};
/* called after every move with what happened */
export function onMove({mover, m, captured, check, free, prevEval}) {
  if (!S.chatOn) return;
  const bigCap = captured && VAL[captured & 7] >= 3;
  if (bigCap || ((m >> 14) & 7 && !free) || free) S.bigMoment = {ply: S.moves.length, mover};
  if (SET.chat.engineTalk === false) return;
  for (let i = 0; i < 2; i++) {
    const P = S.seats[i];
    if (P?.type !== 'engine') continue;
    const st = botStyle(P), mine = mover === i, R = S.remarks?.[i] || {n: 0, last: -99};
    let ev = null, vars = {};
    if (free && !mine) ev = 'slip';
    else if (mine && (m >> 14) & 7 && !free) { ev = 'promote'; vars.piece = pieceName((m >> 14) & 7); }
    else if (bigCap) { ev = mine ? 'capture' : 'lost'; vars.piece = pieceName(captured & 7); }
    else if (check) ev = mine ? 'check' : 'checked';
    else if (mine && (m >> 17) & C.FL_CASTLE) ev = 'castle';
    const e = myEval(i);
    if (!mine && prevEval != null && e != null && e - prevEval >= 2.5) ev = 'blunder';
    if (!ev && e != null && Math.abs(e) > 4 && R.n < 2) ev = e > 0 ? 'winning' : 'losing';
    if (!ev || Math.random() > CHANCE[ev]) continue;
    if (R.n >= 6 || (S.moves.length - R.last < (BIG[ev] ? 6 : 12))) continue;
    const line = eventLine(st, ev, vars);
    if (!line) continue;
    R.n++; R.last = S.moves.length;
    setTimeout(() => add(i, line), 400 + Math.random() * 900);
  }
}
export function onTakeback() {
  if (!S.chatOn || SET.chat.engineTalk === false) return;
  for (let i = 0; i < 2; i++) {
    const P = S.seats[i];
    if (P?.type !== 'engine') continue;
    const t = eventLine(botStyle(P), 'takeback');
    if (t) setTimeout(() => add(i, t), 500);
  }
}
export function onGameOver(over) {
  for (let i = 0; i < 2; i++) {
    const P = S.seats[i];
    if (!P || !isAI(P)) continue;
    const res = over.result === '1/2-1/2' ? 'draw' : over.result === '*' ? null : ((over.result === '1-0') === (i === 0) ? 'win' : 'loss');
    if (!res) continue;
    if (P.type === 'engine') { const t = eventLine(botStyle(P), res, {}, true); if (t) setTimeout(() => add(i, t), 700 + i * 700); }
    else if (P.type === 'llm' && S.chatOn && Math.random() < .9) {
      const gid = S.gameId;
      llmTalk(P, i, [...S.chatLog.slice(-6), {from: 'sys', text: `The game just ended: ${res === 'draw' ? 'a draw' : res === 'win' ? 'you won' : 'you lost'} by ${over.reason}. Most players just type "gg" (maybe "gg wp", or a few words in character). A sore loser might say nothing.`}])
        .then(t => { if (t && gid === S.gameId) add(i, t); }).catch(() => {});
    }
  }
}

/* ---------- the player writes ---------- */
async function userSays(text) {
  add('you', text);
  const gid = S.gameId;
  for (let i = 0; i < 2; i++) {
    const P = S.seats[i];
    if (!P || P.type === 'human') continue;
    if (P.type === 'engine') {
      const st = botStyle(P);
      if (Math.random() < ({grumpy: .3, zen: .3, cocky: .15}[st] || .05)) continue;   /* not everybody answers */
      setTimeout(() => { if (gid === S.gameId) add(i, botReply(st, text, ctx(i))); }, 700 + Math.random() * 1300);
    } else if (P.type === 'llm') {
      const typing = el('div', {class: 'typing'}, seatName(i) + ' is typing…');
      $('chatLog').append(typing); $('chatLog').scrollTop = 1e9;
      try {
        const t = await llmTalk(P, i, S.chatLog);
        if (gid === S.gameId && t) add(i, t);
      } catch (e) { add('sys', `${seatName(i)} could not answer (${e.message})`); }
      typing.remove();
    }
  }
}
