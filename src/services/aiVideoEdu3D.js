/**
 * src/services/aiVideoEdu3D.js
 * Konsep 3D Edukasi ("tahu gak sih"), video penjelasan bergaya animasi 3D ±24 detik:
 *   1. Gemini menulis naskah 3 adegan (topik diketik / dipilih AI)
 *   2. Google Flow membuat 3 klip animasi 3D; NARASI diucapkan langsung oleh Veo di tiap klip (suara manusia natural),
 *      dengan deskripsi suara narator yang sama di ketiga klip agar konsisten
 *   3. Remotion menggabungkan klip (suara asli klip) + teks 2–4 kata yang mengikuti rentang suara terdeteksi
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { generateEdu3DScript, suggestEdu3DTopic } = require('./aiCaption');
const { runFlowProjectCreationTiktokPov } = require('./flowVideoRunnerTiktokPov');
const { renderEdu3DVideo, readVideoDurationSec } = require('./remotionRenderer');
const { getFfmpegPath, enhanceVideoForTikTok } = require('../core/videoEnhancer');

const ROOT_DIR = process.cwd();
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const SESSIONS_VIDEOS_DIR = path.resolve(ROOT_DIR, 'sessions/generated_videos');
// Karakter ciri khas (gambar upload pengguna) — satu untuk semua video 3D Edukasi
const CHARACTER_DIR = path.resolve(ROOT_DIR, 'storage/edu3d');

function getCharacterPath() {
  try {
    const f = fs.readdirSync(CHARACTER_DIR).find((n) => /^karakter\.(png|jpe?g|webp)$/i.test(n));
    return f ? path.join(CHARACTER_DIR, f) : null;
  } catch (e) {
    return null;
  }
}

// Deskripsi suara narator untuk Veo — satu suara tetap, kalimat SAMA di semua klip agar suara akun konsisten
const VOICES = {
  'cowok-santai': { label: 'Cowok · santai', desc: 'a warm, relaxed young Indonesian man in his late 20s, natural casual conversational tone like a friendly TikTok explainer, medium pitch, unhurried pace' },
};

// Gaya visual + narasi yang sama di semua klip agar terlihat & terdengar satu video utuh
function buildClipPrompt(world, scene, voiceDesc, withCharacter = false) {
  return [
    'Stylized 3D animation, clean miniature diorama style like a Blender render, soft natural daylight, gentle pastel colors,',
    'with a cutaway cross-section view of the ground or object when it helps explain how it works.',
    world ? `World: ${world}.` : '',
    // Gambar karakter ditempel sebagai referensi (Bahan) → wujudnya sama di semua klip
    withCharacter
      ? 'The host character is EXACTLY the 3D character from the reference image (same face, hairstyle, outfit and colors), rendered in the same stylized 3D look; he acts out the explanation with natural body language, mouth closed (the narration is an off-screen voice-over, not lip-synced).'
      : '',
    `Scene: ${scene.visual}`,
    'Smooth slow cinematic camera movement, tall vertical portrait framing, main subject centered.',
    `Voice-over (off-screen narrator, ${voiceDesc}), speaking casual Indonesian slang (bahasa gaul Jakarta) like a real TikTok creator talking to friends, natural human intonation, clearly audible.`,
    `Fast-paced, tight delivery: the narrator starts speaking at the very first second and keeps talking continuously until the last second of the clip, flowing from one sentence to the next with no pauses or silence in between, saying exactly: "${scene.narration}"`,
    'Audio: ONLY the narrator voice. No music, no sound effects, no other voices.',
    'Absolutely no text, letters, numbers, aspect-ratio labels, captions, subtitles, logos or watermark anywhere on screen.'
  ].filter(Boolean).join(' ');
}

/**
 * Rentang suara narator di klip (detik) dari ffmpeg silencedetect: { start, end }.
 * Gagal / tidak terdeteksi → seluruh durasi klip.
 */
