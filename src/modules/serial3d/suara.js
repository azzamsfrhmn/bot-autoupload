/**
 * Suara karakter Serial Animasi: Gemini TTS (gratis) per kalimat → efek suara ffmpeg (pitch/formant,
 * EQ, kompresor, potong hening) → voice.wav (48 kHz mono) + timeline.json (waktu per kata).
 * Gemini tidak memberi timestamp kata, jadi: batas kalimat = pasti (1 permintaan per kalimat);
 * posisi kata di dalam kalimat = perkiraan dari jeda audio + panjang kata (analisisPCM/perkiraanKata).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { analisisPCM, perkiraanKata, potongPerKalimat, GEMINI_TTS_MODELS } = require('../kartun3d/suara-gemini');

const SR = 48000;
const LEAD_IN = 0.9;        // hening sebelum kalimat pertama (badge DAY N)
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

/** 1 permintaan TTS. Mengembalikan { pcm } | { notFound } | { limited, tunggu(ms) }. Jaringan putus dicoba ulang 4×. */
async function ttsGemini({ apiKey, model, voice, gaya, text, signal }) {
  const body = {
    contents: [{ parts: [{ text: `${gaya}\n\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
  for (let coba = 0; coba < 5; coba++) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
    } catch (e) {
      if (signal?.aborted || coba === 4) throw e;
      await tidur(4000 * (coba + 1)); continue;        // jaringan putus sebentar → coba lagi
    }
    if (r.status === 404) return { notFound: true };
    if (r.status === 429 || r.status >= 500) {
      let tunggu = 15000, harian = false;
      try {
        const j = await r.json();
        const d = j.error?.details?.find((x) => x.retryDelay)?.retryDelay; if (d) tunggu = (parseFloat(d) + 1) * 1000;
        // kuota HARIAN habis (gratis: 10 permintaan/hari/model) → jangan ditunggu, pulihnya berjam-jam
        harian = (j.error?.details || []).some((x) => (x.violations || []).some((v) => /PerDay/i.test(v.quotaId || ''))) || tunggu > 10 * 60 * 1000;
      } catch (e) {}
      if (r.status >= 500 && coba < 4) { await tidur(5000); continue; }
      return { limited: true, harian, tunggu: Math.min(tunggu, 65000), status: r.status };
    }
    if (!r.ok) throw new Error('Gemini TTS ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Gemini TTS tidak mengembalikan audio');
    return { pcm: Buffer.from(part.inlineData.data, 'base64') };
  }
  throw new Error('Gemini TTS tidak merespons.');
}

/**
 * Minta TTS dengan beberapa model bergantian: saat satu model kena batas gratis, langsung pakai model lain;
 * bila semua kena batas, tunggu yang paling cepat pulih. Kuota tiap model terpisah → lebih jarang menunggu.
 */
async function ttsBergantian({ apiKey, models, voice, gaya, text, signal, onLimit, onModel, state }) {
  state.siap ||= {};                                     // model → waktu (ms) kuota diperkirakan pulih
  state.habis ||= new Set();                             // model yang kuota HARIAN-nya habis
  for (let putaran = 0; putaran < 12; putaran++) {
    if (signal?.aborted) throw new Error('Dibatalkan');
    const hidup = models.filter((m) => !state.habis.has(m));
    if (!hidup.length) throw new Error('KUOTA_HARIAN_HABIS');
    const now = Date.now();
    const urut = hidup.sort((a, b) => (state.siap[a] || 0) - (state.siap[b] || 0));
    const model = urut[0];
    const tunggu = (state.siap[model] || 0) - now;
    if (tunggu > 0) { onLimit?.(Math.ceil(tunggu / 1000), 429, model); await tidur(tunggu); }
    const res = await ttsGemini({ apiKey, model, voice, gaya, text, signal });
    if (res.notFound) { models.splice(models.indexOf(model), 1); if (!models.length) throw new Error('Model Gemini TTS tidak ditemukan untuk key ini.'); continue; }
    if (res.limited) { if (res.harian) state.habis.add(model); else state.siap[model] = Date.now() + res.tunggu; continue; }
    if (state.aktif !== model) { state.aktif = model; onModel?.(model); }
    return { ...res, model };
  }
  throw new Error('Gemini TTS kena batas (rate limit). Coba lagi nanti.');
}

function tulisWav(file, pcm, sr, ch = 1) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2 * ch, 28); h.writeUInt16LE(2 * ch, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
/** baca PCM 16-bit dari WAV (cari chunk "data"; header ffmpeg bisa punya chunk LIST) */
function bacaWav(file) {
  const b = fs.readFileSync(file); let p = 12;
  while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'data') return b.subarray(p + 8, p + 8 + n); p += 8 + n + (n % 2); }
  throw new Error('WAV tanpa chunk data: ' + file);
}

/**
 * Potong audio "sekaligus" jadi per kalimat. Jeda antar baris adalah jeda TERPANJANG (diminta ±0,5 dtk),
 * jadi n-1 jeda terpanjang = titik potong. Hasil dicek: durasi tiap potongan harus sebanding panjang teksnya,
 * kalau tidak → coba cara lama (potongPerKalimat); dua-duanya tidak wajar → null (diminta per kalimat).
 */
function potongBaris(pcm, teks, sr = 24000) {
  const n = teks.length; const info = analisisPCM(pcm, sr);
  if (n === 1) return [{ a: info.start, b: info.end }];
  const bobot = teks.map((s) => s.replace(/[^a-zA-Z0-9]/g, '').length + 6), tot = bobot.reduce((x, y) => x + y, 0);
  const nilai = (segs) => {                               // simpangan terbesar durasi vs harapan (log rasio)
    if (!segs || segs.length !== n) return 99;
    const dTot = segs.reduce((s, g) => s + (g.b - g.a), 0);
    return Math.max(...segs.map((g, i) => Math.abs(Math.log(Math.max(0.05, g.b - g.a) / (dTot * bobot[i] / tot)))));
  };
  // DP: pilih n-1 jeda (urut waktu) yang memaksimalkan  3×panjang jeda − |log(durasi/harapan)|
  let segA = null;
  const cand = info.pauses.filter((p) => p.len >= 0.15).sort((x, y) => x.start - y.start);
  const m = cand.length;
  if (m >= n - 1) {
    const bicara = (info.end - info.start) - cand.reduce((s, p) => s + p.len, 0) * 0.5;
    const harap = (i) => Math.max(0.2, bicara * bobot[i] / tot);
    const biaya = (a, b, i) => Math.abs(Math.log(Math.max(0.05, b - a) / harap(i)));
    const W = 5, NEG = -1e9, dp = Array.from({ length: n - 1 }, () => new Array(m).fill(NEG)), dari = Array.from({ length: n - 1 }, () => new Array(m).fill(-1));
    for (let j = 0; j < m; j++) dp[0][j] = W * cand[j].len - biaya(info.start, cand[j].start, 0);
    for (let k = 1; k < n - 1; k++) for (let j = k; j < m; j++) for (let q = k - 1; q < j; q++) {
      if (dp[k - 1][q] <= NEG) continue;
      const v = dp[k - 1][q] + W * cand[j].len - biaya(cand[q].end, cand[j].start, k);
      if (v > dp[k][j]) { dp[k][j] = v; dari[k][j] = q; }
    }
    let best = NEG, bj = -1;
    for (let j = n - 2; j < m; j++) { if (dp[n - 2][j] <= NEG) continue; const v = dp[n - 2][j] - biaya(cand[j].end, info.end, n - 1); if (v > best) { best = v; bj = j; } }
    if (bj >= 0) {
      const pilih = []; for (let k = n - 2, j = bj; k >= 0; k--) { pilih.unshift(cand[j]); j = dari[k][j]; }
      segA = pilih.map((p, i) => ({ a: i ? pilih[i - 1].end : info.start, b: p.start })).concat([{ a: pilih[n - 2].end, b: info.end }]);
    }
  }
  const segB = potongPerKalimat(pcm, teks, sr);
  const vA = nilai(segA), vB = nilai(segB);
  const best = vA <= vB ? segA : segB, v = Math.min(vA, vB);
  return v < Math.log(2.2) ? best : null;                // durasi maksimal 2,2x / minimal 0,45x dari harapan
}

/** amplop keras-pelan suara (0..1) per frame → mulut terbuka saat bersuara */
function amplop(pcm, sr, fps) {
  const per = Math.round(sr / fps), n = Math.floor(pcm.length / 2 / per), v = new Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = 0; i < per; i += 4) { const x = pcm.readInt16LE((f * per + i) * 2) / 32768; s += x * x; } v[f] = Math.sqrt(s / (per / 4)); }
  const urut = v.slice().sort((a, b) => a - b), puncak = urut[Math.floor(n * 0.95)] || 0.1;
  return { fps, v: v.map((x, i) => { const y = Math.min(1, (0.6 * x + 0.4 * (v[i - 1] ?? x)) / puncak); return y < 0.12 ? 0 : +y.toFixed(2); }) };
}

/** efek suara karakter (port tools/tts.py fx): k>1 = lebih cempreng & cepat */
function fx(ffmpeg, src, dst, k, teriak) {
  const chain = [`aresample=${SR}`, `asetrate=${SR}*${k}`, `aresample=${SR}`];
  if (teriak) chain.push('vibrato=f=11:d=0.55', 'tremolo=f=17:d=0.35');
  chain.push('highpass=f=140', 'equalizer=f=2800:t=q:w=1.1:g=4', 'equalizer=f=320:t=q:w=1.0:g=-2',
    'acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=3', 'alimiter=limit=0.89',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02', 'areverse',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06', 'areverse');
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', src, '-af', chain.join(','), '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', dst], { windowsHide: true });
  if (r.status !== 0) throw new Error('ffmpeg efek suara gagal: ' + String(r.stderr || '').slice(-300));
}

/**
 * @param {object} o { naskah, karakter, apiKey, outDir, ffmpeg, onProgress(i,n,teks), onLimit, signal, jeda }
 * @returns {Promise<{timeline:object, voiceWav:string}>}
 */
async function buatSuaraSerial({ naskah, karakter, apiKey, outDir, ffmpeg, onProgress, onLimit, onModel, signal, jeda = 12500, cacheDir }) {
  if (!apiKey) throw new Error('API key Gemini belum diisi');
  fs.mkdirSync(outDir, { recursive: true });
  const linesDir = path.join(outDir, 'lines'); fs.mkdirSync(linesDir, { recursive: true });
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  const V = Object.assign({}, karakter.suara, naskah.suara || {});
  const models = GEMINI_TTS_MODELS.slice(); const state = {};
  const gayaDasar = `Bacakan kalimat berikut sebagai ${V.gaya}. Bahasa Indonesia sehari-hari, intonasi natural (bukan logat asing), ekspresif, tanpa jeda panjang di tanda baca. Ucapkan persis seperti tertulis, jangan menambah kata.`;

  const timeline = []; let t = LEAD_IN; const chunks = [Buffer.alloc(Math.round(LEAD_IN * SR) * 2)];
  const kal = naskah.kalimat; let dariCache = 0, terakhirMinta = 0, sekaligus = 0;
  // info per kalimat (gaya, k, file, kunci cache)
  const info = kal.map((k) => {
    const teriak = !!(k.suara?.teriak || k.shot === 'teriak');
    const gaya = k.suara?.gaya ? `Bacakan sebagai ${V.gaya}. ${k.suara.gaya}` : teriak ? `${gayaDasar} Kalimat ini adalah TERIAKAN panik yang panjang dan kencang.` : gayaDasar;
    const kk = Number(k.suara?.k) || Number(V.k) || 1.1;
    const key = crypto.createHash('sha1').update(JSON.stringify([k.text, V.nama, gaya, kk, teriak])).digest('hex');
    return { k, teriak, gaya, kk, wav: path.join(linesDir, `${k.id}.wav`), cached: cacheDir ? path.join(cacheDir, `${key}.wav`) : null };
  });
  const adaCache = (x) => x.cached && fs.existsSync(x.cached) && fs.statSync(x.cached).size > 1000;
  // HEMAT KUOTA: semua kalimat yang belum ada di cache dibacakan dalam 1 permintaan, lalu dipotong per kalimat
  const kurang = info.filter((x) => !adaCache(x));
  if (kurang.length > 1) {
    onProgress?.(1, kal.length, `${kurang.length} kalimat sekaligus (1 permintaan)`);
    const gayaSekaligus = `${gayaDasar} Bacakan SEMUA baris berikut berurutan dengan suara & energi yang sama, beri jeda HENING sekitar 1,5 detik di antara setiap baris (antar baris harus jeda paling panjang). Baris berisi "Aaaa...!" adalah teriakan panik yang panjang.`;
    const res = await ttsBergantian({ apiKey, models, voice: V.nama, gaya: gayaSekaligus, text: kurang.map((x) => x.k.text).join('\n\n'), signal, onLimit, onModel, state });
    terakhirMinta = Date.now();
    const segs = potongBaris(res.pcm, kurang.map((x) => x.k.text), 24000);
    if (segs) {
      segs.forEach((g, j) => {
        const x = kurang[j];
        const a = Math.max(0, Math.floor((g.a - 0.03) * 24000)) * 2, b = Math.min(res.pcm.length, Math.ceil((g.b + 0.1) * 24000) * 2);
        const raw = path.join(linesDir, `${x.k.id}_raw.wav`);
        tulisWav(raw, res.pcm.subarray(a, b), 24000);
        fx(ffmpeg, raw, x.wav, x.teriak ? Math.max(x.kk, 1.25) : x.kk, x.teriak);
        if (x.cached) { try { fs.copyFileSync(x.wav, x.cached); } catch (e) {} }
      });
      sekaligus = kurang.length;
    }
    // gagal dipotong → lanjut per kalimat di bawah (kalimat yang sudah jadi tidak diminta ulang)
  }
  for (let i = 0; i < kal.length; i++) {
    if (signal?.aborted) throw new Error('Dibatalkan');
    const { k, teriak, gaya, kk, wav, cached } = info[i];
    onProgress?.(i + 1, kal.length, k.text);
    if (fs.existsSync(wav) && fs.statSync(wav).size > 1000) {
      // sudah dibuat oleh permintaan sekaligus
    } else if (adaCache(info[i])) {
      fs.copyFileSync(cached, wav); dariCache++;
    } else {
      // jeda antar permintaan (kuota gratis ±5 permintaan/menit per model)
      const sisa = terakhirMinta + jeda - Date.now(); if (sisa > 0) await tidur(sisa);
      const res = await ttsBergantian({ apiKey, models, voice: V.nama, gaya, text: k.text, signal, onLimit, onModel, state });
      terakhirMinta = Date.now();
      const raw = path.join(linesDir, `${k.id}_raw.wav`);
      tulisWav(raw, res.pcm, 24000);
      fx(ffmpeg, raw, wav, teriak ? Math.max(kk, 1.25) : kk, teriak);
      if (cached) { try { fs.copyFileSync(wav, cached); } catch (e) {} }
    }
    const pcm = bacaWav(wav); const dur = pcm.length / 2 / SR;
    const ana = analisisPCM(pcm, SR);
    const toks = k.text.split(/\s+/).filter(Boolean);
    const est = perkiraanKata(k.text, ana);                    // [[kata, detik]] relatif awal wav
    const words = toks.map((w, j) => { const a = est[j]?.[1] ?? 0; const b = est[j + 1]?.[1] ?? Math.min(ana.end, dur); return { w, t: +(t + a).toFixed(3), d: +Math.max(0.06, b - a).toFixed(3) }; });
    timeline.push({ id: k.id, text: k.text, t: +t.toFixed(3), d: +dur.toFixed(3), words });
    chunks.push(pcm); t += dur;
    const gap = Math.round((Number(k.jeda) || 0) * SR); chunks.push(Buffer.alloc(gap * 2)); t += gap / SR;
  }
  const voiceWav = path.join(outDir, 'voice.wav');
  const semua = Buffer.concat(chunks);
  tulisWav(voiceWav, semua, SR);
  // gerak mulut dari keras-pelan suara (30 fps): selalu sinkron dengan audio, tidak bergantung perkiraan waktu kata
  const tl = { duration: +t.toFixed(3), lines: timeline, mulut: amplop(semua, SR, 30) };
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(tl, null, 1));
  return { timeline: tl, voiceWav, model: state.aktif || (dariCache ? 'cache' : models[0]), dariCache, sekaligus };
}

/** tes 1 kalimat → data URL wav (untuk tombol "Tes suara" di aplikasi) */
async function tesSuaraSerial({ apiKey, karakter, text, ffmpeg, tmpDir }) {
  const V = karakter.suara;
  const res = await ttsBergantian({ apiKey, models: GEMINI_TTS_MODELS.slice(), voice: V.nama, gaya: `Bacakan sebagai ${V.gaya}. Bahasa Indonesia natural.`, text, state: {} });
  const model = res.model;
  fs.mkdirSync(tmpDir, { recursive: true });
  const raw = path.join(tmpDir, `tes_${Date.now()}_raw.wav`), wav = raw.replace('_raw', '');
  tulisWav(raw, res.pcm, 24000); fx(ffmpeg, raw, wav, Number(V.k) || 1.1, false);
  const out = 'data:audio/wav;base64,' + fs.readFileSync(wav).toString('base64');
  try { fs.unlinkSync(raw); fs.unlinkSync(wav); } catch (e) {}
  return { audio: out, model };
}

module.exports = { buatSuaraSerial, tesSuaraSerial, SR, LEAD_IN };
