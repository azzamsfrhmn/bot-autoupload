/**
 * src/services/remotionRenderer.js
 * Konsep Remotion: render template React (folder remotion/, dibundel ke remotion-bundle/ saat build) jadi MP4 1080x1920.
 * - Memakai Chrome yang terpasang di PC (tanpa unduh Chrome Headless Shell)
 * - Foto/video sumber disalin ke folder jobs/ di bundle kerja (userData) lalu dipanggil lewat staticFile()
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Folder data runtime (versi terinstal: userData, lihat process.chdir di main.js)
const DATA_ROOT = process.cwd();
const APP_ROOT = path.resolve(__dirname, '../../');
// Salinan kerja bundle (cache, dibuat ulang otomatis dari remotion-bundle/). Ditaruh di temp/
// supaya tidak muncul sebagai "kembaran" remotion-bundle di root proyek.
const WORK_BUNDLE_DIR = path.join(DATA_ROOT, 'temp', 'remotion_work');
const VIDEOS_DIR = path.join(DATA_ROOT, 'storage/videos');
let activeRenderCancel = null;

// Di dalam asar, berkas yang perlu dibaca/dijalankan langsung ada di app.asar.unpacked
function unpackedPath(p) {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function getSourceBundleDir() {
  return unpackedPath(path.join(APP_ROOT, 'remotion-bundle'));
}

function getBinariesDirectory() {
  try {
    return unpackedPath(path.dirname(require.resolve('@remotion/compositor-win32-x64-msvc/package.json')));
  } catch (e) {
    return null;
  }
}

function getChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Salin bundle ke userData sekali per versi (folder jobs/ di dalamnya dipakai untuk aset tiap render)
function ensureWorkBundle() {
  const src = getSourceBundleDir();
  if (!fs.existsSync(path.join(src, 'index.html'))) {
    throw new Error('Template Remotion belum dibundel (folder remotion-bundle tidak ditemukan).');
  }
  const stamp = String(fs.statSync(path.join(src, 'index.html')).mtimeMs);
  const stampFile = path.join(WORK_BUNDLE_DIR, '.source-stamp');
  const current = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
  if (current !== stamp) {
    fs.rmSync(WORK_BUNDLE_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(WORK_BUNDLE_DIR), { recursive: true });
    fs.cpSync(src, WORK_BUNDLE_DIR, { recursive: true, filter: (p) => !p.endsWith('.map') || path.basename(p) === 'bundle.js.map' });
    fs.writeFileSync(stampFile, stamp);
  }
  return WORK_BUNDLE_DIR;
}

function readVideoDurationSec(filePath) {
  const bin = getBinariesDirectory();
  const ffprobe = bin ? path.join(bin, 'ffprobe.exe') : null;
  if (!ffprobe || !fs.existsSync(ffprobe)) return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], { timeout: 20000 }, (err, stdout) => {
      resolve(err ? 0 : parseFloat(String(stdout).trim()) || 0);
    });
  });
}

/**
 * @param {object} opts
 *  mode: 'photo' | 'video'
 *  imagePaths: string[] (mode foto, 1–6 foto)
 *  videoPath: string (mode video)
 *  hook, points[], price, cta, durationSec
 */
