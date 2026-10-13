/* ai-chess core: rules (0x88 board, Chess960 castling, variants, unchecked "free" moves) and the built-in engine.
   Plain ES module, shared by the page and the engine worker. GPL-3.0-or-later. */
/* ===================== chess core: rules + engine (0x88 board) ===================== */
const PAWN=1,KNIGHT=2,BISHOP=3,ROOK=4,QUEEN=5,KING=6;
const FL_CAP=1,FL_EP=2,FL_CASTLE=4,FL_DBL=8,FL_FREE=16;
/* FL_CASTLE: from = king, to = the castling rook (Chess960 style); standard UCI prints the king's destination instead.
   FL_FREE: an unchecked move (that side plays without rules); promo bits = piece placed on `to`
   (a spawn when `from` is empty, e.g. SPAWN_SQ) */
const V_STD=0,V_KOTH=1,V_3CHECK=2;
const NOKING=200;   /* off-board square, so isAttacked() on it is always false */
const SPAWN_SQ=8;   /* off-board and always empty: a free move from here spawns a piece */
const FILES='abcdefgh', PCH='PNBRQK';
const START_FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KN_D=[-33,-31,-18,-14,14,18,31,33], K_D=[-17,-16,-15,-1,1,15,16,17], B_D=[-17,-15,15,17], R_D=[-16,-1,1,16];
const MAXSTACK=4096, MAXPLY=96, MATE=30000, INF=32000;
const sqName=s=>FILES[s&7]+((s>>4)+1);
const nameSq=n=>(n.charCodeAt(1)-49)*16+(n.charCodeAt(0)-97);
const isHill=s=>s===0x33||s===0x34||s===0x43||s===0x44;   /* d4 e4 d5 e5 */
/* UCI text. Castling: the king's destination (e1g1), or king-takes-rook (e1h1) in Chess960. A spawn prints as a drop (Q@h4). */
function uci(m,c960){
  const from=m&127,to=(m>>7)&127,pr=(m>>14)&7,fl=m>>17;
  if(fl&FL_FREE){
    if(from&0x88)return PCH[pr-1]+'@'+sqName(to);
    return sqName(from)+sqName(to)+(pr>=KNIGHT&&pr<=QUEEN?'nbrq'[pr-2]:'');
  }
  if(fl&FL_CASTLE)return sqName(from)+sqName(c960?to:(from&0x70)+(to>from?6:2));
  return sqName(from)+sqName(to)+(pr?'nbrq'[pr-2]:'');
}

function mulberry32(a){return function(){a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)}}
const Z1=[],Z2=[];
const ZC1=new Int32Array(16),ZC2=new Int32Array(16),ZEP1=new Int32Array(8),ZEP2=new Int32Array(8),ZK1=new Int32Array(8),ZK2=new Int32Array(8);
let ZS1=0,ZS2=0;
(function(){
  const r=mulberry32(0x9E3779B9);
  for(let p=0;p<16;p++){Z1.push(new Int32Array(128));Z2.push(new Int32Array(128));for(let s=0;s<128;s++){Z1[p][s]=r()|0;Z2[p][s]=r()|0}}
  for(let i=0;i<16;i++){ZC1[i]=r()|0;ZC2[i]=r()|0}
  for(let i=0;i<8;i++){ZEP1[i]=r()|0;ZEP2[i]=r()|0}
  ZS1=r()|0;ZS2=r()|0;
  for(let i=0;i<8;i++){ZK1[i]=r()|0;ZK2[i]=r()|0}   /* three-check: checks given per side (0..3) */
})();

