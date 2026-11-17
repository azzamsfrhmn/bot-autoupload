// Properti dunia pulau: kepiting pencuri dan kelapa yang jatuh.
import * as THREE from 'three';

const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export function makeCoconut() {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), lam(0x6b4423)); m.castShadow = true; return m;
}

/** benda yang jatuh ke kepala, sesuai tema: kelapa | batu | apel | bolaSalju */
export function makeFallingThing(jenis = 'kelapa') {
  if (jenis === 'batu') { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), lam(0x8f857a)); m.castShadow = true; return m; }
  if (jenis === 'bolaSalju') { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 1), new THREE.MeshLambertMaterial({ color: 0xf6faff })); m.castShadow = true; return m; }
  if (jenis === 'apel') {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), lam(0xd9302a)); g.add(a);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 4), lam(0x5a3a20)); s.position.y = 0.2; g.add(s);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), lam(0x4caf3a)); d.scale.set(1.4, 0.4, 0.7); d.position.set(0.06, 0.22, 0); g.add(d);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; }); return g;
  }
  return makeCoconut();
}

/** dino kecil (zaman batu): badan, leher & kepala, ekor, 4 kaki; mulut bisa membawa benda (carry) */
export function makeDino() {
  const GREEN = lam(0x6aa84f), GREEN_D = lam(0x4f8a3a), BELLY = lam(0xd8e0a0), WHITE = new THREE.MeshLambertMaterial({ color: 0xffffff }), BLACK = new THREE.MeshBasicMaterial({ color: 0x17120f });
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), GREEN); torso.scale.set(0.42, 0.3, 0.3); torso.position.y = 0.45; body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), BELLY); belly.scale.set(0.34, 0.2, 0.22); belly.position.set(0, 0.36, 0.08); body.add(belly);
  const neck = new THREE.Group(); neck.position.set(0.32, 0.55, 0); body.add(neck);
  const n1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.4, 7), GREEN); n1.position.set(0.08, 0.15, 0); n1.rotation.z = -0.5; neck.add(n1);
  const head = new THREE.Group(); head.position.set(0.22, 0.38, 0); neck.add(head);
  const sk = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), GREEN); sk.scale.set(1.3, 0.9, 0.9); head.add(sk);
  [-1, 1].forEach((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 5), WHITE); e.position.set(0.06, 0.08, s * 0.11); const p = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), BLACK); p.position.set(0.1, 0.09, s * 0.13); head.add(e, p); });
  for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), GREEN_D); sp.position.set(0.25 - i * 0.14, 0.76 - Math.abs(i - 1) * 0.03, 0); body.add(sp); }
  const tail = new THREE.Group(); tail.position.set(-0.38, 0.45, 0); body.add(tail);
  const tl = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 7), GREEN); tl.rotation.z = Math.PI / 2 + 0.25; tl.position.set(-0.32, -0.06, 0); tail.add(tl);
  const legs = [];
  [[0.2, 0.15], [0.2, -0.15], [-0.2, 0.15], [-0.2, -0.15]].forEach(([x, z], i) => { const piv = new THREE.Group(); piv.position.set(x, 0.32, z); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.32, 6), GREEN_D); l.position.y = -0.16; piv.add(l); body.add(piv); legs.push([piv, i]); });
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const pose = (ph, carry) => {
    legs.forEach(([p, i]) => { p.rotation.z = 0.5 * Math.sin(ph * 0.5 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)); });
    tail.rotation.y = 0.35 * Math.sin(ph * 0.25); neck.rotation.z = carry ? 0.15 : 0.08 * Math.sin(ph * 0.25); body.position.y = 0.02 * Math.abs(Math.sin(ph * 0.5));
  };
  return { root: g, pose };
}

export function makeCrab() {
  const RED = lam(0xe8492f), RED_D = lam(0xc63a22), WHITE = new THREE.MeshLambertMaterial({ color: 0xffffff }), BLACK = new THREE.MeshBasicMaterial({ color: 0x17120f });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), RED); body.scale.set(0.32, 0.16, 0.22); body.position.y = 0.2; g.add(body);
  [-1, 1].forEach((s) => {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), RED_D); st.position.set(s * 0.1, 0.4, 0.1);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 6), WHITE); e.position.set(s * 0.1, 0.5, 0.1);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), BLACK); p.position.set(s * 0.1, 0.5, 0.15);
    g.add(st, e, p);
  });
  const claws = [-1, 1].map((s) => {
    const piv = new THREE.Group(); piv.position.set(s * 0.3, 0.26, 0.08);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5), RED_D); arm.position.y = 0.1;
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), RED); c.scale.set(1, 1.3, 0.7); c.position.y = 0.26;
    piv.add(arm, c); piv.rotation.z = -s * 0.5; g.add(piv); return piv;
  });
  const legs = [];
  [-1, 1].forEach((s) => [-0.1, 0.0, 0.1].forEach((z, i) => {
    const piv = new THREE.Group(); piv.position.set(s * 0.26, 0.18, z);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.26, 4), RED_D); l.position.set(s * 0.09, -0.08, 0); l.rotation.z = s * 0.9;
    piv.add(l); g.add(piv); legs.push([piv, s, i]);
  }));
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const pose = (ph, carry) => {
    legs.forEach(([p, s, i]) => { p.rotation.z = s * 0.35 * Math.sin(ph + i * 2.1 + (s > 0 ? 0 : Math.PI)); });
    claws.forEach((c, i) => { const s = i ? 1 : -1; c.rotation.z = carry ? s * 0.35 : -s * (0.5 + 0.25 * Math.sin(ph * 0.5 + i)); });
    body.position.y = 0.2 + 0.02 * Math.abs(Math.sin(ph));
  };
  return { root: g, pose };
}
