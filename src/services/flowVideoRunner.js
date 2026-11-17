/**
 * src/services/flowVideoRunner.js
 * Arsitektur Pure Raw CDP (Zero DOM Injection)
 * - Pengecekan Kredit Awal Ketat (Batas Minimum: 10 Kredit)
 * - Otomatis Rotasi ke Akun Cadangan jika Kredit < 10
 * - Blokir render jika akun cadangan belum login / kuota seluruh akun habis
 * - Copy-Paste Prompt Instan via Clipboard (Ctrl+V)
 * - Pemilihan Akurat: Jenis (Bahan/Frame), Rasio (9:16), Model (Omni/Veo), Resolusi (360p/720p), Durasi, & Output x1
 * - Verifikasi fisik berkas video (> 50 KB) sebelum memotong kredit
 * - Auto-Decrement Saldo Kredit (-10 Kredit) & Sinkronisasi UI Otomatis
 * - Multi-Strategy Video Downloader (Stream Blob Fetch + Network Sniffer + UI Download)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { dismissFlowOnboarding, disableFlowAgent, agreeFlowImageRights } = require('./flowOnboarding');
const os = require('os');
const http = require('http');
const https = require('https');
const { BrowserWindow, clipboard, nativeImage } = require('electron');
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../core/perfProfile');
const { flowUnusualActivityMessage } = require('../core/flowWorkerPool');

const ROOT_DIR = process.cwd();
const FLOW_BASE_DIR = path.resolve(ROOT_DIR, 'sessions/flow_profiles');
const FLOW_CONFIG_FILE = path.resolve(FLOW_BASE_DIR, 'accounts_config.json');
// Google Flow butuh minimal 12 kredit untuk 1 kali render video
const MIN_FLOW_CREDIT = 12;

const SESSIONS_VIDEOS_DIR = path.resolve(ROOT_DIR, 'sessions/generated_videos');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const SESSIONS_IMG_DIR = path.resolve(ROOT_DIR, 'sessions/generated_images');
const SESSIONS_IMG_JSON = path.resolve(ROOT_DIR, 'sessions/generated_images/metadata.json');

if (!fs.existsSync(FLOW_BASE_DIR)) fs.mkdirSync(FLOW_BASE_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_VIDEOS_DIR)) fs.mkdirSync(SESSIONS_VIDEOS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_VIDEOS_DIR)) fs.mkdirSync(OUTPUT_VIDEOS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

async function humanDelay(min = 420, max = 650) {
  await sleep(Math.floor(min + Math.random() * (max - min)));
}

// =========================================================================
// ANTRIAN SLOT CHROME (1 DARI 1) + COOLDOWN
// =========================================================================
let isGenerateSlotBusy = false;
const slotWaitQueue = [];

async function acquireGenerateSlot(onProgress) {
  if (!isGenerateSlotBusy) {
    isGenerateSlotBusy = true;
    onProgress(`[ANTRIAN] Slot generate siap (1 dari 1).`);
    return;
  }
  onProgress(`[ANTRIAN] Menunggu slot generate kosong...`);
  await new Promise((resolve) => slotWaitQueue.push(resolve));
  isGenerateSlotBusy = true;
  onProgress(`[ANTRIAN] Slot generate siap (1 dari 1).`);
}

async function releaseGenerateSlot(onProgress) {
  onProgress(`[ANTRIAN] Menahan jeda finalisasi (4.3 dtk)...`);
  await sleep(4300);
  isGenerateSlotBusy = false;
  onProgress(`[ANTRIAN] Slot generate dilepas.`);
  if (slotWaitQueue.length > 0) {
    const next = slotWaitQueue.shift();
    if (typeof next === 'function') next();
  }
}

// =========================================================================
// KLIEN RAW CDP RINGAN
// =========================================================================
class RawCDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const WS = global.WebSocket || require('ws');
      this.ws = new WS(this.wsUrl);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => {
        for (const [, p] of this.pending) {
          p.reject(new Error('Koneksi CDP tertutup.'));
        }
        this.pending.clear();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (data.id && this.pending.has(data.id)) {
            const { resolve: res, reject: rej } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) rej(new Error(data.error.message));
            else res(data.result);
          } else if (data.method && this.listeners.has(data.method)) {
            const handlers = this.listeners.get(data.method);
            handlers.forEach((fn) => fn(data.params));
          }
        } catch (e) {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(eventMethod, callback) {
    if (!this.listeners.has(eventMethod)) this.listeners.set(eventMethod, []);
    this.listeners.get(eventMethod).push(callback);
  }

  close() {
    try {
      if (this.ws) this.ws.close();
    } catch (e) {}
  }

  async findElementCenter(queryOptions) {
    const expression = `
      (() => {
        try {
          const { selector, textRegexStr, pickLast, minY, maxY } = ${JSON.stringify(queryOptions)};
          const querySel = selector || 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], mat-button-toggle, span, div';
          const els = Array.from(document.querySelectorAll(querySel));
          const regex = textRegexStr ? new RegExp(textRegexStr, 'i') : null;

          const matched = els.filter(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 8 || rect.height < 8 || rect.width > 950 || rect.height > 600) return false;
            if (typeof minY === 'number' && rect.top < minY) return false;
            if (typeof maxY === 'number' && rect.bottom > maxY) return false;

            if (!regex) return true;

            const aria = (el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim();
            const txt = (el.innerText || el.textContent || '').trim();

            if (txt.length > 95 && !regex.test(aria)) return false;

            return regex.test(txt) || regex.test(aria);
          });

          if (matched.length === 0) return null;

          let target = pickLast ? matched[matched.length - 1] : matched[0];

          if (regex && matched.length > 1 && !pickLast) {
            matched.sort((a, b) => {
              const rA = a.getBoundingClientRect();
              const rB = b.getBoundingClientRect();
              return (rA.width * rA.height) - (rB.width * rB.height);
            });
            target = matched[0];
          }

          target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          const r = target.getBoundingClientRect();
          return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
        } catch (e) {
          return null;
        }
      })()
    `;
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false
    }).catch(() => null);
    return res?.result?.value || null;
  }

  async waitForElementCenter(queryOptions, timeoutMs = 20000) {
    timeoutMs = scaleMs(timeoutMs);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const pos = await this.findElementCenter(queryOptions);
      if (pos) return pos;
      await sleep(450);
    }
    return null;
  }

  async nativeClickAt(x, y, delayAfter = 520) {
    const jitterX = x + Math.floor(Math.random() * 5 - 2);
    const jitterY = y + Math.floor(Math.random() * 5 - 2);

    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: jitterX,
      y: jitterY
    });
    await sleep(110 + Math.floor(Math.random() * 90));

    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: jitterX,
      y: jitterY,
      button: 'left',
      clickCount: 1
    });
    await sleep(60 + Math.floor(Math.random() * 50));

    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: jitterX,
      y: jitterY,
      button: 'left',
      clickCount: 1
    });

    await sleep(delayAfter + Math.floor(Math.random() * 140));
  }

  async nativeDragAndDrop(startX, startY, endX, endY) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY });
    await sleep(250);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
    await sleep(350);

    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(startX + ((endX - startX) * i) / steps);
      const curY = Math.round(startY + ((endY - startY) * i) / steps);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY, button: 'left' });
      await sleep(22);
    }

    await sleep(350);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left', clickCount: 1 });
    await sleep(1200);
  }

  async sendCtrlV() {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      modifiers: 2
    });
    await sleep(65);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      modifiers: 2
    });
  }

  async pressKey(key, windowsVirtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode
    });
    await sleep(50);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode
    });
  }

  async setNativeFileInput(filePath) {
    try {
      const doc = await this.send('DOM.getDocument', { depth: -1 });
      const rootNodeId = doc?.root?.nodeId;
      if (!rootNodeId) return false;

      const query = await this.send('DOM.querySelector', {
        nodeId: rootNodeId,
        selector: 'input[type="file"]'
      });

      if (query?.nodeId) {
        await this.send('DOM.setFileInputFiles', {
          nodeId: query.nodeId,
          files: [filePath]
        });
        return true;
      }
    } catch (e) {}
    return false;
  }
}

function getOriginalChromeExecutablePath() {
  const platform = os.platform();
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }

  for (const binPath of candidates) {
    if (fs.existsSync(binPath)) return binPath;
  }
  return undefined;
}

function purgeTransientSessionData(profileDir) {
  if (!fs.existsSync(profileDir)) return;
  const targetFiles = [
    path.join(profileDir, 'SingletonLock'),
    path.join(profileDir, 'SingletonCookie'),
    path.join(profileDir, 'SingletonSocket')
  ];
  for (const file of targetFiles) {
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (e) {}
    }
  }

  const prefPath = path.join(profileDir, 'Default', 'Preferences');
  if (fs.existsSync(prefPath)) {
    try {
      let prefContent = fs.readFileSync(prefPath, 'utf-8');
      if (prefContent.includes('"exit_type":"Crashed"') || prefContent.includes('"exited_cleanly":false')) {
        prefContent = prefContent
          .replace(/"exit_type"\s*:\s*"Crashed"/g, '"exit_type":"Normal"')
          .replace(/"exited_cleanly"\s*:\s*false/g, '"exited_cleanly":true');
        fs.writeFileSync(prefPath, prefContent, 'utf-8');
      }
    } catch (e) {}
  }
}

function getFlowChromeArgs(cdpPort, profileDir) {
  return [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--window-size=1220,920',
    '--window-position=40,30',
    'https://flow.google.com/'
  ];
}

async function getPageWebSocketUrl(port, maxRetries = 25) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const tabs = await res.json();
        const pageTab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTab) return pageTab.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(450);
  }
  return null;
}

function parseGoogleFlowCreditResponse(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return '';
  try {
    const nzlxgMatch = bodyText.match(/"nzlxg"\s*,\s*"\\?\[\s*(\d+)/) || bodyText.match(/nzlxg.*?(\d{1,6})/i);
    if (nzlxgMatch && nzlxgMatch[1]) {
      return `${nzlxgMatch[1]} Kredit`;
    }

    const jsonMatch = bodyText.match(/"(?:credits?|balance|remaining_credits|available_credits)"\s*:\s*(\d+)/i) ||
                      bodyText.match(/(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(?:kredit|credits)/i);
    if (jsonMatch && jsonMatch[1]) {
      return `${String(jsonMatch[1]).replace(/[.,]/g, '')} Kredit`;
    }
  } catch (e) {}
  return '';
}

function notifyUIFlowAccountsUpdated() {
  try {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('flow-accounts-updated');
      }
    });
  } catch (e) {}
}

function registerVideoToMetadata(videoFileName, sessionPath, storagePath, promptText, storyboardSourceFile) {
  const baseName = path.basename(videoFileName, path.extname(videoFileName));
  const timestamp = Date.now();

  let thumbnailSessionPath = '';
  let thumbnailStoragePath = '';

  if (storyboardSourceFile && fs.existsSync(storyboardSourceFile)) {
    thumbnailSessionPath = path.join(SESSIONS_VIDEOS_DIR, `${baseName}_thumb.png`);
    thumbnailStoragePath = path.join(OUTPUT_VIDEOS_DIR, `${baseName}_thumb.png`);
    try {
      fs.copyFileSync(storyboardSourceFile, thumbnailSessionPath);
      fs.copyFileSync(storyboardSourceFile, thumbnailStoragePath);
    } catch (e) {}
  }

  const videoData = {
    id: `vid_${timestamp}`,
    fileName: videoFileName,
    name: videoFileName,
    filePath: sessionPath,
    sessionPath: sessionPath,
    storagePath: storagePath,
    thumbnailPath: thumbnailSessionPath || thumbnailStoragePath || '',
    poster: thumbnailSessionPath || thumbnailStoragePath || '',
    previewUrl: sessionPath,
    url: sessionPath,
    prompt: promptText || '',
    type: 'video',
    status: 'ready',
    createdAt: new Date().toISOString(),
    timestamp: timestamp
  };

  const targets = [
    path.join(SESSIONS_VIDEOS_DIR, 'metadata.json'),
    path.join(OUTPUT_VIDEOS_DIR, 'metadata.json'),
    path.join(ROOT_DIR, 'storage', 'videos_metadata.json'),
    path.join(ROOT_DIR, 'sessions', 'videos_metadata.json')
  ];

  targets.forEach((metaFile) => {
    try {
      const dir = path.dirname(metaFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let list = [];
      if (fs.existsSync(metaFile)) {
        try {
          list = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
          if (!Array.isArray(list)) list = [];
        } catch (parseErr) {
          list = [];
        }
      }
      list.unshift(videoData);
      fs.writeFileSync(metaFile, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {}
  });

  try {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('flow-video-saved', videoData);
        win.webContents.send('refresh-video-gallery', videoData);
      }
    });
  } catch (ipcErr) {}

  return videoData;
}

const lastSessionState = new Map();
function checkAccountHasRealSession(accountId) {
  try {
    const profileDir = path.join(FLOW_BASE_DIR, accountId);
    if (!fs.existsSync(profileDir)) return false;
    const defaultDir = path.join(profileDir, 'Default');
    if (!fs.existsSync(defaultDir)) return false;

    const networkCookies = path.join(defaultDir, 'Network', 'Cookies');
    const directCookies = path.join(defaultDir, 'Cookies');
    const targetCookieFile = fs.existsSync(networkCookies) ? networkCookies : (fs.existsSync(directCookies) ? directCookies : null);
    if (!targetCookieFile) return false;

    // Login Google = ada cookie sesi akun (nama cookie tersimpan polos di database SQLite Chrome).
    // Ukuran file saja tidak cukup: membuka flow.google.com tanpa login juga membuat cookie.
    // Sesaat setelah Chrome ditutup file terkunci (EBUSY) → coba ulang, lalu pakai hasil terakhir.
    let buf = null;
    for (let i = 0; i < 4 && !buf; i++) {
      try { buf = fs.readFileSync(targetCookieFile); } catch (e) {
        const t = Date.now(); while (Date.now() - t < 250) { /* tunggu kunci file lepas */ }
      }
    }
    if (!buf) return lastSessionState.get(accountId) ?? true;
    const loggedIn = buf.includes('__Secure-1PSID') || buf.includes('SAPISID');
    lastSessionState.set(accountId, loggedIn);
    return loggedIn;
  } catch (e) {
    return false;
  }
}

