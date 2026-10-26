/**
 * src/main/main.js (Clean Modular Architecture)
 * Versi Stabil Lengkap + Penambahan Pipeline Otomatis Google Flow -> CapCut Web (JJ)
 * + Dukungan Penuh Konsep Daster & Homewear Try-On (Tanpa CapCut)
 * + Sinkronisasi Profil & Sesi Akun TikTok Otomatis
 */
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const TIKTOK_PROFILES_DIR = path.resolve(PROJECT_ROOT, 'sessions/tiktok_profiles');
const ACCOUNTS_FILE = path.resolve(PROJECT_ROOT, 'sessions/accounts.json');

if (!fs.existsSync(TIKTOK_PROFILES_DIR)) {
  fs.mkdirSync(TIKTOK_PROFILES_DIR, { recursive: true });
}

// Import Platform & Layanan Sesi
const sessionManager = require('../platforms/instagram/sessionManager');
const scheduleRunner = require('../core/scheduleRunner');
const trayManager = require('../core/trayManager');
const pinterestSession = require('../platforms/pinterest/pinterestSession');
const tiktokSessionManager = require('../platforms/tiktok/tiktokSessionManager');
const { uploadToTikTok } = require('../platforms/tiktok/tiktokUploader');

// Import Layanan AI & Penyimpanan Galeri Lengkap
const aiCaption = require('../services/aiCaption');
const { generateAndStoreAiImage } = require('../services/aiImage');
const { getGeneratedImagesList, openImagesFolder, deleteGeneratedImage } = require('../services/imageStorage');
const { 
  runStoryboardPipeline: runInstagramStoryboardPipeline,
  getSavedVideosList,
  openVideoFolder,
  openStoryboardFolder,
  openBahanVideoFolder,
  deleteSavedVideo,
  deleteSavedStoryboard
} = require('../services/aiVideo');

// Import Pipeline TikTok: JJ & Daster Terpisah
const { runTikTokVideoPipeline } = require('../services/aiVideoTiktok');
const { runTikTokDasterPipeline } = require('../services/aiVideoTiktokDaster');

// Import Runner Otomasi Google Flow & CapCut Web
const flowRunner = require(path.join(__dirname, '../services/flowVideoRunner'));
const flowRunnerTiktok = require('../services/flowVideoRunnerTiktok');
const flowRunnerTiktokDaster = require('../services/flowVideoRunnerTiktokDaster');

const runFlowProjectCreationTiktok = flowRunnerTiktok.runFlowProjectCreationTiktok || flowRunnerTiktok;
const runFlowProjectCreationTiktokDaster = flowRunnerTiktokDaster.runFlowProjectCreationTiktokDaster || flowRunnerTiktokDaster;
const { runCapCutTemplatePipeline, openCapCutLoginSession } = require('../services/capcutWebRunner');

// Import Sub-Modul IPC
const registerWindowIpc = require('./ipc/windowIpc');
const registerAccountIpc = require('./ipc/accountIpc');
const registerShowcaseIpc = require('./ipc/showcaseIpc');
const registerVideoIpc = require('./ipc/videoIpc');
const registerScheduleIpc = require('./ipc/scheduleIpc');
const registerAiConfigIpc = require('./ipc/aiConfigIpc');

let mainWindow;
let isQuitting = false;

// Helper registrasi IPC aman tanpa konflik duplikasi
function safeHandle(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch (e) {}
  ipcMain.handle(channel, handler);
}