class Pos{
  constructor(fen,variant,c960){
    this.b=new Int8Array(128);this.turn=0;this.castle=0;this.ep=-1;this.half=0;this.full=1;this.ksq=[0,0];this.h1=0;this.h2=0;this.n=0;
    this.variant=variant|0;this.c960=!!c960;this.c960Needed=false;this.checks=[0,0];
    this.crook=new Int16Array(4);   /* castling rook squares: white O-O, white O-O-O, black O-O, black O-O-O (= castle bits 1,2,4,8) */
    this.cmask=new Uint8Array(128); /* castle &= cmask[from] & cmask[to] on every move */
    this.uM=new Int32Array(MAXSTACK);this.uCap=new Int8Array(MAXSTACK);this.uPc=new Int8Array(MAXSTACK);this.uCas=new Uint8Array(MAXSTACK);
    this.uEp=new Int16Array(MAXSTACK);this.uHalf=new Int16Array(MAXSTACK);this.uH1=new Int32Array(MAXSTACK);this.uH2=new Int32Array(MAXSTACK);
    this.uFree=new Uint8Array(MAXSTACK);   /* 0 normal move, 1 free move of a piece, 2 free move that spawned a piece */
    this.uChk=new Uint8Array(MAXSTACK);    /* 1 if the move added a three-check check */
    this.setFen(fen||START_FEN);
  }
  fixKings(){
    this.ksq[0]=NOKING;this.ksq[1]=NOKING;
    for(let s=0;s<128;s++){if(s&0x88){s+=7;continue}const p=this.b[s];if((p&7)===KING)this.ksq[p>>3]=s}
  }
  /* an unchecked move: whatever stands on `to` is replaced; a missing mover is spawned */
  makeFree(m){
    const b=this.b,from=m&127,to=(m>>7)&127,sp=(m>>14)&7,us=this.turn,n=this.n++,pc=(from&0x88)?0:b[from];
    this.uM[n]=m;this.uCap[n]=b[to];this.uPc[n]=pc;this.uCas[n]=this.castle;this.uEp[n]=this.ep;this.uHalf[n]=this.half;this.uH1[n]=this.h1;this.uH2[n]=this.h2;
    this.uFree[n]=pc?1:2;this.uChk[n]=0;
    if(pc){b[from]=0;b[to]=sp?((pc&8)|sp):pc}else b[to]=(us<<3)|sp;
    this.castle&=this.cmask[from]&this.cmask[to];
    this.ep=-1;this.half=0;this.turn=us^1;
    if(us===1)this.full++;
    this.fixKings();this.computeHash();
    if(this.variant===V_3CHECK)this.countCheck(us,n);
  }
  unmakeFree(){
    const n=--this.n,m=this.uM[n],from=m&127,to=(m>>7)&127,b=this.b,us=this.turn^1;
    this.turn=us;
    if(this.uChk[n])this.checks[us]--;
    if(this.uFree[n]===1)b[from]=this.uPc[n];
    b[to]=this.uCap[n];
    this.castle=this.uCas[n];this.ep=this.uEp[n];this.half=this.uHalf[n];this.h1=this.uH1[n];this.h2=this.uH2[n];
    if(us===1)this.full--;
    this.fixKings();
  }
  setFen(fen){
    const parts=String(fen).trim().split(/\s+/);
    if(parts.length<2)throw new Error('Bad FEN');
    this.b.fill(0);this.n=0;this.checks=[0,0];
    let r=7,f=0,kings=[0,0];
    for(const ch of parts[0]){
      if(ch==='/'){r--;f=0;continue}
      if(ch>='1'&&ch<='8'){f+=+ch;continue}
      const i='pnbrqk'.indexOf(ch.toLowerCase());
      if(i<0||r<0||f>7)throw new Error('Bad FEN');
      const c=ch===ch.toUpperCase()?0:1,sq=r*16+f;
      this.b[sq]=(c<<3)|(i+1);
      if(i+1===KING){this.ksq[c]=sq;kings[c]++}
      f++;
    }
    if(kings[0]!==1||kings[1]!==1)throw new Error('Bad FEN: need one king per side');
    this.turn=parts[1]==='b'?1:0;
    /* castling: KQkq (outermost rook on that wing), or Shredder/X-FEN file letters (Chess960) */
    this.castle=0;this.crook.fill(-1);this.cmask.fill(15);this.c960Needed=false;
    const cs=parts[2]||'-';
    if(cs!=='-')for(const ch of cs){
      const c=ch===ch.toUpperCase()?0:1,base=c?0x70:0,k=this.ksq[c],R=(c<<3)|ROOK,up=ch.toUpperCase();
      if((k&0x70)!==base)continue;
      let rs=-1;
      if(up==='K'){for(let x=7;x>(k&7);x--)if(this.b[base+x]===R){rs=base+x;break}}
      else if(up==='Q'){for(let x=0;x<(k&7);x++)if(this.b[base+x]===R){rs=base+x;break}}
      else if(up>='A'&&up<='H'){const x=up.charCodeAt(0)-65;if(x!==(k&7)&&this.b[base+x]===R)rs=base+x}
      if(rs<0)continue;
      const i=c*2+((rs&7)>(k&7)?0:1);
      this.castle|=1<<i;this.crook[i]=rs;
      if((k&7)!==4||((rs&7)!==0&&(rs&7)!==7))this.c960Needed=true;
    }
    for(let i=0;i<4;i++)if(this.castle&(1<<i)){const c=i>>1;this.cmask[this.crook[i]]&=~(1<<i);this.cmask[this.ksq[c]]&=~(3<<(c*2))}
    this.ep=-1;
    if(parts[3]&&parts[3]!=='-'&&/^[a-h][36]$/.test(parts[3])){
      const e=nameSq(parts[3]),us=this.turn,dir=us===0?16:-16,pw=(us<<3)|PAWN;
      for(const k of[-1,1]){const s=e-dir+k;if(!(s&0x88)&&this.b[s]===pw)this.ep=e}
    }
    this.half=+parts[4]||0;this.full=+parts[5]||1;
    this.computeHash();
  }
  computeHash(){
    let h1=0,h2=0;
    for(let s=0;s<128;s++){if(s&0x88){s+=7;continue}const p=this.b[s];if(p){h1^=Z1[p][s];h2^=Z2[p][s]}}
    if(this.turn){h1^=ZS1;h2^=ZS2}
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    if(this.ep>=0){h1^=ZEP1[this.ep&7];h2^=ZEP2[this.ep&7]}
    if(this.variant===V_3CHECK){const a=Math.min(this.checks[0],3),c=4+Math.min(this.checks[1],3);h1^=ZK1[a]^ZK1[c];h2^=ZK2[a]^ZK2[c]}
    this.h1=h1;this.h2=h2;
  }
  fen(){
    let s='';
    for(let r=7;r>=0;r--){
      let e=0;
      for(let f=0;f<8;f++){
        const p=this.b[r*16+f];
        if(!p){e++;continue}
        if(e){s+=e;e=0}
        const ch=PCH[(p&7)-1];s+=(p>>3)?ch.toLowerCase():ch;
      }
      if(e)s+=e;if(r)s+='/';
    }
    let cs='';
    for(let i=0;i<4;i++){
      if(!(this.castle&(1<<i)))continue;
      const rs=this.crook[i],c=i>>1,w=i&1,base=c?0x70:0,R=(c<<3)|ROOK;
      let outer=true;   /* X-FEN: K/Q unless another rook stands further out on that wing */
      if(this.c960){if(w===0){for(let x=(rs&7)+1;x<8;x++)if(this.b[base+x]===R)outer=false}else{for(let x=0;x<(rs&7);x++)if(this.b[base+x]===R)outer=false}}
      const L=outer?(w?'Q':'K'):FILES[rs&7].toUpperCase();
      cs+=c?L.toLowerCase():L;
    }
    return s+' '+(this.turn?'b':'w')+' '+(cs||'-')+' '+(this.ep>=0?sqName(this.ep):'-')+' '+this.half+' '+this.full;
  }
  toUci(m){return uci(m,this.c960)}
  isAttacked(sq,by){
    const b=this.b,c=by<<3;let s,p;
    if(by===0){s=sq-15;if(!(s&0x88)&&b[s]===PAWN)return true;s=sq-17;if(!(s&0x88)&&b[s]===PAWN)return true}
    else{s=sq+15;if(!(s&0x88)&&b[s]===(8|PAWN))return true;s=sq+17;if(!(s&0x88)&&b[s]===(8|PAWN))return true}
    for(let i=0;i<8;i++){s=sq+KN_D[i];if(!(s&0x88)&&b[s]===(c|KNIGHT))return true}
    for(let i=0;i<8;i++){s=sq+K_D[i];if(!(s&0x88)&&b[s]===(c|KING))return true}
    for(let i=0;i<4;i++){const d=B_D[i];s=sq+d;while(!(s&0x88)){p=b[s];if(p){if(p===(c|BISHOP)||p===(c|QUEEN))return true;break}s+=d}}
    for(let i=0;i<4;i++){const d=R_D[i];s=sq+d;while(!(s&0x88)){p=b[s];if(p){if(p===(c|ROOK)||p===(c|QUEEN))return true;break}s+=d}}
    return false;
  }
  inCheck(){return this.isAttacked(this.ksq[this.turn],this.turn^1)}
  gen(capOnly){
    const b=this.b,us=this.turn,list=[];
    for(let sq=0;sq<128;sq++){
      if(sq&0x88){sq+=7;continue}
      const p=b[sq];
      if(!p||(p>>3)!==us)continue;
      const t=p&7;
      if(t===PAWN){
        const dir=us===0?16:-16,r=sq>>4,pr=us===0?6:1,sr=us===0?1:6,f=sq+dir;
        if(!(f&0x88)&&!b[f]){
          if(r===pr){
            list.push(sq|f<<7|QUEEN<<14);
            if(!capOnly){list.push(sq|f<<7|ROOK<<14,sq|f<<7|BISHOP<<14,sq|f<<7|KNIGHT<<14)}
          }else if(!capOnly){
            list.push(sq|f<<7);
            if(r===sr&&!b[f+dir])list.push(sq|(f+dir)<<7|FL_DBL<<17);
          }
        }
        for(let k=-1;k<=1;k+=2){
          const to=f+k;if(to&0x88)continue;
          const c=b[to];
          if(c&&(c>>3)!==us){
            const fl=FL_CAP<<17;
            if(r===pr){list.push(sq|to<<7|QUEEN<<14|fl);list.push(sq|to<<7|ROOK<<14|fl,sq|to<<7|BISHOP<<14|fl,sq|to<<7|KNIGHT<<14|fl)}
            else list.push(sq|to<<7|fl);
          }else if(!c&&to===this.ep)list.push(sq|to<<7|(FL_CAP|FL_EP)<<17);
        }
      }else if(t===KNIGHT||t===KING){
        const offs=t===KNIGHT?KN_D:K_D;
        for(let i=0;i<8;i++){
          const to=sq+offs[i];if(to&0x88)continue;
          const c=b[to];
          if(!c){if(!capOnly)list.push(sq|to<<7)}
          else if((c>>3)!==us)list.push(sq|to<<7|FL_CAP<<17);
        }
      }else{
        const dirs=t===BISHOP?B_D:t===ROOK?R_D:K_D,nd=t===QUEEN?8:4;
        for(let i=0;i<nd;i++){
          const d=dirs[i];let to=sq+d;
          while(!(to&0x88)){
            const c=b[to];
            if(!c){if(!capOnly)list.push(sq|to<<7)}
            else{if((c>>3)!==us)list.push(sq|to<<7|FL_CAP<<17);break}
            to+=d;
          }
        }
      }
    }
    if(!capOnly&&this.castle){
      /* generalized (Chess960) castling: king ends on g/c, rook on f/d; everything between must be empty
         apart from the two castling pieces; the king may not start in, pass through or land on an attacked square */
      const k=this.ksq[us],them=us^1,base=us?0x70:0;
      for(let w=0;w<2;w++){
        const i=us*2+w;
        if(!(this.castle&(1<<i))||k===NOKING)continue;
        const r=this.crook[i];
        if(b[r]!==((us<<3)|ROOK))continue;
        const kd=base+(w?2:6),rd=base+(w?3:5),lo=Math.min(k,kd,r,rd),hi=Math.max(k,kd,r,rd);
        let ok=true;
        for(let s=lo;s<=hi;s++)if(s!==k&&s!==r&&b[s]){ok=false;break}
        if(!ok)continue;
        const step=kd>k?1:-1;
        for(let s=k;;s+=step){if(this.isAttacked(s,them)){ok=false;break}if(s===kd)break}
        if(ok)list.push(k|r<<7|FL_CASTLE<<17);
      }
    }
    return list;
  }
  countCheck(us,n){
    if(!this.isAttacked(this.ksq[us^1],us))return;
    const c=this.checks[us],o=us*4+(c>3?3:c),k=us*4+(c+1>3?3:c+1);
    this.checks[us]=c+1;this.uChk[n]=1;
    this.h1^=ZK1[o]^ZK1[k];this.h2^=ZK2[o]^ZK2[k];
  }
  make(m){
    const fl=m>>17;
    if(fl&FL_FREE){this.makeFree(m);return}
    const b=this.b,from=m&127,to=(m>>7)&127,promo=(m>>14)&7,us=this.turn,them=us^1;
    const n=this.n++;
    this.uFree[n]=0;this.uChk[n]=0;
    this.uM[n]=m;this.uCas[n]=this.castle;this.uEp[n]=this.ep;this.uHalf[n]=this.half;this.uH1[n]=this.h1;this.uH2[n]=this.h2;
    let h1=this.h1,h2=this.h2;
    if(this.ep>=0){h1^=ZEP1[this.ep&7];h2^=ZEP2[this.ep&7]}
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    this.ep=-1;
    if(fl&FL_CASTLE){
      const K=b[from],R=b[to],base=from&0x70,ks=to>from,kd=base+(ks?6:2),rd=base+(ks?5:3);
      this.uCap[n]=0;
      b[from]=0;b[to]=0;b[kd]=K;b[rd]=R;
      h1^=Z1[K][from]^Z1[K][kd]^Z1[R][to]^Z1[R][rd];h2^=Z2[K][from]^Z2[K][kd]^Z2[R][to]^Z2[R][rd];
      this.ksq[us]=kd;
      this.castle&=this.cmask[from]&this.cmask[to];
      this.half++;
    }else{
      const pc=b[from],cap=b[to];
      this.uCap[n]=cap;
      b[from]=0;h1^=Z1[pc][from];h2^=Z2[pc][from];
      if(cap){h1^=Z1[cap][to];h2^=Z2[cap][to]}
      if(fl&FL_EP){
        const cs=to+(us===0?-16:16),cp=b[cs];
        b[cs]=0;h1^=Z1[cp][cs];h2^=Z2[cp][cs];this.uCap[n]=cp;
      }
      const placed=promo?((us<<3)|promo):pc;
      b[to]=placed;h1^=Z1[placed][to];h2^=Z2[placed][to];
      if((pc&7)===KING)this.ksq[us]=to;
      this.castle&=this.cmask[from]&this.cmask[to];
      if(fl&FL_DBL){
        const ep=(them<<3)|PAWN;
        if((!((to-1)&0x88)&&b[to-1]===ep)||(!((to+1)&0x88)&&b[to+1]===ep))this.ep=from+(us===0?16:-16);
      }
      this.half=((pc&7)===PAWN||cap||(fl&FL_EP))?0:this.half+1;
    }
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    if(this.ep>=0){h1^=ZEP1[this.ep&7];h2^=ZEP2[this.ep&7]}
    h1^=ZS1;h2^=ZS2;
    this.h1=h1;this.h2=h2;
    this.turn=them;
    if(us===1)this.full++;
    if(this.variant===V_3CHECK)this.countCheck(us,n);
  }
  unmake(){
    const n=this.n-1;
    if(this.uFree[n]){this.unmakeFree();return}
    this.n=n;
    const m=this.uM[n],from=m&127,to=(m>>7)&127,promo=(m>>14)&7,fl=m>>17,b=this.b,us=this.turn^1;
    this.turn=us;
    if(this.uChk[n])this.checks[us]--;
    if(fl&FL_CASTLE){
      const base=from&0x70,ks=to>from;
      b[base+(ks?6:2)]=0;b[base+(ks?5:3)]=0;b[from]=(us<<3)|KING;b[to]=(us<<3)|ROOK;
      this.ksq[us]=from;
    }else{
      let pc=b[to];
      if(promo)pc=(us<<3)|PAWN;
      b[from]=pc;
      if(fl&FL_EP){b[to]=0;b[to+(us===0?-16:16)]=this.uCap[n]}
      else b[to]=this.uCap[n];
      if((pc&7)===KING)this.ksq[us]=from;
    }
    this.castle=this.uCas[n];this.ep=this.uEp[n];this.half=this.uHalf[n];this.h1=this.uH1[n];this.h2=this.uH2[n];
    if(us===1)this.full--;
  }
  makeNull(){
    const n=this.n++;
    this.uFree[n]=0;this.uChk[n]=0;
    this.uM[n]=0;this.uEp[n]=this.ep;this.uHalf[n]=this.half;this.uH1[n]=this.h1;this.uH2[n]=this.h2;
    if(this.ep>=0){this.h1^=ZEP1[this.ep&7];this.h2^=ZEP2[this.ep&7];this.ep=-1}
    this.h1^=ZS1;this.h2^=ZS2;this.turn^=1;this.half++;
  }
  unmakeNull(){
    const n=--this.n;
    this.turn^=1;this.ep=this.uEp[n];this.half=this.uHalf[n];this.h1=this.uH1[n];this.h2=this.uH2[n];
  }
  legalMoves(){
    const ml=this.gen(false),out=[],us=this.turn;
    for(let i=0;i<ml.length;i++){
      this.make(ml[i]);
      if(!this.isAttacked(this.ksq[us],us^1))out.push(ml[i]);
      this.unmake();
    }
    return out;
  }
  hasLegal(){
    const ml=this.gen(false),us=this.turn;
    for(let i=0;i<ml.length;i++){
      this.make(ml[i]);
      const ok=!this.isAttacked(this.ksq[us],us^1);
      this.unmake();
      if(ok)return true;
    }
    return false;
  }
  /* accepts both castling spellings (king destination and king-takes-rook) */
  fromUci(s){
    s=String(s).trim().toLowerCase();
    const ml=this.legalMoves();
    for(let i=0;i<ml.length;i++)if(uci(ml[i],this.c960)===s)return ml[i];
    for(let i=0;i<ml.length;i++)if(((ml[i]>>17)&FL_CASTLE)&&uci(ml[i],!this.c960)===s)return ml[i];
    return 0;
  }
  san(m){
    const from=m&127,to=(m>>7)&127,promo=(m>>14)&7,fl=m>>17,p=(from&0x88)?0:this.b[from],t=p&7;
    if(fl&FL_FREE){
      if(!p)return PCH[promo-1]+'@'+sqName(to)+'?!';
      return(t===PAWN?'':PCH[t-1])+sqName(from)+(this.b[to]?'x':'-')+sqName(to)+(promo?'='+PCH[promo-1]:'')+'?!';
    }
    let s='';
    if(fl&FL_CASTLE)s=to>from?'O-O':'O-O-O';
    else{
      if(t!==PAWN){
        s+=PCH[t-1];
        let amb=false,sf=false,sr=false;
        const legal=this.legalMoves();
        for(const o of legal){
          const of=o&127;
          if(o!==m&&!((o>>17)&FL_CASTLE)&&((o>>7)&127)===to&&this.b[of]===p&&of!==from){amb=true;if((of&7)===(from&7))sf=true;if((of>>4)===(from>>4))sr=true}
        }
        if(amb){if(!sf)s+=FILES[from&7];else if(!sr)s+=((from>>4)+1);else s+=sqName(from)}
      }
      if(fl&FL_CAP){if(t===PAWN)s+=FILES[from&7];s+='x'}
      s+=sqName(to);
      if(promo)s+='='+PCH[promo-1];
    }
    this.make(m);
    const chk=this.inCheck(),has=this.hasLegal();
    this.unmake();
    return chk?s+(has?'+':'#'):s;
  }
  repCount(){
    let c=1;const lim=Math.max(0,this.n-this.half);
    for(let i=this.n-2;i>=lim;i-=2)if(this.uH1[i]===this.h1&&this.uH2[i]===this.h2)c++;
    return c;
  }
  isRep(){
    const lim=Math.max(0,this.n-this.half);
    for(let i=this.n-2;i>=lim;i-=2)if(this.uH1[i]===this.h1&&this.uH2[i]===this.h2)return true;
    return false;
  }
  insufficient(){
    if(this.variant===V_KOTH)return false;   /* a bare king can still walk to the hill */
    let minors=0,bishopCols=0,knights=0;
    for(let s=0;s<128;s++){
      if(s&0x88){s+=7;continue}
      const t=this.b[s]&7;
      if(!t||t===KING)continue;
      if(t===PAWN||t===ROOK||t===QUEEN)return false;
      minors++;
      if(t===KNIGHT)knights++;else bishopCols|=1<<(((s>>4)+(s&7))&1);
    }
    if(this.variant===V_3CHECK)return minors===0;   /* any piece can still give checks */
    if(minors<=1)return true;
    return knights===0&&(bishopCols===1||bishopCols===2);
  }
  /* {over,result,reason} for the side to move */
  status(){
    if(this.ksq[0]===NOKING)return{over:true,result:'0-1',reason:'king captured'};
    if(this.ksq[1]===NOKING)return{over:true,result:'1-0',reason:'king captured'};
    if(this.variant===V_KOTH)for(const c of[this.turn^1,this.turn])if(isHill(this.ksq[c]))return{over:true,result:c?'0-1':'1-0',reason:'king reached the hill'};
    if(this.variant===V_3CHECK)for(const c of[this.turn^1,this.turn])if(this.checks[c]>=3)return{over:true,result:c?'0-1':'1-0',reason:'three checks'};
    if(!this.hasLegal()){
      if(this.inCheck())return{over:true,result:this.turn?'1-0':'0-1',reason:'checkmate'};
      return{over:true,result:'1/2-1/2',reason:'stalemate'};
    }
    if(this.insufficient())return{over:true,result:'1/2-1/2',reason:'insufficient material'};
    if(this.repCount()>=3)return{over:true,result:'1/2-1/2',reason:'threefold repetition'};
    if(this.half>=100)return{over:true,result:'1/2-1/2',reason:'fifty-move rule'};
    return{over:false};
  }
}

