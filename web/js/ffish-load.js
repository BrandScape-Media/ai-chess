/* loads ffish (Fairy-Stockfish's rules in WebAssembly) once, on first use; works in the page and in workers.
   GPL-3.0-or-later */
let ready = null;
export function getFF() {
  if (!ready) ready = (async () => {
    const base = new URL('../vendor/ffish/', import.meta.url);
    const {default: Module} = await import(new URL('ffish.js', base).href);
    return Module({locateFile: f => new URL(f, base).href});
  })().catch(e => { ready = null; throw e; });
  return ready;
}
