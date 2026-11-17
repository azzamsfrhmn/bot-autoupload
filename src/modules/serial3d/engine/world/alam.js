// Dunia alam bertema: satu bentang (daratan + pantai + laut + hutan), TEMA menentukan warna, pohon, properti,
// hewan pengganggu & benda jatuh. Tema: pulau, zamanBatu, hutan, gurun, salju.
// Event (world.direct): kapalTenggelam (pulau), bendaJatuh/kelapaJatuh, hewanLewat/kepitingLewat, papanAngka, gunungMeletus (zamanBatu).
import * as THREE from 'three';
import { clamp, lerp, smooth, rng } from '../lib.js';
import { makeCrab, makeDino, makeFallingThing } from '../props.js';

const R_IN = 30, R_OUT = 72, GRASS_R = 36, SHORE_R = 56.3, STAGE_Z = 43, OFF = STAGE_Z - 16;

export const TEMA = {
  pulau: {
    langit: ['#58aee6', '#9fd4f0', '#e4f5f6'], kabut: 0xd9f0f4, awan: 0xffffff, matahari: 0xfff1d0, hemi: [0xffffff, 0xe6d6a8],
    tanah: { grass: '#a9cf5e', grass2: '#8fc04e', deep: '#6fa83f', sand: '#f3dfa6', sand2: '#ead194', wet: '#d6bf86' },
    laut: { color: 0x2aa9d8, spec: 0x9fe8ff, dangkal: 0x8be9e4 },
    pohon: 'palem', tajuk: ['#2f8a36', '#3b9a3c', '#4aa843', '#2a7a34', '#5bb24a', '#3f9140'], batang: 0x6f4a28, jmlPohon: 520,
    semak: ['#4f9f3a', '#66b548', '#3d8f37'], rumput: ['#5fa838', '#7dbb45'], bunga: ['#ffffff', '#ffd23f', '#b9a4ff', '#ff9ac6', '#8fd3ff'],
    batu: [0xa9a497, 0x8f8a80], jmlBatu: 70, kemah: 'rakit', papan: 'kayu', hewan: 'kepiting', benda: 'kelapa', kapal: true,
  },
  zamanBatu: {
    langit: ['#e8945a', '#f4c58c', '#fbe6c4'], kabut: 0xf2d6b0, awan: 0xf6e7d8, matahari: 0xffe0b0, hemi: [0xfff3e0, 0xc9a77a],
    tanah: { grass: '#a7a85a', grass2: '#8d8f45', deep: '#6f7a38', sand: '#d9b98a', sand2: '#c9a571', wet: '#b08f62' },
    laut: { color: 0x2f8f9c, spec: 0xbfe8e0, dangkal: 0x7fcfc4 },
    pohon: 'pakis', tajuk: ['#4c7a2a', '#5e8a30', '#3f6b25', '#6f9a38', '#557f2c'], batang: 0x6a4a2c, jmlPohon: 360,
    semak: ['#6d8a35', '#7f9a3e', '#5a7a2c'], rumput: ['#8a9a40', '#9fae4c'], bunga: ['#ffcf5a', '#e86a3a', '#ffffff'],
    batu: [0x9a8f84, 0x7f756c], jmlBatu: 150, batuBesar: true, kemah: 'tenda', papan: 'batu', hewan: 'dino', benda: 'batu', gunung: true,
  },
  hutan: {
    langit: ['#5fa8d8', '#a8d6ec', '#e2f2ea'], kabut: 0xcfe6d6, awan: 0xffffff, matahari: 0xfff4d6, hemi: [0xffffff, 0xb7c99a],
    tanah: { grass: '#7fbf4a', grass2: '#69ad3c', deep: '#4f8f30', sand: '#c9b07a', sand2: '#b89d68', wet: '#a68c5c' },
    laut: { color: 0x3a9fc0, spec: 0x9fe8ff, dangkal: 0x8adcd0 },
    pohon: 'pinus', tajuk: ['#2c6e2e', '#357a34', '#2a6430', '#3f8a3a', '#24582a'], batang: 0x5a3e24, jmlPohon: 700,
    semak: ['#3f8a35', '#4f9a3f', '#2f7a30'], rumput: ['#4f9a30', '#68ad3c'], bunga: ['#ffffff', '#ff6a8a', '#ffd23f', '#9a7aff'],
    batu: [0x8f948a, 0x7a8078], jmlBatu: 60, kemah: 'tenda', papan: 'kayu', hewan: 'kepiting', benda: 'apel',
  },
  gurun: {
    langit: ['#4f9fe0', '#9dccf0', '#f2e6cf'], kabut: 0xf0e2c4, awan: 0xfffaf0, matahari: 0xfff0c8, hemi: [0xffffff, 0xe8c896],
    tanah: { grass: '#e2c27e', grass2: '#d6b26a', deep: '#c9a25a', sand: '#f0d59a', sand2: '#e6c482', wet: '#c9a86e' },
    laut: { color: 0x2a9fc8, spec: 0xbfefff, dangkal: 0x8be0d8 },
    pohon: 'kaktus', tajuk: ['#7a9a40', '#8aa84a', '#6a8a36'], batang: 0x7a5a34, jmlPohon: 40,
    semak: ['#a8a050', '#b8b060', '#98904a'], rumput: ['#c9b060', '#b8a050'], bunga: ['#ff6a8a', '#ffd23f', '#ffffff'],
    batu: [0xc9a27a, 0xb08a64], jmlBatu: 90, batuBesar: true, kemah: 'tenda', papan: 'kayu', hewan: 'kepiting', benda: 'kelapa',
  },
  salju: {
    langit: ['#7fa8d8', '#c4dbef', '#f2f6fa'], kabut: 0xe6eef6, awan: 0xffffff, matahari: 0xf4f8ff, hemi: [0xffffff, 0xc8d4e4],
    tanah: { grass: '#f2f6fa', grass2: '#e2eaf2', deep: '#d4dee9', sand: '#e8eef4', sand2: '#d8e2ec', wet: '#b8c8d8' },
    laut: { color: 0x3a7fb8, spec: 0xe0f4ff, dangkal: 0xa8d4ec },
    pohon: 'pinusSalju', tajuk: ['#2c5e40', '#356a48', '#28543a'], batang: 0x4f3a28, jmlPohon: 420,
    semak: ['#e8f0f6', '#d8e4ee', '#c8d6e4'], rumput: ['#e8eef4', '#d8e2ec'], bunga: ['#ffffff', '#cfe4ff'],
    batu: [0xa8b0b8, 0x8a929a], jmlBatu: 70, kemah: 'tenda', papan: 'kayu', hewan: 'kepiting', benda: 'bolaSalju', turunSalju: true,
  },
};

