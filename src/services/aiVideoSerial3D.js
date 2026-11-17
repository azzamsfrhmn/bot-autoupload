/**
 * src/services/aiVideoSerial3D.js
 * Konsep "Serial Animasi Day-N" (SA) — semuanya lokal & gratis, tanpa Flow/ChatGPT:
 *   1. Naskah JSON (divalidasi) + karakter parametrik       → storage/bahan_video/proyek_serial3d_<ts>/
 *   2. Suara: Gemini TTS (gratis) + efek ffmpeg + waktu kata → voice.wav, timeline.json
 *   3. Musik/ombak/SFX disintesis + dicampur (ffmpeg)        → audio.wav
 *   4. Render three.js di Chrome (GPU) → ffmpeg nvenc/amf/x264 → storage/videos/video_serial3d_<ts>.mp4
 */
const fs = require('fs');
const path = require('path');
const { validateNaskah, CONTOH, DUNIA, WAKTU } = require('../modules/serial3d/naskah');
const { resolveKarakter, KARAKTER } = require('../modules/serial3d/karakter');
const { analisisKarakter, tulisNaskah, buatRencana, parseRencana, formatRencana } = require('../modules/serial3d/ai');
const { muatKarakter, simpanKarakter, bacaSeri, simpanSeri, hariBerikut, catatEpisode, dirOf } = require('../modules/serial3d/simpanan');
const { buatSuaraSerial, tesSuaraSerial, LEAD_IN } = require('../modules/serial3d/suara');
const { buatBed, campurAudio } = require('../modules/serial3d/audio');
const { renderSerial, renderStills } = require('../modules/serial3d/render');
const { getFfmpegPath } = require('../core/videoEnhancer');
const { getSavedApiKey } = require('./aiCaption');
const { getKartunKeys } = require('../core/kartunKeys');

/** key Gemini pribadi pelanggan (kuota sendiri) bila diisi, selain itu key bawaan aplikasi */
function kunciGemini() { try { const k = getKartunKeys().geminiKey; if (k) return k; } catch (e) {} return getSavedApiKey(); }

const ROOT_DIR = process.cwd();
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');

/** timeline TIRUAN (tanpa TTS) untuk pratinjau: ±13 huruf/detik, kata dibagi menurut panjangnya */
function buatTimelineTiruan(naskah) {
  let t = LEAD_IN; const lines = [];
  for (const k of naskah.kalimat) {
    const toks = k.text.split(/\s+/).filter(Boolean); const tot = toks.reduce((s, w) => s + w.length + 1, 0);
    const d = 0.3 + tot * 0.075; let x = t; const words = toks.map((w) => { const dd = d * (w.length + 1) / tot; const o = { w, t: +x.toFixed(3), d: +dd.toFixed(3) }; x += dd; return o; });
    lines.push({ id: k.id, text: k.text, t: +t.toFixed(3), d: +d.toFixed(3), words }); t += d + (Number(k.jeda) || 0);
  }
  return { duration: +t.toFixed(3), lines, tiruan: true };
}

function siapkanProyek({ naskahInput, karakterInput, voiceName }) {
  const v = validateNaskah(naskahInput);
  if (!v.ok) throw new Error('Naskah tidak valid:\n- ' + v.errors.join('\n- '));
  const naskah = v.naskah;
  const karakter = muatKarakter(karakterInput || naskah.seri.karakter);
  if (voiceName) karakter.suara.nama = voiceName;
  naskah.seri.karakter = karakter.id;
  return { naskah, karakter };
}

