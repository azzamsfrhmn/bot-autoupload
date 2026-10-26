/**
 * src/services/aiVideo.js
 * Runner Otomasi Pembuatan Storyboard ChatGPT & Render Google Flow TikTok / Instagram
 * Mendukung Konsep: Jedag-Jedug (JJ) & Daster/Homewear Try-On
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { clipboard, nativeImage, shell } = require('electron');

// Runner Otomasi Google Flow TikTok (3 Foto Candid 1K + 1 Video Motion)
const { runFlowProjectCreationTiktok } = require('./flowVideoRunnerTiktok');
// Runner Otomasi CapCut Web (JJ)
const { runCapCutTemplatePipeline } = require('./capcutWebRunner');

const ROOT_DIR = process.cwd();
const TEMP_DIR = path.resolve(ROOT_DIR, 'temp');
const STORYBOARD_DIR = path.resolve(ROOT_DIR, 'storage/storyboards');
const STORYBOARD_META_JSON = path.resolve(STORYBOARD_DIR, 'metadata.json');
const VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const STORAGE_IMG_DIR = path.resolve(ROOT_DIR, 'storage/images');
const DEFAULT_USER_DATA_DIR = path.resolve(ROOT_DIR, 'sessions/chatgpt_video_profile');

[TEMP_DIR, STORYBOARD_DIR, VIDEOS_DIR, BAHAN_VIDEO_DIR, STORAGE_IMG_DIR, DEFAULT_USER_DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadToLocalFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
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
  for (const binPath of candidates) {
    if (fs.existsSync(binPath)) return binPath;
  }
  return undefined;
}

async function waitForChromeReady(port, maxRetries = 25, delay = 400) {
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

function ensureWorkerVideoProfileInitialized(targetWorkerDir) {
  if (!fs.existsSync(targetWorkerDir)) {
    fs.mkdirSync(targetWorkerDir, { recursive: true });
  }
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  lockFiles.forEach((f) => {
    const p = path.join(targetWorkerDir, f);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  });

  const defaultDir = path.join(targetWorkerDir, 'Default');
  const sessionItems = ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
  sessionItems.forEach((item) => {
    const target = path.join(defaultDir, item);
    if (fs.existsSync(target)) {
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          fs.unlinkSync(target);
        }
      } catch (e) {}
    }
  });

  const prefPath = path.join(defaultDir, 'Preferences');
  if (fs.existsSync(prefPath)) {
    try {
      const content = fs.readFileSync(prefPath, 'utf-8');
      const json = JSON.parse(content);
      if (json.profile) {
        json.profile.exit_type = 'Normal';
        json.profile.exited_cleanly = true;
      }
      if (!json.session) json.session = {};
      json.session.restore_on_startup = 5;
      fs.writeFileSync(prefPath, JSON.stringify(json));
    } catch (e) {}
  }
}

const STOP_BTN_SELECTOR = [
  'button[aria-label="Stop"]',
  'button[aria-label="Hentikan"]',
  'button[data-testid="stop-button"]'
].join(', ');

async function uploadFilesToChatGPT(page, filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter((f) => f && fs.existsSync(f));
  if (files.length === 0) return false;

  for (const filePath of files) {
    let uploadSuccess = false;

    try {
      const attachBtn = page.locator('button[aria-label*="attach" i], button[aria-label*="Unggah" i], button[data-testid="attach-button"], button:has(svg.lucide-plus), form button:has-text("+")').first();
      if (await attachBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await attachBtn.click({ force: true }).catch(() => {});
        await sleep(500);
      }

      const fileInput = page.locator('input[type="file"]').last();
      await fileInput.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
      await fileInput.setInputFiles(filePath);
      uploadSuccess = true;
    } catch (e) {
      uploadSuccess = false;
    }

    if (!uploadSuccess) {
      try {
        const img = nativeImage.createFromPath(filePath);
        if (!img.isEmpty()) {
          clipboard.writeImage(img);
          const inputSelector = '#prompt-textarea, div.ProseMirror, div[contenteditable="true"]';
          const chatInput = page.locator(inputSelector).first();
          await chatInput.click();
          await sleep(300);
          await page.keyboard.press('Control+v');
          uploadSuccess = true;
        }
      } catch (err) {}
    }

    await sleep(2500);

    await page.waitForFunction(() => {
      const hasThumb = document.querySelectorAll('div[data-testid*="attachment"], div[class*="attachment"], img[alt*="attachment"], div[class*="upload"], .prompt-media-preview').length > 0;
      const isUploading = document.querySelectorAll('div[role="progressbar"], circle[stroke-dasharray], .animate-spin').length > 0;
      return hasThumb && !isUploading;
    }, { timeout: 20000 }).catch(() => {});

    await sleep(1000);
  }
  return true;
}

async function triggerSend(page) {
  const inputSelector = '#prompt-textarea, div.ProseMirror, div[contenteditable="true"]';
  const chatInput = page.locator(inputSelector).first();
  await chatInput.focus().catch(() => {});
  await sleep(400);

  const sendBtn = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]').first();
  const isSendBtnVisible = await sendBtn.isVisible({ timeout: 2500 }).catch(() => false);

  if (isSendBtnVisible) {
    await sendBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }
  await sleep(2000);
}

async function fillAndSendChat(page, text) {
  await page.waitForFunction(() => {
    const isStopGone = !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"], button[aria-label="Hentikan"]');
    const input = document.querySelector('div.ProseMirror, #prompt-textarea, div[contenteditable="true"]');
    return isStopGone && input && !input.getAttribute('disabled');
  }, { timeout: 60000 }).catch(() => {});

  await sleep(1000);

  const inputSelector = 'div.ProseMirror, #prompt-textarea, div[contenteditable="true"]';
  const chatInput = page.locator(inputSelector).first();
  await chatInput.waitFor({ state: 'visible', timeout: 30000 });
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
  const assistantMsgSelector = 'div[data-message-author-role="assistant"], article[data-testid^="conversation-turn"]';
  const prevCount = await page.locator(assistantMsgSelector).count();

  const startWait = Date.now();
  while (Date.now() - startWait < 35000) {
    const currentCount = await page.locator(assistantMsgSelector).count();
    const isStopping = await page.locator(STOP_BTN_SELECTOR).first().isVisible().catch(() => false);
    if (currentCount > prevCount || isStopping) break;
    await sleep(1000);
  }

  try {
    const stopBtn = page.locator(STOP_BTN_SELECTOR).first();
    if (await stopBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await stopBtn.waitFor({ state: 'detached', timeout: timeoutMs }).catch(() => {});
    }
  } catch (e) {}

  await page.waitForFunction(() => !document.querySelector('.result-streaming'), { timeout: timeoutMs }).catch(() => {});
  await page.waitForFunction(() => {
    const input = document.querySelector('#prompt-textarea, div.ProseMirror, div[contenteditable="true"]');
    const isInputReady = input && !input.getAttribute('disabled');
    const isStopGone = !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"]');
    return isInputReady && isStopGone;
  }, { timeout: 35000 }).catch(() => {});

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
    await sleep(2000);
  }

  if (!targetImg) {
    throw new Error('Gambar hasil render tidak ditemukan.');
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
      if (!nativeImg.isEmpty()) clipboard.writeImage(nativeImg);
      onProgress('Gambar berhasil diunduh dan disimpan!');
      return true;
    }
  } catch (err) {}

  await targetImg.screenshot({ path: destStoryboard });
  if (fs.existsSync(destStoryboard)) {
    const buf = fs.readFileSync(destStoryboard);
    const nativeImg = nativeImage.createFromBuffer(buf);
    if (!nativeImg.isEmpty()) clipboard.writeImage(nativeImg);
  }

  return fs.existsSync(destStoryboard) && fs.statSync(destStoryboard).size > 1000;
}

function formatTiktokPrompts(rawText, concept = 'jj') {
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

  if (!videoPrompt) {
    const tmVid = cleanRaw.match(/\d{2}:\d{2}[–-]\d{2}:\d{2}\s*(?:VIDEO\s*(?:FLOW|PROMPT))[\s:—–-]*([\s\S]*?)(?=\d{2}:\d{2}|$)/i);
    if (tmVid && tmVid[1]) videoPrompt = tmVid[1].trim();
  }
  if (!photo1) {
    const tmP1 = cleanRaw.match(/\d{2}:\d{2}(?:\.\d+)?[–-]\d{2}:\d{2}(?:\.\d+)?\s*(?:PHOTO\s*1)[\s:—–-]*([\s\S]*?)(?=\d{2}:\d{2}|$)/i);
    if (tmP1 && tmP1[1]) photo1 = tmP1[1].trim();
  }
  if (!photo2) {
    const tmP2 = cleanRaw.match(/\d{2}:\d{2}(?:\.\d+)?[–-]\d{2}:\d{2}(?:\.\d+)?\s*(?:PHOTO\s*2)[\s:—–-]*([\s\S]*?)(?=\d{2}:\d{2}|$)/i);
    if (tmP2 && tmP2[1]) photo2 = tmP2[1].trim();
  }
  if (!photo3) {
    const tmP3 = cleanRaw.match(/\d{2}:\d{2}(?:\.\d+)?[–-]\d{2}:\d{2}(?:\.\d+)?\s*(?:PHOTO\s*3)[\s:—–-]*([\s\S]*?)(?=(?:Pengaturan|HASIL|PANDUAN|\d{2}:\d{2}|$))/i);
    if (tmP3 && tmP3[1]) photo3 = tmP3[1].trim();
  }

  const isDaster = concept === 'daster';

  const defaultP1 = isDaster
    ? 'Indonesian woman relaxing casually at modern home wearing daster homewear, hands gently resting on lap, natural ambient indoor lighting, authentic visible skin pores, vertical 9:16 mobile capture.'
    : 'Model candid santai natural di depan kamera, pencahayaan lembut, busana konsisten.';

  const defaultP2 = isDaster
    ? 'Indonesian woman wearing daster homewear, sitting by living room couch, one hand gently tucking hair behind ear, smiling warmly, natural sunlight through window, raw 9:16 smartphone photo.'
    : 'Model candid menyentuh rambut secara alami, framing vertikal 9:16.';

  const defaultP3 = isDaster
    ? 'Model candid in home setting, standing softly near home terrace, one hand holding the lightweight hem of the homewear daster, fabric drape visible, sharp authentic focus, 9:16.'
    : 'Model candid merapikan pakaian atau pose elegan santai, fokus pada busana.';

  let defaultVid = isDaster
    ? 'Shot on iPhone 15 Pro, vertical 9:16 indoor lifestyle video, static locked-off tripod frame, no camera movement, model wearing comfortable daster at home, subtle breathing and gentle hand gesture, completely silent video, muted, closed mouth, pure visual b-roll footage.'
    : 'Shot on iPhone 15 Pro, vertical 9:16 fashion affiliate video, steady static locked-off camera, no zoom, model wearing product with natural micro-movements, completely silent video, muted, no speaking, closed mouth.';

  if (videoPrompt && !videoPrompt.toLowerCase().includes('silent')) {
    videoPrompt = `${videoPrompt}, completely silent video, muted, no talking, closed mouth, pure visual b-roll`;
  }

  if (photo1 || photo2 || photo3 || videoPrompt) {
    const sections = [
      '========================================',
      'PHOTO 1:',
      photo1 || defaultP1,
      '',
      '========================================',
      'PHOTO 2:',
      photo2 || defaultP2,
      '',
      '========================================',
      'PHOTO 3:',
      photo3 || defaultP3,
      '',
      '========================================',
      'VIDEO PROMPT:',
      videoPrompt || defaultVid
    ];

    if (panduan) {
      sections.push(
        '',
        '========================================',
        'PANDUAN CAPCUT JJ:',
        panduan
      );
    }

    return sections.join('\n');
  }

  return cleanRaw;
}

async function runTikTokVideoPipeline({
  concept = 'jj',
  bannerImagePath,
  customCharacterPath,
  referenceImagePath,
  storyboardType = '1',
  flowRatio = '9:16',
  flowModel = 'Veo 3.1 - Lite',
  flowResolution = '720p',
  flowDuration = '8 Detik',
  workerId = 1,
  onProgress = () => {}
}) {
  let browser = null;
  let chromeProcess = null;
  const currentWorkerId = Number(workerId || 1);
  const isDasterConcept = String(concept || '').toLowerCase() === 'daster';
  const isJJConcept = !isDasterConcept || String(concept || '').toLowerCase() === 'jj';

  try {
    const timestamp = Date.now();
    const currentProjectDir = path.join(BAHAN_VIDEO_DIR, `proyek_tiktok_${timestamp}_w${currentWorkerId}`);
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
      throw new Error('Foto referensi suasana belum dipilih.');
    }

    const targetUserDataDir = currentWorkerId === 1
      ? DEFAULT_USER_DATA_DIR
      : path.resolve(ROOT_DIR, `sessions/chatgpt_video_profile_worker_${currentWorkerId}`);

    ensureWorkerVideoProfileInitialized(targetUserDataDir);

    const cdpPort = 9230 + currentWorkerId;
    const windowPosArg = currentWorkerId === 1 ? '--window-position=0,0' : '--window-position=960,0';
    const chromeExe = getOriginalChromeExecutablePath();

    if (!chromeExe) throw new Error('Google Chrome tidak ditemukan di sistem.');

    onProgress(`[Worker ${currentWorkerId}] Membuka sesi Chrome ChatGPT (Port ${cdpPort})...`);

    chromeProcess = spawn(chromeExe, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${targetUserDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-restore-session-state',
      '--window-size=960,1000',
      windowPosArg,
      'https://chatgpt.com/'
    ], { detached: false, stdio: 'ignore' });

    await waitForChromeReady(cdpPort, 25, 400);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      for (const p of pages) {
        const url = p.url().toLowerCase();
        if (url.includes('pinterest') || (!url.includes('chatgpt.com') && pages.length > 1)) {
          await p.close().catch(() => {});
        }
      }
    }

    const context = browser.contexts()[0] || (await browser.newContext());
    let page = context.pages().find((p) => p.url().includes('chatgpt.com')) || context.pages()[0];
    if (!page) page = await context.newPage();

    // =========================================================================
    // LANGKAH: CUSTOM GPT TIKTOK STORYBOARD
    // =========================================================================
    const tiktokCustomGptUrl = 'https://chatgpt.com/g/g-6ad08314e1088191a0fa14c307763cde-tiktok-affiliate-storyboard-veo-pro';
    onProgress(`Menuju Custom GPT [Konsep: ${isDasterConcept ? 'Daster Try-On' : 'TikTok JJ'}]...`);
    await page.goto(tiktokCustomGptUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3500);

    const inputSelector = '#prompt-textarea, div.ProseMirror, div[contenteditable="true"]';
    let chatInput = page.locator(inputSelector).first();
    await chatInput.waitFor({ state: 'visible', timeout: 45000 });

    onProgress('Tahap 1: Menjalankan perintah RUN...');
    const runBtn = page.locator('button:has-text("RUN"), div[role="button"]:has-text("RUN")').first();
    if (await runBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await runBtn.click();
      await sleep(1000);
      await triggerSend(page);
    } else {
      await fillAndSendChat(page, 'RUN');
    }
    await waitForSmartBotResponse(page, 75000);

    onProgress('Mengunggah Foto Produk Etalase dan Foto Referensi Suasana...');
    const isUploaded = await uploadFilesToChatGPT(page, [localProductBannerPath, referenceImagePath]);
    if (!isUploaded) {
      throw new Error('Gagal mengunggah gambar produk dan referensi ke ChatGPT.');
    }
    await sleep(1500);

    if (isDasterConcept) {
      await fillAndSendChat(page, 'Konsep produk daster homewear santai rumah. Fokus pada motif kain daster dan suasana ruangan rumah yang nyaman.');
    } else {
      await triggerSend(page);
    }
    await waitForSmartBotResponse(page, 90000);

    onProgress('Tahap 2: Memilih opsi A (Dengan Karakter)...');
    await fillAndSendChat(page, 'A');
    await waitForSmartBotResponse(page, 75000);

    onProgress('Tahap 3: Mengunggah foto karakter utama...');
    await uploadFilesToChatGPT(page, [customCharacterPath]);
    await sleep(1500);
    await triggerSend(page);

    onProgress('Tahap 4: Menunggu render Master Reference (9:16)...');
    await waitForSmartBotResponse(page, 240000);

    onProgress('Mengunduh hasil Master Reference...');
    const destStoryboard = path.join(STORYBOARD_DIR, `storyboard_${timestamp}_w${currentWorkerId}.png`);
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

    onProgress('Mengekstrak blok prompt...');
    await sleep(3000);

    let extractedText = '';
    const maxPollPromptTime = 40000;
    const startPollPrompt = Date.now();

    while (Date.now() - startPollPrompt < maxPollPromptTime) {
      extractedText = await page.evaluate(async () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const findBtn = (t) => buttons.find((b) => (b.innerText || '').toLowerCase().includes(t.toLowerCase()));
        const btn1 = findBtn('Copy Prompt 1');
        const btn2 = findBtn('Copy Prompt 2');
        const btn3 = findBtn('Copy Prompt 3');
        const btnFlow = findBtn('Copy Google Flow Prompt') || findBtn('Flow Prompt');

        if (btn1 || btnFlow) {
          let p1 = '', p2 = '', p3 = '', flowVid = '';
          const triggerBtn = async (btn) => {
            if (!btn) return '';
            let clip = '';
            const onCopy = (e) => { if (e.clipboardData) clip = e.clipboardData.getData('text/plain'); };
            document.addEventListener('copy', onCopy, { once: true });
            btn.click();
            await new Promise((r) => setTimeout(r, 400));
            document.removeEventListener('copy', onCopy);
            return clip;
          };

          if (btn1) p1 = await triggerBtn(btn1);
          if (btn2) p2 = await triggerBtn(btn2);
          if (btn3) p3 = await triggerBtn(btn3);
          if (btnFlow) flowVid = await triggerBtn(btnFlow);

          if (p1 || flowVid) {
            return [
              'PHOTO 1:\n' + p1,
              'PHOTO 2:\n' + p2,
              'PHOTO 3:\n' + p3,
              'VIDEO PROMPT:\n' + flowVid
            ].join('\n\n');
          }
        }

        const codeBlocks = Array.from(document.querySelectorAll('pre code, pre, div[data-code-block-source="true"]'));
        for (let i = codeBlocks.length - 1; i >= 0; i--) {
          const txt = (codeBlocks[i].innerText || codeBlocks[i].textContent || '').trim();
          if (txt.includes('PHOTO 1') || txt.includes('VIDEO') || txt.includes('PHOTO')) {
            return txt;
          }
        }

        const assistantMsgs = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"], article[data-testid^="conversation-turn"]'));
        if (assistantMsgs.length > 0) {
          for (let i = assistantMsgs.length - 1; i >= 0; i--) {
            const txt = (assistantMsgs[i].innerText || assistantMsgs[i].textContent || '').trim();
            if (txt.includes('PHOTO') || txt.includes('VIDEO') || txt.includes('timeline') || txt.includes('Urutan')) {
              return txt;
            }
          }
          const lastMsg = assistantMsgs[assistantMsgs.length - 1];
          const lastTxt = (lastMsg.innerText || lastMsg.textContent || '').trim();
          if (lastTxt.length > 30) return lastTxt;
        }

        return '';
      });

      if (extractedText && extractedText.length > 40) {
        break;
      }
      await sleep(2500);
    }

    const formattedPromptsResult = formatTiktokPrompts(extractedText, concept);

    if (!formattedPromptsResult || formattedPromptsResult.trim().length < 20) {
      throw new Error('Gagal mengekstrak teks prompt.');
    }

    clipboard.writeText(formattedPromptsResult);

    onProgress('Menyimpan berkas teks prompt...');
    const projectPromptPath = path.join(currentProjectDir, 'prompt_video.txt');
    const timestampPromptPath = path.join(STORYBOARD_DIR, `video_prompts_${timestamp}_tiktok.txt`);
    
    fs.writeFileSync(projectPromptPath, formattedPromptsResult, 'utf-8');
    fs.writeFileSync(timestampPromptPath, formattedPromptsResult, 'utf-8');

    const projectMeta = {
      timestamp,
      concept: concept || 'jj',
      workerId: currentWorkerId,
      createdAt: new Date().toISOString(),
      storyboardType: storyboardType || '1',
      projectDir: currentProjectDir,
      bannerFile: path.basename(localProductBannerPath),
      characterFile: path.basename(customCharacterPath),
      referenceFile: path.basename(referenceImagePath),
      storyboardFile: path.basename(destStoryboard),
      promptFile: 'prompt_video.txt',
      promptText: formattedPromptsResult,
      hasPromptText: true
    };
    fs.writeFileSync(path.join(currentProjectDir, 'info_proyek.json'), JSON.stringify(projectMeta, null, 2), 'utf-8');

    try {
      let sbList = [];
      if (fs.existsSync(STORYBOARD_META_JSON)) {
        sbList = JSON.parse(fs.readFileSync(STORYBOARD_META_JSON, 'utf-8')) || [];
      }
      sbList.unshift({
        id: timestamp.toString(),
        concept: concept || 'jj',
        workerId: currentWorkerId,
        fileName: path.basename(destStoryboard),
        path: destStoryboard,
        projectFolder: currentProjectDir,
        promptText: formattedPromptsResult,
        createdAt: new Date().toISOString()
      });
      fs.writeFileSync(STORYBOARD_META_JSON, JSON.stringify(sbList, null, 2), 'utf-8');
    } catch (e) {}

    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill(); } catch (e) {}
      chromeProcess = null;
    }
    await sleep(2000);

    // =========================================================================
    // EKSEKUSI TAHAP 1: GOOGLE FLOW TIKTOK (3 Candid + 1 Video Motion)
    // =========================================================================
    onProgress(`Menghubungkan ke Google Flow (${flowModel} · ${flowResolution} · ${flowDuration})...`);

    const flowResult = await runFlowProjectCreationTiktok({
      projectFolder: currentProjectDir,
      storyboardImagePath: destStoryboard,
      promptText: formattedPromptsResult,
      flowVideoType: 'Bahan',
      flowRatio: flowRatio || '9:16',
      flowModel: flowModel || 'Veo 3.1 - Lite',
      flowResolution: flowResolution || '720p',
      flowDuration: flowDuration || '8 Detik',
      onProgress: (status) => onProgress(status)
    });

    if (!flowResult || !flowResult.success) {
      throw new Error(flowResult?.error || 'Gagal saat memproses rendering di Google Flow TikTok.');
    }

    // =========================================================================
    // EKSEKUSI TAHAP 2: CAPCUT WEB JJ OTOMATIS (KHUSUS KONSEP JJ)
    // =========================================================================
    let finalVideoPath = flowResult.videoPath;
    let finalStoragePath = flowResult.storagePath;
    let capcutResult = null;

    if (isJJConcept) {
      let candidPhotos = flowResult.candidPaths || [];

      // Fallback jika candidPaths kosong: ambil 3 foto candid terbaru dari storage/images
      if (candidPhotos.length === 0 && fs.existsSync(STORAGE_IMG_DIR)) {
        candidPhotos = fs.readdirSync(STORAGE_IMG_DIR)
          .filter((f) => f.startsWith('img_candid_') && /\.(png|jpe?g)$/i.test(f))
          .map((f) => path.join(STORAGE_IMG_DIR, f));
        candidPhotos.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
        candidPhotos = candidPhotos.slice(0, 3);
      }

      onProgress(`Melanjutkan ke CapCut Web (JJ)... Menggunakan video motion & ${candidPhotos.length} foto candid.`);

      capcutResult = await runCapCutTemplatePipeline({
        searchKeyword: 'JJ',
        videoPath: flowResult.videoPath,
        candidPaths: candidPhotos,
        headless: true,
        onProgress: (status) => onProgress(`[CapCut] ${status}`)
      });

      if (!capcutResult || !capcutResult.success) {
        throw new Error(capcutResult?.error || 'Gagal saat memproses pembuatan template di CapCut Web.');
      }

      finalVideoPath = capcutResult.videoPath;
      finalStoragePath = capcutResult.videoPath;
      onProgress(`🎉 Sukses Total! Video JJ selesai dibuat: ${path.basename(finalVideoPath)}`);
    } else {
      onProgress('Pipeline video TikTok selesai!');
    }

    return {
      success: true,
      concept: concept || 'jj',
      workerId: currentWorkerId,
      projectFolder: currentProjectDir,
      bannerUsed: localProductBannerPath,
      characterUsed: customCharacterPath,
      storyboardImages: [destStoryboard],
      promptText: formattedPromptsResult,
      videoPromptsText: formattedPromptsResult,
      videoPromptsFile: projectPromptPath,
      videoPath: finalVideoPath,
      storagePath: finalStoragePath,
      fileName: path.basename(finalVideoPath),
      thumbnailPath: flowResult.thumbnailPath,
      flowResult,
      capcutResult
    };
  } catch (error) {
    console.error('[TikTok Pipeline Error]:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
  }
}

// =========================================================================
// FUNGSI PENDUKUNG & GALERI PENYIMPANAN VIDEO (Untuk Kebutuhan main.js / UI)
// =========================================================================

async function uploadProductImageToChatGPT(imagePath) {
  try {
    return { success: true, imagePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getSavedVideosList() {
  try {
    if (!fs.existsSync(VIDEOS_DIR)) return [];
    const files = fs.readdirSync(VIDEOS_DIR).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
    return files.map((fileName) => {
      const fullPath = path.join(VIDEOS_DIR, fileName);
      const stat = fs.statSync(fullPath);
      return {
        fileName,
        filePath: fullPath,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (err) {
    return [];
  }
}

function openVideoFolder() {
  if (fs.existsSync(VIDEOS_DIR)) {
    shell.openPath(VIDEOS_DIR);
  }
}

function openStoryboardFolder() {
  if (fs.existsSync(STORYBOARD_DIR)) {
    shell.openPath(STORYBOARD_DIR);
  }
}

function openBahanVideoFolder() {
  if (fs.existsSync(BAHAN_VIDEO_DIR)) {
    shell.openPath(BAHAN_VIDEO_DIR);
  }
}

async function deleteSavedVideo(params) {
  try {
    const filePath = typeof params === 'string' ? params : params?.filePath;
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'Berkas video tidak ditemukan.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteSavedStoryboard(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      return { success: true };
    }
    return { success: false, error: 'Berkas storyboard tidak ditemukan.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  runTikTokVideoPipeline,
  runStoryboardPipeline: runTikTokVideoPipeline,
  uploadProductImageToChatGPT,
  getSavedVideosList,
  openVideoFolder,
  openStoryboardFolder,
  openBahanVideoFolder,
  deleteSavedVideo,
  deleteSavedStoryboard
};