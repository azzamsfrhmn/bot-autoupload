// Sutradara berbasis DATA: membaca naskah.json + timeline.json + karakter.json, lalu memilih shot,
// ekspresi, gestur, kartu & event dari pustaka. renderAt(t) deterministik (hanya bergantung t).
import * as THREE from 'three';
import { clamp, lerp, smooth, easeInOut, norm } from './lib.js';
import { WORLDS } from './world/index.js';
import { makeKarakter } from './karakter.js';
import { EKSPRESI, GESTUR, blend } from './akting.js';
import { buildUI } from './ui.js';
import { siapkanAdegan } from './adegan.js';

const W = 1080, H = 1920;
const qs = new URLSearchParams(location.search);
const base = qs.get('proyek') || '/proyek';
const [naskah, TL, K] = await Promise.all(['naskah.json', 'timeline.json', 'karakter.json'].map((f) => fetch(`${base}/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); })));
const L = Object.fromEntries(TL.lines.map((l) => [l.id, l]));
const ORDER = naskah.kalimat.map((k) => k.id);
for (const id of ORDER) if (!L[id]) throw new Error(`timeline tidak punya kalimat "${id}"`);
const Wt = (id, word, nth = 0) => { const m = L[id].words.filter((w) => norm(w.w) === norm(word)); return (m[nth] || m[0] || { t: L[id].t }).t; };
const lineEnd = (id) => L[id].t + L[id].d;

const COVER_END = 0.5, CUT = 0.1;
// ---------- daftar shot (dari kalimat yang punya "shot") ----------
const SHOTS = [{ jenis: 'cover', gerak: 'diam', t0: 0, idx: 0, line: -1 }];
naskah.kalimat.forEach((k, i) => {
  if (!k.shot) return;
  const prev = SHOTS[SHOTS.length - 1];
  let t0 = L[k.id].t - CUT;
  if (SHOTS.length === 1) t0 = COVER_END;
  else if (k.shot === 'teriak') t0 = L[k.id].t - 0.05;
  else if (prev.jenis === 'teriak') t0 = L[k.id].t - 0.22;
  t0 = Math.max(t0, prev.t0 + 0.05);
  SHOTS.push({ jenis: k.shot, gerak: k.gerak || 'dorong', t0, idx: SHOTS.length, line: i, afterTeriak: prev.jenis === 'teriak' });
});
const lastId = ORDER[ORDER.length - 1];
const OUTRO_T = lineEnd(lastId) + 0.2;
export const DURATION = Math.ceil((OUTRO_T + 2.3) * 30) / 30;
SHOTS.forEach((s, i) => { s.t1 = SHOTS[i + 1]?.t0 ?? DURATION; });
const shotStart = (lineIdx) => SHOTS.find((s) => s.line === lineIdx)?.t0 ?? (L[ORDER[lineIdx]].t - CUT);
const nextShotStart = (i) => { for (let j = i + 1; j < ORDER.length; j++) if (naskah.kalimat[j].shot) return shotStart(j); return OUTRO_T; };
const shotAt = (t) => { let s = SHOTS[0]; for (const x of SHOTS) if (t >= x.t0) s = x; return s; };

// ---------- keadaan akting (ekspresi + gestur) sepanjang waktu ----------
const STATES = [{ t: 0, ekspresi: 'kaget', gestur: 'duaTanganAtas', tE: 0, tG: 0, cover: true }];
{
  let curE = 'netral', curG = 'diam', tE = 0, tG = 0;
  naskah.kalimat.forEach((k, i) => {
    const t0 = k.shot ? shotStart(i) : L[k.id].t - 0.05;
    if (k.ekspresi) { curE = k.ekspresi; tE = t0; } if (k.gestur) { curG = k.gestur; tG = t0; }
    if (i === 0 && !k.ekspresi) { curE = 'netral'; tE = t0; } if (i === 0 && !k.gestur) { curG = 'diam'; tG = t0; }
    STATES.push({ t: t0, ekspresi: curE, gestur: curG, tE, tG, line: i });
    for (const b of k.beat || []) {
      const tb = Wt(k.id, b.pada, b.nth || 0) - 0.05;
      if (b.ekspresi) { curE = b.ekspresi; tE = tb; } if (b.gestur) { curG = b.gestur; tG = tb; }
      STATES.push({ t: tb, ekspresi: curE, gestur: curG, tE, tG, line: i, beat: true });
    }
  });
  STATES.sort((a, b) => a.t - b.t);
}
const stateIdx = (t) => { let i = 0; for (let j = 0; j < STATES.length; j++) if (t >= STATES[j].t) i = j; return i; };

// ---------- event dunia ----------
const EVENTS = [];
naskah.kalimat.forEach((k, i) => {
  if (!k.event) return;
  const e = k.event, t0 = k.shot ? shotStart(i) : L[k.id].t - 0.05, t1 = nextShotStart(i);
  const def = (e.jenis === 'kelapaJatuh' || e.jenis === 'bendaJatuh') ? -0.16 : e.jenis === 'papanAngka' ? 0.15 : 0;
  const tHit = (e.pada ? Wt(k.id, e.pada) : L[k.id].t + def) + (Number(e.mulai) || 0);
  EVENTS.push({ jenis: e.jenis, t0, t1, tHit, angka: e.angka, line: i });
});

// ---------- three ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 1500);
await Promise.all(['600', '700', '800', '900'].map((w) => document.fonts.load(`${w} 40px Poppins`)));
const buildWorld = WORLDS[naskah.seri.dunia] || WORLDS.pulau;
const world = buildWorld(scene, { seed: naskah.seri.benih ?? 7, papan: naskah.seri.papan || null, waktu: naskah.seri.waktu });
const kar = makeKarakter(K); scene.add(kar.root);
const SZ = world.STAGE_Z, TX = world.TX, hAt = world.hAt, G = hAt(0, SZ);

// ---------- SFX ----------
const SFX = []; const sfx = (t, type) => SFX.push({ t: +Number(t).toFixed(3), type });
const ui = buildUI({ naskah, TL, L, ORDER, Wt, shotStart, COVER_END, OUTRO_T, CUT, sfx });
if (naskah.seri.tanpaUI) ui.hide();   // potret karakter (pratinjau hasil upload)
sfx(0.02, 'thud'); sfx(COVER_END, 'whoosh'); sfx(COVER_END + 0.12, 'thud');
SHOTS.slice(2).forEach((s) => sfx(s.t0, s.jenis === 'teriak' ? 'hit' : 'whoosh'));
sfx(OUTRO_T, 'thud');
world.eventSfx(EVENTS).forEach(([t, type]) => sfx(t, type));
// adegan: visual mengikuti narasi (bangun/kena/pegang/makan/cari/masak/lihat)
const lineMulai = (i) => (naskah.kalimat[i].shot ? shotStart(i) : L[ORDER[i]].t - 0.05);
const lineSelesai = (i) => { for (let j = i + 1; j < ORDER.length; j++) return lineMulai(j); return OUTRO_T; };
const ADEGAN = siapkanAdegan({ scene, naskah, L, Wt, lineStart: lineMulai, lineStop: lineSelesai, hAt, TX, SZ, kar, sfx });
if (ADEGAN.adaBangun && world.kemah) world.kemah.visible = false;   // "dari nol": kemah bawaan diganti hasil bangunan karakter
naskah.kalimat.forEach((k) => (k.sfx || []).forEach((s) => sfx((s.pada ? Wt(k.id, s.pada) : L[k.id].t) + (Number(s.mulai) || 0), s.jenis)));
SFX.sort((a, b) => a.t - b.t);
// musik berhenti saat teriak, hening canggung di kalimat berikutnya, lalu masuk lagi
const MUSIK = { diam: [] };
naskah.kalimat.forEach((k, i) => { if (k.shot !== 'teriak') return; const a = L[k.id].t - 0.03; const nn = ORDER[i + 2]; const b = (nn ? L[nn].t : lineEnd(ORDER[i + 1] || k.id) + 0.5) - 0.12; MUSIK.diam.push([a, b]); });

// ---------- bantu ----------
const MULUT = TL.mulut && Array.isArray(TL.mulut.v) ? TL.mulut : null;
const talk = (t) => {
  if (MULUT) { const v = MULUT.v[Math.floor(t * MULUT.fps)] || 0; return v ? 0.18 + 0.72 * v : 0; }   // dari keras-pelan audio
  return talkKata(t);
};
const talkKata = (t) => { for (const l of TL.lines) { if (t < l.t - 0.02 || t > l.t + l.d + 0.05) continue; for (const w of l.words) if (t >= w.t && t <= w.t + w.d) return 0.28 + 0.5 * Math.abs(Math.sin((t - w.t) * 19 + 0.6)); } return 0; };
const setCam = (px, py, pz, tx, ty, tz, fov = 35) => { cam.position.set(px, py, pz); cam.fov = fov; cam.updateProjectionMatrix(); cam.lookAt(tx, ty, tz); };
const gcam = (px, py, pz, tx, ty, tz, fov) => setCam(px, py + G, pz, tx, ty + G, tz, fov);
const blink = (t) => (t % 3.3) < 0.11;
const ctxAkting = { TX, SZ };
const poseOf = (st, t) => { const P = kar.DEF(); P.x = TX; P.z = SZ; EKSPRESI[st.ekspresi]?.(P, t, t - st.tE); GESTUR[st.gestur]?.(P, t, t - st.tG, ctxAkting); return P; };

function direct(t) {
  const sh = shotAt(t), s = t - sh.t0;
  const si = stateIdx(t), cur = STATES[si], prev = STATES[si - 1];
  let P = poseOf(cur, t);
  if (prev) P = blend(poseOf(prev, t), P, smooth(cur.t, cur.t + 0.2, t));
  const speaking = talk(t); P.mouth = speaking;
  if (sh.jenis === 'cover') { P.mouth = 1; P.mouthW = 1.3; P.y0 = 0; P.eye = 'wide'; }
  const sway = [Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.9 + 1) * 0.025];
  const mid = (dz = 0) => gcam(0.1 + sway[0], 2.0 + sway[1], SZ + 7.3 - dz, 0.1, 1.98, SZ);
  const close = (dz = 0, dx = 0.3) => gcam(TX + dx + sway[0], 1.95 + sway[1], SZ + 4.3 - dz, TX, 2.03, SZ);
  const diam = sh.gerak === 'diam';
  let wide = false;
  switch (sh.jenis) {
    case 'cover': gcam(TX, 1.5, SZ + 7.4, TX, 1.2, SZ); break;
    case 'udara': { const k = clamp(s / Math.max(0.5, sh.t1 - sh.t0)); const a = 0.5 + k * 0.3; const d = 150 - k * 18; setCam(Math.sin(a) * d, 112 - k * 10, Math.cos(a) * d + 8, 0, 0, 6, 38); wide = true; break; }
    case 'badan': {
      if (sh.gerak === 'dolly') { const k = easeInOut(s / Math.min(2.6, Math.max(0.8, sh.t1 - sh.t0))); gcam(lerp(5, 1.0, k) + sway[0], lerp(11, 2.0, k), lerp(SZ + 16, SZ + 8.4, k), lerp(0, 0.2, k), lerp(0.3, 1.2, k), SZ, 35); wide = k < 0.5; }
      else if (sh.gerak === 'pan') gcam(P.x * 0.5 + 0.1 + sway[0], 1.4 + sway[1], SZ + 7.6, P.x * 0.75 + 0.05, 1.25, SZ, 35);
      else mid(diam ? 0 : s * 0.04);
      break;
    }
    case 'dekat': close(diam ? 0 : s * 0.08, cur.gestur === 'angkatTangan' ? -0.35 : 0.3); break;
    case 'sangatDekat': gcam(TX, 1.8, SZ + 3.2 - (diam ? 0 : s * 0.04), TX, 1.78, SZ, 35); break;
    case 'teriak': close(); break;
    case 'penutup': { const k = easeInOut(s / Math.max(1, DURATION - sh.t0)); gcam(lerp(1.0, 70, k), lerp(2.2, 150, k), lerp(SZ + 8.2, 190, k), lerp(0.2, 0, k), lerp(1.2, 0, k), lerp(SZ, 4, k), 36); wide = s > 0.9; break; }
  }
  const ad = ADEGAN.direct(t, { P, gcam, sway, shot: sh.jenis });
  const chase = sh.jenis === 'penutup' && cur.gestur === 'kejar';
  const wctx = { P, TX, cam: { gcam, setCam }, sway, shot: sh.jenis, s, events: EVENTS, chase, lookFree: !cur.beat };
  const ev = world.direct(t, wctx);
  if (wctx.shake) { cam.position.x += wctx.shake[0]; cam.position.y += wctx.shake[1]; }   // gempa (gunung meletus)
  if (P.eye === 'open' && blink(t)) P.eye = 'flat';
  P.y = hAt(P.x, P.z) - 0.03 + (P.y0 || 0);
  kar.apply(P, t);
  if (ev.shadow) world.setShadow(...ev.shadow); else if (ad.shadow) world.setShadow(...ad.shadow); else if (wide) world.setShadow(0, 12, 85); else world.setShadow(0, SZ - 4, 20);
  return { shot: sh.jenis, s, shotIdx: sh.idx, afterTeriak: !!sh.afterTeriak, sparks: (P.sparks || 0) > 0.5 };
}

// ---------- stiker teriak: potret kepala karakter sendiri (muka panik) ----------
function snapshotStiker() {
  const bg = scene.background, fog = scene.fog; scene.background = null; scene.fog = null;
  const vis = scene.children.map((o) => o.visible); scene.children.forEach((o) => { o.visible = o.isLight || o === kar.root; });
  const P = kar.DEF(); P.x = 0; P.z = 0; P.y = 0; EKSPRESI.panik(P, 0.3, 0.3); GESTUR.duaTanganAtas(P, 0.3, 0.3, ctxAkting); P.mouthMin = 1; P.mouthW = 1.3; P.y0 = 0; P.headRz = 0.08;
  kar.apply(P, 0.4); world.setShadow(0, 0, 20);
  setCam(0.08, 2.1, 5.0, 0, 1.9, 0, 35);
  renderer.setClearColor(0x000000, 0); renderer.render(scene, cam);
  ui.setStiker(canvas, 190, 560, 700, 830);
  scene.background = bg; scene.fog = fog; scene.children.forEach((o, i) => { o.visible = vis[i]; });
}
snapshotStiker();

window.renderAt = (t) => { world.update(t); ADEGAN.update(t); const st = direct(t); renderer.render(scene, cam); ui.draw(t, st); };
window.DURATION = DURATION; window.SFX = SFX; window.MUSIK = MUSIK;
window.GPU = (() => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })();
window.INFO = { duration: DURATION, sfx: SFX, musik: MUSIK, gpu: window.GPU, shots: SHOTS.map((s) => [s.jenis, +s.t0.toFixed(2)]) };

// pratinjau di browser biasa: ?t=12.5 satu frame, tanpa parameter = putar
if (!qs.has('render')) {
  const stage = document.getElementById('stage'); const fit = () => { const k = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `scale(${k})`; }; fit(); addEventListener('resize', fit);
  if (qs.has('t')) window.renderAt(+qs.get('t'));
  else { const t0 = performance.now(); const loop = () => { window.renderAt(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); }; loop(); }
}
window.READY = true;