async function renderRemotionVideo(opts = {}, onProgress = () => {}) {
  const { selectComposition, renderMedia, makeCancelSignal } = require('@remotion/renderer');
  const { cancelSignal, cancel } = makeCancelSignal();
  activeRenderCancel = cancel; // tombol Batalkan menghentikan render ini
  const mode = opts.mode === 'video' ? 'video' : 'photo';
  const chrome = getChromePath();
  if (!chrome) throw new Error('Google Chrome tidak ditemukan. Remotion butuh Chrome untuk merender video.');

  onProgress('Menyiapkan template Remotion...');
  const serveUrl = ensureWorkBundle();

  // Aset tiap render (dibersihkan setelah selesai). Browser mengambil staticFile dari root bundle,
  // sedangkan compositor (OffthreadVideo) mengambilnya lewat /public → taruh di kedua folder.
  const jobId = `job_${Date.now()}`;
  const jobDirs = [path.join(serveUrl, 'jobs', jobId), path.join(serveUrl, 'public', 'jobs', jobId)];
  jobDirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const stage = (file, name) => {
    fs.copyFileSync(file, path.join(jobDirs[0], name));
    try { fs.linkSync(path.join(jobDirs[0], name), path.join(jobDirs[1], name)); } catch (e) { fs.copyFileSync(file, path.join(jobDirs[1], name)); }
    return `jobs/${jobId}/${name}`;
  };

  const inputProps = {
    hook: String(opts.hook || '').trim(),
    points: (opts.points || []).map((p) => String(p || '').trim()).filter(Boolean).slice(0, 3),
    price: String(opts.price || '').trim(),
    cta: String(opts.cta || '').trim() || 'Cek keranjang kuning',
    accent: '#35b29f',
    durationSec: Number(opts.durationSec) || 15,
    images: [],
    videoSrc: '',
    videoDurationSec: 0
  };

  try {
    if (mode === 'photo') {
      const photos = [];
      for (const [i, p] of (opts.imagePaths || []).slice(0, 6).entries()) {
        if (/^https?:/i.test(p)) {
          // Foto etalase yang masih berupa URL: unduh dulu ke folder job
          try {
            const res = await fetch(p, { signal: AbortSignal.timeout(20000) });
            if (!res.ok) continue;
            const ext = /png/i.test(res.headers.get('content-type') || '') ? '.png' : '.jpg';
            // Simpan ke file sementara lalu taruh di kedua folder job (root & public) seperti foto lokal
            const tmpFile = path.join(os.tmpdir(), `remotion_${jobId}_foto_${i}${ext}`);
            fs.writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
            photos.push(stage(tmpFile, `foto_${i}${ext}`));
            fs.rmSync(tmpFile, { force: true });
          } catch (e) {}
        } else if (p && fs.existsSync(p)) {
          photos.push(stage(p, `foto_${i}${path.extname(p) || '.png'}`));
        }
      }
      if (!photos.length) throw new Error('Pilih minimal 1 foto produk.');
      inputProps.images = photos;
    } else {
      if (!opts.videoPath || !fs.existsSync(opts.videoPath)) throw new Error('Pilih video yang akan diberi teks.');
      inputProps.videoDurationSec = await readVideoDurationSec(opts.videoPath);
      inputProps.videoSrc = stage(opts.videoPath, `video${path.extname(opts.videoPath) || '.mp4'}`);
    }

    const common = {
      serveUrl,
      inputProps,
      browserExecutable: chrome,
      chromeMode: 'chrome-for-testing',
      binariesDirectory: getBinariesDirectory(),
      logLevel: process.env.REMOTION_LOG || 'error',
      timeoutInMilliseconds: 60000
    };

    const composition = await selectComposition({ ...common, id: mode === 'video' ? 'VideoOverlay' : 'ProductPromo' });

    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    const outputLocation = path.join(VIDEOS_DIR, `video_remotion_${mode === 'video' ? 'video' : 'foto'}_${Date.now()}.mp4`);

    let lastPct = -1;
    await renderMedia({
      cancelSignal,
      ...common,
      composition,
      codec: 'h264',
      crf: 18,
      // Warna standar video (BT.709, rentang TV) — default Remotion "full range" sering diproses jelek oleh TikTok
      colorSpace: 'bt709',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      outputLocation,
      concurrency: Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          onProgress(`Merender video Remotion... ${pct}%`);
        }
      }
    });

    onProgress('Video Remotion selesai.');
    return { success: true, videoPath: outputLocation, fileName: path.basename(outputLocation) };
  } finally {
    activeRenderCancel = null;
    jobDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
}

/**
 * Konsep 3D Edukasi: gabungkan klip 3D Flow + narasi TTS + teks per kata jadi satu MP4 1080x1920.
 * @param {object} opts
 *  segments: [{ clipPath, audioPath?, durSec, captions:[{text,startSec,endSec}] }]
 *  audioPath: satu berkas narasi untuk seluruh video (dipakai konsep 3D Edukasi)
 *  label: teks kecil di atas video
 *  outputPath: lokasi MP4 hasil
 */
