// Kartun3D - mesin animasi 3D low-poly Dodo & Bongo (canvas 2D, tanpa dependensi)
// AUTO-GENERATED dari src/modules/kartun3d/engine/ oleh scripts/build-kartun3d.js - edit di sana, lalu build ulang.
export function createKartun3D(canvas){
'use strict';
const ctx=canvas.getContext('2d');
// ===== Mini low-poly 3D engine for canvas 2D =====
const W=1080,H=1920,PI=Math.PI;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,k)=>a+(b-a)*k;
const eo=x=>1-Math.pow(1-clamp(x),3);
const eio=x=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const back=x=>{x=clamp(x);const c1=1.9,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const nz=(t,s)=>Math.sin(t*1.3+s)*.5+Math.sin(t*2.7+s*1.7)*.3+Math.sin(t*5.3+s*3.1)*.2;
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const hex=h=>{const n=parseInt(h.slice(1),16);return[n>>16,n>>8&255,n&255]};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],scl=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]};
const vl=(a,b,k)=>[lerp(a[0],b[0],k),lerp(a[1],b[1],k),lerp(a[2],b[2],k)];
// 3x4 matrices
function mul(...ms){return ms.reduce((A,B)=>{const C=new Array(12);for(let r=0;r<3;r++)for(let c=0;c<4;c++)C[r*4+c]=A[r*4]*B[c]+A[r*4+1]*B[4+c]+A[r*4+2]*B[8+c]+(c==3?A[r*4+3]:0);return C})}
const T=(x,y,z)=>[1,0,0,x,0,1,0,y,0,0,1,z];
const S=(x,y=x,z=x)=>[x,0,0,0,0,y,0,0,0,0,z,0];
const Rx=a=>{const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,0,c,-s,0,0,s,c,0]};
const Ry=a=>{const c=Math.cos(a),s=Math.sin(a);return[c,0,s,0,0,1,0,0,-s,0,c,0]};
const Rz=a=>{const c=Math.cos(a),s=Math.sin(a);return[c,-s,0,0,s,c,0,0,0,0,1,0]};
const ap=(m,p)=>[m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]];
function basisY(a,b,r){ // matrix mapping unit cyl (y 0..1, radius 1) from a to b with radius r
  const d=sub(b,a),L=Math.hypot(...d),y=scl(d,1/L);let x=norm(cross(y,Math.abs(y[1])<.9?[0,1,0]:[1,0,0]));const z=cross(x,y);
  return[x[0]*r,y[0]*L,z[0]*r,a[0],x[1]*r,y[1]*L,z[1]*r,a[1],x[2]*r,y[2]*L,z[2]*r,a[2]]}
// ---- meshes ----
const MESH={};
function cube(){return MESH.cube||(MESH.cube={c:[0,0,0],f:[
 [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],[[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]],
 [[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]],[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],
 [[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]],[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]]})}
function cyl(n,r2=1){const k='c'+n+'_'+r2;if(MESH[k])return MESH[k];const f=[],b=[],tp=[];
  const p=(a,r,y)=>[Math.cos(a)*r,y,Math.sin(a)*r];
  for(let i=0;i<n;i++){const a0=i/n*2*PI,a1=(i+1)/n*2*PI;
    f.push(r2>0?[p(a0,1,0),p(a1,1,0),p(a1,r2,1),p(a0,r2,1)]:[p(a0,1,0),p(a1,1,0),[0,1,0]]);b.push(p(a0,1,0));if(r2>0)tp.push(p(a0,r2,1))}
  f.push(b);if(r2>0)f.push(tp);return MESH[k]={c:[0,.5,0],f}}
function sph(n,m,half=false,seed=0,jit=0){const k='s'+n+'_'+m+half+seed+jit;if(MESH[k])return MESH[k];
  const R=rng(seed+1),rings=[],mm=half?Math.ceil(m/2):m;
  for(let j=0;j<=mm;j++){const ph=j/m*PI,row=[];for(let i=0;i<n;i++){const a=i/n*2*PI,rr=1+(j>0&&j<m?(R()-.5)*jit:0);row.push([Math.sin(ph)*Math.cos(a)*rr,Math.cos(ph)*(1+(j>0&&j<m?(R()-.5)*jit:0)),Math.sin(ph)*Math.sin(a)*rr])}rings.push(row)}
  const f=[];for(let j=0;j<mm;j++)for(let i=0;i<n;i++){const i1=(i+1)%n;
    if(j===0)f.push([rings[0][i],rings[1][i1],rings[1][i]]);else if(j===m-1)f.push([rings[j][i],rings[j][i1],rings[j+1][i]]);
    else f.push([rings[j][i],rings[j][i1],rings[j+1][i1],rings[j+1][i]])}
  return MESH[k]={c:[0,0,0],f}}