function perft(pos,d){
  if(d===0)return 1;
  const ml=pos.gen(false),us=pos.turn;let n=0;
  for(let i=0;i<ml.length;i++){
    pos.make(ml[i]);
    if(!pos.isAttacked(pos.ksq[us],us^1))n+=d===1?1:perft(pos,d-1);
    pos.unmake();
  }
  return n;
}

/* ---------------- start positions ---------------- */
/* Chess960 back rank number n (0..959, Scharnagl numbering; 518 = RNBQKBNR) */
function backRank960(n){
  const r=new Array(8).fill('');
  r[2*(n%4)+1]='B';n=Math.floor(n/4);
  r[2*(n%4)]='B';n=Math.floor(n/4);
  const free=()=>r.map((x,i)=>x?-1:i).filter(i=>i>=0);
  r[free()[n%6]]='Q';n=Math.floor(n/6);
  const KN=[[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]][n];
  let f=free();r[f[KN[0]]]='N';r[f[KN[1]]]='N';
  f=free();r[f[0]]='R';r[f[1]]='K';r[f[2]]='R';
  return r.join('');
}
function fen960(nw,nb,castling){
  return backRank960(nb).toLowerCase()+'/pppppppp/8/8/8/8/PPPPPPPP/'+backRank960(nw)+' w '+(castling||'KQkq')+' - 0 1';
}

