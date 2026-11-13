/**
 * src/services/aiVideoKartun3D.js
 * Konsep 3D Kartun (Dodo & Bongo) — tanpa Flow & tanpa ChatGPT:
 *   1. Naskah + rancangan adegan (JSON): Claude API (key pelanggan) → cadangan Gemini bawaan
 *   2. Suara per adegan + timestamp kata: ElevenLabs (key pelanggan, wajib)
 *   3. Musik latar prosedural (lokal)
 *   4. Render animasi 3D lokal lewat Remotion (komposisi "Kartun3D") → storage/videos/video_kartun3d_<ts>.mp4
 */
const fs = require('fs');
const path = require('path');
const { buatNaskah } = require('../modules/kartun3d/naskah');
const { buatSuara } = require('../modules/kartun3d/suara');
const { buatSuaraGemini, GAYA } = require('../modules/kartun3d/suara-gemini');
const { buatMusik } = require('../modules/kartun3d/musik');
const { hitungTimeline } = require('../modules/kartun3d/timeline');
const { hitungKarakter, validasiSpec } = require('../modules/kartun3d/validasi');
const { getKartunKeys } = require('../core/kartunKeys');
const { getSavedApiKey } = require('./aiCaption');
const { renderKartun3DVideo } = require('./remotionRenderer');

const ROOT_DIR = process.cwd();
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

// Judul video 3D Kartun sebelumnya (agar topik otomatis tidak dobel)
function recentKartunTitles(limit = 40) {
  try {
    return fs.readdirSync(BAHAN_VIDEO_DIR)
      .filter((d) => /^proyek_kartun3d_\d+$/.test(d))
      .sort()
      .reverse()
      .map((d) => {
        try { return JSON.parse(fs.readFileSync(path.join(BAHAN_VIDEO_DIR, d, 'spec.json'), 'utf8')).judul || ''; } catch (e) { return ''; }
      })
      .filter(Boolean)
      .slice(0, limit);
  } catch (e) {
    return [];
  }
}

async function writeScript({ topik, durasi, signal, onProgress }) {
  const { anthropicKey } = getKartunKeys();
  const common = { topik, otomatis: !topik, durasi, signal, sudahDibuat: recentKartunTitles() };
  if (anthropicKey) {
    try {
      onProgress('Tahap 1: Claude menulis naskah & rancangan adegan 3D Kartun...', 5);
      return await buatNaskah({ ...common, provider: 'claude', apiKey: anthropicKey });
    } catch (err) {
      if (signal?.aborted) throw err;
      onProgress(`[Peringatan] Claude gagal (${err.message.slice(0, 120)}) → naskah dibuat Gemini.`, 6);
    }
  } else {
    onProgress('Tahap 1: Gemini menulis naskah & rancangan adegan 3D Kartun (key Claude belum diisi)...', 5);
  }
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      return await buatNaskah({ ...common, provider: 'gemini', apiKey: getSavedApiKey(), model });
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw new Error(`Gagal membuat naskah 3D Kartun: ${lastErr?.message || 'AI tidak merespons'}`);
}

/**
 * @param {object} options
 *  kartunTopic: topik (kosong = otomatis), kartunDuration: target detik (60–95)
 *  onProgress(status, percent), isCancelled(): true bila tombol Batalkan ditekan
 */
