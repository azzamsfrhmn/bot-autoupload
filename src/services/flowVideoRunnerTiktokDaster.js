/**
 * src/services/flowVideoRunnerTiktokDaster.js
 * Runner Pure Raw CDP Google Flow Khusus Konsep Daster Try-On (Motion Halus / Mute)
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

[FLOW_BASE_DIR, SESSIONS_VIDEOS_DIR, OUTPUT_VIDEOS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanDelay(min = 400, max = 650) {
  await sleep(Math.floor(min + Math.random() * (max - min)));
}

let isGenerateSlotBusy = false;
const slotWaitQueue = [];

async function acquireGenerateSlot(onProgress) {
  if (!isGenerateSlotBusy) {
    isGenerateSlotBusy = true;
    onProgress(`[ANTRIAN DASTER] Slot generate siap.`);
    return;
  }
  onProgress(`[ANTRIAN DASTER] Menunggu slot generate kosong...`);
  await new Promise((resolve) => slotWaitQueue.push(resolve));
  isGenerateSlotBusy = true;
  onProgress(`[ANTRIAN DASTER] Slot generate siap.`);
}

async function releaseGenerateSlot(onProgress) {
  await sleep(3000);
  isGenerateSlotBusy = false;
  onProgress(`[ANTRIAN DASTER] Slot generate dilepas.`);
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
    try { if (this.ws) this.ws.close(); } catch (e) {}
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
            if (rect.width < 10 || rect.height < 10 || rect.width > 950 || rect.height > 600) return false;
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
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }).catch(() => null);
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
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
    await sleep(delayAfter);
  }

  async sendCtrlV() {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await sleep(60);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  }

  async clearPromptInput() {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await sleep(40);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await sleep(40);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(40);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(150);
  }

  async pressKey(key, windowsVirtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode });
    await sleep(50);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode });
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
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((file) => {
    const fPath = path.join(profileDir, file);
    if (fs.existsSync(fPath)) {
      try { fs.unlinkSync(fPath); } catch (e) {}
    }
  });
}

function getFlowAccountsConfigRaw() {
  let cfg = null;
  if (fs.existsSync(FLOW_CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(FLOW_CONFIG_FILE, 'utf-8')); } catch (e) {}
  }
  if (!cfg || !Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
    cfg = {
      activeAccountId: 'acc_1',
      accounts: [{ id: 'acc_1', name: 'Akun 1 (Utama)', status: 'Belum Login', credits: 'Tidak Tersedia' }]
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
        }
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

function downloadFileFromUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://flow.google.com/' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => { fileStream.close(); resolve(true); });
      fileStream.on('error', reject);
    });
    req.on('error', reject);
  });
}

function extractDasterVideoPrompt(rawTxt) {
  if (!rawTxt || typeof rawTxt !== 'string') {
    return 'Static locked-off camera, natural indoor bedroom setting, Indonesian woman smiling softly wearing daster homewear, subtle fabric movement, completely silent video, muted, no background audio, 4k ultra detailed';
  }

  const match = rawTxt.match(/(?:Scene\s*5|Scene\s*1|VIDEO\s*PROMPT)[\s:—–-]*([\s\S]*?)(?=(?:Scene\s*\d|PANDUAN|$))/i);
  let prompt = match && match[1] ? match[1].replace(/[\r\n]+/g, ' ').trim() : rawTxt.replace(/[\r\n]+/g, ' ').trim();

  if (!prompt.toLowerCase().includes('silent') && !prompt.toLowerCase().includes('mute')) {
    prompt = `${prompt}, static camera, locked shot, subtle breathing and gentle fabric drape, completely silent video, muted, no audio`;
  }
  return prompt;
}

// Pipeline Utama Render Daster di Google Flow
async function runFlowProjectCreationTiktokDaster({
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

  await acquireGenerateSlot(onProgress);

  const cfg = getFlowAccountsConfigRaw();
  const targetAcc = cfg.accounts.find((a) => a.id === cfg.activeAccountId) || cfg.accounts[0];
  const profileDir = getProfileDirForAccount(targetAcc?.id || 'acc_1');
  purgeTransientSessionData(profileDir);

  const cdpPort = 51000 + Math.floor(Math.random() * 13000);
  onProgress(`Membuka sesi Google Flow Daster (${targetAcc.name} · Port CDP: ${cdpPort})...`);

  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1220,920',
    '--window-position=40,30',
    'https://flow.google.com/'
  ], { detached: false, stdio: 'ignore' });

  const wsUrl = await getPageWebSocketUrl(cdpPort, 40);
  if (!wsUrl) {
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    await releaseGenerateSlot(onProgress);
    return { success: false, error: 'Gagal terhubung ke WebSocket Google Flow.' };
  }

  const cdp = new RawCDPClient(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  const interceptedVideoUrls = [];
  cdp.on('Network.responseReceived', (params) => {
    const respUrl = params.response?.url || '';
    const mimeType = (params.response?.mimeType || '').toLowerCase();
    if (respUrl.startsWith('http') && (mimeType.includes('video/') || respUrl.includes('.mp4') || respUrl.includes('googlevideo.com'))) {
      if (!interceptedVideoUrls.includes(respUrl)) interceptedVideoUrls.unshift(respUrl);
    }
  });

  try {
    onProgress('Menunggu dashboard Google Flow siap...');
    await sleep(3500);

    onProgress('Membuat Project Baru Google Flow...');
    const newProjPos = await cdp.waitForElementCenter({
      selector: 'button, a, [role="button"], span',
      textRegexStr: '^\\s*(\\+\\s*)?(Project baru|New project|Buat project)\\s*$'
    }, 15000);
    if (newProjPos) await cdp.nativeClickAt(newProjPos.x, newProjPos.y, 3500);

    // Setel ke Tab Video Langsung (9:16, Veo, 720p, 8 Detik)
    onProgress('Mengatur setelan video (9:16, Mode Bahan, Veo 3.1 Lite)...');
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
        textRegexStr: '^\\s*9\\s*:\\s*16\\s*$'
      });
      if (ratioBtn) await cdp.nativeClickAt(ratioBtn.x, ratioBtn.y, 500);

      await cdp.pressKey('Escape', 27);
      await sleep(800);
    }

    // Unggah Master Reference Scene Daster
    onProgress('Mengunggah gambar Master Scene Daster ke kanvas...');
    const editorPos = await cdp.waitForElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }, 15000);
    if (!editorPos) throw new Error('Kotak prompt Flow tidak ditemukan.');

    if (storyboardImagePath && fs.existsSync(storyboardImagePath)) {
      const img = nativeImage.createFromPath(storyboardImagePath);
      clipboard.writeImage(img);
      await sleep(250);

      await cdp.nativeClickAt(editorPos.x, editorPos.y, 400);
      await cdp.sendCtrlV();
      await sleep(2500);
    }

    // Tempel Prompt Video Daster
    const finalPrompt = extractDasterVideoPrompt(promptText);
    onProgress('Menempelkan teks prompt video gerak halus Daster...');
    clipboard.writeText(finalPrompt);
    await sleep(200);

    await cdp.nativeClickAt(editorPos.x, editorPos.y, 350);
    await cdp.sendCtrlV();
    await humanDelay(800, 1200);

    // Klik Generate
    onProgress('Memulai render video Daster di Google Flow...');
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

    await sleep(8000);
    const startWait = Date.now();
    while (Date.now() - startWait < 180000) {
      const isSpinning = await cdp.findElementCenter({
        selector: '.loading-percentage, mat-progress-spinner, flow-soupy-overlay'
      });
      if (!isSpinning) break;
      await sleep(3000);
    }

    // Unduh video hasil render
    const timestamp = Date.now();
    const videoFileName = `video_daster_${timestamp}.mp4`;
    const sessionVideoPath = path.join(SESSIONS_VIDEOS_DIR, videoFileName);
    const storageVideoPath = path.join(OUTPUT_VIDEOS_DIR, videoFileName);

    let isSavedSuccess = false;
    if (interceptedVideoUrls.length > 0) {
      for (const vUrl of interceptedVideoUrls) {
        try {
          await downloadFileFromUrl(vUrl, sessionVideoPath);
          if (fs.existsSync(sessionVideoPath) && fs.statSync(sessionVideoPath).size > 30000) {
            isSavedSuccess = true;
            break;
          }
        } catch (e) {}
      }
    }

    if (!isSavedSuccess) {
      const videoTilePos = await cdp.waitForElementCenter({ selector: 'flow-video-tile, video', maxY: 650 }, 5000);
      if (videoTilePos) await cdp.nativeClickAt(videoTilePos.x, videoTilePos.y, 2000);

      const dlBtnPos = await cdp.waitForElementCenter({
        selector: 'button[aria-label*="Unduh" i], button[aria-label*="Download" i], button',
        textRegexStr: '^\\s*(Unduh|Download)\\s*$',
        pickLast: true
      }, 5000);

      if (dlBtnPos) {
        await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 1000);
        const optPos = await cdp.findElementCenter({ selector: '.mat-mdc-menu-panel button, flow-menu-item, span, div', textRegexStr: '720p|Original|Asli' });
        if (optPos) await cdp.nativeClickAt(optPos.x, optPos.y, 1500);
      }
    }

    if (fs.existsSync(sessionVideoPath)) {
      fs.copyFileSync(sessionVideoPath, storageVideoPath);
    }

    try { await cdp.send('Browser.close'); } catch (e) {}
    cdp.close();
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    await releaseGenerateSlot(onProgress);

    return {
      success: true,
      videoPath: fs.existsSync(storageVideoPath) ? storageVideoPath : sessionVideoPath,
      storagePath: storageVideoPath,
      fileName: videoFileName,
      thumbnailPath: storyboardImagePath || ''
    };
  } catch (err) {
    if (cdp) cdp.close();
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    await releaseGenerateSlot(onProgress);
    return { success: false, error: err.message };
  }
}

module.exports = {
  runFlowProjectCreationTiktokDaster
};