/** Latar/waktu pilihan pelanggan menimpa naskah (event yang tidak ada di dunia itu dibuang). '' = biarkan naskah. */
function terapkanLatar(naskahInput, dunia, waktu) {
  if (!naskahInput || (!DUNIA[dunia] && !WAKTU[waktu])) return naskahInput;
  let n; try { n = typeof naskahInput === 'string' ? JSON.parse(naskahInput) : JSON.parse(JSON.stringify(naskahInput)); } catch (e) { return naskahInput; }
  n.seri = Object.assign({}, n.seri || {});
  if (WAKTU[waktu]) n.seri.waktu = waktu;
  if (DUNIA[dunia]) {
    n.seri.dunia = dunia;
    (n.kalimat || []).forEach((k) => { if (k && k.adegan && k.adegan.objek === 'kaktus' && dunia !== 'gurun') k.adegan.objek = 'semak'; });
    (n.kalimat || []).forEach((k) => { const j = k && k.event && (typeof k.event === 'string' ? k.event : k.event.jenis); if (j && !DUNIA[dunia].event.includes(j)) delete k.event; });
  }
  return n;
}

/** Naskah otomatis (Gemini) dari premis; hari = episode berikutnya karakter ini bila tidak diisi */
async function buatNaskahAI({ karakterId, premis, hari, latar, suasana, rencana: rencanaTeks, onProgress = () => {} }) {
  const karakter = muatKarakter(karakterId);
  premis = String(premis || '').trim();
  let seri = bacaSeri(karakter.id);
  if (premis.length < 10) premis = String(seri.premis || '').trim();
  if (premis.length < 10) {   // premis kosong → AI membuat premis + rencana DAY 1-10 otomatis
    const p = await buatPremisRencanaAI({ karakterId, latar, onProgress });
    premis = p.premis; if (rencanaTeks !== undefined && !String(rencanaTeks).trim()) rencanaTeks = p.rencana;
    if (!fs.existsSync(dirOf(karakter.id))) rencanaTeks = p.rencana;
    seri = bacaSeri(karakter.id);
  }
  const h = Number(hari) || hariBerikut(karakter.id);
  const patch = { premis };
  if (latar !== undefined) patch.latar = latar || ''; if (suasana !== undefined) patch.suasana = suasana || '';
  simpanSeri(karakter.id, patch);
  const dunia = latar !== undefined ? latar : (seri.latar || ''), waktu = suasana !== undefined ? suasana : (seri.suasana || '');
  const sebelumnya = (seri.episodes || []).filter((e) => e.hari < h);
  // rencana alur: bila DAY ini belum ada di rencana → AI menyambung rencana 10 hari ke depan (otomatis seterusnya)
  let rencana = parseRencana(rencanaTeks !== undefined ? rencanaTeks : seri.rencana);
  if (rencanaTeks !== undefined) simpanSeri(karakter.id, { rencana: formatRencana(rencana) });
  if (!rencana.some((x) => x.hari === h)) {
    try {
      const rr = await buatRencana({ apiKey: kunciGemini(), premis, karakter, dunia: DUNIA[dunia] ? dunia : '', dari: h, jumlah: 10, sebelumnya, onProgress });
      rencana = rencana.concat(rr.rencana.filter((x) => !rencana.some((y) => y.hari === x.hari)));   // hari yang sudah diedit pelanggan tidak ditimpa
      simpanSeri(karakter.id, { rencana: formatRencana(rencana) });
    } catch (e) { onProgress(`Rencana alur gagal dibuat (${e.message.slice(0, 80)}), naskah tetap ditulis dari premis`); }
  }
  const alur = rencana.find((x) => x.hari === h)?.ide || '', alurBesok = rencana.find((x) => x.hari === h + 1)?.ide || '';
  const r = await tulisNaskah({ apiKey: kunciGemini(), premis, karakter, hari: h, sebelumnya, judulSeri: seri.judul || '', dunia: DUNIA[dunia] ? dunia : '', waktu: WAKTU[waktu] ? waktu : '', alur, alurBesok, onProgress });
  if (!seri.judul) simpanSeri(karakter.id, { judul: r.naskah.seri.judul });
  return { ...r, premis, rencana: formatRencana(rencana) };
}