// Waktu (seri.waktu): menimpa langit, kabut, cahaya. siang = warna asli tema.
export const WAKTU = {
  pagi: { langit: ['#7fb6e6', '#f6c9b0', '#fde9d2'], kabut: 0xf3dccb, awan: 0xfff1e6, matahari: 0xffeedd, hemi: [0xfffaf4, null], hemiI: 1.6, sunI: 2.1 },
  siang: {},
  sore: { langit: ['#5a4f9e', '#f08a5d', '#ffc77a'], kabut: 0xf2a873, awan: 0xffc8a0, matahari: 0xffc890, hemi: [0xfff0e2, null], hemiI: 1.5, sunI: 2.1 },   // hangat tapi tanah tetap warna aslinya (salju tetap putih)
  malam: { langit: ['#070b22', '#16245a', '#2e3f78'], kabut: 0x1c2852, awan: 0x3a4670, matahari: 0x9fb8ff, hemi: [0x7f94d0, 0x2a2a40], hemiI: 0.95, sunI: 0.75, bintang: true, lampu: true, kabutJauh: 420 },
  hujan: { langit: ['#5d6873', '#8a949c', '#a9b1b6'], kabut: 0x9aa3a9, awan: 0x7d868d, matahari: 0xdfe6ee, hemi: [0xdfe6ee, 0x6a7066], hemiI: 1.45, sunI: 0.9, hujan: true, kabutJauh: 300 },
};

export function hAt(x, z) {
  const r = Math.hypot(x, z);
  let h = 1.9 * (1 - smooth(R_IN, R_OUT, r)) - 0.55;
  h += 5.5 * Math.exp(-((x + 9) ** 2 + (z + 12) ** 2) / 420);
  h += 3.2 * Math.exp(-((x - 18) ** 2 + (z + 2) ** 2) / 160);
  h += 2.2 * Math.exp(-((x + 22) ** 2 + (z - 10) ** 2) / 120);
  h += 0.12 * Math.sin(x * 0.5) * Math.cos(z * 0.45) * smooth(R_OUT, R_IN, r);
  return h;
}
const grassEdge = (x, z) => { const a = Math.atan2(z, x); return GRASS_R + 2.6 * Math.sin(a * 5) + 1.3 * Math.sin(a * 11 + 1) + 0.8 * Math.sin(a * 23); };
const isGrass = (x, z) => Math.hypot(x, z) < grassEdge(x, z);
const clearing = (x, z) => (Math.abs(x) < 5 && z > STAGE_Z - 8) || Math.hypot(x, z - STAGE_Z) < 6.5;
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
function shadow(o, cast = true, recv = false) { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; }

/**
 * @param {THREE.Scene} scene
 * @param {{seed?:number, papan?:{judul:string, angka:number}|null, tema?:string}} opts
 */
