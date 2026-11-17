// ADEGAN: visual mengikuti narasi. Naskah: kalimat.adegan = { jenis, objek, pada, bagian }.
//  bangun  → karakter memalu, objek (tenda/gubuk/...) tumbuh bagian demi bagian, lalu tetap berdiri
//  kena    → karakter melangkah & kena objek bahaya (kaktus/semak/batuBesar) di kaki/tangan, kamera di kaki lalu naik
//  pegang  → memamerkan benda di tangan · makan → menggigit benda · cari → mengorek tanah lalu menemukan benda
//  masak   → memanggang benda di atas api unggun · lihat → kamera menyorot objek, karakter menunjuk
import * as THREE from 'three';
import { clamp, lerp, smooth, easeInOut, easeOutBack } from './lib.js';
import { OBJEK, buatObjek } from './objek.js';

export const JENIS_ADEGAN = ['bangun', 'kena', 'pegang', 'makan', 'cari', 'masak', 'lihat'];

function palu() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), new THREE.MeshLambertMaterial({ color: 0x6e4520, flatShading: true })); s.position.y = -0.05; g.add(s);
  const k = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x8f857a, flatShading: true })); k.position.y = 0.2; g.add(k);
  return g;
}

/**
 * @param {object} o { scene, naskah, L, Wt, lineStart(i), lineEnd(i), hAt, TX, SZ, kar, sfx }
 */