/* ---------------- evaluation ---------------- */
const PST_P=[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0];
const PST_N=[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50];
const PST_B=[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20];
const PST_R=[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0];
const PST_Q=[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20];
const PST_KM=[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20];
const PST_KE=[-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50];
const PASS=[0,5,10,20,35,60,100,0];
const KOTH_B=[400,120,45,15], CHK_B=[0,110,330,600];
const NPM=[0,0], kmg=[0,0], keg=[0,0], nbish=[0,0];
const wLo=new Int8Array(8), bHi=new Int8Array(8), wCnt=new Int8Array(8), bCnt=new Int8Array(8);
const wList=new Int16Array(16), bList=new Int16Array(16);
function hillDist(s){
  if(s===NOKING)return 3;
  const f=s&7,r=s>>4,df=f<3?3-f:f>4?f-4:0,dr=r<3?3-r:r>4?r-4:0;
  return df>dr?df:dr;
}

/* score from the side to move's point of view */
function evalFull(pos){
  const b=pos.b;
  let score=0,phase=0,pawns=0,majors=0,minors=0,wn=0,bn=0;
  wLo.fill(8);bHi.fill(-1);wCnt.fill(0);bCnt.fill(0);
  NPM[0]=0;NPM[1]=0;nbish[0]=0;nbish[1]=0;kmg[0]=kmg[1]=keg[0]=keg[1]=0;
  for(let sq=0;sq<128;sq++){
    if(sq&0x88){sq+=7;continue}
    const p=b[sq];if(!p)continue;
    const c=p>>3,t=p&7,r=sq>>4,f=sq&7,row=c===0?(7-r)*8+f:r*8+f;
    let v=0;
    switch(t){
      case PAWN:v=100+PST_P[row];pawns++;
        if(c===0){wCnt[f]++;if(r<wLo[f])wLo[f]=r;if(wn<16)wList[wn++]=sq}
        else{bCnt[f]++;if(r>bHi[f])bHi[f]=r;if(bn<16)bList[bn++]=sq}
        break;
      case KNIGHT:v=320+PST_N[row];phase+=1;NPM[c]+=3;minors++;break;
      case BISHOP:v=330+PST_B[row];phase+=1;NPM[c]+=3;minors++;nbish[c]++;break;
      case ROOK:v=500+PST_R[row];phase+=2;NPM[c]+=5;majors++;break;
      case QUEEN:v=900+PST_Q[row];phase+=4;NPM[c]+=9;majors++;break;
      case KING:kmg[c]=PST_KM[row];keg[c]=PST_KE[row];break;
    }
    score+=c===0?v:-v;
  }
  if(pos.variant===V_STD&&pawns===0&&majors===0&&minors<=1)return 0;
  for(let f=0;f<8;f++){
    if(wCnt[f]>1)score-=12*(wCnt[f]-1);
    if(bCnt[f]>1)score+=12*(bCnt[f]-1);
  }
  for(let i=0;i<wn;i++){
    const sq=wList[i],r=sq>>4,f=sq&7;let pass=true;
    for(let ff=f-1;ff<=f+1;ff++)if(ff>=0&&ff<8&&bHi[ff]>r){pass=false;break}
    if(pass)score+=PASS[r];
  }
  for(let i=0;i<bn;i++){
    const sq=bList[i],r=sq>>4,f=sq&7;let pass=true;
    for(let ff=f-1;ff<=f+1;ff++)if(ff>=0&&ff<8&&wLo[ff]<r){pass=false;break}
    if(pass)score-=PASS[7-r];
  }
  if(nbish[0]>=2)score+=30;
  if(nbish[1]>=2)score-=30;
  const ph=phase>24?24:phase;
  score+=(((kmg[0]-kmg[1])*ph+(keg[0]-keg[1])*(24-ph))/24)|0;
  if(pos.variant===V_KOTH)score+=KOTH_B[hillDist(pos.ksq[0])]-KOTH_B[hillDist(pos.ksq[1])];
  else if(pos.variant===V_3CHECK)score+=CHK_B[Math.min(pos.checks[0],3)]-CHK_B[Math.min(pos.checks[1],3)];
  return(pos.turn===0?score:-score)+10;
}

