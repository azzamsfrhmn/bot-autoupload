/**
 * src/services/aiVideoTiktokDaster.js
 * Runner Pipeline Khusus Konsep Daster & Homewear Try-On (5 Scene Locked Shot)
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { clipboard, nativeImage } = require('electron');

const { runFlowProjectCreationTiktokDaster } = require('./flowVideoRunnerTiktokDaster');

const ROOT_DIR = process.cwd();
const TEMP_DIR = path.resolve(ROOT_DIR, 'temp');
const STORYBOARD_DIR = path.resolve(ROOT_DIR, 'storage/storyboards');
const STORYBOARD_META_JSON = path.resolve(STORYBOARD_DIR, 'metadata.json');
const VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
const DEFAULT_USER_DATA_DIR = path.resolve(ROOT_DIR, 'sessions/chatgpt_video_profile');

[TEMP_DIR, STORYBOARD_DIR, VIDEOS_DIR, BAHAN_VIDEO_DIR, DEFAULT_USER_DATA_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
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
  return candidates.find((p) => fs.existsSync(p));
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
  if (!fs.existsSync(targetWorkerDir)) fs.mkdirSync(targetWorkerDir, { recursive: true });
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach((f) => {
    const p = path.join(targetWorkerDir, f);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  });
}

const STOP_BTN_SELECTOR = [
  'button[aria-label="Stop"]',
  'button[aria-label="Hentikan"]',
  'button[data-testid="stop-button"]'
].join(', ');

async function uploadFilesToChatGPT(page, filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter((f) => f && fs.existsSync(f));
  if (files.length === 0) return false;

  const chatInput = page.locator('#prompt-textarea, div.ProseMirror, div[contenteditable="true"]').first();
  await chatInput.waitFor({ state: 'visible', timeout: 30000 });
  await chatInput.click({ force: true });
  await sleep(400);

  for (const filePath of files) {
    let uploadSuccess = false;

    try {
      const attachBtn = page.locator('button[aria-label*="Attach" i], button[aria-label*="Unggah" i], button[data-testid="attach-button"], button:has(svg.lucide-plus)').first();
      if (await attachBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }),
          attachBtn.click({ force: true })
        ]);
        await fileChooser.setFiles(filePath);
        uploadSuccess = true;
      }
    } catch (e) {
      uploadSuccess = false;
    }

    if (!uploadSuccess) {
      try {
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.count() > 0) {
          await fileInput.setInputFiles(filePath);
          uploadSuccess = true;
        }
      } catch (e) {
        uploadSuccess = false;
      }
    }

    if (!uploadSuccess) {
      try {
        const img = nativeImage.createFromPath(filePath);
        if (!img.isEmpty()) {
          clipboard.writeImage(img);
          await chatInput.click({ force: true });
          await sleep(300);
          await page.keyboard.press('Control+v');
          uploadSuccess = true;
        }
      } catch (err) {}
    }

    await sleep(2500);

    await page.waitForFunction(() => {
      const hasThumb = document.querySelectorAll('div[data-testid*="attachment"], div[class*="attachment"], img[alt*="attachment"], .prompt-media-preview').length > 0;
      const isUploading = document.querySelectorAll('div[role="progressbar"], .animate-spin').length > 0;
      return hasThumb && !isUploading;
    }, { timeout: 25000 }).catch(() => {});

    await sleep(1000);
  }
  return true;
}

async function triggerSend(page) {
  const chatInput = page.locator('#prompt-textarea, div.ProseMirror, div[contenteditable="true"]').first();
  await chatInput.focus().catch(() => {});
  await sleep(400);

  const sendBtn = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]').first();
  if (await sendBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
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

  const chatInput = page.locator('div.ProseMirror, #prompt-textarea, div[contenteditable="true"]').first();
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

async function waitForSmartBotResponse(page, timeoutMs = 360000) {
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
    return input && !input.getAttribute('disabled') && !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"]');
  }, { timeout: 35000 }).catch(() => {});

  await sleep(2500);
}

async function extractAndSaveAllDasterScenes(page, destDir, onProgress = () => {}) {
  onProgress('Mengumpulkan dan menyimpan 5 Scene Daster hasil generate DALL-E...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(2500);

  const imageLocator = page.locator('div[data-message-author-role="assistant"] img:not([alt*="avatar" i]):not([src*="avatar"]):not([width="24"]):not([width="32"])');
  const count = await imageLocator.count();
  const savedPaths = [];

  for (let i = 0; i < count; i++) {
    const imgEl = imageLocator.nth(i);
    const destPath = path.join(destDir, `scene_daster_${i + 1}_${Date.now()}.png`);

    try {
      const base64String = await imgEl.evaluate(async (img) => {
        const src = img.currentSrc || img.src;
        if (!src) return null;
        try {
          const res = await fetch(src, { credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            return await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result.replace(/^data:image\/[a-zA-Z+]+;base64,/, ''));
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {}
        return null;
      });

      if (base64String && base64String.length > 5000) {
        fs.writeFileSync(destPath, Buffer.from(base64String, 'base64'));
        savedPaths.push(destPath);
      } else {
        await imgEl.screenshot({ path: destPath });
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
          savedPaths.push(destPath);
        }
      }
    } catch (e) {}
  }

  return savedPaths;
}

// Pipeline Utama Daster Try-On
async function runTikTokDasterPipeline({
  bannerImagePath,
  customCharacterPath,
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

  try {
    const timestamp = Date.now();
    const currentProjectDir = path.join(BAHAN_VIDEO_DIR, `proyek_tiktok_daster_${timestamp}_w${currentWorkerId}`);
    if (!fs.existsSync(currentProjectDir)) fs.mkdirSync(currentProjectDir, { recursive: true });

    let localProductBannerPath = '';
    if (bannerImagePath && (bannerImagePath.startsWith('http://') || bannerImagePath.startsWith('https://'))) {
      onProgress('Mengunduh foto daster dari Showcase TikTok...');
      const downloadedFile = path.join(currentProjectDir, `product_daster_${timestamp}.png`);
      await downloadToLocalFile(bannerImagePath, downloadedFile);
      localProductBannerPath = downloadedFile;
    } else {
      localProductBannerPath = bannerImagePath;
    }

    if (!localProductBannerPath || !fs.existsSync(localProductBannerPath)) {
      throw new Error('Foto produk daster tidak ditemukan.');
    }
    if (!customCharacterPath || !fs.existsSync(customCharacterPath)) {
      throw new Error('Foto model/karakter daster belum dipilih.');
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

    const context = browser.contexts()[0] || (await browser.newContext());
    let page = context.pages().find((p) => p.url().includes('chatgpt.com')) || context.pages()[0];
    if (!page) page = await context.newPage();

    // 1. Masuk ke Custom GPT Daster
    const dasterCustomGptUrl = 'https://chatgpt.com/g/g-6ad63e2e97a8819185f9474000db0602-affiliate-tiktok-daster';
    onProgress('Menuju Custom GPT: Affiliate TikTok Daster...');
    await page.goto(dasterCustomGptUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3500);

    const chatInput = page.locator('#prompt-textarea, div.ProseMirror, div[contenteditable="true"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 45000 });

    // 2. Kirim RUN
    onProgress('Tahap 1: Menjalankan perintah RUN Daster...');
    const runBtn = page.locator('button:has-text("RUN"), div[role="button"]:has-text("RUN")').first();
    if (await runBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await runBtn.click();
      await sleep(1000);
      await triggerSend(page);
    } else {
      await fillAndSendChat(page, 'RUN');
    }
    await waitForSmartBotResponse(page, 75000);

    // 3. Unggah Karakter & Produk Daster (Tanpa Pinterest)
    onProgress('Tahap 2: Mengunggah Foto Model Karakter & Foto Produk Daster...');
    const isUploaded = await uploadFilesToChatGPT(page, [customCharacterPath, localProductBannerPath]);
    if (!isUploaded) throw new Error('Gagal mengunggah foto model dan daster ke ChatGPT.');
    await sleep(1500);
    await triggerSend(page);

    // 4. Tunggu render 5 Scene Daster
    onProgress('Tahap 3: Menunggu DALL-E menghasilkan 5 Scene Daster berurutan...');
    await waitForSmartBotResponse(page, 360000);

    // 5. Unduh seluruh scene
    const savedScenes = await extractAndSaveAllDasterScenes(page, currentProjectDir, onProgress);
    const destMaster = savedScenes[0] || path.join(currentProjectDir, 'scene_daster_1.png');

    // 6. Ekstrak rekapitulasi teks prompt video (senyap / mute)
    onProgress('Mengekstrak rekapitulasi teks prompt video motion Daster...');
    const formattedPromptsResult = await page.evaluate(() => {
      const assistantMsgs = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
      if (assistantMsgs.length === 0) return '';
      const lastMsg = assistantMsgs[assistantMsgs.length - 1];
      return (lastMsg.innerText || lastMsg.textContent || '').trim();
    });

    const projectPromptPath = path.join(currentProjectDir, 'prompt_video.txt');
    fs.writeFileSync(projectPromptPath, formattedPromptsResult, 'utf-8');

    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill(); } catch (e) {}
      chromeProcess = null;
    }
    await sleep(2000);

    // 7. Render ke Google Flow Daster
    onProgress(`Menghubungkan ke Google Flow Daster (${flowModel} · ${flowResolution} · ${flowDuration})...`);
    const flowResult = await runFlowProjectCreationTiktokDaster({
      projectFolder: currentProjectDir,
      storyboardImagePath: destMaster,
      sceneImages: savedScenes,
      promptText: formattedPromptsResult,
      flowRatio: flowRatio || '9:16',
      flowModel: flowModel || 'Veo 3.1 - Lite',
      flowResolution: flowResolution || '720p',
      flowDuration: flowDuration || '8 Detik',
      onProgress: (status) => onProgress(status)
    });

    if (!flowResult || !flowResult.success) {
      throw new Error(flowResult?.error || 'Gagal saat memproses rendering di Google Flow TikTok Daster.');
    }

    onProgress('🎉 Sukses Total! Video Daster Try-On berhasil dibuat.');

    return {
      success: true,
      concept: 'daster',
      workerId: currentWorkerId,
      projectFolder: currentProjectDir,
      bannerUsed: localProductBannerPath,
      characterUsed: customCharacterPath,
      storyboardImages: savedScenes,
      promptText: formattedPromptsResult,
      videoPath: flowResult.videoPath,
      storagePath: flowResult.storagePath,
      fileName: flowResult.fileName,
      thumbnailPath: flowResult.thumbnailPath,
      flowResult
    };
  } catch (error) {
    console.error('[TikTok Daster Pipeline Error]:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
  }
}

module.exports = {
  runTikTokDasterPipeline
};