// ---- frame state ----
let FL=[],BB=[],CAM=null;
const ENV={light:norm([-.45,.85,.55]),amb:.58,dif:.5,tint:[1,1,1],fogc:[200,232,246],fog0:12,fog1:110,fogmax:.85,shadows:true,shadowA:.3,ao:true};
let SHC=null,SHX=null;
function addMesh(m,mesh,col,o={}){const c=ap(m,mesh.c);for(const f of mesh.f)FL.push({p:f.map(p=>ap(m,p)),c,col:typeof col==='string'?hex(col):col,a:o.a??1,L:o.L??2,em:o.em,bias:o.bias||0,dbl:o.dbl,noShadow:o.noShadow})}
function addFace(pts,col,o={}){FL.push({p:pts,n:o.n,c:o.c,col:typeof col==='string'?hex(col):col,a:o.a??1,L:o.L??2,em:o.em,bias:o.bias||0,dbl:o.dbl,nofog:o.nofog})}
function box(x,y,z,sx,sy,sz,col,o,m){addMesh(mul(m||T(0,0,0),T(x,y,z),S(sx,sy,sz)),cube(),col,o)}
function bb(pos,fn,o={}){BB.push({pos,fn,L:o.L??2,bias:o.bias||0})}
function setCam(e,t,fov=46,cx=W/2,cy=H/2,focal){const f=norm(sub(t,e)),r=norm(cross(f,[0,1,0])),u=cross(r,f);CAM={e,f,r,u,cx,cy,focal:focal||(H/2)/Math.tan(fov/2*PI/180)}}
function project(p){const d=sub(p,CAM.e),z=dot(d,CAM.f);return[CAM.cx+dot(d,CAM.r)*CAM.focal/z,CAM.cy-dot(d,CAM.u)*CAM.focal/z,z,CAM.focal/z]}
function flush(){
  const items=[],L=ENV.light;
  const doSh=ENV.shadows&&L[1]>.25&&typeof document!=='undefined';let shN=0;
  if(doSh){if(!SHC){SHC=document.createElement('canvas');SHC.width=W;SHC.height=H;SHX=SHC.getContext('2d')}SHX.setTransform(1,0,0,1,0,0);SHX.clearRect(0,0,W,H);SHX.fillStyle='#000';SHX.strokeStyle='#000';SHX.lineWidth=1.5}
  for(const F of FL){
    const P=F.p,n=P.length;
    if(doSh&&F.L===2&&!F.em&&!F.noShadow&&(F.a??1)>=.6){let ok2=true;const q=[];for(const p of P){if(p[1]<-.02){ok2=false;break}const k=p[1]/L[1],g=[p[0]-L[0]*k,.001,p[2]-L[2]*k];const d=sub(g,CAM.e),z=dot(d,CAM.f);if(z<.12){ok2=false;break}q.push(CAM.cx+dot(d,CAM.r)*CAM.focal/z,CAM.cy-dot(d,CAM.u)*CAM.focal/z)}
      if(ok2){SHX.beginPath();SHX.moveTo(q[0],q[1]);for(let i=2;i<q.length;i+=2)SHX.lineTo(q[i],q[i+1]);SHX.closePath();SHX.fill();SHX.stroke();shN++}}let nx=0,ny=0,nzz=0,mx=0,my=0,mz=0;
    for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n];nx+=(a[1]-b[1])*(a[2]+b[2]);ny+=(a[2]-b[2])*(a[0]+b[0]);nzz+=(a[0]-b[0])*(a[1]+b[1]);mx+=a[0];my+=a[1];mz+=a[2]}
    const M=[mx/n,my/n,mz/n];let N=F.n||norm([nx,ny,nzz]);
    if(!F.n&&F.c&&dot(N,sub(M,F.c))<0)N=scl(N,-1);
    const V=sub(M,CAM.e);if(dot(N,V)>=0){if(!F.dbl)continue;N=scl(N,-1)}
    const sp=[];let zs=0,ok=true,minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
    for(const p of P){const d=sub(p,CAM.e),z=dot(d,CAM.f);if(z<.12){ok=false;break}
      const x=CAM.cx+dot(d,CAM.r)*CAM.focal/z,y=CAM.cy-dot(d,CAM.u)*CAM.focal/z;sp.push(x,y);zs+=z;
      if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y}
    if(!ok||maxx<-20||minx>W+20||maxy<-20||miny>H+20)continue;
    const depth=zs/n+F.bias;
    let s=F.em?1:ENV.amb+ENV.dif*Math.max(0,dot(N,L));
    if(!F.em&&ENV.ao&&F.L===2)s*=.78+.22*clamp(M[1]/.55);
    if(!F.em)s+=.1*Math.pow(Math.max(0,dot(N,norm(sub(scl(L,1),norm(V))))),12);
    let col=[F.col[0]*s*ENV.tint[0],F.col[1]*s*ENV.tint[1],F.col[2]*s*ENV.tint[2]];
    if(!F.nofog){const k=clamp((depth-ENV.fog0)/(ENV.fog1-ENV.fog0))*ENV.fogmax;col=vl(col,ENV.fogc,k)}
    items.push({L:F.L,d:depth,sp,col,a:F.a});
  }
  for(const b of BB){const pr=project(b.pos);if(pr[2]<.12)continue;items.push({L:b.L,d:pr[2]+b.bias,fn:b.fn,pr})}
  items.sort((A,B)=>A.L-B.L||B.d-A.d);
  let shDone=!(doSh&&shN);
  for(const it of items){
    if(!shDone&&it.L>=2){ctx.save();ctx.globalAlpha=ENV.shadowA;ctx.drawImage(SHC,0,0);ctx.restore();shDone=true}
    if(it.fn){ctx.save();it.fn(it.pr[0],it.pr[1],it.pr[3]);ctx.restore();continue}
    const s=it.sp;ctx.beginPath();ctx.moveTo(s[0],s[1]);for(let i=2;i<s.length;i+=2)ctx.lineTo(s[i],s[i+1]);ctx.closePath();
    const c=`rgba(${it.col[0]|0},${it.col[1]|0},${it.col[2]|0},${it.a})`;ctx.fillStyle=c;ctx.fill();
    if(it.a>=1){ctx.strokeStyle=c;ctx.lineWidth=1.3;ctx.stroke()}
  }
  if(!shDone){ctx.save();ctx.globalAlpha=ENV.shadowA;ctx.drawImage(SHC,0,0);ctx.restore()}
  FL=[];BB=[];
}
// ---- helpers ----
function ellipseFace(cx,y,cz,rx,rz,col,o={}){const pts=[];for(let i=0;i<14;i++){const a=-i/14*2*PI;pts.push([cx+Math.cos(a)*rx,y,cz+Math.sin(a)*rz])}addFace(pts,col,Object.assign({n:[0,1,0],L:1},o))}
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}

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

// ===== extra props for the full video =====
function lathe(prof,n=14){const k='l'+JSON.stringify(prof)+n;if(MESH[k])return MESH[k];const f=[],rings=prof.map(([y,r])=>[...Array(n)].map((_,i)=>{const a=i/n*2*PI;return[Math.cos(a)*r,y,Math.sin(a)*r]}));
  for(let j=0;j<prof.length-1;j++)for(let i=0;i<n;i++){const i1=(i+1)%n;f.push([rings[j][i],rings[j][i1],rings[j+1][i1],rings[j+1][i]])}
  f.push(rings[0].slice());return MESH[k]={c:[0,prof[Math.floor(prof.length/2)][0],0],f}}
