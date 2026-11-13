/**
 * src/main/main.js (Clean Modular Architecture)
 * Versi Stabil Lengkap + Penanganan Isolasi Sesi Runtime Pengguna
 * + Auto-Updater Terintegrasi (Mode Game Popup Dialog & Handshake UI)
 * + Auto-Routing Multi-Akun Showcase TikTok (Tanpa Cek Manual & Multi-Session Terisolasi)
 */
const { app, BrowserWindow, ipcMain, session, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { machineIdSync } = require('node-machine-id');

// Path data runtime aman (menghindari ENOTDIR di dalam app.asar)
const isPackaged = app.isPackaged;
const DATA_ROOT = isPackaged 
  ? app.getPath('userData') 
  : path.resolve(__dirname, '../../');

const PROJECT_ROOT = path.resolve(__dirname, '../../');
// Versi terinstal: semua modul yang memakai process.cwd() menulis ke userData (bukan folder instalasi yang terhapus saat update)
if (isPackaged) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  process.chdir(DATA_ROOT);
}
const SESSIONS_DIR = path.resolve(DATA_ROOT, 'sessions');

// Server update di belakang Cloudflare menawarkan HTTP/3: unduhan besar lewat QUIC sering putus
// (net::ERR_QUIC_PROTOCOL_ERROR). Paksa HTTP/2 biasa.
app.commandLine.appendSwitch('disable-quic');

// Error jaringan yang lolos dari updater jangan sampai memunculkan dialog crash main process
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  if (/^net::ERR_/.test(msg)) {
    console.warn('[Main] Error jaringan diabaikan:', msg);
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:error', 'Koneksi terputus saat mengunduh pembaruan. Silakan coba lagi.');
    }
    return;
  }
  console.error('[Main] Uncaught exception:', err);
  // Perilaku bawaan Electron untuk error lain tetap: tampilkan dialog
  try { require('electron').dialog.showErrorBox('A JavaScript error occurred in the main process', err?.stack || msg); } catch (e) {}
});
const perfProfile = require('../core/perfProfile');
const remoteUpload = require('../core/remoteUploadClient');
const STORAGE_DIR = path.resolve(DATA_ROOT, 'storage');
const TIKTOK_PROFILES_DIR = path.resolve(DATA_ROOT, 'sessions/tiktok_profiles');
const ACCOUNTS_FILE = path.resolve(DATA_ROOT, 'sessions/accounts.json');

// Pastikan direktori sesi & storage dasar selalu tersedia
[SESSIONS_DIR, STORAGE_DIR, TIKTOK_PROFILES_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Inisialisasi & Sanitasi file akun baru
function sanitizeAccountsOnStart() {
  try {
    let shouldReset = false;
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      shouldReset = true;
    } else {
      const content = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
      if (content.includes('1793125582110') || content.includes('Sherlylovyou')) {
        console.warn('[Sanitize] Terdeteksi sisa data akun pengembang, mereset file sesi...');
        shouldReset = true;
      }
    }

    if (shouldReset) {
      fs.writeFileSync(
        ACCOUNTS_FILE,
        JSON.stringify({ accounts: [], activeAccountId: null }, null, 2),
        'utf-8'
      );
    }
  } catch (e) {
    console.warn('[Sanitize] Error saat memeriksa akun awal:', e.message);
  }
}
sanitizeAccountsOnStart();

// Helper untuk membaca username aktif TikTok dari accounts.json
function getActiveTikTokUsername() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      const list = Array.isArray(raw) ? raw : (raw.accounts || []);
      const activeId = raw.activeAccountId || raw.activeId;
      const activeAcc = list.find((a) => a.id === activeId) || (list.length > 0 ? list[0] : null);
      if (activeAcc) {
        return (activeAcc.username || activeAcc.name || activeAcc.id || 'default').replace(/^@/, '').trim();
      }
    }
  } catch (e) {}
  return 'default';
}

