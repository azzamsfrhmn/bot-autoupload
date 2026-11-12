const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // true saat dijalankan lewat `npm start` (electron .), false di versi terinstal → fitur uji coba hanya tampil di dev
  // (preload ber-sandbox tidak selalu punya process.defaultApp → cek juga nama exe: electron.exe = dev)
  isDevMode: Boolean(process.defaultApp) || /[\\/]electron(\.exe)?$/i.test(process.execPath || ''),
  // 3D Edukasi: ide topik otomatis dari AI
  suggestEdu3DTopic: () => ipcRenderer.invoke('edu3d-suggest-topic'),
  // 3D Kartun: API key milik pelanggan (Claude opsional, ElevenLabs wajib)
  getKartunKeys: () => ipcRenderer.invoke('kartun3d-get-keys'),
  saveKartunKeys: (patch) => ipcRenderer.invoke('kartun3d-save-keys', patch),
  testKartunKeys: () => ipcRenderer.invoke('kartun3d-test-keys'),
  getKartunPrompt: (kind) => ipcRenderer.invoke('kartun3d-get-prompt', kind),
  testKartunVoice: (voice) => ipcRenderer.invoke('kartun3d-test-voice', voice),
  validateKartunJson: (text) => ipcRenderer.invoke('kartun3d-validate-json', text),
  // 3D Edukasi: karakter ciri khas (disimpan sekali, dipakai di semua video)
  getEdu3DCharacter: () => ipcRenderer.invoke('edu3d-get-character'),
  selectEdu3DCharacter: () => ipcRenderer.invoke('edu3d-select-character'),
  clearEdu3DCharacter: () => ipcRenderer.invoke('edu3d-clear-character'),
  // Sistem Lisensi & Validasi Perangkat (HWID)
  getMachineId: () => ipcRenderer.invoke('license:get-machine-id'),
  activateLicense: (licenseKey) => ipcRenderer.invoke('license:activate', licenseKey),
  getSavedLicense: () => ipcRenderer.invoke('license:get-saved'),
  getPerfProfile: () => ipcRenderer.invoke('perf:get'),
  getRemoteUploadConfig: () => ipcRenderer.invoke('remote-upload:get-config'),
  setRemoteUploadConfig: (patch) => ipcRenderer.invoke('remote-upload:set-config', patch),
  syncRemoteSchedules: () => ipcRenderer.invoke('remote-upload:sync'),
  setPerfMode: (mode) => ipcRenderer.invoke('perf:set-mode', mode),
  clearSavedLicense: () => ipcRenderer.invoke('license:clear-saved'),
  verifyAndSaveLicense: (licenseKey) => ipcRenderer.invoke('license:activate', licenseKey), // Alias kompatibilitas
  redirectMain: () => ipcRenderer.invoke('license:redirect-main'),
  licenseSuccessRedirect: () => ipcRenderer.invoke('license:redirect-main'), // Alias kompatibilitas
  getCurrentPlan: () => ipcRenderer.invoke('license:get-current-plan'),

  // Fallback Invoke & Send IPC Umum
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },

  // Kontrol Jendela Kustom (Custom Title Bar)
  minimizeWindow: () => {
    ipcRenderer.send('window-minimize');
    ipcRenderer.send('window:minimize');
  },
  maximizeWindow: () => {
    ipcRenderer.send('window-maximize');
    ipcRenderer.send('window:maximize');
  },
  closeWindow: () => {
    ipcRenderer.send('window-close');
    ipcRenderer.send('window:close');
  },

  // Fitur Pembaruan Sistem Otomatis (Game Style Popup)
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
  startUpdateDownload: () => ipcRenderer.invoke('updater:start-download'),
  installUpdateNow: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('updater:available');
    ipcRenderer.on('updater:available', (_event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.removeAllListeners('updater:not-available');
    ipcRenderer.on('updater:not-available', () => callback());
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('updater:download-progress');
    ipcRenderer.on('updater:download-progress', (_event, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('updater:downloaded');
    ipcRenderer.on('updater:downloaded', (_event, data) => callback(data));
  },
  onUpdateError: (callback) => {
    ipcRenderer.removeAllListeners('updater:error');
    ipcRenderer.on('updater:error', (_event, message) => callback(message));
  },

  // Multi-Akun & Platform (Instagram & TikTok)
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts'),
  switchActiveAccount: (accountId) => ipcRenderer.invoke('switch-active-account', accountId),
  deleteAccount: (accountId) => ipcRenderer.invoke('delete-account', accountId),
  addNewAccount: () => ipcRenderer.send('add-new-account'),
  addNewTiktokAccount: () => ipcRenderer.send('add-new-tiktok-account'),
  loginTikTokAccount: (accountUsername) => ipcRenderer.invoke('login-tiktok-account', accountUsername),
  loginInstagramAccount: (fbId) => ipcRenderer.invoke('login-instagram-account', fbId),
  loginFacebookAccount: () => ipcRenderer.invoke('login-facebook-account'),
  loginShopeeAccount: () => ipcRenderer.invoke('login-shopee-account'),
  shopeeAdbStatus: () => ipcRenderer.invoke('shopee-adb-status'),
  shopeeAdbInstallTapper: () => ipcRenderer.invoke('shopee-adb-install-tapper'),
  shopeeAdbEnableWifi: () => ipcRenderer.invoke('shopee-adb-enable-wifi'),
  shopeeAdbPair: (hostPort, code) => ipcRenderer.invoke('shopee-adb-pair', hostPort, code),
  shopeeAdbConnect: (hostPort) => ipcRenderer.invoke('shopee-adb-connect', hostPort),
  getFacebookAccounts: () => ipcRenderer.invoke('get-facebook-accounts'),
  deleteFacebookAccount: (id) => ipcRenderer.invoke('delete-facebook-account', id),
  syncFacebookPages: (fbId) => ipcRenderer.invoke('sync-facebook-pages', fbId),
  importInstagramSession: (text) => ipcRenderer.invoke('import-instagram-session', text),
  onInstagramLoginStatus: (callback) => {
    ipcRenderer.removeAllListeners('instagram-login-status');
    ipcRenderer.on('instagram-login-status', (_event, value) => callback(value));
  },
  syncTikTokProfile: (accountId) => ipcRenderer.invoke('tiktok:sync-profile', accountId),
  navigateToDashboard: () => ipcRenderer.send('navigate-to-dashboard'),
  navigateToSelectAccount: () => ipcRenderer.send('navigate-to-select-account'),
  switchPlatform: () => ipcRenderer.send('switch-platform'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  onAccountsUpdated: (callback) => {
    ipcRenderer.removeAllListeners('accounts-updated');
    ipcRenderer.on('accounts-updated', (_event, value) => callback(value));
  },

  // Sesi & Profil Instagram / TikTok
  triggerLogin: () => ipcRenderer.send('trigger-login'),
  getSessionInfo: () => ipcRenderer.invoke('get-session-info'),
  getUserFeed: () => ipcRenderer.invoke('get-user-feed'),
  refreshProfile: (opts) => ipcRenderer.invoke('refresh-profile', opts),
  logout: () => ipcRenderer.invoke('logout'),

  // Showcase Produk TikTok Affiliate (Kalodata & TikTok Shop Streamer)
  getKalodataProducts: () => ipcRenderer.invoke('get-kalodata-products'),
  getTiktokShowcaseProducts: (forceRefresh) => ipcRenderer.invoke('get-tiktok-showcase-products', forceRefresh),
  importKalodataFile: () => ipcRenderer.invoke('import-kalodata-file'),
  saveKalodataRawJson: (payload) => ipcRenderer.invoke('save-kalodata-raw-json', payload),
  fetchKalodataLive: (params) => ipcRenderer.invoke('fetch-kalodata-live', params),
  clearKalodataProducts: () => ipcRenderer.invoke('clear-kalodata-products'),
  onLoadShowcase: (callback) => {
    ipcRenderer.removeAllListeners('load-showcase');
    ipcRenderer.on('load-showcase', () => callback());
  },

  // Simpan & Muat Metrik Analitik Etalase Permanen
  getShowcaseMetricsStore: () => ipcRenderer.invoke('get-showcase-metrics-store'),
  saveShowcaseMetricsStore: (payload) => ipcRenderer.invoke('save-showcase-metrics-store', payload),

  // Penambahan, Penghapusan & Gambar Produk TikTok Shop Streamer
  previewTikTokProductUrl: (productUrl) => ipcRenderer.invoke('preview-tiktok-product-url', productUrl),
  executeAddTikTokProduct: () => ipcRenderer.invoke('execute-add-tiktok-product'),
  removeTikTokShowcaseProduct: (productId) => ipcRenderer.invoke('remove-tiktok-showcase-product', productId),
  getTikTokProductImages: (productId) => ipcRenderer.invoke('get-tiktok-product-images', productId),

  // Jadwal Postingan & File Picker
  selectFiles: () => ipcRenderer.invoke('select-files'),
  schedulePost: (data) => ipcRenderer.invoke('schedule-post', data),
  getSchedules: () => ipcRenderer.invoke('get-schedules'),
  getProductVideoCounts: () => ipcRenderer.invoke('get-product-video-counts'),
  getVideoPostStatus: () => ipcRenderer.invoke('get-video-post-status'),
  deleteSchedule: (id) => ipcRenderer.invoke('delete-schedule', id),
  onSchedulesUpdated: (callback) => {
    ipcRenderer.removeAllListeners('schedules-updated');
    ipcRenderer.on('schedules-updated', (_event, value) => callback(value));
  },

  // Modul Publikasi TikTok (Chrome CDP Web)
  publishTikTokPost: (data) => ipcRenderer.invoke('publish-tiktok-post', data),
  onTikTokProgress: (callback) => {
    ipcRenderer.removeAllListeners('tiktok-publish-progress');
    ipcRenderer.on('tiktok-publish-progress', (_event, value) => callback(value));
  },

  // Caption AI (Gemini)
  generateCaption: (data) => ipcRenderer.invoke('generate-caption', data),

  // Generator & Penampungan Gambar AI (DALL·E 3 / ChatGPT Gambar)
  generateAiImage: (params) => ipcRenderer.invoke('generate-ai-image', params),
  getSavedAiImages: () => ipcRenderer.invoke('get-saved-ai-images'),
  getSavedImages: () => ipcRenderer.invoke('get-saved-ai-images'),
  getStorageImages: () => ipcRenderer.invoke('get-saved-ai-images'),
  deleteAiImage: (id) => ipcRenderer.invoke('delete-ai-image', id),
  openAiImagesFolder: () => ipcRenderer.invoke('open-ai-images-folder'),
  openChatGptLogin: () => ipcRenderer.invoke('open-chatgpt-login'),
  openChatGptWorker2Login: () => ipcRenderer.invoke('open-chatgpt-worker2-login'),
  getChatGptStatus: () => ipcRenderer.invoke('get-chatgpt-status'),

  // Sesi Akun ChatGPT Video (Storyboard Builder)
  openChatGptVideoLogin: () => ipcRenderer.invoke('open-chatgpt-video-login'),
  openChatGptVideoWorker2Login: () => ipcRenderer.invoke('open-chatgpt-video-worker2-login'),

  // Generator & Penampungan Video Reels AI (Storyboard Pipeline)
  generateAiVideo: (params) => ipcRenderer.invoke('generate-ai-video', params),
  // Batalkan semua proses pembuatan video yang sedang berjalan (semua konsep, termasuk render Remotion)
  cancelAiVideo: () => ipcRenderer.invoke('cancel-ai-video'),
  // Konsep Remotion
  remotionGenerateScript: (payload) => ipcRenderer.invoke('remotion-generate-script', payload),
  remotionSelectMedia: (kind) => ipcRenderer.invoke('remotion-select-media', kind),
  remotionRender: (payload) => ipcRenderer.invoke('remotion-render', payload),
  getSavedVideos: () => ipcRenderer.invoke('get-saved-videos'),
  getGeneratedVideos: () => ipcRenderer.invoke('get-generated-videos'),
  openVideoFolder: () => ipcRenderer.invoke('open-video-folder'),
  openStoryboardFolder: () => ipcRenderer.invoke('open-storyboard-folder'),
  openBahanVideoFolder: (folderPath) => ipcRenderer.invoke('open-bahan-folder', folderPath),

  // Otomasi Template CapCut Web (Playwright JJ Builder)
  runCapCutTemplate: (params) => ipcRenderer.invoke('run-capcut-template', params),
  openCapCutLoginSession: () => ipcRenderer.invoke('open-capcut-login-session'),

  // Pipeline Terintegrasi: Google Flow -> CapCut JJ
  runCombinedFlowCapcut: (params) => ipcRenderer.invoke('run-combined-flow-capcut', params),
  runFlowToJJFromStoryboard: (params) => ipcRenderer.invoke('run-flow-to-jj-from-storyboard', params),

  // Auto Pilot Video Pipeline (End-to-End 1-Klik)
  runAutoPilotVideo: (params) => ipcRenderer.invoke('run-autopilot-video-pipeline', params),
  onAutoPilotVideoProgress: (callback) => {
    ipcRenderer.removeAllListeners('autopilot-video-progress');
    ipcRenderer.on('autopilot-video-progress', (_event, value) => callback(value));
  },

  // Hapus Berkas Storyboard Frame & Video Jadi
  deleteStoryboardFrame: (filePath) => ipcRenderer.invoke('delete-storyboard-frame', filePath),
  deleteSavedVideo: (videoData) => ipcRenderer.invoke('delete-saved-video', videoData),
  deleteVideo: (videoData) => ipcRenderer.invoke('delete-video', videoData),

  // Modul Google Flow Video Creator (Multi-Akun & Rotasi Kredit)
  getFlowAccounts: () => ipcRenderer.invoke('get-flow-accounts'),
  addFlowAccount: () => ipcRenderer.invoke('add-flow-account'),
  deleteFlowAccount: (accountId) => ipcRenderer.invoke('delete-flow-account', accountId),
  openFlowLogin: (accountId) => ipcRenderer.invoke('open-flow-login', accountId),
  openFlowW2Login: (accountId) => ipcRenderer.invoke('open-flow-w2-login', accountId),
  syncFlowAccountCredits: (accountId) => ipcRenderer.invoke('sync-flow-account-credits', accountId),
  autoSyncFlowCredits: () => ipcRenderer.invoke('auto-sync-flow-credits'),
  runFlowProject: (params) => ipcRenderer.invoke('run-flow-project', params),
  runTikTokFlowDirect: (params) => ipcRenderer.invoke('run-tiktok-flow-direct', params),
  onFlowAccountsUpdated: (callback) => {
    ipcRenderer.removeAllListeners('flow-accounts-updated');
    ipcRenderer.on('flow-accounts-updated', () => callback());
  },
  
  // Riwayat Storyboard & Video Prompts Otomatis
  getStoryboardHistory: () => ipcRenderer.invoke('get-storyboard-history'),

  // Listener Progres Video & Alur Storyboard/Flow/JJ
  onVideoGenProgress: (callback) => {
    ipcRenderer.on('video-gen-progress', (_event, value) => callback(value));
  },

  // Listener Pembaruan Galeri Otomatis
  onRefreshVideoGallery: (callback) => {
    ipcRenderer.removeAllListeners('refresh-video-gallery');
    ipcRenderer.on('refresh-video-gallery', (_event, value) => callback(value));
  },
  onFlowVideoSaved: (callback) => {
    ipcRenderer.removeAllListeners('flow-video-saved');
    ipcRenderer.on('flow-video-saved', (_event, value) => callback(value));
  },
  onRefreshImagesGallery: (callback) => {
    ipcRenderer.removeAllListeners('refresh-images-gallery');
    ipcRenderer.on('refresh-images-gallery', (_event, value) => callback(value));
  },
  onRefreshStoryboardGallery: (callback) => {
    ipcRenderer.removeAllListeners('refresh-storyboard-gallery');
    ipcRenderer.on('refresh-storyboard-gallery', (_event, value) => callback(value));
  },

  // Sesi & Akun Pinterest (Scraper Karakter)
  getPinterestStatus: () => ipcRenderer.invoke('get-pinterest-status'),
  loginPinterest: () => ipcRenderer.invoke('login-pinterest'),

  // Sesi TikTok Shop Streamer Desktop
  getTikTokStreamerStatus: () => ipcRenderer.invoke('get-tiktok-streamer-status'),
  getTikTokShopStatus: () => ipcRenderer.invoke('get-tiktokshop-status'),
  loginTikTokStreamer: () => ipcRenderer.invoke('login-tiktok-streamer'),

  // Utilitas Pembaca Berkas & Clipboard
  readImageAsBase64: (filePath) => ipcRenderer.invoke('read-image-as-base64', filePath),
  copyImageToClipboard: (filePath) => ipcRenderer.invoke('copy-image-to-clipboard', filePath),
  pasteImageFromClipboard: () => ipcRenderer.invoke('paste-image-from-clipboard'),

  // Handler Pengaturan & Status AI
  getAiConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (data) => ipcRenderer.invoke('save-ai-config', data),
  testAiConnection: (apiKey) => ipcRenderer.invoke('test-ai-connection', apiKey),

  // Event Listeners IPC
  onUploadStatus: (callback) => {
    ipcRenderer.removeAllListeners('upload-status');
    ipcRenderer.on('upload-status', (_event, value) => callback(value));
  },
  onProfileUpdated: (callback) => {
    ipcRenderer.removeAllListeners('profile-updated');
    ipcRenderer.on('profile-updated', (_event, value) => callback(value));
  }
});