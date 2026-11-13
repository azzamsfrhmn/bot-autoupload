// ===== World: beach, character "Dodo", props =====
const SAND='#F1D39C',SAND2='#E8C68A';
const R0=rng(42);
const tileVar=[...Array(2000)].map(()=>R0()*.08-.04);
const peb=[...Array(60)].map(()=>({x:R0()*14-7,y:-.15-R0()*3.7,r:.05+R0()*.12,c:['#B98950','#A87A45','#E6C48C','#8E6236','#C9A06A'][Math.floor(R0()*5)]}));
const scatter=[...Array(40)].map(()=>({x:R0()*12-6,z:R0()*7.5-4.8,r:.03+R0()*.06,c:R0()<.5?'#FFF3D6':'#D9B377'}));

function sky(mood){
  const hp=project([CAM.e[0]+CAM.f[0]*1000,0,CAM.e[2]+CAM.f[2]*1000]);const hy=hp[1];
  const g=ctx.createLinearGradient(0,0,0,hy);
  if(mood==='dusk'){g.addColorStop(0,'#4E4384');g.addColorStop(.6,'#E9805E');g.addColorStop(1,'#FFD49C')}
  else{g.addColorStop(0,'#4FA9E6');g.addColorStop(1,'#CFEFFC')}
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  return hy;
}
function clouds2d(t,hy,mood){ctx.fillStyle=mood==='dusk'?'rgba(255,200,170,.55)':'rgba(255,255,255,.95)';
  [[80,.32,1,14],[700,.55,.8,9],[400,.18,.6,6]].forEach(([x0,fy,s,sp])=>{const x=((x0+t*sp)%1400)-250,y=hy*fy+40;[[0,0,60],[55,-22,72],[118,0,55],[60,18,60]].forEach(([a,b,r])=>{ctx.beginPath();ctx.arc(x+a*s,y+b*s,r*s,0,7);ctx.fill()})})}
function sun2d(hy,mood){ctx.fillStyle=mood==='dusk'?'#FFE29A':'#FFF6C4';const x=mood==='dusk'?770:850,y=mood==='dusk'?hy-60:hy*.28;
  ctx.save();ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=60;ctx.beginPath();ctx.arc(x,y,mood==='dusk'?95:70,0,7);ctx.fill();ctx.restore()}

