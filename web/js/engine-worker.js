import * as C from './core.js';
import {BOTS} from './historic.js';
self.onmessage=function(e){
  const d=e.data,pos=new C.Pos(d.fen,d.variant,d.c960);
  for(const m of d.moves)pos.make(m);
  if(d.bot&&BOTS[d.bot]&&pos.ksq[0]!==C.NOKING&&pos.ksq[1]!==C.NOKING){
    const t0=performance.now(),r=BOTS[d.bot].fn(pos);
    if(r)r.ms=performance.now()-t0;
    self.postMessage({id:d.id,done:true,res:r});return;
  }
  const r=C.search(pos,C.LEVELS[d.level],info=>self.postMessage({id:d.id,info}));
  self.postMessage({id:d.id,done:true,res:r});
};
