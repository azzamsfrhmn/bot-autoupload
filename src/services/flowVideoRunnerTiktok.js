/**
 * src/services/flowVideoRunnerTiktok.js
 * Arsitektur Pure Raw CDP Khusus TikTok Affiliate & Veo Pro
 * Dilengkapi Deteksi & Auto-Recovery Error Audio Google Flow (Video Senyap)
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
const OUTPUT_IMG_DIR = path.resolve(ROOT_DIR, 'storage/images');
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const STORYBOARDS_DIR = path.resolve(ROOT_DIR, 'storage/storyboards');

[FLOW_BASE_DIR, SESSIONS_VIDEOS_DIR, OUTPUT_VIDEOS_DIR, SESSIONS_IMG_DIR, OUTPUT_IMG_DIR, BAHAN_VIDEO_DIR, STORYBOARDS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanDelay(min = 420, max = 650) {
  await sleep(Math.floor(min + Math.random() * (max - min)));
}

let isGenerateSlotBusy = false;
const slotWaitQueue = [];

async function acquireGenerateSlot(onProgress) {
  if (!isGenerateSlotBusy) {
    isGenerateSlotBusy = true;
    onProgress(`[ANTRIAN TIKTOK] Slot generate siap.`);
    return;
  }
  onProgress(`[ANTRIAN TIKTOK] Menunggu slot generate kosong...`);
  await new Promise((resolve) => slotWaitQueue.push(resolve));
  isGenerateSlotBusy = true;
  onProgress(`[ANTRIAN TIKTOK] Slot generate siap.`);
}

async function releaseGenerateSlot(onProgress) {
  onProgress(`[ANTRIAN TIKTOK] Menahan jeda finalisasi...`);
  await sleep(3500);
  isGenerateSlotBusy = false;
  onProgress(`[ANTRIAN TIKTOK] Slot generate dilepas.`);
  if (slotWaitQueue.length > 0) {
    const next = slotWaitQueue.shift();
    if (typeof next === 'function') next();
  }
}

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
        for (const [, p] of this.pending) p.reject(new Error('Koneksi CDP tertutup.'));
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

  async nativeClickAt(x, y, delayAfter = 500) {
    const jitterX = x + Math.floor(Math.random() * 4 - 2);
    const jitterY = y + Math.floor(Math.random() * 4 - 2);

    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: jitterX, y: jitterY });
    await sleep(80);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
    await sleep(delayAfter);
  }

  async nativeDragAndDrop(startX, startY, endX, endY) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY });
    await sleep(200);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
    await sleep(300);

    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(startX + ((endX - startX) * i) / steps);
      const curY = Math.round(startY + ((endY - startY) * i) / steps);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY, button: 'left' });
      await sleep(20);
    }

    await sleep(300);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left', clickCount: 1 });
    await sleep(900);
  }

  async sendCtrlV() {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await sleep(60);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  }

  async pressKey(key, windowsVirtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode });
    await sleep(50);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode });
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
        await this.send('DOM.setFileInputFiles', { nodeId: query.nodeId, files: [filePath] });
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

  return candidates.find((p) => fs.existsSync(p));
}

function purgeTransientSessionData(profileDir) {
  if (!fs.existsSync(profileDir)) return;
  const lockFiles = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
    'RunningChromeVersion'
  ];

  lockFiles.forEach((file) => {
    const fPath = path.join(profileDir, file);
    if (fs.existsSync(fPath)) {
      try { fs.unlinkSync(fPath); } catch (e) {}
    }
  });

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
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--metrics-recording-only',
    '--window-size=1220,920',
    '--window-position=40,30',
    'https://flow.google.com/'
  ];
}

async function getPageWebSocketUrl(port, maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const vRes = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
      if (vRes && vRes.ok) {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
        if (res && res.ok) {
          const tabs = await res.json();
          const pageTab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          if (pageTab) return pageTab.webSocketDebuggerUrl;

          if (tabs.length === 0 || !pageTab) {
            const newTabRes = await fetch(`http://127.0.0.1:${port}/json/new?https://flow.google.com/`).catch(() => null);
            if (newTabRes && newTabRes.ok) {
              const newTab = await newTabRes.json();
              if (newTab.webSocketDebuggerUrl) return newTab.webSocketDebuggerUrl;
            }
          }
        }
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
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

  const targetDir = path.join(FLOW_BASE_DIR, accountId);
  if (fs.existsSync(targetDir)) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) {}
  }

  try {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('flow-accounts-updated');
    });
  } catch (e) {}

  return { success: true, cfg };
}

async function ensureActiveAccountWithSufficientCredits(onProgress = () => {}) {
  const cfg = getFlowAccountsConfigRaw();
  if (!cfg.accounts || cfg.accounts.length === 0) {
    cfg.accounts = [{ id: 'acc_1', name: 'Akun 1 (Utama)', status: 'Sesi Aktif', credits: 'Tersedia' }];
    cfg.activeAccountId = 'acc_1';
    saveFlowAccountsConfig(cfg);
  }

  let active = cfg.accounts.find((a) => a.id === cfg.activeAccountId) || cfg.accounts[0];
  return active;
}

async function extractCurrentFlowCredits(cdp) {
  try {
    const creditVal = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const candidates = Array.from(document.querySelectorAll('button, span, div, p, [aria-label]')).filter(el => {
            const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
            return /(\\d+)\\s*(?:kredit|credits?)/i.test(txt);
          });

          for (const el of candidates) {
            const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
            const m = txt.match(/(\\d+)\\s*(?:kredit|credits?)/i);
            if (m && !isNaN(Number(m[1]))) {
              return Number(m[1]);
            }
          }
          return null;
        })()
      `,
      returnByValue: true
    }).then(res => res?.result?.value).catch(() => null);

    return (typeof creditVal === 'number') ? creditVal : null;
  } catch (e) {
    return null;
  }
}

function parseAllPrompts(txt) {
  const result = { photo1: '', photo2: '', photo3: '', video: '' };
  if (!txt || typeof txt !== 'string') txt = '';

  const m1 = txt.match(/PHOTO\s*1[\s:]*([\s\S]*?)(?=PHOTO\s*2|$)/i);
  const m2 = txt.match(/PHOTO\s*2[\s:]*([\s\S]*?)(?=PHOTO\s*3|$)/i);
  const m3 = txt.match(/PHOTO\s*3[\s:]*([\s\S]*?)(?=VIDEO\s*PROMPT|$)/i);
  const mv = txt.match(/VIDEO\s*PROMPT[\s:]*([\s\S]*?)(?=PANDUAN|$)/i);

  if (m1 && m1[1]) result.photo1 = m1[1].replace(/[\r\n]+/g, ' ').trim();
  if (m2 && m2[1]) result.photo2 = m2[1].replace(/[\r\n]+/g, ' ').trim();
  if (m3 && m3[1]) result.photo3 = m3[1].replace(/[\r\n]+/g, ' ').trim();
  if (mv && mv[1]) result.video = mv[1].replace(/[\r\n]+/g, ' ').trim();

  const cleanBase = txt.replace(/[\r\n]+/g, ' ').trim() || 'Indonesian modern model wearing the outfit, raw smartphone photo, authentic skin texture with visible pores, ultra realistic 4k';
  if (!result.photo1) result.photo1 = `${cleanBase}, candid front view pose, smiling naturally, mobile photography, 8k resolution`;
  if (!result.photo2) result.photo2 = `${cleanBase}, dynamic side view angle, casual lifestyle movement, natural lighting, ultra detailed`;
  if (!result.photo3) result.photo3 = `${cleanBase}, close-up detail shot showing fabric texture, authentic unedited photo, sharp focus`;
  
  if (!result.video) {
    result.video = `${cleanBase}, completely static locked-off camera, tripod shot, no camera movement, no zoom, subtle natural candid movement, silent video, muted, no background audio, 4k ultra high details`;
  } else if (!result.video.toLowerCase().includes('silent')) {
    result.video = `${result.video}, completely static locked-off camera, no zoom, silent video, muted, no background audio`;
  }

  return result;
}

function resolveTiktokAssets(projectFolder, explicitImagePath = null) {
  let targetFolder = projectFolder;
  if (!targetFolder || !fs.existsSync(targetFolder)) {
    const list = fs.readdirSync(BAHAN_VIDEO_DIR)
      .filter((d) => d.startsWith('proyek_tiktok_') && fs.statSync(path.join(BAHAN_VIDEO_DIR, d)).isDirectory())
      .map((d) => path.join(BAHAN_VIDEO_DIR, d));
    list.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
    targetFolder = list[0] || '';
  }

  let canvasPath = explicitImagePath && fs.existsSync(explicitImagePath) ? explicitImagePath : '';
  let promptText = '';

  if (targetFolder && fs.existsSync(targetFolder)) {
    if (!canvasPath) {
      const c1 = path.join(targetFolder, 'storyboard_canvas.png');
      if (fs.existsSync(c1)) canvasPath = c1;
    }

    const p1 = path.join(targetFolder, 'prompt_video.txt');
    if (fs.existsSync(p1)) promptText = fs.readFileSync(p1, 'utf-8');
  }

  if (!canvasPath && fs.existsSync(STORYBOARDS_DIR)) {
    const sbFiles = fs.readdirSync(STORYBOARDS_DIR)
      .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.includes('thumb'))
      .map((f) => path.join(STORYBOARDS_DIR, f));
    sbFiles.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
    canvasPath = sbFiles[0] || '';
  }

  return { targetFolder, canvasPath, promptText };
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
    platform: 'tiktok',
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

async function getFirstCanvasImageTile(cdp) {
  const res = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const tiles = Array.from(document.querySelectorAll('flow-canvas-tile img, flow-media-tile img, .media-strip img, [data-media-id] img, img[alt*="gambar pengguna" i]')).filter(img => {
          const r = img.getBoundingClientRect();
          return r.top > 60 && r.top < 650 && r.width > 35 && r.height > 35;
        });

        if (tiles.length === 0) {
          const allImgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const r = img.getBoundingClientRect();
            return r.top > 60 && r.top < 650 && r.width > 35 && r.height > 35 && !img.src.includes('avatar');
          });
          if (allImgs.length > 0) {
            allImgs.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
            const r = allImgs[0].getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }
          return null;
        }

        tiles.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
        const r = tiles[0].getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `,
    returnByValue: true
  }).catch(() => null);

  return res?.result?.value || null;
}

// FUNGSI AUTO-RECOVERY: DETEKSI ERROR AUDIO GOOGLE FLOW & NYALAKAN VIDEO SENYAP
async function handleAudioFailureAndEnableSilentVideo(cdp, onProgress) {
  try {
    const errorDetected = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEls = Array.from(document.querySelectorAll('.error-message, .error-title, span')).filter(el => {
            const txt = (el.innerText || el.textContent || '').trim();
            return txt.includes('Pembuatan audio gagal') || txt.includes('audio gagal');
          });
          return errEls.length > 0;
        })()
      `,
      returnByValue: true
    }).then(res => res?.result?.value).catch(() => false);

    if (errorDetected) {
      onProgress('[AUTO-RECOVERY] Terdeteksi kendala audio Google Flow. Memperbaiki setelan...');

      // 1. Klik tombol Setelan (settings_2)
      const settingsPos = await cdp.findElementCenter({
        selector: 'button, [role="button"]',
        textRegexStr: 'setelan|settings',
        minY: 50,
        maxY: 750
      });

      if (settingsPos) {
        await cdp.nativeClickAt(settingsPos.x, settingsPos.y, 1000);
      } else {
        const fallbackSettings = await cdp.findElementCenter({
          selector: 'button:has(mat-icon), button',
          minY: 50,
          maxY: 750,
          pickLast: true
        });
        if (fallbackSettings) await cdp.nativeClickAt(fallbackSettings.x, fallbackSettings.y, 1000);
      }

      await sleep(1000);

      // 2. Nyalakan Toggle "Tampilkan video senyap"
      const togglePos = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const toggles = Array.from(document.querySelectorAll('button[role="switch"], mat-slide-toggle, .mdc-switch')).filter(el => {
              const isChecked = el.getAttribute('aria-checked') === 'true' || el.classList.contains('mdc-switch--checked');
              return !isChecked;
            });
            if (toggles.length === 0) return null;
            const r = toggles[0].getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()
        `,
        returnByValue: true
      }).then(res => res?.result?.value).catch(() => null);

      if (togglePos) {
        onProgress('[AUTO-RECOVERY] Mengaktifkan tombol "Tampilkan video senyap"...');
        await cdp.nativeClickAt(togglePos.x, togglePos.y, 800);
      }

      await sleep(800);
      await cdp.pressKey('Escape', 27);
      await sleep(800);

      // 3. Klik Tombol "Coba lagi" (Refresh)
      onProgress('[AUTO-RECOVERY] Menekan tombol "Coba lagi" (refresh)...');
      const retryPos = await cdp.findElementCenter({
        selector: 'button, [role="button"]',
        textRegexStr: 'refresh|coba lagi|retry',
        minY: 60,
        maxY: 780
      });

      if (retryPos) {
        await cdp.nativeClickAt(retryPos.x, retryPos.y, 1500);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// 2. UNDUH GAMBAR UKURAN ASLI / 1K (CEPAT, TANPA JEDA UPSCALING & ANTI-CORS)
async function downloadAndSaveFlowImage2K(cdp, tempDownloadDir, photoIndex, promptText, onProgress) {
  const timestamp = Date.now();
  const fileName = `img_candid_${photoIndex}_${timestamp}.png`;
  const sessionImgPath = path.resolve(ROOT_DIR, 'sessions/generated_images', fileName);
  const storageImgPath = path.resolve(ROOT_DIR, 'storage/images', fileName);

  [path.dirname(sessionImgPath), path.dirname(storageImgPath)].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  onProgress(`[DOWNLOAD 1K] Membuka kartu gambar candid ${photoIndex} terbaru...`);

  const latestTilePos = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const tiles = Array.from(document.querySelectorAll('flow-canvas-tile img, flow-media-tile img, .media-strip img, [data-media-id] img, img[alt*="gambar pengguna" i]')).filter(img => {
          const r = img.getBoundingClientRect();
          return r.top > 60 && r.top < 650 && r.width > 40 && r.height > 40 && !img.src.includes('avatar');
        });

        if (tiles.length === 0) return null;

        tiles.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const target = tiles[0];
        target.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = target.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `,
    returnByValue: true
  }).then(res => res?.result?.value).catch(() => null);

  if (latestTilePos) {
    await cdp.nativeClickAt(latestTilePos.x, latestTilePos.y, 1500);
  } else {
    const fallbackPos = await cdp.waitForElementCenter({
      selector: 'flow-canvas-tile img, flow-media-tile img, .media-strip img',
      pickLast: false,
      minY: 70,
      maxY: 650
    }, 4000);
    if (fallbackPos) await cdp.nativeClickAt(fallbackPos.x, fallbackPos.y, 1500);
  }

  if (fs.existsSync(tempDownloadDir)) {
    fs.readdirSync(tempDownloadDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tempDownloadDir, f)); } catch (e) {}
    });
  }

  let isDownloaded = false;

  onProgress(`[DOWNLOAD 1K] Mengambil URL biner gambar asli dari CDN Flow...`);
  const imgSrcUrl = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
          const r = i.getBoundingClientRect();
          return r.width > 200 && r.height > 200 && !i.src.includes('avatar');
        });
        if (imgs.length === 0) return null;
        imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
        return imgs[0].currentSrc || imgs[0].src || null;
      })()
    `,
    returnByValue: true
  }).then(res => res?.result?.value).catch(() => null);

  if (imgSrcUrl && imgSrcUrl.startsWith('http')) {
    try {
      await downloadFileFromUrl(imgSrcUrl, sessionImgPath);
      if (fs.existsSync(sessionImgPath) && fs.statSync(sessionImgPath).size > 15000) {
        fs.copyFileSync(sessionImgPath, storageImgPath);
        isDownloaded = true;
      }
    } catch (e) {}
  }

  if (!isDownloaded) {
    onProgress(`[DOWNLOAD 1K] Mengklik menu unduh peramban...`);
    const dlBtnPos = await cdp.waitForElementCenter({
      selector: 'button[aria-label*="Unduh" i], button[aria-label*="Download" i], button, [role="button"]',
      textRegexStr: '^\\s*(Unduh|Download)\\s*$',
      maxY: 680,
      pickLast: true
    }, 4000);

    if (dlBtnPos) {
      await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 800);

      const optionOriginalPos = await cdp.waitForElementCenter({
        selector: '.mat-mdc-menu-panel button, [role="menuitem"], flow-menu-item, span, div',
        textRegexStr: 'Asli|Original|Standar|1K|Default'
      }, 3000);

      if (optionOriginalPos) {
        await cdp.nativeClickAt(optionOriginalPos.x, optionOriginalPos.y, 1000);
      }

      for (let w = 0; w < 10; w++) {
        await sleep(600);
        if (fs.existsSync(tempDownloadDir)) {
          const files = fs.readdirSync(tempDownloadDir).filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
          if (files.length > 0) {
            const downloadedPath = path.join(tempDownloadDir, files[0]);
            const stats = fs.statSync(downloadedPath);
            if (stats.size > 15000) {
              fs.copyFileSync(downloadedPath, sessionImgPath);
              fs.copyFileSync(downloadedPath, storageImgPath);
              try { fs.unlinkSync(downloadedPath); } catch (e) {}
              isDownloaded = true;
              break;
            }
          }
        }
      }
    }
  }

  if (!isDownloaded) {
    const imgRect = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
            const r = i.getBoundingClientRect();
            return r.width > 200 && r.height > 200 && !i.src.includes('avatar');
          });
          if (imgs.length === 0) return null;
          imgs.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height));
          const r = imgs[0].getBoundingClientRect();
          return {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
        })()
      `,
      returnByValue: true
    }).then(res => res?.result?.value).catch(() => null);

    if (imgRect && imgRect.width > 80 && imgRect.height > 80) {
      const shotData = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: imgRect.x,
          y: imgRect.y,
          width: imgRect.width,
          height: imgRect.height,
          scale: 1
        }
      }).catch(() => null);

      if (shotData?.data) {
        const buffer = Buffer.from(shotData.data, 'base64');
        if (buffer.length > 15000) {
          fs.writeFileSync(sessionImgPath, buffer);
          fs.writeFileSync(storageImgPath, buffer);
          isDownloaded = true;
        }
      }
    }
  }

  if (!isDownloaded || !fs.existsSync(sessionImgPath) || fs.statSync(sessionImgPath).size < 10000) {
    throw new Error(`[VERIFIKASI GAGAL] Foto candid ${photoIndex} belum berhasil disimpan ke penyimpanan lokal!`);
  }

  const metaItem = {
    id: `img_${timestamp}`,
    fileName: fileName,
    filePath: sessionImgPath,
    storagePath: storageImgPath,
    prompt: promptText || '',
    aspectRatio: '9:16',
    createdAt: new Date().toISOString(),
    timestamp: timestamp
  };

  const metaFiles = [
    path.resolve(ROOT_DIR, 'sessions/generated_images/metadata.json'),
    path.resolve(ROOT_DIR, 'storage/images/metadata.json')
  ];

  metaFiles.forEach((mf) => {
    try {
      let list = [];
      if (fs.existsSync(mf)) {
        try { list = JSON.parse(fs.readFileSync(mf, 'utf-8')); } catch (e) {}
      }
      if (!Array.isArray(list)) list = [];
      list.unshift(metaItem);
      fs.writeFileSync(mf, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {}
  });

  try {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('refresh-images-gallery', metaItem);
        win.webContents.send('refresh-image-storage', metaItem);
      }
    });
  } catch (e) {}

  const finalSizeKb = Math.round(fs.statSync(sessionImgPath).size / 1024);
  onProgress(`[TERVERIFIKASI] Foto candid ${photoIndex} berhasil disimpan (${finalSizeKb} KB) dan terdaftar di Galeri Gambar!`);

  const closeBtnPos = await cdp.findElementCenter({
    selector: 'button, [role="button"], span',
    textRegexStr: '^\\s*(Selesai|Tutup|Close)\\s*$',
    minY: 10,
    maxY: 120
  });

  if (closeBtnPos) {
    await cdp.nativeClickAt(closeBtnPos.x, closeBtnPos.y, 600);
  } else {
    await cdp.pressKey('Escape', 27);
  }
  await sleep(800);
}

async function submitPromptAndGenerate(cdp, promptStr, onProgress, stepName) {
  onProgress(`[${stepName}] Menempelkan teks prompt...`);
  clipboard.writeText(promptStr);
  await sleep(200);

  const editorPos = await cdp.waitForElementCenter({
    selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
  }, 10000);
  if (!editorPos) throw new Error('Kotak input prompt tidak ditemukan.');

  await cdp.nativeClickAt(editorPos.x, editorPos.y, 350);
  await cdp.sendCtrlV();
  await humanDelay(800, 1200);

  onProgress(`[${stepName}] Menekan tombol Generate...`);
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

  onProgress(`[${stepName}] Sedang diproses oleh Google Flow...`);
  await sleep(7000);

  const startWait = Date.now();
  while (Date.now() - startWait < 180000) {
    // Periksa apakah terjadi error audio, jika ya lakukan auto-recovery otomatis
    await handleAudioFailureAndEnableSilentVideo(cdp, onProgress);

    const isSpinning = await cdp.findElementCenter({
      selector: '.loading-percentage, mat-progress-spinner, flow-soupy-overlay'
    });
    if (!isSpinning) break;
    await sleep(2500);
  }

  onProgress(`[${stepName}] Selesai!`);
  await sleep(2000);
}

// =========================================================================
// PIPELINE UTAMA FLOW TIKTOK
// =========================================================================
async function runFlowProjectCreationTiktok({
  projectFolder = null,
  storyboardImagePath = null,
  promptText = null,
  flowRatio = '9:16',
  flowModel = 'Veo 3.1 - Lite',
  flowResolution = '720p',
  flowDuration = '8 Detik',
  onProgress = () => {}
}) {
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath) return { success: false, error: 'Google Chrome tidak ditemukan.' };

  const { targetFolder, canvasPath, promptText: filePromptText } = resolveTiktokAssets(projectFolder, storyboardImagePath);
  if (!canvasPath || !fs.existsSync(canvasPath)) {
    return { success: false, error: 'Berkas kanvas referensi TikTok tidak ditemukan.' };
  }

  const rawPrompts = promptText && promptText.length > 50 ? promptText : filePromptText;
  const parsedPrompts = parseAllPrompts(rawPrompts);

  await acquireGenerateSlot(onProgress);

  const MINIMUM_REQUIRED_CREDITS = 12;
  let targetAcc = await ensureActiveAccountWithSufficientCredits(onProgress);
  let chromeProcess = null;
  let cdp = null;

  const tempDownloadDir = path.resolve(ROOT_DIR, 'temp/flow_dl_tt_' + Date.now());
  if (!fs.existsSync(tempDownloadDir)) fs.mkdirSync(tempDownloadDir, { recursive: true });

  try {
    let accountsChecked = 0;
    const maxAccountsToTry = 5;

    while (accountsChecked < maxAccountsToTry) {
      accountsChecked++;
      const profileDir = getProfileDirForAccount(targetAcc?.id || 'acc_1');
      purgeTransientSessionData(profileDir);

      const cdpPort = 51000 + Math.floor(Math.random() * 13000);
      onProgress(`Membuka sesi Google Flow (${targetAcc.name} · Port CDP: ${cdpPort})...`);
      chromeProcess = spawn(chromePath, getFlowChromeArgs(cdpPort, profileDir), { detached: false, stdio: 'ignore' });

      const wsUrl = await getPageWebSocketUrl(cdpPort, 40);
      if (!wsUrl) throw new Error(`Gagal mendapatkan WebSocket CDP pada port ${cdpPort}.`);

      cdp = new RawCDPClient(wsUrl);
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('DOM.enable');
      await cdp.send('Network.enable');

      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: tempDownloadDir,
        eventsEnabled: true
      }).catch(() => {});

      onProgress(`Memeriksa saldo kredit ${targetAcc.name}...`);
      await sleep(4000);

      const currentCredits = await extractCurrentFlowCredits(cdp);

      if (currentCredits !== null) {
        onProgress(`Saldo ${targetAcc.name}: ${currentCredits} Kredit.`);

        const cfg = getFlowAccountsConfigRaw();
        const accInCfg = (cfg.accounts || []).find((a) => a.id === targetAcc.id);
        if (accInCfg) {
          accInCfg.credits = `${currentCredits} Kredit`;
          saveFlowAccountsConfig(cfg);
          try {
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) win.webContents.send('flow-accounts-updated', cfg);
            });
          } catch (e) {}
        }

        if (currentCredits < MINIMUM_REQUIRED_CREDITS) {
          onProgress(`[PERINGATAN] Kredit ${targetAcc.name} tersisa ${currentCredits} (< ${MINIMUM_REQUIRED_CREDITS}). Beralih ke akun berikutnya...`);

          try { await cdp.send('Browser.close'); } catch (e) {}
          cdp.close();
          if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
          await sleep(1500);

          const allAccounts = cfg.accounts || [];
          const currentIndex = allAccounts.findIndex((a) => a.id === targetAcc.id);
          const nextAcc = allAccounts[(currentIndex + 1) % allAccounts.length];

          if (!nextAcc || nextAcc.id === targetAcc.id) {
            throw new Error(`Semua akun Google Flow memiliki kredit kurang dari ${MINIMUM_REQUIRED_CREDITS}. Silakan tambahkan akun baru di Pengaturan AI.`);
          }

          cfg.activeAccountId = nextAcc.id;
          saveFlowAccountsConfig(cfg);
          targetAcc = nextAcc;
          continue;
        }
      }

      break;
    }

    const interceptedVideoUrls = [];
    cdp.on('Network.responseReceived', (params) => {
      const respUrl = params.response?.url || '';
      const mimeType = (params.response?.mimeType || '').toLowerCase();
      if (
        respUrl.startsWith('http') &&
        !respUrl.includes('.js') &&
        (mimeType.includes('video/') ||
          respUrl.includes('googlevideo.com/videoplayback') ||
          respUrl.includes('.mp4') ||
          (respUrl.includes('googleusercontent.com') && mimeType.includes('octet-stream')))
      ) {
        if (!interceptedVideoUrls.includes(respUrl)) interceptedVideoUrls.unshift(respUrl);
      }
    });

    onProgress('Menunggu halaman Google Flow siap...');
    await sleep(2500);

    onProgress(`Membuat Project Baru di Google Flow menggunakan ${targetAcc.name}...`);
    const newProjPos = await cdp.waitForElementCenter({
      selector: 'button, a, [role="button"], span',
      textRegexStr: '^\\s*(\\+\\s*)?(Project baru|New project|Buat project)\\s*$'
    }, 15000);
    if (newProjPos) await cdp.nativeClickAt(newProjPos.x, newProjPos.y, 3500);

    onProgress('Mengatur setelan awal ke Tab Gambar (Nano Banana, 9:16, x1)...');
    const pillPosImg = await cdp.waitForElementCenter({
      selector: 'button[aria-label="Pemicu setelan"], button.settings-trigger-button, button',
      textRegexStr: 'Nano Banana|Imagen|Veo|Omni|Video|Gambar|x[1-4]',
      minY: 500,
      pickLast: true
    }, 10000);

    if (pillPosImg) {
      await cdp.nativeClickAt(pillPosImg.x, pillPosImg.y, 700);

      const tabGambar = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="tab"], span',
        textRegexStr: '^\\s*Gambar\\s*$'
      });
      if (tabGambar) await cdp.nativeClickAt(tabGambar.x, tabGambar.y, 500);

      const r916 = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, span',
        textRegexStr: '^\\s*9:16\\s*$'
      });
      if (r916) await cdp.nativeClickAt(r916.x, r916.y, 500);

      const x1Btn = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, span',
        textRegexStr: '^\\s*x1\\s*$'
      });
      if (x1Btn) await cdp.nativeClickAt(x1Btn.x, x1Btn.y, 500);

      await cdp.pressKey('Escape', 27);
      await sleep(800);
    }

    onProgress('[PHOTO CANDID 1] Mengunggah master referensi kanvas...');
    const editorPos = await cdp.waitForElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }, 15000);
    if (!editorPos) throw new Error('Kotak input prompt tidak ditemukan.');

    const img = nativeImage.createFromPath(canvasPath);
    clipboard.writeImage(img);
    await sleep(250);

    await cdp.nativeClickAt(editorPos.x, editorPos.y, 400);
    await cdp.sendCtrlV();
    await sleep(2500);

    const hasImg = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor img, .prompt-media-preview img, flow-canvas-tile img'
    });
    if (!hasImg) {
      await cdp.setNativeFileInput(canvasPath);
      await sleep(2500);
    }

    for (let w = 0; w < 30; w++) {
      const loading = await cdp.findElementCenter({ selector: '.loading-percentage, flow-soupy-overlay' });
      if (!loading) break;
      await sleep(1200);
    }

    await submitPromptAndGenerate(cdp, parsedPrompts.photo1, onProgress, 'PHOTO CANDID 1');
    
    onProgress('[PHOTO CANDID 1] Selesai render! Mengunduh berkas ke Galeri Gambar...');
    await downloadAndSaveFlowImage2K(cdp, tempDownloadDir, 1, parsedPrompts.photo1, onProgress);
    await sleep(1500);

    onProgress('[PHOTO CANDID 2] Menyeret (drag) gambar master ke kotak prompt...');
    const masterTilePos2 = await getFirstCanvasImageTile(cdp);
    const editorPos2 = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    });

    if (masterTilePos2 && editorPos2) {
      await cdp.nativeDragAndDrop(masterTilePos2.x, masterTilePos2.y, editorPos2.x, editorPos2.y);
      await sleep(1200);
    }

    await submitPromptAndGenerate(cdp, parsedPrompts.photo2, onProgress, 'PHOTO CANDID 2');

    onProgress('[PHOTO CANDID 2] Selesai render! Mengunduh berkas ke Galeri Gambar...');
    await downloadAndSaveFlowImage2K(cdp, tempDownloadDir, 2, parsedPrompts.photo2, onProgress);
    await sleep(1500);

    onProgress('[PHOTO CANDID 3] Menyeret (drag) gambar master ke kotak prompt...');
    const masterTilePos3 = await getFirstCanvasImageTile(cdp);
    const editorPos3 = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    });

    if (masterTilePos3 && editorPos3) {
      await cdp.nativeDragAndDrop(masterTilePos3.x, masterTilePos3.y, editorPos3.x, editorPos3.y);
      await sleep(1200);
    }

    await submitPromptAndGenerate(cdp, parsedPrompts.photo3, onProgress, 'PHOTO CANDID 3');

    onProgress('[PHOTO CANDID 3] Selesai render! Mengunduh berkas ke Galeri Gambar...');
    await downloadAndSaveFlowImage2K(cdp, tempDownloadDir, 3, parsedPrompts.photo3, onProgress);
    await sleep(2000);

    let cleanRatio = '9:16';
    if (String(flowRatio).includes('16:9')) cleanRatio = '16:9';
    else if (String(flowRatio).includes('4:5')) cleanRatio = '4:5';

    const cleanRes = String(flowResolution).includes('360') ? '360p' : (String(flowResolution).includes('1080') ? '1080p' : '720p');

    const durMatch = String(flowDuration).match(/\d+/);
    const targetDurNum = durMatch ? durMatch[0] : '8';
    const cleanDuration = `${targetDurNum} dtk`;

    const rawModelStr = String(flowModel || 'Veo 3.1 - Lite');
    const isVeoTarget = rawModelStr.toLowerCase().includes('veo');
    const cleanModelDisplay = isVeoTarget ? 'Veo 3.1' : 'Omni 1.1 Flash';

    onProgress(`Mengubah setelan Video: Rasio ${cleanRatio} · Model ${cleanModelDisplay} · ${cleanRes} · ${cleanDuration}...`);

    const pillPosVid = await cdp.waitForElementCenter({
      selector: 'button[aria-label="Pemicu setelan"], button.settings-trigger-button, button',
      textRegexStr: 'Nano Banana|Imagen|Veo|Omni|Video|Gambar|x[1-4]',
      minY: 500,
      pickLast: true
    }, 10000);

    if (pillPosVid) {
      await cdp.nativeClickAt(pillPosVid.x, pillPosVid.y, 750);

      const tabVideo = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="tab"], span',
        textRegexStr: '^\\s*Video\\s*$'
      });
      if (tabVideo) await cdp.nativeClickAt(tabVideo.x, tabVideo.y, 600);

      const typeBtn = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, span',
        textRegexStr: '^\\s*Bahan\\s*$'
      });
      if (typeBtn) await cdp.nativeClickAt(typeBtn.x, typeBtn.y, 500);

      const ratioBtn = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanRatio.replace(':', '\\s*:\\s*')}\\s*$`,
        minY: 180,
        maxY: 780
      });
      if (ratioBtn) {
        onProgress(`Memilih rasio: ${cleanRatio}...`);
        await cdp.nativeClickAt(ratioBtn.x, ratioBtn.y, 500);
      }

      const modelDropdownTrigger = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"], [role="combobox"]')).filter(el => {
              const r = el.getBoundingClientRect();
              const txt = (el.innerText || el.textContent || '').trim();
              return r.top > 180 && r.top < 780 && r.width > 30 && (txt.includes('Omni') || txt.includes('Veo') || txt.includes('Model'));
            });
            if (btns.length === 0) return null;
            const r = btns[0].getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()
        `,
        returnByValue: true
      }).then(res => res?.result?.value).catch(() => null);

      if (modelDropdownTrigger) {
        await cdp.nativeClickAt(modelDropdownTrigger.x, modelDropdownTrigger.y, 700);

        const targetModelRegex = isVeoTarget ? 'Veo\\s*3(?:\\.1)?|Veo' : 'Omni\\s*1(?:\\.1)?|Omni';
        const targetModelOption = await cdp.waitForElementCenter({
          selector: '.mat-mdc-menu-panel button, [role="menuitem"], [role="option"], flow-menu-item, span, div',
          textRegexStr: targetModelRegex
        }, 5000);

        if (targetModelOption) {
          onProgress(`Memilih model: ${cleanModelDisplay}...`);
          await cdp.nativeClickAt(targetModelOption.x, targetModelOption.y, 600);
        } else {
          await cdp.pressKey('Escape', 27);
          await sleep(300);
        }
      }

      const resBtn = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: `^\\s*${cleanRes}`,
        minY: 180,
        maxY: 780
      });
      if (resBtn) {
        onProgress(`Memilih resolusi video: ${cleanRes}...`);
        await cdp.nativeClickAt(resBtn.x, resBtn.y, 500);
      }

      onProgress(`Memilih durasi: ${targetDurNum} Detik...`);
      let durBtn = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], [role="button"], span',
        textRegexStr: `^\\s*${targetDurNum}\\s*(?:dtk|s|detik)?\\.?\\s*$`,
        minY: 180,
        maxY: 780
      });

      if (!durBtn) {
        durBtn = await cdp.send('Runtime.evaluate', {
          expression: `
            (() => {
              const buttons = Array.from(document.querySelectorAll('mat-button-toggle, button, [role="radio"]')).filter(el => {
                const r = el.getBoundingClientRect();
                return r.top > 180 && r.top < 780 && r.width > 20 && r.height > 20;
              });

              const target = buttons.find(b => {
                const txt = (b.innerText || b.textContent || '').trim();
                return new RegExp('^' + ${JSON.stringify(targetDurNum)} + '(\\\\s*(dtk|s|detik))?$', 'i').test(txt);
              });

              if (!target) return null;
              target.scrollIntoView({ behavior: 'instant', block: 'center' });
              const rect = target.getBoundingClientRect();
              return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
            })()
          `,
          returnByValue: true
        }).then(res => res?.result?.value).catch(() => null);
      }

      if (durBtn) {
        await cdp.nativeClickAt(durBtn.x, durBtn.y, 500);
      } else {
        const durFallback = await cdp.findElementCenter({
          selector: 'mat-button-toggle, button, [role="radio"], span',
          textRegexStr: '8 dtk|8s|6 dtk|6s|10 dtk|4 dtk',
          minY: 180,
          maxY: 780
        });
        if (durFallback) await cdp.nativeClickAt(durFallback.x, durFallback.y, 500);
      }

      const x1Pos = await cdp.findElementCenter({
        selector: 'mat-button-toggle, button, [role="radio"], span',
        textRegexStr: '^\\s*x1\\s*$',
        minY: 180,
        maxY: 780
      });
      if (x1Pos) {
        await cdp.nativeClickAt(x1Pos.x, x1Pos.y, 500);
      }

      await cdp.pressKey('Escape', 27);
      await sleep(800);
    }

    onProgress('[VIDEO TIKTOK] Menyeret (drag) gambar master ke kotak prompt video...');
    const masterTilePosVid = await getFirstCanvasImageTile(cdp);
    const editorPosVid = await cdp.findElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    });

    if (masterTilePosVid && editorPosVid) {
      await cdp.nativeDragAndDrop(masterTilePosVid.x, masterTilePosVid.y, editorPosVid.x, editorPosVid.y);
      await sleep(1200);
    }

    interceptedVideoUrls.length = 0;
    await submitPromptAndGenerate(cdp, parsedPrompts.video, onProgress, 'VIDEO MOTION TIKTOK');

    const timestamp = Date.now();
    const videoFileName = `video_tiktok_${timestamp}.mp4`;
    const sessionVideoPath = path.join(SESSIONS_VIDEOS_DIR, videoFileName);
    const storageVideoPath = path.join(OUTPUT_VIDEOS_DIR, videoFileName);

    onProgress('Membuka pratinjau video TikTok terbaru (kartu terdepan)...');

    const videoTilePos = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const tiles = Array.from(document.querySelectorAll('flow-video-tile, flow-media-tile, flow-canvas-tile, .media-strip flow-video-tile, video')).filter(el => {
            const r = el.getBoundingClientRect();
            return r.top > 60 && r.top < 650 && r.width > 40 && r.height > 40;
          });

          if (tiles.length === 0) return null;

          tiles.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          const target = tiles[0];
          target.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = target.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()
      `,
      returnByValue: true
    }).then(res => res?.result?.value).catch(() => null);

    if (videoTilePos) {
      await cdp.nativeClickAt(videoTilePos.x, videoTilePos.y, 2500);
    } else {
      const fallbackCard = await cdp.waitForElementCenter({
        selector: 'flow-video-tile, video',
        minY: 80,
        maxY: 750
      }, 5000);
      if (fallbackCard) await cdp.nativeClickAt(fallbackCard.x, fallbackCard.y, 2500);
    }

    let isSavedSuccess = false;

    onProgress('Mengekstrak stream video langsung dari pemutar...');
    const domVideoSrc = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const v = document.querySelector('video[src], video');
          if (v) {
            return v.currentSrc || v.src || '';
          }
          return '';
        })()
      `,
      returnByValue: true
    }).then(res => res?.result?.value).catch(() => '');

    if (domVideoSrc && domVideoSrc.startsWith('http') && !domVideoSrc.startsWith('blob:')) {
      if (!interceptedVideoUrls.includes(domVideoSrc)) {
        interceptedVideoUrls.unshift(domVideoSrc);
      }
    }

    if (interceptedVideoUrls.length > 0) {
      for (const vUrl of interceptedVideoUrls) {
        try {
          onProgress('Mengunduh stream biner video...');
          await downloadFileFromUrl(vUrl, sessionVideoPath);
          if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 30000) {
            isSavedSuccess = true;
            break;
          }
        } catch (e) {}
      }
    }

    if (!isSavedSuccess) {
      onProgress('Menekan tombol unduh video di antarmuka Flow...');
      const dlBtnPos = await cdp.waitForElementCenter({
        selector: 'button[aria-label*="Unduh" i], button[aria-label*="Download" i], button, a[download]',
        textRegexStr: '^\\s*(Unduh|Download)\\s*$',
        maxY: 680,
        pickLast: true
      }, 7000);

      if (dlBtnPos) {
        await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 1200);

        const resMenuPos = await cdp.findElementCenter({
          selector: '.mat-mdc-menu-panel button, flow-menu-item, span, div',
          textRegexStr: `${cleanRes}|Original|Asli|720p|1080p`
        });
        if (resMenuPos) await cdp.nativeClickAt(resMenuPos.x, resMenuPos.y, 1500);

        for (let waitDl = 0; waitDl < 50; waitDl++) {
          await sleep(1000);
          if (fs.existsSync(tempDownloadDir)) {
            const allFiles = fs.readdirSync(tempDownloadDir);
            const dlFiles = allFiles.filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && /\.(mp4|webm|mov)$/i.test(f));
            if (dlFiles.length > 0) {
              const fullPath = path.join(tempDownloadDir, dlFiles[0]);
              if (fs.statSync(fullPath).size > 30000) {
                fs.copyFileSync(fullPath, sessionVideoPath);
                isSavedSuccess = true;
                break;
              }
            }
          }
        }
      }
    }

    if (!isSavedSuccess || !fs.existsSync(sessionVideoPath) || fs.statSync(sessionVideoPath).size < 30000) {
      throw new Error('Gagal mengunduh video jadi dari Google Flow.');
    }

    fs.copyFileSync(sessionVideoPath, storageVideoPath);

    const videoResult = registerVideoToMetadata(
      videoFileName,
      sessionVideoPath,
      storageVideoPath,
      parsedPrompts.video,
      canvasPath
    );

    const finalCredits = await extractCurrentFlowCredits(cdp);
    if (finalCredits !== null) {
      const cfg = getFlowAccountsConfigRaw();
      const accInCfg = (cfg.accounts || []).find((a) => a.id === targetAcc.id);
      if (accInCfg) {
        accInCfg.credits = `${finalCredits} Kredit`;
        saveFlowAccountsConfig(cfg);
        try {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('flow-accounts-updated', cfg);
          });
        } catch (e) {}
      }
    }

    onProgress('Semua 3 foto candid dan 1 video motion berhasil disimpan!');

    try { await cdp.send('Browser.close'); } catch (e) {}
    await sleep(800);
    cdp.close();
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}

    try {
      if (fs.existsSync(tempDownloadDir)) fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    } catch (e) {}

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
    const msg = err.message || 'Kendala eksekusi Flow TikTok';
    onProgress(`Kendala Flow TikTok: ${msg}`);
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
  runFlowProjectCreationTiktok,
  ensureActiveAccountWithSufficientCredits,
  deleteFlowAccount
};