function getFlowAccountsConfigRaw() {
  let cfg = null;
  if (fs.existsSync(FLOW_CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(FLOW_CONFIG_FILE, 'utf-8')); } catch (e) {}
  }
  if (!cfg || !Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
    cfg = {
      activeAccountId: 'acc_1',
      accounts: [
        { id: 'acc_1', name: 'Akun 1 (Utama)', status: 'Belum Login', credits: 'Tidak Tersedia', email: '' }
      ]
    };
  }
  // Pastikan sakelar headless selalu tersimpan eksplisit (default: aktif / senyap)
  if (typeof cfg.headless !== 'boolean') cfg.headless = true;
  return cfg;
}

function getFlowAccountsConfig() {
  const cfg = getFlowAccountsConfigRaw();
  try {
    cfg.accounts.forEach((acc) => {
      const hasRealSession = checkAccountHasRealSession(acc.id);
      acc.hasW2 = false;
      if (hasRealSession) {
        acc.status = 'Sesi Aktif';
        if (!acc.credits || acc.credits === 'Tidak Tersedia') {
          acc.credits = 'Belum dicek';
        }
      } else {
        acc.status = 'Belum Login';
        acc.credits = 'Tidak Tersedia';
        delete acc.creditsCheckedAt;
      }
    });
    saveFlowAccountsConfig(cfg);
  } catch (err) {}
  return cfg;
}