function cleanUserIdentifier(name) {
  if (!name) return 'default';
  return String(name).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

// Isolasi mutlak direktori profil browser per akun TikTok
function getTikTokProfileDir(accountId) {
  let targetId = accountId;
  if (!targetId || targetId === 'default') {
    targetId = getActiveTikTokUsername();
  }
  const cleanId = cleanUserIdentifier(targetId);
  const targetDir = path.resolve(TIKTOK_PROFILES_DIR, `profile_${cleanId}`);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
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

// ==========================================
// FUNGSI VERIFIKASI LISENSI SERVER (HWID)
// ==========================================
let currentActiveLicenseKey = null;
let heartbeatTimer = null;
let isAppExiting = false;

function getHardwareId() {
  try {
    return machineIdSync();
  } catch (e) {
    return 'HWID-FALLBACK-' + os.hostname();
  }
}

function verifyLicenseWithServer(licenseKey, hwid) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      license_key: licenseKey,
      machine_id: hwid
    });

    const req = https.request('https://license.etnicstore.com/verify.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ valid: false, networkError: true, message: 'Format balasan server lisensi tidak valid.' });
        }
      });
    });

    req.on('error', () => {
      resolve({ valid: false, networkError: true, message: 'Gagal terhubung ke server lisensi. Periksa koneksi internet.' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ valid: false, networkError: true, message: 'Koneksi ke server lisensi timeout.' });
    });

    req.write(postData);
    req.end();
  });
}

// ==========================================
// LISENSI TERSIMPAN (TERKUNCI DI PERANGKAT INI)
// Disimpan terenkripsi (safeStorage Windows) agar tidak perlu copy-paste setiap membuka aplikasi
// ==========================================
const LICENSE_FILE = path.join(SESSIONS_DIR, 'license.json');

function saveLicenseKey(licenseKey) {
  try {
    const data = safeStorage.isEncryptionAvailable()
      ? { encrypted: safeStorage.encryptString(licenseKey).toString('base64') }
      : { plain: licenseKey };
    fs.writeFileSync(LICENSE_FILE, JSON.stringify({ ...data, savedAt: new Date().toISOString() }), 'utf-8');
  } catch (e) {}
}

function loadSavedLicenseKey() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return '';
    const data = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
    if (data.encrypted) return safeStorage.decryptString(Buffer.from(data.encrypted, 'base64'));
    return data.plain || '';
  } catch (e) {
    return '';
  }
}

function clearSavedLicenseKey() {
  try { if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE); } catch (e) {}
}

// ==========================================
// TELEMETRI & HEARTBEAT REALTIME MONITORING
// ==========================================
function startLicenseHeartbeat(licenseKey) {
  currentActiveLicenseKey = licenseKey;
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  const sendHeartbeat = () => {
    if (!currentActiveLicenseKey) return;

    const payload = JSON.stringify({
      license_key: currentActiveLicenseKey,
      machine_id: getHardwareId(),
      pc_name: os.hostname(),
      app_version: app.getVersion() || '1.0.0'
    });

    const req = https.request('https://license.etnicstore.com/ping.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp && resp.license_status === 'suspended' && mainWindow && !mainWindow.isDestroyed()) {
            currentActiveLicenseKey = null;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            mainWindow.loadFile(path.join(__dirname, '../renderer/license.html'));
          }
        } catch (e) {}
      });
    });

    req.on('error', () => {});
    req.write(payload);
    req.end();
  };

  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, 3 * 60 * 1000);
}

function sendOfflinePingAsync() {
  return new Promise((resolve) => {
    if (!currentActiveLicenseKey) return resolve();

    const payload = JSON.stringify({
      license_key: currentActiveLicenseKey,
      machine_id: getHardwareId(),
      action: 'offline'
    });

    const req = https.request('https://license.etnicstore.com/ping.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 1500
    }, () => {
      resolve();
    });

    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

// ==========================================
// PENGATURAN PEMBARUAN OTOMATIS (MODE GAME POPUP)
// ==========================================
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Memeriksa versi pembaruan di server...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update tersedia:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:available', {
        version: info.version,
        releaseNotes: info.releaseNotes || 'Pembaruan sistem dan fitur terbaru.'
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Aplikasi sudah dalam versi terbaru.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:not-available');
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:download-progress', {
        percent: Math.round(progressObj.percent)
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Unduhan selesai:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:downloaded', {
        version: info.version
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Error pemeriksaan pembaruan:', err ? err.message : '');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:error', err ? err.message : 'Gagal memeriksa pembaruan.');
    }
  });
}

// Import Platform & Layanan Sesi
const sessionManager = require('../platforms/instagram/sessionManager');
const scheduleRunner = require('../core/scheduleRunner');
const trayManager = require('../core/trayManager');
const pinterestSession = require('../platforms/pinterest/pinterestSession');
const tiktokSessionManager = require('../platforms/tiktok/tiktokSessionManager');
const { uploadToTikTok } = require('../platforms/tiktok/tiktokUploader');