const VASE=[[0,.17],[.04,.21],[.22,.27],[.42,.25],[.58,.14],[.72,.1],[.84,.15]];
function vase(x,y,z,s,col,o={}){addMesh(mul(T(x,y,z),S(s)),lathe(VASE),col,o)}
function glow2d(x,y,r,a=.6,c='255,170,60'){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(${c},${a})`);g.addColorStop(1,`rgba(${c},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill()}
// furnace: returns crucible top position
function furnace(fx,fz,t,heat=1,k=1){
  const m=mul(T(fx,0,fz),S(k));
  addMesh(mul(m,S(.72,1.0,.72)),cyl(12,.82),'#B4532F');
  for(let i=0;i<4;i++)addMesh(mul(m,T(0,.12+i*.24,0),S(.735-i*.034,.025,.735-i*.034)),cyl(12),'#8E3D22');
  addMesh(mul(m,T(0,.18,.62),S(.36,.24,.12)),cube(),heat>0?'#FF8A2A':'#3A2A20',{em:heat>0,bias:-.2});
  ellipseFace(fx,1.0*k+.004,fz,.5*k,.5*k,heat>0?'#FF9A33':'#2A1E18',{L:2,bias:-.25,em:heat>0});
  if(heat>0){bb([fx,.6*k,fz+.3],(x,y,s)=>{glow2d(x,y,s*1.4*heat,.45*heat)},{bias:-.6})}
}
function crucible(fx,fz,state,t,k=1){ // state: 'sand'|'molten'|'clear'
  const y=1.0*k;addMesh(mul(T(fx,y,fz),S(.3,.34,.3)),cyl(12,1.15),'#7B4A33',{bias:-.3});
  const col=state==='sand'?SAND:state==='molten'?'#FF8F2A':'#FFC45A';
  ellipseFace(fx,y+.345,fz,.33,.33,col,{L:2,bias:-.45,em:state!=='sand'});
  return[fx,y+.35,fz];
}
function bellows(x,z,open,t){ // nozzle points +x
  const a=.12+open*.32;
  addMesh(mul(T(x,.12,z),S(.9,.05,.5)),cube(),'#8A5A2B');
  addMesh(mul(T(x-.45,.12,z),Rz(-a),T(.45,0,0),S(.9,.05,.5)),cube(),'#9B6A35',{bias:-.05});
  addMesh(mul(T(x-.45,.12,z),Rz(-a/2),T(.38,.0,0),S(.72,.02+.9*Math.sin(a)*.5,.44)),cube(),'#5A3A22');
  addMesh(basisY([x+.4,.14,z],[x+.95,.14,z],.05),cyl(8),'#6E7480');
  addMesh(mul(T(x-.88,.12+Math.sin(a)*.86,z),S(.12,.08,.2)),cube(),'#6A3E1B');
}
function bag(x,y,z,col='#D8C39A',ry=0,tilt=0){const m=mul(T(x,y,z),Ry(ry),Rz(tilt));addMesh(mul(m,S(.42,.52,.3)),cube(),col);addMesh(mul(m,T(0,.3,0),S(.3,.1,.22)),cube(),shadeHex(col,.85))}
function shadeHex(h,k){const c=hex(h);return c.map(v=>Math.round(v*k))}
function pyramid(x,z,s,k){if(k<=0)return;addMesh(mul(T(x,0,z),Ry(PI/4),S(s*k,s*1.1*k,s*k)),cyl(4,0),'#E3C58A')}
function sparkles(cx,cy,r,t,n=10){for(let i=0;i<n;i++){const a=i/n*2*PI+t*.6,p=((t*1.3+i*.37)%1),x=cx+Math.cos(a)*r*(.6+.5*p),y=cy+Math.sin(a)*r*(.6+.5*p),s=12*(1-Math.abs(p-.5)*2);
  ctx.fillStyle='#FFF6C2';ctx.beginPath();ctx.moveTo(x,y-s*2);ctx.lineTo(x+s*.5,y-s*.5);ctx.lineTo(x+s*2,y);ctx.lineTo(x+s*.5,y+s*.5);ctx.lineTo(x,y+s*2);ctx.lineTo(x-s*.5,y+s*.5);ctx.lineTo(x-s*2,y);ctx.lineTo(x-s*.5,y-s*.5);ctx.fill()}}
function sweat2d(x,y,k,t){for(let i=0;i<3;i++){const p=((t*1.2+i*.33)%1);const xx=x+(i-1)*40*k,yy=y+p*90*k;ctx.globalAlpha=1-p;ctx.fillStyle='#8FD3FF';ctx.beginPath();ctx.moveTo(xx,yy-22*k);ctx.quadraticCurveTo(xx+14*k,yy,xx,yy+10*k);ctx.quadraticCurveTo(xx-14*k,yy,xx,yy-22*k);ctx.fill()}ctx.globalAlpha=1}
function windLines(x0,y0,x1,y1,t){ctx.save();ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=7;ctx.lineCap='round';for(let i=0;i<4;i++){const p=((t*2.2+i*.25)%1),o=(i-1.5)*22;ctx.globalAlpha=1-p;ctx.beginPath();const ax=lerp(x0,x1,p),ay=lerp(y0,y1,p)+o;ctx.moveTo(ax,ay);ctx.lineTo(ax+(x1-x0)*.18,ay+(y1-y0)*.18);ctx.stroke()}ctx.restore()}
function bubbles2d(cx,cy,rx,ry,t,n,k=1){const r=rng(21);for(let i=0;i<n;i++){const a=r()*2*PI,d=Math.sqrt(r()),ph=(t*(.8+r())+r())%1;const x=cx+Math.cos(a)*d*rx*.85,y=cy+Math.sin(a)*d*ry*.85;const s=(6+r()*14)*k*Math.sin(ph*PI);
  ctx.strokeStyle='rgba(255,240,200,.95)';ctx.lineWidth=3*k;ctx.fillStyle='rgba(255,220,150,.5)';ctx.beginPath();ctx.arc(x,y,Math.max(.5,s),0,7);ctx.fill();ctx.stroke()}}
function cracks2d(cx,cy,k,p){ctx.save();ctx.strokeStyle='rgba(30,40,40,.9)';ctx.lineWidth=4*k;ctx.lineJoin='round';const r=rng(77);
  for(let b=0;b<6;b++){let x=cx,y=cy,a=b/6*2*PI+r();ctx.beginPath();ctx.moveTo(x,y);const n=Math.floor(6*p);for(let i=0;i<n;i++){a+=(r()-.5)*1.2;x+=Math.cos(a)*22*k;y+=Math.sin(a)*22*k;ctx.lineTo(x,y)}ctx.stroke()}ctx.restore()}
function clockPill(txt,x,y,k=1){ctx.save();ctx.translate(x,y);ctx.scale(k,k);pill('⏱ '+txt,0,0,'#22252C','#FFFFFF',32);ctx.restore()}
function oven(x,z,t,glow){addMesh(mul(T(x,.65,z),S(1.3,1.3,1.0)),cube(),'#A9502E');
  for(let i=0;i<5;i++)addMesh(mul(T(x,.12+i*.27,z+.505),S(1.3,.02,.01)),cube(),'#83391F',{bias:-.05});
  addMesh(mul(T(x,.7,z+.51),S(.8,.62,.02)),cube(),[255*glow+60*(1-glow),140*glow+60*(1-glow),60],{em:1,bias:-.1});
  addMesh(mul(T(x,1.42,z),S(.24,.3,.24)),cyl(8),'#6F6A66');}

// ===== Kit infrastruktur untuk mode narator (jalan, tiang, kabel, dll) =====
const STREET = { aspal:'#4E525B', trotoar:'#C9C3B8', rumput:'#86BD5E', tanah:'#A98758' };
const HOUSES = [[-4.4,'#F2C28B','#B5523B'],[-2.4,'#9FD3C7','#5B6C8F'],[-0.4,'#F5E6A3','#B5523B'],[1.6,'#E8A9A9','#6E5A4A'],[3.6,'#B7C9E8','#B5523B'],[5.6,'#D9E8B0','#5B6C8F']];
const RSt = rng(123);
const BLDG = [...Array(14)].map((_, i) => ({ x: -12 + i * 1.9 + RSt() * .6, h: 2 + RSt() * 4.5, w: 1.3 + RSt() * .8, c: ['#9FB3C8','#B4C3D3','#8EA4BB','#C3CFDB'][i % 4] }));

function streetGround(mood){
  for (let x = -7; x < 7; x += .5) for (let z = -5; z < 3; z += .5) {
    const zc = z + .25; let c = zc < -.6 ? STREET.rumput : zc < -.2 ? STREET.trotoar : zc < 1.4 ? STREET.aspal : zc < 1.8 ? STREET.trotoar : STREET.rumput;
    const v = tileVar[Math.floor((x + 7) * 16 + (z + 5) * 2) % 2000] * .6; c = hex(c).map(q => q * (1 + v));
    addFace([[x,0,z],[x+.5,0,z],[x+.5,0,z+.5],[x,0,z+.5]], c, { n:[0,1,0], L:0, bias:20 });
  }
  for (let x = -7; x < 7; x += 1.1) addFace([[x,.003,.57],[x+.55,.003,.57],[x+.55,.003,.63],[x,.003,.63]], '#F4F1E6', { n:[0,1,0], L:1 });
  [-.2, 1.4].forEach(z => addFace([[-7,.004,z-.02],[7,.004,z-.02],[7,.004,z+.02],[-7,.004,z+.02]], '#9C968C', { n:[0,1,0], L:1 }));
  const layers = [['#A98758',0,-.9],['#94734A',-.9,-1.9],['#7D5F3C',-1.9,-2.9],['#654B2F',-2.9,-4.2]];
  layers.forEach(([c,y0,y1],li) => { for (let x = -7; x < 7; x += 1) addFace([[x,y0,3],[x+1,y0,3],[x+1,y1,3],[x,y1,3]], c, { n:[0,0,1], L:0, bias:5 }); });
  addFace([[-7,0,3.012],[7,0,3.012],[7,-.12,3.012],[-7,-.12,3.012]], '#6B6F78', { n:[0,0,1], L:1 });
  peb.forEach(p => { const pts=[]; for (let i=0;i<8;i++){const a=i/8*2*PI;pts.push([p.x+Math.cos(a)*p.r,p.y+Math.sin(a)*p.r*.65,3.01])} addFace(pts, shadeHex(p.c,.8), { n:[0,0,1], L:1 }); });
}
function house(x, z, wall, roof, s = 1){
  addMesh(mul(T(x,.6*s,z),S(1.6*s,1.2*s,1.2*s)), cube(), wall);
  addMesh(mul(T(x,1.42*s,z+.3*s),Rx(.62),S(1.75*s,.07*s,.78*s)), cube(), roof);
  addMesh(mul(T(x,1.42*s,z-.3*s),Rx(-.62),S(1.75*s,.07*s,.78*s)), cube(), roof);
  addMesh(mul(T(x,1.3*s,z),S(1.6*s,.2*s,.2*s)), cube(), wall);
  addMesh(mul(T(x-.4*s,.4*s,z+.605*s),S(.34*s,.7*s,.02)), cube(), '#7A4A2A', { bias:-.02 });
  addMesh(mul(T(x+.35*s,.72*s,z+.605*s),S(.5*s,.38*s,.02)), cube(), '#A9DDF3', { bias:-.02 });
  addMesh(mul(T(x+.35*s,.72*s,z+.612*s),S(.03,.38*s,.01)), cube(), '#FFFFFF', { bias:-.04 });
  addMesh(mul(T(x+.35*s,.5*s,z+.62*s),S(.58*s,.05,.06)), cube(), '#F4F1E6', { bias:-.03 });
  addMesh(mul(T(x+.35*s,.93*s,z+.62*s),S(.58*s,.04,.05)), cube(), '#F4F1E6', { bias:-.03 });
  addMesh(mul(T(x-.4*s,.03,z+.75*s),S(.5*s,.06,.3*s)), cube(), '#B9B2A6');
  const toren = Math.abs(Math.round(x*10))%3!==1;
  if (toren) { addMesh(mul(T(x+.45*s,1.62*s,z-.15),S(.05,.3,.05)), cube(), '#6F6A66'); addMesh(mul(T(x+.45*s,1.78*s,z-.15),S(.2*s,.34*s,.2*s)), cyl(12), Math.abs(Math.round(x))%2?'#E8792C':'#3B78C4'); addMesh(mul(T(x+.45*s,2.12*s,z-.15),S(.19*s,.05,.19*s)), cyl(12,.4), '#DADADA'); }
  else addMesh(mul(T(x-.82*s,.85*s,z+.15),S(.08,.22,.42)), cube(), '#E6E6E6');
  [-1,1].forEach(d => { addMesh(mul(T(x+d*.55*s,.22,z+1.05*s),S(.5*s,.44,.08)), cube(), d<0?'#D8D2C6':'#D8D2C6'); });
  for (let i = 0; i < 5; i++) addMesh(mul(T(x-.75*s+i*.07,.62,z+1.05*s),S(.025,.4,.025)), cube(), '#3A3A40');
  for (let i = 0; i < 5; i++) addMesh(mul(T(x+.47*s+i*.07,.62,z+1.05*s),S(.025,.4,.025)), cube(), '#3A3A40');
}
function tree(x, z, s = 1){ addMesh(mul(T(x,0,z),S(.08*s,.9*s,.08*s)), cyl(8,.8), '#7A4A22'); [[0,1.2,0,.5],[.25,1.0,.1,.35],[-.22,1.05,-.05,.36]].forEach(([a,b,c,r],i) => addMesh(mul(T(x+a*s,b*s,z+c*s),S(r*s)), sph(9,7,false,i+3,.18), i?'#4DA843':'#3E9338')); }
function streetWorld(t, mood, sc){
  const hide = sc && sc.noHouses;
  BLDG.forEach(b => { addMesh(mul(T(b.x,b.h/2,-9.5),S(b.w,b.h,1.2)), cube(), b.c, { bias:30, noShadow:true });
    for (let r = .5; r < b.h-.3; r += .55) for (let c = -b.w/2+.22; c < b.w/2-.15; c += .32) addFace([[b.x+c,r,-8.89],[b.x+c+.16,r,-8.89],[b.x+c+.16,r+.28,-8.89],[b.x+c,r+.28,-8.89]], '#6F87A3', { n:[0,0,1], L:2, bias:29 }); });
  streetGround(mood);
  if (!hide) HOUSES.forEach(([x,w,r]) => house(x,-1.55,w,r));
  bush(-5.6,-.9,.8); bush(6.3,-.9,.7); bush(-6.2,2.3,.9); bush(5.2,2.4,.8); tree(-3.4,-.75,1.1); tree(4.6,-.75,1.0);
  for (let x = -6.5; x < 7; x += 3.3) ellipseFace(x,.004,.6,.28,.28,'#3A3D44',{L:1,bias:2});
}
// ---- tiang listrik ----
function pole(x, z, h = 3.4){
  addMesh(mul(T(x,0,z),S(.085,h,.085)), cyl(14,.75), '#B9B6AE');
  addMesh(mul(T(x,h-.18,z),S(.08,.07,1.0)), cube(), '#8D8A84');
  [-.42,0,.42].forEach(dz => addMesh(mul(T(x,h-.14,z+dz),S(.035,.09,.035)), cyl(6), '#E8E4DA'));
  return { top:[x,h,z], power:[[x,h-.08,z-.42],[x,h-.08,z],[x,h-.08,z+.42]], tel:y => [x,y,z+.1] };
}
// kabel melengkung (catenary) dari a ke b, digambar per segmen agar urutan kedalaman benar
function wire(a, b, sag, col, w = .025, o = {}){
  const N = 12, P = [];
  for (let i = 0; i <= N; i++){ const u = i/N; const p = vl(a,b,u); p[1] -= sag*4*u*(1-u) + (o.wob?Math.sin(u*PI*3+o.wob)*.04:0); P.push(p); }
  for (let i = 0; i < N; i++){ const p0 = P[i], p1 = P[i+1], m = vl(p0,p1,.5);
    bb(m, () => { const q0 = project(p0), q1 = project(p1); if (q0[2] < .1 || q1[2] < .1) return; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.6, w*(q0[3]+q1[3])/2); ctx.globalAlpha = o.a ?? 1; ctx.beginPath(); ctx.moveTo(q0[0],q0[1]); ctx.lineTo(q1[0],q1[1]); ctx.stroke(); }, { bias: o.bias || 0 }); }
  return P;
}
const KUSUT = ['#1E1E22','#2B2B31','#36363D','#26262C','#3E3E46'];
function cablesBetween(A, B, cfg, t){
  // cfg: {power:true, n:jumlah kabel telekomunikasi, colors:[..], dead:n kabel mati, messy:0..1, drops:true}
  const r = rng(cfg.seed || 5), m = cfg.messy ?? 1;
  if (cfg.power !== false) A.power.forEach((p,i) => wire(p, B.power[i], .18, '#121214', .04));
  const n = cfg.n ?? 10;
  for (let i = 0; i < n; i++){
    const ya = 2.75 - i*.045*(1+m) + (r()-.5)*.12*m, yb = 2.75 - i*.045*(1+m) + (r()-.5)*.12*m;
    const col = cfg.colors ? cfg.colors[i % cfg.colors.length] : KUSUT[i % KUSUT.length];
    wire([A.top[0],ya,A.top[2]+.12+(r()-.5)*.1*m], [B.top[0],yb,B.top[2]+.12+(r()-.5)*.1*m], .2 + r()*.45*m, col, cfg.colors ? .03 : .022, { wob: m>.5 ? r()*6 : 0 });
  }
  for (let i = 0; i < (cfg.dead || 0); i++) wire([A.top[0],2.3-i*.1,A.top[2]+.15], [B.top[0],2.25-i*.12,B.top[2]+.15], .9 + i*.25, '#77777F', .022, { a: .95 });
  if (m > .5) [A,B].forEach(P => { for (let k = 0; k < 2; k++){ const c = [P.top[0]+.0, 2.35-k*.25, P.top[2]+.14]; bb(c, (X,Y,s) => { ctx.strokeStyle = '#1E1E22'; ctx.lineWidth = Math.max(1.5,.02*s); ctx.beginPath(); ctx.ellipse(X,Y,.18*s,.1*s,.2,0,7); ctx.stroke(); ctx.beginPath(); ctx.ellipse(X+2,Y+3,.15*s,.08*s,-.3,0,7); ctx.stroke(); }, { bias:-.05 }); } });
}
function dropToHouse(P, hx, col = '#2B2B31', y = 2.5){ wire([P.top[0],y,P.top[2]+.1], [hx,1.25,-.95], .12, col, .02); }
function odp(x, y, z, col = '#E6E6E6', label){ addMesh(mul(T(x,y,z+.12),S(.26,.32,.14)), cube(), col); addMesh(mul(T(x,y+.08,z+.195),S(.18,.04,.01)), cube(), '#3A6EA5', { bias:-.03 }); }
function trafo(x, z, h = 3.4){
  addMesh(mul(T(x,h-1.05,z+.28),S(.5,.06,.36)), cube(), '#8D8A84');
  addMesh(mul(T(x,h-1.02,z+.28),S(.2,.42,.2)), cyl(10), '#9AA3A8');
  for (let i = 0; i < 5; i++) addMesh(mul(T(x-.2+i*.1,h-.8,z+.28),S(.02,.3,.26)), cube(), '#7F888D');
  addMesh(mul(T(x,h-.58,z+.28),S(.22,.04,.22)), cyl(10), '#6F777C');
}
function motorbike(x, z, t, col = '#D9443B'){
  const m = T(x,0,z);
  [-.32,.32].forEach(dx => addMesh(mul(m,T(dx,.17,-.05),Rx(PI/2),S(.17,.1,.17)), cyl(10), '#202024'));
  addMesh(mul(m,T(0,.36,0),S(.62,.16,.18)), cube(), col);
  addMesh(mul(m,T(-.08,.47,0),S(.36,.06,.16)), cube(), '#26262A');
  addMesh(mul(m,T(.34,.55,0),Rz(-.4),S(.05,.34,.05)), cube(), '#3A3A40');
  addMesh(mul(m,T(-.05,.72,0),S(.18,.34,.2)), cube(), '#3B6FB6');
  addMesh(mul(m,T(-.03,1.0,0),S(.13)), sph(10,8), '#F2C531');
  addMesh(mul(m,T(.08,.6,.0),Rz(-.9),S(.05,.3,.05)), cube(), '#3B6FB6');
}
function excavator(x, z, t, dig = 1){
  const m = mul(T(x,0,z),Ry(.4));
  [-.28,.28].forEach(dz => addMesh(mul(m,T(0,.14,dz),S(1.0,.24,.2)), cube(), '#2E2E33'));
  addMesh(mul(m,T(-.05,.45,0),S(.8,.38,.62)), cube(), '#F2B531');
  addMesh(mul(m,T(-.2,.82,.12),S(.36,.36,.36)), cube(), '#F2B531');
  addMesh(mul(m,T(-.2,.84,.31),S(.3,.26,.01)), cube(), '#A9DDF3', { bias:-.03 });
  const a = -.6 + Math.sin(t*1.8)*.25*dig, b = 1.1 + Math.sin(t*1.8+1)*.3*dig;
  const s0 = mul(m,T(.25,.65,0),Rz(a)); addMesh(mul(s0,T(.55,0,0),S(1.1,.12,.12)), cube(), '#F2B531');
  const s1 = mul(s0,T(1.1,0,0),Rz(-b)); addMesh(mul(s1,T(.4,0,0),S(.8,.1,.1)), cube(), '#E0A52A');
  addMesh(mul(s1,T(.82,-.06,0),Rz(.6),S(.22,.2,.24)), cube(), '#3A3A40');
}
function ductSection(x, y, z, n = 6, colors){
  const cols = colors || ['#E8452C','#3B6FB6','#4CB86A','#F2B531','#9B59B6','#2C2C33'];
  addMesh(mul(T(x,y,z),Rx(PI/2),S(.42,.12,.42)), cyl(18), '#B9B6AE', { bias:-.2 });
  addMesh(mul(T(x,y,z+.122),Rx(PI/2),S(.36,.005,.36)), cyl(18), '#55514B', { bias:-.25 });
  for (let i = 0; i < n; i++){ const a = i/n*2*PI, r = n > 1 ? .17 : 0; addMesh(mul(T(x+Math.cos(a)*r,y+Math.sin(a)*r,z+.13),Rx(PI/2),S(.07,.01,.07)), cyl(10), cols[i % cols.length], { bias:-.3, em:1 }); }
}
function trench(x0, x1, z0, z1){ addFace([[x0,.006,z0],[x1,.006,z0],[x1,.006,z1],[x0,.006,z1]], '#5A4229', { n:[0,1,0], L:1, bias:-100 }); addFace([[x0+.1,.007,z0+.1],[x1-.1,.007,z0+.1],[x1-.1,.007,z1-.1],[x0+.1,.007,z1-.1]], '#3E2C1A', { n:[0,1,0], L:1, bias:-101 }); }

