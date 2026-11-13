// Sumber: suara-gemini.js terbaru (2026-11-07), dikonversi ke CommonJS untuk aplikasi.
// Suara GRATIS via Gemini TTS (free tier AI Studio). Antarmuka sama dengan buatSuara() di suara.js.
// Output: <outDir>/NN_<who>.wav + timing.json  ({ end, words:[[kata, detik]], trim:0, files })
// Gemini TTS tidak memberi timestamp per kata, jadi waktu kata DIPERKIRAKAN dari jeda di audio.
const fs = require('fs');
const path = require('path');

const GEMINI_TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
// Daftar nama suara bawaan Gemini: Charon (informatif), Sadaltager (berpengetahuan), Iapetus (jernih),
// Puck (ceria), Fenrir (bersemangat), Algenib (serak/berat), Kore (tegas), Achird (ramah), dll.
const SUARA_GEMINI_DEFAULT = { N: 'Charon', B: 'Fenrir', D: 'Puck' };
const GAYA = {
  N: 'Bacakan sebagai narator video edukasi TikTok yang profesional: jelas, percaya diri, hangat, tempo agak cepat, intonasi natural bahasa Indonesia sehari-hari (bukan logat asing), tanpa jeda panjang.',
  B: 'Bacakan sebagai cowok bertubuh besar yang polos dan ceria, logat anak muda Jakarta, natural dan ekspresif.',
  D: 'Bacakan sebagai cowok muda yang pintar dan sabar, logat anak muda Jakarta, jelas dan ramah.',
};
const SR = 24000;
const tidur = ms => new Promise(r => setTimeout(r, ms));

