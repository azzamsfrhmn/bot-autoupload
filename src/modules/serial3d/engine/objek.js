// Pustaka OBJEK untuk adegan (naskah: kalimat.adegan.objek). Semua dari bentuk sederhana low-poly.
// Tiap pembuat mengembalikan { root, parts } — parts = urutan bagian yang muncul saat adegan "bangun".
import * as THREE from 'three';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const basic = (color) => new THREE.MeshBasicMaterial({ color });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const KAYU = 0x8a5a2e, KAYU_D = 0x6e4520, BATU = 0x8f857a;
const finish = (root, parts) => { root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); parts.forEach((p) => { p.userData.s0 = p.scale.clone(); }); return { root, parts }; };

// ---------- bangunan (bisa "dibangun" bertahap) ----------
function tenda() {
  const root = new THREE.Group(), parts = [];
  for (let i = 0; i < 3; i++) { const s = mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 5), lam(KAYU_D), 0, 1.0, 0); s.rotation.set(0.28 * Math.cos(i * 2.1), 0, 0.28 * Math.sin(i * 2.1)); root.add(s); parts.push(s); }
  const kain = mesh(new THREE.ConeGeometry(1.0, 1.9, 6, 1, true), lam(0xd9483b, { side: THREE.DoubleSide }), 0, 0.95, 0); root.add(kain); parts.push(kain);
  const pintu = mesh(new THREE.PlaneGeometry(0.5, 0.8), lam(0x5a1e18, { side: THREE.DoubleSide }), 0, 0.42, 0.62); pintu.rotation.x = -0.3; root.add(pintu); parts.push(pintu);
  const bendera = mesh(new THREE.PlaneGeometry(0.35, 0.22), lam(0xffd23f, { side: THREE.DoubleSide }), 0.18, 2.1, 0); root.add(bendera); parts.push(bendera);
  return finish(root, parts);
}
function gubuk() {
  const root = new THREE.Group(), parts = [];
  [[-0.75, -0.6], [0.75, -0.6], [-0.75, 0.6], [0.75, 0.6]].forEach(([x, z]) => { const t = mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 6), lam(KAYU_D), x, 0.7, z); root.add(t); parts.push(t); });
  const lantai = mesh(new THREE.BoxGeometry(1.7, 0.1, 1.4), lam(KAYU), 0, 0.05, 0); root.add(lantai); parts.push(lantai);
  const belakang = mesh(new THREE.BoxGeometry(1.6, 1.2, 0.08), lam(0xb98a52), 0, 0.7, -0.6); root.add(belakang); parts.push(belakang);
  [-1, 1].forEach((s) => { const w = mesh(new THREE.BoxGeometry(0.08, 1.2, 1.2), lam(0xb98a52), s * 0.78, 0.7, 0); root.add(w); parts.push(w); });
  const atap = mesh(new THREE.ConeGeometry(1.35, 0.8, 4), lam(0xc9a55a), 0, 1.75, 0); atap.rotation.y = Math.PI / 4; atap.scale.z = 0.85; root.add(atap); parts.push(atap);
  return finish(root, parts);
}
function rakit() {
  const root = new THREE.Group(), parts = [];
  for (let i = 0; i < 6; i++) { const l = mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 7), lam(i % 2 ? KAYU : KAYU_D), -0.65 + i * 0.26, 0.14, 0); l.rotation.x = Math.PI / 2; root.add(l); parts.push(l); }
  const tiang = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), lam(KAYU_D), 0, 1.1, -0.2); root.add(tiang); parts.push(tiang);
  const layar = mesh(new THREE.PlaneGeometry(0.9, 1.0), lam(0xf2ead8, { side: THREE.DoubleSide }), 0.45, 1.25, -0.2); root.add(layar); parts.push(layar);
  return finish(root, parts);
}
function apiUnggun() {
  const root = new THREE.Group(), parts = [];
  for (let i = 0; i < 8; i++) { const b = mesh(new THREE.DodecahedronGeometry(0.14, 0), lam(BATU), Math.cos(i * 0.785) * 0.5, 0.07, Math.sin(i * 0.785) * 0.5); root.add(b); parts.push(b); }
  for (let i = 0; i < 4; i++) { const l = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), lam(KAYU_D), 0, 0.12, 0); l.rotation.set(Math.PI / 2, 0, i * Math.PI / 4); l.rotation.order = 'ZXY'; root.add(l); parts.push(l); }
  const nyala = new THREE.Group(); nyala.position.y = 0.3; root.add(nyala); parts.push(nyala);
  [0xffb21c, 0xff6a1a, 0xffd23f].forEach((c, i) => { const f = mesh(new THREE.ConeGeometry(0.2 - i * 0.05, 0.6 - i * 0.12, 5), basic(c)); f.userData.api = i; nyala.add(f); });
  root.userData.update = (t) => nyala.children.forEach((f, i) => { const k = 1 + 0.2 * Math.sin(t * (9 + i * 3) + i); f.scale.set(1, k, 1); f.rotation.y = t * (1 + i); });
  return finish(root, parts);
}
function pagar() {
  const root = new THREE.Group(), parts = [];
  for (let i = 0; i < 5; i++) { const p = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5), lam(KAYU_D), -1 + i * 0.5, 0.5, 0); root.add(p); parts.push(p); const u = mesh(new THREE.ConeGeometry(0.07, 0.15, 5), lam(KAYU_D), -1 + i * 0.5, 1.07, 0); root.add(u); parts.push(u); }
  [0.35, 0.75].forEach((y) => { const r = mesh(new THREE.BoxGeometry(2.2, 0.08, 0.06), lam(KAYU), 0, y, 0.06); root.add(r); parts.push(r); });
  return finish(root, parts);
}
function menara() {
  const root = new THREE.Group(), parts = [];
  for (let lv = 0; lv < 5; lv++) for (let s = 0; s < 2; s++) {
    const l = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), lam(lv % 2 ? KAYU : KAYU_D), 0, 0.09 + lv * 0.36 + s * 0.18, 0);
    l.rotation.set(Math.PI / 2, 0, 0); if ((lv * 2 + s) % 2) { l.rotation.set(0, 0, Math.PI / 2); }
    const off = s ? 0.42 : -0.42; if ((lv * 2 + s) % 2) l.position.z = off; else l.position.x = off; root.add(l); parts.push(l);
    const l2 = l.clone(); if ((lv * 2 + s) % 2) l2.position.z = -off; else l2.position.x = -off; root.add(l2); parts.push(l2);
  }
  const bendera = mesh(new THREE.PlaneGeometry(0.4, 0.25), lam(0xd9483b, { side: THREE.DoubleSide }), 0.2, 2.35, 0); const tiang = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4), lam(KAYU_D), 0, 2.1, 0);
  root.add(tiang, bendera); parts.push(tiang, bendera);
  return finish(root, parts);
}

