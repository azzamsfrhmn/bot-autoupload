// ===== Scene interpreter: turns a JSON spec into frames =====
// Depends on engine.js, world.js, props.js, captions.js (same closure).

const LEAD = .02, DEF_PAD = .06;
const SLOT = { left:[-1.25,0,.5], center:[.55,0,.3], right:[1.85,0,.65], backleft:[-1.8,0,-.7], backright:[2.2,0,-.5], back:[.6,0,-1.1], front:[.4,0,1.1] };
const slotPos = a => Array.isArray(a) ? a : (SLOT[a] || SLOT.center);
const COLORS = { yellow:['#FFC83D','#22160A'], white:['#FFFFFF','#22160A'], red:['#FF5A4E','#FFFFFF'], green:['#4CB86A','#FFFFFF'], orange:['#FF8F2A','#FFFFFF'], dark:['#2A1B0B','#FFC83D'], blue:['#4A7FC1','#FFFFFF'] };
const SHOTS = {
  wide:{ t:[.3,1.45,.3], o:[.15,1.5,11.4] },
  medium:{ t:[.45,1.4,.3], o:[.15,1.4,9.0] },
  'close-center':{ anchor:'_C', ty:1.25, o:[.25,1.35,3.7] },
  'close-left':{ anchor:'_B', tx:.35, ty:1.6, o:[.9,.35,5.0] },
  'close-right':{ anchor:'_D', tx:-.35, ty:1.4, o:[-.8,.4,4.4] },
  low:{ t:[-.1,2.0,.2], o:[-.55,-1.0,8.9], fov:48, orbit:.5 },
  'side-left':{ t:[.1,1.3,.3], o:[-4.4,1.1,7.6] },
  'side-right':{ t:[.5,1.3,.3], o:[4.6,1.1,7.4] },
  high:{ t:[.4,.9,.2], o:[.6,5.2,6.4], fov:48 },
  street:{ t:[.3,1.7,.2], o:[.2,1.5,10.8] },
  up:{ t:[.3,2.45,-.4], o:[.4,-.9,6.2], fov:50, orbit:.6 },
  section:{ t:[.4,-1.1,3], o:[.0,.9,6.4], orbit:.4 },
  road:{ t:[.4,.9,.8], o:[3.4,.7,6.2] },
};
const GRAINS = { sand:['#FFFFFF','#F7ECD4','#EBD7AE','#FBF4E4','#DCC495','#F2E0BC'], salt:['#FFFFFF','#F4F8FF','#E8EEF8','#DDE6F2'], sugar:['#FFFFFF','#FFF9EE','#F3EBDD'], soil:['#8E6236','#A87A45','#6E4A2A','#B98950'], ice:['#E8F7FF','#CFEFFF','#FFFFFF'], metal:['#B8BEC8','#8D949E','#D6DBE2'] };

function setEnvMood(m){
  if(m==='day')Object.assign(ENV,{shadows:true,light:norm([-.62,.66,.3]),amb:.5,dif:.62,tint:[1,1,1],fogc:[205,236,250],fog0:12,fog1:120,fogmax:.85});
  if(m==='dusk')Object.assign(ENV,{shadows:true,light:norm([.6,.55,.4]),amb:.45,dif:.62,tint:[1.06,.86,.78],fogc:[240,170,130],fog0:10,fog1:110,fogmax:.8});
  if(m==='studio')Object.assign(ENV,{shadows:true,light:norm([-.5,.8,.6]),amb:.56,dif:.55,tint:[1,1,1],fogc:[0,0,0],fog0:1e3,fog1:2e3,fogmax:0});
}
function titleSegs(str){ if(!str)return[]; const out=[]; str.split(' ').forEach(w=>{const hl=w.startsWith('*'),x=w.replace(/\*/g,'');const l=out[out.length-1];if(l&&l.hl===hl&&hl)l.txt+=' '+x;else if(l&&!l.hl&&!hl)l.txt+=' '+x;else out.push({hl,txt:x})}); return out.map(s=>(s.hl?'*':'')+s.txt); }
function pillCol(c){ return COLORS[c] || COLORS.yellow; }
function dotsW(pts,col,k=1){ctx.fillStyle=col;pts.forEach(p=>{const pr=project(p);if(pr[2]>.1){ctx.beginPath();ctx.arc(pr[0],pr[1],Math.max(2,.035*pr[3]*k),0,7);ctx.fill()}})}
function pillAt3(txt,p,bg,fg,size,k=1){const q=project(p);if(q[2]<.1)return;ctx.save();ctx.translate(q[0],q[1]);ctx.scale(k,k);pill(txt,0,0,bg,fg,size);ctx.restore()}
function shotCam(sc,lt,tm){
  const sh=SHOTS[sc.shot]||SHOTS.wide;let t=sh.t?sh.t.slice():null;
  if(!t){const a=sc._anch[sh.anchor]||slotPos('center');t=[a[0]+(sh.tx||0),sh.ty,a[2]]}
  const k=eio(lt/sc.dur),dir=(sc.i%2?1:-1);
  let o=scl(sh.o,(1-.2*k)*(sc.zoom||1));
  const orb=dir*lerp(-.14,.14,k)*(sh.orbit??1),c=Math.cos(orb),sn=Math.sin(orb);o=[o[0]*c+o[2]*sn,o[1],-o[0]*sn+o[2]*c];
  const sw=[Math.sin(tm*.9)*.03,Math.sin(tm*1.3)*.025,0];
  setCam(add(add(t,o),sw),t,sh.fov||46);
}
// pilih shot otomatis supaya tidak monoton (shot sama berturut-turut diganti)
function propNearCenter(s){return(s.props||[]).some(p=>{const P=p.pos||(p.at?slotPos(p.at):SLOT.center);return Math.abs(P[0]-.55)<.7&&P[2]>-1.3&&P[2]<1.0&&!['palm','rock','bush','pyramids'].includes(p.type)})}
function charNearCenter(s){return[['bongo','left'],['dodo','right']].some(([k,sl])=>{const c=s[k];if(!c||c.hide)return false;if(c.action&&c.to)return true;const P=c.pos||slotPos(c.at||sl);return Math.abs(P[0]-.55)<1.3})}
function autoShot(s,prev,prev2){
  if(s.type||s.lockShot)return s.shot||'wide';let sh=s.shot||'medium';
  const info0=(s.pills||[]).some(p=>p.at&&!['bongo','dodo'].includes(p.at));
  if(sh==='low'&&!(s.props||[]).some(p=>p.type==='thermometer'))sh=s.who==='D'?'side-right':'side-left';
  if(info0&&sh==='close-left')sh='side-left';if(info0&&sh==='close-right')sh='side-right';
  if(sh!==prev&&!(sh==='close-center'&&(charNearCenter(s)||!propNearCenter(s))))return sh;
  const bh=!s.bongo||s.bongo.hide||s.bongo.action,dh=!s.dodo||s.dodo.hide||s.dodo.action,cen=propNearCenter(s)&&!charNearCenter(s);
  const info=(s.pills||[]).some(p=>p.at&&!['bongo','dodo'].includes(p.at))||(s.effects||[]).some(e=>!['question','sweat','haha'].includes(e.type));
  const hasCab=(s.props||[]).some(p=>p.type==='cables'),hasSec=(s.props||[]).some(p=>p.type==='duct');
  if(s.who==='N'){let o2=[hasSec?'section':null,hasCab?'up':null,'side-right','high','street','side-left','medium'];o2=o2.filter(o=>o&&o!==prev&&o!==prev2);return o2[0]||sh}
  let opts=s.who==='B'?[bh||info?null:'close-left',s.bongo&&s.bongo.action?null:'side-left',cen?'close-center':'high','wide']:s.who==='D'?[dh||info?null:'close-right',s.dodo&&s.dodo.action?null:'side-right',cen?'close-center':'high','medium']:['wide','high','medium'];
  if(s.thermo)opts=['low'];
  opts=opts.filter(o=>o&&o!==prev&&o!==prev2);return opts[0]||sh;
}
function wordTime(sc,w,def){ if(w==null)return def; const x=sc.words.find(x=>x.disp.toLowerCase().startsWith(String(w).toLowerCase())); return x?x.t:def; }