async function ttsSekali({ apiKey, model, voice, gaya, text, signal, onLimit }) {
  const body = {
    contents: [{ parts: [{ text: `${gaya}\n\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
  for (let coba = 0; coba < 6; coba++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
    if (r.status === 404) return { notFound: true };
    if (r.status === 429 || r.status >= 500) {
      let tunggu = 8000 * (coba + 1);
      try { const j = await r.json(); const d = j.error?.details?.find(x => x.retryDelay)?.retryDelay; if (d) tunggu = (parseFloat(d) + 1) * 1000; } catch {}
      onLimit?.(Math.round(Math.min(tunggu, 65000) / 1000), r.status, model);
      await tidur(Math.min(tunggu, 65000)); continue;
    }
    if (!r.ok) throw new Error('Gemini TTS ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    const part = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) throw new Error('Gemini TTS tidak mengembalikan audio');
    return { pcm: Buffer.from(part.inlineData.data, 'base64') };
  }
  throw new Error('Gemini TTS kena batas (rate limit). Coba lagi nanti / kurangi jumlah video per hari.');
}

// ---- analisis audio: cari bagian bersuara & jeda ----
function analisisPCM(pcm, sr = SR) {
  const n = Math.floor(pcm.length / 2), win = Math.floor(sr * .01), frames = Math.floor(n / win), en = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < win; i++) { const v = pcm.readInt16LE((f * win + i) * 2) / 32768; s += v * v; } en[f] = Math.sqrt(s / win); }
  const sorted = Array.from(en).sort((a, b) => a - b), peak = sorted[Math.floor(frames * .95)] || .01;
  const thr = Math.max(.008, peak * .08);
  let a = 0, b = frames - 1; while (a < frames && en[a] < thr) a++; while (b > a && en[b] < thr) b--;
  const pauses = []; let run = 0;
  for (let f = a; f <= b; f++) { if (en[f] < thr) run++; else { if (run >= 12) pauses.push({ start: (f - run) * .01, end: f * .01, len: run * .01 }); run = 0; } }
  return { start: a * .01, end: (b + 1) * .01, pauses };
}
// kata -> waktu: frasa dipisah tanda baca, dipetakan ke jeda terpanjang, lalu dibagi per huruf
function perkiraanKata(text, info) {
  const words = text.split(/\s+/).filter(Boolean);
  const phrases = []; let cur = [];
  words.forEach((w, i) => { cur.push(w); if (/[.,!?;:]$/.test(w) && i < words.length - 1) { phrases.push(cur); cur = []; } });
  if (cur.length) phrases.push(cur);
  const need = phrases.length - 1;
  const cut = info.pauses.slice().sort((x, y) => y.len - x.len).slice(0, need).sort((x, y) => x.start - y.start);
  const bounds = [info.start]; for (let i = 0; i < need; i++) { if (cut[i]) bounds.push(cut[i].start, cut[i].end); }
  let segs = [];
  if (cut.length === need) { for (let i = 0; i < phrases.length; i++) segs.push([i ? cut[i - 1].end : info.start, i < need ? cut[i].start : info.end]); }
  else { const tot = words.reduce((s, w) => s + w.length + 1, 0); let t = info.start; phrases.forEach(p => { const L = p.reduce((s, w) => s + w.length + 1, 0), d = (info.end - info.start) * L / tot; segs.push([t, t + d]); t += d; }); }
  const out = [];
  phrases.forEach((p, i) => { const [s, e] = segs[i], tot = p.reduce((a, w) => a + w.length + 1, 0); let t = s; p.forEach(w => { out.push([w, t]); t += (e - s) * (w.length + 1) / tot; }); });
  return out;
}
function tulisWAV(file, pcm, sr = SR) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
function campur(a, b) { const n = Math.max(a.length, b.length), o = Buffer.alloc(n); for (let i = 0; i + 1 < n; i += 2) { const x = (i < a.length ? a.readInt16LE(i) : 0) + (i < b.length ? b.readInt16LE(i) : 0); o.writeInt16LE(Math.max(-32768, Math.min(32767, x)), i); } return o; }

// ---- potong audio panjang jadi per kalimat: cari jeda yang paling cocok dengan proporsi teks ----
function potongPerKalimat(pcm, teks, sr = SR) {
  const info = analisisPCM(pcm, sr), n = teks.length;
  if (n === 1) return [{ a: info.start, b: info.end }];
  const len = teks.map(t => t.length + 8), tot = len.reduce((x, y) => x + y, 0);
  const cand = info.pauses.filter(p => p.len >= .14);
  const cuts = []; let cum = 0, minT = info.start;
  for (let k = 0; k < n - 1; k++) {
    cum += len[k]; const e = info.start + (info.end - info.start) * cum / tot;
    let best = null, bs = 1e9;
    for (const p of cand) { const mid = (p.start + p.end) / 2; if (mid <= minT + .25) continue; const sc = Math.abs(mid - e) - .6 * Math.min(p.len, .8); if (sc < bs) { bs = sc; best = p; } }
    if (!best || Math.abs((best.start + best.end) / 2 - e) > 2.5) return null;
    cuts.push(best); minT = best.end; cand.splice(cand.indexOf(best), 1);
  }
  const segs = []; for (let k = 0; k < n; k++) segs.push({ a: k ? cuts[k - 1].end : info.start, b: k < n - 1 ? cuts[k].start : info.end });
  return segs;
}
function normalisasi(pcm, target = .11) {
  const n = pcm.length / 2; let s = 0, c = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; if (Math.abs(v) > .02) { s += v * v; c++; } }
  const rms = c ? Math.sqrt(s / c) : target, g = Math.min(4, target / rms), o = Buffer.alloc(pcm.length);
  for (let i = 0; i < n; i++) o.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i * 2) * g))), i * 2);
  return o;
}
// Mode NARATOR SEKALIGUS: 1 permintaan untuk semua kalimat -> suara konsisten dari awal sampai akhir
async function narasiSekaligus({ spec, apiKey, outDir, voice, model, onProgress, onLimit, signal }) {
  const teks = spec.scenes.map(s => s.say);
  const gaya = GAYA.N + ' Bacakan semua kalimat berikut berurutan dengan suara, energi, dan tempo yang SAMA dari awal sampai akhir. Beri jeda singkat (setengah detik) di antara setiap baris.';
  const res = await ttsSekali({ apiKey, model, voice, gaya, text: teks.join('\n\n'), signal, onLimit });
  if (res.notFound) return { notFound: true };
  const segs = potongPerKalimat(res.pcm, teks);
  if (!segs) return { gagalPotong: true };
  const timing = [];
  segs.forEach((g, i) => {
    const a = Math.max(0, Math.floor((g.a - .03) * SR)) * 2, b = Math.min(res.pcm.length, Math.ceil((g.b + .1) * SR) * 2);
    const pcm = normalisasi(res.pcm.subarray(a, b)), info = analisisPCM(pcm), f = `${String(i).padStart(2, '0')}_N.wav`;
    tulisWAV(path.join(outDir, f), pcm);
    timing.push({ end: info.end, words: perkiraanKata(teks[i], info), trim: 0, files: [f], perkiraan: true });
    onProgress?.(i + 1, segs.length);
  });
  return { timing };
}

/**
 * @param {object} o
 * @param {object} o.spec
 * @param {string} o.apiKey      key Gemini (AI Studio)
 * @param {string} o.outDir
 * @param {{N?:string,B?:string,D?:string}} [o.voices]
 * @param {string} [o.model]     kosong = coba GEMINI_TTS_MODELS berurutan
 * @param {number} [o.jeda]      ms antar permintaan (hindari rate limit free tier), default 4000
 */
async function buatSuaraGemini({ spec, apiKey, outDir, voices = {}, model, jeda = 4000, onProgress, onLimit, onModel, signal }) {
  if (!apiKey) throw new Error('API key Gemini belum diisi');
  fs.mkdirSync(outDir, { recursive: true });
  const V = { ...SUARA_GEMINI_DEFAULT, ...voices }, models = model ? [model] : GEMINI_TTS_MODELS.slice();
  let aktif = models[0];
  if (spec.scenes.every(x => x.who === 'N')) {
    while (models.length) {
      onModel?.(models[0], 'sekaligus');
      const r = await narasiSekaligus({ spec, apiKey, outDir, voice: V.N, model: models[0], onProgress, onLimit, signal });
      if (r.notFound) { models.shift(); continue; }
      if (r.timing) { fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(r.timing)); return r.timing; }
      onModel?.(models[0], 'per-kalimat'); // gagal memotong -> lanjut mode per kalimat (model yang sama)
      break;
    }
    if (!models.length) throw new Error('Model Gemini TTS tidak ditemukan. Isi nama model yang tersedia di AI Studio.');
    aktif = models[0];
  }
  const timing = [];
  for (let i = 0; i < spec.scenes.length; i++) {
    if (signal?.aborted) throw new Error('Dibatalkan');
    const s = spec.scenes[i], whos = s.who === 'BD' ? ['B', 'D'] : [s.who];
    let gabung = null; const files = [];
    for (const w of whos) {
      let res;
      while (true) { res = await ttsSekali({ apiKey, model: aktif, voice: V[w] || V.N, gaya: GAYA[w] || GAYA.N, text: s.say, signal, onLimit });
        if (!res.notFound) break; models.shift(); if (!models.length) throw new Error('Model Gemini TTS tidak ditemukan. Isi nama model yang tersedia di AI Studio.'); aktif = models[0]; }
      if (i === 0 && w === whos[0] && !spec.scenes.every(x => x.who === 'N')) onModel?.(aktif, 'per-kalimat');
      gabung = gabung ? campur(gabung, res.pcm) : res.pcm;
      await tidur(jeda);
    }
    const info = analisisPCM(gabung);
    const a = Math.max(0, Math.floor((info.start - .03) * SR)) * 2, b = Math.min(gabung.length, Math.ceil((info.end + .12) * SR) * 2);
    const pcm = normalisasi(gabung.subarray(a, b)), shift = a / 2 / SR;
    const words = perkiraanKata(s.say, info).map(([w, t]) => [w, Math.max(0, t - shift)]);
    const f = `${String(i).padStart(2, '0')}_${s.who}.wav`; tulisWAV(path.join(outDir, f), pcm); files.push(f);
    timing.push({ end: info.end - shift, words, trim: 0, files, perkiraan: true });
    onProgress?.(i + 1, spec.scenes.length);
  }
  fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing));
  return timing;
}

module.exports = { GEMINI_TTS_MODELS, SUARA_GEMINI_DEFAULT, GAYA, analisisPCM, perkiraanKata, potongPerKalimat, buatSuaraGemini };