/* ---------------- search ---------------- */
const TT_BITS=20,TT_MASK=(1<<TT_BITS)-1;
const ttK1=new Int32Array(1<<TT_BITS),ttK2=new Int32Array(1<<TT_BITS),ttS=new Int16Array(1<<TT_BITS),ttD=new Int8Array(1<<TT_BITS),ttF=new Uint8Array(1<<TT_BITS),ttM=new Int32Array(1<<TT_BITS);
const killers=new Int32Array(MAXPLY*2), history=new Int32Array(2*128*128);
const ORDV=[0,1,3,3,5,9,0];
let nodes=0,stop=false,deadline=0;

/* the side to move has already lost by a variant rule (the opponent's king is on the hill / gave the third check) */
function lostByVariant(pos){
  const them=pos.turn^1;
  if(pos.variant===V_KOTH)return isHill(pos.ksq[them]);
  return pos.checks[them]>=3;
}
function scoreMove(pos,m,ttMove,ply){
  if(m===ttMove)return 1e7;
  const fl=m>>17,from=m&127,to=(m>>7)&127,promo=(m>>14)&7;
  if(fl&FL_CAP){const v=(fl&FL_EP)?PAWN:(pos.b[to]&7);return 1e6+ORDV[v]*16-(pos.b[from]&7)+(promo?500:0)}
  if(promo)return 9e5+promo;
  if(m===killers[ply*2])return 8e5;
  if(m===killers[ply*2+1])return 7e5;
  return history[(pos.turn<<14)|(from<<7)|to];
}
function qsearch(pos,alpha,beta,ply){
  if((++nodes&1023)===0&&Date.now()>deadline)stop=true;
  if(stop)return 0;
  if(pos.variant&&lostByVariant(pos))return -MATE+ply;
  const stand=evalFull(pos);
  if(ply>=MAXPLY-1)return stand;
  if(stand>=beta)return stand;
  if(stand>alpha)alpha=stand;
  const us=pos.turn,moves=pos.gen(true),sc=new Array(moves.length);
  for(let i=0;i<moves.length;i++)sc[i]=scoreMove(pos,moves[i],0,ply);
  for(let i=0;i<moves.length;i++){
    let bi=i;for(let j=i+1;j<moves.length;j++)if(sc[j]>sc[bi])bi=j;
    if(bi!==i){let t=moves[i];moves[i]=moves[bi];moves[bi]=t;t=sc[i];sc[i]=sc[bi];sc[bi]=t}
    const m=moves[i];
    if(!((m>>14)&7)){const v=(m>>17)&FL_EP?PAWN:(pos.b[(m>>7)&127]&7);if(stand+[0,100,320,330,500,900,0][v]+200<alpha)continue}
    pos.make(m);
    if(pos.isAttacked(pos.ksq[us],us^1)){pos.unmake();continue}
    const s=-qsearch(pos,-beta,-alpha,ply+1);
    pos.unmake();
    if(stop)return 0;
    if(s>=beta)return s;
    if(s>alpha)alpha=s;
  }
  return alpha;
}
function negamax(pos,depth,alpha,beta,ply,canNull){
  if((++nodes&1023)===0&&Date.now()>deadline)stop=true;
  if(stop)return 0;
  if(pos.variant&&lostByVariant(pos))return -MATE+ply;
  const us=pos.turn;
  if(pos.half>=100||pos.isRep())return 0;
  const inChk=pos.isAttacked(pos.ksq[us],us^1);
  if(inChk&&ply<MAXPLY-8)depth++;
  if(depth<=0)return qsearch(pos,alpha,beta,ply);
  if(ply>=MAXPLY-1)return evalFull(pos);
  const pv=beta-alpha>1,idx=pos.h1&TT_MASK;
  let ttMove=0;
  if(ttK1[idx]===pos.h1&&ttK2[idx]===pos.h2){
    ttMove=ttM[idx];
    if(ttD[idx]>=depth&&!pv){
      let s=ttS[idx];const f=ttF[idx];
      if(s>MATE-200)s-=ply;else if(s<-MATE+200)s+=ply;
      if(f===0||(f===1&&s>=beta)||(f===2&&s<=alpha))return s;
    }
  }
  if(canNull&&!inChk&&depth>=3&&!pv){
    const se=evalFull(pos);
    if(se>=beta&&NPM[us]>0){
      pos.makeNull();
      const s=-negamax(pos,depth-3,-beta,-beta+1,ply+1,false);
      pos.unmakeNull();
      if(stop)return 0;
      if(s>=beta)return s>=MATE-200?beta:s;
    }
  }
  const moves=pos.gen(false),sc=new Array(moves.length);
  for(let i=0;i<moves.length;i++)sc[i]=scoreMove(pos,moves[i],ttMove,ply);
  let best=-INF,bestMove=0,legal=0,flag=2;
  for(let i=0;i<moves.length;i++){
    let bi=i;for(let j=i+1;j<moves.length;j++)if(sc[j]>sc[bi])bi=j;
    if(bi!==i){let t=moves[i];moves[i]=moves[bi];moves[bi]=t;t=sc[i];sc[i]=sc[bi];sc[bi]=t}
    const m=moves[i];
    pos.make(m);
    if(pos.isAttacked(pos.ksq[us],us^1)){pos.unmake();continue}
    legal++;
    const quiet=!((m>>17)&FL_CAP)&&!((m>>14)&7);
    let s;
    if(legal===1)s=-negamax(pos,depth-1,-beta,-alpha,ply+1,true);
    else{
      let red=0;
      if(depth>=3&&legal>3&&quiet&&!inChk&&!pos.isAttacked(pos.ksq[pos.turn],us))red=legal>7?2:1;
      s=-negamax(pos,depth-1-red,-alpha-1,-alpha,ply+1,true);
      if(s>alpha&&red>0)s=-negamax(pos,depth-1,-alpha-1,-alpha,ply+1,true);
      if(s>alpha&&s<beta)s=-negamax(pos,depth-1,-beta,-alpha,ply+1,true);
    }
    pos.unmake();
    if(stop)return 0;
    if(s>best){
      best=s;bestMove=m;
      if(s>alpha){
        alpha=s;flag=0;
        if(s>=beta){
          flag=1;
          if(quiet){
            if(killers[ply*2]!==m){killers[ply*2+1]=killers[ply*2];killers[ply*2]=m}
            const hi=(us<<14)|((m&127)<<7)|((m>>7)&127),h=history[hi]+depth*depth;
            history[hi]=h>500000?500000:h;
          }
          break;
        }
      }
    }
  }
  if(legal===0)return inChk?-MATE+ply:0;
  ttK1[idx]=pos.h1;ttK2[idx]=pos.h2;ttD[idx]=depth>127?127:depth;ttF[idx]=flag;ttM[idx]=bestMove;
  ttS[idx]=best>MATE-200?best+ply:best<-MATE+200?best-ply:best;
  return best;
}