function saveFlowAccountsConfig(cfg) {
  fs.writeFileSync(FLOW_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  notifyUIFlowAccountsUpdated();
}

function getProfileDirForAccount(accountId) {
  const dir = path.join(FLOW_BASE_DIR, accountId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deleteFlowAccount(accountId) {
  const cfg = getFlowAccountsConfigRaw();
  cfg.accounts = (cfg.accounts || []).filter((a) => a.id !== accountId);
  // Nomori ulang: akun pertama yang tersisa otomatis menjadi Akun 1 (Utama)
  cfg.accounts.forEach((a, i) => {
    a.name = i === 0 ? 'Akun 1 (Utama)' : `Akun ${i + 1}`;
  });

  if (cfg.activeAccountId === accountId) {
    cfg.activeAccountId = cfg.accounts[0]?.id || null;
  }

  saveFlowAccountsConfig(cfg);

  const targetDir = path.join(FLOW_BASE_DIR, accountId);
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }

  notifyUIFlowAccountsUpdated();
  return { success: true, cfg };
}

async function openFlowLoginWindow(accountId = 'acc_1') {
  const profileDir = getProfileDirForAccount(accountId);
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath) return { success: false, error: 'Google Chrome asli tidak ditemukan.' };

  purgeTransientSessionData(profileDir);
  const randomPort = 51000 + Math.floor(Math.random() * 12000);

  const chromeProcess = spawn(
    chromePath,
    getFlowChromeArgs(randomPort, profileDir),
    { detached: false, stdio: 'ignore' }
  );

  // Selama jendela login terbuka: Chrome menulis cookie login ke disk beberapa detik setelah login,
  // jadi cek berkala & perbarui kartu akun begitu sesi terdeteksi (tanpa menunggu jendela ditutup)
  const sessionWatcher = setInterval(() => {
    if (!checkAccountHasRealSession(accountId)) return;
    const cfg = getFlowAccountsConfigRaw();
    const acc = cfg.accounts.find((a) => a.id === accountId);
    if (acc && acc.status !== 'Sesi Aktif') {
      acc.status = 'Sesi Aktif';
      if (!/\d/.test(String(acc.credits || ''))) acc.credits = 'Belum dicek';
      saveFlowAccountsConfig(cfg);
    }
  }, 10000);

  return new Promise((resolve) => {
    chromeProcess.on('close', async () => {
      clearInterval(sessionWatcher);
      const hasSession = checkAccountHasRealSession(accountId);
      const cfg = getFlowAccountsConfigRaw();
      const acc = cfg.accounts.find((a) => a.id === accountId);
      if (acc) {
        acc.status = hasSession ? 'Sesi Aktif' : 'Belum Login';
        cfg.activeAccountId = accountId;
        saveFlowAccountsConfig(cfg);
      }
      // Baca kredit asli dari Flow (bukan asumsi 50 kredit)
      const realCredit = hasSession ? await silentSyncAccountCredits(accountId) : null;
      const accNow = getFlowAccountsConfigRaw().accounts.find((a) => a.id === accountId);
      resolve({ success: true, accountId, status: accNow?.status, credits: realCredit || accNow?.credits });
    });
  });
}

async function openFlowWorker2LoginWindow(accountId = 'acc_1') {
  return openFlowLoginWindow(accountId);
}

// =========================================================================
// PENGECEKAN KREDIT ASLI (DIBACA DARI PANEL AKUN GOOGLE FLOW)
// Teks panel: "0 kredit Google Flow" & "Kredit diperbarui setiap hari pukul 02.44"
// =========================================================================
// Balasan batchexecute Flow (rpcids=nzlxg): )]}' ... [["wrb.fr","nzlxg","[50,3,8,1,null,50,[1793908220,505636000]]",...]]
// → kredit = angka pertama; elemen terakhir = waktu reset kredit berikutnya (detik epoch). Reset harian → simpan jam:menit.
function parseFlowCreditRpc(text) {
  try {
    const m = String(text || '').match(/"nzlxg","((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    const arr = JSON.parse(JSON.parse(`"${m[1]}"`));
    const credit = Number(arr?.[0]);
    if (!Number.isFinite(credit)) return null;
    const resetSec = Number(arr?.[arr.length - 1]?.[0]);
    let resetTime = '';
    if (Number.isFinite(resetSec) && resetSec * 1000 - Date.now() < 26 * 3600 * 1000 && resetSec * 1000 > Date.now()) {
      const d = new Date(resetSec * 1000);
      resetTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return { credit, resetTime };
  } catch (e) {
    return null;
  }
}

async function silentSyncAccountCredits(accountId = 'acc_1') {
  const profileDir = getProfileDirForAccount(accountId);
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath || !fs.existsSync(profileDir)) return null;
  if (!checkAccountHasRealSession(accountId)) return null;

  purgeTransientSessionData(profileDir);

  const randomPort = 55000 + Math.floor(Math.random() * 8000);
  let chromeProcess = null;
  let cdp = null;

  try {
    // Chrome asli dengan jendela di luar layar (--headless sering dijeda/diblokir Google Flow)
    chromeProcess = spawn(chromePath, [...chromeLiteArgs(), 
      `--remote-debugging-port=${randomPort}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--window-size=1280,900',
      '--window-position=-32000,-32000',
      '--mute-audio',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      'about:blank'
    ], { detached: false, stdio: 'ignore' });

    const wsUrl = await getPageWebSocketUrl(randomPort, 20);
    if (!wsUrl) throw new Error('Koneksi port CDP background gagal');

    cdp = new RawCDPClient(wsUrl);
    await cdp.connect();
    await cdp.send('Page.enable');

    // Cara cepat: saat dibuka, halaman Flow sendiri memanggil API kredit (batchexecute rpcids=nzlxg)
    // yang membalas [kredit, ..., [detik_reset, nano]]. Balasan itu ditangkap langsung → tidak perlu klik panel akun.
    let apiInfo = null;
    const pendingReqIds = new Set();
    cdp.on('Network.responseReceived', (params) => {
      if (/rpcids=[^&]*nzlxg/.test(params?.response?.url || '')) pendingReqIds.add(params.requestId);
    });
    cdp.on('Network.loadingFinished', async (params) => {
      if (!pendingReqIds.has(params?.requestId) || apiInfo) return;
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: params.requestId });
        apiInfo = parseFlowCreditRpc(body?.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body?.body);
      } catch (e) {}
    });
    await cdp.send('Network.enable').catch(() => {});
    await cdp.send('Page.navigate', { url: 'https://flow.google.com/' }).catch(() => {});
    for (let i = 0; i < 40 && !apiInfo; i++) await sleep(500);

    const readCreditInfo = async () => {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const txt = document.body ? (document.body.innerText || '') : '';
            // Sumber utama: <span class="credits-count">0 kredit Google Flow</span> di panel akun
            const countEl = document.querySelector('.credits-count');
            const countTxt = countEl ? (countEl.textContent || '').trim() : '';
            const m = countTxt.match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)/) || txt.match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*kredit\\s*Google\\s*Flow/i) || txt.match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*Google\\s*Flow\\s*credits?/i);
            const reset = txt.match(/diperbarui[^\\n]*?pukul\\s*(\\d{1,2})[.:](\\d{2})/i) || txt.match(/refresh[^\\n]*?at\\s*(\\d{1,2}):(\\d{2})/i);
            const exhausted = /kredit google flow anda habis|out of google flow credits/i.test(txt);
            return {
              credit: m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : null,
              resetTime: reset ? reset[1].padStart(2, '0') + ':' + reset[2] : '',
              exhausted
            };
          })()
        `,
        returnByValue: true
      }).catch(() => null);
      return res?.result?.value || {};
    };

    // Buka panel akun (avatar kanan atas) lalu baca teks kredit; ulangi sampai terbaca
    let info = apiInfo ? { credit: apiInfo.credit, resetTime: apiInfo.resetTime } : {};
    let panelClicked = false;
    for (let attempt = 0; attempt < 12 && typeof info.credit !== 'number'; attempt++) {
      await sleep(1500);
      info = await readCreditInfo();
      if (typeof info.credit === 'number') break;

      if (!panelClicked || attempt % 4 === 3) {
        // Popup sambutan akun baru bisa menutupi avatar
        await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), () => {}, sleep);
        // Avatar Flow (tanpa teks) → buka panel akun yang berisi "N kredit Google Flow"
        const avatarPos = await cdp.findElementCenter({ selector: 'flow-header-user-icon [role="button"], flow-header-user-icon' })
          || await cdp.findElementCenter({
            selector: 'header button, header a, header img, button[aria-label*="Google"], button[aria-label*="Akun"]',
            textRegexStr: '@|Akun Google|Google Account|Profil|Kredit'
          });
        if (avatarPos) {
          await cdp.nativeClickAt(avatarPos.x, avatarPos.y, 1200);
          panelClicked = true;
        }
      }
    }

    let creditNum = typeof info.credit === 'number' ? info.credit : null;
    if (creditNum === null && info.exhausted) creditNum = 0;

    const cfg = getFlowAccountsConfigRaw();
    const acc = cfg.accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.status = 'Sesi Aktif';
      if (creditNum !== null) {
        acc.credits = `${creditNum} Kredit`;
        acc.creditsCheckedAt = Date.now();
      }
      if (info.resetTime) acc.creditResetTime = info.resetTime;
      saveFlowAccountsConfig(cfg);
    }

    return creditNum !== null ? `${creditNum} Kredit` : null;
  } catch (err) {
    return null;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      cdp.close();
    }
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill(); } catch (e) {}
    }
  }
}

