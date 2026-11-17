// Karakter low-poly PARAMETRIK: kulit, rambut (model+warna), atasan, bawahan, aksesori — tanpa gambar.
import * as THREE from 'three';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f);

/**
 * @param {object} K  { kulit, rambut:{model,warna}, atasan:{model,warna}, bawahan:{model,warna}, aksesori, aksesoriWarna, taring }
 * @returns {{root: THREE.Group, DEF: () => object, apply: (P, t) => void}}
 */
export function makeKarakter(K) {
  const SKIN = lam(K.kulit), SKIN_D = lam(shade(K.kulit, 0.88));
  const HAIR = lam(K.rambut.warna), HAIR_D = lam(shade(K.rambut.warna, 0.86));
  const TOP = lam(K.atasan.warna), TOP_D = lam(shade(K.atasan.warna, 0.82));
  const BOT = lam(K.bawahan.warna), BOT_D = lam(shade(K.bawahan.warna, 0.78));
  const ACC = lam(K.aksesoriWarna), ACC_D = lam(shade(K.aksesoriWarna, 0.78));
  const WHITE = new THREE.MeshLambertMaterial({ color: 0xffffff }), BLACK = new THREE.MeshBasicMaterial({ color: 0x17120f });
  const MOUTH = new THREE.MeshBasicMaterial({ color: 0x4a0d14 }), TONGUE = lam(0xf0777f);
  const pakaiAtasan = K.atasan.model !== 'tanpa';
  // bentuk badan: gemuk = badan lebar & bulat (mis. monster/beruang), kurus = ramping
  const LEBAR = K.badan === 'gemuk' ? 1.45 : K.badan === 'kurus' ? 0.85 : 1;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- kaki ----
  const legs = [-1, 1].map((s) => {
    const piv = new THREE.Group(); piv.position.set(s * 0.15, 0.58, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.09, 0.5, 7), SKIN); leg.position.y = -0.25;
    const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), SKIN); foot.scale.set(0.13, 0.075, 0.22); foot.position.set(0, -0.52, 0.08);
    piv.add(leg, foot);
    if (K.bawahan.model === 'celana') { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.115, 0.26, 7), BOT); p.position.y = -0.1; piv.add(p); }
    body.add(piv); return piv;
  });

  // ---- bawahan ----
  {
    const g = new THREE.Group(); body.add(g);
    if (K.bawahan.model === 'rumput') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.35, 0.36, 10), BOT); c.position.y = 0.68; g.add(c);
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2; const k = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2 + (i % 3) * 0.05, 4), i % 2 ? BOT : BOT_D);
        k.rotation.x = Math.PI; k.position.set(Math.cos(a) * 0.3, 0.43, Math.sin(a) * 0.3); g.add(k);
      }
    } else if (K.bawahan.model === 'rok') {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.14, 10), BOT_D); w.position.y = 0.79; g.add(w);
      const r = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.5, 10, 1, true), lam(K.bawahan.warna, { side: THREE.DoubleSide })); r.position.y = 0.5; g.add(r);
    } else if (K.bawahan.model === 'tanpa') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.34, 10), SKIN); c.position.y = 0.68; c.scale.set(LEBAR, 1, LEBAR); g.add(c);
    } else {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.34, 0.36, 10), BOT); c.position.y = 0.68; g.add(c);
    }
  }

  // ---- badan ----
  const torso = new THREE.Group(); torso.position.y = 0.8; body.add(torso);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(pakaiAtasan ? 0.335 : 0.32, pakaiAtasan ? 0.255 : 0.24, 0.5, 9), pakaiAtasan ? TOP : SKIN); chest.position.y = 0.27; torso.add(chest);
  if (LEBAR !== 1) chest.scale.set(LEBAR, 1 + (LEBAR - 1) * 0.3, LEBAR * 0.95);
  if (K.jenis === 'hewan' && !pakaiAtasan) {
    // hewan: tanpa dada/pusar manusia; perut berwarna lain (mis. perut krem)
    if (K.hewan?.warnaPerut) { const pr = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), lam(K.hewan.warnaPerut)); pr.scale.set(0.22 * LEBAR, 0.25, 0.1); pr.position.set(0, 0.24, 0.215 * LEBAR); torso.add(pr); }
  } else if (!pakaiAtasan) {
    [-1, 1].forEach((s) => { const p = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), SKIN); p.scale.set(1, 0.7, 0.22); p.position.set(s * 0.14, 0.38, 0.235); torso.add(p); });
    const navel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), SKIN_D); navel.position.set(0, 0.12, 0.262); torso.add(navel);
  }
  if (K.atasan.model === 'kemeja') {
    [-1, 1].forEach((s) => { const c = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.13), TOP_D); c.position.set(s * 0.11, 0.53, 0.2); c.rotation.set(-0.5, s * 0.5, 0); torso.add(c); });
    [0.44, 0.32, 0.2].forEach((y) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), WHITE); b.position.set(0, y, 0.32 - (0.44 - y) * 0.15); torso.add(b); });
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 7), SKIN); neck.position.y = 0.56; torso.add(neck);
  if (K.aksesori === 'kalung') {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), ACC); r.rotation.x = Math.PI / 2; r.position.set(0, 0.5, 0.05); torso.add(r);
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), ACC_D); p.position.set(0, 0.4, 0.27); torso.add(p);
  }

  // ---- lengan ----
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.38 * (1 + (LEBAR - 1) * 0.85), 0.46, 0);
    sh.add(new THREE.Mesh(new THREE.SphereGeometry(0.125, 7, 6), pakaiAtasan ? TOP : SKIN));
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.3, 7), pakaiAtasan ? TOP : SKIN); up.position.y = -0.16;
    const el = new THREE.Group(); el.position.y = -0.31;
    const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.28, 7), SKIN); fo.position.y = -0.14;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 7, 6), SKIN); hand.position.y = -0.33;
    el.add(fo, hand); sh.add(up, el); torso.add(sh); return { sh, el, s };
  });

  // ---- kepala ----
  const head = new THREE.Group(); head.position.y = 0.6; torso.add(head);
  const HC = 0.44;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 11), new THREE.MeshLambertMaterial({ color: K.kulit })); skull.scale.set(1.06, 0.95, 1); skull.position.y = HC; head.add(skull);
  const HEWAN = K.jenis === 'hewan' ? K.hewan : null;
  if (!HEWAN || HEWAN.telinga === 'tanpa') [-1, 1].forEach((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), SKIN); e.scale.set(0.5, 1, 0.9); e.position.set(s * 0.52, HC - 0.02, -0.02); head.add(e); });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 5), HEWAN ? new THREE.MeshLambertMaterial({ color: 0x2a1d1a }) : SKIN_D); nose.position.set(0, HC - 0.03, 0.5); head.add(nose);

  const eyes = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(s * 0.185, HC + 0.1, 0.4);
    const open = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), WHITE); white.scale.set(1, 1.12, 0.5);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), BLACK); pupil.position.z = 0.07; pupil.scale.z = 0.5;
    open.add(white, pupil);
    const happy = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.024, 5, 12, Math.PI), BLACK); happy.position.z = 0.06;
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.04, 0.03), BLACK); flat.position.z = 0.07;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.172, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: shade(K.kulit, 0.92) })); lid.scale.set(1.04, 1.16, 0.56);
    g.add(open, happy, flat, lid); head.add(g);
    return { g, open, white, pupil, happy, flat, lid, s };
  });
  const brows = [-1, 1].map((s) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.06), BLACK); b.position.set(s * 0.19, HC + 0.31, 0.42); head.add(b); return b; });

  const mouth = new THREE.Group(); mouth.position.set(0, HC - 0.22, 0.44); head.add(mouth);
  const cav = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), MOUTH);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.05, 0.04), WHITE);
  const fangs = [-1, 1].map((s) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.1, 5), WHITE); f.rotation.x = Math.PI; f.position.set(s * 0.125, 0, 0.03); f.visible = !!K.taring; return f; });
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), TONGUE);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.024, 5, 14, Math.PI), BLACK); smile.rotation.z = Math.PI; smile.position.set(0, 0.07, 0.02);
  const frown = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 5, 12, Math.PI), BLACK); frown.position.set(0, -0.07, 0.02);
  mouth.add(cav, teeth, ...fangs, tongue, smile, frown);

  // ---- rambut (per model) ----
  const hair = new THREE.Group(); hair.position.y = HC; head.add(hair);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const capGeo = (r, polar, phiStart = 0, phiLen = Math.PI * 2) => new THREE.SphereGeometry(r, 12, 8, phiStart, phiLen, 0, polar);
  const spike = (d, h, r, base = 0.4, mat) => {
    d = d.clone().normalize(); const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mat || (rnd() < 0.5 ? HAIR : HAIR_D));
    c.quaternion.setFromUnitVectors(V(0, 1, 0), d); c.position.copy(d).multiplyScalar(base + h / 2 - 0.06); hair.add(c);
  };
  const hewanJambul = K.jenis === 'hewan' && K.rambut.model !== 'botak';
  if (hewanJambul) {
    // hewan: cukup jambul kecil di ubun-ubun (rambut manusia terlalu besar & menutupi telinga)
    [[0, 0.98, 0.1, 0.3], [-0.12, 0.95, 0.02, 0.24], [0.12, 0.95, 0.02, 0.24], [-0.05, 0.96, -0.12, 0.22], [0.06, 0.97, -0.08, 0.22]]
      .forEach(([x, y, z, h], i) => spike(V(x, y, z + 0.12), h, 0.07, 0.44, i % 2 ? HAIR : HAIR_D));
  }
  switch (hewanJambul ? 'botak' : K.rambut.model) {
    case 'jabrik': {
      const cap = new THREE.Mesh(capGeo(0.535, Math.PI * 0.52), HAIR); cap.rotation.x = -0.8; cap.scale.set(1.05, 1, 1.03); hair.add(cap);
      [[0.22, 4], [0.68, 7], [1.12, 9], [1.52, 9]].forEach(([pol, n], ri) => {
        for (let i = 0; i < n; i++) {
          const az = ((i + (ri % 2) * 0.5) / n) * Math.PI * 2;
          const d = V(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
          if (d.z > 0.25 && d.y < 0.62) continue;
          spike(d.clone().add(V(0, 0.18, -0.38)).normalize(), 0.6 + rnd() * 0.4, 0.2, 0.4);
        }
      });
      [[-0.5, -0.25, -0.85], [0.5, -0.25, -0.85], [0, -0.38, -0.95], [-0.82, -0.2, -0.5], [0.82, -0.2, -0.5]].forEach(([x, y, z]) => spike(V(x, y, z), 1.0 + rnd() * 0.25, 0.22, 0.34));
      [[-0.42, 0.72, 0.52], [0, 0.86, 0.5], [0.42, 0.72, 0.52], [-0.2, 0.95, 0.3], [0.22, 0.95, 0.28]].forEach(([x, y, z]) => spike(V(x, y, z), 0.5 + rnd() * 0.15, 0.17, 0.42));
      break;
    }
    case 'bob': {
      const cap = new THREE.Mesh(capGeo(0.55, Math.PI * 0.5), HAIR); cap.scale.set(1.05, 1, 1.03); cap.rotation.x = -0.25; hair.add(cap);
      const side = new THREE.Mesh(capGeo(0.565, Math.PI * 0.8, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6), HAIR_D); side.scale.set(1.04, 1.02, 1.02); hair.add(side);
      [-1.5, -0.5, 0.5, 1.5].forEach((i) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), i % 2 ? HAIR : HAIR_D); f.scale.set(1, 0.85, 0.5); f.position.set(i * 0.18, 0.3 - Math.abs(i) * 0.02, 0.44); hair.add(f); });
      break;
    }
    case 'cepak': {
      const cap = new THREE.Mesh(capGeo(0.54, Math.PI * 0.5), HAIR); cap.rotation.x = -0.5; cap.scale.set(1.05, 0.93, 1.03); hair.add(cap);
      for (let i = 0; i < 14; i++) { const a = rnd() * Math.PI * 2, p = rnd() * 0.75; const d = V(Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a) - 0.15); spike(d, 0.12 + rnd() * 0.08, 0.07, 0.48, HAIR_D); }
      break;
    }
    case 'sanggul': {
      const cap = new THREE.Mesh(capGeo(0.545, Math.PI * 0.56), HAIR); cap.rotation.x = -0.6; cap.scale.set(1.05, 1, 1.03); hair.add(cap);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.23, 9, 7), HAIR_D); bun.position.set(0, 0.4, -0.38); hair.add(bun);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 5, 10), ACC); tie.position.set(0, 0.28, -0.3); tie.rotation.x = 0.9; hair.add(tie);
      [-1, 1].forEach((s) => { const t = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), HAIR); t.scale.set(0.7, 1, 0.8); t.position.set(s * 0.46, 0.0, 0.02); hair.add(t); });
      break;
    }
    case 'panjang': {
      const cap = new THREE.Mesh(capGeo(0.55, Math.PI * 0.5), HAIR); cap.scale.set(1.05, 1, 1.03); cap.rotation.x = -0.25; hair.add(cap);
      // tirai rambut menjuntai di samping & belakang (wajah di depan tetap terbuka)
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.6, 1.0, 14, 1, true, Math.PI * 0.32, Math.PI * 1.36), lam(K.rambut.warna, { side: THREE.DoubleSide }));
      back.position.y = -0.38; hair.add(back);
      const backD = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.9, 12, 1, true, Math.PI * 0.7, Math.PI * 0.6), lam(shade(K.rambut.warna, 0.86), { side: THREE.DoubleSide }));
      backD.position.set(0, -0.42, -0.02); hair.add(backD);
      [-1.5, -0.5, 0.5, 1.5].forEach((i) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), i % 2 ? HAIR : HAIR_D); f.scale.set(1, 0.8, 0.5); f.position.set(i * 0.18, 0.31 - Math.abs(i) * 0.03, 0.44); hair.add(f); });
      break;
    }
    case 'kuncir': {
      const cap = new THREE.Mesh(capGeo(0.545, Math.PI * 0.55), HAIR); cap.rotation.x = -0.55; cap.scale.set(1.05, 1, 1.03); hair.add(cap);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 5, 10), ACC); tie.position.set(0, 0.22, -0.52); tie.rotation.x = 0.4; hair.add(tie);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.85, 7), HAIR_D); tail.position.set(0, -0.15, -0.68); tail.rotation.x = Math.PI - 0.45; hair.add(tail);
      [-0.5, 0.5].forEach((i) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), HAIR); f.scale.set(1.2, 0.7, 0.5); f.position.set(i * 0.3, 0.32, 0.42); hair.add(f); });
      break;
    }
    default: break; // botak
  }

  // ---- aksesori kepala ----
  if (K.aksesori === 'kacamata') {
    [-1, 1].forEach((s) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 16), ACC); r.position.set(s * 0.185, HC + 0.1, 0.5); head.add(r); const a = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.5), ACC); a.position.set(s * 0.34, HC + 0.12, 0.26); head.add(a); });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), ACC); b.position.set(0, HC + 0.12, 0.5); head.add(b);
  } else if (K.aksesori === 'topi') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.3, 12), ACC); t.position.set(0, HC + 0.46, -0.03); t.rotation.x = -0.1; head.add(t);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 14), ACC_D); b.position.set(0, HC + 0.32, -0.03); b.rotation.x = -0.1; head.add(b);
  } else if (K.aksesori === 'bandana') {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.055, 8, 22), ACC); r.rotation.x = Math.PI / 2 + 0.12; r.position.set(0, HC + 0.26, 0); r.scale.set(1.04, 1, 1); head.add(r);
    [-1, 1].forEach((s) => { const k = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), ACC_D); k.position.set(s * 0.14, HC + 0.12, -0.55); k.rotation.set(0.9, 0, s * 0.9); head.add(k); });
  }

  // ---- ciri hewan: telinga, moncong, ekor, pola bulu ----
  const ekor = [];   // segmen ekor (digoyang di apply)
  if (HEWAN) {
    const POLA = lam(HEWAN.warnaPola || '#1c1b19'), MONCONG = lam(HEWAN.warnaMoncong || HEWAN.warnaPerut || shade(K.kulit, 1.18));
    // telinga
    [-1, 1].forEach((s) => {
      let e;
      if (HEWAN.telinga === 'bulat') { e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 7), SKIN); e.scale.set(1, 1, 0.45); e.position.set(s * 0.36, HC + 0.42, -0.05); }
      else if (HEWAN.telinga === 'runcing') { e = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 6), SKIN); e.position.set(s * 0.3, HC + 0.5, -0.02); e.rotation.z = -s * 0.32; }
      else if (HEWAN.telinga === 'panjang') { e = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), SKIN); e.scale.set(0.1, 0.36, 0.06); e.position.set(s * 0.18, HC + 0.78, -0.05); e.rotation.z = -s * 0.15; }
      if (e) head.add(e);
    });
    // moncong
    if (HEWAN.moncong) {
      const mo = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), MONCONG); mo.scale.set(0.24, 0.17, 0.2); mo.position.set(0, HC - 0.12, 0.42); head.add(mo);
      nose.position.set(0, HC - 0.05, 0.62); nose.scale.setScalar(1.15);
      mouth.position.set(0, HC - 0.2, 0.55); mouth.scale.setScalar(0.78);
    }
    // ekor
    const ekorRoot = new THREE.Group(); ekorRoot.position.set(0, 0.66, -0.28); body.add(ekorRoot);
    if (HEWAN.ekor === 'panjang') {
      let parent = ekorRoot;
      for (let i = 0; i < 12; i++) {
        const seg = new THREE.Group(); seg.position.y = i ? 0.2 : 0; parent.add(seg);
        const r = 0.075 - i * 0.003;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, 0.22, 7), (HEWAN.pola === 'totol' && i % 3 === 2) || (HEWAN.pola === 'belang' && i % 2) ? POLA : SKIN); m.position.y = 0.1; seg.add(m);
        ekor.push(seg); parent = seg;
      }
    } else if (HEWAN.ekor === 'lebat') {
      const s = new THREE.Group(); ekorRoot.add(s); const m = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), SKIN); m.scale.set(0.2, 0.45, 0.2); m.position.y = 0.4; s.add(m); ekor.push(s);
    } else if (HEWAN.ekor === 'pendek') {
      const s = new THREE.Group(); ekorRoot.add(s); const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), SKIN); m.position.y = 0.05; s.add(m); ekor.push(s);
    }
    // pola bulu
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const spotGeo = new THREE.SphereGeometry(1, 7, 5);
    const tempel = (grp, pos, normal, r) => { const m = new THREE.Mesh(spotGeo, POLA); m.scale.set(r, r * (0.8 + rnd() * 0.4), r * 0.3); m.position.copy(pos); m.quaternion.setFromUnitVectors(V(0, 0, 1), normal.normalize()); grp.add(m); };
    if (HEWAN.pola === 'totol') {
      for (let i = 0; i < 16; i++) {      // kepala (hindari wajah)
        const a = rnd() * Math.PI * 2, y = rnd() * 1.6 - 0.6; const d = V(Math.cos(a) * Math.sqrt(1 - y * y * 0.6), y, Math.sin(a) * Math.sqrt(1 - y * y * 0.6)).normalize();
        if (d.z > 0.35) continue;
        tempel(head, d.clone().multiply(V(0.53, 0.48, 0.5)).add(V(0, HC, 0)), d.clone(), 0.055 + rnd() * 0.035);
      }
      if (K.atasan.model === 'tanpa') for (let i = 0; i < 18; i++) { const a = rnd() * Math.PI * 2, y = 0.06 + rnd() * 0.44; const r = (0.245 + (y - 0.02) * 0.17) * LEBAR; tempel(torso, V(Math.sin(a) * r, y, Math.cos(a) * r), V(Math.sin(a), 0, Math.cos(a)), 0.045 + rnd() * 0.03); }
      arms.forEach((a) => { for (let i = 0; i < 3; i++) { const an = rnd() * 6.28; tempel(i < 2 ? a.el : a.sh, V(Math.sin(an) * 0.09, i < 2 ? -0.06 - i * 0.12 : -0.14, Math.cos(an) * 0.09), V(Math.sin(an), 0, Math.cos(an)), 0.035); } });
      legs.forEach((l) => { for (let i = 0; i < 3; i++) { const an = rnd() * 6.28; tempel(l, V(Math.sin(an) * 0.105, -0.12 - i * 0.12, Math.cos(an) * 0.105), V(Math.sin(an), 0, Math.cos(an)), 0.04); } });
    } else if (HEWAN.pola === 'belang') {
      const ring = (grp, y, r, tube = 0.03) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 5, 14), POLA); m.rotation.x = Math.PI / 2; m.position.y = y; grp.add(m); };
      if (K.atasan.model === 'tanpa') [0.12, 0.26, 0.4].forEach((y) => ring(torso, y, (0.25 + y * 0.17) * LEBAR));
      arms.forEach((a) => { ring(a.sh, -0.14, 0.09, 0.022); ring(a.el, -0.1, 0.088, 0.022); });
      legs.forEach((l) => { ring(l, -0.15, 0.11, 0.025); ring(l, -0.32, 0.1, 0.025); });
      [-0.3, 0, 0.3].forEach((x) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.5), POLA); b.position.set(x * 0.9, HC + 0.46 - Math.abs(x) * 0.2, -0.12); b.rotation.set(-0.5, 0, -x * 0.6); head.add(b); });
    }
  }

  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });

  // ---------- pose ----------
  const DEF = () => ({
    x: 0, y: 0, z: 0, y0: 0, ry: 0, lie: 0, lean: 0, squash: 0,
    walk: 0, walkPh: 0,
    headRx: 0, headRy: 0, headRz: 0, bodyRy: 0,
    eye: 'open', lid: 0, look: [0, 0], brow: 0, browY: 0,
    mouth: 0, mouthW: 1, mouthMin: 0, smile: 0, sparks: 0,
    armL: { sx: 0, out: 0.12, ex: -0.15 }, armR: { sx: 0, out: 0.12, ex: -0.15 },
  });

  function apply(P, t) {
    root.position.set(P.x, P.y, P.z); root.rotation.y = P.ry;
    const breathe = Math.sin(t * 2.4) * 0.012;
    body.rotation.x = P.lie * Math.PI / 2 + P.lean; body.position.set(0, P.lie * 0.3, 0);
    body.scale.set(1 + P.squash * 0.18, 1 - P.squash * 0.2, 1 + P.squash * 0.18);
    torso.rotation.y = P.bodyRy; torso.scale.set(1, 1 + breathe, 1);
    const w = P.walk, ph = P.walkPh;
    legs[0].rotation.x = Math.sin(ph) * 0.75 * w - (P.kakiR || 0); legs[1].rotation.x = -Math.sin(ph) * 0.75 * w;
    body.position.y += Math.abs(Math.cos(ph)) * 0.06 * w;
    arms.forEach((a, i) => {
      const A = i === 0 ? P.armR : P.armL;
      a.sh.rotation.set(A.sx + (i === 0 ? -1 : 1) * Math.sin(ph) * 0.6 * w * -1, 0, a.s * A.out);
      a.el.rotation.x = A.ex;
    });
    head.rotation.set(P.headRx, P.headRy, P.headRz + Math.sin(t * 1.3) * 0.012);
    // ekor: segmen pertama mengarah ke belakang, sisanya melengkung ke atas & bergoyang
    if (ekor.length > 1) ekor.forEach((s, i) => { s.rotation.x = (i === 0 ? -1.25 : 0.2) + 0.12 * Math.sin(t * 2.2 - i * 0.5); s.rotation.z = 0.1 * Math.sin(t * 1.6 - i * 0.4); });
    else if (ekor.length === 1) { ekor[0].rotation.x = -0.9 + 0.1 * Math.sin(t * 3); ekor[0].rotation.z = 0.15 * Math.sin(t * 2.4); }

    eyes.forEach((e) => {
      const mode = P.eye;
      e.open.visible = mode === 'open' || mode === 'wide'; e.happy.visible = mode === 'happy'; e.flat.visible = mode === 'flat';
      const k = mode === 'wide' ? 1.22 : 1; e.white.scale.set(k, 1.12 * k, 0.5);
      const ps = mode === 'wide' ? 0.62 : 1; e.pupil.scale.set(ps, ps, 0.5);
      e.pupil.position.set(P.look[0] * 0.06, P.look[1] * 0.06, 0.068 + (mode === 'wide' ? 0.012 : 0));
      e.lid.visible = e.open.visible && P.lid > 0.01; e.lid.position.set(0, (0.5 - P.lid) * 0.3, 0.004);
    });
    brows.forEach((b, i) => { const s = i === 0 ? -1 : 1; b.rotation.z = s * P.brow * 0.5; b.position.y = HC + 0.31 + P.browY - Math.abs(P.brow) * 0.02 - P.lid * 0.07; });

    const o = Math.max(P.mouth, P.mouthMin || 0), open = o > 0.06, MO = 0.15;
    cav.visible = open || P.smile === 0; cav.scale.set(0.16 * P.mouthW, open ? 0.025 + MO * o : 0.014, 0.07);
    teeth.visible = o > 0.2; teeth.scale.x = P.mouthW; teeth.position.set(0, (0.025 + MO * o) * 0.6, 0.05);
    fangs.forEach((f) => { f.position.y = open ? (0.025 + MO * o) * 0.6 - 0.065 : -0.03; f.position.x = Math.sign(f.position.x) * 0.125 * P.mouthW; });
    tongue.visible = o > 0.45; tongue.scale.set(0.11 * P.mouthW, 0.06, 0.04); tongue.position.set(0, -(0.025 + MO * o) * 0.55, 0.04);
    smile.visible = !open && P.smile > 0; frown.visible = !open && P.smile < 0;
  }

  return { root, DEF, apply, tangan: arms[0].el };   // tangan = siku lengan P.armR (tempat benda dipegang)
}