// ---------- bahaya (adegan "kena") ----------
function kaktus() {
  const root = new THREE.Group(), parts = [], H = lam(0x5f9a3a);
  const batang = mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.1, 8), H, 0, 0.55, 0); root.add(batang); parts.push(batang);
  [-1, 1].forEach((s) => { const a = mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.4, 7), H, s * 0.27, 0.6 + (s > 0 ? 0.1 : 0), 0); const b = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 7), H, s * 0.18, 0.5 + (s > 0 ? 0.1 : 0), 0); b.rotation.z = Math.PI / 2; root.add(a, b); parts.push(a, b); });
  const duri = lam(0xf4f0d8);
  for (let i = 0; i < 26; i++) { const y = 0.12 + (i % 9) * 0.11, an = i * 2.4; const d = mesh(new THREE.ConeGeometry(0.018, 0.09, 3), duri, Math.cos(an) * 0.19, y, Math.sin(an) * 0.19); d.rotation.set(Math.PI / 2 * Math.sin(an), 0, -Math.PI / 2 * Math.cos(an)); root.add(d); }
  const bunga = mesh(new THREE.IcosahedronGeometry(0.08, 0), lam(0xff6a8a), 0, 1.13, 0); root.add(bunga);
  return finish(root, parts);
}
function batuBesar() { const root = new THREE.Group(); const b = mesh(new THREE.DodecahedronGeometry(0.32, 0), lam(BATU), 0, 0.2, 0); b.scale.set(1.3, 0.75, 1); root.add(b); return finish(root, [b]); }
function semak() {
  const root = new THREE.Group(), parts = [];
  [[0, 0.3, 0, 0.38], [0.3, 0.22, 0.1, 0.27], [-0.28, 0.22, 0.05, 0.28]].forEach(([x, y, z, r]) => { const s = mesh(new THREE.IcosahedronGeometry(r, 0), lam(0x3f8a35), x, y, z); root.add(s); parts.push(s); });
  for (let i = 0; i < 14; i++) { const an = i * 2.2; const d = mesh(new THREE.ConeGeometry(0.02, 0.12, 3), lam(0x6e4520), Math.cos(an) * 0.4, 0.15 + (i % 4) * 0.1, Math.sin(an) * 0.3); d.rotation.z = -Math.cos(an) * 1.3; root.add(d); }
  return finish(root, parts);
}

