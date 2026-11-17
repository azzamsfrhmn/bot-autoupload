/**
 * src/services/aiVideoTiktok.js
 * Runner Otomasi Pembuatan Storyboard ChatGPT & Render Google Flow TikTok (Konsep JJ)
 * Menggunakan Profil Bersama (Single Shared Session) + Headless Toggle Support & Robust File/TLS Handling
 */

const { chromium } = require('playwright');
const { cleanupFailedChrome } = require('../core/chromeCleanup');
const { startPluginChat } = require('./chatgptPlugin');
const { withClipboardLock } = require('../core/clipboardLock');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { clipboard, nativeImage } = require('electron');

const { runFlowProjectCreationTiktok } = require('./flowVideoRunnerTiktok');
const { runCapCutTemplatePipeline } = require('./capcutWebRunner');

// Antrean CapCut antar worker (satu per satu)
let capcutChain = Promise.resolve();
function runCapCutExclusive(options) {
  const run = capcutChain.then(() => runCapCutTemplatePipeline(options));
  capcutChain = run.catch(() => {});
  return run;
}
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../core/perfProfile');

const CHAT_INPUT_SELECTORS = [
  '#prompt-textarea',
  'div#prompt-textarea',
  'div.ProseMirror',
  'div[contenteditable="true"]',
  'textarea[data-id="root"]',
  'div[role="textbox"]'
].join(', ');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

function getFlowHeadlessConfig(customRoot) {
  try {
    const root = customRoot || process.cwd();
    const candidatePaths = [
      path.resolve(root, 'sessions/flow_profiles/accounts_config.json'),
      path.resolve(__dirname, '../../sessions/flow_profiles/accounts_config.json'),
      path.resolve(process.cwd(), 'sessions/flow_profiles/accounts_config.json')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const cfg = JSON.parse(raw);
        if (typeof cfg.headless === 'boolean') {
          return cfg.headless;
        }
      }
    }
  } catch (e) {
    console.warn('[Headless Config Error]:', e);
  }
  return true; // default: mode senyap (headless) aktif
}

function resolveSharedProfileDir(customPath, baseDir) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const root = baseDir || process.cwd();
  return path.resolve(root, 'sessions/chatgpt_profile_shared');
}

function syncFromLegacyIfEmpty(targetDir, rootDir) {
  const hasCookies = (dir) => {
    if (!fs.existsSync(dir)) return false;
    return fs.existsSync(path.join(dir, 'Default', 'Network', 'Cookies')) ||
           fs.existsSync(path.join(dir, 'Network', 'Cookies'));
  };

  if (hasCookies(targetDir)) return;

  const sessionsDir = path.resolve(rootDir, 'sessions');
  const legacyDirs = [
    'chatgpt_video_profile',
    'chatgpt_profile_w1',
    'chatgpt_video_profile_w1',
    'chatgpt_profile'
  ];

  for (const name of legacyDirs) {
    const src = path.resolve(sessionsDir, name);
    if (hasCookies(src)) {
      try {
        fs.cpSync(src, targetDir, { recursive: true, force: true });
        break;
      } catch (e) {}
    }
  }
}

function purgeLocks(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
    const p = path.join(targetDir, f);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  });

  const defaultDir = path.join(targetDir, 'Default');
  ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'].forEach((item) => {
    const target = path.join(defaultDir, item);
    if (fs.existsSync(target)) {
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
        else fs.unlinkSync(target);
      } catch (e) {}
    }
  });
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

async function waitForChromeReady(port, maxRetries = 35, delay = 500) {
  maxRetries = scaleMs(maxRetries);
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch (e) {
      await sleep(delay);
    }
  }
  return false;
}