function detectSpeechSpan(clipPath, durationSec) {
  const ffmpeg = getFfmpegPath();
  const full = { start: 0.2, end: Math.max(1, durationSec - 0.2) };
  if (!ffmpeg) return Promise.resolve(full);
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-i', clipPath, '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-'],
      { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
        const out = String(stderr || '');
        const starts = [...out.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
        const ends = [...out.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
        let start = 0;
        let end = durationSec;
        // Hening di awal → suara mulai setelahnya; hening yang berlanjut sampai akhir → suara berhenti di awal hening itu
        if (starts.length && starts[0] < 0.15 && ends.length) start = ends[0];
        const lastStart = starts[starts.length - 1];
        if (starts.length > ends.length || (lastStart !== undefined && (ends[ends.length - 1] || 0) >= durationSec - 0.1 && lastStart > start)) end = lastStart;
        if (!(end - start > 1)) return resolve(full);
        resolve({ start: Math.max(0, start), end: Math.min(durationSec, end) });
      });
  });
}

/**
 * Pecah narasi jadi potongan 2–4 kata (berhenti di tanda baca) dan bagi waktunya sebanding panjang teks
 * di sepanjang rentang suara yang terdeteksi.
 */
function captionsForSpan(text, span) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.join(' ').length;
    if (cur.length >= 4 || (cur.length >= 2 && /[,.!?;:]$/.test(w)) || (cur.length >= 3 && len >= 18)) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length) {
    if (cur.length === 1 && chunks.length) chunks[chunks.length - 1] += ` ${cur[0]}`;
    else chunks.push(cur.join(' '));
  }
  const weight = (c) => c.length + 3;
  const total = chunks.reduce((sum, c) => sum + weight(c), 0) || 1;
  const usable = Math.max(0.5, span.end - span.start);
  let t = span.start;
  return chunks.map((c) => {
    const d = (usable * weight(c)) / total;
    const item = { text: c.replace(/[,.;:]+$/, ''), startSec: +t.toFixed(3), endSec: +(t + d).toFixed(3) };
    t += d;
    return item;
  });
}

// Topik dari proyek 3D Edukasi sebelumnya (maks 40 terbaru) agar topik otomatis AI tidak berulang
function recentEdu3DTopics(limit = 40) {
  try {
    return fs.readdirSync(BAHAN_VIDEO_DIR)
      .filter((d) => /^proyek_edu3d_\d+$/.test(d))
      .sort()
      .reverse()
      .map((d) => {
        try { return JSON.parse(fs.readFileSync(path.join(BAHAN_VIDEO_DIR, d, 'naskah.json'), 'utf8')).topic || ''; } catch (e) { return ''; }
      })
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, limit);
  } catch (e) {
    return [];
  }
}

