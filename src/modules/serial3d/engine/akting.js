// Pustaka akting: EKSPRESI & GESTUR dipilih lewat naskah (bukan ditulis per kalimat).
// Tiap fungsi mengubah pose P. q = detik sejak ekspresi/gestur itu mulai, t = waktu global.
import { clamp, lerp, smooth, easeInOut } from './lib.js';

export const REST = () => ({ sx: 0, out: 0.12, ex: -0.15 });

export const EKSPRESI = {
  netral: (P) => { P.eye = 'open'; },
  senang: (P) => { P.eye = 'happy'; P.smile = 1; P.brow = 0.15; },
  datar: (P) => { P.eye = 'open'; P.lid = 0.5; P.smile = 0; P.brow = 0; P.look = [0, 0]; },
  kaget: (P, t, q) => { P.eye = 'wide'; P.brow = -0.6; P.browY = 0.06; P.mouthW = 1.2; P.x += Math.sin(q * 55) * 0.025 * clamp(q * 3) * clamp(1 - (q - 0.6) * 2); },
  sedih: (P) => { P.eye = 'open'; P.brow = -0.6; P.smile = -1; P.look = [0, -0.35]; P.headRx = 0.15; P.headRz = 0.1; },
  bangga: (P, t) => { P.eye = 'happy'; P.smile = 1; P.headRx = -0.08; P.headRz = 0.06 * Math.sin(t * 5); P.sparks = 1; },
  panik: (P) => { P.eye = 'wide'; P.brow = 0.7; P.mouthMin = 0.8; P.mouthW = 1.2; },
  marah: (P) => { P.eye = 'open'; P.brow = 0.6; P.smile = -1; P.headRx = 0.05; },
  mikir: (P) => { P.eye = 'open'; P.look = [0.6, 0.6]; P.brow = 0.25; P.lid = 0.2; P.headRz = -0.1; P.headRx = -0.05; },
};

/** ctx: { TX, SZ } */
export const GESTUR = {
  diam: () => {},
  lambai: (P, t, q) => { P.armL = { sx: 0, out: 2.55 + 0.25 * Math.sin(t * 16), ex: -0.5 }; P.squash = -0.25 * Math.sin(clamp(q / 0.3) * Math.PI); },
  tunjukPenonton: (P) => { P.armR = { sx: -1.45, out: 0.1, ex: -0.1 }; },
  tunjukDiri: (P) => { P.armL = { sx: -0.9, out: -0.35, ex: -2.0 }; },
  tunjukSamping: (P) => { P.armR = { sx: -1.25, out: 0.75, ex: -0.1 }; P.bodyRy = -0.35; },
  tanganPinggang: (P, t) => { P.armL = { sx: 0.2, out: 0.75, ex: -1.5 }; P.armR = { sx: 0.2, out: 0.75, ex: -1.5 }; P.headRz += 0.05 * Math.sin(t * 5); },
  pegangPerut: (P, t, q) => { P.armL = { sx: -0.5, out: -0.25, ex: -1.3 }; P.armR = { sx: -0.5, out: -0.25, ex: -1.3 }; P.squash = 0.12 * Math.sin(q * 30) * Math.exp(-q * 3); P.look = [0, -0.6]; P.headRx = 0.08; },
  memohon: (P) => { P.armL = { sx: -0.5, out: -0.2, ex: -2.1 }; P.armR = { sx: -0.5, out: -0.2, ex: -2.1 }; P.headRz = 0.16; },
  pegangHp: (P) => { P.armL = { sx: -0.3, out: 0.5, ex: -1.9 }; P.look = [0.25, 0.1]; },
  duaTanganAtas: (P, t, q) => { P.armL = { sx: 0, out: 2.3, ex: -0.6 }; P.armR = { sx: 0, out: 2.3, ex: -0.6 }; P.y0 = 0.25 * Math.abs(Math.sin(q * 12)) * Math.exp(-q * 2); },
  hitungJari: (P, t, q) => {
    const up = smooth(0, 0.25, q); P.armR = { sx: lerp(0, -0.4, up), out: lerp(0.12, 1.9, up), ex: lerp(-0.15, -1.2, up) };
    const n = Math.floor(q / 0.75), r = q % 0.75; P.squash = -0.18 * Math.sin(clamp(r / 0.28) * Math.PI); P.headRz += 0.09 * (n % 2 ? 1 : -1);
  },
  geleng: (P, t, q) => { P.armL = { sx: -0.9, out: 0.5, ex: -1.6 }; P.headRy = 0.28 * Math.sin(q * 17) * clamp(1 - (q - 0.9) * 2); P.brow += 0.3; },
  lompat: (P, t, q) => { P.y0 = 0.3 * Math.abs(Math.sin(q * 9)) * Math.exp(-q * 1.5); P.armL = { sx: 0, out: 0.9, ex: -0.4 }; P.armR = { sx: 0, out: 0.9, ex: -0.4 }; },
  angkatTangan: (P, t, q) => { P.armL = { sx: -0.3, out: 1.9, ex: -1.3 }; P.look = [0.3, 0.5]; P.headRx = -0.15; P.y0 = 0.08 * Math.abs(Math.sin(q * 9)) * clamp(1 - (q - 1) * 2); },
  jalan: (P, t, q, ctx) => {
    const dur = 1.1; P.x = lerp(-3.3, ctx.TX, easeInOut(q / dur)); const turn = smooth(dur, dur + 0.22, q);
    P.ry = lerp(Math.PI / 2, 0, turn); P.walk = 1 - turn; P.walkPh = q * 12; P.posTetap = 1;
  },
  tidur: (P) => { P.lie = 1; P.eye = 'flat'; P.armL = { sx: 0, out: 1.3, ex: 0 }; P.armR = { sx: 0, out: 1.5, ex: -0.4 }; P.posTetap = 1; },
  kejar: (P, t, q, ctx) => {
    const a = 2.2 + q * 3.4, cx = 0.3, cz = ctx.SZ + 1.6, r = 2.3;
    P.x = cx + Math.cos(a) * r; P.z = cz + Math.sin(a) * r; P.ry = Math.atan2(-Math.sin(a), Math.cos(a)); P.walk = 1; P.walkPh = t * 15; P.lean = 0.25;
    P.armL = { sx: -1.5, out: 0.2, ex: -0.1 }; P.armR = { sx: -1.5, out: 0.2, ex: -0.1 }; P.posTetap = 1;
  },
};

/** campur dua pose: angka di-lerp, teks (mata) berganti di tengah, posisi mengikuti B bila B.posTetap */
export function blend(A, B, k) {
  if (k <= 0) return A; if (k >= 1) return B;
  const out = {};
  for (const key of Object.keys(B)) {
    const a = A[key], b = B[key];
    if (typeof b === 'number') out[key] = typeof a === 'number' ? lerp(a, b, k) : b;
    else if (Array.isArray(b)) out[key] = b.map((v, i) => lerp(a?.[i] ?? v, v, k));
    else if (b && typeof b === 'object') { out[key] = {}; for (const kk of Object.keys(b)) out[key][kk] = lerp(a?.[kk] ?? b[kk], b[kk], k); }
    else out[key] = k < 0.5 ? a : b;
  }
  if (B.posTetap || A.posTetap) { out.x = B.x; out.z = B.z; out.ry = B.ry; out.walk = B.walk; out.walkPh = B.walkPh; out.lie = k < 0.5 && A.posTetap ? A.lie : B.lie; }
  return out;
}
