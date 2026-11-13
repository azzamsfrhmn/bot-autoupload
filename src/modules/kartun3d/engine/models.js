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