const LEVELS=[
  {name:'Beginner',depth:1,noise:260,time:600},
  {name:'Casual',depth:2,noise:130,time:1000},
  {name:'Club',depth:3,noise:45,time:2000},
  {name:'Strong',depth:64,noise:0,time:1500},
  {name:'Maximum',depth:64,noise:0,time:7000},
];

function search(pos,lv,onInfo){
  const t0=Date.now();
  nodes=0;stop=false;deadline=t0+lv.time;
  killers.fill(0);
  for(let i=0;i<history.length;i++)history[i]>>=1;
  const root=pos.legalMoves(),sign=pos.turn===0?1:-1;
  if(!root.length)return null;
  const pack=(m,s,d)=>{
    const mate=Math.abs(s)>MATE-200?Math.sign(s)*Math.ceil((MATE-Math.abs(s))/2)*sign:null;
    return{move:m,score:s*sign,mate,depth:d,nodes,ms:Date.now()-t0};
  };
  if(root.length===1)return pack(root[0],0,0);
  if(lv.noise>0){
    let best=root[0],bs=-1e9,bScore=0;
    deadline=t0+60000;
    for(const m of root){
      pos.make(m);
      const s=-negamax(pos,lv.depth-1,-INF,INF,1,true);
      pos.unmake();
      const noisy=s+(Math.random()*2-1)*lv.noise;
      if(noisy>bs){bs=noisy;best=m;bScore=s}
    }
    return pack(best,bScore,lv.depth);
  }
  root.sort((a,b)=>scoreMove(pos,b,0,0)-scoreMove(pos,a,0,0));
  let bestMove=root[0],bestScore=0,done=0;
  for(let d=1;d<=lv.depth&&d<MAXPLY-10;d++){
    let alpha=-INF,iterBest=0,iterScore=-INF;
    for(let i=0;i<root.length;i++){
      const m=root[i];
      pos.make(m);
      let s;
      if(i===0)s=-negamax(pos,d-1,-INF,-alpha,1,true);
      else{
        s=-negamax(pos,d-1,-alpha-1,-alpha,1,true);
        if(s>alpha&&!stop)s=-negamax(pos,d-1,-INF,-alpha,1,true);
      }
      pos.unmake();
      if(stop)break;
      if(s>alpha){alpha=s;iterBest=m;iterScore=s}
    }
    if(iterBest){
      bestMove=iterBest;bestScore=iterScore;
      const k=root.indexOf(iterBest);if(k>0){root.splice(k,1);root.unshift(iterBest)}
    }
    if(stop)break;
    done=d;
    if(onInfo)onInfo(pack(bestMove,bestScore,done));
    if(Math.abs(bestScore)>MATE-200&&d>=MATE-Math.abs(bestScore))break;
    if(Date.now()-t0>lv.time*0.45)break;
  }
  return pack(bestMove,bestScore,done);
}

export{Pos,START_FEN,FILES,PCH,PAWN,KNIGHT,BISHOP,ROOK,QUEEN,KING,FL_FREE,FL_CASTLE,V_STD,V_KOTH,V_3CHECK,SPAWN_SQ,NOKING,
  sqName,nameSq,uci,isHill,perft,evalFull,search,LEVELS,MATE,backRank960,fen960};