/** Premis (bila kosong) + rencana DAY 1..N otomatis untuk karakter ini */
async function buatPremisRencanaAI({ karakterId, premis = '', latar = '', suasana = '', jumlah = 10, onProgress = () => {} }) {
  const karakter = muatKarakter(karakterId);
  const seri = bacaSeri(karakter.id);
  const dari = 1;
  const r = await buatRencana({ apiKey: kunciGemini(), premis, karakter, dunia: DUNIA[latar] ? latar : '', waktu: WAKTU[suasana] ? suasana : '', dari, jumlah, sebelumnya: [], onProgress });
  const patch = { premis: r.premis, rencana: formatRencana(r.rencana), latar: latar || '', suasana: suasana || '' };
  if (r.judul && !(seri.episodes || []).length) patch.judul = r.judul;
  if (fs.existsSync(dirOf(karakter.id))) simpanSeri(karakter.id, patch);
  return { premis: r.premis, judul: r.judul, rencana: patch.rencana, model: r.model };
}

/** gambar referensi → analisis Gemini → simpan karakter → render potret 3D */
async function buatKarakterDariGambar({ imagePath, nama, id }) {
  const k = await analisisKarakter({ apiKey: kunciGemini(), imagePath, nama });
  const saved = simpanKarakter({ ...k, id, sumber: path.resolve(imagePath) }, imagePath);
  const potret = await renderPotret(saved.id).catch(() => '');
  return { ...saved, potret };
}