function getOriginalChromeExecutablePath() {
  const p = os.platform();
  const c = [];
  if (p === 'win32') {
    c.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (p === 'linux') {
    c.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  } else if (p === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  return c.find((x) => x && fs.existsSync(x));
}

function cleanUserIdentifier(name) {
  if (!name) return 'etnic';
  return String(name).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

function getTikTokProfileDir(accountId = 'karuna_id') {
  if (typeof tiktokSessionManager.getTikTokProfileDir === 'function') {
    return tiktokSessionManager.getTikTokProfileDir(accountId);
  }
  const cleanId = cleanUserIdentifier(accountId);
  const targetDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

function focusMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function loadInitialScreen() {
  if (mainWindow) mainWindow.loadFile(path.join(__dirname, '../renderer/select-account.html'));
}

function setupPartitionHeaders(partitionName) {
  if (!partitionName) return;
  try {
    const customSession = session.fromPartition(partitionName);
    customSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
      details.requestHeaders['Referer'] = details.url.includes('tiktok') ? 'https://www.tiktok.com/' : 'https://www.instagram.com/';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
  } catch (e) {}
}

function createMainWindow() {
  const preloadCandidates = [
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '../renderer/preload.js')
  ];
  const preloadPath = preloadCandidates.find((p) => fs.existsSync(p)) || path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1140,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: '',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    webPreferences: { 
      preload: preloadPath, 
      nodeIntegration: false, 
      contextIsolation: true 
    }
  });

  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    trayManager.showDesktopNotification(
      'AutoUpload Core',
      'Aplikasi tetap aktif di background untuk memantau jadwal postingan Anda.',
      true,
      focusMainWindow
    );
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const currentUrl = mainWindow.webContents.getURL() || '';
      if (!currentUrl.includes('dashboard.html')) {
        return;
      }

      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        const accList = Array.isArray(raw) ? raw : (raw.accounts || []);
        const activeId = raw.activeAccountId || raw.activeId;
        const activeAcc = accList.find((a) => a.id === activeId) || accList[0];

        if (activeAcc && String(activeAcc.platform).toLowerCase() === 'tiktok') {
          const syncRes = await tiktokSessionManager.syncTikTokProfile(activeAcc.id || activeAcc.username);
          if (syncRes && syncRes.success && syncRes.account && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('account-updated', syncRes.account);
            mainWindow.webContents.send('profile-updated', syncRes.account);
          }
        }
      }
    } catch (e) {
      console.warn('[AutoSync] Info akun belum dapat diperbarui saat muat awal:', e.message);
    }
  });

  mainWindow.on('close', () => {
    isQuitting = true;
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadInitialScreen();
}

function clearKalodataStorageOnExit() {
  try {
    const filesToReset = [
      path.resolve(PROJECT_ROOT, 'sessions/kalodata_products.json'),
      path.resolve(PROJECT_ROOT, 'sessions/searchList.json')
    ];

    filesToReset.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf-8');
      }
    });
  } catch (err) {}
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('AutoUpload Core');

  // 1. Siapkan Konteks Lengkap untuk Sub-Modul IPC
  const ctx = {
    PROJECT_ROOT,
    TIKTOK_PROFILES_DIR,
    getMainWindow: () => mainWindow,
    focusMainWindow,
    loadInitialScreen,
    cleanUserIdentifier,
    getOriginalChromeExecutablePath,
    getTikTokProfileDir,
    setupPartitionHeaders,
    ...sessionManager,
    ...scheduleRunner,
    ...trayManager,
    ...pinterestSession,
    ...tiktokSessionManager,
    ...aiCaption,
    uploadToTikTok,
    // Eksekusi Pipeline Otomatis sesuai Konsep
    runTikTokVideoPipeline: async (params) => {
      if (params && params.concept === 'daster') {
        return await runTikTokDasterPipeline(params);
      }
      return await runTikTokVideoPipeline(params);
    },
    runTikTokDasterPipeline,
    runInstagramStoryboardPipeline,
    runCapCutTemplatePipeline,
    openCapCutLoginSession,
    generateAndStoreAiImage,
    getGeneratedImagesList,
    openImagesFolder,
    deleteGeneratedImage,
    getSavedVideosList,
    openVideoFolder,
    openStoryboardFolder,
    openBahanVideoFolder,
    deleteSavedVideo,
    deleteSavedStoryboard,
    ...flowRunner,
    runFlowProjectCreationTiktok: typeof runFlowProjectCreationTiktok === 'function'
      ? runFlowProjectCreationTiktok
      : (flowRunnerTiktok.default || flowRunnerTiktok),
    runFlowProjectCreationTiktokDaster: typeof runFlowProjectCreationTiktokDaster === 'function'
      ? runFlowProjectCreationTiktokDaster
      : (flowRunnerTiktokDaster.default || flowRunnerTiktokDaster)
  };

  // 2. Daftarkan seluruh sub-modul IPC
  registerWindowIpc(ipcMain, ctx);
  registerAccountIpc(ipcMain, ctx);
  registerShowcaseIpc(ipcMain, ctx);
  registerVideoIpc(ipcMain, ctx);
  registerScheduleIpc(ipcMain, ctx);
  registerAiConfigIpc(ipcMain, ctx);

  // 3. Daftarkan handler utama dengan proteksi safeHandle
  safeHandle('open-external-url', async (event, url) => {
    if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'URL tidak valid' };
  });

  safeHandle('tiktok:sync-profile', async (event, accountId) => {
    try {
      const result = await tiktokSessionManager.syncTikTokProfile(accountId || 'karuna_id');
      if (result && result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('account-updated', result.account);
        mainWindow.webContents.send('profile-updated', result.account);
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('sync-tiktok-profile', async (event, accountId) => {
    try {
      const result = await tiktokSessionManager.syncTikTokProfile(accountId || 'karuna_id');
      if (result && result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('account-updated', result.account);
        mainWindow.webContents.send('profile-updated', result.account);
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('run-capcut-template', async (event, params) => {
    try {
      const startTime = Date.now();
      const sendProgress = (status, percent = 75) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const logMsg = `[[${elapsed}s]] ${status}`;
        const payload = { status: logMsg, percent };
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('video-gen-progress', payload);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('video-gen-progress', payload);
        }
      };

      const result = await runCapCutTemplatePipeline({
        ...params,
        onProgress: (status) => sendProgress(status, 75)
      });

      const totalMin = ((Date.now() - startTime) / 60000).toFixed(2);
      if (result && result.success) {
        const finishMsg = `Sukses! Video JJ selesai dalam ${totalMin} menit. Disimpan di: ${result.videoPath}`;
        const payload = { status: finishMsg, percent: 100, success: true, videoPath: result.videoPath };
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('video-gen-progress', payload);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('video-gen-progress', payload);
        }
      }
      return result;
    } catch (err) {
      const errorMsg = `Gagal membuat video JJ: ${err.message}`;
      const payload = { status: errorMsg, percent: 0, success: false };
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('video-gen-progress', payload);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-gen-progress', payload);
      }
      return { success: false, error: err.message };
    }
  });

  safeHandle('run-combined-flow-capcut', async (event, params) => {
    const pipelineStart = Date.now();
    const sendLog = (status, percent = 50) => {
      const elapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
      const formatted = `[[${elapsed}s]] ${status}`;
      const payload = { status: formatted, percent };
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('video-gen-progress', payload);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-gen-progress', payload);
      }
    };

    try {
      sendLog('Langkah 1/2: Menjalankan Google Flow Reels Otomatis...', 25);

      let flowResult = null;
      if (typeof runFlowProjectCreationTiktok === 'function') {
        flowResult = await runFlowProjectCreationTiktok(params);
      } else if (typeof flowRunner.runFlowProjectCreation === 'function') {
        flowResult = await flowRunner.runFlowProjectCreation(params);
      } else {
        throw new Error('Fungsi Google Flow Reels tidak ditemukan dalam runner.');
      }

      sendLog('✓ Google Flow selesai! Mengambil berkas hasil render...', 50);

      const generatedVideoPath = flowResult?.videoPath || params.videoPath;
      const candidList = flowResult?.candidPaths || params.candidPaths || [];

      if (!generatedVideoPath || !fs.existsSync(generatedVideoPath)) {
        throw new Error('Berkas video hasil Google Flow tidak ditemukan untuk dilanjutkan ke CapCut.');
      }

      sendLog(`Langkah 2/2: Melanjutkan ke CapCut Web Pipeline menggunakan video: ${path.basename(generatedVideoPath)}...`, 70);

      const capcutResult = await runCapCutTemplatePipeline({
        searchKeyword: params.searchKeyword || 'JJ',
        videoPath: generatedVideoPath,
        candidPaths: candidList,
        headless: true,
        onProgress: (subStatus) => {
          sendLog(`[CapCut] ${subStatus}`, 85);
        }
      });

      const totalDurationMin = ((Date.now() - pipelineStart) / 60000).toFixed(2);

      if (capcutResult && capcutResult.success) {
        sendLog(`🎉 Sukses Total! 1 Video JJ selesai dalam ${totalDurationMin} menit. File: ${capcutResult.videoPath}`, 100);
        return { success: true, videoPath: capcutResult.videoPath, durationMinutes: totalDurationMin };
      } else {
        throw new Error(capcutResult?.error || 'Gagal pada tahap pemrosesan CapCut Web.');
      }
    } catch (err) {
      sendLog(`Gagal pada Pipeline Gabungan: ${err.message}`, 0);
      return { success: false, error: err.message };
    }
  });

  safeHandle('run-flow-to-jj-from-storyboard', async (event, params = {}) => {
    const pipelineStartTime = Date.now();
    const STORYBOARDS_DIR = path.resolve(PROJECT_ROOT, 'storage/storyboards');
    const STORAGE_IMG_DIR = path.resolve(PROJECT_ROOT, 'storage/images');

    const sendLog = (status, percent = 50) => {
      const elapsed = ((Date.now() - pipelineStartTime) / 1000).toFixed(1);
      const logText = `[[${elapsed}s]] ${status}`;
      const payload = { status: logText, percent };

      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('video-gen-progress', payload);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-gen-progress', payload);
      }
    };

    try {
      const storyboardPath = params.storyboardImagePath;
      if (!storyboardPath || !fs.existsSync(storyboardPath)) {
        throw new Error('Berkas gambar storyboard yang dipilih tidak ditemukan.');
      }

      sendLog(`Frame Storyboard terpilih: ${path.basename(storyboardPath)}`, 15);

      let promptText = params.promptText || '';
      let projectFolder = params.projectFolder || '';
      const metaPath = path.join(STORYBOARDS_DIR, 'metadata.json');

      if (!promptText && fs.existsSync(metaPath)) {
        try {
          const list = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          const item = list.find((x) => x.fileName === path.basename(storyboardPath) || x.path === storyboardPath);
          if (item) {
            promptText = item.promptText || '';
            projectFolder = item.projectFolder || '';
          }
        } catch (e) {}
      }

      if (!promptText) {
        const potentialTxt = storyboardPath.replace(/\.(png|jpe?g)$/i, '.txt');
        if (fs.existsSync(potentialTxt)) {
          promptText = fs.readFileSync(potentialTxt, 'utf-8');
        }
      }

      sendLog('Langkah 1/2: Menjalankan Google Flow TikTok (3 Candid + 1 Video Motion)...', 30);
      const flowRes = await (typeof runFlowProjectCreationTiktok === 'function'
        ? runFlowProjectCreationTiktok
        : (flowRunnerTiktok.default || flowRunnerTiktok))({
          storyboardImagePath: storyboardPath,
          projectFolder: projectFolder,
          promptText: promptText,
          flowRatio: params.flowRatio || '9:16',
          flowModel: params.flowModel || 'Veo 3.1 - Lite',
          flowResolution: params.flowResolution || '720p',
          flowDuration: params.flowDuration || '8 Detik',
          onProgress: (status) => sendLog(`[Flow] ${status}`, 45)
        });

      if (!flowRes || !flowRes.success || !flowRes.videoPath) {
        throw new Error(flowRes?.error || 'Gagal merender video di Google Flow.');
      }

      const generatedVideo = flowRes.videoPath;

      let candidPhotos = [];
      if (fs.existsSync(STORAGE_IMG_DIR)) {
        candidPhotos = fs.readdirSync(STORAGE_IMG_DIR)
          .filter((f) => f.startsWith('img_candid_') && /\.(png|jpe?g)$/i.test(f))
          .map((f) => path.join(STORAGE_IMG_DIR, f));
        candidPhotos.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
        candidPhotos = candidPhotos.slice(0, 3);
      }

      sendLog(`Langkah 2/2: Melanjutkan ke CapCut Web JJ (Mode Headless) menggunakan video & ${candidPhotos.length} foto candid...`, 70);

      const capcutRes = await runCapCutTemplatePipeline({
        searchKeyword: params.searchKeyword || 'JJ',
        videoPath: generatedVideo,
        candidPaths: candidPhotos,
        headless: true,
        onProgress: (status) => sendLog(`[CapCut] ${status}`, 85)
      });

      const totalTimeMin = ((Date.now() - pipelineStartTime) / 60000).toFixed(2);

      if (capcutRes && capcutRes.success) {
        sendLog(`🎉 Sukses Total! 1 Video JJ selesai dibuat dalam ${totalTimeMin} menit: ${path.basename(capcutRes.videoPath)}`, 100);
        return {
          success: true,
          videoPath: capcutRes.videoPath,
          durationMinutes: totalTimeMin
        };
      } else {
        throw new Error(capcutRes?.error || 'Gagal saat memproses template CapCut Web.');
      }
    } catch (err) {
      sendLog(`Gagal: ${err.message}`, 0);
      return { success: false, error: err.message };
    }
  });

  safeHandle('open-capcut-login-session', async () => {
    return await openCapCutLoginSession();
  });

  // 4. Buat MainWindow setelah seluruh IPC siap
  createMainWindow();
  trayManager.createSystemTray(() => mainWindow, () => {
    isQuitting = true;
    app.quit();
  });

  setInterval(() => {
    scheduleRunner.processPendingSchedulesQueue(mainWindow, (title, body, ok) => {
      trayManager.showDesktopNotification(title, body, ok, focusMainWindow);
    });
  }, 10000);
});

app.on('before-quit', () => {
  isQuitting = true;
  clearKalodataStorageOnExit();
});

app.on('window-all-closed', () => {
  clearKalodataStorageOnExit();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  else if (mainWindow) focusMainWindow();
});