// Kredit dianggap usang jika belum pernah dicek, atau jam reset harian sudah lewat sejak pengecekan terakhir
function isFlowCreditStale(acc) {
  if (!acc || !acc.creditsCheckedAt) return true;
  // Belum ada angka kredit (mis. baru login ulang) → wajib dicek lagi walau waktu cek terakhir masih baru
  if (!/\d/.test(String(acc.credits || ''))) return true;
  const [hh, mm] = String(acc.creditResetTime || '00:00').split(':').map((n) => parseInt(n, 10) || 0);
  const lastReset = new Date();
  lastReset.setHours(hh, mm, 0, 0);
  if (lastReset.getTime() > Date.now()) lastReset.setDate(lastReset.getDate() - 1);
  return acc.creditsCheckedAt < lastReset.getTime();
}

// Sinkronkan kredit semua akun yang sudah login (berurutan, satu Chrome per akun)
let creditSyncInFlight = null;
function syncAllFlowAccountCredits({ onlyStale = false, onProgress = () => {} } = {}) {
  if (creditSyncInFlight) return creditSyncInFlight;

  creditSyncInFlight = (async () => {
    const cfg = getFlowAccountsConfigRaw();
    const targets = (cfg.accounts || []).filter((acc) => checkAccountHasRealSession(acc.id) && (!onlyStale || isFlowCreditStale(acc)));
    // Dicek 3 akun sekaligus (bukan satu per satu) agar tidak lama saat akun Flow banyak
    const CONCURRENCY = 3;
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        const acc = targets[next++];
        onProgress(`Memeriksa kredit asli ${acc.name} di Google Flow...`);
        const credit = await silentSyncAccountCredits(acc.id);
        onProgress(`Kredit ${acc.name}: ${credit || 'tidak terbaca (memakai data terakhir)'}`);
      }
    });
    await Promise.all(workers);
    notifyUIFlowAccountsUpdated();
    return getFlowAccountsConfigRaw();
  })().finally(() => {
    creditSyncInFlight = null;
  });

  return creditSyncInFlight;
}

// =========================================================================
// HELPER ROTASI & VALIDASI SALDO MULTI-AKUN FLOW (BLOKIR JIKA TIDAK SIAP)
// =========================================================================
function resolveActiveAccountForRender(onProgress = () => {}) {
  const cfg = getFlowAccountsConfigRaw();
  if (!cfg || !Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
    throw new Error('Tidak ada akun Google Flow yang terdaftar di sistem.');
  }

  const getCreditNum = (acc) => {
    if (!acc || acc.status !== 'Sesi Aktif') return 0;
    const match = String(acc.credits || '').replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  let activeIndex = cfg.accounts.findIndex((a) => a.id === cfg.activeAccountId);
  if (activeIndex === -1) activeIndex = 0;

  const currentAcc = cfg.accounts[activeIndex];
  const currentCredit = getCreditNum(currentAcc);

  // Jika akun aktif siap dan memiliki saldo minimal 10 kredit
  if (currentAcc && currentAcc.status === 'Sesi Aktif' && currentCredit >= MIN_FLOW_CREDIT) {
    return { targetAcc: currentAcc, cfg };
  }

  onProgress(`[Pengecekan Kuota] ${currentAcc?.name || 'Akun Aktif'} kredit < ${MIN_FLOW_CREDIT} (${currentCredit} Kredit). Mencari akun cadangan...`);

  // Cari akun cadangan berikutnya yang sudah aktif login dan memiliki kredit cukup
  const readyBackupAcc = cfg.accounts.find((acc) => {
    return acc.id !== currentAcc?.id && acc.status === 'Sesi Aktif' && getCreditNum(acc) >= MIN_FLOW_CREDIT;
  });

  if (readyBackupAcc) {
    onProgress(`[Rotasi Akun] Otomatis beralih ke ${readyBackupAcc.name} (${readyBackupAcc.credits}).`);
    cfg.activeAccountId = readyBackupAcc.id;
    saveFlowAccountsConfig(cfg);
    return { targetAcc: readyBackupAcc, cfg };
  }

  // Cek apakah ada akun cadangan tetapi belum login
  const pendingLoginAcc = cfg.accounts.find((acc) => acc.id !== currentAcc?.id && acc.status !== 'Sesi Aktif');
  if (pendingLoginAcc) {
    throw new Error(`Kredit ${currentAcc ? currentAcc.name : 'Akun Utama'} tersisa < ${MIN_FLOW_CREDIT} (${currentCredit} Kredit) dan ${pendingLoginAcc.name} belum login. Anda tidak bisa membuat video reels sebelum login ke ${pendingLoginAcc.name} di Pengaturan AI.`);
  }

  throw new Error(`Semua akun Google Flow kehabisan kredit (< ${MIN_FLOW_CREDIT}). Anda tidak dapat membuat video reels sampai kuota harian direset besok atau menambahkan akun baru.`);
}

function addFlowAccount() {
  const cfg = getFlowAccountsConfig();
  const nextNum = cfg.accounts.length + 1;
  const newId = `acc_${nextNum}_${Date.now()}`;
  cfg.accounts.push({
    id: newId,
    name: `Akun ${nextNum}`,
    status: 'Belum Login',
    credits: 'Tidak Tersedia',
    email: ''
  });
  saveFlowAccountsConfig(cfg);
  return cfg;
}

function resolveLatestStoryboardAsset(projectFolder, explicitImagePath = null) {
  if (explicitImagePath && fs.existsSync(explicitImagePath)) {
    return explicitImagePath;
  }

  if (projectFolder && fs.existsSync(projectFolder)) {
    const candidates = ['storyboard_canvas.png', 'storyboard.png', '00_banner_produk.png'];
    for (const c of candidates) {
      const full = path.join(projectFolder, c);
      if (fs.existsSync(full)) return full;
    }
  }

  const sbDir = path.resolve(ROOT_DIR, 'storage/storyboards');
  if (fs.existsSync(sbDir)) {
    const files = fs.readdirSync(sbDir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.includes('thumb'))
      .map((f) => path.join(sbDir, f));
    if (files.length > 0) {
      files.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
      return files[0];
    }
  }

  if (fs.existsSync(SESSIONS_IMG_DIR)) {
    const files = fs.readdirSync(SESSIONS_IMG_DIR)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(SESSIONS_IMG_DIR, f));
    if (files.length > 0) {
      files.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
      return files[0];
    }
  }

  return null;
}

