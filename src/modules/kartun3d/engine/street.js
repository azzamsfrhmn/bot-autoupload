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
