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