// ---------- props ----------
function propPos(p,sc){ if(p.pos)return p.pos; if(p.on&&sc._anch[p.on]){const a=sc._anch[p.on];return[a[0],0,a[2]]} return slotPos(p.at||'center'); }
function drawProp(p,sc,lt,t){
  const P=propPos(p,sc),x=P[0],z=P[2],id=p.id||p.type;let anchor=[x,1,z];
  const k=p.appear?back(lt/.45):1, wt=w=>wordTime(sc,w,sc.start);
  switch(p.type){
    case 'campfire':campfire(x,z,t,p.scale||1);anchor=[x,.6,z];
      if(sc._fireBoost>0)bb([x,.05,z],(X,Y,s)=>fire2d(X,Y,s*.0034*(1+.6*sc._fireBoost+.15*Math.sin(t*20)),t*1.8),{bias:-.07});break;
    case 'slab':{let pile=p.pile??.5;if(p.grow)pile*=eo((lt-.5)/1.8);slab(x,z,pile);anchor=[x,.9+pile,z];break}
    case 'sandpile':sandCone(x,p.y||0,z,(p.r||.8)*k,(p.h||.7)*k);anchor=[x,(p.y||0)+(p.h||.7),z];break;
    case 'furnace':{const heat=p.heatUp?.35+.65*eo(lt/sc.dur):(p.heat??1);furnace(x,z,t,heat,k);anchor=[x,1.0,z];break}
    case 'crucible':{const st=(p.changeTo&&t>wt(p.word))?p.changeTo:(p.state||'sand');const top=crucible(x,z,st,t);sc._crState=st;anchor=top;break}
    case 'bellows':{const open=sc._pumping?.5+.5*Math.sin(t*7):.3;bellows(x,z,open,t);anchor=[x,.85,z];break}
    case 'bucket':addMesh(mul(T(x,0,z),S(.34,.44,.34)),cyl(12,1.15),p.color||'#4A7FC1');if(p.water!==false)ellipseFace(x,.445,z,.37,.37,'#8FD3F0',{L:2,bias:-.3});anchor=[x,.45,z];break;
    case 'table':addMesh(mul(T(x,.42,z),S(p.w||1.0,.84,p.d||.7)),cube(),p.color||'#8D8F94');anchor=[x,.84,z];break;
    case 'pedestal':addMesh(mul(T(x,.35,z),S(.7,.7,.7)),cube(),p.color||'#FFFFFF');anchor=[x,.7,z];break;
    case 'vase':{const base=p.on&&sc._anch[p.on]?sc._anch[p.on][1]:0,s=(p.scale||1)*k;vase(x,base,z,s,p.color||'#9FE3C9',{a:p.alpha??.85});anchor=[x,base+.5*s,z];break}
    case 'oven':{const kk=eo(lt/sc.dur),g=p.cool?1-kk*.85:1;oven(x,z,t,g);anchor=[x,1.85,z];sc._ovenTemp=p.tempFrom!=null?Math.round(lerp(p.tempFrom,p.tempTo??30,kk)):null;break}
    case 'thermometer':sc._thermo={p,x,z,th:thermo3(sc,t,x,z,p)};anchor=[x,3.5,z];break;
    case 'pyramids':{const kk=t>wt(p.word)?back((t-wt(p.word))/.5):(p.word?0:1);pyramid(-2.3,-4.4,.9,kk);pyramid(-.9,-4.6,1.25,kk);pyramid(2.6,-4.4,.8,kk);anchor=[-.9,1.9,-4.6];sc._pyrK=kk;break}
    case 'bag':bag(x,.26,z,p.color||'#D8C39A');anchor=[x,.6,z];break;
    case 'pole':{const P=pole(x,z,p.h||3.4);sc._poles[id]=P;anchor=[x,(p.h||3.4)-.6,z+.1];break}
    case 'cables':{const A=sc._poles[p.from||'poleA'],B=sc._poles[p.to||'poleB'];if(A&&B)cablesBetween(A,B,{power:p.power,n:p.n,colors:p.colors,dead:p.dead,messy:p.messy,seed:p.seed},t);anchor=A&&B?[(A.top[0]+B.top[0])/2,2.4,A.top[2]]:[x,2.4,z];break}
    case 'drop':{const P=sc._poles[p.from||'poleB'];if(P)dropToHouse(P,p.houseX??(P.top[0]+.8),p.color,p.y);anchor=P?[(P.top[0]+(p.houseX??P.top[0]+.8))/2,1.9,-.7]:[x,1.9,z];break}
    case 'wire':if((sc.props||[]).some(q=>q.type==='motorbike'&&q.crash&&(q.cable||'juntai')===id)){anchor=vl(p.a,p.b,.5);anchor[1]-=(p.sag??.5);break}wire(p.a,p.b,p.sag??.5,p.color||'#2B2B31',p.w||.03);anchor=vl(p.a,p.b,.5);anchor[1]-=(p.sag??.5);break;
    case 'house':house(x,z,p.color||'#F2C28B',p.roof||'#B5523B',p.scale||1);anchor=[x,1.7,z];break;
    case 'odp':{const P=sc._poles[p.on||'poleA'],px=P?P.top[0]:x,pz=P?P.top[2]:z,y=p.y||2.0;odp(px,y,pz,p.color);anchor=[px,y,pz+.2];break}
    case 'trafo':{const P=sc._poles[p.on||'poleA'],px=P?P.top[0]:x,pz=P?P.top[2]:z;trafo(px,pz);anchor=[px,2.5,pz+.3];break}
    case 'motorbike':{if(p.crash){anchor=motorCrash(p,sc,lt,t);break}const k2=clamp(lt/sc.dur),mx=lerp(p.fromX??-4.5,p.toX??4.5,k2),mz=p.z??.95;motorbike(mx,mz,t,p.color);anchor=[mx,1.05,mz];break}
    case 'excavator':excavator(x,z,t,p.dig??1);anchor=[x,1.2,z];break;
    case 'duct':{const y=p.y??-.9;ductSection(x,y,3.0,p.n||6,p.colors);anchor=[x,y,3.1];break}
    case 'trench':trench(x-(p.w||2)/2,x+(p.w||2)/2,(p.z0??1.0),(p.z1??3.0));anchor=[x,.1,2];break;
    case 'model':{const def=SPEC.models&&SPEC.models[p.name];const base=p.on&&sc._anch[p.on]?sc._anch[p.on][1]:(p.y||0),sc_=(p.scale||1)*k;drawModel(def,mul(T(x,base,z),Ry(p.ry||0),S(sc_)),t,p.anim||{},sc);anchor=[x,base+(def?modelHeight(def):.5)*sc_,z];break}
    case 'item':{const base=p.on&&sc._anch[p.on]?sc._anch[p.on][1]:(p.y||0),sc_=(p.scale||1)*k;showcaseItem(p.item||'box',mul(T(x,base,z),Ry(p.ry||0),S(sc_)),p.color);anchor=[x,base+.5*sc_,z];break}
    case 'palm':palm(x,z,p.scale||1,0,t);anchor=[x,2.8,z];break;
    case 'rock':rock(x,z,p.scale||.3,3);anchor=[x,.3,z];break;
    case 'bush':bush(x,z,p.scale||.9);anchor=[x,.5,z];break;
    case 'shape':{const sh=p.shape||'box',sz=p.size||[.5,.5,.5],m=mul(T(x,(p.y||0)+(sh==='box'||sh==='sphere'?sz[1]/2:0),z),Ry(p.ry||0),S(sz[0]*k,sz[1]*k,sz[2]*k));
      addMesh(sh==='box'?mul(m):sh==='sphere'?mul(m,S(.5)):m,sh==='box'?cube():sh==='sphere'?sph(12,8):sh==='cone'?cyl(12,0):cyl(12,p.taper??1),p.color||'#C9A06A',{em:p.glow,a:p.alpha??1});
      anchor=[x,(p.y||0)+sz[1],z];break}
  }
  sc._anch[id]=anchor;
}
function thermo3(sc,t,X,Z,p){
  const max=p.max||1800,yv=v=>.45+v/max*3.0;
  addMesh(mul(T(X+.12,1.95,Z-.12),S(1.0,3.8,.08)),cube(),'#F5EBDD');
  for(let v=0;v<=max;v+=max/6)addMesh(mul(T(X+.32,yv(v),Z-.06),S(.16,.025,.02)),cube(),'#2A1B0B',{bias:-.1});
  const tm=wordTime(sc,p.riseWord,sc.start+.3)-.2,cur=t<tm?0:(p.value||0)*eo((t-tm)/1.1);
  addMesh(mul(T(X,.35,Z),S(.09,Math.max(.01,yv(cur)-.35),.09)),cyl(10),'#E8452C',{em:1});addMesh(mul(T(X,.3,Z),S(.28)),sph(12,8),'#E8452C');
  addMesh(mul(T(X,.35,Z),S(.17,3.35,.17)),cyl(12),'#FFFFFF',{a:.42,bias:-.2});
  const tg=wordTime(sc,p.targetWord,sc.start+.2)-.15,yt=yv(p.target||0);
  if(p.target&&t>tg)addMesh(mul(T(X-.3,yt,Z+.05),S(1.6*eo((t-tg)/.3),.035,.035)),cube(),'#FF5A4E',{em:1,bias:-.3});
  return{yv,tm,tg,yt,max};
}
function thermoOverlay(sc,t){
  const o=sc._thermo;if(!o)return;const {p,x:X,z:Z,th}=o,u=p.unit||'°C';
  ctx.font='800 28px Inter, sans-serif';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle='#2A1B0B';
  for(let v=0;v<=th.max;v+=th.max/6){const q=project([X+.45,th.yv(v),Z-.06]);ctx.fillText(Math.round(v)+'°',q[0],q[1])}
  if(p.target&&t>th.tg){ctx.save();ctx.globalAlpha=eo((t-th.tg)/.3);pillAt3(p.targetLabel||('TARGET '+p.target+u),[X-.95,th.yt+.22,Z],'#FF5A4E','#fff',32);ctx.restore()}
  if(t>th.tm+.6){ctx.save();ctx.globalAlpha=eo((t-th.tm-.6)/.3);pillAt3(p.valueLabel||(p.value+u),[X-.75,th.yv(p.value||0),Z],'#FFC83D','#22160A',32);ctx.restore()}
  if(p.gapLabel){const tk=wordTime(sc,p.gapWord,th.tm+1.5);if(t>tk){const q=project([X-.8,th.yv(((p.value||0)+(p.target||0))/2),Z]),kk=back((t-tk)/.3);ctx.save();ctx.translate(q[0],q[1]);ctx.scale(kk,kk);ctx.rotate(-.06);pill(p.gapLabel,0,0,'#fff','#E8452C',40);ctx.restore()}}
}

