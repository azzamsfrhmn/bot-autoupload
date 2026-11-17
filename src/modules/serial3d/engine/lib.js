// Fungsi bantu matematika & easing (deterministik: tidak ada Date.now / Math.random).
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
export const easeOutBack = (k) => { k = clamp(k); const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
export const easeInOut = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
export const pop = (t, t0, d = 0.24) => (t < t0 ? 0 : easeOutBack((t - t0) / d));
/** generator acak berbenih (mulberry32) → dunia selalu sama untuk benih yang sama */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