function sea(t,mood){
  const zs=[-5,-6,-7.5,-10,-14,-20,-30,-45,-70,-110,-180],xs=[];for(let x=-200;x<=200;x+=20)xs.push(x);
  const c1=mood==='dusk'?'#3E6A9A':'#2196D3',c2=mood==='dusk'?'#5D7FB0':'#3FB2E2';
  const yv=(x,z)=>-.12+Math.sin(x*.6+t*1.6+z*.4)*.035;
  for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){const a=xs[i],b=xs[i+1],z0=zs[j],z1=zs[j+1];
    addFace([[a,yv(a,z0),z0],[b,yv(b,z0),z0],[b,yv(b,z1),z1],[a,yv(a,z1),z1]],(i+j)%2?c1:c2,{n:[0,1,0],L:0,bias:100})}
  // foam strip
  for(let x=-14;x<14;x+=1){const w=Math.sin(x*.9+t*2.2)*.12;addFace([[x,-.02,-5.15+w],[x+1,-.02,-5.15+Math.sin((x+1)*.9+t*2.2)*.12],[x+1,-.02,-4.9],[x,-.02,-4.9]],'#FFFFFF',{n:[0,1,0],L:0,bias:50})}
}
function sandBlock(mood){
  const dusk=mood==='dusk';let k=0;
  for(let x=-7;x<7;x+=.5)for(let z=-5;z<3;z+=.5){const v=tileVar[k++%2000];const c=hex(SAND).map(q=>q*(1+v));
    addFace([[x,0,z],[x+.5,0,z],[x+.5,0,z+.5],[x,0,z+.5]],c,{n:[0,1,0],L:0,bias:20})}
  scatter.forEach(s=>ellipseFace(s.x,.003,s.z,s.r,s.r*.7,s.c,{L:0,bias:10}));
  // cutaway front (z=3)
  const layers=[['#E2B877',0,-.9],['#D3A263',-.9,-1.9],['#BD8A4E',-1.9,-2.9],['#A2723F',-2.9,-4.2]];
  layers.forEach(([c,y0,y1],li)=>{for(let x=-7;x<7;x+=1){const w0=Math.sin(x*1.3+li*2)*.08,w1=Math.sin((x+1)*1.3+li*2)*.08;
    const ya0=li?y0+w0:y0,ya1=li?y0+w1:y0,yb0=li<3?y1+Math.sin(x*1.3+li*2+2)*.08:y1,yb1=li<3?y1+Math.sin((x+1)*1.3+li*2+2)*.08:y1;
    addFace([[x,ya0,3],[x+1,ya1,3],[x+1,yb1,3],[x,yb0,3]],c,{n:[0,0,1],L:0,bias:5})}});
  peb.forEach(p=>{const pts=[];for(let i=0;i<8;i++){const a=i/8*2*PI;pts.push([p.x+Math.cos(a)*p.r,p.y+Math.sin(a)*p.r*.65,3.01])}addFace(pts,p.c,{n:[0,0,1],L:1})});
  addFace([[-7,0,3.012],[7,0,3.012],[7,-.07,3.012],[-7,-.07,3.012]],'#FFF0D0',{n:[0,0,1],L:1});
}
function palm(x,z,s,rot,t){
  let p=[x,0,z],dir=[.12*Math.cos(rot),1,.12*Math.sin(rot)];
  for(let i=0;i<7;i++){const q=add(p,scl(norm(dir),.42*s));addMesh(basisY(p,q,(.13-.008*i)*s),cyl(7,.9),i%2?'#9A6634':'#8A5A2B');p=q;dir=add(dir,[.05*Math.cos(rot),0,.05*Math.sin(rot)])}
  const sw=Math.sin(t*1.4+x)*.05;
  for(let i=0;i<8;i++){const a=i/8*2*PI+.3;const m=mul(T(...p),Ry(a),Rz(-.35-(i%2)*.25+sw),T(.62*s,0,0),S(1.3*s,.04*s,.26*s));addMesh(m,cube(),i%2?'#3E9A3A':'#55BC4B')}
  [[.1,0],[-.08,.08],[0,-.1]].forEach(([a,b])=>addMesh(mul(T(p[0]+a*s,p[1]-.1*s,p[2]+b*s),S(.1*s)),sph(6,5),'#6B3F1D'));
}
function bush(x,z,s){[[0,0,1],[.35,-.05,.75],[-.3,.05,.7]].forEach(([a,b,k],i)=>addMesh(mul(T(x+a*s,.18*s*k,z+b*s),S(.38*s*k,.3*s*k,.34*s*k)),sph(8,6,false,i,.15),i?'#4DB848':'#3FA23C'))}
function rock(x,z,s,seed,col='#9A9CA2'){addMesh(mul(T(x,.06*s,z),Ry(seed),S(s,s*.65,s*.85)),sph(7,5,false,seed,.35),col)}
function beachWorld(t,mood){sea(t,mood);sandBlock(mood);palm(-2.5,-2.6,1,0.4,t);palm(2.7,-3.4,1.15,2.6,t);palm(-4.2,-4.3,.9,0,t);palm(4.6,-1.5,1,3,t);
  bush(-1.7,-1.6,.9);bush(2.1,-.6,.8);bush(-3.3,.6,1);rock(1.6,1.6,.25,3);rock(-2.2,1.9,.18,5);}