// ---------- characters ----------
const CH={B:{fn:(r,p,t)=>bongo(r,p,t),key:'bongo',slot:'left',ry:.45,reach:1.85,hold:[0,1.3,.82],arms:[1.25,-.45]},
          D:{fn:(r,p,t)=>dodo(r,p,t),key:'dodo',slot:'right',ry:-.5,reach:.95,hold:[0,1.28,.62],arms:[1.5,-.3]}};
function poseFor(name,t,lt,k){
  const s=Math.sin;switch(name){
    case 'wave':return{aR:[2.7+.25*s(t*8),.35]};
    case 'laugh':return{bob:Math.abs(s(t*13))*.05,hp:.22,aL:[.55,-.4],aR:[.55,-.4],mouth:'o'};
    case 'shrug':return{aL:[.3*k,1.0*k+.18],aR:[.3*k,1.0*k+.18],hr:.15*k,mouth:'flat',brow:1};
    case 'point':return{aR:[1.55,-.2]};
    case 'point-up':return{aR:[2.5,.15],hp:.25};
    case 'present':return{aR:[1.9,.35],hy:-.2};
    case 'cheer':return{aL:[2.9,.4],aR:[2.9,.4],bob:Math.abs(s(t*9))*.12};
    case 'think':return{aR:[2.15,-.75],hr:.12,hy:-.15};
    case 'facepalm':return{aR:[2.6,-.65],mouth:'flat'};
    case 'surprised':return{mouth:'o',aL:[.3,.5],aR:[.3,.5],hp:-.05};
    case 'lookup':return{hp:.42,mouth:'o'};
    case 'lookdown':return{hp:-.45,lean:.3,aL:[.5,-.1],aR:[.5,-.1]};
    case 'headshake':return{hy:s(t*7)*.3,mouth:'flat'};
    case 'wipe':return{aR:[2.75,-.35],brow:1};
    case 'handsonhead':return{aL:[2.85,-.65],aR:[2.85,-.65],mouth:'o',brow:1};
    case 'shield':return{aL:[2.3*k,-.5],aR:[2.3*k,-.5],mouth:'o'};
    case 'yawn':return{mouth:s(t*1.5)>.3?'o':'grin',hr:.15};
    case 'nod':return{hp:s(t*6)*.12};
    default:return{bob:Math.sin(t*2)*.012};
  }
}
function drawChar(who,c,sc,lt,t){
  if(!c||c.hide)return;const C=CH[who];let pos=c.pos?slotPos(c.pos):slotPos(c.at||C.slot);let ry=c.ry??C.ry;
  const talk=sc.talking(who,lt),after=clamp((lt-sc.end-.05)/.4);
  let tgt=c.to?(sc._anch[c.to]||slotPos(c.to)):null;
  const act=c.action;
  if(act&&tgt&&['pour','blow','blowpipe','dip','pump'].includes(act)){
    const side=tgt[0]>=pos[0]?1:-1;ry=side*PI/2+(c.turn||0);
    if(act==='pour'&&!c.pos)pos=[tgt[0]-side*C.reach,0,tgt[2]+.25];
    if(act==='pump'&&!c.pos)pos=[tgt[0]-side*1.15,0,tgt[2]];
    if(act==='blow'&&!c.pos)pos=[tgt[0]-side*1.55,0,tgt[2]+.1];
  }
  if(c.face==='center'){const cc=sc._anch.center||SLOT.center;ry=Math.atan2(cc[0]-pos[0],(cc[2]+3)-pos[2])}
  const kk=eo(lt/.35);let pose=Object.assign({},poseFor(c.pose,t,lt,kk));
  let root=mul(T(...pos),Ry(ry));let extra=null;
  if(act==='pour'){const tilt=lt<(c.pourEnd??2.2)?lerp(.2,1.85,eo((lt-.2)/.6)):lerp(1.85,.2,eo((lt-(c.pourEnd??2.2))/.5));Object.assign(pose,{aL:[C.arms[0],C.arms[1]],aR:[C.arms[0],C.arms[1]],lean:.08});extra={tilt}}
  if(act==='dig'){const d=digState(lt);Object.assign(pose,{aL:[1.05,-.25],aR:[.75,-.12],lean:d.lean,hp:-.2-d.lean*.4});extra={dig:d};if(!c.ry&&!c.face)root=mul(T(...pos),Ry(pos[0]>.5?-PI/2:PI/2))}
  if(act==='pump'){const pump=.5+.5*Math.sin(t*7);Object.assign(pose,who==='B'?{lean:.42,aL:[.7+.3*pump,-.35],aR:[.7+.3*pump,-.35],hp:-.2}:{lean:.3,aL:[.6+.3*pump,-.2],aR:[.6+.3*pump,-.2]});sc._pumping=true}
  if(act==='blow'){Object.assign(pose,{lean:.55*after,hp:-.3*after,mouth:after>0?'o':pose.mouth});sc._fireBoost=Math.max(sc._fireBoost,after)}
  if(act==='blowpipe'){Object.assign(pose,{aL:[1.35,-.45],aR:[1.15,-.35],mouth:after>0?'o':pose.mouth})}
  if(act==='dip'){Object.assign(pose,{lean:.3,aR:[1.1,-.2],aL:[.3,.2]})}
  if(!c.pose||c.pose==='idle'){if(talk&&!act){const g=Math.sin(t*4.2+(who==='B'?0:1.7));pose.aR=[.45+.35*Math.max(0,g),.25];pose.aL=[.2+.2*Math.max(0,-g),.2];pose.hy=Math.sin(t*1.7)*.15}
    else if(!talk&&!act){const other=who==='B'?'D':'B';if(sc.talking(other,lt)){const op=sc._anch['_'+other]||slotPos(other==='B'?'left':'right');pose.hy=clamp(Math.atan2(op[0]-pos[0],op[2]-pos[2]+.001)-ry,-.7,.7)*.8;pose.hp=-.05}}}
  pose.talk=talk;const R=C.fn(root,pose,t);sc._anch[C.key]=R.head;sc._chars[who]={R,root,pos,ry};
  // held items
  if(act==='pour'){const bm=mul(root,T(...C.hold),Rx(extra.tilt));
    if((c.item||'bucket')==='bucket'){addMesh(mul(bm,T(0,-.2,0),S(.24,.4,.24)),cyl(10,1.25),c.itemColor||'#4A7FC1');addMesh(mul(bm,T(0,.19,0),S(.31,.04,.31)),cyl(10),'#3A6AA6')}
    else bag(...ap(bm,[0,0,0]),c.itemColor||'#E9E4D6',0,extra.tilt*.8*(ry>0?-1:1));
    sc._post.push(()=>{const pe=c.pourEnd??2.2;if(lt>.4&&lt<pe+.2){const m=ap(bm,[0,.22,0]),tp=tgt,r=rng(5),pts=[];for(let i=0;i<30;i++){const p=((lt*1.6+r())%1),q=vl(m,tp,p);q[1]+=Math.sin(p*PI)*.15-p*p*.05;q[0]+=(r()-.5)*.07;q[2]+=(r()-.5)*.07;pts.push(q)}dotsW(pts,c.color||'#F6DCA6',c.chunky?1.6:.9)}
      if(c.label&&lt>.3&&lt<pe+.3){const [bg,fg]=pillCol('white');pillAt3(c.label,add(ap(bm,[0,0,0]),[0,.55,0]),bg,fg,30,back((lt-.3)/.3))}});}
  if(act==='dig'){const cpt=drawShovel(root,extra.dig.tip,extra.dig.load);
    if(lt>1.05){ellipseFace(cpt[0],.005,cpt[2],.32,.22,'#B8894F',{L:1});ellipseFace(cpt[0],.007,cpt[2],.22,.15,'#8E6236',{L:1})}sc._anch.shovel=add(cpt,[0,.75,0]);
    sc._post.push(()=>{if(lt>.9&&lt<1.7){const kq=(lt-.9)/.8,pts=[];for(let i=0;i<16;i++){const a=i/16*2*PI;pts.push([cpt[0]+Math.cos(a)*(.15+kq*.45),.05+Math.sin(kq*PI)*.5*(.6+.4*Math.sin(i*3)),cpt[2]+Math.sin(a)*(.15+kq*.45)])}dotsW(pts,'#F6DCA6')}})}
  if(act==='blowpipe'){const m=ap(R.Hd,who==='B'?[0,-.19,.33]:[0,-.14,.34]),side=ry>0?1:-1,e=add(m,[1.55*side,-.3,0]);addMesh(basisY(m,e,.035),cyl(6),'#6E7480');
    const r=.08+.28*eo(after/1.2*.4+clamp((lt-sc.end)/1.2));addMesh(mul(T(e[0]+r*.8*side,e[1]-.02,e[2]),S(r)),sph(12,8),c.color||'#FFA040',{em:1,bias:-.1});
    sc._post.push(()=>{const q=project([e[0]+r*.8*side,e[1],e[2]]);glow2d(q[0],q[1],r*q[3]*2.5,.5)})}
  if(act==='blow'&&after>0&&tgt){sc._post.push(()=>{const p=project(ap(R.Hd,[0,-.18,.45])),q=project([tgt[0]-.15,.5,tgt[2]]);windLines(p[0],p[1],q[0],q[1],t)})}
}
function digState(lt){let tip,lean,load=0;
  if(lt<1.0){tip=lerp(.6,.02,eio(lt/1.0));lean=lerp(0,.32,eio(lt/1.0))}else if(lt<1.3){tip=.02;lean=.32}
  else{const k=eo((lt-1.3)/1.1);tip=lerp(.02,.8,k);lean=lerp(.32,-.05,k);load=eo((lt-1.3)/.35)}return{tip,lean,load}}