function resolveLatestPromptText(explicitText, projectFolder, targetImageFile) {
  if (explicitText && typeof explicitText === 'string' && explicitText.trim().length > 25) {
    return explicitText.trim();
  }

  if (targetImageFile) {
    const baseName = path.basename(targetImageFile, path.extname(targetImageFile));
    const tsMatch = baseName.match(/\d{10,13}/);
    if (tsMatch) {
      const ts = tsMatch[0];
      const candidateFiles = [
        path.resolve(ROOT_DIR, `storage/storyboards/video_prompts_${ts}_w1.txt`),
        path.resolve(ROOT_DIR, `storage/storyboards/video_prompts_${ts}.txt`),
        path.resolve(ROOT_DIR, `sessions/generated_images/prompt_${ts}.txt`),
        path.resolve(ROOT_DIR, `storage/bahan_video/proyek_${ts}_w1/prompt_video.txt`),
        path.resolve(ROOT_DIR, `storage/bahan_video/proyek_${ts}/prompt_video.txt`)
      ];
      for (const f of candidateFiles) {
        if (fs.existsSync(f)) {
          const content = fs.readFileSync(f, 'utf-8').trim();
          if (content.length > 20) return content;
        }
      }

      if (fs.existsSync(SESSIONS_IMG_JSON)) {
        try {
          const metaList = JSON.parse(fs.readFileSync(SESSIONS_IMG_JSON, 'utf-8'));
          if (Array.isArray(metaList)) {
            const matched = metaList.find((m) => String(m.id).includes(ts) || (m.fileName && m.fileName.includes(ts)));
            if (matched && matched.videoPromptText && matched.videoPromptText.trim().length > 20) {
              return matched.videoPromptText.trim();
            }
          }
        } catch (e) {}
      }
    }
  }

  if (projectFolder && fs.existsSync(projectFolder)) {
    const pFile = path.join(projectFolder, 'prompt_video.txt');
    if (fs.existsSync(pFile)) {
      const c = fs.readFileSync(pFile, 'utf-8').trim();
      if (c.length > 20) return c;
    }
  }

  const sbDir = path.resolve(ROOT_DIR, 'storage/storyboards');
  if (fs.existsSync(sbDir)) {
    const promptFiles = fs.readdirSync(sbDir)
      .filter((f) => f.startsWith('video_prompts') && f.endsWith('.txt'))
      .map((f) => path.join(sbDir, f));
    if (promptFiles.length > 0) {
      promptFiles.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
      const c = fs.readFileSync(promptFiles[0], 'utf-8').trim();
      if (c.length > 20) return c;
    }
  }

  return 'Cinematic commercial realistic product video, smooth camera movement, dynamic realistic lighting, 4k ultra high details.';
}

function downloadFileFromUrl(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith('http')) return reject(new Error('URL tidak valid'));
    if (redirectCount > 5) return reject(new Error('Terlalu banyak redirect'));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://flow.google.com/'
      }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return downloadFileFromUrl(nextUrl, destPath, redirectCount + 1).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });
      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
    });

    req.on('error', reject);
  });
}