// ---- motor + pengendara tersangkut kabel lalu jatuh ----
function riderFig(m, a){ // a: {lean, legs}
  const B = mul(m, Rz(a.lean||0));
  addMesh(mul(B,T(0,.28,0),S(.3,.52,.26)), cube(), '#3B6FB6');
  addMesh(mul(B,T(0,.66,0),S(.15)), sph(12,9), '#E9B48A');
  addMesh(mul(B,T(0,.7,0),S(.17,.17,.17)), sph(12,8,true), '#F2C531');
  addMesh(mul(B,T(-.12,.68,0),S(.03,.08,.2)), cube(), '#2A2A30', { bias:-.02 });
  [-1,1].forEach(d => { addMesh(mul(B,T(-.18,.36,d*.15),Rz(a.arms??.9),T(0,-.18,0),S(.08,.36,.08)), cube(), '#335FA0');
    addMesh(mul(m,T(-.1,0,d*.1),Rz(a.legs??1.5),T(0,-.2,0),S(.1,.4,.1)), cube(), '#2C2C33'); });
}
function motorCrash(p, sc, lt, t){
  const dur = sc.dur, tc = p.word ? Math.max(.6, wordTime(sc,p.word,sc.start+dur*.42) - sc.start) : dur*(p.at ?? .42), fromX = p.fromX ?? 3.4, cx = p.crossX ?? .45, z = p.z ?? .95, v = (fromX-cx)/tc;
  const dt = lt - tc;
  const T1 = 1.3, dd = clamp(dt,0,T1), bx = dt < 0 ? lerp(fromX,cx,lt/tc) : cx - v*dd*(1-dd/(2*T1));
  const roll = dt < 0 ? Math.sin(t*9)*.02 : Math.min(1,dt/.35)*1.35, bob = dt<0?Math.abs(Math.sin(t*14))*.015:0;
  // motor
  const mb = mul(T(bx,0,z),Rx(roll),T(0,bob,0));
  [-.32,.32].forEach(dx => addMesh(mul(mb,T(dx,.17,0),Rx(PI/2),T(0,-.05,0),S(.17,.1,.17)), cyl(12), '#202024'));
  addMesh(mul(mb,T(0,.36,0),S(.62,.16,.18)), cube(), p.color || '#D9443B');
  addMesh(mul(mb,T(-.08,.47,0),S(.36,.06,.16)), cube(), '#26262A');
  addMesh(mul(mb,T(-.34,.55,0),Rz(.4),S(.05,.34,.05)), cube(), '#3A3A40');
  addMesh(mul(mb,T(-.43,.7,0),S(.04,.04,.36)), cube(), '#3A3A40');
  addMesh(mul(mb,T(-.38,.45,0),S(.06,.1,.1)), cube(), '#FFF6C2', { em:1 });
  // pengendara
  let rx, ry, lean, legs = 1.5, arms = .9;
  if (dt < 0){ rx = bx+.02; ry = .5+bob; lean = .15; }
  else { const k = Math.min(1, dt/.55); rx = cx + .25*Math.min(dt,.4) + .35*k; ry = Math.max(.12, .5 - 2.6*dt*dt + .25*Math.sin(Math.min(dt,.3)/.3*PI)*(dt<.3?1:0)); lean = -(.15 + 1.45*k); legs = 1.5 - 1.2*k; arms = .9 + 1.6*k; }
  riderFig(T(rx,ry,z), { lean, legs, arms });
  // kabel: ketarik saat kena dada pengendara
  const w = sc.props.find(q => q.type === 'wire' && q.id === (p.cable || 'juntai'));
  if (w){ const pull = dt < 0 ? 0 : Math.max(0, 1 - Math.max(0,dt-.35)/.5);
    const chest = [lerp(cx, rx-.05, pull), lerp(w.a[1]-(w.sag??1.4), ry+.45, pull), z];
    if (pull > .02){ wire(w.a, chest, .15*(1-pull)+.05, w.color||'#3A3A42', w.w||.035); wire(chest, w.b, .15*(1-pull)+.05, w.color||'#3A3A42', w.w||.035); }
    else wire(w.a, w.b, (w.sag??1.4)*(1+.08*Math.sin(dt*12)*Math.exp(-dt*2)), w.color||'#3A3A42', w.w||.035); }
  // debu & percikan
  if (dt > .3) sc._post.push(() => { const q = project([rx,.1,z]), r2 = rng(4); for (let i = 0; i < 10; i++){ const ph = clamp((dt-.3)/1.2); ctx.fillStyle = `rgba(190,180,165,${.55*(1-ph)})`; ctx.beginPath(); ctx.arc(q[0]+(r2()-.5)*160*ph, q[1]-r2()*60*ph, (18+r2()*22)*(.5+ph), 0, 7); ctx.fill(); } });
  if (dt > .2 && dt < T1) sc._post.push(() => { const q = project([bx,.05,z]), r3 = rng(Math.floor(t*30)); ctx.strokeStyle = '#FFB547'; ctx.lineWidth = 3; for (let i = 0; i < 6; i++){ const a = r3()*PI; ctx.beginPath(); ctx.moveTo(q[0],q[1]); ctx.lineTo(q[0]+Math.cos(a)*40*r3()+20, q[1]-Math.sin(a)*30*r3()); ctx.stroke(); } });
  return [rx, ry+.6, z];
}