/** potret karakter (tanpa UI, shot badan) → storage/serial3d/karakter/<id>/potret.jpg */
async function renderPotret(id) {
  const karakter = muatKarakter(id);
  const dir = path.join(dirOf(karakter.id), 'potret_tmp'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const naskah = validateNaskah({ seri: { judul: 'POTRET', hari: 1, karakter: karakter.id, tanpaUI: true }, kalimat: [
    { id: 'a', text: 'Halo semuanya, kenalin ini gue.', shot: 'badan', gerak: 'diam', ekspresi: 'senang', gestur: 'lambai' },
    { id: 'b', text: 'Sampai jumpa besok.', shot: 'penutup', ekspresi: 'senang', gestur: 'diam' }] }).naskah;
  fs.writeFileSync(path.join(dir, 'naskah.json'), JSON.stringify(naskah)); fs.writeFileSync(path.join(dir, 'karakter.json'), JSON.stringify(karakter)); fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(buatTimelineTiruan(naskah)));
  const r = await renderStills({ projectDir: dir, outDir: dir, times: [1.9] });
  const out = path.join(dirOf(karakter.id), 'potret.jpg');
  // karakter berdiri di kiri layar → potong 3:4 di sekitar badan (ukuran kartu kecil)
  const { spawnSync } = require('child_process');
  const c = spawnSync(getFfmpegPath(), ['-v', 'error', '-y', '-i', r.files[0], '-vf', 'crop=720:960:0:780,scale=360:480', '-q:v', '3', out], { windowsHide: true });
  if (c.status !== 0) fs.copyFileSync(r.files[0], out);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

/**
 * @param {object} options
 *  serialScript: objek/string JSON naskah, atau serialScriptId: kunci naskah contoh ('pulau_day1')
 *  serialCharacter: id preset ('rere') atau objek parameter karakter; serialVoice: nama suara Gemini (opsional)
 *  serialTimeline: 'tiruan' → lewati TTS (video bisu, untuk uji cepat)
 *  onProgress(status, percent), isCancelled()
 */
async function runSerial3DPipeline(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const timestamp = Date.now();
  const projectDir = path.join(BAHAN_VIDEO_DIR, `proyek_serial3d_${timestamp}`);
  const ac = new AbortController();
  const cancelWatch = setInterval(() => { try { if (options.isCancelled?.()) ac.abort(); } catch (e) {} }, 500);
  try {
    const ffmpeg = getFfmpegPath();
    if (!ffmpeg) throw new Error('ffmpeg tidak ditemukan.');
    let naskahInput = options.serialScript || CONTOH[options.serialScriptId] || null;
    // Tanpa naskah jadi → Gemini menulis naskah episode berikutnya dari premis (mode loop: tiap putaran = DAY berikutnya)
    if (!naskahInput) {
      onProgress('Tahap 1: Gemini menulis naskah dari premis serial...', 2);
      const r = await buatNaskahAI({ karakterId: options.serialCharacter, premis: options.serialPremise, rencana: options.serialPlan, latar: options.serialWorld, suasana: options.serialTime, onProgress: (m) => onProgress(m, 3) });
      naskahInput = r.naskah;
      onProgress(`Naskah AI siap (model ${r.model}) ✓`, 4);
    }
    naskahInput = terapkanLatar(naskahInput, options.serialWorld, options.serialTime);
    const { naskah, karakter } = siapkanProyek({ naskahInput, karakterInput: options.serialCharacter, voiceName: options.serialVoice });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'naskah.json'), JSON.stringify(naskah, null, 2));
    fs.writeFileSync(path.join(projectDir, 'karakter.json'), JSON.stringify(karakter, null, 2));
    const judul = `${naskah.seri.judul} — ${naskah.seri.label} ${naskah.seri.hari}`;
    onProgress(`Tahap 1: Naskah "${judul}" valid (${naskah.kalimat.length} kalimat) · karakter ${karakter.nama} ✓`, 5);

    let voiceWav = null;
    if (options.serialTimeline === 'tiruan') {
      fs.writeFileSync(path.join(projectDir, 'timeline.json'), JSON.stringify(buatTimelineTiruan(naskah), null, 1));
      onProgress('Tahap 2: TTS dilewati (timeline tiruan, video tanpa suara karakter)', 40);
    } else {
      onProgress(`Tahap 2: Gemini TTS (gratis) membuat suara ${karakter.nama} (${karakter.suara.nama}) — ${naskah.kalimat.length} kalimat...`, 8);
      const r = await buatSuaraSerial({
        naskah, karakter, apiKey: kunciGemini(), outDir: projectDir, ffmpeg, signal: ac.signal,
        cacheDir: path.join(BAHAN_VIDEO_DIR, 'cache_suara_serial3d'),
        onProgress: (i, n, teks) => onProgress(`Suara ${i}/${n}: "${teks.slice(0, 48)}${teks.length > 48 ? '…' : ''}"`, 8 + Math.round((i / n) * 34)),
        onLimit: (sec, status, model) => onProgress(`Kena batas gratis Gemini TTS (${model}), menunggu ${sec} dtk lalu coba lagi...`, 20),
        onModel: (m) => onProgress(`Model Gemini TTS: ${m}`, 10),
      });
      voiceWav = r.voiceWav;
      onProgress(`Suara selesai (${r.timeline.duration.toFixed(1)} dtk, model ${r.model}${r.dariCache ? `, ${r.dariCache} kalimat dari cache` : ''}) ✓`, 44);
    }

    onProgress('Tahap 3: Membuka engine 3D di Chrome (GPU)...', 46);
    const outputPath = path.join(OUTPUT_VIDEOS_DIR, `video_serial3d_${timestamp}.mp4`);
    const res = await renderSerial({
      projectDir, outPath: outputPath, ffmpeg, signal: ac.signal,
      buildAudio: (info) => {
        onProgress('Tahap 4: Menyintesis musik, ombak & efek suara...', 48);
        const bed = buatBed({ duration: info.duration, events: info.sfx, diam: info.musik?.diam || [], outWav: path.join(projectDir, 'bed.wav'), seed: 1234 + naskah.seri.hari });
        if (!voiceWav) return bed;
        return campurAudio({ ffmpeg, voiceWav, bedWav: bed, outWav: path.join(projectDir, 'audio.wav'), duration: info.duration });
      },
      onProgress: (msg, frac) => onProgress(frac == null ? msg : (frac ? `Tahap 5: ${msg}` : msg), frac == null ? 50 : 50 + Math.round(frac * 48)),
    });
    try { catatEpisode(karakter.id, naskah, outputPath); } catch (e) {}   // riwayat seri → DAY berikutnya melanjutkan cerita
    onProgress(`🎉 Sukses! "${judul}" selesai (${res.duration.toFixed(1)} dtk, encoder ${res.encoder}, ${Math.round(res.seconds)} dtk render).`, 100);
    return {
      success: true, concept: 'serial3d', judul, projectFolder: projectDir,
      videoPath: outputPath, storagePath: outputPath, fileName: path.basename(outputPath), promptText: judul,
      encoder: res.encoder, gpu: res.gpu, renderSeconds: res.seconds
    };
  } catch (err) {
    if (ac.signal.aborted || options.isCancelled?.()) return { success: false, cancelled: true, error: 'Dibatalkan pengguna' };
    return { success: false, error: pesanIndonesia(err.message) };
  } finally { clearInterval(cancelWatch); }
}

