// Musik latar ceria prosedural (bebas hak cipta) -> WAV mono 16-bit. Tanpa dependensi.
const fs = require('fs');
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PROG = [[0,-3,-7,-5],[0,-7,-3,-5],[0,5,-3,-5],[0,-5,-7,-5]];
function buatMusik(file, durasi, seed = 3) {
  const sr = 44100, n = Math.floor(sr * durasi), out = new Float32Array(n + sr * 2), R = rng(seed);
  const bpm = 104 + Math.floor(R() * 16), beat = 60 / bpm, C = 261.63 * Math.pow(2, (Math.floor(R() * 5) - 2) / 12);
  const sc = [0,2,4,7,9,12,14,16], prog = PROG[Math.floor(R() * PROG.length)], mel = [...Array(16)].map(() => Math.floor(R() * 6));
  const pluck = (f, dur, amp, at) => { const k0 = Math.floor(at * sr), L = Math.floor(dur * sr);
    for (let i = 0; i < L && k0 + i < out.length; i++) { const t = i / sr, env = Math.exp(-t * 6) * (1 - Math.exp(-t * 400));
      out[k0 + i] += amp * env * (Math.sin(2 * Math.PI * f * t) + .35 * Math.sin(4 * Math.PI * f * t) + .12 * Math.sin(6 * Math.PI * f * t)); } };
  for (let i = 0, tt = 0; tt < durasi; i++, tt += beat) {
    const root = prog[Math.floor(tt / (beat * 4)) % 4];
    if (i % 4 === 0 || i % 4 === 2) pluck(C / 2 * Math.pow(2, root / 12), beat * 1.8, .55, tt);
    for (const h of [0, .5]) if (R() < .8) { const deg = sc[mel[(i * 2 + h * 2) % 16]]; pluck(C * Math.pow(2, deg / 12) * ([0,7,12].includes(deg) ? Math.pow(2, root / 12) : 1), beat * .9, .28, tt + h * beat); }
    const k0 = Math.floor(tt * sr); for (let j = 0; j < sr * .04 && k0 + j < out.length; j++) out[k0 + j] += (R() * 2 - 1) * Math.exp(-j / sr * 90) * .05;
  }
  let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
  const fade = sr * 1.5, fin = sr * .5, buf = Buffer.alloc(44 + n * 2);
  for (let i = 0; i < n; i++) { let v = out[i] / mx * .9; if (i > n - fade) v *= (n - i) / fade; if (i < fin) v *= i / fin; buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, buf); return file;
}

module.exports = { buatMusik };