// =========================================================================
// PIPELINE UTAMA GOOGLE FLOW (PURE RAW CDP)
// =========================================================================
async function runFlowProjectCreation({
  projectFolder,
  storyboardImagePath = null,
  promptText,
  flowVideoType = 'Bahan',
  flowRatio = '9:16',
  flowModel = 'Veo 3.1 - Lite',
  flowResolution = '720p',
  flowDuration = '10 Detik',
  flowOutputCount = '1',
  onProgress = () => {}
}) {
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath) {
    return { success: false, error: 'Google Chrome asli tidak ditemukan di sistem Anda.' };
  }

  const targetStoryboardFile = resolveLatestStoryboardAsset(projectFolder, storyboardImagePath);
  if (!targetStoryboardFile) {
    return { success: false, error: 'Berkas gambar storyboard tidak ditemukan di galeri.' };
  }
  const finalPromptText = resolveLatestPromptText(promptText, projectFolder, targetStoryboardFile);

  onProgress(`Storyboard terpilih: ${path.basename(targetStoryboardFile)}`);

  await acquireGenerateSlot(onProgress);

  // 1. Validasi saldo & rotasi otomatis ke Akun 2 (atau tolak jika belum siap)
  let targetAcc = null;
  let cfg = null;
  try {
    const resolved = resolveActiveAccountForRender(onProgress);
    targetAcc = resolved.targetAcc;
    cfg = resolved.cfg;
  } catch (accErr) {
    await releaseGenerateSlot(onProgress);
    return { success: false, error: accErr.message };
  }

  const accountId = targetAcc.id;
  const profileDir = getProfileDirForAccount(accountId);

  const cdpPort = 51000 + Math.floor(Math.random() * 13000);
  let chromeProcess = null;
  let cdp = null;

  try {
    purgeTransientSessionData(profileDir);
    onProgress(`Menggunakan sesi Flow (${targetAcc.name} · Port CDP: ${cdpPort})...`);

    chromeProcess = spawn(
      chromePath,
      getFlowChromeArgs(cdpPort, profileDir),
      { detached: false, stdio: 'ignore' }
    );

    const wsUrl = await getPageWebSocketUrl(cdpPort, 30);
    if (!wsUrl) throw new Error(`Gagal mendapatkan WebSocket CDP pada port ${cdpPort}.`);

    cdp = new RawCDPClient(wsUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');

    const interceptedVideoUrls = [];

    cdp.on('Network.responseReceived', async (params) => {
      try {
        const respUrl = params.response?.url || '';
        const mimeType = (params.response?.mimeType || '').toLowerCase();

        if (respUrl.includes('batchexecute')) {
          const bodyObj = await cdp.send('Network.getResponseBody', { requestId: params.requestId }).catch(() => null);
          if (bodyObj?.body) {
            const cred = parseGoogleFlowCreditResponse(bodyObj.body);
            if (cred) {
              targetAcc.credits = cred;
              const cfgNow = getFlowAccountsConfigRaw();
              const matchedAcc = cfgNow.accounts.find((a) => a.id === targetAcc.id);
              if (matchedAcc) {
                matchedAcc.credits = cred;
                saveFlowAccountsConfig(cfgNow);
              }
            }
          }
        }

        if (
          respUrl.startsWith('http') &&
          !respUrl.includes('.js') &&
          (mimeType.includes('video/') ||
            respUrl.includes('googlevideo.com/videoplayback') ||
            respUrl.includes('.mp4') ||
            (respUrl.includes('googleusercontent.com') && mimeType.includes('octet-stream')))
        ) {
          if (!interceptedVideoUrls.includes(respUrl)) {
            interceptedVideoUrls.unshift(respUrl);
          }
        }
      } catch (e) {}
    });

    await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
    onProgress(`Memvalidasi akun dan sisa kredit di antarmuka Flow...`);
    await sleep(3500);

    const headerIconPos = await cdp.waitForElementCenter({
      selector: 'flow-header-user-icon, header button, header a, header img',
      textRegexStr: '@|Akun Google|Google Account|Profil',
      pickLast: true
    }, 7000);

    if (headerIconPos) {
      await cdp.nativeClickAt(headerIconPos.x, headerIconPos.y, 1000);
      await cdp.pressKey('Escape', 27);
      await humanDelay(500, 800);
    }

    onProgress(`Mencari dan menekan tombol "+ Project baru"...`);
    let enteredWorkspace = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
      await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
      const isAlreadyInProject = await cdp.findElementCenter({
        selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
      });

      if (isAlreadyInProject) {
        enteredWorkspace = true;
        break;
      }

      const newProjPos = await cdp.waitForElementCenter({
        selector: 'button, a, [role="button"], div, span',
        textRegexStr: '^\\s*(\\+\\s*)?(Project baru|New project|Buat project)\\s*$'
      }, 6000);

      if (newProjPos) {
        onProgress(`Menekan tombol "+ Project baru" (Percobaan ${attempt})...`);
        await cdp.nativeClickAt(newProjPos.x, newProjPos.y, 3500);
      } else {
        await sleep(1500);
      }
    }

    // Popup info fitur baru di project (mis. "Nano Banana 2.1" → Mulai)
    await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
    await disableFlowAgent((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);

    if (!enteredWorkspace) {
      const checkEditorAgain = await cdp.waitForElementCenter({
        selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
      }, 10000);
      if (!checkEditorAgain) {
        throw new Error('Gagal masuk ke kanvas Project Baru Google Flow.');
      }
    }

    const cleanType = String(flowVideoType).toLowerCase().includes('frame') ? 'Frame' : 'Bahan';
    const cleanRes = String(flowResolution).includes('360') ? '360p' : '720p';
    const durMatch = String(flowDuration).match(/\d+/);
    const cleanDurationVal = durMatch ? durMatch[0] : '8';
    const cleanModel = require('./flowModels').normalizeFlowModel(flowModel);
    const cleanOutputCount = String(flowOutputCount).match(/\d+/) ? `x${String(flowOutputCount).match(/\d+/)[0]}` : 'x1';

    onProgress(`Mengatur setelan mesin render (${cleanModel} · ${cleanRes} · ${cleanDurationVal} dtk · ${cleanOutputCount})...`);

    // Deteksi pill setelan bawah (contoh: "Video · 720p · 8 dtk · 9:16 · x2")
    const pillPos = await cdp.waitForElementCenter({
      selector: 'button[aria-label="Pemicu setelan"], button.settings-trigger-button, button',
      textRegexStr: 'Nano Banana|Imagen|Veo|Omni|Video\\s*[·•]|Gambar\\s*[·•]|x[1-4]|dtk',
      minY: 480,
      pickLast: true
    }, 10000);

    if (pillPos) {
      await cdp.nativeClickAt(pillPos.x, pillPos.y, 750);

      // 1. Pilih Tab Video
      const videoTabPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="tab"], [role="radio"], span',
        textRegexStr: '^\\s*Video\\s*$',
        minY: 150,
        maxY: 850
      });
      if (videoTabPos) {
        await cdp.nativeClickAt(videoTabPos.x, videoTabPos.y, 600);
      }

      // 2. Pilih Jenis: Bahan / Frame
      const typePos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanType}\\s*$`,
        minY: 150,
        maxY: 850
      });
      if (typePos) {
        await cdp.nativeClickAt(typePos.x, typePos.y, 500);
      }

      // 3. Pilih Rasio
      const cleanRatio = String(flowRatio || '9:16').replace(/\s+/g, '');
      const ratioPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanRatio.replace(':', '\\s*:\\s*')}\\s*$`,
        minY: 150,
        maxY: 850
      });
      if (ratioPos) {
        await cdp.nativeClickAt(ratioPos.x, ratioPos.y, 500);
      }

      // 4. Pilih Model Veo / Omni
      const modelDropdownTrigger = await cdp.findElementCenter({
        selector: 'button[aria-label="Pilih rangkaian model"], .flow-model-picker-trigger, button',
        textRegexStr: 'Veo|Omni|Model|Nano Banana',
        minY: 180,
        maxY: 850
      });

      if (modelDropdownTrigger) {
        await cdp.nativeClickAt(modelDropdownTrigger.x, modelDropdownTrigger.y, 600);

        const targetModelOption = await cdp.findElementCenter({
          selector: '.mat-mdc-menu-panel button, [role="menuitem"], [role="option"], flow-menu-item, span',
          textRegexStr: cleanModel
        });

        if (targetModelOption) {
          onProgress(`Memilih model: ${cleanModel}...`);
          await cdp.nativeClickAt(targetModelOption.x, targetModelOption.y, 550);
        } else {
          await cdp.pressKey('Escape', 27);
          await sleep(350);
        }
      }

      // 5. Pilih Resolusi (720p / 360p)
      const resPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: cleanRes,
        minY: 180,
        maxY: 850
      });
      if (resPos) {
        onProgress(`Memilih resolusi: ${cleanRes}...`);
        await cdp.nativeClickAt(resPos.x, resPos.y, 500);
      }

      // 6. Pilih Durasi — Omni 1.2 Flash memakai SLIDER (geser lewat tombol panah), model lain tombol
      // Nilai slider BUKAN detik (mis. 0..12 = 3..15 dtk) → patokannya label "N Dtk" di panel
      const readSlider = async () => (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const panel = document.querySelector('flow-prompt-box-settings') || document;
        const i = panel.querySelector('input[type="range"]');
        if (!i) return null; i.focus();
        const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
        const m = (panel.innerText || '').replace(/\\s+/g, ' ').match(/(?:Durasi|Duration)\\s*(\\d+)\\s*(?:dtk|detik|sec|s)\\b/i);
        return { min: n(i.min, 0), max: n(i.max, 100), value: n(i.value, 0), secs: m ? Number(m[1]) : null };
      })()` }).catch(() => null))?.result?.value;
      const slider = await readSlider();
      if (slider) {
        const want = Number(cleanDurationVal);
        let st = slider;
        for (let i = 0; i < 30 && st && st.secs != null && st.secs !== want; i++) {
          const up = st.secs < want;
          if ((up && st.value >= st.max) || (!up && st.value <= st.min)) break;
          await cdp.pressKey(up ? 'ArrowRight' : 'ArrowLeft', up ? 39 : 37);
          await sleep(120);
          const next = await readSlider();
          if (!next || next.secs == null) break;
          st = next;
          if ((up && next.secs > want) || (!up && next.secs < want)) break;
        }
        onProgress(`Durasi slider: ${st && st.secs != null ? st.secs : '?'} dtk (target ${want} dtk)`);
      }
      const cleanDurRegex = `^\\s*${cleanDurationVal}\\s*(?:dtk|detik|s)?\\s*$`;
      const durPos = slider ? null : await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: cleanDurRegex,
        minY: 180,
        maxY: 850
      });
      if (durPos) {
        onProgress(`Memilih durasi: ${cleanDurationVal} Detik...`);
        await cdp.nativeClickAt(durPos.x, durPos.y, 500);
      }

      // 7. PAKSA KLIK OUTPUT x1 (HEMAT KREDIT - 10 KREDIT SAJA)
      onProgress(`Memastikan jumlah output diatur ke ${cleanOutputCount} (1 Video)...`);
      const targetCountBtnPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span, div',
        textRegexStr: `^\\s*${cleanOutputCount}\\s*$`,
        minY: 180,
        maxY: 850
      });

      if (targetCountBtnPos) {
        await cdp.nativeClickAt(targetCountBtnPos.x, targetCountBtnPos.y, 500);
      }

      await cdp.pressKey('Escape', 27);
      await humanDelay(500, 800);
    }

    onProgress(`Menempelkan gambar storyboard: ${path.basename(targetStoryboardFile)}...`);
    const editorPos = await cdp.waitForElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }, 15000);

    if (!editorPos) throw new Error('Kotak input prompt tidak ditemukan.');

    const img = nativeImage.createFromPath(targetStoryboardFile);
    clipboard.writeImage(img);
    await sleep(350);

    await cdp.nativeClickAt(editorPos.x, editorPos.y, 550);
    await cdp.sendCtrlV();
    // Dialog "Hak untuk menggunakan gambar ini" bisa muncul setelah tempel gambar
    await sleep(1500);
    await agreeFlowImageRights(cdp, onProgress, sleep);
    await sleep(3000);

    const hasUploadedOrLoading = await cdp.findElementCenter({
      selector: '.loading-percentage, flow-soupy-overlay, flow-rich-text-editor img, .prompt-media-preview img, flow-canvas-tile img'
    });

    if (!hasUploadedOrLoading) {
      onProgress(`Mengunggah gambar via input native...`);
      await cdp.setNativeFileInput(targetStoryboardFile);
      await sleep(3500);
    }

    onProgress(`Menunggu gambar selesai diunggah...`);
    await sleep(3500);

    let stillUploading = true;
    for (let w = 0; w < 200; w++) {
      const loadingPos = await cdp.findElementCenter({ selector: '.loading-percentage, flow-soupy-overlay' });
      if (!loadingPos) { stillUploading = false; break; }
      await sleep(1500);
    }
    // Upload gagal di Flow tampil macet (mis. 99%) tanpa pesan → jangan kirim prompt tanpa gambar
    if (stillUploading) {
      throw new Error('Upload gambar storyboard ke Google Flow tidak selesai dalam 300 dtk (macet). Prompt TIDAK dikirim agar video tidak dibuat tanpa gambar. Cek koneksi internet lalu coba lagi.');
    }

    const imgInPrompt = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor img, .prompt-media-preview img, .prompt-top-row img'
    });

    if (!imgInPrompt) {
      const galleryTileImg = await cdp.findElementCenter({
        selector: 'img[alt*="gambar pengguna" i], img[data-media-id], flow-canvas-tile img, flow-media-tile img'
      });
      const currentEditorPos = await cdp.findElementCenter({
        selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
      }) || editorPos;

      if (galleryTileImg && currentEditorPos) {
        onProgress(`Menyematkan gambar ke kotak prompt...`);
        await cdp.nativeDragAndDrop(galleryTileImg.x, galleryTileImg.y, currentEditorPos.x, currentEditorPos.y);
        await sleep(2000);
      }
      const imgAfterPin = await cdp.findElementCenter({
        selector: 'flow-rich-text-editor img, .prompt-media-preview img, .prompt-top-row img'
      });
      if (!imgAfterPin) {
        throw new Error('Gambar storyboard tidak muncul di kotak prompt Google Flow. Prompt TIDAK dikirim agar video tidak dibuat tanpa gambar. Coba lagi.');
      }
    }
    onProgress('Gambar storyboard sudah ada di kotak prompt ✓');

    await humanDelay(500, 800);

    const cleanPrompt = finalPromptText.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    onProgress(`Menempelkan teks Prompt Video...`);

    clipboard.writeText(cleanPrompt);
    await sleep(250);

    const updatedEditorPos = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }) || editorPos;

    await cdp.nativeClickAt(updatedEditorPos.x, updatedEditorPos.y, 450);
    await cdp.sendCtrlV();
    // Dialog "Hak untuk menggunakan gambar ini" bisa muncul setelah tempel gambar
    await sleep(1500);
    await agreeFlowImageRights(cdp, onProgress, sleep);
    await humanDelay(1200, 1800);

    interceptedVideoUrls.length = 0;

    onProgress(`Menekan tombol Generate...`);
    const genBtnPos = await cdp.findElementCenter({
      selector: 'button[aria-label="Mulai pembuatan"], button.generate-icon-button, button',
      textRegexStr: 'arrow_forward|Mulai pembuatan',
      pickLast: true
    });

    if (genBtnPos) {
      await cdp.nativeClickAt(genBtnPos.x, genBtnPos.y, 1000);
    } else {
      await cdp.pressKey('Enter', 13);
    }

    onProgress(`Perintah terkirim! Menunggu render video selesai...`);
    await sleep(8000);

    const maxWaitMs = 15 * 60 * 1000;
    const startRender = Date.now();
    let isRenderCompleted = false;
    let detectedVideoSrc = '';

    while (Date.now() - startRender < maxWaitMs) {
      await sleep(3500);
      const elapsedSec = Math.round((Date.now() - startRender) / 1000);

      const checkRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const isVisible = (el) => {
              if (!el) return false;
              const r = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return r.width > 5 && r.height > 5 && style.visibility !== 'hidden' && style.display !== 'none';
            };

            const bodyTxt = document.body.innerText || '';
            if (/aktivitas\\s+(yang\\s+)?tidak\\s+biasa|unusual\\s+activity/i.test(bodyTxt)) {
              return { status: 'unusual' };
            }

            if (bodyTxt.includes('insufficient credits') || bodyTxt.includes('kredit tidak cukup') || bodyTxt.includes('kredit habis')) {
              return { status: 'out_of_credits' };
            }

            const loadingEls = Array.from(document.querySelectorAll('.loading-percentage, mat-progress-spinner, flow-soupy-overlay'));
            const activeSpinner = loadingEls.find(el => {
              if (!isVisible(el)) return false;
              const txt = (el.innerText || '').trim();
              if (el.classList.contains('loading-percentage') && !txt.includes('%')) return false;
              return true;
            });

            const videoEls = Array.from(document.querySelectorAll('flow-video-tile video, video')).filter(isVisible);
            const playCards = Array.from(document.querySelectorAll('flow-video-tile, [aria-label*="play" i], [aria-label*="putar" i]')).filter(isVisible);

            if (!activeSpinner && (videoEls.length > 0 || playCards.length > 0)) {
              const v = videoEls[0];
              const src = v ? (v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '')) : '';
              return { status: 'done', src };
            }

            return {
              status: 'rendering',
              percent: activeSpinner ? (activeSpinner.innerText || '').trim() : ''
            };
          })()
        `,
        returnByValue: true
      }).catch(() => null);

      const state = checkRes?.result?.value;

      if (state?.status === 'out_of_credits') {
        onProgress(`[PERINGATAN] Kredit ${targetAcc.name} habis saat proses berlangsung!`);
        try { await cdp.send('Browser.close'); } catch (e) {}
        cdp.close();
        if (chromeProcess && !chromeProcess.killed) {
          try { chromeProcess.kill(); } catch (e) {}
        }

        const cfgNow = getFlowAccountsConfigRaw();
        const matched = cfgNow.accounts.find(a => a.id === targetAcc.id);
        if (matched) matched.credits = 'Habis';
        saveFlowAccountsConfig(cfgNow);

        await releaseGenerateSlot(onProgress);
        throw new Error(`Kredit ${targetAcc.name} telah habis.`);
      }

      if (state?.status === 'unusual') {
        throw new Error(flowUnusualActivityMessage(targetAcc && targetAcc.name, { rested: false }));
      }

      if ((state?.status === 'done' || interceptedVideoUrls.length > 0) && elapsedSec >= 15) {
        isRenderCompleted = true;
        detectedVideoSrc = state?.src || interceptedVideoUrls[0] || '';
        onProgress(`Video selesai dirender (${elapsedSec} dtk)! Mengunduh berkas video...`);
        await sleep(2500);
        break;
      }

      const pctInfo = state?.percent ? ` (${state.percent})` : '';
      onProgress(`Merender video di Google Flow${pctInfo} [${elapsedSec} dtk]...`);
    }

    if (!isRenderCompleted) {
      throw new Error('Batas waktu render habis.');
    }

    const timestamp = Date.now();
    const videoFileName = `video_${timestamp}.mp4`;
    const sessionVideoPath = path.join(SESSIONS_VIDEOS_DIR, videoFileName);
    const storageVideoPath = path.join(OUTPUT_VIDEOS_DIR, videoFileName);

    const tempDownloadDir = path.resolve(ROOT_DIR, 'temp/flow_dl_' + timestamp);
    if (!fs.existsSync(tempDownloadDir)) fs.mkdirSync(tempDownloadDir, { recursive: true });

    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir,
      eventsEnabled: true
    }).catch(() => {});

    let videoCardPos = await cdp.findElementCenter({
      selector: 'flow-video-tile, video',
      minY: 100,
      maxY: 750
    });

    if (!videoCardPos) {
      videoCardPos = await cdp.findElementCenter({
        selector: 'mat-icon, button',
        textRegexStr: '^\\s*(play_arrow|play_circle|putar)\\s*$',
        minY: 100,
        maxY: 750
      });
    }

    if (videoCardPos) {
      await cdp.nativeClickAt(videoCardPos.x, videoCardPos.y, 3000);
    }

    if (!detectedVideoSrc || !detectedVideoSrc.startsWith('http')) {
      const srcCheck = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const vids = Array.from(document.querySelectorAll('video'));
            for (const v of vids) {
              const s = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
              if (s) return s;
            }
            return '';
          })()
        `,
        returnByValue: true
      }).catch(() => null);

      if (srcCheck?.result?.value) {
        detectedVideoSrc = srcCheck.result.value;
      }
    }

    let isSavedSuccess = false;

    // Strategi 1: Direct URL Download
    const candidateHttpUrls = [
      ...(detectedVideoSrc && detectedVideoSrc.startsWith('http') ? [detectedVideoSrc] : []),
      ...interceptedVideoUrls
    ];

    for (const directUrl of candidateHttpUrls) {
      if (isSavedSuccess) break;
      try {
        await downloadFileFromUrl(directUrl, sessionVideoPath);
        if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 50000) {
          isSavedSuccess = true;
          break;
        }
      } catch (e) {}
    }

    // Strategi 2: Tombol Unduh UI
    if (!isSavedSuccess) {
      const dlBtnPos = await cdp.findElementCenter({
        selector: 'button, [role="button"], a[download]',
        textRegexStr: 'download|unduh',
        maxY: 650
      });

      if (dlBtnPos) {
        await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 1200);

        const priorityRes = cleanRes === '720p' ? ['720p', '1080p', '360p'] : ['360p', '720p'];
        for (const rLabel of priorityRes) {
          const resMenuPos = await cdp.findElementCenter({
            selector: 'flow-menu-item, button[role="menuitem"], .cdk-overlay-container button, span',
            textRegexStr: rLabel
          });
          if (resMenuPos) {
            await cdp.nativeClickAt(resMenuPos.x, resMenuPos.y, 1500);
            break;
          }
        }

        for (let waitDl = 0; waitDl < 45; waitDl++) {
          await sleep(1000);
          if (fs.existsSync(tempDownloadDir)) {
            const allFiles = fs.readdirSync(tempDownloadDir);
            const isDownloading = allFiles.some((f) => f.endsWith('.crdownload') || f.endsWith('.tmp'));
            const dlFiles = allFiles.filter(
              (f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && /\.(mp4|webm|mov)$/i.test(f)
            );
            if (dlFiles.length > 0 && !isDownloading) {
              const downloadedFullPath = path.join(tempDownloadDir, dlFiles[0]);
              if (fs.statSync(downloadedFullPath).size > 50000) {
                fs.copyFileSync(downloadedFullPath, sessionVideoPath);
                isSavedSuccess = true;
                break;
              }
            }
          }
        }
      }
    }

    // Strategi 3: Fetch Blob Memory / Base64
    if (!isSavedSuccess) {
      const base64VideoRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (async () => {
            try {
              const vids = Array.from(document.querySelectorAll('video'));
              const targetVid = vids.find(v => v.currentSrc || v.src || v.querySelector('source')) || vids[0];
              if (!targetVid) return { error: 'Elemen video tidak ditemukan' };

              const url = targetVid.currentSrc || targetVid.src || (targetVid.querySelector('source') ? targetVid.querySelector('source').src : '');
              if (!url) return { error: 'URL kosong' };

              let response = null;
              try {
                response = await fetch(url);
              } catch (e1) {
                response = await fetch(url, { credentials: 'include' });
              }

              if (!response || !response.ok) return { error: 'HTTP Failed', url };

              const blob = await response.blob();
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64 = String(reader.result || '').split(',')[1] || '';
                  resolve({ base64, url });
                };
                reader.onerror = () => resolve({ error: 'Gagal FileReader', url });
                reader.readAsDataURL(blob);
              });
            } catch (err) {
              return { error: err.message };
            }
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      }).catch(() => null);

      const extracted = base64VideoRes?.result?.value;
      if (extracted?.base64 && extracted.base64.length > 10000) {
        const videoBuffer = Buffer.from(extracted.base64, 'base64');
        fs.writeFileSync(sessionVideoPath, videoBuffer);
        isSavedSuccess = true;
      }
    }

    try {
      if (fs.existsSync(tempDownloadDir)) fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    } catch (e) {}

    // VERIFIKASI KETAT
    if (!isSavedSuccess || !fs.existsSync(sessionVideoPath) || fs.statSync(sessionVideoPath).size < 50000) {
      throw new Error('Gagal mengunduh berkas video jadi dari Google Flow (file kosong/belum selesai).');
    }

    try {
      fs.copyFileSync(sessionVideoPath, storageVideoPath);
    } catch (e) {}

    const videoResult = registerVideoToMetadata(
      videoFileName,
      sessionVideoPath,
      storageVideoPath,
      finalPromptText,
      targetStoryboardFile
    );

    // =======================================================================
    // AUTO-DECREMENT KREDIT LOKAL (-10 KREDIT) & UPDATE UI INSTAN
    // =======================================================================
    try {
      const cfgNow = getFlowAccountsConfigRaw();
      const currentAcc = cfgNow.accounts.find((a) => a.id === targetAcc.id);
      if (currentAcc) {
        const numMatch = String(currentAcc.credits).replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
        const currentNum = numMatch ? parseInt(numMatch[0], 10) : 50;
        const newCreditValue = Math.max(0, currentNum - 10);
        currentAcc.credits = newCreditValue === 0 ? 'Habis' : `${newCreditValue} Kredit`;

        // Jika setelah render saldo akun ini < 10, otomatis pindahkan activeAccountId ke akun cadangan berikutnya yang siap
        if (newCreditValue < MIN_FLOW_CREDIT) {
          const nextReady = cfgNow.accounts.find((a) => a.id !== currentAcc.id && a.status === 'Sesi Aktif');
          if (nextReady) {
            cfgNow.activeAccountId = nextReady.id;
            onProgress(`[Rotasi Otomatis] Saldo ${currentAcc.name} tersisa ${newCreditValue} Kredit. Akun aktif dialihkan ke ${nextReady.name}.`);
          }
        }

        saveFlowAccountsConfig(cfgNow);
        onProgress(`[Kredit Terpotong] Saldo ${currentAcc.name} tersisa ${currentAcc.credits}.`);
      }
    } catch (errDec) {}

    onProgress(`Video tersimpan: ${videoFileName}`);
    try {
      await cdp.send('Browser.close');
    } catch (e) {}
    await sleep(800);
    cdp.close();
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill(); } catch (e) {}
    }

    await releaseGenerateSlot(onProgress);

    return {
      success: true,
      workerId: 1,
      accountUsed: targetAcc.name,
      videoPath: videoResult.filePath,
      storagePath: videoResult.storagePath,
      fileName: videoResult.fileName,
      thumbnailPath: videoResult.thumbnailPath,
      videoResult
    };
  } catch (err) {
    const msg = err.message || 'Kendala eksekusi Flow';
    onProgress(`Kendala: ${msg}`);
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      cdp.close();
    }
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill(); } catch (e) {}
    }
    await releaseGenerateSlot(onProgress);
    return { success: false, workerId: 1, error: msg };
  }
}

module.exports = {
  getFlowAccountsConfig,
  saveFlowAccountsConfig,
  addFlowAccount,
  deleteFlowAccount,
  openFlowLoginWindow,
  openFlowWorker2LoginWindow,
  runFlowProjectCreation,
  silentSyncAccountCredits,
  syncAllFlowAccountCredits,
  isFlowCreditStale,
  resolveActiveAccountForRender
};