// ===== Character: DODO =====
const SKIN='#F2B98B',SHIRT='#F07F2E',OVR='#2F5C9E',SHOE='#4A2E1C',HELM='#FFC531',DARK='#1E1A18',CHEEK='#F2907E';
const HANDS={};
function dodo(root,pose={},t=0){
  const p=Object.assign({aL:[0,.12],aR:[0,.12],lL:0,lR:0,hy:0,hp:0,hr:0,bob:0,lean:0,blink:true,mouth:'smile'},pose);
  if(p.talk&&(Math.sin(t*23)+Math.sin(t*14.7))>.15)p.mouth='o';
  ellipseFace(root[3],.006,root[11],.42,.36,[0,0,0],{a:.2,L:1});
  const B=mul(root,T(0,p.bob,0));
  [[-1,p.lL],[1,p.lR]].forEach(([s,a])=>{const Hh=mul(B,T(s*.15,.78,0),Rx(-a));
    addMesh(mul(Hh,T(0,-.72,0),S(.12,.72,.12)),cyl(8),OVR);addMesh(mul(Hh,T(0,-.72,.06),S(.24,.14,.36)),cube(),SHOE)});
  const Bd=mul(B,T(0,.7,0),Rx(p.lean));
  addMesh(mul(Bd,S(.33,.26,.31)),cyl(12,.98),OVR);
  addMesh(mul(Bd,T(0,.24,0),S(.32,.44,.3)),cyl(12,.84),SHIRT);
  addMesh(mul(Bd,T(0,.36,.235),S(.34,.36,.12)),cube(),OVR);
  [-1,1].forEach(s=>{addMesh(mul(Bd,T(s*.12,.6,.2),Rx(-.25),S(.06,.22,.05)),cube(),OVR);addMesh(mul(Bd,T(s*.12,.5,.3),S(.035)),sph(6,4),'#FFD54A')});
  // head
  const Hd=mul(Bd,T(0,.98,0),Ry(p.hy),Rx(-p.hp),Rz(p.hr));
  addMesh(mul(Hd,S(.37,.36,.35)),sph(14,10),SKIN);
  const bl=p.blink&&(t%3.1)<.12?.15:1;
  [-1,1].forEach(s=>{addMesh(mul(Hd,T(s*.13,.03,.315),S(.05,.068*bl,.03)),sph(8,6),DARK,{bias:-.02});
    if(bl>.5)addMesh(mul(Hd,T(s*.13+.016,.06,.34),S(.016)),sph(5,4),'#FFFFFF',{em:1,bias:-.04});
    addMesh(mul(Hd,T(s*.21,-.075,.27),S(.065,.04,.03)),sph(7,5),CHEEK,{bias:-.01})});
  addMesh(mul(Hd,T(0,-.02,.35),S(.045,.04,.04)),sph(6,5),'#E9A06F',{bias:-.03});
  if(p.mouth==='o')addMesh(mul(Hd,T(0,-.15,.325),S(.045,.055,.02)),sph(8,6),'#7A2B22',{bias:-.03});
  else if(p.mouth==='flat')addMesh(mul(Hd,T(0,-.14,.33),S(.1,.018,.02)),cube(),DARK,{bias:-.03});
  else for(let k=-3;k<=3;k++){addMesh(mul(Hd,T(k*.03,-.14+k*k*.0045,.333-Math.abs(k)*.006),Rz(k*.15),S(.036,.018,.02)),cube(),DARK,{bias:-.03})}
  // hard hat
  addMesh(mul(Hd,T(0,.07,0),S(.39,.37,.38)),sph(14,8,true),HELM);
  addMesh(mul(Hd,T(0,.06,.05),S(.46,.035,.46)),cyl(16),HELM);
  addMesh(mul(Hd,T(0,.27,.315),Rx(-.75),S(.14,.09,.02)),cube(),'#FFFFFF',{em:1,bias:-.02});
  addMesh(mul(Hd,T(0,.27,.322),Rx(-.75),S(.05,.05,.01)),cube(),'#F07F2E',{em:1,bias:-.05});
  // arms
  [['aL',-1],['aR',1]].forEach(([k,s])=>{const [pitch,out]=p[k];
    const A=mul(Bd,T(s*.36,.6,0),Rx(-pitch),Rz(s*out));
    addMesh(mul(A,T(0,-.26,0),S(.125,.26,.125)),cyl(8),SHIRT);
    addMesh(mul(A,T(0,-.6,0),S(.085,.36,.085)),cyl(8),SKIN);
    addMesh(mul(A,T(0,-.64,0),S(.11)),sph(8,6),SKIN);
    HANDS[k]=ap(A,[0,-.64,0])});
  return{Bd,Hd,head:ap(Hd,[0,.55,0])};
}
// ===== props =====
function campfire(fx,fz,t,s=1){
  for(let i=0;i<9;i++){const a=i/9*2*PI;rock(fx+Math.cos(a)*.55*s,fz+Math.sin(a)*.42*s,.2*s,i+10,i%2?'#8D8F94':'#A4A6AB')}
  addMesh(basisY([fx-.45*s,.08*s,fz-.15*s],[fx+.45*s,.08*s,fz+.15*s],.08*s),cyl(7),'#7A4A22');
  addMesh(basisY([fx-.4*s,.1*s,fz+.2*s],[fx+.4*s,.1*s,fz-.2*s],.08*s),cyl(7),'#6A3E1B');
  ellipseFace(fx,.004,fz,.6*s,.5*s,[60,40,30],{a:.5,L:1});
  bb([fx,.05,fz],(x,y,k)=>fire2d(x,y,k*.0034*s,t),{bias:-.05});
}
function fire2d(cx,cy,s,t){
  ctx.translate(cx,cy);ctx.scale(s,s);
  const gl=ctx.createRadialGradient(0,-80,10,0,-80,360);gl.addColorStop(0,'rgba(255,190,80,.5)');gl.addColorStop(1,'rgba(255,140,40,0)');
  ctx.fillStyle=gl;ctx.beginPath();ctx.arc(0,-80,360,0,7);ctx.fill();
  [['#E8452C',95,250,0],['#FF8A1F',70,195,1.3],['#FFD23F',42,120,2.6]].forEach(([c,w,h,sd])=>{
    const f=nz(t*3,sd)*22,hh=h*(1+nz(t*4,sd+5)*.12);ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(-w,-10);
    ctx.bezierCurveTo(-w*1.1,-hh*.45,-w*.25+f*.5,-hh*.6,f,-hh);ctx.bezierCurveTo(w*.3+f*.5,-hh*.6,w*1.1,-hh*.45,w,-10);ctx.quadraticCurveTo(0,20,-w,-10);ctx.fill();
    [-1,1].forEach(d=>{const ff=nz(t*3.6,sd+d*3)*14;ctx.beginPath();ctx.moveTo(d*w*.3,-20);ctx.quadraticCurveTo(d*w*1.05,-hh*.35,d*w*.75+ff,-hh*.62);ctx.quadraticCurveTo(d*w*.7,-hh*.3,d*w*.95,-15);ctx.fill()})});
  for(let i=0;i<14;i++){const o=i*.37,p=((t+o)%2)/2;ctx.fillStyle=`rgba(255,${200-p*80},80,${1-p})`;ctx.beginPath();ctx.arc(Math.sin(i*2.1)*60+Math.sin(t*3+i)*15,-130-p*260,3+(i%3),0,7);ctx.fill()}
}
function slab(fx,fz,pileH){
  [-1,1].forEach(s=>addMesh(mul(T(fx+s*.78,.36,fz),S(.24,.72,.5)),cube(),'#7E8086',{bias:-.1}));
  addMesh(mul(T(fx,.79,fz),S(2.0,.14,.95)),cube(),'#9A9CA2',{bias:-.3});
  if(pileH>.01)addMesh(mul(T(fx,.86,fz),S(.62,pileH,.42)),cyl(12,.18),SAND,{bias:-.35});
}
function sandCone(x,y,z,r,h,o={}){if(h>.01)addMesh(mul(T(x,y,z),S(r,h,r*.9)),cyl(12,.15),SAND,o)}
function bubble2d(x,y,k,txt){ctx.translate(x,y);ctx.scale(k,k);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,90,0,7);ctx.fill();ctx.beginPath();ctx.moveTo(-40,70);ctx.lineTo(-80,130);ctx.lineTo(0,85);ctx.fill();
  ctx.lineWidth=6;ctx.strokeStyle='#2A1B0B';ctx.beginPath();ctx.arc(0,0,90,0,7);ctx.stroke();ctx.font='900 120px Inter';ctx.fillStyle='#2A1B0B';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,0,6)}