function drawShovel(root,tip,load){
  const a=ap(root,[.05,1.28,.18]),b=ap(root,[.05,tip+.44,.98]),c=ap(root,[.05,tip,1.07]);
  addMesh(basisY(a,b,.035),cyl(6),'#A06C38');addMesh(mul(basisY(c,b,1),T(0,.5,0),S(.34,1,.05)),cube(),'#7D8794');
  addMesh(mul(basisY(c,b,1),T(0,1.02,0),S(.1,.12,.08)),cube(),'#3A414A');
  if(load>0)sandCone(...vl(c,b,.35).map((v,i)=>i==1?v+.02:v),.2*load,.18*load);return c}

// ---------- effects (pre: add meshes before flush; post: 2D after flush) ----------
function effectPre(e,sc,lt,t){
  if(e.type==='dip'){const a=sc._anch[e.on||'bucket'];if(!a)return;const t1=wordTime(sc,e.word,sc.start+.8),t2=wordTime(sc,e.dissolveWord,1e9);
    const dip=eo((t-t1)/.5),shr=t>t2?1-eo((t-t2)/1.0)*.75:1,hot=t<t1,y=lerp(a[1]+.8,a[1]+.05,dip);
    addMesh(mul(T(a[0]+.02,y,a[2]),S(.16*shr)),sph(10,8),hot?'#FF9A33':(e.color||'#BDEFE6'),{em:hot,a:hot?1:.85,bias:-.4});
    if(t>t2)sc._post.push(()=>{const q=project([a[0],a[1]+.1,a[2]]),r=rng(3);ctx.fillStyle='rgba(220,255,250,.85)';for(let i=0;i<14;i++){const p=((t*.9+r())%1);ctx.beginPath();ctx.arc(q[0]+(r()-.5)*80,q[1]-p*60,4+r()*5,0,7);ctx.fill()}})}
  if(e.type==='question'){const who=e.on||'bongo';const st=wordTime(sc,e.word,sc.start+.3);sc._post.push(()=>{const h=sc._anch[who];if(!h||t<st)return;const q=project(add(h,[e.dx??.75,e.dy??.25,0]));ctx.save();bubble2d(q[0],q[1],back((t-st)/.3)*q[3]*.003,e.text||'?');ctx.restore()})}
}
function effectPost(e,sc,lt,t){
  const A=n=>sc._anch[n]||slotPos(n);
  switch(e.type){
    case 'sweat':{const q=project(A(e.on||'bongo'));sweat2d(q[0]+60,q[1]+30,1,t);break}
    case 'haha':{if(lt<.4)break;const q=project(add(A(e.on||'bongo'),[.55,.2,0]));ctx.save();ctx.translate(q[0],q[1]);ctx.rotate(.15+Math.sin(t*12)*.05);ctx.font='900 64px Inter, sans-serif';ctx.lineWidth=10;ctx.strokeStyle='#2A1B0B';ctx.strokeText(e.text||'HA HA!',0,0);ctx.fillStyle='#FFC83D';ctx.fillText(e.text||'HA HA!',0,0);ctx.restore();break}
    case 'sparkles':{const q=project(A(e.on||'center'));sparkles(q[0],q[1],q[3]*.8,t,12);break}
    case 'glow':{const q=project(A(e.on||'crucible'));glow2d(q[0],q[1],q[3]*(e.size||.9),.55);break}
    case 'bubbles':{const a=A(e.on||'crucible'),q=project(a),rx=(e.r||.3)*q[3],n=e.fade?Math.round((e.count||26)*(1-eo(lt/sc.dur)))+1:(e.count||28);glow2d(q[0],q[1],rx*2.2,.5);bubbles2d(q[0],q[1],rx,rx*.42,t,n,q[3]/700);break}
    case 'cracks':{const a=A(e.on||'vase'),q=project([a[0],a[1]+.15,a[2]+.05]),st=wordTime(sc,e.word,sc.start+.15);cracks2d(q[0],q[1],q[3]/650,eo((t-st)/.9));break}
    case 'temp':{if(sc._ovenTemp!=null)pillAt3(sc._ovenTemp+'°C',A(e.on||'oven'),'#FF8F2A','#fff',36);break}
  }
}
function drawPills(sc,lt,t){
  (sc.pills||[]).forEach(p=>{const st=wordTime(sc,p.word,sc.start+(p.delay??.3))-.05;if(t<st)return;if(p.until&&t>wordTime(sc,p.until,1e9))return;
    const k=back((t-st)/.3);const [bg,fg]=pillCol(p.color);
    let pos=Array.isArray(p.at)?p.at:(sc._anch[p.at]||slotPos(p.at||'center'));pos=add(pos,[0,p.dy??.45,0]);
    if(p.screen){const sx=p.screen[0]<=1?p.screen[0]*W:p.screen[0],sy=p.screen[1]<=1?Math.max(.6,p.screen[1])*H:p.screen[1];ctx.save();ctx.translate(sx,sy);ctx.scale(k,k);p.clock?pill('⏱ '+p.text,0,0,'#22252C','#fff',p.size||32):pill(p.text,0,0,bg,fg,p.size||40);ctx.restore();return}
    if(p.clock){const q=project(pos);clockPill(p.text,q[0],q[1],k)}else pillAt3(p.text,pos,bg,fg,p.size||32,k)});
}