async function renderEdu3DVideo(opts = {}, onProgress = () => {}) {
  const { selectComposition, renderMedia, makeCancelSignal } = require('@remotion/renderer');
  const { cancelSignal, cancel } = makeCancelSignal();
  activeRenderCancel = cancel; // tombol Batalkan menghentikan render ini
  const chrome = getChromePath();
  if (!chrome) throw new Error('Google Chrome tidak ditemukan. Remotion butuh Chrome untuk merender video.');

  onProgress('Menyiapkan template video 3D Edukasi...');
  const serveUrl = ensureWorkBundle();
  const jobId = `job_${Date.now()}`;
  const jobDirs = [path.join(serveUrl, 'jobs', jobId), path.join(serveUrl, 'public', 'jobs', jobId)];
  jobDirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const stage = (file, name) => {
    fs.copyFileSync(file, path.join(jobDirs[0], name));
    try { fs.linkSync(path.join(jobDirs[0], name), path.join(jobDirs[1], name)); } catch (e) { fs.copyFileSync(file, path.join(jobDirs[1], name)); }
    return `jobs/${jobId}/${name}`;
  };

  try {
    const segments = [];
    for (const [i, s] of (opts.segments || []).entries()) {
      if (!s.clipPath || !fs.existsSync(s.clipPath)) throw new Error(`Klip 3D adegan ${i + 1} tidak ditemukan.`);
      segments.push({
        clipSrc: stage(s.clipPath, `klip_${i}.mp4`),
        clipDurSec: await readVideoDurationSec(s.clipPath),
        clipAudio: Boolean(s.clipAudio), // true = narasi ada di dalam klip (suara Veo) → klip tidak dibisukan
        audioSrc: s.audioPath && fs.existsSync(s.audioPath) ? stage(s.audioPath, `narasi_${i}${path.extname(s.audioPath) || '.mp3'}`) : '',
        durSec: Number(s.durSec) || 8,
        captions: s.captions || []
      });
    }
    if (!segments.length) throw new Error('Tidak ada adegan untuk dirender.');
    // Satu trek narasi untuk seluruh video (opsional; tanpa ini dipakai audio per adegan)
    const audioSrc = opts.audioPath && fs.existsSync(opts.audioPath) ? stage(opts.audioPath, `narasi${path.extname(opts.audioPath) || '.mp3'}`) : '';

    const common = {
      serveUrl,
      inputProps: { segments, audioSrc, label: String(opts.label || '').trim() },
      browserExecutable: chrome,
      chromeMode: 'chrome-for-testing',
      binariesDirectory: getBinariesDirectory(),
      logLevel: process.env.REMOTION_LOG || 'error',
      timeoutInMilliseconds: 60000
    };
    const composition = await selectComposition({ ...common, id: 'Edu3D' });

    const outputLocation = opts.outputPath || path.join(VIDEOS_DIR, `video_edu3d_${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

    let lastPct = -1;
    await renderMedia({
      cancelSignal,
      ...common,
      composition,
      codec: 'h264',
      crf: 18,
      // Warna standar video (BT.709, rentang TV) — default Remotion "full range" sering diproses jelek oleh TikTok
      colorSpace: 'bt709',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      outputLocation,
      concurrency: Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          onProgress(`Menggabungkan klip 3D + narasi... ${pct}%`);
        }
      }
    });
    return { success: true, videoPath: outputLocation, fileName: path.basename(outputLocation) };
  } finally {
    activeRenderCancel = null;
    jobDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
}

/**
 * Konsep 3D Kartun (Dodo & Bongo): animasi canvas lokal + suara per adegan + musik jadi satu MP4 1080x1920.
 * @param {object} opts
 *  spec, timing: hasil pipeline kartun3d
 *  assetDir: folder lokal berisi NN_B.mp3 / NN_D.mp3 / musik.wav
 *  outputPath: lokasi MP4 hasil
 */
async function renderKartun3DVideo(opts = {}, onProgress = () => {}) {
  const { selectComposition, renderMedia, makeCancelSignal } = require('@remotion/renderer');
  const { cancelSignal, cancel } = makeCancelSignal();
  activeRenderCancel = cancel;
  const chrome = getChromePath();
  if (!chrome) throw new Error('Google Chrome tidak ditemukan. Remotion butuh Chrome untuk merender video.');

  onProgress('Menyiapkan template video 3D...');
  const serveUrl = ensureWorkBundle();
  const jobId = `job_${Date.now()}`;
  const jobDirs = [path.join(serveUrl, 'jobs', jobId), path.join(serveUrl, 'public', 'jobs', jobId)];
  jobDirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));

  try {
    const files = fs.readdirSync(opts.assetDir).filter((f) => /\.(mp3|wav)$/i.test(f));
    for (const f of files) {
      for (const d of jobDirs) fs.copyFileSync(path.join(opts.assetDir, f), path.join(d, f));
    }
    const common = {
      serveUrl,
      inputProps: { spec: opts.spec, timing: opts.timing, assetDir: `jobs/${jobId}` },
      browserExecutable: chrome,
      chromeMode: 'chrome-for-testing',
      binariesDirectory: getBinariesDirectory(),
      logLevel: process.env.REMOTION_LOG || 'error',
      timeoutInMilliseconds: 90000
    };
    const composition = await selectComposition({ ...common, id: 'Kartun3D' });
    const outputLocation = opts.outputPath || path.join(VIDEOS_DIR, `video_kartun3d_${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

    let lastPct = -1;
    await renderMedia({
      cancelSignal,
      ...common,
      composition,
      codec: 'h264',
      crf: 18,
      colorSpace: 'bt709',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      outputLocation,
      concurrency: Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          onProgress(`Merender animasi 3D Kartun... ${pct}%`);
        }
      }
    });
    return { success: true, videoPath: outputLocation, fileName: path.basename(outputLocation) };
  } finally {
    activeRenderCancel = null;
    jobDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
}

// Hentikan render Remotion yang sedang berjalan (konsep Remotion & tahap gabung 3D Edukasi)
function cancelActiveRender() {
  if (!activeRenderCancel) return false;
  try { activeRenderCancel(); } catch (e) {}
  return true;
}

module.exports = { renderRemotionVideo, renderEdu3DVideo, renderKartun3DVideo, readVideoDurationSec, cancelActiveRender };
