/* the variant bot in a worker, so the page never freezes while it thinks. GPL-3.0-or-later */
import {getFF} from './ffish-load.js';
import {vbotMove} from './vbot-core.js';

self.onmessage = async e => {
  const d = e.data;
  try {
    const ff = await getFF();
    self.postMessage({id: d.id, done: true, res: vbotMove(ff, d.vid, d.fen, d.moves, {level: d.level, maxMs: d.maxMs})});
  } catch (err) { self.postMessage({id: d.id, done: true, res: null, error: String(err && err.message || err)}); }
};
