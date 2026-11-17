/**
 * src/services/flowVideoRunnerTiktokDaster.js
 * Runner Pure Raw CDP Google Flow Khusus Konsep Daster Try-On (Motion Halus / Mute) + Headless Toggle Support
 *
 * Update:
 * - Dukungan Mode Headless On/Off dari Pengaturan AI (`accounts_config.json`)
 * - Mode Headless Modern (--headless=new) ringan, senyap, hemat RAM & GPU
 * - Penyamaran navigator.webdriver & emulasi User-Agent anti-bot Google Flow
 * - Rotasi otomatis ke Akun 2 saat saldo akun utama < 10 kredit
 * - Blokir render jika akun cadangan belum login / kuota seluruh akun habis
 * - Menunggu upload gambar storyboard mencapai 100% (persentase & spinner hilang)
 * - Mengirimkan seluruh prompt Scene 1 sampai Scene 5 sekaligus dalam satu kotak prompt
 * - Responsif penuh terhadap setelan: Rasio, Model AI, Resolusi, Durasi, dan Output x1
 * - Monitoring render akurat (anti false-positive selesai terlalu awal)
 * - Verifikasi fisik berkas video (> 50 KB) sebelum menyatakan selesai & memotong kredit
 * - Auto-decrement saldo kredit akun (-10 kredit) & broadcast update ke antarmuka aplikasi
 */

const { spawn } = require('child_process');
const { cleanupFailedChrome } = require('../core/chromeCleanup');
const { runWithFlowLease, leaseFlowAccount, releaseFlowLease, pickRandomFlowAccount, isFlowAccountShared, classifyFlowAccountFailure, isFlowAccountRested, FLOW_BLOCK_MS, isUnusualActivityError, flowUnusualActivityMessage, describeRestingFlowAccounts } = require('../core/flowWorkerPool');
const { syncProfileClone, workerProfileDir, hasUsableClone } = require('../core/profileClone');
const { withClipboardLock } = require('../core/clipboardLock');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { BrowserWindow, clipboard, nativeImage } = require('electron');
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../core/perfProfile');
const { waitFlowImageUpload } = require('./flowUploadWait');
const { dismissFlowOnboarding, disableFlowAgent, agreeFlowImageRights, ensureSilentVideosShown } = require('./flowOnboarding');

const ROOT_DIR = process.cwd();
const FLOW_BASE_DIR = path.resolve(ROOT_DIR, 'sessions/flow_profiles');
const FLOW_CONFIG_FILE = path.resolve(FLOW_BASE_DIR, 'accounts_config.json');
// Google Flow butuh minimal 12 kredit untuk 1 kali render video
const MIN_FLOW_CREDIT = 12;

// Biaya kredit asli per kombinasi setelan, dipelajari dari label Flow
// <a class="credit-cost-link">12 kredit</a> (tiap model/resolusi/durasi/output berbeda)
function buildFlowCostKey({ flowModel, flowResolution, flowDuration, flowOutputCount }) {
  const model = require('./flowModels').normalizeFlowModel(flowModel).toLowerCase().replace(/[\s\-–]+/g, ' ').trim();
  const res = String(flowResolution || '').includes('360') ? '360p' : '720p';
  const dur = (String(flowDuration || '').match(/\d+/) || ['8'])[0];
  const out = (String(flowOutputCount || '').match(/\d+/) || ['1'])[0];
  return `${model}|${res}|${dur}|x${out}`;
}

function getCachedFlowCost(key) {
  const cache = getFlowAccountsConfigRaw().creditCostCache || {};
  return typeof cache[key] === 'number' ? cache[key] : null;
}

function saveFlowCost(key, cost) {
  const cfg = getFlowAccountsConfigRaw();
  cfg.creditCostCache = { ...(cfg.creditCostCache || {}), [key]: cost };
  saveFlowAccountsConfig(cfg);
}

const SESSIONS_VIDEOS_DIR = path.resolve(ROOT_DIR, 'sessions/generated_videos');
const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');

[FLOW_BASE_DIR, SESSIONS_VIDEOS_DIR, OUTPUT_VIDEOS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

async function humanDelay(min = 400, max = 650) {
  await sleep(Math.floor(min + Math.random() * (max - min)));
}


// Satu akun Flow = satu render. Antrean & peminjaman akun ditangani flowWorkerPool (mendukung banyak worker).
async function acquireGenerateSlot() {}

async function releaseGenerateSlot() {
  releaseFlowLease();
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
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }).catch(() => null);
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
      headless: true,
      accounts: [{ id: 'acc_1', name: 'Akun 1 (Utama)', status: 'Belum Login', credits: 'Tidak Tersedia' }]
    };
  }
  return cfg;
}

function saveFlowAccountsConfig(cfg) {
  fs.writeFileSync(FLOW_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  try {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('flow-accounts-updated');
      }
    });
  } catch (e) {}
}