async function runKartun3DPipeline(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  // 3D Cara Kerja = mode narator (tanpa karakter), naskah wajib JSON tempelan / antrian
  const isNarator = options.concept === 'carakerja3d';
  const conceptKey = isNarator ? 'carakerja3d' : 'kartun3d';
  const conceptName = isNarator ? '3D Cara Kerja' : '3D Kartun';
  // Mesin suara: Gemini TTS (gratis, key bawaan) atau ElevenLabs (key pelanggan). 3D Kartun selalu ElevenLabs.
  const useGemini = isNarator && options.voiceEngine !== 'elevenlabs';
  const { elevenlabsKey } = getKartunKeys();
  if (!useGemini && !elevenlabsKey) {
    return { success: false, error: 'API key ElevenLabs belum diisi. Buka Pengaturan AI → bagian "3D Kartun", isi key ElevenLabs Anda lalu simpan.' };
  }
  if (isNarator && !options.kartunSpec) {
    return { success: false, error: 'Naskah 3D Cara Kerja belum ada. Tempel JSON naskah atau isi Antrian Naskah dulu.' };
  }

  const timestamp = Date.now();
  const projectDir = path.join(BAHAN_VIDEO_DIR, `proyek_${conceptKey}_${timestamp}`);
  fs.mkdirSync(projectDir, { recursive: true });

  // Tombol Batalkan → hentikan permintaan API yang sedang berjalan
  const ac = new AbortController();
  const cancelWatch = setInterval(() => {
    try { if (options.isCancelled?.()) ac.abort(); } catch (e) {}
  }, 500);

  try {
    const topik = String(options.kartunTopic || '').trim();
    const durasi = Math.min(95, Math.max(60, Number(options.kartunDuration) || 80));

    // Mode "Tempel JSON": naskah dari claude.ai sudah divalidasi di form → tahap naskah dilewati
    const spec = options.kartunSpec
      ? validasiSpec(options.kartunSpec)
      : await writeScript({ topik, durasi, signal: ac.signal, onProgress });
    if (options.kartunSpec) onProgress('Tahap 1: Memakai naskah JSON tempelan (tanpa AI naskah)...', 8);
    fs.writeFileSync(path.join(projectDir, 'spec.json'), JSON.stringify(spec, null, 2));
    onProgress(`Naskah siap: "${spec.judul}" (${spec.scenes.length} adegan) ✓`, 15);

    const suaraProgress = (i, n) => onProgress(`Suara ${i}/${n}`, 18 + Math.round((i / n) * 37));
    let timing;
    if (useGemini) {
      const voice = String(options.geminiVoice || 'Charon');
      onProgress(`Tahap 2: Gemini TTS (gratis) membuat suara narator ${voice} — ${spec.scenes.length} kalimat...`, 18);
      timing = await buatSuaraGemini({
        spec,
        apiKey: getSavedApiKey(),
        outDir: projectDir,
        voices: { N: voice },
        signal: ac.signal,
        onProgress: suaraProgress,
        onModel: (model, mode) => onProgress(`Model Gemini TTS: ${model} (${mode === 'sekaligus' ? 'narasi sekaligus, 1 permintaan' : 'per kalimat'})`, 20),
        onLimit: (sec, status, model) => onProgress(`Kena batas gratis Gemini (${model}), otomatis menunggu ${sec} detik lalu coba lagi dengan model yang sama...`, 30)
      });
    } else {
      onProgress(`Tahap 2: ElevenLabs membuat suara ${isNarator ? 'narator' : 'Dodo & Bongo'} (±${hitungKarakter(spec)} karakter)...`, 18);
      timing = await buatSuara({
        spec,
        apiKey: elevenlabsKey,
        outDir: projectDir,
        signal: ac.signal,
        onProgress: suaraProgress
      });
    }

    const tl = hitungTimeline(spec, timing);
    onProgress(`Tahap 3: Membuat musik latar (${Math.round(tl.total)} detik)...`, 56);
    buatMusik(path.join(projectDir, 'musik.wav'), tl.total + 0.5, Math.floor(Math.random() * 1e6));

    onProgress(`Tahap 4: Merender animasi ${conceptName} (lokal, tanpa kredit)...`, 60);
    const outputPath = path.join(OUTPUT_VIDEOS_DIR, `video_${conceptKey}_${timestamp}.mp4`);
    await renderKartun3DVideo({ spec, timing, assetDir: projectDir, outputPath }, (msg) => {
      const m = msg.match(/(\d+)%/);
      onProgress(m ? `Render ${m[1]}%` : msg, m ? 60 + Math.round(Number(m[1]) * 0.38) : 60);
    });

    onProgress(`🎉 Sukses! Video ${conceptName} "${spec.judul}" selesai (${Math.round(tl.total)} detik).`, 100);
    return {
      success: true,
      concept: conceptKey,
      judul: spec.judul,
      projectFolder: projectDir,
      videoPath: outputPath,
      storagePath: outputPath,
      fileName: path.basename(outputPath),
      promptText: spec.judul
    };
  } catch (err) {
    if (ac.signal.aborted || options.isCancelled?.()) return { success: false, cancelled: true, error: 'Dibatalkan pengguna' };
    return { success: false, error: pesanIndonesia(err.message) };
  } finally {
    clearInterval(cancelWatch);
  }
}

// Pesan error API diterjemahkan agar mudah dipahami pelanggan
function pesanIndonesia(msg = '') {
  const m = String(msg);
  if (/Gemini TTS kena batas|rate limit|RESOURCE_EXHAUSTED|quota/i.test(m)) return 'Kena batas gratis Gemini TTS (kuota per menit/hari habis). Coba lagi nanti, atau pakai mesin suara ElevenLabs.';
  if (/Model Gemini TTS tidak ditemukan/i.test(m)) return 'Model suara Gemini tidak tersedia untuk key ini. Coba lagi nanti atau pakai ElevenLabs.';
  if (/ElevenLabs 401/i.test(m)) return 'Key ElevenLabs ditolak (tidak valid / izin Text to Speech belum aktif). Cek di Pengaturan AI → 3D Kartun.';
  if (/ElevenLabs 402|quota_exceeded|insufficient/i.test(m)) return 'Kuota karakter ElevenLabs habis. Isi ulang kuota di akun ElevenLabs Anda.';
  if (/ElevenLabs sibuk/i.test(m)) return 'Server ElevenLabs sedang sibuk. Coba lagi beberapa menit lagi.';
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(m)) return 'Koneksi internet terputus saat membuat suara. Periksa internet lalu coba lagi.';
  return m;
}

// Tombol "Tes suara" 3D Cara Kerja: bacakan 1 kalimat contoh → audio WAV (data URL) untuk diputar di aplikasi
async function testGeminiVoice(voice = 'Charon') {
  const { GEMINI_TTS_MODELS } = require('../modules/kartun3d/suara-gemini');
  const text = 'Pernah lihat kabel di tiang listrik yang semrawut kayak benang kusut? Ternyata ada alasannya, lho!';
  let lastErr = '';
  for (const model of GEMINI_TTS_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': getSavedApiKey() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${GAYA.N}\n\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      })
    });
    if (r.status === 404) { lastErr = 'model tidak ditemukan'; continue; }
    if (r.status === 429) return { success: false, error: 'Kena batas gratis Gemini TTS. Tunggu sebentar lalu tes lagi.' };
    if (!r.ok) { lastErr = `${r.status}: ${(await r.text()).slice(0, 150)}`; continue; }
    const d = await r.json();
    const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) { lastErr = 'tidak ada audio'; continue; }
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    return { success: true, model, audio: 'data:audio/wav;base64,' + Buffer.concat([h, pcm]).toString('base64') };
  }
  return { success: false, error: `Tes suara gagal: ${lastErr}` };
}

module.exports = { runKartun3DPipeline, recentKartunTitles, testGeminiVoice };