/** pratinjau cepat: beberapa frame JPEG dengan timeline tiruan (tanpa TTS) */
async function previewSerial3D({ serialScript, serialScriptId, serialCharacter, serialWorld, serialTime, times, outDir, onProgress } = {}) {
  const naskahInput = terapkanLatar(serialScript || CONTOH[serialScriptId] || CONTOH.pulau_day1, serialWorld, serialTime);
  const { naskah, karakter } = siapkanProyek({ naskahInput, karakterInput: serialCharacter });
  const dir = outDir || path.join(BAHAN_VIDEO_DIR, `pratinjau_serial3d_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const tl = buatTimelineTiruan(naskah);
  fs.writeFileSync(path.join(dir, 'naskah.json'), JSON.stringify(naskah)); fs.writeFileSync(path.join(dir, 'karakter.json'), JSON.stringify(karakter)); fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl));
  const ts = times && times.length ? times : tl.lines.map((l) => +(l.t + 0.6).toFixed(2));
  return renderStills({ projectDir: dir, outDir: dir, times: ts, onProgress });
}

async function testSerialVoice({ serialCharacter, serialVoice, text } = {}) {
  const karakter = muatKarakter(serialCharacter || 'rere'); if (serialVoice) karakter.suara.nama = serialVoice;
  const r = await tesSuaraSerial({ apiKey: kunciGemini(), karakter, text: text || 'Kenalin, ini suara gue. Lo komen, gue bangun.', ffmpeg: getFfmpegPath(), tmpDir: path.join(BAHAN_VIDEO_DIR, 'tmp_suara') }).catch((e) => { throw new Error(pesanIndonesia(e.message)); });
  return { success: true, ...r };
}

function pesanIndonesia(msg = '') {
  const m = String(msg);
  if (/KUOTA_HARIAN_HABIS/.test(m)) return 'Kuota harian GRATIS Gemini TTS sudah habis (10 suara/hari per model, dipakai bersama). Solusi: isi Key Gemini pribadi Anda (gratis dari aistudio.google.com/apikey) di langkah 4, lalu klik Render lagi. Atau coba lagi besok.';
  if (/rate limit|RESOURCE_EXHAUSTED|quota|kena batas/i.test(m)) return 'Kena batas gratis Gemini TTS (kuota per menit/hari habis). Tunggu beberapa menit lalu coba lagi.';
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(m)) return 'Koneksi internet terputus saat menghubungi Gemini. Periksa internet lalu coba lagi.';
  return m;
}

module.exports = { runSerial3DPipeline, previewSerial3D, testSerialVoice, buatTimelineTiruan, validateNaskah, CONTOH, KARAKTER, buatNaskahAI, buatPremisRencanaAI, buatKarakterDariGambar, renderPotret };