export function buildAlam(scene, opts = {}) {
  const T0 = TEMA[opts.tema] || TEMA.pulau;
  const WK = WAKTU[opts.waktu] || WAKTU.siang;
  const T = { ...T0, langit: WK.langit || T0.langit, kabut: WK.kabut ?? T0.kabut, awan: WK.awan ?? T0.awan, matahari: WK.matahari ?? T0.matahari,
    hemi: WK.hemi ? [WK.hemi[0], WK.hemi[1] ?? T0.hemi[1]] : T0.hemi };
  const R = rng(opts.seed ?? 7);
  const upd = [];

  // langit & cahaya
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 512;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, T.langit[0]); gr.addColorStop(0.45, T.langit[1]); gr.addColorStop(0.62, T.langit[2]); gr.addColorStop(1, T.langit[2]);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
    if (WK.bintang) {   // bintang: kanvas lebih lebar supaya titiknya tidak melar
      c.width = 256; g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
      const RS = rng(99);
      for (let i = 0; i < 260; i++) { const y = RS() * 300; g.fillStyle = `rgba(255,255,255,${(0.35 + RS() * 0.65) * (1 - y / 330)})`; g.fillRect(RS() * 256, y, 1, 0.5 + RS() * 0.6); }
      g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(196, 70, 9, 0, Math.PI * 2); g.fill();   // bulan
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex; scene.fog = new THREE.Fog(T.kabut, 170, WK.kabutJauh || 620);
  }
  scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], WK.hemiI ?? 1.75));
  const sun = new THREE.DirectionalLight(T.matahari, WK.sunI ?? 2.3);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 420; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const setShadow = (cx, cz, half) => {
    sun.target.position.set(cx, 0, cz); sun.position.set(cx - 60, 95, cz + 82);
    const c = sun.shadow.camera; if (c.right !== half) { c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.updateProjectionMatrix(); }
  };
  setShadow(0, STAGE_Z, 20);

  // daratan
  {
    const geo = new THREE.PlaneGeometry(170, 170, 150, 150); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)));
    const g2 = geo.toNonIndexed(); const q = g2.attributes.position;
    const col = new Float32Array(q.count * 3);
    const C = Object.fromEntries(Object.entries(T.tanah).map(([k, v]) => [k, new THREE.Color(v)]));
    const tmp = new THREE.Color();
    for (let i = 0; i < q.count; i += 3) {
      const cx = (q.getX(i) + q.getX(i + 1) + q.getX(i + 2)) / 3, cz = (q.getZ(i) + q.getZ(i + 1) + q.getZ(i + 2)) / 3, cy = (q.getY(i) + q.getY(i + 1) + q.getY(i + 2)) / 3;
      const v = R();
      if (isGrass(cx, cz)) tmp.copy(C.grass).lerp(C.grass2, v).lerp(C.deep, smooth(GRASS_R - 3, GRASS_R - 16, Math.hypot(cx, cz)) * 0.75);
      else if (cy < 0.22) tmp.copy(C.wet).lerp(C.sand2, clamp(cy / 0.22) * 0.6);
      else tmp.copy(C.sand).lerp(C.sand2, v * 0.7);
      for (let k = 0; k < 3; k++) tmp.toArray(col, (i + k) * 3);
    }
    g2.setAttribute('color', new THREE.BufferAttribute(col, 3)); g2.computeVertexNormals();
    const m = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true; scene.add(m);
  }
  // laut
  {
    const geo = new THREE.PlaneGeometry(1500, 1500, 90, 90).toNonIndexed(); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; const base = p.array.slice();
    const mat = new THREE.MeshPhongMaterial({ color: T.laut.color, flatShading: true, shininess: 90, specular: T.laut.spec, transparent: true, opacity: 0.93 });
    const sea = new THREE.Mesh(geo, mat); sea.receiveShadow = true; scene.add(sea);
    upd.push((t) => {
      for (let i = 0; i < p.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; p.array[i * 3 + 1] = 0.16 * Math.sin(x * 0.21 + t * 1.1) + 0.13 * Math.cos(z * 0.17 + t * 0.9) + 0.07 * Math.sin((x + z) * 0.4 + t * 1.7); }
      p.needsUpdate = true; geo.computeVertexNormals();
    });
    const shallow = new THREE.Mesh(new THREE.CircleGeometry(R_OUT - 1, 64), new THREE.MeshBasicMaterial({ color: T.laut.dangkal, transparent: true, opacity: 0.55, depthWrite: false }));
    shallow.rotation.x = -Math.PI / 2; shallow.position.y = 0.2; scene.add(shallow);
    const foam = new THREE.Mesh(new THREE.RingGeometry(SHORE_R - 0.9, SHORE_R + 0.2, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = 0.24; scene.add(foam);
    upd.push((t) => { const s = 1 + 0.008 * Math.sin(t * 1.3); foam.scale.set(s, s, 1); foam.material.opacity = 0.55 + 0.3 * Math.sin(t * 1.3 + 1); shallow.position.y = 0.2 + 0.03 * Math.sin(t * 1.3); });
  }
  // awan
  {
    const mat = lam(T.awan); const clouds = new THREE.Group(); scene.add(clouds);
    for (let i = 0; i < 20; i++) {
      const g = new THREE.Group(); const n = 4 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(5 + R() * 6, 1), mat); s.position.set((k - n / 2) * 7 + R() * 3, R() * 3, R() * 5); s.scale.y = 0.62; g.add(s); }
      const a = (i / 20) * Math.PI * 2 + R() * 0.3, d = 200 + R() * 160;
      g.position.set(Math.cos(a) * d, 55 + R() * 45, Math.sin(a) * d); g.userData.bx = g.position.x; g.userData.sp = 0.4 + R() * 0.7; clouds.add(g);
    }
    upd.push((t) => clouds.children.forEach((c) => { c.position.x = c.userData.bx + t * c.userData.sp; }));
  }
  // gunung berapi (zaman batu) di kejauhan
  let gunung = null;
  if (T.gunung) {
    gunung = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(34, 46, 9, 1, true), lam(0x6b5040)); cone.position.y = 18; gunung.add(cone);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 8, 3, 9), lam(0xff6a2a, { emissive: 0xff4a10, emissiveIntensity: 0.6 })); top.position.y = 40; gunung.add(top);
    const asap = new THREE.Group(); gunung.add(asap);
    const am = lam(0x8a8078, { transparent: true, opacity: 0.85 });
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + R() * 3, 1), am); s.userData = { ph: i / 9, dx: (R() - 0.5) * 6 }; asap.add(s); }
    gunung.userData.asap = asap; gunung.userData.lava = top;
    gunung.scale.setScalar(1.5); gunung.position.set(-110, -3, -170); scene.add(shadow(gunung));
  }

  // pepohonan
  const spot = (maxR, minR = 0, needGrass = true) => {
    for (let i = 0; i < 400; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(lerp((minR / maxR) ** 2, 1, R())) * maxR; const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (needGrass && !isGrass(x, z)) continue; if (clearing(x, z)) continue; return [x, z];
    }
    return [0, 0];
  };
  const crowns = [];
  const trunkM = lam(T.batang), trunkM2 = lam(new THREE.Color(T.batang).multiplyScalar(0.85));
  const leafA = lam(T.tajuk[0], { side: THREE.DoubleSide }), leafB = lam(T.tajuk[Math.min(4, T.tajuk.length - 1)], { side: THREE.DoubleSide });
  const leafGeoA = new THREE.ConeGeometry(0.5, 1, 4), leafGeoB = new THREE.ConeGeometry(0.36, 1, 4), cocoGeo = new THREE.IcosahedronGeometry(0.22, 1), cocoM = lam(0x6b4423);
  function palm(x, z, H, lean, ry, pakis = false) {
    const g = new THREE.Group(); g.position.set(x, hAt(x, z) - 0.1, z); g.rotation.y = ry;
    if (pakis) H *= 0.55;
    const n = 6; let prev = new THREE.Vector3(0, 0, 0);
    for (let i = 1; i <= n; i++) {
      const k = i / n; const cur = new THREE.Vector3(lean * k * k * (pakis ? 0.3 : 1), H * k, 0);
      const w = pakis ? 0.34 : 0.2;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(w - k * 0.07, w + 0.04 - k * 0.07, cur.distanceTo(prev) * 1.04, 6), i % 2 ? trunkM : trunkM2);
      seg.position.copy(prev).add(cur).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cur.clone().sub(prev).normalize()); g.add(seg); prev = cur;
    }
    const crown = new THREE.Group(); crown.position.copy(prev); g.add(crown);
    const nl = pakis ? 12 : 8;
    for (let i = 0; i < nl; i++) {
      const piv = new THREE.Group(); piv.rotation.y = (i / nl) * Math.PI * 2 + R() * 0.3; const L = (pakis ? 2.6 : 2.3) + R() * 0.9;
      const a = new THREE.Mesh(leafGeoA, i % 2 ? leafA : leafB); a.scale.set(pakis ? 0.7 : 1, L, 0.1); a.rotation.z = -(Math.PI / 2 + (pakis ? -0.35 : 0.05) + R() * 0.2); a.position.set(L * 0.42, pakis ? 0.5 : 0.05, 0);
      const b = new THREE.Mesh(leafGeoB, i % 2 ? leafB : leafA); b.scale.set(1, L * 0.75, 0.1); b.rotation.z = -(Math.PI / 2 + 0.95); b.position.set(L * 0.95, -L * 0.36 + (pakis ? 0.6 : 0), 0);
      piv.add(a, b); crown.add(piv);
    }
    if (!pakis && T.benda === 'kelapa') for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(cocoGeo, cocoM); c.position.set(Math.cos(i * 2.1) * 0.25, -0.22, Math.sin(i * 2.1) * 0.25); crown.add(c); }
    shadow(g); scene.add(g); crowns.push([crown, R() * 6]);
  }
  const pinusLeaf = lam(T.tajuk[0]), pinusLeaf2 = lam(T.tajuk[1] || T.tajuk[0]), saljuM = lam(0xf4f8fc);
  function pinus(x, z, H, salju = false) {
    const g = new THREE.Group(); g.position.set(x, hAt(x, z) - 0.1, z);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, H * 0.35, 6), trunkM); tr.position.y = H * 0.17; g.add(tr);
    for (let i = 0; i < 3; i++) {
      const r = (1.9 - i * 0.5) * (H / 7), h = H * 0.42;
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), i % 2 ? pinusLeaf2 : pinusLeaf); c.position.y = H * 0.3 + i * H * 0.2 + h / 2; g.add(c);
      if (salju) { const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.45, 7), saljuM); s.position.y = c.position.y + h * 0.3; g.add(s); }
    }
    shadow(g); scene.add(g); crowns.push([g, R() * 6, 0.25]);
  }
  const kaktusM = lam(0x5f9a3a);
  function kaktus(x, z, H) {
    const g = new THREE.Group(); g.position.set(x, hAt(x, z) - 0.1, z); g.rotation.y = R() * 6;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, H, 8), kaktusM); b.position.y = H / 2; g.add(b);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), kaktusM); tip.position.y = H; g.add(tip);
    [-1, 1].forEach((s, i) => {
      const y = H * (0.4 + i * 0.15), L = H * 0.3;
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 7), kaktusM); a.rotation.z = Math.PI / 2; a.position.set(s * 0.6, y, 0); g.add(a);
      const u = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, L, 7), kaktusM); u.position.set(s * 0.95, y + L / 2, 0); g.add(u);
    });
    shadow(g); scene.add(g);
  }
  const pohonDekat = (x, z, H, lean, ry) => {
    if (T.pohon === 'palem') palm(x, z, H, lean, ry);
    else if (T.pohon === 'pakis') palm(x, z, H, lean, ry, true);
    else if (T.pohon === 'pinus') pinus(x, z, H * 1.3);
    else if (T.pohon === 'pinusSalju') pinus(x, z, H * 1.3, true);
    else if (T.pohon === 'kaktus') kaktus(x, z, 1.8 + H * 0.25);
  };
  [[-6.5, 9.5, 6.4, 1.6, 0.3], [-4.6, 5.5, 7.6, -1.2, 2.2], [5.8, 8.6, 6.8, 1.5, -0.6], [8.4, 4.5, 5.6, 1.9, 0.2], [-9.5, 7.5, 6.2, 1.3, 3.0], [10.5, 9.5, 5.2, 2.1, -0.9], [-12.5, 11, 5.4, 2.0, 2.7], [13.5, 6.5, 6, 1.4, 1.2]]
    .forEach(([x, z, ...r]) => pohonDekat(x, z + OFF, ...r));
  for (let i = 0; i < (T.pohon === 'kaktus' ? 30 : 95); i++) { const [x, z] = spot(GRASS_R + 3, i < 40 ? GRASS_R - 9 : 0); pohonDekat(x, z, 5.2 + R() * 3.6, (R() - 0.5) * 4, R() * 6.28); }
  if (T.pohon === 'palem') for (let i = 0; i < 16; i++) { const a = R() * 6.28, r = GRASS_R + 4 + R() * 7; const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!clearing(x, z) && Math.abs(x) > 9) palm(x, z, 4.6 + R() * 2.5, 1.5 + R() * 1.5, a + Math.PI); }
  upd.push((t) => crowns.forEach(([c, ph, k = 1]) => { c.rotation.z = 0.05 * k * Math.sin(t * 1.2 + ph); c.rotation.x = 0.04 * k * Math.sin(t * 0.9 + ph); }));
  // hutan instanced
  {
    const N = T.jmlPohon; const d = new THREE.Object3D(); const c = new THREE.Color();
    const conic = T.pohon === 'pinus' || T.pohon === 'pinusSalju';
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 1, 6), lam(T.batang), N);
    const can = new THREE.InstancedMesh(conic ? new THREE.ConeGeometry(1, 2.2, 7) : new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), N * 3);
    for (let i = 0; i < N; i++) {
      const [x, z] = spot(GRASS_R + 1.5, i < N / 3 ? GRASS_R - 7 : 0); const y = hAt(x, z); const H = 3.2 + R() * 4.2, cr = 1.5 + R() * 1.4;
      d.position.set(x, y + H / 2 - 0.1, z); d.scale.set(1 + R() * 0.6, H, 1 + R() * 0.6); d.rotation.set(0, R() * 6, 0); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix);
      for (let k = 0; k < 3; k++) {
        if (conic) { const s = cr * (1 - k * 0.25); d.position.set(x, y + H + k * cr * 0.9 - cr * 0.6, z); d.scale.set(s, s, s); d.rotation.set(0, R() * 6, 0); }
        else { const s = cr * (k === 0 ? 1 : 0.62 + R() * 0.25); const a = R() * 6.28; d.position.set(x + (k ? Math.cos(a) * cr * 0.7 : 0), y + H + (k ? -cr * 0.25 + R() * cr * 0.5 : cr * 0.35), z + (k ? Math.sin(a) * cr * 0.7 : 0)); d.scale.set(s, s * (0.78 + R() * 0.2), s); d.rotation.set(R() * 3, R() * 3, R() * 3); }
        d.updateMatrix(); can.setMatrixAt(i * 3 + k, d.matrix);
        can.setColorAt(i * 3 + k, c.set(T.pohon === 'pinusSalju' && k === 2 ? '#f4f8fc' : T.tajuk[Math.floor(R() * T.tajuk.length)]));
      }
    }
    trunk.castShadow = can.castShadow = true; can.receiveShadow = true; scene.add(trunk, can);
  }
  // semak
  {
    const N = 700; const d = new THREE.Object3D(); const c = new THREE.Color();
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), N);
    for (let i = 0; i < N; i++) {
      let [x, z] = spot(GRASS_R + 2.5, i < 260 ? GRASS_R - 5 : 0); if (i < 30) { x = (R() - 0.5) * 18; z = STAGE_Z - 9 - R() * 4; }
      const s = 0.5 + R() * 0.9; d.position.set(x, hAt(x, z) + s * 0.4, z); d.scale.set(s * (1 + R() * 0.5), s * 0.8, s * (1 + R() * 0.5)); d.rotation.set(R() * 3, R() * 3, R() * 3); d.updateMatrix();
      bush.setMatrixAt(i, d.matrix); bush.setColorAt(i, c.set(T.semak[Math.floor(R() * T.semak.length)]));
    }
    bush.castShadow = true; bush.receiveShadow = true; scene.add(bush);
  }
  // rumput, bunga, batu
  {
    const N = 7000; const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.42, 4), new THREE.MeshLambertMaterial({ flatShading: true }), N);
    const d = new THREE.Object3D(); const c = new THREE.Color(); let n = 0;
    while (n < N) {
      let x, z; if (n < 1800) { x = (R() - 0.5) * 34; z = STAGE_Z - 1 - R() * 22; } else { const a = R() * 6.28, r = Math.sqrt(R()) * (GRASS_R + 4); x = Math.cos(a) * r; z = Math.sin(a) * r; }
      if (!isGrass(x, z) && !(Math.hypot(x, z) < GRASS_R + 4 && R() < 0.12)) continue;
      const s = 0.6 + R() * 1.1; d.position.set(x, hAt(x, z) + 0.18 * s, z); d.scale.set(s, s, s); d.rotation.set((R() - 0.5) * 0.3, R() * 6, (R() - 0.5) * 0.3); d.updateMatrix();
      tuft.setMatrixAt(n, d.matrix); tuft.setColorAt(n, c.set(T.rumput[n % T.rumput.length])); n++;
    }
    scene.add(tuft);
    const F = 900; const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshLambertMaterial({ flatShading: true }), F); n = 0;
    while (n < F) {
      let x, z; if (n < 300) { x = (R() - 0.5) * 30; z = STAGE_Z - 2 - R() * 18; } else { const a = R() * 6.28, r = Math.sqrt(R()) * GRASS_R; x = Math.cos(a) * r; z = Math.sin(a) * r; }
      if (!isGrass(x, z)) continue;
      d.position.set(x, hAt(x, z) + 0.2 + R() * 0.15, z); d.scale.setScalar(0.7 + R() * 0.8); d.rotation.set(0, 0, 0); d.updateMatrix(); fl.setMatrixAt(n, d.matrix); fl.setColorAt(n, c.set(T.bunga[Math.floor(R() * T.bunga.length)])); n++;
    }
    scene.add(fl);
    const rockM = lam(T.batu[0]), rockM2 = lam(T.batu[1]);
    const rocks = [[3.8, 14.2, 0.7], [-2.6, 13.6, 0.5], [6.5, 16.8, 0.9], [-7.5, 15.5, 1.1], [9, 12.5, 0.8], [-10.5, 11.5, 0.7], [-4, 19.5, 0.45], [7.8, 19.3, 0.5]].map(([x, z, s]) => [x, z + OFF, s]);
    if (T.batuBesar) [[-8.5, 4, 2.4], [9.5, 3, 2.0], [-13, 9, 3.0], [14, 10, 2.6]].forEach(([x, z, s]) => rocks.push([x, z + OFF, s]));
    for (let i = 0; i < T.jmlBatu; i++) { const a = R() * 6.28, r = 8 + R() * (SHORE_R - 6); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!clearing(x, z)) rocks.push([x, z, (0.5 + R() * 1.4) * (T.batuBesar ? 1.4 : 1)]); }
    rocks.forEach(([x, z, s], i) => { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), i % 2 ? rockM : rockM2); r.position.set(x, hAt(x, z) + s * 0.25, z); r.rotation.set(R() * 3, R() * 3, R() * 3); r.scale.y = 0.7; r.castShadow = true; r.receiveShadow = true; scene.add(r); });
  }
  // properti kemah dekat panggung (disembunyikan bila naskah membangun sendiri)
  let kemahGrup = null;
  {
    const bx = -5.2, bz = 17.6 + OFF; const g = new THREE.Group(); kemahGrup = g; g.position.set(bx, hAt(bx, bz), bz); g.rotation.y = 0.5;
    if (WK.lampu) {   // malam: cahaya hangat api unggun / lentera menerangi karakter
      const lp = new THREE.PointLight(0xffa850, 38, 26, 1.6); lp.position.set(2.4, 1.4, 1.4); g.add(lp);
      upd.push((t) => { lp.intensity = 38 + 5 * Math.sin(t * 11) + 3 * Math.sin(t * 17 + 1); });
    }
    if (T.kemah === 'rakit') {
      const wood = lam(0x9a6a3a), wood2 = lam(0x7d5329), cloth = lam(0xf2ead8, { side: THREE.DoubleSide });
      for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 2.4 - (i % 2) * 0.5), i % 2 ? wood : wood2); p.position.set((i - 2) * 0.38, 0.08, (i % 2) * 0.2); p.rotation.set(0.03 * i, 0.05 * (i - 2), 0.04 * (i - 2)); g.add(p); }
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.6, 6), wood2); mast.position.set(0, 1.1, 0.2); mast.rotation.z = 0.35; g.add(mast);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1, 2, 2), cloth); sail.position.set(-0.75, 1.75, 0.2); sail.rotation.z = 0.35; g.add(sail);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), wood); crate.position.set(1.7, 0.3, 0.7); crate.rotation.set(0.1, 0.5, 0.15); g.add(crate);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 9), wood2); barrel.position.set(-1.6, 0.25, 1.1); barrel.rotation.z = 1.45; g.add(barrel);
      upd.push((t) => { sail.rotation.y = 0.15 * Math.sin(t * 2.2); });
    } else {
      // tenda (kulit untuk zaman batu, kain untuk lainnya) + api unggun
      const kulit = lam(T.papan === 'batu' ? 0xb8875a : 0xd9483b, { side: THREE.DoubleSide }), kayu = lam(0x6e4a2a);
      const tenda = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 6, 1, true), kulit); tenda.position.set(0.4, 1.3, -0.4); g.add(tenda);
      for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), kayu); s.position.set(0.4, 1.5, -0.4); s.rotation.set(0.25 * Math.cos(i * 2.1), 0, 0.25 * Math.sin(i * 2.1)); g.add(s); }
      const api = new THREE.Group(); api.position.set(2.4, 0, 1.4); g.add(api);
      for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 5), kayu); l.rotation.set(Math.PI / 2, 0, 0); l.rotation.y = i * Math.PI / 4; l.position.y = 0.1; api.add(l); }
      for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), lam(0x7f756c)); b.position.set(Math.cos(i * 0.785) * 0.62, 0.08, Math.sin(i * 0.785) * 0.62); api.add(b); }
      const nyala = [0xffb21c, 0xff6a1a, 0xffd23f].map((cl, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.05, 0.7 - i * 0.12, 5), new THREE.MeshBasicMaterial({ color: cl })); f.position.y = 0.4; api.add(f); return f; });
      upd.push((t) => nyala.forEach((f, i) => { const k = 1 + 0.18 * Math.sin(t * (9 + i * 3) + i); f.scale.set(1, k, 1); f.rotation.y = t * (1 + i); }));
      if (T.papan === 'batu') { const roda = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.25, 10), lam(0x8f857a)); roda.rotation.set(Math.PI / 2, 0, 0.3); roda.position.set(-1.6, 0.6, 1.2); g.add(roda); }
    }
    shadow(g); scene.add(g);
  }

  // papan (kayu / batu) dengan judul + angka
  const sign = new THREE.Group();
  const papan = opts.papan || null;
  {
    const batu = T.papan === 'batu';
    const judul = papan ? String(papan.judul).toUpperCase() : 'PENGHUNI', n0 = papan ? papan.angka : 1;
    const mkTex = (n) => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320; const g = cv.getContext('2d');
      g.fillStyle = batu ? '#a39a8e' : '#b98a52'; g.fillRect(0, 0, 512, 320);
      g.strokeStyle = batu ? 'rgba(60,50,40,.25)' : 'rgba(90,55,20,.35)'; g.lineWidth = 3;
      if (batu) for (let i = 0; i < 14; i++) { g.beginPath(); g.arc((i * 97) % 512, (i * 61) % 320, 18 + (i % 4) * 9, 0, 6.28); g.stroke(); }
      else for (let y = 64; y < 320; y += 64) { g.beginPath(); g.moveTo(0, y + Math.sin(y) * 4); g.lineTo(512, y - Math.sin(y) * 4); g.stroke(); }
      g.fillStyle = '#2a1d10'; g.textAlign = 'center'; g.font = `800 ${judul.length > 9 ? 52 : 70}px Poppins, Arial`; g.fillText(judul, 256, 118); g.font = '900 150px Poppins, Arial';
      if (n === n0) g.fillText(String(n), 256, 262);
      else { g.globalAlpha = 0.55; g.fillText(String(n0), 170, 262); g.globalAlpha = 1; g.strokeStyle = '#c2452d'; g.lineWidth = 14; g.beginPath(); g.moveTo(120, 250); g.lineTo(225, 160); g.stroke(); g.fillStyle = '#c2452d'; g.fillText(String(n), 340, 262); }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
    };
    const texes = {}; const texFor = (n) => (texes[n] ||= mkTex(n));
    const m2 = lam(batu ? 0x8a8278 : 0x7d5329);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.1, batu ? 0.22 : 0.09), [m2, m2, m2, m2, new THREE.MeshLambertMaterial({ map: texFor(n0) }), m2]); board.position.y = batu ? 0.95 : 1.35;
    sign.userData.setCount = (n) => { const m = board.material[4]; const tx = texFor(n); if (m.map !== tx) { m.map = tx; m.needsUpdate = true; } };
    sign.add(board);
    if (!batu) { const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.9, 6), m2); p1.position.set(-0.6, 0.85, -0.08); const p2 = p1.clone(); p2.position.x = 0.6; sign.add(p1, p2); }
    else { const kaki = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), m2); kaki.scale.set(1.6, 0.6, 0.8); kaki.position.y = 0.2; sign.add(kaki); }
    const x = 0.98, z = STAGE_Z - 2.1; sign.scale.setScalar(0.8); sign.position.set(x, hAt(x, z) - 0.1, z); sign.rotation.set(0, -0.22, 0.03); shadow(sign); scene.add(sign);
    sign.visible = !!papan;
  }
  // kapal (pulau)
  const ship = new THREE.Group();
  {
    const wood = lam(0x8a5a2e), wood2 = lam(0x6e4520), cloth = lam(0xf2ead8, { side: THREE.DoubleSide }), red = lam(0xd9483b, { side: THREE.DoubleSide });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 5.2), wood); hull.position.y = 0.3;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 4), wood); bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.position.set(0, 0.3, 3.6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 5.4), wood2); deck.position.y = 1.0;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 6), wood2); mast.position.set(0, 3.4, 0.3);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.6), cloth); sail.position.set(0, 3.9, 0.45);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), red); flag.position.set(0.45, 5.75, 0.3);
    ship.add(hull, bow, deck, mast, sail, flag); shadow(ship); scene.add(ship); ship.visible = false; ship.scale.setScalar(1.6);
  }
  const bubbles = new THREE.Group(); scene.add(bubbles);
  { const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }); for (let i = 0; i < 26; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + R() * 0.22, 0), m); b.userData = { a: R() * 6.28, r: 0.4 + R() * 2.6, ph: R() }; bubbles.add(b); } bubbles.visible = false; }
  const critter = T.hewan === 'dino' ? makeDino() : makeCrab(); scene.add(critter.root); critter.root.visible = false;
  const nut = makeFallingThing(T.benda); scene.add(nut); nut.visible = false;

  const SZ = STAGE_Z, G = hAt(0, SZ);
  const SHX = -1.5, SHZ = SZ + 22;
  const ALIAS = { kelapaJatuh: 'bendaJatuh', kepitingLewat: 'hewanLewat' };

  function direct(t, ctx) {
    const { P, TX, cam, sway } = ctx;
    const events = ctx.events.map((e) => ({ ...e, jenis: ALIAS[e.jenis] || e.jenis }));
    const ev = (j) => events.find((e) => e.jenis === j);
    let shipVis = false, shipY = -0.9, shipTilt = 0.35, bub = 0, crabOn = false, crabX = 0, crabZ = SZ, carry = false, camSet = false, shd = null;
    const kapal = T.kapal ? ev('kapalTenggelam') : null, jatuh = ev('bendaJatuh'), lewat = ev('hewanLewat'), pap = ev('papanAngka'), letus = ev('gunungMeletus');
    if (kapal) {
      if (t < kapal.t0) { shipVis = true; shipY = ctx.shot === 'udara' ? -1.8 - ctx.s * 0.12 : -1.0; shipTilt = 0.45; bub = 0.5; }
      else if (t < kapal.t1) {
        const tk = kapal.tHit, k = smooth(tk - 0.3, tk + 0.8, t), s = t - kapal.t0;
        cam.gcam(0.7 + sway[0], 3.4, SZ - 3.8 + s * 0.1, -1.5, 2.0, SZ + 22, 35); camSet = true; shd = [0, SZ + 6, 34];
        P.x = 1.15; P.z = SZ + 1.4; P.ry = -0.2; P.bodyRy = 0; P.walk = 0;
        P.armL = { sx: 0, out: 0.2, ex: -0.15 }; P.armR = { sx: lerp(-1.7, 0, smooth(tk, tk + 0.5, t)), out: 0.3, ex: -0.1 };
        P.headRx = lerp(0, 0.25, smooth(tk + 0.3, tk + 1.2, t));
        shipVis = true; shipY = lerp(-1.0, -12, k); shipTilt = lerp(0.3, 0.9, k); bub = t > tk - 0.4 ? 1 : 0.35;
      }
    }
    const TB = jatuh ? jatuh.tHit : null;
    if (jatuh && t >= TB && t < TB + 1.3) { const q = t - TB; P.squash += 0.55 * Math.exp(-q * 7) * Math.cos(q * 26); P.headRx += 0.22 * Math.exp(-q * 5); P.headRz += 0.1 * Math.exp(-q * 3) * Math.sin(q * 20); if (q < 0.45) { P.eye = 'flat'; P.lid = 0; } P.brow = -0.3; }
    if (lewat) {
      if (t >= lewat.t0 && t < lewat.t1) {
        crabOn = true; crabX = lerp(2.5, -3.2, (t - lewat.t0) / (lewat.t1 - lewat.t0)); crabZ = SZ + 0.45; carry = TB != null && t > TB;
        if (ctx.lookFree) { P.look = [clamp((crabX - TX) * 0.6, -1, 1), -0.75]; P.headRy = clamp((crabX - TX) * 0.18, -0.5, 0.5); P.headRx = 0.18; }
      } else if (t >= lewat.t1 && ctx.chase) {
        crabOn = true; const a = 2.2 + (t - lewat.t1) * 3.4, cx = 0.3, cz = SZ + 1.6, r = 2.3; crabX = cx + Math.cos(a + 0.95) * r; crabZ = cz + Math.sin(a + 0.95) * r; carry = TB != null;
      }
    }
    critter.root.visible = crabOn;
    if (crabOn) { critter.root.position.set(crabX, hAt(crabX, crabZ) - 0.02, crabZ); critter.root.rotation.y = T.hewan === 'dino' ? -Math.PI / 2 : 0; critter.pose(t * 26, carry); }
    if (jatuh) {
      const rest = [0.55, G + 0.15, SZ + 0.3], q = t - TB; nut.visible = q > -0.42;
      if (crabOn && carry && (ctx.chase || crabX < rest[0])) nut.position.set(crabX, hAt(crabX, crabZ) + (T.hewan === 'dino' ? 0.85 : 0.52), crabZ);
      else if (q < 0) { const k = clamp(1 + q / 0.42); nut.position.set(TX, G + 2.36 + (1 - k * k) * 7, SZ + 0.5); }
      else if (q < 0.55) { const k = q / 0.55; nut.position.set(lerp(TX, rest[0], k), lerp(G + 2.36, rest[1], k * k) + Math.sin(Math.PI * k) * 0.7, lerp(SZ + 0.5, rest[2], k)); }
      else nut.position.set(...rest);
      nut.rotation.set(t * 5, t * 3, 0);
    } else nut.visible = false;
    ship.visible = shipVis; ship.position.set(SHX, shipY, SHZ); ship.rotation.set(-shipTilt, 0.5, 0.12 + 0.03 * Math.sin(t * 2));
    bubbles.visible = shipVis && bub > 0;
    if (bubbles.visible) bubbles.children.forEach((b) => { const u = b.userData; const ph = (t * 0.9 + u.ph) % 1; b.position.set(SHX + Math.cos(u.a) * u.r * bub, 0.25 + ph * 0.5, SHZ + Math.sin(u.a) * u.r * bub); b.scale.setScalar(Math.sin(ph * Math.PI) * bub); });
    // gunung: asap terus naik; saat meletus asap membesar, lava menyala & kamera bergetar
    if (gunung) {
      const q = letus ? t - letus.tHit : -1, boom = letus && q >= 0 && q < 2.5 ? Math.exp(-q * 1.2) : 0;
      gunung.userData.asap.children.forEach((s) => { const u = s.userData; const ph = (t * 0.08 + u.ph) % 1; s.position.set(u.dx * (1 + ph), 42 + ph * 40, 0); s.scale.setScalar((0.6 + ph * 1.6) * (1 + boom * 1.5)); });
      gunung.userData.lava.material.emissiveIntensity = 0.6 + boom * 2;
      if (boom > 0.02 && !camSet) { const sk = boom * 0.06; ctx.shake = [Math.sin(t * 61) * sk, Math.cos(t * 53) * sk]; }
    }
    if (papan) sign.userData.setCount(pap && t >= pap.tHit ? pap.angka : papan.angka);
    sign.visible = !!papan && ctx.shot !== 'cover' && !camSet;
    return { camSet, shadow: shd };
  }

  const eventSfx = (events) => {
    const out = [];
    for (const e of events) {
      const j = ALIAS[e.jenis] || e.jenis;
      if (j === 'kapalTenggelam') out.push([e.tHit, 'bubble']);
      if (j === 'bendaJatuh') out.push([e.tHit, 'bonk']);
      if (j === 'gunungMeletus') out.push([e.tHit, 'hit'], [e.tHit + 0.1, 'thud']);
    }
    return out;
  };

  // hujan: garis-garis air jatuh di sekitar panggung (deterministik terhadap t)
  if (WK.hujan) {
    const N = 4500, RH = rng(31), dasar = [];
    for (let i = 0; i < N; i++) {
      const dekat = i < N * 0.6;   // 60% butir rapat di sekitar panggung (terlihat di shot dekat)
      dasar.push([(RH() - 0.5) * (dekat ? 18 : 60), RH() * 22, dekat ? STAGE_Z - 14 + RH() * 17 : STAGE_Z - 40 + RH() * 44, 0.7 + RH() * 0.5]);
    }
    const butir = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.6, 0.014), new THREE.MeshBasicMaterial({ color: 0xe8f0f8, transparent: true, opacity: 0.45, depthWrite: false }), N);
    butir.frustumCulled = false; scene.add(butir);
    const d = new THREE.Object3D(); d.rotation.z = 0.08;
    upd.push((t) => {
      dasar.forEach(([x, y0, z, k], i) => {
        const y = ((y0 - t * 20 * k) % 22 + 22) % 22;
        d.position.set(x + y * 0.08, y + hAt(x, z), z); d.scale.set(1, k, 1); d.updateMatrix(); butir.setMatrixAt(i, d.matrix);
      });
      butir.instanceMatrix.needsUpdate = true;
    });
  }

  // salju turun (tema salju): butiran putih pelan & bergoyang
  if (T.turunSalju && !WK.hujan) {
    const N = 1800, RS = rng(57), dasar = [];
    for (let i = 0; i < N; i++) { const dekat = i < N * 0.6; dasar.push([(RS() - 0.5) * (dekat ? 18 : 60), RS() * 18, dekat ? STAGE_Z - 14 + RS() * 17 : STAGE_Z - 40 + RS() * 44, 0.6 + RS() * 0.6, RS() * 6.28]); }
    const butir = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), N);
    butir.frustumCulled = false; scene.add(butir);
    const d = new THREE.Object3D();
    upd.push((t) => {
      dasar.forEach(([x, y0, z, k, ph], i) => {
        const y = ((y0 - t * 1.6 * k) % 18 + 18) % 18;
        d.position.set(x + 0.35 * Math.sin(t * 0.8 + ph), y + hAt(x, z), z + 0.25 * Math.cos(t * 0.6 + ph)); d.scale.setScalar(k); d.updateMatrix(); butir.setMatrixAt(i, d.matrix);
      });
      butir.instanceMatrix.needsUpdate = true;
    });
  }

  return { kemah: kemahGrup, hAt, STAGE_Z, TX: -0.5, setShadow, update: (t) => upd.forEach((f) => f(t)), direct, eventSfx };
}