// ===== Character 2: BONGO (big, strong, naive) =====
const BSKIN='#C98B5E',BSHIRT='#3FA35B',BSHORT='#7A5233',BBAND='#E0463A',BHAIR='#1E1A18';
function bongo(root,pose={},t=0){
  const p=Object.assign({aL:[0,.18],aR:[0,.18],lL:0,lR:0,hy:0,hp:0,hr:0,bob:0,lean:0,blink:true,mouth:'grin',brow:0},pose);
  if(p.talk&&(Math.sin(t*21)+Math.sin(t*13.1))>.15)p.mouth='o';
  ellipseFace(root[3],.006,root[11],.75,.6,[0,0,0],{a:.2,L:1});
  const B=mul(root,T(0,p.bob,0));
  [[-1,p.lL],[1,p.lR]].forEach(([s,a])=>{const Hh=mul(B,T(s*.26,.62,0),Rx(-a));
    addMesh(mul(Hh,T(0,-.58,0),S(.17,.58,.17)),cyl(8,1.1),BSKIN);addMesh(mul(Hh,T(0,-.6,.08),S(.34,.08,.48)),cube(),'#3B2A20')});
  const Bd=mul(B,T(0,.6,0),Rx(p.lean));
  addMesh(mul(Bd,S(.52,.34,.48)),cyl(12,1.05),BSHORT);
  addMesh(mul(Bd,T(0,.62,0),S(.66,.6,.58)),sph(14,10),BSHIRT);
  addMesh(mul(Bd,T(0,.33,0),S(.6,.08,.53)),cyl(14),'#4A3220');
  addMesh(mul(Bd,T(0,.37,.53),S(.16,.13,.04)),cube(),'#FFC531',{bias:-.02});
  addMesh(mul(Bd,T(0,.72,.555),Rx(PI/2),S(.15,.03,.15)),cyl(12),'#FFFFFF',{bias:-.03});addMesh(mul(Bd,T(0,.72,.59),S(.06,.09,.01)),cube(),'#3FA35B',{em:1,bias:-.05});
  // head
  const Hd=mul(Bd,T(0,1.5,0),Ry(p.hy),Rx(-p.hp),Rz(p.hr),S(1.18));
  addMesh(mul(Hd,S(.34,.33,.32)),sph(14,10),BSKIN);
  addMesh(mul(Hd,T(0,.12,-.03),S(.355,.3,.34)),sph(12,8,true),BHAIR);
  for(let i=0;i<6;i++){const a=(i/6-.5)*1.6;addMesh(mul(Hd,T(Math.sin(a)*.18,.37,Math.cos(a)*.05-.04),Rz(-a*.6),S(.07,.13,.07)),cyl(5,0),BHAIR)}
  addMesh(mul(Hd,T(0,.13,0),S(.36,.07,.34)),cyl(14),BBAND);
  addMesh(mul(Hd,T(0,.16,-.35),Rz(.6),S(.06,.2,.04)),cube(),BBAND);addMesh(mul(Hd,T(.05,.13,-.35),Rz(-.5),S(.06,.2,.04)),cube(),BBAND);
  const bl=p.blink&&((t+1.3)%3.7)<.12?.15:1;
  [-1,1].forEach(s=>{addMesh(mul(Hd,T(s*.12,-.02,.3),S(.045,.06*bl,.03)),sph(8,6),DARK,{bias:-.02});
    if(bl>.5)addMesh(mul(Hd,T(s*.12+.014,.005,.325),S(.014)),sph(5,4),'#FFFFFF',{em:1,bias:-.04});
    addMesh(mul(Hd,T(s*.12,.07+p.brow*.03,.305),Rz(-s*(.15+p.brow*.25)),S(.12,.032,.03)),cube(),DARK,{bias:-.03})});
  addMesh(mul(Hd,T(0,-.08,.33),S(.075,.06,.06)),sph(7,5),'#B5764B',{bias:-.03});
  if(p.mouth==='o')addMesh(mul(Hd,T(0,-.2,.29),S(.06,.07,.02)),sph(8,6),'#6E2620',{bias:-.03});
  else for(let k=-4;k<=4;k++)addMesh(mul(Hd,T(k*.03,-.19+k*k*.004,.3-Math.abs(k)*.008),Rz(k*.14),S(.036,.02,.02)),cube(),DARK,{bias:-.03});
  // arms
  [['aL',-1],['aR',1]].forEach(([k,s])=>{const [pitch,out]=p[k];
    const A=mul(Bd,T(s*.66,.9,0),Rx(-pitch),Rz(s*out));
    addMesh(mul(A,T(0,-.74,0),S(.16,.74,.16)),cyl(8,1.1),BSKIN);
    addMesh(mul(A,T(0,-.8,0),S(.17)),sph(8,6),BSKIN);
    HANDS['b'+k]=ap(A,[0,-.8,0])});
  return{Bd,Hd,head:ap(Hd,[0,.5,0])};
}