// ---------- special scene types ----------
const ROCKS=(()=>{const r=rng(9);return[...Array(46)].map((_,i)=>({p:[(r()*2-1)*4.2,(r()*2-1)*4.2,(r()*2-1)*1.5],s:.35+r()*.5,seed:i,ry:r()*6,vr:(r()-.5)*.8,ci:r()}))})();
function lensOverlay(sc,lt){
  const cx=540,cy=760,grains=Array.isArray(sc.grains)?sc.grains:(GRAINS[sc.grains]||GRAINS.sand);
  ctx.fillStyle='rgba(15,25,40,.5)';ctx.fillRect(0,0,W,H);const r=360*back(lt/.45);
  ctx.save();ctx.translate(cx,cy);ctx.rotate(.75);rr(r-10,-34,320*clamp(lt/.45),68,30);ctx.fillStyle='#2D2F36';ctx.fill();ctx.restore();
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,Math.max(r,1),0,7);ctx.clip();
  const g=ctx.createRadialGradient(cx,cy,10,cx,cy,r);g.addColorStop(0,sc.lensBg||'#FFF2D6');g.addColorStop(1,sc.lensBg2||'#E2C48C');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  setEnvMood('studio');ENV.amb=.55;ENV.dif=.6;ENV.shadows=false;setCam([0,0,10-lt*.4],[0,0,0],46,cx,cy,900);
  ROCKS.forEach(k=>addMesh(mul(T(...k.p),Ry(k.ry+k.vr*lt),Rx(k.ry*.7+k.vr*lt*.6),S(k.s,k.s*.8,k.s*.9)),sph(6,4,false,k.seed,.55),grains[Math.floor(k.ci*grains.length)],{a:.95}));flush();
  ctx.fillStyle='rgba(255,255,255,.18)';ctx.beginPath();ctx.ellipse(cx-r*.35,cy-r*.45,r*.35,r*.16,-.6,0,7);ctx.fill();ctx.restore();
  ctx.lineWidth=34;ctx.strokeStyle='#2D2F36';ctx.beginPath();ctx.arc(cx,cy,Math.max(r,1),0,7);ctx.stroke();
}
function showcaseItem(name,m,col){
  switch(name){
    case 'window':{const fm=(x_,y_,sx,sy)=>addMesh(mul(m,T(x_,y_,0),S(sx,sy,.1)),cube(),'#8A5A2B');addMesh(mul(m,T(0,.62,0),S(.88,1.02,.03)),cube(),'#A9DDF3',{a:.6});fm(0,1.15,.98,.08);fm(0,.09,.98,.08);fm(-.45,.62,.08,1.1);fm(.45,.62,.08,1.1);fm(0,.62,.05,1.0);fm(0,.62,.9,.05);break}
    case 'glass':addMesh(mul(m,T(0,.02,0),S(.25,.45,.25)),cyl(14,1.08),'#4FB3E0',{a:.75});addMesh(mul(m,S(.29,.82,.29)),cyl(14,1.16),'#CDEFFA',{a:.45});break;
    case 'phone':{const pm=mul(m,T(0,.58,0),Ry(-.25));addMesh(mul(pm,S(.54,1.04,.08)),cube(),'#22252C');addMesh(mul(pm,T(0,0,.042),S(.47,.94,.01)),cube(),'#7C8CF5',{em:1,bias:-.02});addMesh(mul(pm,T(-.05,.1,.05),Rz(-.6),S(.06,.9,.005)),cube(),'#B8C4FF',{em:1,bias:-.04});break}
    case 'bottle':addMesh(mul(m,S(.22,.6,.22)),cyl(12),col||'#7FD6A8',{a:.8});addMesh(mul(m,T(0,.6,0),S(.22,.2,.22)),cyl(12,.4),col||'#7FD6A8',{a:.8});addMesh(mul(m,T(0,.8,0),S(.09,.18,.09)),cyl(10),'#C0392B');break;
    case 'vase':addMesh(mul(m,S(1)),lathe(VASE),col||'#9FE3C9',{a:.85});break;
    case 'jar':addMesh(mul(m,S(.3,.6,.3)),cyl(14),col||'#CDEFFA',{a:.6});addMesh(mul(m,T(0,.6,0),S(.31,.08,.31)),cyl(14),'#B8862E');break;
    case 'box':addMesh(mul(m,T(0,.3,0),S(.6,.6,.6)),cube(),col||'#C9A06A');break;
    case 'bowl':addMesh(mul(m,S(.45,.3,.45)),cyl(16,1.5),col||'#E8E0D0');break;
    case 'soap':addMesh(mul(m,T(0,.13,0),S(.56,.26,.36)),cube(),col||'#F5C6D6');addMesh(mul(m,T(0,.265,0),S(.5,.02,.3)),cube(),shadeHex(col||'#F5C6D6',1.08),{bias:-.02});addMesh(mul(m,T(0,.28,0),S(.18,.01,.1)),cube(),'#FFFFFF',{em:1,a:.8,bias:-.05});break;
    case 'soaps':[[-.32,0,0],[.32,0,.05],[0,.27,0]].forEach(([x,y,z],i)=>showcaseItem('soap',mul(m,T(x,y,z),Ry(i*.3)),col));break;
    case 'pot':addMesh(mul(m,S(.5,.42,.5)),cyl(16),col||'#9AA1AB');ellipseFace(...ap(m,[0,.425,0]),.44,.44,'#5C6168',{L:2,bias:-.2});[-1,1].forEach(d=>addMesh(mul(m,T(d*.58,.32,0),S(.12,.04,.08)),cube(),'#3A3F46'));break;
    case 'mold':addMesh(mul(m,T(0,.12,0),S(1.0,.24,.55)),cube(),col||'#8B5A2B');addMesh(mul(m,T(0,.245,0),S(.88,.01,.43)),cube(),'#5E3A1A',{bias:-.03});break;
    case 'oil':addMesh(mul(m,S(.2,.55,.2)),cyl(12),'#F2C94C',{a:.85});addMesh(mul(m,T(0,.55,0),S(.2,.18,.2)),cyl(12,.4),'#F2C94C',{a:.85});addMesh(mul(m,T(0,.73,0),S(.08,.12,.08)),cyl(10),'#2F7D32');addMesh(mul(m,T(0,.25,.2),S(.22,.22,.01)),cube(),'#FFFFFF',{bias:-.05});break;
    case 'powder':sandCone(...ap(m,[0,0,0]),.45,.42,{});break;
    case 'water':addMesh(mul(m,T(0,.32,0),S(.28,.3,.28)),sph(12,8),col||'#5BB8F0',{a:.9});addMesh(mul(m,T(0,.5,0),S(.2,.4,.2)),cyl(12,0),col||'#5BB8F0',{a:.9});break;
    case 'coconut':addMesh(mul(m,T(0,.32,0),S(.34,.3,.32)),sph(10,8,false,5,.12),'#7A4A22');break;
    case 'salt':for(let i=0;i<7;i++){const a=i*2.4;addMesh(mul(m,T(Math.cos(a)*.18*(i%3),.07+(i>4?.13:0),Math.sin(a)*.15*(i%3)),Ry(a),S(.13)),cube(),'#F4F8FF')}break;
    case 'flame':addMesh(mul(m,T(0,0,0),S(.25,.7,.25)),cyl(10,0),'#FF8A1F',{em:1});addMesh(mul(m,T(0,0,.02),S(.14,.45,.14)),cyl(10,0),'#FFD23F',{em:1,bias:-.05});break;
    case 'leaf':addMesh(mul(m,T(0,.3,0),Rz(.5),S(.45,.03,.22)),sph(10,6),'#4CB848');break;
    case 'gloves':[-1,1].forEach(d=>{addMesh(mul(m,T(d*.18,.06,0),S(.14,.06,.28)),cube(),col||'#F2C94C');addMesh(mul(m,T(d*.18,.06,.2),S(.12,.05,.14)),cube(),col||'#F2C94C')});break;
    case 'knife':addMesh(mul(m,T(0,.02,0),S(.6,.02,.1)),cube(),'#C8CED6');addMesh(mul(m,T(-.42,.03,0),S(.25,.05,.08)),cube(),'#5A3A22');break;
    case 'bucket':addMesh(mul(m,S(.34,.44,.34)),cyl(12,1.15),col||'#4A7FC1');ellipseFace(...ap(m,[0,.445,0]),.37,.37,'#8FD3F0',{L:2,bias:-.3});break;
    case 'sandpile':sandCone(...ap(m,[0,0,0]),.6,.5,{});break;
    default:if(SPEC&&SPEC.models&&SPEC.models[name]){drawModel(SPEC.models[name],m,TNOW,{})}else addMesh(mul(m,T(0,.35,0),S(.35)),sph(12,8),col||'#FFC83D');
  }
}
function showcase(sc,lt,t){
  const a=lerp(-.25,.25,eio(lt/sc.dur));setCam([Math.sin(a)*9.4,3.0,Math.cos(a)*9.4],[0,.75+.35,-.3],46);
  const g=ctx.createRadialGradient(540,800,50,540,800,1200);g.addColorStop(0,'#FFF6E2');g.addColorStop(1,'#F0C98B');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,.3)';for(let i=0;i<12;i++){ctx.save();ctx.translate(540,700);ctx.rotate(i/12*PI*2+lt*.08);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(1500,-130);ctx.lineTo(1500,130);ctx.fill();ctx.restore()}
  addMesh(mul(T(0,-.3,-.4),S(2.8,.3,2.2)),cyl(28),'#F7E4C2',{L:0});ellipseFace(0,.004,-.4,2.65,2.08,'#EBCB98',{L:0,bias:5});
  const cen=sc.center||{};if(cen.item==='sandpile'||!cen.item)sandCone(0,0,-1.3,.8,.7,{});else showcaseItem(cen.item,mul(T(0,0,-1.3)),cen.color);
  const xs=[-1.25,0,1.2],items=(sc.items||[]).slice(0,3),shown=[];
  items.forEach((it,i)=>{const st=wordTime(sc,it.word,sc.start+.3+i*.6)-.1;if(t<st)return;const k=back((t-st)/.35);shown.push([xs[i],it,st]);showcaseItem(it.item,mul(T(xs[i],0,.45),S(k)),it.color)});
  sc._post.push(()=>{if(cen.label){const top=project([0,.8,-1.3]);pill(cen.label,top[0],top[1]-40,'#2A1B0B','#FFC83D',34)}
    shown.forEach(([x,it,st])=>{const q=project([x,-.05,.95]);if(t>st+.15&&it.label)pill(it.label,q[0],q[1]+5,'#FFFFFF','#22160A',32)})});
}

