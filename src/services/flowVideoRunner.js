/**
 * src/services/flowVideoRunner.js
 * Arsitektur Pure Raw CDP (Zero DOM Injection - Mengikuti Pola Vibot)
 * - Pengecekan Kredit Awal Ketat (Batas Minimum: 10 Kredit)
 * - Otomatis Hapus Akun & Berkas Sesi jika Kredit < 10, lalu Langsung Rotasi ke Akun Berikutnya
 * - Copy-Paste Prompt Instan via Clipboard (Ctrl+V)
 * - Deteksi Pill Setelan Default ("Nano Banana" / "Gambar" / "Video") -> Ubah ke Tab "Video"
 * - Pemilihan Akurat Jenis (Bahan/Frame), Rasio (9:16), Model (Omni/Veo), Resolusi (360p/720p), Durasi, & x1
 * - Multi-Strategy Video Downloader (Stream Blob Fetch + Network Sniffer + UI Download)
 * - Graceful Browser Close & Anti-Crash Bubble ("Restore pages?")
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { BrowserWindow, clipboard, nativeImage } = require('electron');

const ROOT_DIR = process.cwd();
const FLOW_BASE_DIR = path.resolve(ROOT_DIR, 'sessions/flow_profiles');
const FLOW_CONFIG_FILE = path.resolve(FLOW_BASE_DIR, 'accounts_config.json');

const SESSIONS_VIDEOS_DIR = path.resolve(ROOT_DIR, 'sessions/generated_videos');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const SESSIONS_IMG_DIR = path.resolve(ROOT_DIR, 'sessions/generated_images');
const SESSIONS_IMG_JSON = path.resolve(ROOT_DIR, 'sessions/generated_images/metadata.json');

if (!fs.existsSync(FLOW_BASE_DIR)) fs.mkdirSync(FLOW_BASE_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_VIDEOS_DIR)) fs.mkdirSync(SESSIONS_VIDEOS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_VIDEOS_DIR)) fs.mkdirSync(OUTPUT_VIDEOS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
            if (rect.width < 12 || rect.height < 12 || rect.width > 950 || rect.height > 600) return false;
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
    const nzlxgMatch = bodyText.match(/"nzlxg"\s*,\s*"\\?\[\s*(\d+)/) || bodyText.match(/nzlxg.*?(\d{1,4})/i);
    if (nzlxgMatch && nzlxgMatch[1]) {
      return `${nzlxgMatch[1]} Kredit`;
    }

    const jsonMatch = bodyText.match(/"(?:credits?|balance|remaining_credits|available_credits)"\s*:\s*(\d+)/i) ||
                      bodyText.match(/(\d{1,4})\s*(?:kredit|credits)/i);
    if (jsonMatch && jsonMatch[1]) {
      return `${jsonMatch[1]} Kredit`;
    }
  } catch (e) {}
  return '';
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

    const stats = fs.statSync(targetCookieFile);
    return stats.size > 8000;
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
          acc.credits = 'Tersedia';
        }
      } else {
        acc.status = 'Belum Login';
        acc.credits = 'Tidak Tersedia';
      }
    });
    saveFlowAccountsConfig(cfg);
  } catch (err) {}
  return cfg;
}

function saveFlowAccountsConfig(cfg) {
  fs.writeFileSync(FLOW_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function getProfileDirForAccount(accountId) {
  const dir = path.join(FLOW_BASE_DIR, accountId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deleteFlowAccount(accountId) {
  const cfg = getFlowAccountsConfigRaw();
  cfg.accounts = (cfg.accounts || []).filter((a) => a.id !== accountId);

  if (cfg.activeAccountId === accountId) {
    cfg.activeAccountId = cfg.accounts[0]?.id || null;
  }

  saveFlowAccountsConfig(cfg);

  // Hapus berkas profil sesi fisik
  const targetDir = path.join(FLOW_BASE_DIR, accountId);
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }

  try {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('flow-accounts-updated');
      }
    });
  } catch (e) {}

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

  return new Promise((resolve) => {
    chromeProcess.on('close', () => {
      const hasSession = checkAccountHasRealSession(accountId);
      const cfg = getFlowAccountsConfigRaw();
      const acc = cfg.accounts.find((a) => a.id === accountId);
      if (acc) {
        acc.status = hasSession ? 'Sesi Aktif' : 'Belum Login';
        if (hasSession && (!acc.credits || acc.credits === 'Tidak Tersedia')) {
          acc.credits = 'Tersedia';
        }
        cfg.activeAccountId = accountId;
        saveFlowAccountsConfig(cfg);
      }
      resolve({ success: true, accountId, status: acc?.status, credits: acc?.credits });
    });
  });
}

async function openFlowWorker2LoginWindow(accountId = 'acc_1') {
  return openFlowLoginWindow(accountId);
}

// =========================================================================
// PENGECEKAN KREDIT SENYAP (HEADLESS PURE RAW CDP)
// =========================================================================
async function silentSyncAccountCredits(accountId = 'acc_1') {
  const profileDir = getProfileDirForAccount(accountId);
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath || !fs.existsSync(profileDir)) return null;

  purgeTransientSessionData(profileDir);

  const randomPort = 55000 + Math.floor(Math.random() * 8000);
  let chromeProcess = null;
  let cdp = null;

  try {
    chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${randomPort}`,
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-crash-restore-bubble',
      'https://flow.google.com/'
    ], { detached: false, stdio: 'ignore' });

    const wsUrl = await getPageWebSocketUrl(randomPort, 20);
    if (!wsUrl) throw new Error('Koneksi port CDP background gagal');

    cdp = new RawCDPClient(wsUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    let detectedCredit = '';

    cdp.on('Network.responseReceived', async (params) => {
      try {
        const respUrl = params.response?.url || '';
        if (respUrl.includes('batchexecute') || respUrl.includes('credit') || respUrl.includes('workspace')) {
          const bodyObj = await cdp.send('Network.getResponseBody', { requestId: params.requestId }).catch(() => null);
          if (bodyObj?.body) {
            const parsed = parseGoogleFlowCreditResponse(bodyObj.body);
            if (parsed) detectedCredit = parsed;
          }
        }
      } catch (e) {}
    });

    await sleep(2500);

    const headerIconPos = await cdp.findElementCenter({
      selector: 'flow-header-user-icon, header button, header a, header img, button[aria-label*="Google"]',
      textRegexStr: '@|Akun Google|Google Account|Profil|Kredit'
    });

    if (headerIconPos) {
      await cdp.nativeClickAt(headerIconPos.x, headerIconPos.y, 1000);
      await cdp.pressKey('Escape', 27);
    }

    await sleep(2000);

    if (!detectedCredit) {
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const allText = document.body.innerText || '';

            const m1 = allText.match(/(\\d+)\\s*(?:kredit|credits)/i);
            if (m1) return m1[1] + ' Kredit';

            const m2 = allText.match(/(\\d+)\\s*\\/\\s*\\d+\\s*(?:kredit|credits)?/i);
            if (m2) return m2[1] + ' Kredit';

            const badge = document.querySelector('[class*="credit"], [aria-label*="kredit" i], [aria-label*="credit" i]');
            if (badge) {
              const num = (badge.innerText || '').match(/\\d+/);
              if (num) return num[0] + ' Kredit';
            }

            return '';
          })()
        `,
        returnByValue: true
      }).catch(() => null);

      if (evalRes?.result?.value) {
        detectedCredit = evalRes.result.value;
      }
    }

    const cfg = getFlowAccountsConfigRaw();
    const acc = cfg.accounts.find((a) => a.id === accountId);
    if (acc) {
      if (detectedCredit) {
        acc.credits = detectedCredit;
        acc.status = 'Sesi Aktif';
      } else if (checkAccountHasRealSession(accountId)) {
        acc.status = 'Sesi Aktif';
      }
      saveFlowAccountsConfig(cfg);
    }

    return detectedCredit || acc?.credits || 'Tersedia';
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

// =========================================================================
// ROTASI OTOMATIS MULTI-AKUN (TANPA HAPUS AKUN - AMANKAN JATAH HARIAN)
// =========================================================================
async function ensureActiveAccountWithSufficientCredits(onProgress = () => {}) {
  const cfg = getFlowAccountsConfig();
  if (!cfg.accounts || cfg.accounts.length === 0) {
    throw new Error('Tidak ada akun Google Flow yang terdaftar.');
  }

  const extractCreditNumber = (creditStr) => {
    if (!creditStr || creditStr === 'Tidak Tersedia' || creditStr === 'Habis') return 0;
    const match = String(creditStr).match(/\d+/);
    return match ? parseInt(match[0], 10) : 999;
  };

  // Cari akun yang sedang aktif
  let activeIndex = cfg.accounts.findIndex((a) => a.id === cfg.activeAccountId);
  if (activeIndex === -1) activeIndex = 0;

  const totalAccounts = cfg.accounts.length;

  // Lakukan pengecekan berputar ke seluruh akun yang ada
  for (let step = 0; step < totalAccounts; step++) {
    const currentIndex = (activeIndex + step) % totalAccounts;
    const currentAcc = cfg.accounts[currentIndex];

    onProgress(`[Pengecekan Kuota] Memeriksa saldo ${currentAcc.name}...`);
    const syncedCredits = await silentSyncAccountCredits(currentAcc.id);
    const creditValue = extractCreditNumber(syncedCredits || currentAcc.credits);

    if (creditValue >= 10) {
      onProgress(`[Kuota Cukup] Menggunakan ${currentAcc.name} (${creditValue} Kredit).`);
      
      // Simpan akun ini sebagai akun aktif terpilih
      cfg.activeAccountId = currentAcc.id;
      currentAcc.credits = `${creditValue} Kredit`;
      saveFlowAccountsConfig(cfg);

      return currentAcc;
    }

    // Jika kredit < 10: Tandai akun 'Habis' tanpa menghapusnya
    onProgress(`[Kredit Habis/Kurang] ${currentAcc.name} tersisa ${creditValue} Kredit (< 10).`);
    currentAcc.credits = 'Habis';
    saveFlowAccountsConfig(cfg);
    onProgress(`Melewati ${currentAcc.name} (menunggu reset harian) & beralih ke akun berikutnya...`);
    await sleep(1000);
  }

  // Jika seluruh akun dalam daftar tidak ada yang memiliki >= 10 kredit
  throw new Error('Semua akun Google Flow telah kehabisan kredit (< 10). Kuota gratis 50 kredit akan reset besok.');
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
  flowModel = 'Omni 1.1 Flash',
  flowResolution = '360p',
  flowDuration = '10 dtk',
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

  // 1. Pengecekan awal: Pastikan akun memiliki minimal 10 kredit; jika < 10, akun langsung dihapus dan beralih ke akun berikutnya
  const targetAcc = await ensureActiveAccountWithSufficientCredits(onProgress);
  const accountId = targetAcc?.id || 'acc_1';
  const profileDir = getProfileDirForAccount(accountId);

  const cdpPort = 51000 + Math.floor(Math.random() * 13000);
  let chromeProcess = null;
  let cdp = null;

  try {
    purgeTransientSessionData(profileDir);
    onProgress(`Menggunakan sesi Flow (${targetAcc.name}) · Port CDP ${cdpPort}...`);

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
    let liveCreditsDetected = null;

    cdp.on('Network.responseReceived', async (params) => {
      try {
        const respUrl = params.response?.url || '';
        const mimeType = (params.response?.mimeType || '').toLowerCase();

        if (respUrl.includes('batchexecute')) {
          const bodyObj = await cdp.send('Network.getResponseBody', { requestId: params.requestId }).catch(() => null);
          if (bodyObj?.body) {
            const cred = parseGoogleFlowCreditResponse(bodyObj.body);
            if (cred) {
              liveCreditsDetected = cred;
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

    onProgress(`Memvalidasi akun dan sisa kredit di antarmuka Flow...`);
    await sleep(4000);

    const headerIconPos = await cdp.waitForElementCenter({
      selector: 'flow-header-user-icon, header button, header a, header img',
      textRegexStr: '@|Akun Google|Google Account|Profil',
      pickLast: true
    }, 8000);

    if (headerIconPos) {
      await cdp.nativeClickAt(headerIconPos.x, headerIconPos.y, 1200);
      await cdp.pressKey('Escape', 27);
      await humanDelay(600, 900);
    }

    // Pengecekan kedua secara live langsung dari halaman: jika terdeteksi < 10 kredit, batalkan dan hapus akun
    const directCreditCheck = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const allText = document.body.innerText || '';
          const m = allText.match(/(\\d+)\\s*(?:kredit|credits)/i);
          if (m) return parseInt(m[1], 10);
          const badge = document.querySelector('[class*="credit"], [aria-label*="kredit" i], [aria-label*="credit" i]');
          if (badge) {
            const num = (badge.innerText || '').match(/\\d+/);
            if (num) return parseInt(num[0], 10);
          }
          return null;
        })()
      `,
      returnByValue: true
    }).catch(() => null);

    const liveCreditVal = directCreditCheck?.result?.value;
    if (liveCreditVal !== null && typeof liveCreditVal === 'number' && liveCreditVal < 10) {
      onProgress(`[PERINGATAN] Saldo aktual ${targetAcc.name} hanya ${liveCreditVal} Kredit (< 10).`);
      onProgress(`Menghapus ${targetAcc.name} dan beralih ke akun berikutnya...`);

      try { await cdp.send('Browser.close'); } catch (e) {}
      cdp.close();
      if (chromeProcess && !chromeProcess.killed) {
        try { chromeProcess.kill(); } catch (e) {}
      }

      deleteFlowAccount(targetAcc.id);
      await releaseGenerateSlot(onProgress);

      // Jalankan kembali otomatis dengan akun cadangan berikutnya
      return await runFlowProjectCreation({
        projectFolder,
        storyboardImagePath,
        promptText,
        flowVideoType,
        flowModel,
        flowResolution,
        flowDuration,
        onProgress
      });
    }

    onProgress(`Mencari dan menekan tombol "+ Project baru"...`);
    let enteredWorkspace = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
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

    if (!enteredWorkspace) {
      const checkEditorAgain = await cdp.waitForElementCenter({
        selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
      }, 10000);
      if (!checkEditorAgain) {
        throw new Error('Gagal masuk ke kanvas Project Baru Google Flow.');
      }
    }

    const cleanType = String(flowVideoType).toLowerCase().includes('frame') ? 'Frame' : 'Bahan';
    const cleanRes = String(flowResolution).includes('360') ? '360p' : (String(flowResolution).includes('720') ? '720p' : '360p');
    const durationMatch = String(flowDuration).match(/\d+/);
    const cleanDuration = durationMatch ? `${durationMatch[0]} dtk` : '10 dtk';
    const cleanModel = String(flowModel || 'Omni 1.1 Flash').replace(/google/i, '').trim();

    onProgress(`Membuka panel setelan untuk mengubah mode ke Video (${cleanModel} · ${cleanRes} · ${cleanDuration})...`);

    const pillPos = await cdp.waitForElementCenter({
      selector: 'button[aria-label="Pemicu setelan"], button.settings-trigger-button, button',
      textRegexStr: 'Nano Banana|Imagen|Veo|Omni|Video\\s*[·•]|Gambar\\s*[·•]|x[1-4]',
      minY: 500,
      pickLast: true
    }, 10000);

    if (pillPos) {
      await cdp.nativeClickAt(pillPos.x, pillPos.y, 750);

      onProgress(`Mengubah mode dari Gambar ke Video...`);
      const videoTabPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="tab"], [role="radio"], span',
        textRegexStr: '^\\s*Video\\s*$',
        minY: 180,
        maxY: 780
      });
      if (videoTabPos) {
        await cdp.nativeClickAt(videoTabPos.x, videoTabPos.y, 650);
      }

      const typePos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanType}\\s*$`,
        minY: 180,
        maxY: 780
      });
      if (typePos) {
        await cdp.nativeClickAt(typePos.x, typePos.y, 550);
      }

      const ratioPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: '^\\s*9:16\\s*$',
        minY: 180,
        maxY: 780
      });
      if (ratioPos) {
        await cdp.nativeClickAt(ratioPos.x, ratioPos.y, 550);
      }

      const modelDropdownTrigger = await cdp.findElementCenter({
        selector: 'button[aria-label="Pilih rangkaian model"], .flow-model-picker-trigger, button',
        textRegexStr: 'Omni|Veo|Nano Banana|Model',
        minY: 220,
        maxY: 780
      });

      if (modelDropdownTrigger) {
        await cdp.nativeClickAt(modelDropdownTrigger.x, modelDropdownTrigger.y, 650);

        const targetModelOption = await cdp.findElementCenter({
          selector: '.mat-mdc-menu-panel button, [role="menuitem"], [role="option"], flow-menu-item, span',
          textRegexStr: cleanModel
        });

        if (targetModelOption) {
          onProgress(`Memilih model: ${cleanModel}...`);
          await cdp.nativeClickAt(targetModelOption.x, targetModelOption.y, 600);
        } else {
          await cdp.pressKey('Escape', 27);
          await sleep(400);
        }
      }

      const resPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: cleanRes,
        minY: 220,
        maxY: 780
      });
      if (resPos) {
        onProgress(`Memilih resolusi: ${cleanRes}...`);
        await cdp.nativeClickAt(resPos.x, resPos.y, 550);
      }

      const durPos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanDuration}\\s*$`,
        minY: 220,
        maxY: 780
      });
      if (durPos) {
        await cdp.nativeClickAt(durPos.x, durPos.y, 550);
      }

      const x1Pos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: '^\\s*x1\\s*$',
        minY: 220,
        maxY: 780
      });
      if (x1Pos) {
        await cdp.nativeClickAt(x1Pos.x, x1Pos.y, 550);
      }

      await cdp.pressKey('Escape', 27);
      await humanDelay(600, 900);
    }

    onProgress(`Menempelkan gambar storyboard ke kotak prompt: ${path.basename(targetStoryboardFile)}...`);
    const editorPos = await cdp.waitForElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }, 15000);

    if (!editorPos) throw new Error('Kotak input prompt tidak ditemukan.');

    const img = nativeImage.createFromPath(targetStoryboardFile);
    clipboard.writeImage(img);
    await sleep(350);

    await cdp.nativeClickAt(editorPos.x, editorPos.y, 550);
    await cdp.sendCtrlV();
    await sleep(3000);

    const hasUploadedOrLoading = await cdp.findElementCenter({
      selector: '.loading-percentage, flow-soupy-overlay, flow-rich-text-editor img, .prompt-media-preview img, flow-canvas-tile img'
    });

    if (!hasUploadedOrLoading) {
      onProgress(`Mengunggah gambar melalui input file native...`);
      await cdp.setNativeFileInput(targetStoryboardFile);
      await sleep(3500);
    }

    onProgress(`Menunggu gambar selesai diunggah ke Google Flow...`);
    await sleep(4000);

    for (let w = 0; w < 35; w++) {
      const loadingPos = await cdp.findElementCenter({ selector: '.loading-percentage, flow-soupy-overlay' });
      if (!loadingPos) break;
      await sleep(1500);
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
        onProgress(`Menyematkan gambar ke referensi kotak prompt...`);
        await cdp.nativeDragAndDrop(galleryTileImg.x, galleryTileImg.y, currentEditorPos.x, currentEditorPos.y);
      }
    }

    await humanDelay(600, 900);

    const cleanPrompt = finalPromptText.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    onProgress(`Menempelkan (Copy-Paste) teks Video Prompt...`);

    clipboard.writeText(cleanPrompt);
    await sleep(250);

    const updatedEditorPos = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }) || editorPos;

    await cdp.nativeClickAt(updatedEditorPos.x, updatedEditorPos.y, 450);
    await cdp.sendCtrlV();
    await humanDelay(1500, 2200);

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

    onProgress(`Perintah terkirim! Menunggu proses render video...`);
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
            if (bodyTxt.includes('aktivitas yang tidak biasa') || bodyTxt.includes('unusual activity')) {
              return { status: 'unusual' };
            }

            // Deteksi peringatan kehabisan kredit saat proses berjalan
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
        onProgress(`Menyimpan sesi akun untuk jatah besok dan beralih ke akun cadangan...`);

        try { await cdp.send('Browser.close'); } catch (e) {}
        cdp.close();
        if (chromeProcess && !chromeProcess.killed) {
          try { chromeProcess.kill(); } catch (e) {}
        }

        // Tandai habis di konfigurasi tanpa menghapus profil
        const cfgNow = getFlowAccountsConfigRaw();
        const matched = cfgNow.accounts.find(a => a.id === targetAcc.id);
        if (matched) matched.credits = 'Habis';
        saveFlowAccountsConfig(cfgNow);

        await releaseGenerateSlot(onProgress);

        // Jalankan ulang pipeline dengan akun berikutnya
        return await runFlowProjectCreationTiktok({
          projectFolder,
          storyboardImagePath,
          promptText,
          flowVideoType,
          flowModel,
          flowResolution,
          flowDuration,
          onProgress
        });
      }

      if (state?.status === 'unusual') {
        throw new Error('Akun terkena pembatasan "aktivitas tidak biasa". Coba gunakan akun Google yang sudah pernah dipakai manual.');
      }

      if ((state?.status === 'done' || interceptedVideoUrls.length > 0) && elapsedSec >= 18) {
        isRenderCompleted = true;
        detectedVideoSrc = state?.src || interceptedVideoUrls[0] || '';
        onProgress(`Video selesai dirender (${elapsedSec} dtk)! Menyiapkan pengunduhan...`);
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

    onProgress(`Membuka pratinjau video hasil render...`);
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

    // Strategi 1: Direct URL Download via intercepted network URLs
    const candidateHttpUrls = [
      ...(detectedVideoSrc && detectedVideoSrc.startsWith('http') ? [detectedVideoSrc] : []),
      ...interceptedVideoUrls
    ];

    for (const directUrl of candidateHttpUrls) {
      if (isSavedSuccess) break;
      try {
        onProgress(`Mengunduh stream video langsung dari URL...`);
        await downloadFileFromUrl(directUrl, sessionVideoPath);
        if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 20000) {
          isSavedSuccess = true;
          onProgress(`Video berhasil diunduh langsung (${Math.round(fs.statSync(sessionVideoPath).size / 1024)} KB)!`);
          break;
        }
      } catch (e) {}
    }

    // Strategi 2: Klik Tombol Unduh UI Fisik
    if (!isSavedSuccess) {
      const dlBtnPos = await cdp.findElementCenter({
        selector: 'button, [role="button"], a[download]',
        textRegexStr: 'download|unduh',
        maxY: 650
      });

      if (dlBtnPos) {
        onProgress(`Menekan tombol Unduh di Google Flow...`);
        await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 1200);

        const priorityRes = cleanRes === '720p' ? ['720p', '1080p', '360p'] : ['360p', '720p'];
        for (const rLabel of priorityRes) {
          const resMenuPos = await cdp.findElementCenter({
            selector: 'flow-menu-item, button[role="menuitem"], .cdk-overlay-container button, span',
            textRegexStr: rLabel
          });
          if (resMenuPos) {
            onProgress(`Memilih resolusi unduhan (${rLabel})...`);
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
              if (fs.statSync(downloadedFullPath).size > 20000) {
                fs.copyFileSync(downloadedFullPath, sessionVideoPath);
                isSavedSuccess = true;
                onProgress(`Video berhasil diunduh via menu Unduh!`);
                break;
              }
            }
          }
          if (interceptedVideoUrls.length > 0) {
            try {
              await downloadFileFromUrl(interceptedVideoUrls[0], sessionVideoPath);
              if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 20000) {
                isSavedSuccess = true;
                onProgress(`Video berhasil diunduh dari stream unduhan!`);
                break;
              }
            } catch (e) {}
          }
        }
      }
    }

    // Strategi 3: Fetch Blob Memory / Base64 Langsung dari Pemutar Video
    if (!isSavedSuccess) {
      onProgress(`Mengekstrak biner video dari buffer pemutar browser...`);
      const base64VideoRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (async () => {
            try {
              const vids = Array.from(document.querySelectorAll('video'));
              const targetVid = vids.find(v => v.currentSrc || v.src || v.querySelector('source')) || vids[0];
              if (!targetVid) return { error: 'Elemen <video> tidak ditemukan.' };

              const url = targetVid.currentSrc || targetVid.src || (targetVid.querySelector('source') ? targetVid.querySelector('source').src : '');
              if (!url) return { error: 'URL sumber video kosong.' };

              let response = null;
              try {
                response = await fetch(url);
              } catch (e1) {
                response = await fetch(url, { credentials: 'include' });
              }

              if (!response || !response.ok) return { error: 'HTTP ' + (response ? response.status : 'Failed'), url };

              const blob = await response.blob();
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64 = String(reader.result || '').split(',')[1] || '';
                  resolve({ base64, url });
                };
                reader.onerror = () => resolve({ error: 'Gagal membaca FileReader.', url });
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
        onProgress(`Video berhasil diekstrak dari pemutar (${Math.round(videoBuffer.length / 1024)} KB)!`);
      } else if (extracted?.url && extracted.url.startsWith('http')) {
        try {
          await downloadFileFromUrl(extracted.url, sessionVideoPath);
          if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 20000) {
            isSavedSuccess = true;
          }
        } catch (e) {}
      }
    }

    try {
      if (fs.existsSync(tempDownloadDir)) fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    } catch (e) {}

    if (!isSavedSuccess || !fs.existsSync(sessionVideoPath) || fs.statSync(sessionVideoPath).size < 20000) {
      throw new Error('Gagal mengunduh berkas video jadi dari Google Flow.');
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

    onProgress(`Profil difinalisasi & video tersimpan: ${videoFileName}`);
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
  ensureActiveAccountWithSufficientCredits
};