// ===== Model rakitan dari JSON (dirancang AI di naskah) + lingkungan ruangan =====
// spec.models = { nama: { parts: [ {shape, pos, size, rot, color, glow, alpha, blink, text} ] } }
// shape: box | cyl | sphere | cone | disc | ring(sebagai cyl tipis)  — satuan meter, y=0 adalah lantai model
function modelHeight(def){ let h = 0; (def.parts || []).forEach(p => { const pos = p.pos || [0,0,0], sz = p.size || [.2,.2,.2]; h = Math.max(h, pos[1] + sz[1] / 2); }); return h || .5; }
function drawModel(def, m, t, anim = {}, sc){
  if (!def || !Array.isArray(def.parts)) return;
  let M = m;
  if (anim.spin) M = mul(M, Ry(t * anim.spin));
  if (anim.bob) M = mul(M, T(0, Math.sin(t * 3) * anim.bob, 0));
  if (anim.pulse) M = mul(M, S(1 + Math.sin(t * 6) * anim.pulse));
  def.parts.slice(0, 60).forEach((p, idx) => {
    const pos = p.pos || [0,0,0], sz = p.size || [.2,.2,.2], r = p.rot || [0,0,0];
    let col = p.color || '#C9C9C9', em = !!p.glow;
    if (p.blink && Math.sin(t * 8) < 0) { em = false; col = shadeHex(col, .45); }
    const B = mul(M, T(pos[0], pos[1], pos[2]), Ry(r[1] || 0), Rx(r[0] || 0), Rz(r[2] || 0));
    const o = { em, a: p.alpha ?? 1, bias: p.bias ?? -idx * .002 };
    switch (p.shape) {
      case 'cyl': addMesh(mul(B, S(sz[0]/2, sz[1], sz[2]/2), T(0,-.5,0)), cyl(16, p.taper ?? 1), col, o); break;
      case 'cone': addMesh(mul(B, S(sz[0]/2, sz[1], sz[2]/2), T(0,-.5,0)), cyl(16, 0), col, o); break;
      case 'disc': addMesh(mul(B, Rx(PI/2), S(sz[0]/2, sz[2] || .02, sz[1]/2), T(0,-.5,0)), cyl(20), col, o); break;
      case 'sphere': addMesh(mul(B, S(sz[0]/2, sz[1]/2, sz[2]/2)), sph(14,10), col, o); break;
      default: addMesh(mul(B, S(sz[0], sz[1], sz[2])), cube(), col, o);
    }
    if (p.text) { const tp = ap(B, [0, 0, (sz[2] || .02) / 2 + .006]), tx = typeof p.text === 'string' ? { value: p.text } : p.text;
      bb(tp, (X, Y, k) => { const fs = Math.max(8, (tx.size || Math.min(sz[1] * .6, sz[0] / Math.max(3, String(tx.value).length) * 1.7)) * k);
        ctx.font = `800 ${fs}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = tx.color || (em ? '#0F2A1A' : '#22160A'); ctx.fillText(String(tx.value).slice(0, 24), X, Y); }, { bias: -.08 }); }
  });
}
// ---- ruangan (dalam rumah) ----
function roomWorld(t, mood, sc){
  const wall = (sc && sc.wallColor) || '#F1E3C8', floor = (sc && sc.floorColor) || '#C89B6A';
  for (let x = -4; x < 4; x += .5) for (let z = -2; z < 3; z += .5) { const c = hex(((Math.floor(x*2)+Math.floor(z*2)) & 1) ? floor : shadeHex(floor,.93).map(v=>Math.min(255,v)).reduce((s,v)=>s+v.toString(16).padStart(2,'0'),'#'));
    addFace([[x,0,z],[x+.5,0,z],[x+.5,0,z+.5],[x,0,z+.5]], c, { n:[0,1,0], L:0, bias:20 }); }
  addFace([[-4,0,-2],[4,0,-2],[4,3.6,-2],[-4,3.6,-2]], wall, { n:[0,0,1], L:0, bias:15 });
  addFace([[-4,0,-2],[-4,3.6,-2],[-4,3.6,3],[-4,0,3]], shadeHex(wall,.9), { n:[1,0,0], L:0, bias:14 });
  addFace([[4,0,3],[4,3.6,3],[4,3.6,-2],[4,0,-2]], shadeHex(wall,.86), { n:[-1,0,0], L:0, bias:14 });
  addFace([[-4,0,-1.99],[4,0,-1.99],[4,.12,-1.99],[-4,.12,-1.99]], '#FFFFFF', { n:[0,0,1], L:1 });
  // jendela
  addFace([[1.2,1.3,-1.98],[2.8,1.3,-1.98],[2.8,2.6,-1.98],[1.2,2.6,-1.98]], '#FFFFFF', { n:[0,0,1], L:1 });
  addFace([[1.28,1.38,-1.975],[2.72,1.38,-1.975],[2.72,2.52,-1.975],[1.28,2.52,-1.975]], mood === 'dusk' ? '#F2A06A' : '#BFE6FA', { n:[0,0,1], L:1, bias:-1 });
  addFace([[1.98,1.38,-1.97],[2.02,1.38,-1.97],[2.02,2.52,-1.97],[1.98,2.52,-1.97]], '#FFFFFF', { n:[0,0,1], L:1, bias:-2 });
  // stopkontak & saklar
  addMesh(mul(T(-2.6,1.3,-1.97),S(.14,.2,.03)), cube(), '#FFFFFF');
  addMesh(mul(T(-3.0,.4,-1.97),S(.16,.12,.03)), cube(), '#FFFFFF');
}

const CAP_Y=1460,FONT='Inter';
function parseText(s){return s.split(' ').map(w=>{const hl=w.includes('*');w=w.replace(/\*/g,'');return{raw:w,hl,disp:w.replace(/[.,]+$/,'')}})}
function buildCaps(sc,start){
  const words=parseText(sc.text);const lead=.12,span=sc.dur-.25;
  const wt=words.map(w=>w.raw.length+3+(/[.,?!]$/.test(w.raw)?4:0));const tot=wt.reduce((a,b)=>a+b,0);
  let acc=start+lead;words.forEach((w,i)=>{w.t=acc;acc+=wt[i]/tot*span});
  const chunks=[];let cur=[];
  words.forEach((w,i)=>{cur.push(w);const brk=/[.,?!:]$/.test(w.raw)||cur.length>=3;const nxtHl=words[i+1]&&words[i+1].hl&&w.hl;
    if(brk&&!(nxtHl&&cur.length<4)){chunks.push(cur);cur=[]}});
  if(cur.length)chunks.push(cur);
  chunks.forEach((c,i)=>{c.t0=c[0].t;c.t1=chunks[i+1]?chunks[i+1][0].t:start+sc.dur});
  sc.words=words;sc.chunks=chunks;
}
function segs(ws){const out=[];ws.forEach(w=>{const l=out[out.length-1];if(l&&l.hl&&w.hl)l.txt+=' '+w.disp;else out.push({hl:w.hl,txt:w.disp})});return out}
function drawRich(parts,cx,cy,size,scale,align){
  ctx.save();ctx.font=`900 ${size}px ${FONT}`;ctx.textBaseline='middle';
  const gap=size*.28,pad=size*.22;
  const ws=parts.map(p=>ctx.measureText(p.txt).width+(p.hl?pad*2:0));
  const total=ws.reduce((a,b)=>a+b,0)+gap*(parts.length-1);
  ctx.translate(cx,cy);ctx.scale(scale,scale);
  let x=align==='left'?0:-total/2;
  parts.forEach((p,i)=>{
    if(p.hl){rr(x,-size*.68,ws[i],size*1.3,size*.2);ctx.fillStyle='#FFC83D';ctx.fill();ctx.lineWidth=size*.07;ctx.strokeStyle='#2A1B0B';ctx.stroke();ctx.fillStyle='#22160A';ctx.fillText(p.txt,x+pad,size*.03)}
    else{ctx.lineJoin='round';ctx.lineWidth=size*.17;ctx.strokeStyle='#17120E';ctx.strokeText(p.txt,x,size*.03);ctx.fillStyle='#FFFFFF';ctx.fillText(p.txt,x,size*.03)}
    x+=ws[i]+gap});
  ctx.restore();
}
function drawCaption(sc,t){const c=sc.chunks.find(c=>t>=c.t0&&t<c.t1);if(!c)return;const lt=t-c.t0,sg=segs(c);ctx.save();ctx.font='900 76px '+FONT;const wd=sg.reduce((a,p)=>a+ctx.measureText(p.txt).width+(p.hl?76*.44:0),0)+76*.28*(sg.length-1);ctx.restore();const fit=Math.min(1,960/wd);drawRich(sg,W/2,CAP_Y,76,(lt<.14?.82+.18*back(lt/.14):1)*fit)}
function drawLabels(sc,lt){
  if(sc._noLabel){if(sc.tag){ctx.save();ctx.font=`800 28px ${FONT}`;const w=ctx.measureText(sc.tag).width+40;rr(W-58-w,90,w,48,10);ctx.fillStyle='rgba(20,20,28,.82)';ctx.fill();ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(sc.tag,W-58-w+20,115);ctx.restore()}return}
  ctx.save();ctx.font=`800 30px ${FONT}`;ctx.textBaseline='middle';ctx.fillStyle='#FFC83D';ctx.beginPath();ctx.arc(66,112,8,0,7);ctx.fill();
  ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=8;ctx.fillStyle='#fff';ctx.fillText(sc.label.split('').join(String.fromCharCode(8202)),86,113);ctx.restore();
  drawRich(sc.title.map(s=>({hl:s.startsWith('*'),txt:s.replace('*','').trim()})),58,190,58,1,'left');
  if(sc.tag){ctx.save();ctx.font=`800 28px ${FONT}`;const w=ctx.measureText(sc.tag).width+40;rr(W-58-w,90,w,48,10);ctx.fillStyle='rgba(20,20,28,.82)';ctx.fill();ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(sc.tag,W-58-w+20,115);ctx.restore()}
}
function pill(txt,cx,cy,bg,fg,size){ctx.save();ctx.font=`900 ${size}px ${FONT}`;ctx.textBaseline='middle';const w=ctx.measureText(txt).width+size*1.1,h=size*1.75;rr(cx-w/2,cy-h/2,w,h,h*.3);ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#2A1B0B';ctx.stroke();ctx.fillStyle=fg;ctx.textAlign='center';ctx.fillText(txt,cx,cy+2);ctx.restore()}
function wordT(sc,w){const x=sc.words.find(x=>x.disp.toLowerCase().startsWith(w));return x?x.t:sc.start}

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

return{layout,renderFrame,get total(){return TOTAL},W,H};
}
export default createKartun3D;
