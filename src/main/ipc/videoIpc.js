/**
 * src/main/ipc/videoIpc.js
 */
const path = require('path');
const fs = require('fs');
const { clipboard, nativeImage, shell } = require('electron');
const perfProfile = require('../../core/perfProfile');
const { enhanceVideoForTikTok } = require('../../core/videoEnhancer');
const { syncProfileClone, workerProfileDir } = require('../../core/profileClone');
const { killChromeMatching } = require('../../core/chromeCleanup');
const galleryOwner = require('../../core/galleryOwner');
const { cancelActiveRender } = require('../../services/remotionRenderer');
const { runEdu3DPipeline } = require('../../services/aiVideoEdu3D');
const { runKartun3DPipeline } = require('../../services/aiVideoKartun3D');

module.exports = function registerVideoIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    DATA_ROOT,
    getActiveAccount,
    runTikTokVideoPipeline,
    runTikTokDasterPipeline, // Diimpor dari ctx untuk eksekusi alur Daster
    runTikTokSensasiPipeline,
    runTikTokPovPipeline,
    runInstagramStoryboardPipeline,
    runFlowProjectCreation,
    runFlowProjectCreationTiktok,
    getFlowAccountsConfig,
    saveFlowAccountsConfig,
    addFlowAccount,
    deleteFlowAccount,
    openFlowLoginWindow,
    silentSyncAccountCredits,
    syncAllFlowAccountCredits,
    generateAndStoreAiImage,
    getGeneratedImagesList,
    openImagesFolder,
    getSavedVideosList,
    openVideoFolder,
    openStoryboardFolder,
    openBahanVideoFolder,
    deleteSavedVideo,
    deleteSavedStoryboard
  } = ctx;

  const RUNTIME_ROOT = DATA_ROOT || PROJECT_ROOT;
  const SESSIONS_DIR = path.resolve(RUNTIME_ROOT, 'sessions');
  const CHATGPT_SHARED_PROFILE = path.resolve(SESSIONS_DIR, 'chatgpt_profile_shared');

  // Helper membaca status Headless Global dari konfigurasi Flow
  function resolveHeadlessSetting(explicitValue) {
    if (typeof explicitValue === 'boolean') return explicitValue;
    try {
      if (typeof getFlowAccountsConfig === 'function') {
        const cfg = getFlowAccountsConfig();
        if (cfg && typeof cfg.headless === 'boolean') return cfg.headless;
      }
      const candidatePaths = [
        path.resolve(RUNTIME_ROOT, 'sessions/flow_profiles/accounts_config.json'),
        path.resolve(process.cwd(), 'sessions/flow_profiles/accounts_config.json'),
        path.resolve(__dirname, '../../../sessions/flow_profiles/accounts_config.json')
      ];
      for (const cfgPath of candidatePaths) {
        if (fs.existsSync(cfgPath)) {
          const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          if (typeof raw.headless === 'boolean') return raw.headless;
        }
      }
    } catch (e) {}
    return false; // Default nonaktif, sama dengan tampilan sakelar di Pengaturan AI
  }

  // Kunci biaya kredit — HARUS sama dengan buildFlowCostKey() di flowVideoRunnerTiktok(Daster).js
  function buildFlowCostKey({ flowModel, flowResolution, flowDuration, flowOutputCount } = {}) {
    const model = String(flowModel || 'Veo 3.1 - Lite').replace(/google/i, '').toLowerCase().replace(/[\s\-–]+/g, ' ').trim();
    const res = String(flowResolution || '').includes('360') ? '360p' : '720p';
    const dur = (String(flowDuration || '').match(/\d+/) || ['8'])[0];
    const out = (String(flowOutputCount || '').match(/\d+/) || ['1'])[0];
    return `${model}|${res}|${dur}|x${out}`;
  }

  function checkFlowCreditAvailable(params = {}) {
    try {
      const cfg = typeof getFlowAccountsConfig === 'function' ? getFlowAccountsConfig() : null;
      const accounts = Array.isArray(cfg?.accounts) ? cfg.accounts : [];

      // Biaya asli dari label Flow (.credit-cost-link) yang tersimpan saat render sebelumnya dengan setelan sama.
      // Jika belum pernah dirender dengan setelan ini, cukup pastikan ada kredit; runner akan memvalidasi biaya aslinya.
      const knownCost = cfg?.creditCostCache?.[buildFlowCostKey(params)];
      const requiredCredit = typeof knownCost === 'number' ? knownCost : 1;
      const getCreditNum = (acc) => {
        const match = String(acc?.credits || '').replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };

      const readyAcc = accounts.find((acc) => acc.status === 'Sesi Aktif' && getCreditNum(acc) >= requiredCredit);
      if (readyAcc) return { ok: true };

      const summary = accounts.map((acc) => `• ${acc.name}: ${acc.status === 'Sesi Aktif' ? acc.credits : 'Belum Login'}`).join('\n');
      return {
        ok: false,
        message: `Tidak bisa membuat video: setelan ini butuh ${requiredCredit} kredit Google Flow${typeof knownCost === 'number' ? '' : ' (minimal)'}.\n\n${summary}\n\nTambah/login akun cadangan di Pengaturan AI atau tunggu kuota direset.`
      };
    } catch (e) {
      return { ok: true }; // Jika config gagal dibaca, biarkan runner melakukan pengecekan sendiri
    }
  }

  // Penanda render berjalan: cek kredit otomatis tidak boleh memakai profil Chrome yang sama bersamaan.
  // Dihitung per worker (bisa 2 render bersamaan).
  let runningVideoPipelines = 0;
  let isVideoPipelineRunning = false;

  /**
   * Profil Chrome per worker. Worker 1 memakai profil asli; worker 2 dst. memakai SALINAN profil yang sama
   * (login ChatGPT & akun Google Flow sama dengan worker 1). Lihat src/core/profileClone.js.
   */
  const FLOW_PROFILES_DIR = path.resolve(SESSIONS_DIR, 'flow_profiles');

  async function syncClone(label, sourceDir, workerId, sendProgress) {
    const res = await syncProfileClone(sourceDir, workerProfileDir(sourceDir, workerId));
    if (res.status === 'synced') sendProgress(`${label} worker ${workerId} disinkronkan dari worker 1 ✓`);
    if (res.status === 'locked') sendProgress(`[Peringatan] ${label} worker ${workerId} belum bisa disinkronkan (${res.error}), memakai salinan sebelumnya.`);
    return res.dir;
  }

  // Akun Flow yang sudah login: akun dirotasi acak tiap render, jadi semuanya bisa terpilih
  function loggedInFlowAccountIds() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(FLOW_PROFILES_DIR, 'accounts_config.json'), 'utf8'));
      return (cfg.accounts || []).filter((a) => a.status === 'Sesi Aktif').map((a) => a.id);
    } catch (e) {
      return [];
    }
  }

  /**
   * Worker 1 jalan duluan, sebelum Chrome profil asli dibuka: saat itulah Cookies asli bisa disalin.
   * Maka worker 1 yang menyiapkan salinan ChatGPT & semua akun Flow untuk worker lain (hanya bila > 1 worker).
   * Salinan akun Flow hanya dipakai bila akun yang layak lebih sedikit dari worker (akun dipakai bersama).
   * Worker 2 yang datang selagi salinan dibuat ikut menunggu salinan yang sama (tidak menyalin dua kali).
   */
  async function prepareWorkerProfiles(workerId, workerCount, sendProgress) {
    if (workerId === 1) {
      const flowIds = workerCount > 1 ? loggedInFlowAccountIds() : [];
      // Salinan ChatGPT wajib selesai sebelum Chrome ChatGPT worker 1 dibuka (Cookies terkunci setelahnya)
      for (let w = 2; w <= workerCount; w++) await syncClone('Login ChatGPT', CHATGPT_SHARED_PROFILE, w, sendProgress);
      // Salinan akun Flow baru dipakai beberapa menit lagi (setelah storyboard) & hanya bila akun dipakai bersama →
      // disalin di latar belakang agar worker 1 tidak tertahan. Runner Flow menunggu salinan yang sama bila perlu.
      (async () => {
        for (let w = 2; w <= workerCount; w++) {
          for (const flowId of flowIds) await syncClone(`Akun Flow ${flowId}`, path.join(FLOW_PROFILES_DIR, flowId), w, sendProgress).catch(() => {});
        }
      })();
      return CHATGPT_SHARED_PROFILE;
    }
    return syncClone('Login ChatGPT', CHATGPT_SHARED_PROFILE, workerId, sendProgress);
  }

  // Catatan: kredit TIDAK lagi dibaca ulang dari Flow setelah setiap render. Itu membuka Chrome Flow untuk
  // semua akun satu per satu (±1 menit) dan proses berikutnya ikut menunggu. Runner Flow sudah memotong kredit
  // lokal dengan biaya asli dari label Flow; kredit asli dibaca ulang sebelum proses bila lewat jam reset
  // harian atau kredit lokal tidak cukup (lihat runGenerateAiVideo).

  // --- GENERATOR & STORAGE GAMBAR AI ---
  ipcMain.handle('generate-ai-image', async (event, params) => {
    try {
      let prompt = '';
      let aspectRatio = '1:1';
      if (typeof params === 'object' && params !== null) {
        prompt = params.prompt || '';
        aspectRatio = params.aspectRatio || '1:1';
      }
      return await generateAndStoreAiImage(prompt, aspectRatio, {
        workerId: 1,
        profileDir: CHATGPT_SHARED_PROFILE,
        sessionsDir: SESSIONS_DIR
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Galeri per akun: hanya gambar milik akun aktif (+ gambar lama tanpa tanda)
  ipcMain.handle('get-saved-ai-images', async () => getGeneratedImagesList().filter((it) => galleryOwner.isVisibleToActive(it.fileName || it.filePath)));
  ipcMain.handle('open-ai-images-folder', async () => openImagesFolder());

  // --- GENERATOR AI VIDEO ---
  // Tombol Batalkan: tandai semua proses video yang berjalan sebagai dibatalkan. Setiap laporan progres
  // (dipanggil terus oleh pipeline & runner Flow) lalu melempar error → proses berhenti di langkah berikutnya.
  // Chrome ChatGPT & Flow milik bot ditutup paksa agar penantian halaman tidak menahan (Chrome upload TikTok aman).
  let videoCancelRequested = false;
  const CANCEL_MESSAGE = 'Dibatalkan pengguna';
  const throwIfCancelled = () => {
    if (videoCancelRequested) throw new Error(CANCEL_MESSAGE);
  };

  ipcMain.handle('cancel-ai-video', async () => {
    const remotionStopped = cancelActiveRender();
    if (!runningVideoPipelines && !remotionStopped) return { success: false, error: 'Tidak ada proses video yang sedang berjalan.' };
    videoCancelRequested = runningVideoPipelines > 0;
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('video-gen-progress', { status: 'Membatalkan proses... menutup Chrome ChatGPT & Flow', percent: 0 });
    await killChromeMatching([
      path.join(SESSIONS_DIR, 'chatgpt_profile'),
      path.join(SESSIONS_DIR, 'flow_profiles')
    ]).catch(() => {});
    return { success: true };
  });

  ipcMain.handle('generate-ai-video', async (event, params) => {
    // Proses baru (tidak ada yang berjalan) → hapus tanda batal dari proses sebelumnya, lalu tutup tuntas sisa Chrome
    // ChatGPT & Flow dari video sebelumnya (setelah sukses hanya proses induk yang ditutup; sisa proses anak bisa
    // mengunci profil → video ke-3 dst. dalam mode loop gagal membuka Chrome). Chrome upload TikTok tidak disentuh.
    // Hitungan dinaikkan SEBELUM menutup Chrome agar worker ke-2 (mulai 2 dtk kemudian) tidak ikut menutup Chrome worker 1
    const isFirstPipeline = !runningVideoPipelines;
    runningVideoPipelines++;
    isVideoPipelineRunning = true;
    perfProfile.setTaskActive('render', true);
    try {
      if (isFirstPipeline) {
        videoCancelRequested = false;
        await killChromeMatching([
          path.join(SESSIONS_DIR, 'chatgpt_profile'),
          path.join(SESSIONS_DIR, 'flow_profiles')
        ]).catch(() => {});
      }
      const result = await runGenerateAiVideo(event, params);
      if (videoCancelRequested) return { success: false, cancelled: true, error: CANCEL_MESSAGE };
      return result;
    } catch (err) {
      if (videoCancelRequested) return { success: false, cancelled: true, error: CANCEL_MESSAGE };
      throw err;
    } finally {
      runningVideoPipelines = Math.max(0, runningVideoPipelines - 1);
      isVideoPipelineRunning = runningVideoPipelines > 0;
      if (!isVideoPipelineRunning) perfProfile.setTaskActive('render', false);
    }
  });

  async function runGenerateAiVideo(event, params) {
    const activeAcc = getActiveAccount();
    const isTikTok =
      activeAcc?.platform === 'tiktok' ||
      params?.platform === 'tiktok' ||
      Boolean(params?.referenceImagePath) ||
      Boolean(params?.customCharacterPath) ||
      params?.bannerSource === 'select_showcase';

    const win = ctx.getMainWindow();
    const workerId = Math.max(1, Number(params?.workerId) || 1);
    const sendProgress = (status, percent = 5) => {
      throwIfCancelled();
      if (win && !win.isDestroyed()) win.webContents.send('video-gen-progress', { status, percent, workerId });
    };
    const workerCount = Math.max(workerId, Number(params?.workerCount) || 1);

    // 3D Kartun: naskah AI + suara ElevenLabs + render lokal → tanpa ChatGPT, tanpa Flow (tidak cek kredit Flow)
    if (params?.concept === 'kartun3d' || params?.concept === 'carakerja3d') {
      const result = await runKartun3DPipeline({
        ...params,
        isCancelled: () => videoCancelRequested,
        onProgress: (status, percent = 50) => {
          throwIfCancelled();
          if (win && !win.isDestroyed()) win.webContents.send('video-gen-progress', { status, percent, workerId });
        }
      });
      if (result?.success && win && !win.isDestroyed()) {
        setTimeout(() => {
          win.webContents.send('refresh-video-gallery', result);
          win.webContents.send('flow-video-saved', result);
        }, 500);
      }
      return result;
    }

    const chatgptProfile = await prepareWorkerProfiles(workerId, workerCount, sendProgress);
    sendProgress(perfProfile.describePerfProfile());

    // Cek kredit Google Flow sebelum pipeline dimulai (agar tidak membuang waktu di tahap ChatGPT).
    // Kredit dibaca ulang dari Flow jika belum pernah dicek / jam reset harian sudah lewat.
    // Hanya worker 1 yang membaca ulang kredit (membuka Chrome Flow); worker lain memakai hasilnya.
    if (workerId === 1 && typeof syncAllFlowAccountCredits === 'function') {
      await syncAllFlowAccountCredits({ onlyStale: true, onProgress: (s) => sendProgress(s) }).catch(() => {});
    }
    let creditCheck = checkFlowCreditAvailable(params || {});
    if (!creditCheck.ok && workerId === 1 && typeof syncAllFlowAccountCredits === 'function') {
      // Data lokal bisa meleset: pastikan dengan membaca ulang kredit asli semua akun
      await syncAllFlowAccountCredits({ onlyStale: false, onProgress: (s) => sendProgress(s) }).catch(() => {});
      creditCheck = checkFlowCreditAvailable(params || {});
    }
    if (!creditCheck.ok) {
      return { success: false, code: 'INSUFFICIENT_FLOW_CREDIT', error: creditCheck.message };
    }

    // Resolusi status headless dari payload parameter atau file konfigurasi
    const isHeadless = resolveHeadlessSetting(params?.headless);

    if (isTikTok) {
      // Pemilihan fungsi runner berdasarkan konsep (Daster vs JJ)
      const isDasterConcept = params?.concept === 'daster' || typeof runTikTokDasterPipeline === 'function';
      // 3D Edukasi: naskah Gemini + 3 klip Flow + narasi TTS (tanpa ChatGPT)
      const runnerFn = params?.concept === 'edu3d'
        ? runEdu3DPipeline
        : (params?.concept === 'daster' && typeof runTikTokDasterPipeline === 'function')
        ? runTikTokDasterPipeline
        : (params?.concept === 'sensasi' && typeof runTikTokSensasiPipeline === 'function')
          ? runTikTokSensasiPipeline
          : (params?.concept === 'pov' && typeof runTikTokPovPipeline === 'function')
            ? runTikTokPovPipeline
            : runTikTokVideoPipeline;

      const result = await runnerFn({
        ...params,
        platform: 'tiktok',
        workerId,
        headless: isHeadless, // Diteruskan eksplisit ke runner pipeline
        chatgptProfileDir: chatgptProfile,
        profileDir: chatgptProfile,
        sessionsDir: SESSIONS_DIR,
        dataRoot: RUNTIME_ROOT,
        onProgress: (status, percent = 50) => {
          throwIfCancelled();
          if (win && !win.isDestroyed()) {
            win.webContents.send('video-gen-progress', { status, percent, workerId });
          }
        }
      });

      // Siapkan versi HD untuk TikTok di latar belakang sekarang → saat dijadwalkan nanti tidak perlu encode lagi
      if (result && result.success) {
        const madeVideo = result.storagePath || result.videoPath;
        if (madeVideo) setTimeout(() => { enhanceVideoForTikTok(madeVideo).catch(() => {}); }, 1500);
      }

      if (result && result.success && win && !win.isDestroyed()) {
        setTimeout(() => {
          win.webContents.send('refresh-video-gallery', result);
          win.webContents.send('flow-video-saved', result);
          win.webContents.send('refresh-images-gallery');
          win.webContents.send('refresh-storyboard-gallery');
        }, 500);
      }
      return result;
    }

    const igResult = await runInstagramStoryboardPipeline({
      ...params,
      platform: 'instagram',
      workerId: 1,
      headless: isHeadless,
      chatgptProfileDir: CHATGPT_SHARED_PROFILE,
      profileDir: CHATGPT_SHARED_PROFILE,
      sessionsDir: SESSIONS_DIR,
      dataRoot: RUNTIME_ROOT,
      onProgress: (status, percent = 0) => {
        throwIfCancelled();
        if (win && !win.isDestroyed()) {
          win.webContents.send('video-gen-progress', { status, percent, workerId: 1 });
        }
      }
    });
    return igResult;
  }

  // --- RIWAYAT STORYBOARD ---
  const handleGetStoryboardHistory = async () => {
    const storyboardDir = path.resolve(PROJECT_ROOT, 'storage/storyboards');
    const metadataJson = path.resolve(SESSIONS_DIR, 'generated_images/metadata.json');
    const bahanDir = path.resolve(PROJECT_ROOT, 'storage/bahan_video');

    const exactPromptMap = new Map();

    if (fs.existsSync(bahanDir)) {
      try {
        fs.readdirSync(bahanDir).filter((d) => fs.statSync(path.join(bahanDir, d)).isDirectory()).forEach((d) => {
          const pPromptFile = path.join(bahanDir, d, 'prompt_video.txt');
          if (fs.existsSync(pPromptFile)) {
            const c = fs.readFileSync(pPromptFile, 'utf-8').trim();
            const match = d.match(/\d{10,13}/);
            if (match) exactPromptMap.set(match[0], c);
          }
        });
      } catch (e) {}
    }

    if (fs.existsSync(metadataJson)) {
      try {
        const metaList = JSON.parse(fs.readFileSync(metadataJson, 'utf-8'));
        if (Array.isArray(metaList)) {
          metaList.forEach((entry) => {
            if (entry?.videoPromptText) {
              if (entry.fileName) exactPromptMap.set(entry.fileName, entry.videoPromptText);
              if (entry.id) exactPromptMap.set(String(entry.id), entry.videoPromptText);
            }
          });
        }
      } catch (e) {}
    }

    const foundImages = [];
    if (fs.existsSync(storyboardDir)) {
      try {
        fs.readdirSync(storyboardDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).forEach((f) => {
          const full = path.join(storyboardDir, f);
          const stat = fs.statSync(full);
          const match = f.match(/\d{10,13}/);
          foundImages.push({ path: full, mtime: stat.mtimeMs, ts: match ? match[0] : '', fileName: f });
        });
      } catch (e) {}
    }

    foundImages.sort((a, b) => b.mtime - a.mtime);
    // Galeri per akun: storyboard milik akun aktif saja
    const ownImages = foundImages.filter((img) => galleryOwner.isVisibleToActive(img.fileName));

    const items = ownImages.map((img) => ({
      path: img.path,
      mtime: img.mtime,
      promptText: exactPromptMap.get(img.fileName) || exactPromptMap.get(img.ts) || ''
    }));

    return { items, frames: items.map((i) => i.path) };
  };

  ipcMain.handle('get-storyboard-history', handleGetStoryboardHistory);
  ipcMain.handle('ai-video:get-storyboard-history', handleGetStoryboardHistory);

  // --- RIWAYAT VIDEO JADI ---
  const handleGetSavedVideos = async () => {
    const targetDir = path.resolve(PROJECT_ROOT, 'storage/videos');
    const metaPath = path.resolve(targetDir, 'metadata.json');
    let metaList = [];
    if (fs.existsSync(metaPath)) {
      try { metaList = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) {}
    }

    if (fs.existsSync(targetDir)) {
      // *_hd.mp4 = salinan 1080p untuk upload TikTok (videoEnhancer), bukan video baru
      const files = fs.readdirSync(targetDir).filter((f) => /\.(mp4|webm|mov)$/i.test(f) && !/_hd\.mp4$/i.test(f))
        // Galeri per akun: video milik akun aktif saja
        .filter((f) => galleryOwner.isVisibleToActive(f));
      return files.map((file) => {
        const fullPath = path.join(targetDir, file);
        const stat = fs.statSync(fullPath);
        const meta = metaList.find((m) => m.fileName === file) || {};
        const base = path.basename(file, path.extname(file));
        const thumb = path.join(targetDir, `${base}_thumb.png`);

        return {
          id: meta.id || `vid_${stat.mtimeMs}`,
          fileName: file,
          name: file,
          filePath: fullPath,
          storagePath: fullPath,
          previewUrl: fullPath,
          url: fullPath,
          // thumbnail basi (lebih tua dari videonya) dikosongkan → dibuat ulang oleh galeri
          thumbnailPath: thumbFresh(thumb, fullPath) ? thumb : '',
          poster: thumbFresh(thumb, fullPath) ? thumb : '',
          timestamp: stat.mtimeMs,
          createdAt: stat.mtime.toISOString(),
          createdDate: stat.mtime.toLocaleString('id-ID')
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
    }
    return [];
  };

  // --- THUMBNAIL VIDEO (untuk galeri) ---
  // Galeri dulu memasang <video> untuk tiap kartu → terlalu banyak pemutar sekaligus, sebagian
  // gagal dimuat (hitam & tak bisa diputar). Kini kartu memakai gambar <nama>_thumb.png yang
  // diambil dari 30% durasi (bukan frame pertama yang sering hitam). Dibuat antre & di-cache.
  // Thumbnail valid = ada, tidak kosong, dan dibuat SETELAH videonya selesai ditulis.
  function thumbFresh(thumb, videoPath) {
    try {
      const t = fs.statSync(thumb);
      const v = fs.statSync(videoPath);
      return t.size > 1000 && t.mtimeMs >= v.mtimeMs;
    } catch (e) { return false; }
  }
  const { getFfmpegPath } = require('../../core/videoEnhancer');
  const { spawn } = require('child_process');
  let thumbQueue = Promise.resolve();
  const runFfmpeg = (args) => new Promise((resolve) => {
    const bin = getFfmpegPath();
    if (!bin) return resolve({ code: -1, err: 'ffmpeg tidak ditemukan' });
    let err = '';
    const p = spawn(bin, args, { windowsHide: true });
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', (code) => resolve({ code, err }));
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
  });
  async function makeVideoThumb(videoPath) {
    const base = path.join(path.dirname(videoPath), path.basename(videoPath, path.extname(videoPath)));
    const thumb = `${base}_thumb.png`;
    if (thumbFresh(thumb, videoPath)) return thumb;
    // Video masih ditulis (baru selesai dibuat/diunduh) → tunggu ukurannya stabil dulu.
    // Dulu thumbnail diambil dari file setengah jadi → gambar hitam yang ter-cache selamanya.
    for (let i = 0; i < 20; i++) {
      const s1 = fs.statSync(videoPath).size;
      if (Date.now() - fs.statSync(videoPath).mtimeMs > 4000) break;
      await new Promise((r) => setTimeout(r, 1500));
      if (fs.statSync(videoPath).size === s1 && Date.now() - fs.statSync(videoPath).mtimeMs > 3000) break;
    }
    // durasi dari output "Duration: hh:mm:ss.xx"
    const probe = await runFfmpeg(['-hide_banner', '-i', videoPath]);
    const m = probe.err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const dur = m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : 0;
    const tmp = `${base}_thumb.tmp.png`;
    // "thumbnail" memilih frame paling mewakili dari beberapa frame (menghindari frame hitam/transisi)
    const tries = [
      ['-ss', (dur > 0 ? Math.max(0.5, dur * 0.3) : 1).toFixed(2), '-i', videoPath, '-vf', 'thumbnail=30,scale=360:-2'],
      ['-ss', (dur > 0 ? Math.max(0.2, dur * 0.6) : 2).toFixed(2), '-i', videoPath, '-vf', 'thumbnail=30,scale=360:-2'],
      ['-i', videoPath, '-vf', 'scale=360:-2']                          // video sangat pendek
    ];
    for (const t of tries) {
      try { fs.unlinkSync(tmp); } catch (e) {}
      const res = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...t, '-frames:v', '1', tmp]);
      if (res.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
        try { fs.renameSync(tmp, thumb); } catch (e) { fs.copyFileSync(tmp, thumb); try { fs.unlinkSync(tmp); } catch (x) {} }
        return thumb;
      }
    }
    try { fs.unlinkSync(tmp); } catch (e) {}
    return '';
  }
  ipcMain.handle('ensure-video-thumb', async (event, videoPath) => {
    try {
      const p = String(videoPath || '').replace(/^file:\/\/\/?/, '');
      if (!p || !fs.existsSync(p)) return { success: false, thumb: '' };
      const job = thumbQueue.then(() => makeVideoThumb(p));
      thumbQueue = job.catch(() => '');
      return { success: true, thumb: await job };
    } catch (e) {
      return { success: false, thumb: '', error: e.message };
    }
  });

  ipcMain.handle('get-saved-videos', handleGetSavedVideos);
  ipcMain.handle('ai-video:get-saved-videos', handleGetSavedVideos);
  ipcMain.handle('get-generated-videos', handleGetSavedVideos);

  // --- BACA GAMBAR KE BASE64 ---
  ipcMain.handle('read-image-as-base64', async (event, imagePath) => {
    try {
      if (!imagePath) return '';
      let target = path.resolve(String(imagePath).replace('file:///', ''));
      if (fs.existsSync(target)) {
        const ext = path.extname(target).toLowerCase().replace('.', '') || 'png';
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
        return `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`;
      }
    } catch (e) {}
    return '';
  });

  // --- PENGHAPUSAN FILE GALERI GAMBAR AI ---
  const handleDeleteAiImage = async (e, targetInput, fallbackPath) => {
    try {
      let targetId = '';
      let targetPathStr = '';

      if (typeof targetInput === 'object' && targetInput !== null) {
        targetId = targetInput.id ? String(targetInput.id) : '';
        targetPathStr = targetInput.filePath || targetInput.path || targetInput.fileName || '';
      } else {
        const strVal = String(targetInput || '').trim();
        targetId = strVal;
        targetPathStr = fallbackPath ? String(fallbackPath).trim() : strVal;
      }

      const metaFiles = [
        path.resolve(SESSIONS_DIR, 'generated_images/metadata.json'),
        path.resolve(PROJECT_ROOT, 'storage/images/metadata.json')
      ];

      let physicalFilesToDelete = new Set();
      if (targetPathStr) physicalFilesToDelete.add(path.resolve(targetPathStr.replace('file:///', '')));

      metaFiles.forEach((metaFile) => {
        if (!fs.existsSync(metaFile)) return;
        try {
          let list = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
          if (Array.isArray(list)) {
            const updated = list.filter((item) => {
              const itemId = item.id ? String(item.id) : '';
              const itemPath = item.filePath || item.storagePath || '';
              const itemFile = item.fileName || path.basename(itemPath);

              const isMatch =
                (targetId && (itemId === targetId || itemFile === targetId)) ||
                (targetPathStr && (itemPath.includes(targetPathStr) || targetPathStr.includes(itemPath) || itemFile === path.basename(targetPathStr)));

              if (isMatch) {
                if (item.filePath) physicalFilesToDelete.add(path.resolve(item.filePath));
                if (item.storagePath) physicalFilesToDelete.add(path.resolve(item.storagePath));
                return false;
              }
              return true;
            });

            fs.writeFileSync(metaFile, JSON.stringify(updated, null, 2), 'utf-8');
          }
        } catch (err) {}
      });

      physicalFilesToDelete.forEach((filePath) => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {}
      });

      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('refresh-images-gallery');
        win.webContents.send('refresh-image-storage');
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  ipcMain.handle('delete-ai-image', handleDeleteAiImage);
  ipcMain.handle('delete-generated-image', handleDeleteAiImage);

  ipcMain.handle('delete-storyboard-frame', async (e, targetInput) => {
    try {
      const targetStr = typeof targetInput === 'object' ? (targetInput?.path || targetInput?.filePath || '') : String(targetInput);
      const targetPath = path.resolve(targetStr);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('refresh-storyboard-gallery');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-saved-video', async (e, videoData) => {
    try {
      const fName = typeof videoData === 'object' ? (videoData?.fileName || path.basename(videoData?.filePath || '')) : path.basename(String(videoData));
      const targetPath = path.resolve(PROJECT_ROOT, 'storage/videos', fName);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      const thumb = path.resolve(PROJECT_ROOT, 'storage/videos', `${path.basename(fName, path.extname(fName))}_thumb.png`);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
      // Salinan 1080p untuk upload TikTok ikut dihapus
      const hdCopy = path.resolve(PROJECT_ROOT, 'storage/videos', `${path.basename(fName, path.extname(fName))}_hd.mp4`);
      if (fs.existsSync(hdCopy)) fs.unlinkSync(hdCopy);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('refresh-video-gallery');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- CLIPBOARD & GOOGLE FLOW ---
  ipcMain.handle('paste-image-from-clipboard', async () => {
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return { success: false, error: 'Clipboard kosong.' };
      const refDir = path.resolve(PROJECT_ROOT, 'storage/reference_images');
      if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
      const fileName = `ref_${Date.now()}.png`;
      const targetPath = path.join(refDir, fileName);
      fs.writeFileSync(targetPath, img.toPNG());
      return { success: true, filePath: targetPath, fileName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-flow-accounts', async () => getFlowAccountsConfig());
  // Simpan setelan Flow dari UI (saklar Mode Headless); field lain di config tidak diubah
  ipcMain.handle('save-flow-accounts-config', async (e, patch = {}) => {
    const cfg = getFlowAccountsConfig();
    if (typeof patch.headless === 'boolean') cfg.headless = patch.headless;
    saveFlowAccountsConfig(cfg);
    return { success: true, headless: cfg.headless };
  });

  ipcMain.handle('add-flow-account', async () => addFlowAccount());
  ipcMain.handle('delete-flow-account', async (e, id) => deleteFlowAccount(id));
  ipcMain.handle('open-flow-login', async (e, id) => openFlowLoginWindow(id || 'acc_1'));
  ipcMain.handle('sync-flow-account-credits', async (e, id) => ({ success: true, credits: await silentSyncAccountCredits(id) }));

  // Cek kredit otomatis (jendela Chrome di luar layar) untuk akun yang datanya usang:
  // belum pernah dicek atau jam reset harian akun sudah lewat. Dilewati saat render berjalan.
  const autoSyncStaleCredits = async () => {
    if (isVideoPipelineRunning || typeof syncAllFlowAccountCredits !== 'function') return { success: false, skipped: true };
    await syncAllFlowAccountCredits({ onlyStale: true }).catch(() => {});
    return { success: true };
  };
  ipcMain.handle('auto-sync-flow-credits', async () => autoSyncStaleCredits());
  setInterval(autoSyncStaleCredits, 15 * 60 * 1000);
  setTimeout(autoSyncStaleCredits, 20 * 1000); // sekali setelah aplikasi dibuka

  ipcMain.handle('open-video-folder', async () => shell.openPath(path.resolve(PROJECT_ROOT, 'storage/videos')));
  ipcMain.handle('open-storyboard-folder', async () => shell.openPath(path.resolve(PROJECT_ROOT, 'storage/storyboards')));
  ipcMain.handle('open-bahan-folder', async (e, folderPath) => {
    if (typeof openBahanVideoFolder === 'function') return openBahanVideoFolder(folderPath);
  });
};