function getProfileDirForAccount(accountId) {
  const dir = path.join(FLOW_BASE_DIR, accountId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Worker 1 membuka profil asli akun Flow; worker 2 dst. membuka salinannya (akun Google yang sama)

// Saldo kredit ASLI dari panel akun Flow (avatar kanan atas → "N kredit Google Flow"). null bila tidak terbaca.
async function readRealFlowCredit(cdp) {
  const read = () => cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const txt = document.body ? (document.body.innerText || '') : '';
      const el = document.querySelector('.credits-count');
      const m = ((el && el.textContent) || '').match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)/)
        || txt.match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*kredit\\s*Google\\s*Flow/i)
        || txt.match(/(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*Google\\s*Flow\\s*credits?/i);
      if (m) return parseInt(m[1].replace(/[.,]/g, ''), 10);
      return /kredit google flow anda habis|out of google flow credits/i.test(txt) ? 0 : null;
    })()`,
    returnByValue: true
  }).then((r) => r?.result?.value ?? null).catch(() => null);

  let credit = await read();
  if (credit !== null) return credit;
  const avatarPos = await cdp.findElementCenter({ selector: 'flow-header-user-icon [role="button"], flow-header-user-icon' });
  if (!avatarPos) return null;
  await cdp.nativeClickAt(avatarPos.x, avatarPos.y, 1200);
  for (let i = 0; i < 6 && credit === null; i++) {
    credit = await read();
    if (credit === null) await sleep(700);
  }
  // Tutup panel akun (Escape; bila masih terbuka klik avatar lagi) agar tidak menutupi tombol lain
  const panelOpen = () => cdp.send('Runtime.evaluate', { expression: "!!document.querySelector('.credits-count')", returnByValue: true })
    .then((r) => Boolean(r?.result?.value)).catch(() => false);
  await cdp.pressKey('Escape', 27).catch(() => {});
  await sleep(500);
  if (await panelOpen()) {
    await cdp.nativeClickAt(avatarPos.x, avatarPos.y, 800);
    if (await panelOpen()) {
      await cdp.pressKey('Escape', 27).catch(() => {});
      await sleep(500);
    }
  }
  return credit;
}

async function resolveFlowProfileDir(accountId, workerId, onProgress = () => {}) {
  const baseDir = getProfileDirForAccount(accountId);
  // Akun tidak sedang dipakai worker lain → profil asli; dipakai bersama → salinan profil per worker
  if ((Number(workerId) || 1) <= 1 || !isFlowAccountShared(accountId)) return baseDir;
  const res = await syncProfileClone(baseDir, workerProfileDir(baseDir, workerId));
  if (res.status === 'synced') onProgress(`Profil akun Flow untuk worker ${workerId} disinkronkan ✓`);
  if (!hasUsableClone(res.dir)) {
    throw new Error(`Profil akun Flow untuk worker ${workerId} belum siap (profil asli sedang dipakai). Jalankan ulang dengan 2 worker agar disalin di awal.`);
  }
  return res.dir;
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

// MP4 utuh = ada kotak 'ftyp' di awal + 'moov' (indeks) + 'mdat' (data). Potongan stream (range) tidak lolos.
function isCompleteVideoFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const buf = fs.readFileSync(filePath);
    if (buf.length < 100 * 1024) return false;
    if (buf.toString('latin1', 4, 8) !== 'ftyp') return false;
    // Telusuri kotak tingkat atas: ukuran tiap kotak harus pas sampai akhir file (file terpotong = kotak melewati batas)
    const seen = new Set();
    let offset = 0;
    while (offset + 8 <= buf.length) {
      let size = buf.readUInt32BE(offset);
      const type = buf.toString('latin1', offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > buf.length) return false;
        size = Number(buf.readBigUInt64BE(offset + 8));
      } else if (size === 0) {
        size = buf.length - offset;
      }
      if (size < 8 || offset + size > buf.length) return false;
      seen.add(type);
      offset += size;
    }
    return offset === buf.length && seen.has('moov') && seen.has('mdat');
  } catch (e) {
    return false;
  }
}

function discardFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
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

// Unduh URL video memakai cookie login Google dari Chrome bot (tanpa cookie, URL Flow hanya memberi
// halaman error / potongan stream). Parameter "range" dibuang agar yang diminta file utuh.
async function downloadVideoViaSession(cdp, url, destPath) {
  const fullUrl = url.replace(/([?&])range=[^&]*&?/i, '$1').replace(/[?&]$/, '');
  const cookieRes = await cdp.send('Network.getCookies', { urls: [fullUrl] }).catch(() => null);
  const cookie = (cookieRes?.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(fullUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': 'https://labs.google/',
      ...(cookie ? { Cookie: cookie } : {})
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/text\/html|json/i.test(type)) throw new Error(`bukan file video (${type})`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

function buildAllDasterScenesPrompt(rawTxt) {
  const defaultScenes = [
    'Scene 1 (Candid Cermin - Angkat Rambut): Static camera. The woman gently lifts her hair while checking the mirror. Silent video, no audio.',
    'Scene 2 (Candid Cermin - Memeriksa Bahan): Static camera. The woman smooths the fabric at her waist while looking at the side mirror. Mute, no sound.',
    'Scene 3 (Candid Cermin - Angkat Ujung Rok): Static camera. The woman sways slightly and lifts the hem of the dress. Silent video, no audio.',
    'Scene 4 (Candid Cermin - Tersenyum ke Cermin): Static camera. The woman smiles at her reflection, then begins turning toward the front. Mute, no sound.',
    'Scene 5 (Menghadap Penuh ke Kamera): Static camera. The woman smiles warmly at the camera and sways the dress hem gently. Silent video, no audio.'
  ];

  if (!rawTxt || typeof rawTxt !== 'string' || rawTxt.trim().length < 30) {
    return defaultScenes.join(' ');
  }

  // Prompt dari kotak kode GPT Daster ("Scene Prompt:" + "Negative Prompt:") dipakai apa adanya
  if (/Scene Prompt\s*:/i.test(rawTxt)) return rawTxt.trim();

  const cleanedLines = rawTxt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('===') && !l.startsWith('---'));

  let combined = cleanedLines.join(' ');
  if (!combined.toLowerCase().includes('silent') && !combined.toLowerCase().includes('mute')) {
    combined += ' Static locked-off camera, natural indoor bedroom setting, silent video, no audio.';
  }
  return combined;
}

// =========================================================================
// HELPER ROTASI & VALIDASI SALDO MULTI-AKUN FLOW
// =========================================================================
function resolveActiveAccountForRender(onProgress = () => {}, requiredCredit = MIN_FLOW_CREDIT, busyIds = new Set()) {
  const cfg = getFlowAccountsConfigRaw();
  if (!cfg || !Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
    throw new Error('Tidak ada akun Google Flow yang terdaftar di sistem.');
  }

  const getCreditNum = (acc) => {
    if (!acc || acc.status !== 'Sesi Aktif') return 0;
    const match = String(acc.credits || '').replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };
  // Akun yang baru ditandai Flow (spam/aktivitas tidak biasa) diistirahatkan dulu
  const hasCredit = (acc) => Boolean(acc) && acc.status === 'Sesi Aktif' && getCreditNum(acc) >= requiredCredit && isFlowAccountRested(acc);

  let activeIndex = cfg.accounts.findIndex((a) => a.id === cfg.activeAccountId);
  if (activeIndex === -1) activeIndex = 0;

  const currentAcc = cfg.accounts[activeIndex];
  const currentCredit = getCreditNum(currentAcc);

  // Rotasi acak tiap render (hindari akun yang baru dipakai & akun yang sedang dipakai worker lain)
  // agar satu akun tidak membuat video beruntun → mengurangi deteksi spam Flow
  const picked = pickRandomFlowAccount(cfg.accounts, hasCredit, busyIds, cfg.lastFlowAccountId);
  if (picked) {
    onProgress(`[Rotasi Acak] Memakai ${picked.name} (${picked.credits})${busyIds.has(picked.id) ? ' bersama worker lain' : ''}.`);
    cfg.activeAccountId = picked.id;
    cfg.lastFlowAccountId = picked.id;
    saveFlowAccountsConfig(cfg);
    return { targetAcc: picked, cfg };
  }

  const pendingLoginAcc = cfg.accounts.find((acc) => acc.id !== currentAcc?.id && acc.status !== 'Sesi Aktif');
  if (pendingLoginAcc) {
    throw new Error(`Kredit ${currentAcc ? currentAcc.name : 'Akun Utama'} tersisa < ${requiredCredit} (${currentCredit} Kredit) dan ${pendingLoginAcc.name} belum login. Anda tidak bisa membuat video reels sebelum login ke ${pendingLoginAcc.name} di Pengaturan AI.`);
  }

  const restingMsg = describeRestingFlowAccounts(cfg.accounts);
  if (restingMsg) throw new Error(restingMsg);
  throw new Error(`Semua akun Google Flow kehabisan kredit (< ${requiredCredit}). Anda tidak dapat membuat video reels sampai kuota harian direset besok atau menambahkan akun baru.`);
}

// Pipeline Utama Render Daster di Google Flow (Dengan Dukungan Toggle Headless)
async function runFlowProjectCreationTiktokDaster({
  workerId = 1,
  projectFolder = null,
  storyboardImagePath = null,
  promptText = null,
  flowRatio = '9:16',
  flowModel = 'Veo 3.1 - Lite',
  flowResolution = '720p',
  flowDuration = '10 Detik',
  flowOutputCount = '1',
  headless = null,
  onProgress = () => {}
}) {
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath) return { success: false, error: 'Google Chrome tidak ditemukan.' };

  await acquireGenerateSlot(onProgress);

  // Ambil setelan headless dari config jika parameter kosong/null
  const cfgRaw = getFlowAccountsConfigRaw();
  const effectiveHeadless = typeof headless === 'boolean' 
    ? headless 
    : (typeof cfgRaw?.headless === 'boolean' ? cfgRaw.headless : true);

  let targetAcc = null;
  let cfg = null;
  const costKey = buildFlowCostKey({ flowModel, flowResolution, flowDuration, flowOutputCount });
  let actualFlowCost = null;
  try {
    const knownCost = getCachedFlowCost(costKey);
    if (knownCost !== null) onProgress(`Biaya Flow untuk setelan ini (dari render sebelumnya): ${knownCost} kredit.`);
    const resolved = await leaseFlowAccount((busy) => resolveActiveAccountForRender(onProgress, knownCost || 1, busy), onProgress);
    targetAcc = resolved.targetAcc;
    cfg = resolved.cfg;
  } catch (accErr) {
    await releaseGenerateSlot(onProgress);
    return { success: false, error: accErr.message };
  }

  let profileDir;
  try {
    profileDir = await resolveFlowProfileDir(targetAcc.id, workerId, onProgress);
  } catch (profileErr) {
    await releaseGenerateSlot(onProgress);
    return { success: false, error: profileErr.message };
  }
  purgeTransientSessionData(profileDir);

  const cdpPort = 51000 + Math.floor(Math.random() * 13000);
  onProgress(`Membuka sesi Google Flow Daster (${targetAcc.name} · Port CDP: ${cdpPort} · Headless: ${effectiveHeadless ? 'Aktif' : 'Nonaktif'})...`);

  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--window-size=1280,900',
    '--disable-blink-features=AutomationControlled',
    '--mute-audio',
    '--lang=id-ID'
  ];

  if (effectiveHeadless) {
    // Mode senyap: Chrome asli dengan jendela di luar layar (--headless sering dijeda/dicurigai Google Flow)
    chromeArgs.push(
      '--window-position=-32000,-32000',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    );
  } else {
    chromeArgs.push('--window-position=40,30');
  }

  chromeArgs.push('https://flow.google.com/');

  const chromeProcess = spawn(chromePath, [...chromeArgs, ...chromeLiteArgs()], { detached: false, stdio: 'ignore' });

  const wsUrl = await getPageWebSocketUrl(cdpPort, 40);
  if (!wsUrl) {
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    await releaseGenerateSlot(onProgress);
    return { success: false, error: 'Gagal terhubung ke WebSocket Google Flow.' };
  }

  const cdp = new RawCDPClient(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');

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

  try {
    onProgress('Menunggu dashboard Google Flow siap...');
    await sleep(3500);

    await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);

    onProgress('Membuat Project Baru Google Flow...');
    // Editor project terbuka = kotak prompt Flow tampil. Bila tombol "Project baru" tidak muncul / klik tidak membuka
    // editor (halaman lambat, popup, dua worker membuka akun yang sama bersamaan) → muat ulang Flow & ulangi.
    const EDITOR_SELECTOR = 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]';
    let projectOpened = false;
    for (let attempt = 1; attempt <= 3 && !projectOpened; attempt++) {
      if (attempt > 1) {
        onProgress(`Editor project Flow belum terbuka → memuat ulang Google Flow (${attempt}/3)...`);
        await cdp.send('Page.navigate', { url: 'https://flow.google.com/' }).catch(() => {});
        await sleep(6000);
        await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
      }
      const newProjPos = await cdp.waitForElementCenter({
        selector: 'button, a, [role="button"], span',
        textRegexStr: '^\\s*(\\+\\s*)?(Project baru|New project|Buat project)\\s*$'
      }, 20000);
      if (!newProjPos) {
        onProgress('[Peringatan] Tombol "Project baru" tidak ditemukan di dashboard Flow.');
        continue;
      }
      await cdp.nativeClickAt(newProjPos.x, newProjPos.y, 3500);
      const evalPage = (expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value).catch(() => null);
      // Klik koordinat bisa terhalang banner/overlay baru → bila belum masuk project, klik tombolnya langsung lewat DOM
      if (!(await evalPage("location.pathname.includes('/project/')"))) {
        onProgress('Klik "Project baru" terhalang → mengklik tombol langsung...');
        await evalPage(`(() => {
          const el = Array.from(document.querySelectorAll('button, a, [role="button"], span'))
            .find((e) => /^\\s*(\\+\\s*)?(Project baru|New project|Buat project)\\s*$/i.test((e.innerText || '').trim()));
          const target = el ? (el.closest('button, a, [role="button"]') || el) : null;
          if (target) target.click();
          return Boolean(target);
        })()`);
        await sleep(3500);
      }
      await dismissFlowOnboarding(evalPage, onProgress, sleep);
      projectOpened = Boolean(await cdp.waitForElementCenter({ selector: EDITOR_SELECTOR }, 20000));
      if (!projectOpened && (await evalPage(`location.pathname.includes('/project/') && !!document.querySelector('${EDITOR_SELECTOR}')`))) {
        // Editor sudah ada tapi masih tertutup popup (mis. "Easier asset management… Mulai") → tutup popup lalu lanjut
        await dismissFlowOnboarding(evalPage, onProgress, sleep);
        projectOpened = true;
      }
    }
    if (!projectOpened) {
      // Simpan bukti agar penyebabnya terlihat (screenshot + cuplikan teks halaman)
      const shotPath = path.join(os.tmpdir(), `flow_noproject_${Date.now()}.png`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot?.data) fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      const pageInfo = await cdp.send('Runtime.evaluate', {
        expression: `location.href + ' | ' + (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)`,
        returnByValue: true
      }).then((r) => r?.result?.value || '').catch(() => '');
      throw new Error(`Editor project Google Flow tidak terbuka setelah 3x percobaan. Halaman: ${pageInfo} · Screenshot: ${shotPath}`);
    }
    // Popup info fitur baru di project (mis. "Nano Banana 2.1" → Mulai)
    await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
    await disableFlowAgent((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
    // Daster memakai suara TikTok: tampilkan hasil video tanpa suara sejak awal (sebelum prompt / render)
    await ensureSilentVideosShown(cdp, onProgress, sleep);

    const cleanOutput = String(flowOutputCount).match(/\d+/) ? `x${String(flowOutputCount).match(/\d+/)[0]}` : 'x1';
    const cleanModel = require('./flowModels').normalizeFlowModel(flowModel);
    const cleanRes = String(flowResolution).includes('360') ? '360p' : '720p';
    const durMatch = String(flowDuration).match(/\d+/);
    const cleanDurationVal = durMatch ? durMatch[0] : '8';

    onProgress(`Mengatur setelan mesin render (${cleanModel} · ${cleanRes} · ${cleanDurationVal} dtk · ${cleanOutput})...`);

    // =====================================================================
    // SETELAN MESIN RENDER: cek & atur satu per satu sesuai pilihan aplikasi
    // Struktur Flow: <flow-prompt-box-settings> berisi <flow-toggles aria-label="Mode|Jenis video|Rasio aspek|Jumlah output">
    // dan <button aria-label="Pilih rangkaian model">. Resolusi & durasi hanya muncul untuk model tertentu.
    // =====================================================================
    const evalFlow = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }).catch(() => null);
      return r?.result?.value;
    };

    const isSettingsOpen = async () => Boolean(await evalFlow(`!!document.querySelector('flow-prompt-box-settings')`));

    const openSettingsPanel = async () => {
      if (await isSettingsOpen()) return true;
      const pillPos = await cdp.waitForElementCenter({
        selector: 'button[aria-label="Pemicu setelan"], button.settings-trigger-button, button',
        textRegexStr: 'Nano Banana|Imagen|Veo|Omni|Video|Gambar|x[1-4]|dtk',
        minY: 480,
        pickLast: true
      }, 10000);
      if (pillPos) await cdp.nativeClickAt(pillPos.x, pillPos.y, 750);
      for (let i = 0; i < 10; i++) {
        if (await isSettingsOpen()) return true;
        await sleep(300);
      }
      return false;
    };

    // Pilih tombol pada <flow-toggles aria-label="..."> berdasarkan teks .toggle-text, lalu verifikasi aria-checked
    const selectFlowToggle = async (groupLabels, optionRegexStr, displayName, optional = false) => {
      if (!(await openSettingsPanel())) {
        onProgress(`[Peringatan] Panel setelan Flow tidak terbuka, ${displayName} dilewati.`);
        return false;
      }

      const inspect = (doClick) => `
        (() => {
          const labels = ${JSON.stringify(groupLabels.map((l) => l.toLowerCase()))};
          const re = new RegExp(${JSON.stringify(optionRegexStr)}, 'i');
          const panel = document.querySelector('flow-prompt-box-settings');
          if (!panel) return { state: 'no_panel' };
          const group = Array.from(panel.querySelectorAll('flow-toggles'))
            .find(el => { const a = (el.getAttribute('aria-label') || '').toLowerCase().trim(); return labels.some(l => a === l || a.startsWith(l + ' ')); });
          const btns = Array.from((group || panel).querySelectorAll('button[role="radio"]'));
          const textOf = (b) => ((b.querySelector('.toggle-text') || b).textContent || '').trim();
          const btn = btns.find(b => re.test(textOf(b)));
          if (!btn) return { state: 'not_found', hasGroup: Boolean(group), options: btns.map(textOf).join(' | ') };
          if (btn.getAttribute('aria-checked') === 'true') return { state: 'checked', text: textOf(btn) };
          if (${doClick}) btn.click();
          const r = btn.getBoundingClientRect();
          return { state: 'unchecked', text: textOf(btn), x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `;

      let res = await evalFlow(inspect(false));
      if (res?.state === 'checked') {
        onProgress(`✓ ${displayName}: ${res.text} (sudah sesuai)`);
        return true;
      }
      if (res?.state === 'not_found') {
        if (optional && !res.hasGroup) {
          onProgress(`• ${displayName}: tidak tersedia untuk model ini, dilewati.`);
        } else {
          onProgress(`[Peringatan] ${displayName}: opsi tidak ditemukan (tersedia: ${res.options || '-'}).`);
        }
        return false;
      }
      if (res?.state !== 'unchecked') return false;

      // Klik native dulu (paling mirip pengguna), lalu fallback klik DOM
      await cdp.nativeClickAt(res.x, res.y, 450);
      res = await evalFlow(inspect(false));
      if (res?.state === 'unchecked') {
        res = await evalFlow(inspect(true));
        await sleep(400);
        res = await evalFlow(inspect(false));
      }

      if (res?.state === 'checked') {
        onProgress(`✓ ${displayName}: diubah ke ${res.text}`);
        return true;
      }
      onProgress(`[Peringatan] ${displayName}: gagal dipilih (${res?.state || 'tidak terbaca'}).`);
      return false;
    };

    // Durasi bertipe SLIDER (Omni 1.2 Flash: label "Durasi" + "13 Dtk"). Nilai slider BUKAN detik
    // (mis. 0..12 = 3..15 dtk), jadi patokannya label "N Dtk": geser panah kiri/kanan sampai label = target.
    // Return false bila tidak ada slider.
    const setFlowDurationSlider = async (seconds) => {
      if (!(await openSettingsPanel())) return false;
      const read = () => evalFlow(`
        (() => {
          const panel = document.querySelector('flow-prompt-box-settings') || document;
          const input = panel.querySelector('input[type="range"]');
          if (!input) return null;
          input.focus();
          const t = (panel.innerText || '').replace(/\\s+/g, ' ');
          const m = t.match(/(?:Durasi|Duration)\\s*(\\d+)\\s*(?:dtk|detik|sec|s)\\b/i);
          const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
          return { min: num(input.min, 0), max: num(input.max, 100), value: num(input.value, 0), secs: m ? Number(m[1]) : null };
        })()
      `);
      const want = Number(seconds);
      let st = await read();
      if (!st) return false;
      if (st.secs === want) { onProgress(`✓ Durasi: ${want} dtk (sudah sesuai)`); return true; }
      if (st.secs == null) { onProgress('[Peringatan] Label durasi slider tidak terbaca, durasi dibiarkan.'); return true; }
      for (let i = 0; i < 30 && st && st.secs !== want; i++) {
        const up = st.secs < want;
        if ((up && st.value >= st.max) || (!up && st.value <= st.min)) break;
        await cdp.pressKey(up ? 'ArrowRight' : 'ArrowLeft', up ? 39 : 37);
        await sleep(120);
        const next = await read();
        if (!next || next.secs == null) break;
        if ((up && next.secs > want) || (!up && next.secs < want)) { st = next; break; } // tidak ada nilai persis
        st = next;
      }
      if (st && st.secs === want) { onProgress(`✓ Durasi: diubah ke ${want} dtk`); return true; }
      onProgress(`[Peringatan] Durasi slider: ingin ${want} dtk, terpilih ${st ? st.secs : '-'} dtk.`);
      return true;   // slider ada → jangan cari tombol durasi lama
    };

    // Model: baca teks .model-select-trigger-content tanpa ikon arrow_drop_down
    const readActiveModel = async () => (await evalFlow(`
      (() => {
        const content = document.querySelector('button[aria-label="Pilih rangkaian model"] .model-select-trigger-content');
        if (!content) return '';
        const clone = content.cloneNode(true);
        clone.querySelectorAll('mat-icon').forEach(i => i.remove());
        return (clone.textContent || '').trim();
      })()
    `)) || '';

    const modelRegexStr = cleanModel
      .split(/[\s\-–]+/)
      .filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\-–]*');
    const MODEL_OPTION_SELECTOR = '.cdk-overlay-container .mat-mdc-menu-panel [role="menuitem"], .cdk-overlay-container .mat-mdc-menu-panel button, .cdk-overlay-container [role="listbox"] [role="option"]';

    const isModelMenuOpen = async () => Boolean(await evalFlow(`!!document.querySelector('.cdk-overlay-container .mat-mdc-menu-panel')`));

    const selectFlowModel = async () => {
      if (!(await openSettingsPanel())) {
        onProgress('[Peringatan] Panel setelan Flow tidak terbuka, model dilewati.');
        return false;
      }

      const activeBefore = await readActiveModel();
      if (activeBefore && new RegExp(modelRegexStr, 'i').test(activeBefore)) {
        onProgress(`✓ Model AI: ${activeBefore} (sudah sesuai)`);
        return true;
      }

      const trigger = await cdp.findElementCenter({ selector: 'flow-prompt-box-settings button[aria-label="Pilih rangkaian model"]' });
      if (!trigger) {
        onProgress('[Peringatan] Tombol dropdown model (Pilih rangkaian model) tidak ditemukan.');
        return false;
      }
      await cdp.nativeClickAt(trigger.x, trigger.y, 500);

      // Tunggu menu model muncul (animasi overlay), lalu cari opsi yang cocok
      const findOption = () => evalFlow(`
        (() => {
          const re = new RegExp(${JSON.stringify(modelRegexStr)}, 'i');
          const items = Array.from(document.querySelectorAll(${JSON.stringify(MODEL_OPTION_SELECTOR)}));
          const opt = items.find(el => re.test(el.innerText || ''));
          if (!opt) return { found: false, options: items.map(el => (el.innerText || '').split('\\n')[0].trim()).filter(Boolean).join(' | ') };
          const r = opt.getBoundingClientRect();
          return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `);

      let opt = null;
      for (let i = 0; i < 10; i++) {
        opt = await findOption();
        if (opt?.found) break;
        await sleep(400);
      }

      if (opt?.found) {
        await cdp.nativeClickAt(opt.x, opt.y, 700);
      } else {
        onProgress(`[Diagnostik] Opsi model terlihat: ${opt?.options || '(menu tidak terbuka)'}`);
      }

      // Tutup HANYA menu model jika masih terbuka (jangan tutup panel setelan)
      if (await isModelMenuOpen()) {
        await cdp.pressKey('Escape', 27);
        await sleep(400);
      }

      const activeAfter = await readActiveModel();
      if (activeAfter && new RegExp(modelRegexStr, 'i').test(activeAfter)) {
        onProgress(`✓ Model AI: diubah ke ${activeAfter}`);
        return true;
      }
      onProgress(`[Peringatan] Model AI gagal diubah ke ${cleanModel} (aktif: ${activeAfter || 'tidak terbaca'}).`);
      return false;
    };

    const cleanRatio = String(flowRatio || '9:16').replace(/\s+/g, '');

    if (await openSettingsPanel()) {
      // Urutan penting: model diatur sebelum resolusi/durasi/output karena opsi tersebut bergantung pada model
      await selectFlowToggle(['Mode'], '^\\s*Video\\s*$', 'Mode');
      await selectFlowToggle(['Jenis video'], '^\\s*Bahan\\s*$', 'Jenis video');
      await selectFlowToggle(['Rasio aspek'], `^\\s*${cleanRatio.replace(':', '\\s*:\\s*')}\\s*$`, 'Rasio');
      await selectFlowModel();
      await selectFlowToggle(['Resolusi', 'Kualitas', 'Resolution'], `^\\s*${cleanRes}`, 'Resolusi', true);
      if (!(await setFlowDurationSlider(cleanDurationVal))) {
        await selectFlowToggle(['Durasi', 'Duration'], `^\\s*${cleanDurationVal}\\s*(dtk|detik|s)?\\s*$`, 'Durasi', true);
      }
      await selectFlowToggle(['Jumlah output'], `^\\s*${cleanOutput}\\s*$`, 'Output');

      // Biaya asli: <a class="credit-cost-link">12 kredit</a> (berubah sesuai model/resolusi/durasi/output)
      await sleep(400);
      const costText = await evalFlow(`(() => { const a = document.querySelector('flow-prompt-box-settings .credit-cost-link') || document.querySelector('.credit-cost-link'); return a ? (a.textContent || '').trim() : ''; })()`);
      const costMatch = String(costText || '').replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
      actualFlowCost = costMatch ? parseInt(costMatch[0], 10) : null;

      if (actualFlowCost !== null) {
        saveFlowCost(costKey, actualFlowCost);
        const accCredit = parseInt((String(targetAcc.credits || '').replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/) || ['0'])[0], 10);
        onProgress(`Biaya Flow (asli): ${actualFlowCost} kredit · Saldo ${targetAcc.name}: ${accCredit} kredit`);
        if (accCredit < actualFlowCost) {
          throw new Error(`Kredit ${targetAcc.name} (${accCredit}) tidak cukup untuk biaya render ${actualFlowCost} kredit (${cleanModel} · ${cleanRes} · ${cleanDurationVal} dtk · ${cleanOutput}). Pilih setelan lebih hemat atau login akun cadangan.`);
        }
      } else {
        onProgress('[Peringatan] Label biaya kredit (credit-cost-link) tidak terbaca di Flow.');
      }

      // Tutup panel setelan
      if (await isSettingsOpen()) {
        await cdp.pressKey('Escape', 27);
        await sleep(800);
      }
    } else {
      onProgress('[Peringatan] Panel setelan Google Flow tidak bisa dibuka. Render memakai setelan terakhir di Flow.');
    }

    // Kredit lokal bisa usang (render gagal tetap memotong kredit di Flow) → baca saldo ASLI (setelah setelan model diatur).
    // Habis / kurang → error kredit → akun ditandai 0 & render otomatis pindah ke akun Flow lain.
    const realCredit = await readRealFlowCredit(cdp);
    if (realCredit !== null) {
      targetAcc.credits = `${realCredit} Kredit`;
      try {
        const cfgNow = getFlowAccountsConfigRaw();
        const accNow = cfgNow.accounts.find((a) => a.id === targetAcc.id);
        if (accNow) {
          accNow.credits = targetAcc.credits;
          accNow.creditsCheckedAt = Date.now();
          saveFlowAccountsConfig(cfgNow);
        }
      } catch (e) {}
      onProgress(`Saldo asli ${targetAcc.name} di Flow: ${realCredit} kredit.`);
      const minNeeded = actualFlowCost || getCachedFlowCost(costKey) || 1;
      if (realCredit < minNeeded) {
        throw new Error(`Kredit ${targetAcc.name} di Flow tinggal ${realCredit}, tidak cukup untuk biaya render ${minNeeded} kredit.`);
      }
    } else {
      onProgress('[Peringatan] Saldo kredit asli Flow tidak terbaca, memakai data lokal.');
    }

    const editorPos = await cdp.waitForElementCenter({
      selector: 'flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]'
    }, 15000);
    if (!editorPos) throw new Error('Kotak prompt Flow tidak ditemukan.');

    // Banner Flow yang muncul belakangan bisa menggeser layout ke bawah → sebelum tiap tempel: tutup banner,
    // cari ulang posisi kotak prompt, fokuskan, lalu klik (posisi lama hanya dipakai bila pencarian gagal)
    const focusPromptEditor = async (dx = 0, delayAfter = 400) => {
      await dismissFlowOnboarding((expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value), onProgress, sleep);
      const pos = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const e = document.querySelector('flow-rich-text-editor .ProseMirror, div.ProseMirror[contenteditable="true"]');
          if (!e) return null;
          e.scrollIntoView({ block: 'center' });
          e.focus();
          const r = e.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`,
        returnByValue: true
      }).then((r) => r?.result?.value).catch(() => null);
      const p = pos || editorPos;
      await cdp.nativeClickAt(p.x + dx, p.y, delayAfter);
    };

    if (storyboardImagePath && fs.existsSync(storyboardImagePath)) {
      onProgress('Menempelkan gambar Storyboard ke dalam kotak prompt...');
      const img = nativeImage.createFromPath(storyboardImagePath);
      // Clipboard dipakai bersama semua worker: tulis + tempel dalam satu giliran
      await withClipboardLock(async () => {
        clipboard.writeImage(img);
        await sleep(300);

        await focusPromptEditor(0, 400);
        await cdp.sendCtrlV();
      });
      // Dialog "Hak untuk menggunakan gambar ini" bisa muncul setelah tempel gambar
      await sleep(1500);
      await agreeFlowImageRights(cdp, onProgress, sleep);

      onProgress('Menunggu upload gambar selesai 100% di Google Flow...');
      // Selesai hanya bila persen upload hilang & chip gambar termuat; gagal/macet → error, prompt tidak dikirim
      await waitFlowImageUpload({ cdp, expectedChips: 1, onProgress, sleep, label: 'Gambar storyboard' });
    }

    const fullPromptText = buildAllDasterScenesPrompt(promptText);
    onProgress('Memasukkan seluruh rangkaian prompt Scene 1 s/d 5...');
    // Clipboard dipakai bersama semua worker: tulis + tempel dalam satu giliran
    await withClipboardLock(async () => {
      clipboard.writeText(fullPromptText);
      await sleep(300);

      await focusPromptEditor(80, 400);
      await cdp.sendCtrlV();
    });
    // Dialog "Hak untuk menggunakan gambar ini" bisa muncul setelah tempel gambar
    await sleep(1500);
    await agreeFlowImageRights(cdp, onProgress, sleep);
    await humanDelay(1000, 1500);

    interceptedVideoUrls.length = 0;

    onProgress('Memulai proses render video Daster di Google Flow...');
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

    onProgress('Menunggu antrean & inisialisasi render video di Google Flow...');
    await sleep(7000);

    const maxWaitMs = 30 * 60 * 1000; // cukup untuk 5x "Coba lagi"
    const startRender = Date.now();
    let isRenderCompleted = false;
    let detectedVideoSrc = '';
    let sawRenderPercent = false;
    let renderRetryCount = 0;
    // Kartu video gagal → klik "Coba lagi" sampai 5x dulu, baru ganti akun Flow
    const MAX_RENDER_RETRY = 5;

    // Klik elemen: utamakan klik native (posisi), fallback klik via DOM
    const clickFlowElement = async (selector) => {
      const pos = await cdp.findElementCenter({ selector });
      if (pos) {
        await cdp.nativeClickAt(pos.x, pos.y, 600);
        return true;
      }
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); return true; } return false; })()`,
        returnByValue: true
      }).catch(() => null);
      await sleep(600);
      return Boolean(res?.result?.value);
    };

    const isSilentToggleOn = async () => {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const b = document.querySelector('button[name="return-silent-videos"]'); return b ? b.getAttribute('aria-checked') : 'missing'; })()`,
        returnByValue: true
      }).catch(() => null);
      return res?.result?.value || 'missing';
    };

    // Kartu gagal audio: buka "setelan" → nyalakan "Tampilkan video senyap" → klik "Coba lagi"
    const enableSilentVideoAndRetry = async () => {
      await clickFlowElement('.error-tile button.settings-link');

      let toggleState = 'missing';
      for (let i = 0; i < 10 && toggleState === 'missing'; i++) {
        await sleep(500);
        toggleState = await isSilentToggleOn();
      }

      if (toggleState === 'false') {
        await clickFlowElement('button[name="return-silent-videos"]');
        toggleState = await isSilentToggleOn();
      }
      onProgress(`[Pemulihan] Tampilkan video senyap: ${toggleState === 'true' ? 'Aktif' : 'gagal diaktifkan (' + toggleState + ')'}`);

      await cdp.pressKey('Escape', 27);
      await sleep(800);

      const retried = await clickFlowElement('.error-tile button[aria-label="Coba lagi"]');
      onProgress(retried ? '[Pemulihan] Klik "Coba lagi" pada kartu video yang gagal...' : '[Pemulihan] Tombol "Coba lagi" tidak ditemukan.');
      await sleep(5000);
      return retried;
    };

    while (Date.now() - startRender < maxWaitMs) {
      await sleep(3500);
      const elapsedSec = Math.round((Date.now() - startRender) / 1000);

      const statusCheck = await cdp.send('Runtime.evaluate', {
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

            if (/insufficient credits|not enough credits|out of (google flow )?credits|kredit (google flow )?(anda )?(tidak cukup|tidak mencukupi|habis)/i.test(bodyTxt)) {
              return { status: 'out_of_credits' };
            }

            // Kartu gagal: <div class="error-tile"> ... <span class="error-message-text">...</span>
            const errTile = Array.from(document.querySelectorAll('.error-tile')).find(isVisible);
            if (errTile) {
              const msgEl = errTile.querySelector('.error-message-text');
              const message = ((msgEl && msgEl.textContent) || errTile.innerText || '').split('\\n').join(' ').trim();
              return {
                status: 'error',
                message,
                canSilent: Boolean(errTile.querySelector('.settings-link')) && message.toLowerCase().includes('audio')
              };
            }

            // Sumber utama progres: <div class="loading-percentage">NN%</div> milik Google Flow
            const percentVals = Array.from(document.querySelectorAll('.loading-percentage'))
              .map(el => (el.textContent || '').trim())
              .filter(txt => /\\d+\\s*%/.test(txt))
              .map(txt => parseInt(txt, 10));
            if (percentVals.length > 0) {
              return { status: 'rendering', percent: Math.max(...percentVals) + '%' };
            }

            const loadingEls = Array.from(document.querySelectorAll('mat-progress-spinner, flow-soupy-overlay, [role="progressbar"]'));
            const activeSpinner = loadingEls.find(el => isVisible(el));

            const videoEls = Array.from(document.querySelectorAll('flow-video-tile video, video')).filter(isVisible);
            const playCards = Array.from(document.querySelectorAll('flow-video-tile, [aria-label*="play" i], [aria-label*="putar" i]')).filter(isVisible);

            if (!activeSpinner && (videoEls.length > 0 || playCards.length > 0)) {
              const v = videoEls[0];
              const src = v ? (v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '')) : '';
              // Video benar-benar jadi = kartu berisi thumbnail hasil (img.thumbnail termuat) + ikon play_circle,
              // atau elemen video sudah punya durasi asli. Kartu yang masih dirender belum punya keduanya.
              const doneTile = Array.from(document.querySelectorAll('flow-video-tile')).find((t) => {
                const thumb = t.querySelector('img.thumbnail');
                const playIcon = Array.from(t.querySelectorAll('mat-icon')).some((m) => (m.textContent || '').trim() === 'play_circle');
                return thumb && thumb.complete && thumb.naturalWidth > 0 && playIcon && !t.querySelector('.loading-percentage');
              });
              const videoReady = Boolean(v && src && v.readyState >= 1 && isFinite(v.duration) && v.duration > 1);
              return { status: 'done', src, ready: Boolean(doneTile) || videoReady, duration: v && isFinite(v.duration) ? Math.round(v.duration) : 0 };
            }

            return {
              status: 'rendering',
              percent: activeSpinner ? (activeSpinner.innerText || '').trim() : ''
            };
          })()
        `,
        returnByValue: true
      }).catch(() => null);

      const state = statusCheck?.result?.value;

      if (state?.status === 'out_of_credits') {
        throw new Error('Kredit Google Flow habis saat proses render berlangsung.');
      }

      if (state?.status === 'unusual') {
        throw new Error(flowUnusualActivityMessage(targetAcc && targetAcc.name));
      }

      if (state?.status === 'error') {
        const info = jelaskanErrorFlow(state.message);
        // Ditolak karena aktivitas tidak biasa → hentikan, JANGAN tekan "Coba lagi"
        if (isUnusualActivityError(state.message)) throw new Error(flowUnusualActivityMessage(targetAcc && targetAcc.name));
        if (state.canSilent && renderRetryCount < MAX_RENDER_RETRY) {
          renderRetryCount++;
          onProgress(`[Flow Gagal] ${state.message} → Mode video senyap & coba lagi (${renderRetryCount}/${MAX_RENDER_RETRY})...`);
          await enableSilentVideoAndRetry();
          sawRenderPercent = false;
          continue;
        }
        // Error lain yang bisa dipulihkan → klik "Coba lagi" pada kartu yang gagal
        if (renderRetryCount < MAX_RENDER_RETRY) {
          renderRetryCount++;
          onProgress(`[Flow Gagal] "${state.message || 'Gagal'}" — ${info.alasan} → coba lagi (${renderRetryCount}/${MAX_RENDER_RETRY})...`);
          const retried = await clickFlowElement('.error-tile button[aria-label="Coba lagi"]');
          onProgress(retried ? '[Pemulihan] Klik "Coba lagi" pada kartu video yang gagal...' : '[Pemulihan] Tombol "Coba lagi" tidak ditemukan.');
          if (retried) { await sleep(5000); sawRenderPercent = false; continue; }
        }
        throw new Error(`[Ganti Akun] Kartu video Flow tetap gagal setelah ${renderRetryCount}x "Coba lagi": "${state.message || 'Gagal'}" — ${info.alasan}`);
      }

      if (state?.percent) sawRenderPercent = true;

      // Selesai HANYA bila persentase render sudah hilang & video sudah bisa diputar (durasi terbaca).
      // URL yang tertangkap jaringan / kartu video saja tidak cukup: kartu muncul sejak render dimulai.
      if (state?.status === 'done' && state.ready && (sawRenderPercent || elapsedSec >= 40)) {
        isRenderCompleted = true;
        detectedVideoSrc = state.src || '';
        onProgress(`Video berhasil dirender (${elapsedSec} dtk · ${state.duration ? 'durasi ' + state.duration + ' dtk' : 'thumbnail hasil siap'})! Memulai pengunduhan berkas...`);
        await sleep(2500);
        break;
      }
      if (state?.status === 'done' && !state.ready && elapsedSec % 15 < 4) {
        onProgress(`Kartu video muncul, menunggu video benar-benar siap diputar [${elapsedSec} dtk]...`);
      }

      const pctInfo = state?.percent ? ` (${state.percent})` : '';
      onProgress(`Sedang merender video di Google Flow${pctInfo} [${elapsedSec} dtk]...`);
    }

    if (!isRenderCompleted) {
      // Diagnostik: simpan screenshot halaman Flow saat render tidak selesai
      const shotPath = path.join(os.tmpdir(), `flow_timeout_${Date.now()}.png`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot?.data) fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      throw new Error(`Batas waktu render habis (video belum selesai diproses oleh Google Flow). Screenshot: ${shotPath}`);
    }

    const timestamp = Date.now();
    const videoFileName = `video_daster_${timestamp}.mp4`;
    const sessionVideoPath = path.join(SESSIONS_VIDEOS_DIR, videoFileName);
    const storageVideoPath = path.join(OUTPUT_VIDEOS_DIR, videoFileName);

    const tempDownloadDir = path.resolve(ROOT_DIR, 'temp/flow_dl_daster_' + timestamp);
    if (!fs.existsSync(tempDownloadDir)) fs.mkdirSync(tempDownloadDir, { recursive: true });

    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir,
      eventsEnabled: true
    }).catch(() => {});
    // Cadangan untuk koneksi level halaman (Browser.* kadang ditolak) agar file pasti masuk folder sementara bot
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tempDownloadDir }).catch(() => {});

    // Cara utama = seperti manual: klik kartu video hasil → editor → tombol "Download media" → "Ukuran asli"
    onProgress('Membuka kartu video hasil render...');
    const videoCardPos = await cdp.findElementCenter({ selector: 'flow-video-tile img.thumbnail' })
      || await cdp.findElementCenter({ selector: 'flow-video-tile' });
    if (videoCardPos) await cdp.nativeClickAt(videoCardPos.x, videoCardPos.y, 1500);

    let dlBtnPos = null;
    for (let i = 0; i < 20 && !dlBtnPos; i++) {
      dlBtnPos = await cdp.findElementCenter({ selector: 'button[aria-label="Download media"], button[aria-label*="Download" i], button[aria-label*="Unduh" i]', maxY: 160 });
      if (!dlBtnPos) await sleep(750);
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

    if (!isSavedSuccess) {
      if (!dlBtnPos) onProgress('[Peringatan] Tombol "Download media" tidak ditemukan di editor video.');
      if (dlBtnPos) {
        onProgress('Menekan tombol Download media di editor Flow...');
        await cdp.nativeClickAt(dlBtnPos.x, dlBtnPos.y, 1200);

        // "Ukuran asli" = file asli tanpa proses upscale (1080p/4K butuh upgrade & waktu tambahan)
        let resMenuPos = null;
        for (const [rx, label] of [['Ukuran asli|Original size', 'Ukuran asli'], ['^\\s*720p', '720p'], ['^\\s*360p', '360p']]) {
          resMenuPos = await cdp.findElementCenter({ selector: 'button[role="menuitem"]', textRegexStr: rx });
          if (resMenuPos) { onProgress(`Memilih unduhan: ${label}...`); break; }
        }
        if (resMenuPos) await cdp.nativeClickAt(resMenuPos.x, resMenuPos.y, 1500);
        else onProgress('[Peringatan] Menu resolusi unduhan tidak muncul.');

        // Tunggu sampai file benar-benar selesai masuk folder lokal: .crdownload hilang,
        // ukuran stabil 2 detik, dan struktur MP4 lengkap (maks 3 menit)
        let lastSize = -1;
        let stableTicks = 0;
        for (let waitDl = 0; waitDl < 180; waitDl++) {
          await sleep(1000);
          if (!fs.existsSync(tempDownloadDir)) continue;
          const allFiles = fs.readdirSync(tempDownloadDir);
          const isDownloading = allFiles.some((f) => f.endsWith('.crdownload') || f.endsWith('.tmp'));
          const dlFiles = allFiles.filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && /\.(mp4|webm|mov)$/i.test(f));
          if (isDownloading || !dlFiles.length) {
            if (waitDl % 10 === 9) onProgress(`Menunggu unduhan video selesai masuk ke folder lokal (${waitDl + 1} dtk)...`);
            continue;
          }
          const downloadedFullPath = path.join(tempDownloadDir, dlFiles[0]);
          const size = fs.statSync(downloadedFullPath).size;
          stableTicks = size === lastSize ? stableTicks + 1 : 0;
          lastSize = size;
          if (stableTicks >= 2 && isCompleteVideoFile(downloadedFullPath)) {
            fs.copyFileSync(downloadedFullPath, sessionVideoPath);
            isSavedSuccess = isCompleteVideoFile(sessionVideoPath);
            if (isSavedSuccess) {
              onProgress(`Video berhasil diunduh via menu browser (${Math.round(size / 1024)} KB) ✓`);
              break;
            }
          }
        }
      }
    }

    if (!isSavedSuccess) {
      const candidateUrls = [
        ...(detectedVideoSrc && detectedVideoSrc.startsWith('http') ? [detectedVideoSrc] : []),
        ...interceptedVideoUrls
      ];

      // URL dari pemutar di halaman + URL video yang tertangkap di jaringan (tanpa duplikat)
      const domUrls = await cdp.send('Runtime.evaluate', {
        expression: `Array.from(document.querySelectorAll('video, video source')).map((v) => v.currentSrc || v.src || '').filter((u) => u.startsWith('http'))`,
        returnByValue: true
      }).then((r) => r?.result?.value || []).catch(() => []);
      const urlsToTry = [...new Set([...candidateUrls, ...domUrls])];
      if (!urlsToTry.length) onProgress('[Peringatan] Tidak ada URL video yang bisa diunduh.');

      for (const vUrl of urlsToTry) {
        if (isSavedSuccess) break;
        onProgress('Mengunduh video langsung dari URL (sesi login Flow)...');
        // 1) dengan cookie sesi Chrome bot, 2) cara lama tanpa cookie
        for (const [label, run] of [
          ['sesi', () => downloadVideoViaSession(cdp, vUrl, sessionVideoPath)],
          ['langsung', () => downloadFileFromUrl(vUrl, sessionVideoPath)]
        ]) {
          try {
            await run();
            if (isCompleteVideoFile(sessionVideoPath)) {
              isSavedSuccess = true;
              onProgress(`Video berhasil diunduh lewat URL (${Math.round(fs.statSync(sessionVideoPath).size / 1024)} KB) ✓`);
              break;
            }
            const size = fs.existsSync(sessionVideoPath) ? Math.round(fs.statSync(sessionVideoPath).size / 1024) : 0;
            onProgress(`URL (${label}) hanya memberi potongan / file belum utuh (${size} KB)...`);
          } catch (e) {
            onProgress(`URL (${label}) gagal: ${e.message}`);
          }
          discardFile(sessionVideoPath);
        }
      }

    }

    if (!isSavedSuccess) {
      onProgress('Mengekstrak stream video dari buffer pemutar...');
      const base64VideoRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (async () => {
            try {
              const vids = Array.from(document.querySelectorAll('video'));
              const targetVid = vids.find(v => v.currentSrc || v.src || v.querySelector('source')) || vids[0];
              if (!targetVid) return { error: 'Elemen video tidak ditemukan' };

              const url = targetVid.currentSrc || targetVid.src || (targetVid.querySelector('source') ? targetVid.querySelector('source').src : '');
              if (!url) return { error: 'URL video kosong' };

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
                reader.onerror = () => resolve({ error: 'Gagal membaca blob', url });
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
        isSavedSuccess = isCompleteVideoFile(sessionVideoPath);
        if (!isSavedSuccess) discardFile(sessionVideoPath);
        onProgress(isSavedSuccess ? `Video berhasil diekstrak (${Math.round(videoBuffer.length / 1024)} KB)!` : 'Hasil ekstrak buffer belum utuh.');
      } else {
        onProgress(`Ekstrak buffer pemutar gagal: ${extracted?.error || 'tidak ada data'}`);
      }
    }

    try {
      if (fs.existsSync(tempDownloadDir)) fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    } catch (e) {}

    if (!isSavedSuccess || !isCompleteVideoFile(sessionVideoPath)) {
      throw new Error('Gagal mengunduh berkas video jadi dari Google Flow (file kosong / belum utuh).');
    }

    fs.copyFileSync(sessionVideoPath, storageVideoPath);
    if (fs.statSync(storageVideoPath).size !== fs.statSync(sessionVideoPath).size || !isCompleteVideoFile(storageVideoPath)) {
      throw new Error('Video gagal disalin utuh ke folder galeri lokal.');
    }
    onProgress(`Video tersimpan utuh di folder lokal (${Math.round(fs.statSync(storageVideoPath).size / 1024)} KB) ✓`);

    try {
      const cfgNow = getFlowAccountsConfigRaw();
      const currentAcc = cfgNow.accounts.find((a) => a.id === targetAcc.id);
      if (currentAcc) {
        const numMatch = String(currentAcc.credits).replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1').match(/\d+/);
        const currentNum = numMatch ? parseInt(numMatch[0], 10) : 50;
        const outputNum = Math.min(4, Math.max(1, parseInt(flowOutputCount, 10) || 1));
        // Pakai biaya asli dari label Flow; estimasi 10/output hanya jika label tidak terbaca
        const spentCredit = actualFlowCost !== null ? actualFlowCost : 10 * outputNum;
        const newCreditValue = Math.max(0, currentNum - spentCredit);
        currentAcc.credits = `${newCreditValue} Kredit`;

        if (newCreditValue < (actualFlowCost || 1)) {
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
    // Gagal → tutup tuntas Chrome Flow (termasuk proses anak) & lepas kunci profil agar bisa langsung dijalankan lagi
    await cleanupFailedChrome({ proc: chromeProcess, profileDir, onProgress });
    await releaseGenerateSlot(onProgress);
    // Gagal karena akun → catat (kredit 0 / istirahat) agar rotasi tidak memilihnya lagi, lalu pemanggil coba akun lain
    const accountFailure = targetAcc ? classifyFlowAccountFailure(err.message) : null;
    if (accountFailure) {
      try {
        const cfgNow = getFlowAccountsConfigRaw();
        const acc = cfgNow.accounts.find((a) => a.id === targetAcc.id);
        if (acc) {
          if (accountFailure === 'credits') acc.credits = '0 Kredit';
          else if (accountFailure === 'blocked') acc.blockedUntil = Date.now() + FLOW_BLOCK_MS;
          saveFlowAccountsConfig(cfgNow);
        }
        onProgress(accountFailure === 'render'
          ? `[Rotasi Akun] Kartu video di ${targetAcc.name} gagal ${5}x → pindah ke akun Flow lain.`
          : accountFailure === 'credits'
          ? `[Rotasi Akun] Kredit ${targetAcc.name} habis → ditandai 0 kredit.`
          : `[Akun Flow] ${targetAcc.name} ditandai Flow → tidak dipakai ${FLOW_BLOCK_MS / 3600000} jam (kebijakan aplikasi).`);
      } catch (e) {}
    }
    return { success: false, error: err.message, accountUnavailable: Boolean(accountFailure), unusualActivity: isUnusualActivityError(err.message) };
  }
}

module.exports = {
  runFlowProjectCreationTiktokDaster
};

// Penjelasan error kartu Google Flow untuk log aplikasi + apakah layak dicoba ulang
function jelaskanErrorFlow(message) {
  const m = String(message || '').toLowerCase();
  if (isUnusualActivityError(m)) return { alasan: 'Google Flow mendeteksi aktivitas tidak biasa (bukan kredit habis).', bisaUlang: false };
  if (/kebijakan|policy|guideline|pedoman|melanggar|violat|unsafe|tidak aman|sensitive|sensitif|prominent|tokoh|minor|anak/.test(m)) {
    return { alasan: 'Prompt / gambar ditolak filter keamanan Google Flow (kebijakan konten). Ubah storyboard atau gambar produk.', bisaUlang: false };
  }
  if (/audio|suara/.test(m)) return { alasan: 'Google Flow gagal membuat audio video.', bisaUlang: true };
  if (/kredit|credit|kuota|quota|limit/.test(m)) return { alasan: 'Kredit / kuota akun Flow tidak cukup.', bisaUlang: false };
  if (/gambar|image|upload|unggah/.test(m)) return { alasan: 'Gambar referensi bermasalah di Google Flow (gagal dibaca / ditolak).', bisaUlang: true };
  if (/server|coba lagi|try again|something went wrong|terjadi kesalahan|error|gagal|failed|unavailable|timeout/.test(m)) {
    return { alasan: 'Gangguan sementara di server Google Flow.', bisaUlang: true };
  }
  return { alasan: 'Google Flow menolak / gagal membuat video.', bisaUlang: true };
}

const MAX_ACCOUNT_SWITCH = 3;
// Setiap render berjalan dengan peminjaman akun Flow sendiri (aman untuk banyak worker sekaligus)
for (const key of Object.keys(module.exports)) {
  const fn = module.exports[key];
  if (typeof fn !== 'function') continue;
  // Render gagal karena akun (kredit habis / ditandai Flow) → ulangi otomatis dengan akun Flow lain
  module.exports[key] = async (options = {}) => {
    let res;
    for (let attempt = 0; attempt <= MAX_ACCOUNT_SWITCH; attempt++) {
      res = await runWithFlowLease(() => fn(options));
      // Selalu tampilkan penyebab kegagalan di log aplikasi
      if (res && res.success === false && res.error && !/dibatalkan/i.test(res.error) && typeof options.onProgress === 'function') {
        options.onProgress(`[Flow Gagal] ${res.error}`);
      }
      // Aktivitas tidak biasa → berhenti, tanpa coba ulang / pindah akun otomatis
      if (res?.unusualActivity) break;
      if (!res?.accountUnavailable || attempt === MAX_ACCOUNT_SWITCH) break;
      if (typeof options.onProgress === 'function') options.onProgress(`[Rotasi Akun] Mencoba akun Flow lain (${attempt + 1}/${MAX_ACCOUNT_SWITCH})...`);
    }
    return res;
  };
}