async function runEdu3DPipeline(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const workerId = Number(options.workerId) || 1;
  // Suara narator DIKUNCI satu gaya (cowok santai) agar suara akun selalu sama di semua video
  const voice = VOICES['cowok-santai'];
  const sceneCount = Math.min(6, Math.max(3, Number(options.eduSceneCount) || 3));
  const step = 72 / sceneCount; // progres 12% → 84% dibagi rata per klip
  const flowDuration = options.flowDuration || '8 Detik';
  const sceneSeconds = parseInt(String(flowDuration), 10) || 8;

  const timestamp = Date.now();
  const projectDir = path.join(BAHAN_VIDEO_DIR, `proyek_edu3d_${timestamp}`);
  fs.mkdirSync(projectDir, { recursive: true });

  try {
    // 1. Naskah
    const topic = String(options.eduTopic || '').trim();
    // Karakter ciri khas: dipakai bila sudah diupload di form (tanpa karakter → klip tanpa tokoh tetap)
    const characterPath = getCharacterPath();
    if (characterPath) onProgress('Karakter ciri khas dipakai di semua adegan ✓', 4);
    onProgress(`Tahap 1: Gemini menulis naskah 3D Edukasi${topic ? ` tentang "${topic}"` : ' (topik dipilih AI)'}...`, 5);
    const script = await generateEdu3DScript({ topic, sceneSeconds, sceneCount, avoidTopics: topic ? [] : recentEdu3DTopics(), withCharacter: Boolean(characterPath) });
    if (!script.success) throw new Error(script.error);
    fs.writeFileSync(path.join(projectDir, 'naskah.json'), JSON.stringify(script, null, 2));
    onProgress(`Topik: ${script.topic}${script.label ? ` · Label: ${script.label}` : ''}`, 8);
    script.scenes.forEach((s, i) => onProgress(`Narasi ${i + 1}: "${s.narration}"`, 8));

    // 2. Klip 3D + narasi di Google Flow (satu per adegan, akun Flow dirotasi otomatis oleh runner)
    onProgress(`${script.scenes.length} adegan · suara narator tetap (${voice.label}, diucapkan Veo)`, 10);
    // Karakter ciri khas (bila sudah diupload) tampil & dikirim sebagai referensi di SEMUA adegan
    const sceneHasHost = () => Boolean(characterPath);
    const clips = [];
    for (const [i, scene] of script.scenes.entries()) {
      const tag = `[Klip ${i + 1}/${script.scenes.length}]`;
      onProgress(`Tahap 2: ${tag} Membuat animasi 3D + narasi di Google Flow...`, Math.round(12 + i * step));
      const res = await runFlowProjectCreationTiktokPov({
        workerId,
        projectFolder: projectDir,
        // Gambar karakter hanya dikirim ke adegan yang memang menampilkan tokoh (pembuka & penutup); adegan tengah fokus objek
        referenceImagePaths: sceneHasHost(scene) ? [characterPath] : [],
        promptText: buildClipPrompt(script.world, scene, voice.desc, sceneHasHost(scene)),
        flowRatio: options.flowRatio || '9:16',
        flowModel: options.flowModel || 'Veo 3.1 - Lite',
        flowResolution: options.flowResolution || '720p',
        flowDuration,
        flowOutputCount: '1',
        headless: options.headless,
        onProgress: (msg) => onProgress(`${tag} ${msg}`, Math.round(12 + i * step))
      });
      if (!res?.success) throw new Error(`Klip 3D adegan ${i + 1} gagal dibuat: ${res?.error || 'tidak diketahui'}`);

      // Klip mentah dipindah ke folder proyek agar tidak ikut tampil di galeri video
      const source = res.storagePath && fs.existsSync(res.storagePath) ? res.storagePath : res.videoPath;
      const clipPath = path.join(projectDir, `klip_${i + 1}.mp4`);
      fs.copyFileSync(source, clipPath);
      for (const leftover of new Set([res.storagePath, res.videoPath, path.join(SESSIONS_VIDEOS_DIR, path.basename(source))])) {
        if (leftover && fs.existsSync(leftover)) fs.rmSync(leftover, { force: true });
      }
      clips.push(clipPath);
      onProgress(`${tag} Klip 3D selesai ✓`, Math.round(12 + (i + 1) * step));
    }

    // 3. Gabungkan
    const outputPath = path.join(OUTPUT_VIDEOS_DIR, `video_edu3d_${timestamp}.mp4`);
    const rendered = await composeEdu3D({ script, clips, outputPath, onProgress });

    onProgress('🎉 Sukses! Video 3D Edukasi selesai dibuat.', 100);
    return {
      success: true,
      concept: 'edu3d',
      projectFolder: projectDir,
      topic: script.topic,
      videoPath: rendered.videoPath,
      storagePath: rendered.videoPath,
      fileName: rendered.fileName,
      thumbnailPath: ''
    };
  } catch (err) {
    return { success: false, error: err.message, projectFolder: projectDir };
  }
}

/**
 * Suara narasi Veo: stereo lebar ber-efek ruang (terdengar "melayang" di headset) & pelan (±-24 dB).
 * Diolah jadi mono di tengah + sedikit bass (lebih bulat) + kompresor (rapat) + loudness standar TikTok (-14 LUFS).
 * Gagal → null (suara asli klip dipakai).
 */
