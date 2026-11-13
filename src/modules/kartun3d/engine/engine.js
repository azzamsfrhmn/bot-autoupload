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