// Galeri per akun: hasil video / gambar ditandai dengan akun yang aktif saat proses DIMULAI
// (pindah akun di tengah proses tidak memindahkan hasilnya ke akun lain)
const galleryOwner = require('../core/galleryOwner');
galleryOwner.initGalleryOwner({ dataRoot: DATA_ROOT, getActiveAccount: () => sessionManager.getActiveAccount() });
const GALLERY_PRODUCER_CHANNELS = new Set([
  'generate-ai-video', 'generate-ai-image', 'remotion-render',
  'run-capcut-template', 'run-combined-flow-capcut', 'run-flow-to-jj-from-storyboard'
]);
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (!GALLERY_PRODUCER_CHANNELS.has(channel)) return originalIpcHandle(channel, handler);
  return originalIpcHandle(channel, async (...args) => {
    const owner = galleryOwner.currentOwner();
    const result = await handler(...args);
    try {
      if (result?.success) galleryOwner.tagFiles(galleryOwner.filesFromResult(result), owner);
    } catch (e) {}
    return result;
  });
};

if (typeof tiktokSessionManager.setBaseDirs === 'function') {
  tiktokSessionManager.setBaseDirs({
    dataRoot: DATA_ROOT,
    sessionsDir: SESSIONS_DIR,
    profilesDir: TIKTOK_PROFILES_DIR,
    accountsFile: ACCOUNTS_FILE
  });
}

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
const { runTikTokSensasiPipeline } = require('../services/aiVideoTiktokSensasi');
const { runTikTokPovPipeline } = require('../services/aiVideoTiktokPov');

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
const registerRemotionIpc = require('./ipc/remotionIpc');
const registerEdu3DIpc = require('./ipc/edu3dIpc');
const registerKartun3DIpc = require('./ipc/kartun3dIpc');

let mainWindow;

function safeHandle(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch (e) {}
  ipcMain.handle(channel, handler);
}

function focusMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function loadInitialScreen() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, '../renderer/license.html'));
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
  const appIconPath = path.join(__dirname, '../renderer/assets/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1140,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: 'Bot Auto Upload',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
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
        const activeAcc = accList.find((a) => a.id === activeId) || (accList.length > 0 ? accList[0] : null);

        if (activeAcc && activeAcc.id && !String(activeAcc.id).includes('1793125582110') && String(activeAcc.platform).toLowerCase() === 'tiktok') {
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

  mainWindow.on('close', async (event) => {
    if (!isAppExiting) {
      event.preventDefault();
      isAppExiting = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await sendOfflinePingAsync();
      clearKalodataStorageOnExit();
      app.exit(0);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadInitialScreen();
  setupAutoUpdater();
}

function clearKalodataStorageOnExit() {
  try {
    const filesToReset = [
      path.resolve(DATA_ROOT, 'sessions/kalodata_products.json'),
      path.resolve(DATA_ROOT, 'sessions/searchList.json')
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

  remoteUpload.initRemoteUpload(SESSIONS_DIR);

  const ctx = {
    // Identitas lisensi untuk Worker Upload 24 jam (server)
    getLicenseAuth: () => ({ licenseKey: currentActiveLicenseKey || loadSavedLicenseKey(), machineId: getHardwareId() }),
    PROJECT_ROOT: DATA_ROOT,
    DATA_ROOT,
    ACCOUNTS_FILE,
    SESSIONS_DIR,
    STORAGE_DIR,
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
    runTikTokVideoPipeline: async (params) => {
      if (params && params.concept === 'daster') {
        return await runTikTokDasterPipeline(params);
      }
      if (params && params.concept === 'sensasi') {
        return await runTikTokSensasiPipeline(params);
      }
      if (params && params.concept === 'pov') {
        return await runTikTokPovPipeline(params);
      }
      return await runTikTokVideoPipeline(params);
    },
    runTikTokDasterPipeline,
    runTikTokSensasiPipeline,
    runTikTokPovPipeline,
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

  registerWindowIpc(ipcMain, ctx);
  registerAccountIpc(ipcMain, ctx);
  registerShowcaseIpc(ipcMain, ctx);
  registerVideoIpc(ipcMain, ctx);
  registerScheduleIpc(ipcMain, ctx);
  registerAiConfigIpc(ipcMain, ctx);
  registerRemotionIpc(ipcMain, ctx);
  registerEdu3DIpc(ipcMain, ctx);
  registerKartun3DIpc(ipcMain, ctx);

  // Mode Perangkat Ringan (otomatis dari spek, bisa dipaksa dari Pengaturan AI)
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  perfProfile.initPerfProfile(SESSIONS_DIR);
  console.log('[Performa]', perfProfile.describePerfProfile());
  safeHandle('perf:get', async () => ({ ...perfProfile.getPerfProfile(), description: perfProfile.describePerfProfile() }));
  safeHandle('perf:set-mode', async (event, mode) => {
    perfProfile.setPerfMode(mode);
    return { ...perfProfile.getPerfProfile(), description: perfProfile.describePerfProfile() };
  });

  // =========================================================================
  // OVERRIDE: BUKA CHROME TIKTOK STREAMER DENGAN SESI AKUN YANG AKTIF
  // =========================================================================
  const handleOpenStreamerForActiveAccount = async (targetUsernameExplicit = null) => {
    try {
      const chromePath = getOriginalChromeExecutablePath();
      if (!chromePath) return { success: false, error: 'Google Chrome tidak ditemukan.' };

      const activeUser = cleanUserIdentifier(targetUsernameExplicit || getActiveTikTokUsername());
      const profileDir = getTikTokProfileDir(activeUser);

      const chromeArgs = [
        `--user-data-dir=${profileDir}`,
        '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1220,860',
        'https://shop.tiktok.com/streamer/showcase/product/list'
      ];

      const p = spawn(chromePath, chromeArgs, { detached: false, stdio: 'ignore' });
      return { success: true, account: activeUser };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  safeHandle('open-tiktok-streamer', async (event, targetAcc) => {
    return await handleOpenStreamerForActiveAccount(targetAcc);
  });

  safeHandle('open-tiktok-shop-streamer', async (event, targetAcc) => {
    return await handleOpenStreamerForActiveAccount(targetAcc);
  });

  // =========================================================================
  // OVERRIDE: ISOLASI OTOMATIS DATA SHOWCASE PER USERNAME AKUN AKTIF
  // =========================================================================
  safeHandle('get-tiktok-showcase-products', async (event, forceRefresh = false, explicitAccount = null) => {
    try {
      const targetUser = cleanUserIdentifier(explicitAccount || getActiveTikTokUsername());
      const af = require('../core/accountFiles');   // folder akun dulu, lalu file lama
      const legacyShowcase = path.resolve(DATA_ROOT, 'storage', `showcase_${targetUser}.json`);
      const accountShowcaseFile = af.readPath(legacyShowcase);
      const fallbackFile = af.readPath(path.resolve(DATA_ROOT, 'sessions', `showcase_${targetUser}.json`));

      // 1. Cek berkas cache spesifik milik akun aktif ini
      let resolvedFile = null;
      if (fs.existsSync(accountShowcaseFile)) resolvedFile = accountShowcaseFile;
      else if (fs.existsSync(fallbackFile)) resolvedFile = fallbackFile;

      if (resolvedFile && !forceRefresh) {
        const cached = JSON.parse(fs.readFileSync(resolvedFile, 'utf-8'));
        return { success: true, account: targetUser, data: Array.isArray(cached) ? cached : (cached.products || []) };
      }

      // 2. Jika forceRefresh atau file belum ada, coba baca dari modul showcaseSession
      if (typeof tiktokSessionManager.getShowcaseProductsForAccount === 'function') {
        const fresh = await tiktokSessionManager.getShowcaseProductsForAccount(targetUser, forceRefresh);
        if (fresh && fresh.success && Array.isArray(fresh.data)) {
          fs.writeFileSync(af.writePath(legacyShowcase), JSON.stringify(fresh.data, null, 2), 'utf-8');
          return { success: true, account: targetUser, data: fresh.data };
        }
      }

      // 3. Jika belum pernah disinkronkan, kembalikan data kosong untuk akun ini (bukan akun lain)
      return { success: true, account: targetUser, data: [] };
    } catch (err) {
      console.warn('[ShowcaseIPC] Gagal memuat produk showcase:', err.message);
      return { success: false, error: err.message, data: [] };
    }
  });

  safeHandle('get-showcase-metrics-store', async (event, explicitAccount = null) => {
    try {
      const targetUser = cleanUserIdentifier(explicitAccount || getActiveTikTokUsername());
      const metricsFile = require('../core/accountFiles').readPath(path.resolve(DATA_ROOT, 'storage', `showcase_metrics_${targetUser}.json`));
      if (fs.existsSync(metricsFile)) {
        return JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
      }
      return {};
    } catch (e) {
      return {};
    }
  });

  safeHandle('save-showcase-metrics-store', async (event, metricsObj, explicitAccount = null) => {
    try {
      const targetUser = cleanUserIdentifier(explicitAccount || getActiveTikTokUsername());
      const metricsFile = require('../core/accountFiles').writePath(path.resolve(DATA_ROOT, 'storage', `showcase_metrics_${targetUser}.json`));
      fs.writeFileSync(metricsFile, JSON.stringify(metricsObj || {}, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ==========================================
  // IPC HANDLER PEMBARUAN SISTEM (GAME POPUP)
  // ==========================================
  safeHandle('updater:check-for-updates', async () => {
    try {
      console.log('[AutoUpdater] Menerima permintaan pengecekan update dari UI...');
      if (app.isPackaged) {
        return await autoUpdater.checkForUpdates();
      } else {
        console.log('[AutoUpdater] Melewati pengecekan update otomatis (mode development).');
        return { skipped: true, reason: 'development-mode' };
      }
    } catch (err) {
      console.warn('[AutoUpdater] Gagal saat memeriksa update manual:', err.message);
      return { success: false, error: err.message };
    }
  });

  safeHandle('updater:start-download', async () => {
    try {
      console.log('[AutoUpdater] Memulai proses unduh pembaruan...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      console.error('[AutoUpdater] Gagal mengunduh pembaruan:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('updater:quit-and-install', async () => {
    isAppExiting = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await sendOfflinePingAsync();
    clearKalodataStorageOnExit();
    autoUpdater.quitAndInstall(true, true);
    return { success: true };
  });

  safeHandle('license:get-machine-id', async () => {
    return getHardwareId();
  });

  safeHandle('license:activate', async (event, licenseKey) => {
    const hwid = getHardwareId();
    const result = await verifyLicenseWithServer(licenseKey, hwid);
    
    if (result && result.valid) {
      startLicenseHeartbeat(licenseKey);
      saveLicenseKey(licenseKey);
    } else if (result && !result.networkError) {
      // Server menolak key (salah / dicabut) → jangan dikunci lagi
      result.wrongKey = true;
      if (loadSavedLicenseKey() === licenseKey) clearSavedLicenseKey();
    }
    
    return result;
  });

  safeHandle('license:get-saved', async () => loadSavedLicenseKey());

  safeHandle('license:clear-saved', async () => {
    clearSavedLicenseKey();
    return true;
  });

  safeHandle('license:redirect-main', async () => {
    if (mainWindow) {
      // Langsung ke dashboard akun terakhir (halaman pilih akun hanya bila belum ada akun)
      let active = null;
      try {
        const reg = sessionManager.getAccountsRegistry();
        const list = reg?.accounts || [];
        const pick = list.find((a) => a.id === reg.activeAccountId) || list[0];
        if (pick) active = sessionManager.setActiveAccount(pick.id);
        if (active?.partition) {
          setupPartitionHeaders(active.partition);
          await sessionManager.restoreSessionToPartition(active.partition).catch(() => {});
        }
      } catch (e) {
        console.warn('[Startup] Gagal memilih akun terakhir:', e.message);
      }
      // Selalu ke dashboard (beranda). Belum ada akun → tambah lewat menu Kelola Akun.
      mainWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));
    }
    return { success: true };
  });

  safeHandle('open-external-url', async (event, url) => {
    if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'URL tidak valid' };
  });

  safeHandle('tiktok:sync-profile', async (event, accountId) => {
    try {
      if (!accountId) {
        return { success: false, error: 'ID Akun tidak ditemukan' };
      }
      const result = await tiktokSessionManager.syncTikTokProfile(accountId);
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
      if (!accountId) {
        return { success: false, error: 'ID Akun tidak ditemukan' };
      }
      const result = await tiktokSessionManager.syncTikTokProfile(accountId);
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
    const STORYBOARDS_DIR = path.resolve(DATA_ROOT, 'storage/storyboards');
    const STORAGE_IMG_DIR = path.resolve(DATA_ROOT, 'storage/images');

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

  createMainWindow();
  trayManager.createSystemTray(() => mainWindow, async () => {
    if (!isAppExiting) {
      isAppExiting = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await sendOfflinePingAsync();
      clearKalodataStorageOnExit();
      app.exit(0);
    }
  });

  setInterval(() => {
    scheduleRunner.processPendingSchedulesQueue(mainWindow, (title, body, ok) => {
      trayManager.showDesktopNotification(title, body, ok, focusMainWindow);
    });
  }, 10000);
});

app.on('before-quit', async (event) => {
  if (!isAppExiting) {
    event.preventDefault();
    isAppExiting = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await sendOfflinePingAsync();
    clearKalodataStorageOnExit();
    app.exit(0);
  }
});

app.on('window-all-closed', async () => {
  if (!isAppExiting) {
    isAppExiting = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await sendOfflinePingAsync();
    clearKalodataStorageOnExit();
    if (process.platform !== 'darwin') {
      app.exit(0);
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  else if (mainWindow) focusMainWindow();
});