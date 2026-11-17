/**
 * Musik latar + ombak + efek suara, semua DISINTESIS sendiri (tanpa file/lisensi), lalu dicampur
 * dengan suara karakter memakai ffmpeg (musik menunduk saat karakter bicara).
 * Port dari tools/audio.mjs referensi, dijadikan fungsi dengan parameter.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

const SR = 48000;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * @param {object} o { duration, events:[{t,type}], diam:[[a,b]] (musik hening), outWav, seed }
 */
function buatBed({ duration, events = [], diam = [], outWav, seed = 1234 }) {
  const DUR = duration, N = Math.ceil(DUR * SR);
  const Lr = new Float32Array(N), Rr = new Float32Array(N);
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const add = (t, len, fn, pan = 0) => { const i0 = Math.floor(t * SR), n = Math.floor(len * SR); const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4); for (let i = 0; i < n; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; const v = fn(i / SR, i); Lr[j] += v * gl * 1.41; Rr[j] += v * gr * 1.41; } };

  // ombak
  { let lp = 0, lp2 = 0; for (let i = 0; i < N; i++) { const t = i / SR; const w = rnd() * 2 - 1; lp += (w - lp) * 0.035; lp2 += (lp - lp2) * 0.12; const swell = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.13 - 1), 2); const v = lp2 * swell * 0.5; Lr[i] += v * (0.9 + 0.1 * Math.sin(t * 0.7)); Rr[i] += v * (0.9 - 0.1 * Math.sin(t * 0.7)); } }

  // musik tropis 108 bpm (marimba + ukulele + bass + shaker)
  const mus = { L: new Float32Array(N), R: new Float32Array(N) };
  const madd = (t, len, fn, pan = 0) => { const i0 = Math.floor(t * SR), n = Math.floor(len * SR); for (let i = 0; i < n; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; const v = fn(i / SR); mus.L[j] += v * (1 - pan * 0.5); mus.R[j] += v * (1 + pan * 0.5); } };
  const marimba = (t, m, g = 0.2, pan = 0) => { const f = hz(m); madd(t, 0.7, (x) => g * Math.exp(-x * 7) * (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.exp(-x * 18) * Math.sin(2 * Math.PI * f * 4 * x) + 0.15 * Math.sin(2 * Math.PI * f * 2 * x)), pan); };
  const pluck = (t, m, g = 0.1, pan = 0) => { const f = hz(m); madd(t, 0.5, (x) => g * Math.exp(-x * 9) * (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(2 * Math.PI * f * 2 * x + 0.3) + 0.2 * Math.sin(2 * Math.PI * f * 3 * x)), pan); };
  const bass = (t, m, g = 0.22) => { const f = hz(m); madd(t, 0.45, (x) => g * Math.exp(-x * 5) * Math.sin(2 * Math.PI * f * x + 0.6 * Math.sin(2 * Math.PI * f * x))); };
  const shaker = (t, g = 0.035) => { let hp = 0; madd(t, 0.07, (x) => { const w = rnd() * 2 - 1; const o = w - hp; hp = w * 0.7 + hp * 0.3; return g * o * Math.exp(-x * 60); }, 0.4); };
  const kick = (t, g = 0.3) => madd(t, 0.22, (x) => g * Math.exp(-x * 16) * Math.sin(2 * Math.PI * (48 + 70 * Math.exp(-x * 40)) * x));
  const BEAT = 60 / 108, BAR = BEAT * 4;
  const CH = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
  const MEL = [[76, 0], [79, 1], [76, 1.5], [72, 2.5], [69, 4], [72, 5], [76, 5.5], [72, 6.5], [69, 8], [72, 9], [77, 9.5], [76, 10.5], [74, 12], [71, 13], [74, 13.5], [79, 14.5]];
  for (let bar = 0, t = 0.5; t < DUR; bar++, t += BAR) {
    const c = CH[bar % 4];
    bass(t, c[0] - 24); bass(t + BEAT * 1.5, c[0] - 24, 0.14); bass(t + BEAT * 2.5, c[2] - 24, 0.16);
    kick(t); kick(t + BEAT * 2.5, 0.2);
    for (let k = 0; k < 8; k++) shaker(t + k * BEAT / 2, k % 2 ? 0.045 : 0.025);
    [0.5, 1, 1.75, 2.5, 3, 3.5].forEach((b, i) => { c.slice(1).forEach((n, j) => pluck(t + b * BEAT + j * 0.012, n, i % 2 ? 0.05 : 0.07, -0.5)); });
    if (bar % 4 === 0) MEL.forEach(([m, b]) => marimba(t + b * BEAT, m, 0.16, 0.35));
  }
  const tEnd = DUR - 0.9;
  for (let i = 0; i < N; i++) {
    const t = i / SR; let g = 0.55;
    for (const [a, b] of diam) { if (t > a && t < b) g = 0; else if (t >= b && t < b + 0.05) g *= (t - b) / 0.05; }
    g *= Math.min(1, t / 0.3); if (t > tEnd) g *= Math.max(0, 1 - (t - tEnd) / 0.9);
    Lr[i] += mus.L[i] * g; Rr[i] += mus.R[i] * g;
  }

  // efek suara
  const FX = {
    pop: (t) => add(t, 0.12, (x) => 0.32 * Math.exp(-x * 38) * Math.sin(2 * Math.PI * (520 + 900 * Math.exp(-x * 30)) * x)),
    tick: (t) => add(t, 0.09, (x) => 0.22 * Math.exp(-x * 50) * Math.sin(2 * Math.PI * (880 + 500 * Math.exp(-x * 40)) * x), 0.3),
    thud: (t) => add(t, 0.35, (x) => 0.55 * Math.exp(-x * 13) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-x * 30)) * x)),
    whoosh: (t) => { let lp = 0; add(t - 0.12, 0.3, (x) => { const w = rnd() * 2 - 1; const k = 0.03 + 0.25 * Math.sin(Math.PI * x / 0.3); lp += (w - lp) * k; return 0.3 * lp * Math.sin(Math.PI * x / 0.3) ** 2; }); },
    hit: (t) => { add(t, 0.5, (x) => 0.6 * Math.exp(-x * 9) * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-x * 25)) * x)); add(t, 0.25, (x) => 0.35 * Math.exp(-x * 22) * (rnd() * 2 - 1)); },
    bubble: (t) => { for (let k = 0; k < 14; k++) { const tt = t + k * 0.11 + rnd() * 0.05, f0 = 300 + rnd() * 500; add(tt, 0.09, (x) => 0.16 * Math.sin(Math.PI * x / 0.09) * Math.sin(2 * Math.PI * (f0 + 2600 * x) * x), rnd() - 0.5); } },
    bonk: (t) => { add(t, 0.3, (x) => 0.75 * Math.exp(-x * 22) * (Math.sin(2 * Math.PI * 310 * x) + 0.6 * Math.sin(2 * Math.PI * 742 * x) + 0.3 * Math.sin(2 * Math.PI * 1190 * x))); add(t, 0.05, (x) => 0.4 * Math.exp(-x * 90) * (rnd() * 2 - 1)); },
    sad: (t) => [0, 1, 2].forEach((i) => add(t + i * 0.2, 0.3, (x) => 0.2 * Math.exp(-x * 7) * Math.sin(2 * Math.PI * (311 - i * 28 - 20 * x) * x + 1.5 * Math.sin(2 * Math.PI * 6 * x)))),
    growl: (t) => add(t, 0.75, (x) => 0.3 * Math.sin(Math.PI * x / 0.75) * Math.sin(2 * Math.PI * (58 + 14 * Math.sin(x * 13)) * x + 2.5 * Math.sin(2 * Math.PI * 23 * x))),
  };
  for (const e of events) FX[e.type]?.(e.t);
  const lastThud = events.filter((e) => e.type === 'thud').at(-1);
  if (lastThud) [84, 88, 91].forEach((m, i) => add(lastThud.t + 0.05 + i * 0.09, 1.0, (x) => 0.12 * Math.exp(-x * 4) * Math.sin(2 * Math.PI * hz(m) * x)));

  const buf = Buffer.alloc(44 + N * 4); buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  const cl = (v) => Math.max(-1, Math.min(1, Math.tanh(v * 0.9)));
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(cl(Lr[i]) * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(cl(Rr[i]) * 32000), 46 + i * 4); }
  fs.writeFileSync(outWav, buf);
  return outWav;
}

/** campur suara + bed: suara di depan, musik menunduk (sidechain) saat bicara */
function campurAudio({ ffmpeg, voiceWav, bedWav, outWav, duration }) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', voiceWav, '-i', bedWav, '-filter_complex',
    `[0:a]aformat=channel_layouts=stereo,volume=1.5,apad=whole_dur=${duration},asplit=2[v][sc];[1:a]volume=0.55[b];[b][sc]sidechaincompress=threshold=0.03:ratio=5:attack=15:release=260[bd];[v][bd]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95,atrim=0:${duration}[o]`,
    '-map', '[o]', '-ar', String(SR), '-c:a', 'pcm_s16le', outWav], { windowsHide: true });
  if (r.status !== 0) throw new Error('ffmpeg campur audio gagal: ' + String(r.stderr || '').slice(-300));
  return outWav;
}

module.exports = { buatBed, campurAudio, SR };
