import * as C from './core.js';
self.onmessage=function(e){
  const d=e.data,pos=new C.Pos(d.fen,d.variant,d.c960);
  for(const m of d.moves)pos.make(m);
  const r=C.search(pos,C.LEVELS[d.level],info=>self.postMessage({id:d.id,info}));
  self.postMessage({id:d.id,done:true,res:r});
};