// ---------- benda kecil (dipegang / dimakan / dimasak) ----------
function kelapa() { const root = new THREE.Group(); root.add(mesh(new THREE.IcosahedronGeometry(0.2, 1), lam(0x6b4423))); return finish(root, []); }
function apel() {
  const root = new THREE.Group(); root.add(mesh(new THREE.SphereGeometry(0.17, 9, 7), lam(0xd9302a)));
  root.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 4), lam(0x5a3a20), 0, 0.18, 0)); return finish(root, []);
}
function ikan() {
  const root = new THREE.Group(); const b = mesh(new THREE.SphereGeometry(0.2, 9, 6), lam(0x5aa0d8)); b.scale.set(1.5, 0.75, 0.45); root.add(b);
  const ek = mesh(new THREE.ConeGeometry(0.14, 0.2, 4), lam(0x3f7fb8), -0.36, 0, 0); ek.rotation.z = Math.PI / 2; ek.scale.z = 0.3; root.add(ek);
  root.add(mesh(new THREE.SphereGeometry(0.035, 5, 4), basic(0x111111), 0.2, 0.05, 0.08)); return finish(root, []);
}
function kayu() { const root = new THREE.Group(); const l = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.8, 6), lam(KAYU)); l.rotation.z = Math.PI / 2; root.add(l); return finish(root, []); }
function batu() { const root = new THREE.Group(); root.add(mesh(new THREE.DodecahedronGeometry(0.18, 0), lam(BATU))); return finish(root, []); }
function tombak() {
  const root = new THREE.Group(); root.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), lam(KAYU_D)));
  root.add(mesh(new THREE.ConeGeometry(0.07, 0.25, 4), lam(0x9a9a9a), 0, 0.9, 0)); return finish(root, []);
}
function daun() { const root = new THREE.Group(); const d = mesh(new THREE.SphereGeometry(0.25, 7, 4), lam(0x4caf3a)); d.scale.set(1, 0.12, 0.5); root.add(d); return finish(root, []); }
function jamur() {
  const root = new THREE.Group(); root.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), lam(0xf2ead8)));
  const c = mesh(new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xd9483b), 0, 0.07, 0); root.add(c); return finish(root, []);
}
function telur() { const root = new THREE.Group(); const e = mesh(new THREE.SphereGeometry(0.13, 8, 6), lam(0xf6efe0)); e.scale.y = 1.3; root.add(e); return finish(root, []); }
function hp() { const root = new THREE.Group(); root.add(mesh(new THREE.BoxGeometry(0.16, 0.3, 0.03), lam(0x222222))); root.add(mesh(new THREE.PlaneGeometry(0.13, 0.25), basic(0x8fd3ff), 0, 0, 0.017)); return finish(root, []); }

/** jenis objek: bangunan (besar, bisa dibangun), bahaya (bisa "kena"), benda (dipegang/dimakan) */
export const OBJEK = {
  tenda: { buat: tenda, grup: 'bangunan', lebar: 2.0 },
  gubuk: { buat: gubuk, grup: 'bangunan', lebar: 2.2 },
  rakit: { buat: rakit, grup: 'bangunan', lebar: 2.0 },
  apiUnggun: { buat: apiUnggun, grup: 'bangunan', lebar: 1.2 },
  pagar: { buat: pagar, grup: 'bangunan', lebar: 2.3 },
  menara: { buat: menara, grup: 'bangunan', lebar: 1.4 },
  kaktus: { buat: kaktus, grup: 'bahaya', lebar: 0.8 },
  batuBesar: { buat: batuBesar, grup: 'bahaya', lebar: 0.9 },
  semak: { buat: semak, grup: 'bahaya', lebar: 1.0 },
  kelapa: { buat: kelapa, grup: 'benda' }, apel: { buat: apel, grup: 'benda' }, ikan: { buat: ikan, grup: 'benda' },
  kayu: { buat: kayu, grup: 'benda' }, batu: { buat: batu, grup: 'benda' }, tombak: { buat: tombak, grup: 'benda' },
  daun: { buat: daun, grup: 'benda' }, jamur: { buat: jamur, grup: 'benda' }, telur: { buat: telur, grup: 'benda' }, hp: { buat: hp, grup: 'benda' },
};
export function buatObjek(nama) { const d = OBJEK[nama] || OBJEK.batu; const o = d.buat(); o.def = d; o.nama = nama; return o; }