export function siapkanAdegan({ scene, naskah, L, Wt, lineStart, lineStop, hAt, TX, SZ, kar, sfx }) {
  const LIST = [];
  const SPOT = [[TX + 2.0, SZ + 0.6, 1], [TX - 2.1, SZ + 0.5, -1], [TX + 3.6, SZ - 0.4, 1]];
  let nSpot = 0;
  const tangan = kar.tangan;   // grup tangan kanan (P.armR)
  const pegangan = new THREE.Group(); pegangan.position.set(0, -0.4, 0.06); tangan.add(pegangan);
  const alatPalu = palu(); alatPalu.visible = false; alatPalu.rotation.x = 1.4; pegangan.add(alatPalu);
  const updaters = [];

  naskah.kalimat.forEach((k, i) => {
    const a = k.adegan; if (!a || !JENIS_ADEGAN.includes(a.jenis)) return;
    const t0 = lineStart(i), t1 = lineStop(i);
    const tHit = a.pada ? Wt(k.id, a.pada) : lerp(L[k.id].t, L[k.id].t + L[k.id].d, a.jenis === 'kena' ? 0.35 : 0.5);
    const e = { jenis: a.jenis, objek: a.objek, bagian: a.bagian || 'kaki', t0, t1, tHit, line: i };
    const def = OBJEK[a.objek];
    if (a.jenis === 'bangun') {
      const nama = def && def.grup === 'bangunan' ? a.objek : 'tenda';
      e.obj = buatObjek(nama); const [x, z, dir] = SPOT[nSpot++ % SPOT.length]; e.spot = [x, z]; e.dir = dir;
      e.obj.root.position.set(x, hAt(x, z) - 0.02, z); e.obj.root.rotation.y = -dir * 0.35; scene.add(e.obj.root);
      // suara palu tiap 0.5 dtk + "pop" saat jadi
      for (let tt = t0 + 0.35; tt < Math.min(t1, t0 + (t1 - t0) * 0.9); tt += 0.5) sfx(tt, 'tick');
      sfx(t0 + (t1 - t0) * 0.9, 'pop');
    } else if (a.jenis === 'kena' || a.jenis === 'lihat') {
      const nama = def ? a.objek : 'kaktus';
      e.obj = buatObjek(nama);
      const x = a.jenis === 'kena' ? TX + 0.62 : TX - 1.5, z = a.jenis === 'kena' ? SZ + 0.35 : SZ + 0.1;
      e.spot = [x, z]; e.obj.root.position.set(x, hAt(x, z) - 0.02, z);
      if (OBJEK[nama]?.grup === 'benda') e.obj.root.scale.setScalar(2.2), e.obj.root.position.y += 0.25;
      scene.add(e.obj.root); e.obj.root.visible = false;
      if (a.jenis === 'kena') { sfx(tHit, 'hit'); sfx(tHit + 0.05, 'bonk'); }
    } else {
      const nama = def && def.grup === 'benda' ? a.objek : a.jenis === 'masak' ? 'ikan' : 'kelapa';
      e.obj = buatObjek(nama); e.obj.root.visible = false; pegangan.add(e.obj.root);
      if (a.jenis === 'masak') {
        e.api = buatObjek('apiUnggun'); const x = TX - 0.85, z = SZ + 0.85; e.api.root.scale.setScalar(0.8);   // api di sisi tangan kanan (kiri layar)
        e.api.root.position.set(x, hAt(x, z) - 0.02, z); e.api.root.visible = false; scene.add(e.api.root);
        updaters.push((t) => e.api.root.userData.update?.(t));
      }
      if (a.jenis === 'makan') for (let tt = t0 + 0.55; tt < t1 - 0.2; tt += 0.75) sfx(tt, 'pop');
      if (a.jenis === 'cari') {
        sfx(tHit, 'pop');
        // gundukan tanah yang makin besar saat digali
        const x = TX - 0.6, z = SZ + 0.55;   // di depan karakter yang menghadap RY_GALI
        e.gali = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9a7448, flatShading: true }));
        e.gali.position.set(x, hAt(x, z) - 0.02, z); e.gali.receiveShadow = true; e.gali.visible = false; scene.add(e.gali);
      }
    }
    if (e.obj?.root.userData.update) updaters.push((t) => e.obj.root.userData.update(t));
    LIST.push(e);
  });

  const progres = (e, t) => clamp((t - e.t0) / Math.max(0.6, (e.t1 - e.t0) * 0.9));
  function tampilBangun(e, t) {
    const k = progres(e, t), n = e.obj.parts.length;
    e.obj.root.visible = t >= e.t0;
    e.obj.parts.forEach((p, i) => {
      const a = i / n, b = (i + 1) / n, q = clamp((k - a) / Math.max(0.0001, b - a));
      const s = q <= 0 ? 0.0001 : q >= 1 ? 1 : easeOutBack(q);
      p.visible = q > 0; p.scale.set(p.userData.s0.x * s, p.userData.s0.y * s, p.userData.s0.z * s);
    });
  }

  function direct(t, ctx) {
    const { P, gcam, sway, shot } = ctx;
    alatPalu.visible = false;
    let out = { camSet: false, shadow: null };
    for (const e of LIST) {
      const aktif = t >= e.t0 && t < e.t1 && !['udara', 'penutup', 'teriak', 'cover'].includes(shot);
      if (e.jenis === 'bangun') { if (t >= e.t0) tampilBangun(e, t); else e.obj.root.visible = false; }
      else if (e.jenis === 'kena' || e.jenis === 'lihat') e.obj.root.visible = t >= e.t0 - 0.05 && t < e.t1;
      else {
        e.obj.root.visible = aktif && (e.jenis !== 'cari' || t >= e.tHit); if (e.api) e.api.root.visible = t >= e.t0 && t < e.t1;
        if (e.gali) { e.gali.visible = t >= e.t0 && t < e.t1; const k = 0.3 + 0.7 * clamp((t - e.t0) / Math.max(0.3, e.tHit - e.t0)); e.gali.scale.set(k, k * 0.6, k); }
      }
      if (!aktif) continue;
      const q = t - e.t0;
      switch (e.jenis) {
        case 'bangun': {
          const [sx, sz] = e.spot, dir = e.dir, k = progres(e, t), selesai = k >= 1;
          P.x = TX + dir * 0.15; P.z = SZ + 0.15; P.ry = dir * (selesai ? 0.35 : 0.95); P.posTetap = 1;
          if (!selesai) {
            const ph = (q % 0.5) / 0.5, ayun = ph < 0.7 ? smooth(0, 0.7, ph) : 1 - smooth(0.7, 1, ph);
            P.armR = { sx: lerp(-1.1, -2.6, ayun), out: 0.25, ex: lerp(-0.5, -1.2, ayun) }; alatPalu.visible = true;
            P.squash += ph > 0.95 ? 0.08 : 0; P.look = [dir * 0.5, -0.3];
          }
          const cx = P.x * 0.42 + sx * 0.58, cz = (P.z + sz) / 2, d = 6.2 + OBJEK[e.objek in OBJEK ? e.objek : 'tenda'].lebar * 1.6;
          gcam(cx - dir * 0.8 + sway[0], 2.4 + sway[1], cz + d, cx, 1.15, cz, 35);
          out = { camSet: true, shadow: [cx, cz, 9] };
          break;
        }
        case 'kena': {
          const tH = e.tHit, pre = clamp((t - e.t0) / Math.max(0.3, tH - e.t0)), r = t - tH;
          if (r < 0) { P.x = lerp(TX - 0.75, TX - 0.05, easeInOut(pre)); P.ry = Math.PI / 2 * 0.8; P.walk = 1; P.walkPh = q * 12; P.posTetap = 1; P.look = [0.6, -0.5]; }
          else {
            P.x = TX - 0.05 - 0.25 * smooth(0, 0.3, r); P.ry = lerp(Math.PI / 2 * 0.8, 0.25, smooth(0, 0.3, r)); P.posTetap = 1;
            P.y0 = 0.5 * Math.abs(Math.sin(r * 7)) * Math.exp(-r * 1.6);
            P.eye = 'wide'; P.brow = 0.7; P.mouthMin = Math.max(P.mouthMin || 0, 0.7 * Math.exp(-r * 1.2)); P.mouthW = 1.25;
            if (e.bagian === 'tangan') { P.armR = { sx: -0.9, out: 0.6 + 0.2 * Math.sin(r * 30), ex: -1.4 }; }
            else { P.kakiR = 1.1 * Math.exp(-r * 0.5); P.armR = { sx: -0.7, out: 0.1, ex: -0.6 }; P.armL = { sx: 0, out: 2.2 + 0.2 * Math.sin(r * 25), ex: -0.5 }; }
          }
          // kamera: mulai rendah menyorot kaki & objek, setelah kena naik ke wajah
          const up = smooth(0.15, 0.75, r);
          gcam(lerp(TX + 0.05, TX + 0.15, up) + sway[0] * up, lerp(0.9, 1.95, up), lerp(SZ + 5.9, SZ + 6.3, up), lerp(TX, TX + 0.1, up), lerp(0.75, 1.6, up), lerp(SZ + 0.3, SZ, up), 35);
          out = { camSet: true, shadow: [TX, SZ, 8] };
          break;
        }
        case 'pegang': case 'cari': {
          const temu = e.jenis === 'pegang' || t >= e.tHit;
          if (!temu) {
            P.lean = 0.5; P.look = [0, -0.9]; P.headRx = 0.25; P.ry = -0.83; P.posTetap = 1;
            const g = Math.sin(q * 11); P.armR = { sx: -0.9 + 0.5 * g, out: 0.2, ex: -0.6 }; P.armL = { sx: -0.9 - 0.5 * g, out: 0.2, ex: -0.6 };
            gcam(TX + 4.4 + sway[0], 2.0, SZ + 5.4, TX - 0.35, 0.95, SZ + 0.3, 35);   // kamera di samping → badan membungkuk terlihat
          } else {
            const up = e.jenis === 'cari' ? smooth(e.tHit, e.tHit + 0.35, t) : smooth(e.t0, e.t0 + 0.35, t);
            P.armR = { sx: lerp(-0.2, -1.45, up), out: lerp(0.15, 0.35, up), ex: lerp(-0.2, -1.0, up) }; P.look = [-0.45, 0.15];
            e.obj.root.scale.setScalar(1.25 + 0.08 * Math.sin(q * 4));
            gcam(TX - 0.1 + sway[0], 2.0 + sway[1], SZ + 4.6, TX - 0.18, 1.9, SZ, 35);
          }
          out = { camSet: true, shadow: [TX, SZ, 8] };
          break;
        }
        case 'makan': {
          const ph = (q % 0.75) / 0.75, ke = smooth(0, 0.35, ph) * (1 - smooth(0.7, 1, ph));
          P.armR = { sx: lerp(-0.9, -1.15, ke), out: lerp(0.1, -0.45, ke), ex: lerp(-1.4, -2.3, ke) };
          const gigit = Math.floor(q / 0.75); e.obj.root.scale.setScalar(Math.max(0.35, 1.15 - gigit * 0.22));
          P.mouthMin = Math.max(P.mouthMin || 0, ke > 0.8 ? 0.6 : 0.15 * Math.abs(Math.sin(q * 14))); P.eye = ke > 0.8 ? 'happy' : P.eye;
          gcam(TX + sway[0], 2.0 + sway[1], SZ + 4.3, TX - 0.1, 1.95, SZ, 35);
          out = { camSet: true, shadow: [TX, SZ, 8] };
          break;
        }
        case 'masak': {
          P.ry = -0.5; P.posTetap = 1; P.x = TX + 0.15; P.z = SZ;
          P.armR = { sx: -1.2, out: 0.35, ex: -0.3 + 0.06 * Math.sin(q * 3) }; P.look = [-0.5, -0.5];
          e.obj.root.rotation.set(0, q * 2, 0); e.obj.root.scale.setScalar(1.2);
          gcam(TX - 0.3 + sway[0], 1.7, SZ + 6.3, TX - 0.3, 0.95, SZ + 0.4, 35);
          out = { camSet: true, shadow: [TX, SZ, 8] };
          break;
        }
        case 'lihat': {
          const [ox, oz] = e.spot, k = smooth(e.t0 + (e.t1 - e.t0) * 0.45, e.t0 + (e.t1 - e.t0) * 0.6, t);
          P.armR = { sx: -1.25, out: 0.75, ex: -0.1 }; P.bodyRy = -0.35; P.look = [-0.6, 0];
          const h = OBJEK[e.objek]?.grup === 'bangunan' ? 1.4 : 0.7;
          gcam(lerp(ox - 0.2, (ox + TX) / 2, k) + sway[0], lerp(h + 0.5, 2.1, k), lerp(oz + 3.0, SZ + 7.0, k), lerp(ox, (ox + TX) / 2, k), lerp(h * 0.6, 1.4, k), lerp(oz, SZ, k), 35);
          out = { camSet: true, shadow: [(ox + TX) / 2, SZ, 9] };
          break;
        }
      }
    }
    return out;
  }

  return { direct, update: (t) => updaters.forEach((f) => f(t)), adaBangun: LIST.some((e) => e.jenis === 'bangun'), LIST };
}