function explain(sc,lt,t){
  const k=eio(lt/sc.dur),a=lerp(-.06,.06,k)*(sc.i%2?1:-1),d=8.6-.9*k;setCam([Math.sin(a)*d,2.2,Math.cos(a)*d],[0,1.05,0],46);
  const g=ctx.createRadialGradient(540,760,50,540,760,1300);g.addColorStop(0,sc.bg1||'#FFF6E2');g.addColorStop(1,sc.bg2||'#F0C98B');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,.28)';for(let i=0;i<12;i++){ctx.save();ctx.translate(540,1150);ctx.rotate(i/12*PI*2+lt*.08);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(1500,-130);ctx.lineTo(1500,130);ctx.fill();ctx.restore()}
  addMesh(mul(T(0,-.3,.1),S(2.3,.3,1.4)),cyl(28),'#F7E4C2',{L:0});ellipseFace(0,.004,.1,2.15,1.3,'#EBCB98',{L:0,bias:5});
  const items=(sc.items||[]).slice(0,3),n=items.length,xs=n===3?[-1.25,0,1.25]:n===2?[-1.0,1.0]:[0],y0=2.5,sz=n===3?.9:1.1,shown=[];
  items.forEach((it,i)=>{const st=wordTime(sc,it.word,sc.start+.25+i*.7)-.1;if(t<st)return;const kk=back((t-st)/.4);
    addMesh(mul(T(xs[i],y0-.05,0),S(.42*sz,.06,.42*sz)),cyl(16),'#FFFFFF');
    showcaseItem(it.item,mul(T(xs[i],y0,0),Ry(SPEC.models&&SPEC.models[it.item]?Math.sin(t*.8+i)*.45:t*.6+i),S(sz*kk)),it.color);shown.push({x:xs[i],y:y0,it,st})});
  const r=sc.result,rst=r?wordTime(sc,r.word,sc.start+sc.dur*.55)-.1:1e9;
  if(r&&t>=rst){const kk=back((t-rst)/.45);addMesh(mul(T(0,.2,.25),S(.75,.4,.75)),cyl(18),'#FFFFFF');showcaseItem(r.item,mul(T(0,.6,.25),Ry(SPEC.models&&SPEC.models[r.item]?Math.sin(t*.7)*.4:t*.5),S(1.6*kk)),r.color)}
  sc._post.push(()=>{
    shown.forEach((o,i)=>{const q=project([o.x,o.y-.12,0]);if(o.it.label)pill(o.it.label,q[0],q[1]+30,'#FFFFFF','#22160A',34);
      if(i>0){const p0=project([(shown[i-1].x+o.x)/2,o.y+.25,0]);ctx.save();ctx.translate(p0[0],p0[1]);ctx.scale(back((t-o.st)/.3),back((t-o.st)/.3));ctx.font='900 110px Inter, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=12;ctx.strokeStyle='#2A1B0B';ctx.strokeText('+',0,0);ctx.fillStyle='#FFC83D';ctx.fillText('+',0,0);ctx.restore()}});
    if(r&&t>=rst-.35&&shown.length){const a0=project([0,y0-.35,0]),a1=project([0,1.55,.25]),kk=eo((t-rst+.35)/.35);
      ctx.save();ctx.strokeStyle='#2A1B0B';ctx.fillStyle='#FFC83D';ctx.lineWidth=10;const yE=lerp(a0[1],a1[1],kk);
      ctx.beginPath();ctx.moveTo(a0[0]-24,a0[1]);ctx.lineTo(a0[0]+24,a0[1]);ctx.lineTo(a0[0]+24,yE-40);ctx.lineTo(a0[0]+56,yE-40);ctx.lineTo(a0[0],yE+10);ctx.lineTo(a0[0]-56,yE-40);ctx.lineTo(a0[0]-24,yE-40);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}
    if(r&&t>=rst){const q=project([0,.25,.95]);if(r.label)pill(r.label,q[0],q[1],'#FFC83D','#22160A',44)}
  });
}
function drawCallouts(sc,lt,t){
  (sc.callouts||[]).forEach((c,i)=>{const st=wordTime(sc,c.word,sc.start+(c.delay??.3+i*.4))-.05;if(t<st)return;
    const pos=Array.isArray(c.at)?c.at:(sc._anch[c.at]||slotPos(c.at||'center'));const q=project(pos);if(q[2]<.1)return;
    const k=eo((t-st)/.35),bx=clamp(q[0]+(c.dx??0),150,W-150),by=clamp(q[1]+(c.dy??-230),300,1300);
    ctx.save();ctx.strokeStyle='#2A1B0B';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(bx,by+26);ctx.lineTo(lerp(bx,q[0],k),lerp(by+26,q[1],k));ctx.stroke();
    ctx.fillStyle=c.color==='red'?'#E8452C':c.color==='green'?'#3FA35B':c.color==='blue'?'#3B6FB6':'#FFC83D';ctx.beginPath();ctx.arc(q[0],q[1],9*k,0,7);ctx.fill();ctx.stroke();ctx.restore();
    const [bg,fg]=pillCol(c.color||'white');ctx.save();ctx.translate(bx,by);const s2=back((t-st)/.3);ctx.scale(s2,s2);pill(c.text,0,0,bg,fg,c.size||30);ctx.restore()});
}
function drawBadges(sc,lt,t){
  const shown=(sc.badges||[]).map((b,i)=>({b,st:wordTime(sc,b.word,sc.start+.4+i*.6)-.05})).filter(o=>t>=o.st);if(!shown.length)return;
  ctx.save();ctx.font='900 34px '+FONT;const ws=shown.map(o=>ctx.measureText((o.b.ok===false?'✖ ':'✔ ')+o.b.text).width+44);ctx.restore();
  const tot=ws.reduce((a,b)=>a+b,0)+20*(ws.length-1);let x=W/2-tot/2;
  shown.forEach((o,i)=>{const k=back((t-o.st)/.3);ctx.save();ctx.translate(x+ws[i]/2,1255);ctx.scale(k,k);pill((o.b.ok===false?'✖ ':'✔ ')+o.b.text,0,0,o.b.ok===false?'#E8452C':'#3FA35B','#FFFFFF',34);ctx.restore();x+=ws[i]+20});
}
// ---------- layout & frame ----------
let SPEC=null,SC=[],TOTAL=0,TNOW=0;
function layout(spec,timing){
  SPEC=spec;SC=[];let acc=0;
  spec.scenes.forEach((s0,i)=>{const s=Object.assign({},s0),tm=timing[i];s.i=i;s.who=s.who||'B';s.end=LEAD+tm.end;s.dur=LEAD+tm.end+(s.pad??DEF_PAD);s.start=acc;acc+=s.dur;
    const caps=parseText(s.cap||s.say),aw=tm.words.length?tm.words:[['',0]];
    caps.forEach((w,j)=>{const idx=Math.round(j*(aw.length-1)/Math.max(1,caps.length-1));w.t=s.start+LEAD+aw[Math.min(idx,aw.length-1)][1]});
    s.words=caps;const chunks=[];let cur=[];const SAMBUNG=/^(di|ke|dari|yang|dan|kalau|kalo|biar|buat|pake|pakai|sama|jadi|itu|terus|sampai|sampe|kayak|kaya|karena|soalnya|tapi|atau|untuk|dengan|nggak|gak|udah|masih|lebih|paling|baru|si|si|para|ini|alias|namanya)$/i;caps.forEach((w,j)=>{cur.push(w);const punct=/[.,?!:]$/.test(w.raw);const hang=SAMBUNG.test(w.disp)&&!punct;const brk=punct||(cur.length>=3&&!hang)||cur.length>=5;const nx=caps[j+1]&&caps[j+1].hl&&w.hl;if(brk&&!(nx&&cur.length<4)){chunks.push(cur);cur=[]}});if(cur.length)chunks.push(cur);
    for(let j=chunks.length-1;j>0;j--){if(chunks[j].length===1&&chunks[j-1].length<5&&!/[.?!]$/.test(chunks[j-1][chunks[j-1].length-1].raw)){chunks[j-1].push(...chunks[j]);chunks.splice(j,1)}}
    chunks.forEach((c,j)=>{c.t0=c[0].t;c.t1=chunks[j+1]?chunks[j+1][0].t:s.start+LEAD+tm.end+.25});s.chunks=chunks;
    s.talking=(w,lt)=>s.who.includes(w)&&lt>LEAD&&lt<s.end-.05;
    s.thermo=(s.props||[]).some(p=>p.type==='thermometer');
    if(!s.parts){s.shot=autoShot(s,SC[i-1]&&SC[i-1].shot,SC[i-2]&&SC[i-2].shot)}
    SC.push(s)});
  TOTAL=acc;return{total:acc,audio:SC.map(s=>s.start+LEAD),scenes:SC.map(s=>[s.start,s.dur])};
}
function activePart(sc,t){if(!sc.parts)return sc;let cur=null;for(const p of sc.parts){const st=p.fromWord?wordTime(sc,p.fromWord,sc.start)-.15:sc.start;if(t>=st)cur=Object.assign({},sc,p,{_partStart:st})}return cur||Object.assign({},sc,sc.parts[0],{_partStart:sc.start})}
function renderFrame(t){
  const s0=SC.find(s=>t>=s.start&&t<s.start+s.dur)||SC[SC.length-1];if(!s0)return;
  TNOW=t;const sc=activePart(s0,t);const lt=t-sc.start;
  sc._anch=Object.assign({},SLOT);sc._poles={};sc._chars={};sc._post=[];sc._fireBoost=0;sc._pumping=false;sc._thermo=null;
  ctx.setTransform(1,0,0,1,0,0);ctx.textAlign='left';ctx.globalAlpha=1;ctx.clearRect(0,0,W,H);FL=[];BB=[];
  const env=sc.env||'beach-day',mood=env.includes('dusk')?'dusk':'day';
  if(sc.type==='showcase'){setEnvMood('studio');showcase(sc,lt,t)}
  else if(sc.type==='explain'){setEnvMood('studio');explain(sc,lt,t)}
  else{setEnvMood(mood);
    // pre-pass for anchors used by camera (props positions)
    (sc.props||[]).forEach(p=>{const P=propPos(p,sc);sc._anch[p.id||p.type]=[P[0],1,P[2]]});
    sc._anch._B=sc.bongo&&sc.bongo.pos?slotPos(sc.bongo.pos):slotPos((sc.bongo&&sc.bongo.at)||'left');
    sc._anch._D=sc.dodo&&sc.dodo.pos?slotPos(sc.dodo.pos):slotPos((sc.dodo&&sc.dodo.at)||'right');
    {const cp=(sc.props||[]).find(p=>!['palm','rock','bush','pyramids'].includes(p.type));sc._anch._C=cp?propPos(cp,sc):SLOT.center}
    // fire boost pre-check for blow actions
    ['B','D'].forEach(w=>{const c=sc[w==='B'?'bongo':'dodo'];if(c&&c.action==='blow')sc._fireBoost=clamp((lt-sc.end-.05)/.4)});
    if(env.startsWith('room')){shotCam(sc,lt,t);const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,sc.wallColor||'#F1E3C8');g.addColorStop(1,'#E2CFAE');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);roomWorld(t,mood,sc)}else{
    shotCam(sc,lt,t);const hy=sky(mood);sun2d(hy,mood);clouds2d(t,hy,mood);if(env.startsWith('street'))streetWorld(t,mood,sc);else beachWorld(t,mood);}
    (sc.props||[]).forEach(p=>drawProp(p,sc,lt,t));
    // pumping pre-check so bellows animates
    if((sc.bongo&&sc.bongo.action==='pump')||(sc.dodo&&sc.dodo.action==='pump'))sc._pumping=true;
  }
  if((sc.type!=='showcase'&&sc.type!=='explain')||sc.withChars){drawChar('B',sc.bongo,sc,lt,t);drawChar('D',sc.dodo,sc,lt,t)}
  (sc.effects||[]).forEach(e=>effectPre(e,sc,lt,t));
  flush();
  sc._post.forEach(f=>f());(sc.effects||[]).forEach(e=>effectPost(e,sc,lt,t));thermoOverlay(sc,t);
  if(sc.type==='lens')lensOverlay(sc,t-sc._partStart);
  if(sc.nametags&&lt>.3){const k=back((lt-.3)/.35);if(sc._anch.bongo)pillAt3(SPEC.names?.B||'BONGO',add(sc._anch.bongo,[0,.45,0]),'#7FD08F','#22160A',34,k);if(sc._anch.dodo)pillAt3(SPEC.names?.D||'DODO',add(sc._anch.dodo,[0,.5,0]),'#FFC531','#22160A',34,k)}
  drawPills(sc,lt,t);drawCallouts(sc,lt,t);drawBadges(sc,lt,t);
  if(sc.endcard){const e=clamp((lt-sc.end-.1)/.4);if(e>0){ctx.fillStyle=`rgba(15,12,30,${.72*e})`;ctx.fillRect(0,0,W,H);const k=back((lt-sc.end-.1)/.45);
    ctx.save();ctx.translate(540,820);ctx.scale(k,k);pill(sc.endcard.title||'PART 2',0,0,'#FFC83D','#22160A',110);ctx.restore();
    if(lt>sc.end+.5&&sc.endcard.text){const sg=titleSegs(sc.endcard.text).map(s=>({hl:s.startsWith('*'),txt:s.replace('*','')}));ctx.save();ctx.font='900 64px '+FONT;const wd=sg.reduce((a,p)=>a+ctx.measureText(p.txt).width+(p.hl?64*.44:0),0)+64*.28*(sg.length-1);ctx.restore();drawRich(sg,540,1060,64,Math.min(1,960/wd))}}}
  const v=ctx.createRadialGradient(W/2,H/2,600,W/2,H/2,1250);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.28)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
  ctx.setTransform(1,0,0,1,0,0);ctx.textAlign='left';ctx.globalAlpha=1;
  if(SPEC.header!==false&&sc.header!==false)drawLabels({label:sc.label||'',title:titleSegs(sc.title),tag:sc.tag},lt);else if(sc.tag){drawLabels({label:'',title:[],tag:sc.tag,_noLabel:true},lt)}
  const c=sc.chunks.find(c=>t>=c.t0&&t<c.t1);
  if(c&&sc.who!=='N'){const nm=sc.who==='BD'?((SPEC.names?.B||'BONGO')+' & '+(SPEC.names?.D||'DODO')):sc.who==='B'?(SPEC.names?.B||'BONGO'):(SPEC.names?.D||'DODO');pill(nm,W/2,CAP_Y-100,sc.who==='D'?'#FFC531':'#7FD08F','#22160A',28)}
  drawCaption(sc,t);
}