async function downloadToLocalFile(url, destPath) {
  if (!url || typeof url !== 'string') throw new Error('URL unduhan kosong');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://shop.tiktok.com/'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return destPath;
  } catch (err) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Referer': 'https://shop.tiktok.com/'
        },
        rejectUnauthorized: false
      };

      const req = client.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadToLocalFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Gagal unduh gambar: HTTP ${res.statusCode}`));
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(destPath);
        });
        fileStream.on('error', (e) => {
          try { fs.unlinkSync(destPath); } catch (_) {}
          reject(e);
        });
      });

      req.on('error', (e) => {
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(e);
      });
    });
  }
}

const STOP_BTN_SELECTOR = [
  'button[aria-label="Stop"]',
  'button[aria-label="Hentikan"]',
  'button[data-testid="stop-button"]'
].join(', ');

async function findChatInputWithRetry(page, timeoutMs = 90000) {
  timeoutMs = scaleMs(timeoutMs);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const input = page.locator(CHAT_INPUT_SELECTORS).first();
    const isVisible = await input.isVisible().catch(() => false);
    if (isVisible) return input;

    const hasReloadBtn = await page.locator('button:has-text("Reload"), button:has-text("Muat ulang")').isVisible().catch(() => false);
    if (hasReloadBtn) {
      await page.locator('button:has-text("Reload"), button:has-text("Muat ulang")').first().click().catch(() => {});
    }

    await sleep(1000);
  }
  // Diagnostik: simpan screenshot & info halaman agar tahu penyebab macet (misal verifikasi Cloudflare)
  const shotPath = path.join(os.tmpdir(), `chatgpt_stuck_${Date.now()}.png`);
  await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
  const pageTitle = await page.title().catch(() => '');
  throw new Error(`Timeout ${timeoutMs}ms menunggu kotak teks prompt ChatGPT muncul. Halaman: "${pageTitle}" (${page.url()}) · Screenshot: ${shotPath}`);
}

async function uploadFilesToChatGPT(page, filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter((f) => f && fs.existsSync(f));
  if (files.length === 0) return false;

  const chatInput = await findChatInputWithRetry(page, 90000);
  await chatInput.click({ force: true });
  await sleep(400);

  for (const filePath of files) {
    let uploadSuccess = false;

    // 1. Coba direct input file jika elemen ada di DOM
    try {
      const fileInputLocator = page.locator('input[type="file"]').first();
      if (await fileInputLocator.count() > 0) {
        await fileInputLocator.setInputFiles(filePath);
        uploadSuccess = true;
      }
    } catch (e) {
      uploadSuccess = false;
    }

    // 2. Klik tombol Attach (+)
    if (!uploadSuccess) {
      try {
        const attachBtn = page.locator([
          'button[aria-label*="Attach" i]',
          'button[aria-label*="Unggah" i]',
          'button[aria-label*="File" i]',
          'button[data-testid="attach-button"]',
          'button:has(svg.lucide-plus)'
        ].join(', ')).first();

        if (await attachBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
          await attachBtn.click({ force: true });
          await sleep(600);

          const uploadMenuOption = page.locator('div[role="menuitem"]:has-text("Upload"), div[role="menuitem"]:has-text("Unggah"), div[role="menuitem"]:has-text("computer"), div[role="menuitem"]:has-text("komputer")').first();
          if (await uploadMenuOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await uploadMenuOption.click({ force: true });
          }

          const fileChooser = await fileChooserPromise;
          if (fileChooser) {
            await fileChooser.setFiles(filePath);
            uploadSuccess = true;
          }
        }
      } catch (e) {
        uploadSuccess = false;
      }
    }

    // 3. Fallback Clipboard Control+V
    if (!uploadSuccess) {
      try {
        const img = nativeImage.createFromPath(filePath);
        if (!img.isEmpty()) {
          clipboard.clear();
          await withClipboardLock(async () => {
            clipboard.writeImage(img);
            await sleep(300);

            await chatInput.click({ force: true });
            await page.keyboard.press('Control+v');
          });
          uploadSuccess = true;
        }
      } catch (err) {}
    }

    await sleep(2500);

    // Tunggu chip attachment selesai diunggah
    await page.waitForFunction(() => {
      const hasThumb = document.querySelectorAll([
        'div[data-testid*="attachment"]',
        'div[class*="attachment"]',
        'img[alt*="attachment"]',
        'div[class*="upload"]',
        '.prompt-media-preview',
        'div:has(> img[src*="blob:"])'
      ].join(', ')).length > 0;
      const isUploading = document.querySelectorAll('div[role="progressbar"], circle[stroke-dasharray], .animate-spin').length > 0;
      return hasThumb && !isUploading;
    }, { timeout: 45000 }).catch(() => {});

    await sleep(1000);
  }
  return true;
}

async function triggerSend(page) {
  const chatInput = await findChatInputWithRetry(page, 45000).catch(() => null);
  if (chatInput) await chatInput.focus().catch(() => {});
  await sleep(400);

  const sendBtn = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]').first();
  if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sendBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }
  await sleep(2000);
}

async function fillAndSendChat(page, text) {
  await page.waitForFunction(() => {
    const isStopGone = !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"], button[aria-label="Hentikan"]');
    const input = document.querySelector('div.ProseMirror, #prompt-textarea, div[contenteditable="true"], textarea[data-id="root"]');
    return isStopGone && input && !input.getAttribute('disabled');
  }, { timeout: 75000 }).catch(() => {});

  await sleep(1000);

  const chatInput = await findChatInputWithRetry(page, 90000);
  await chatInput.click();
  await sleep(300);

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await sleep(200);

  await page.keyboard.insertText(text);
  await sleep(600);

  await triggerSend(page);
}

async function waitForSmartBotResponse(page, timeoutMs = 180000) {
  timeoutMs = scaleMs(timeoutMs);
  const assistantMsgSelector = 'div[data-message-author-role="assistant"], article[data-testid^="conversation-turn"]';
  const prevCount = await page.locator(assistantMsgSelector).count();

  const startWait = Date.now();
  while (Date.now() - startWait < 45000) {
    const currentCount = await page.locator(assistantMsgSelector).count();
    const isStopping = await page.locator(STOP_BTN_SELECTOR).first().isVisible().catch(() => false);
    if (currentCount > prevCount || isStopping) break;
    await sleep(1000);
  }

  try {
    const stopBtn = page.locator(STOP_BTN_SELECTOR).first();
    if (await stopBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await stopBtn.waitFor({ state: 'detached', timeout: timeoutMs }).catch(() => {});
    }
  } catch (e) {}

  await page.waitForFunction(() => !document.querySelector('.result-streaming'), { timeout: timeoutMs }).catch(() => {});
  await page.waitForFunction(() => {
    const input = document.querySelector('#prompt-textarea, div.ProseMirror, div[contenteditable="true"], textarea[data-id="root"]');
    const isInputReady = input && !input.getAttribute('disabled');
    const isStopGone = !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"]');
    return isInputReady && isStopGone;
  }, { timeout: 45000 }).catch(() => {});

  await sleep(2500);
}

async function extractAndSaveStoryboardImage(page, destStoryboard, onProgress = () => {}) {
  onProgress('Mencari dan mengunduh gambar hasil render...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(1500);

  const imageCandidateSelectors = [
    'div[data-message-author-role="assistant"] img[alt*="Generated" i]',
    'div[data-message-author-role="assistant"] img[src*="oaidalle"]',
    'div[data-message-author-role="assistant"] img[src*="dall-e"]',
    'div[data-message-author-role="assistant"] img[src*="backend-api"]',
    'div[data-message-author-role="assistant"] img[src*="files.oaiusercontent.com"]',
    'div[data-message-author-role="assistant"] img[src*="blob:"]',
    'div[data-message-author-role="assistant"] img:not([alt*="avatar" i]):not([src*="avatar"]):not([width="24"]):not([width="32"])',
    'img[alt*="Generated" i]',
    'img[src*="oaidalle"]'
  ];

  let targetImg = null;
  const maxWait = 180000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});

    for (const sel of imageCandidateSelectors) {
      const loc = page.locator(sel).last();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        const isReady = await loc.evaluate((img) => {
          return img && img.complete && (img.naturalWidth >= 200 || img.width >= 200);
        }).catch(() => false);

        if (isReady) {
          targetImg = loc;
          break;
        }
      }
    }

    if (targetImg) break;
    const waited = Math.round((Date.now() - startTime) / 1000);
    if (waited > 0 && waited % 20 < 2) onProgress(`Masih menunggu gambar kanvas dari ChatGPT (${waited} dtk)...`);
    await sleep(2000);
  }

  if (!targetImg) {
    const shotPath = path.join(os.tmpdir(), `chatgpt_noimage_${Date.now()}.png`);
    await page.screenshot({ path: shotPath }).catch(() => {});
    throw new Error(`Gambar hasil render tidak ditemukan. Screenshot: ${shotPath}`);
  }

  await targetImg.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(2000);

  try {
    const base64String = await targetImg.evaluate(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src) return null;

      try {
        const res = await fetch(src, { credentials: 'include' });
        if (res.ok) {
          const blob = await res.blob();
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result || '';
              resolve(result.replace(/^data:image\/[a-zA-Z+]+;base64,/, ''));
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      } catch (e) {}

      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1024;
        canvas.height = img.naturalHeight || 1024;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        return null;
      }
    });

    if (base64String && base64String.length > 5000) {
      const imgBuffer = Buffer.from(base64String, 'base64');
      fs.writeFileSync(destStoryboard, imgBuffer);
      const nativeImg = nativeImage.createFromBuffer(imgBuffer);
      onProgress('Gambar berhasil diunduh dan disimpan!');
      return true;
    }
  } catch (err) {}

  await targetImg.screenshot({ path: destStoryboard });
  return fs.existsSync(destStoryboard) && fs.statSync(destStoryboard).size > 1000;
}

function formatTiktokPrompts(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  const cleanRaw = rawText.trim();
  if (!cleanRaw) return '';

  let photo1 = '';
  let photo2 = '';
  let photo3 = '';
  let videoPrompt = '';
  let panduan = '';

  const p1Match = cleanRaw.match(/(?:PHOTO\s*1[\s:—–-]*)([\s\S]*?)(?=(?:PHOTO\s*2|$))/i);
  const p2Match = cleanRaw.match(/(?:PHOTO\s*2[\s:—–-]*)([\s\S]*?)(?=(?:PHOTO\s*3|$))/i);
  const p3Match = cleanRaw.match(/(?:PHOTO\s*3[\s:—–-]*)([\s\S]*?)(?=(?:VIDEO\s*(?:PROMPT|FLOW)|PANDUAN|Pengaturan|$))/i);
  const vidMatch = cleanRaw.match(/(?:VIDEO\s*(?:PROMPT|FLOW)[\s:—–-]*)([\s\S]*?)(?=(?:PHOTO\s*1|PANDUAN|Pengaturan|HASIL AKHIR|$))/i);
  const jjMatch = cleanRaw.match(/(?:(?:PANDUAN\s*CAPCUT|Pengaturan\s*CapCut)[\s\S]*)/i);

  if (p1Match && p1Match[1]) photo1 = p1Match[1].trim();
  if (p2Match && p2Match[1]) photo2 = p2Match[1].trim();
  if (p3Match && p3Match[1]) photo3 = p3Match[1].trim();
  if (vidMatch && vidMatch[1]) videoPrompt = vidMatch[1].trim();
  if (jjMatch && jjMatch[0]) panduan = jjMatch[0].trim();

  if (photo1 || photo2 || photo3 || videoPrompt) {
    const sections = [
      '========================================',
      'PHOTO 1:',
      photo1 || 'Model candid santai natural di depan kamera, pencahayaan lembut, busana konsisten.',
      '',
      '========================================',
      'PHOTO 2:',
      photo2 || 'Model candid menyentuh rambut secara alami, framing vertikal 9:16.',
      '',
      '========================================',
      'PHOTO 3:',
      photo3 || 'Model candid merapikan pakaian atau pose elegan santai, fokus pada busana.',
      '',
      '========================================',
      'VIDEO PROMPT:',
      videoPrompt || 'Shot on smartphone, vertical 9:16 fashion affiliate video, static locked-off camera, model wearing product with natural micro-movements, silent video, no sound.'
    ];

    if (panduan) {
      sections.push('', '========================================', 'PANDUAN CAPCUT JJ:', panduan);
    }
    return sections.join('\n');
  }

  return cleanRaw;
}

async function runTikTokVideoPipeline(options = {}) {
  const {
    concept = 'jj',
    bannerImagePath,
    customCharacterPath,
    referenceImagePath,
    storyboardType = '1',
    flowRatio = '9:16',
    flowModel = 'Veo 3.1 - Lite',
    flowResolution = '720p',
    flowDuration = '8 Detik',
    flowOutputCount = '1',
    chatgptProfileDir,
    profileDir,
    dataRoot,
    onProgress = () => {}
  } = options;

  let browser = null;
  let chromeProcess = null;

  // Baca headless eksplisit dari options atau fallback ke config JSON
  const isHeadless = typeof options.headless === 'boolean'
    ? options.headless
    : getFlowHeadlessConfig(dataRoot);

  const ROOT_DIR = dataRoot || process.cwd();
  const STORYBOARD_DIR = path.resolve(ROOT_DIR, 'storage/storyboards');
  const STORYBOARD_META_JSON = path.resolve(STORYBOARD_DIR, 'metadata.json');
  const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
  const targetUserDataDir = chatgptProfileDir || profileDir || resolveSharedProfileDir(null, ROOT_DIR);

  [STORYBOARD_DIR, BAHAN_VIDEO_DIR, targetUserDataDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  try {
    const timestamp = Date.now();
    const currentProjectDir = path.join(BAHAN_VIDEO_DIR, `proyek_tiktok_jj_${timestamp}`);
    if (!fs.existsSync(currentProjectDir)) fs.mkdirSync(currentProjectDir, { recursive: true });

    let localProductBannerPath = '';
    if (bannerImagePath && (bannerImagePath.startsWith('http://') || bannerImagePath.startsWith('https://'))) {
      onProgress('Mengunduh foto produk dari Showcase TikTok...');
      const downloadedFile = path.join(currentProjectDir, `product_showcase_${timestamp}.png`);
      await downloadToLocalFile(bannerImagePath, downloadedFile);
      localProductBannerPath = downloadedFile;
    } else {
      localProductBannerPath = bannerImagePath;
    }

    if (!localProductBannerPath || !fs.existsSync(localProductBannerPath)) {
      throw new Error('Foto produk dari showcase tidak ditemukan.');
    }
    if (!customCharacterPath || !fs.existsSync(customCharacterPath)) {
      throw new Error('Foto karakter belum dipilih.');
    }
    if (!referenceImagePath || !fs.existsSync(referenceImagePath)) {
      throw new Error('Foto referensi Pinterest belum dipilih.');
    }

    syncFromLegacyIfEmpty(targetUserDataDir, ROOT_DIR);
    purgeLocks(targetUserDataDir);

    // Port Chrome ChatGPT per worker (worker 2 = 9242, dst.) agar beberapa worker bisa berjalan bersamaan
    const cdpPort = 9232 + ((Number(options.workerId) || 1) - 1) * 10;
    const chromeExe = getOriginalChromeExecutablePath();
    if (!chromeExe) throw new Error('Google Chrome tidak ditemukan di sistem.');

    onProgress(`Membuka sesi Chrome ChatGPT (Port ${cdpPort} · Headless: ${isHeadless ? 'Aktif' : 'Nonaktif'})...`);

    const chromeArgs = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${targetUserDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-restore-session-state',
      '--window-size=1280,900',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--lang=id-ID'
    ];

    if (isHeadless) {
      // ChatGPT (Cloudflare) memblokir --headless, jadi pakai Chrome asli dengan jendela di luar layar
      chromeArgs.push(
        '--window-position=-32000,-32000',
        '--mute-audio',
        // Cegah Chrome menjeda render/timer karena jendela dianggap tertutup (occluded)
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
      );
    } else {
      chromeArgs.push('--window-position=0,0');
    }

    chromeArgs.push('https://chatgpt.com/');

    chromeProcess = spawn(chromeExe, [...chromeArgs, ...chromeLiteArgs()], { detached: false, stdio: 'ignore' });

    await waitForChromeReady(cdpPort, 35, 500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

    const context = browser.contexts()[0] || (await browser.newContext());
    let page = context.pages().find((p) => p.url().includes('chatgpt.com')) || context.pages()[0];
    if (!page) page = await context.newPage();

    if (isHeadless) {
      await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      }).catch(() => {});
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
    await sleep(2500);

    const isLoginState = await page.evaluate(() => {
      const u = window.location.href.toLowerCase();
      const hasLoginBtn = !!document.querySelector('button[data-testid="login-button"], a[href*="/login"], button:has-text("Log in")');
      return u.includes('/auth/') || u.includes('/login') || hasLoginBtn;
    }).catch(() => false);

    if (isLoginState) {
      if (isHeadless) {
        // Tampilkan jendela ke layar agar login bisa diselesaikan manual
        try {
          const cdpSession = await context.newCDPSession(page);
          const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
          await cdpSession.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0 } });
        } catch (e) {}
      }
      onProgress('Silakan selesaikan login ChatGPT di jendela browser yang terbuka...');
      await page.waitForFunction(() => {
        const u = window.location.href.toLowerCase();
        const input = document.querySelector('#prompt-textarea, div.ProseMirror, div[contenteditable="true"], textarea[data-id="root"]');
        return !u.includes('/auth/') && !u.includes('/login') && !!input;
      }, { timeout: 300000 }).catch(() => {});
      await sleep(2000);
    }

    await findChatInputWithRetry(page, 90000);

    onProgress('Langkah 1/2: Membersihkan latar belakang produk baju...');
    const isProductUploaded = await uploadFilesToChatGPT(page, [localProductBannerPath]);
    if (!isProductUploaded) throw new Error('Gagal mengunggah foto produk ke ChatGPT.');
    await sleep(2000);

    await fillAndSendChat(page, 'hilangkan orangnya dan ambil produk bajunya saja, dengan background polos');
    await waitForSmartBotResponse(page, 150000);

    const cleanProductPath = path.join(currentProjectDir, '01_baju_bersih.png');
    await extractAndSaveStoryboardImage(page, cleanProductPath, onProgress).catch(() => {});

    const finalBaju = (fs.existsSync(cleanProductPath) && fs.statSync(cleanProductPath).size > 1000)
      ? cleanProductPath
      : localProductBannerPath;

    // Storyboard kini lewat plugin ChatGPT (@Nama Plugin) di chat baru, bukan link Custom GPT
    onProgress('Tahap 1: Menjalankan perintah RUN lewat plugin @TikTok Affiliate Storyboard & Veo Pro...');
    await startPluginChat(page, 'TikTok Affiliate Storyboard & Veo Pro', 'RUN', onProgress);
    await waitForSmartBotResponse(page, 75000);

    onProgress('Mengunggah foto baju bersih dan referensi Pinterest...');
    await uploadFilesToChatGPT(page, [finalBaju, referenceImagePath]);
    await sleep(1500);
    await triggerSend(page);
    await waitForSmartBotResponse(page, 90000);

    onProgress('Tahap 2: Memilih opsi A (Dengan Karakter)...');
    await fillAndSendChat(page, 'A');
    await waitForSmartBotResponse(page, 75000);

    onProgress('Tahap 3: Mengunggah foto model/karakter...');
    await uploadFilesToChatGPT(page, [customCharacterPath]);
    await sleep(1500);
    await triggerSend(page);

    onProgress('Tahap 4: Menunggu render Master Reference (9:16)...');
    await waitForSmartBotResponse(page, 240000);

    const destStoryboard = path.join(STORYBOARD_DIR, `storyboard_${timestamp}.png`);
    const destProject = path.join(currentProjectDir, 'storyboard_canvas.png');

    const isDownloaded = await extractAndSaveStoryboardImage(page, destStoryboard, onProgress);
    if (!isDownloaded || !fs.existsSync(destStoryboard)) {
      throw new Error('Gagal mengunduh kanvas master reference.');
    }

    fs.copyFileSync(destStoryboard, destProject);
    onProgress('Master reference tersimpan.');
    await sleep(1500);

    onProgress('Tahap 5: Meminta prompt video & foto candid...');
    await fillAndSendChat(page, 'YA');
    await waitForSmartBotResponse(page, 180000);

    onProgress('Mengekstrak teks prompt...');
    await sleep(3500);

    const extractedText = await page.evaluate(async () => {
      const codeBlocks = Array.from(document.querySelectorAll('pre code, pre, div[data-code-block-source="true"]'));
      for (let i = codeBlocks.length - 1; i >= 0; i--) {
        const txt = (codeBlocks[i].innerText || codeBlocks[i].textContent || '').trim();
        if (txt.includes('PHOTO 1') || txt.includes('VIDEO')) return txt;
      }
      const msgs = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
      if (msgs.length > 0) {
        return (msgs[msgs.length - 1].innerText || '').trim();
      }
      return '';
    });

    const formattedPromptsResult = formatTiktokPrompts(extractedText);

    const projectPromptPath = path.join(currentProjectDir, 'prompt_video.txt');
    fs.writeFileSync(projectPromptPath, formattedPromptsResult, 'utf-8');

    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}

    onProgress('Menghubungkan ke Google Flow...');
    const flowResult = await runFlowProjectCreationTiktok({
      workerId: Number(options.workerId) || 1,
      projectFolder: currentProjectDir,
      storyboardImagePath: destStoryboard,
      promptText: formattedPromptsResult,
      flowVideoType: 'Bahan',
      flowRatio: flowRatio || '9:16',
      flowModel: flowModel || 'Veo 3.1 - Lite',
      flowResolution: flowResolution || '720p',
      flowDuration: flowDuration || '8 Detik',
      flowOutputCount: flowOutputCount || '1',
      headless: isHeadless,
      onProgress: (status) => onProgress(status)
    });

    if (!flowResult || !flowResult.success) {
      throw new Error(flowResult?.error || 'Gagal saat memproses rendering di Google Flow TikTok.');
    }

    let finalVideoPath = flowResult.videoPath;
    let capcutResult = null;

    onProgress('Melanjutkan ke CapCut Web (JJ)...');
    // CapCut memakai satu profil Chrome: antar worker dijalankan bergiliran
    capcutResult = await runCapCutExclusive({
      searchKeyword: 'JJ',
      videoPath: flowResult.videoPath,
      candidPaths: flowResult.candidPaths || [],
      headless: true,
      onProgress: (status) => onProgress(`[CapCut] ${status}`)
    });

    if (capcutResult && capcutResult.success) {
      finalVideoPath = capcutResult.videoPath;
      onProgress(`🎉 Sukses! Video JJ selesai dibuat: ${path.basename(finalVideoPath)}`);
    }

    return {
      success: true,
      concept: 'jj',
      projectFolder: currentProjectDir,
      bannerUsed: localProductBannerPath,
      characterUsed: customCharacterPath,
      storyboardImages: [destStoryboard],
      promptText: formattedPromptsResult,
      videoPath: finalVideoPath,
      storagePath: finalVideoPath,
      fileName: path.basename(finalVideoPath),
      thumbnailPath: flowResult.thumbnailPath,
      flowResult,
      capcutResult
    };
  } catch (error) {
    // Gagal → tutup tuntas Chrome ChatGPT (termasuk proses anak) & lepas kunci profil agar bisa langsung dijalankan lagi
    if (browser) await browser.close().catch(() => {});
    browser = null;
    await cleanupFailedChrome({ proc: chromeProcess, profileDir: targetUserDataDir, onProgress });
    chromeProcess = null;
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
  }
}

module.exports = {
  runTikTokVideoPipeline
};