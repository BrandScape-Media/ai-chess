/* small shared helpers. GPL-3.0-or-later */
export const $ = id => document.getElementById(id);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const relayOK = location.protocol.startsWith('http');

let toastT = 0;
export function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3400);
}

/* GET when body is undefined, POST JSON otherwise; throws Error(message) on failure */
export async function api(path, body, signal) {
  const r = await fetch(path, body === undefined ? {signal} : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('HTTP ' + r.status); }
  if (!r.ok || j.error) throw Object.assign(new Error(typeof j.error === 'string' ? j.error : ('HTTP ' + r.status)), {status: r.status, data: j});
  return j;
}

export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;   /* trusted markup only (icons) */
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}