function masterNarration(clipPath, outPath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return Promise.resolve(null);
  const filters = [
    'pan=mono|c0=0.5*c0+0.5*c1',
    'highpass=f=80',
    'equalizer=f=180:t=q:w=1:g=3',
    'equalizer=f=3500:t=q:w=1.2:g=2',
    'acompressor=threshold=-22dB:ratio=3:attack=8:release=150:makeup=3',
    'loudnorm=I=-14:TP=-1.5:LRA=7',
    'aresample=48000'
  ].join(',');
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-y', '-i', clipPath, '-vn', '-af', filters, '-ac', '1', '-c:a', 'pcm_s16le', outPath],
      { timeout: 60000, windowsHide: true }, (err) => resolve(!err && fs.existsSync(outPath) ? outPath : null));
  });
}

// Tahap gabung (dipisah agar proyek yang klipnya sudah jadi bisa dirender ulang tanpa Flow)
async function composeEdu3D({ script, clips, outputPath, onProgress = () => {} }) {
  const segments = [];
  for (const [i, s] of script.scenes.entries()) {
    const clipDur = (await readVideoDurationSec(clips[i])) || 8;
    // Klip Flow 720p diperbesar dulu ke 1080x1920 lewat FFmpeg (lanczos + penajaman) seperti konsep lain;
    // kalau dibiarkan, Remotion/Chrome yang memperbesar → hasil lembut & pecah setelah dikompres TikTok
    const hdClip = await enhanceVideoForTikTok(clips[i]).catch(() => clips[i]);
    const mastered = await masterNarration(clips[i], clips[i].replace(/\.mp4$/i, '_narasi.wav'));
    let span = await detectSpeechSpan(clips[i], clipDur);
    // Rentang terlalu pendek untuk jumlah kata (mis. suara latar ikut terdeteksi) → bagi teks ke seluruh klip
    const minSpeechSec = (s.narration.split(/\s+/).length / 3.5) * 0.7;
    if (span.end - span.start < minSpeechSec) span = { start: 0.2, end: Math.max(1, clipDur - 0.3) };
    // Narasi yang sudah diolah diputar terpisah (klip dibisukan); gagal diolah → suara asli klip
    segments.push(mastered
      ? { clipPath: hdClip, audioPath: mastered, durSec: clipDur, captions: captionsForSpan(s.narration, span) }
      : { clipPath: hdClip, clipAudio: true, durSec: clipDur, captions: captionsForSpan(s.narration, span) });
  }
  const total = segments.reduce((sum, s) => sum + s.durSec, 0);
  onProgress(`Tahap 3: Menggabungkan ${segments.length} klip + teks (±${Math.round(total)} detik)...`, 85);
  return renderEdu3DVideo({ segments, label: script.label, outputPath }, (msg) => onProgress(msg, 90));
}

// Riwayat ide topik yang pernah DISARANKAN (bukan hanya yang jadi video) agar saran tidak itu-itu terus
const TOPIC_HISTORY_FILE = path.join(CHARACTER_DIR, 'riwayat_topik.json');
function readTopicHistory() {
  try { return JSON.parse(fs.readFileSync(TOPIC_HISTORY_FILE, 'utf8')).filter(Boolean); } catch (e) { return []; }
}

// Ide topik untuk kolom topik di form (menghindari topik proyek sebelumnya & saran sebelumnya)
async function suggestTopic() {
  const history = readTopicHistory();
  const avoid = [...new Set([...recentEdu3DTopics(), ...history])].slice(0, 80);
  const res = await suggestEdu3DTopic({ avoidTopics: avoid });
  if (res?.success && res.topic) {
    try {
      fs.mkdirSync(CHARACTER_DIR, { recursive: true });
      fs.writeFileSync(TOPIC_HISTORY_FILE, JSON.stringify([res.topic, ...history.filter((t) => t !== res.topic)].slice(0, 60), null, 2));
    } catch (e) {}
  }
  return res;
}

module.exports = { runEdu3DPipeline, composeEdu3D, captionsForSpan, detectSpeechSpan, buildClipPrompt, suggestTopic, getCharacterPath, CHARACTER_DIR, VOICES };
