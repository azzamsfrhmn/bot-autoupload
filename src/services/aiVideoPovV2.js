/**
 * Konsep POV Tangan V2 (plugin ChatGPT "POV Aksesoris Sunlight").
 * 1. ChatGPT (mode Work + GPT-6.1 Sol Light): @plugin "Mulai bikin video..." → kirim foto produk + background
 *    → simpan gambar referensi → balas "ya" → salin prompt video dari kotak kode.
 * 2. Google Flow: sama seperti POV Tangan (gambar referensi sebagai frame awal + prompt) → 1 video.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { cleanupFailedChrome } = require('../core/chromeCleanup');
const { chromeLiteArgs } = require('../core/perfProfile');
const { startPluginChat } = require('./chatgptPlugin');
const { runFlowProjectCreationTiktokPov } = require('./flowVideoRunnerTiktokPov');
const { helpers: H } = require('./aiVideoTiktokPov');
const { chatHelpers: C } = require('./aiVideoPovHp');

const PLUGIN_NAME = 'POV Aksesoris Sunlight';
const START_MESSAGE = 'Mulai bikin video (saya kirim foto produk & background)';
const MODEL_EFFORT = 'Light';
const { sleep } = H;

const shotPath = (tag) => path.join(os.tmpdir(), `chatgpt_povv2_${tag}_${Date.now()}.png`);

// Tunggu gambar referensi BARU dari ChatGPT (selesai menulis & stabil)
async function waitForNewImage(page, prevImages, onProgress, timeoutMs = 6 * 60 * 1000) {
  const start = Date.now();
  let lastReport = Date.now();
  let stable = 0;
  let last = '';
  while (Date.now() - start < timeoutMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const busy = await C.isStreaming(page);
    const imgs = (await C.readAssistantImages(page)).filter((s) => !prevImages.includes(s));
    const cur = imgs[imgs.length - 1] || '';
    if (!busy && cur) {
      stable = cur === last ? stable + 1 : 0;
      last = cur;
      if (stable >= 2) return cur;
    }
    if (Date.now() - lastReport >= 20000) {
      lastReport = Date.now();
      const snip = await C.lastAssistantSnippet(page);
      onProgress(`Menunggu gambar referensi ChatGPT (${Math.round((Date.now() - start) / 1000)} dtk)${snip ? ` · GPT: "${snip}"` : ''}`);
    }
    await sleep(2000);
  }
  return null;
}

// Tunggu kotak kode BARU (prompt video). Caption/teks pendek diabaikan: ambil kotak kode terpanjang.
async function waitForPrompt(page, prevCodes, onProgress, timeoutMs = 4 * 60 * 1000) {
  const start = Date.now();
  let lastReport = Date.now();
  let stable = 0;
  let last = '';
  while (Date.now() - start < timeoutMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const busy = await C.isStreaming(page);
    const codes = (await C.readCodeBlocks(page)).filter((c) => c.trim().length > 60 && !prevCodes.includes(c));
    if (!busy && codes.length) {
      const prompt = codes.reduce((a, b) => (b.length > a.length ? b : a), '').trim();
      stable = prompt === last ? stable + 1 : 0;
      last = prompt;
      if (stable >= 2) return { prompt, all: codes };
    }
    if (Date.now() - lastReport >= 20000) {
      lastReport = Date.now();
      const snip = await C.lastAssistantSnippet(page);
      onProgress(`Menunggu prompt video ChatGPT (${Math.round((Date.now() - start) / 1000)} dtk)${snip ? ` · GPT: "${snip}"` : ''}`);
    }
    await sleep(2000);
  }
  return null;
}

async function runPovV2Pipeline(options = {}) {
  const {
    bannerImagePath,
    backgroundImagePath,
    extraProductImagePaths = [],
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

  const isHeadless = typeof options.headless === 'boolean' ? options.headless : Boolean(H.getFlowHeadlessConfig(dataRoot));
  const ROOT_DIR = dataRoot || process.cwd();
  const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
  const targetUserDataDir = chatgptProfileDir || profileDir || H.resolveSharedProfileDir(null, ROOT_DIR);
  [BAHAN_VIDEO_DIR, targetUserDataDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const timestamp = Date.now();
  const projectDir = path.join(BAHAN_VIDEO_DIR, `proyek_pov_v2_${timestamp}`);
  fs.mkdirSync(projectDir, { recursive: true });

  let browser = null;
  let chromeProcess = null;
  try {
    // Foto produk (showcase = URL → unduh dulu)
    let productPath = bannerImagePath || '';
    if (/^https?:\/\//i.test(productPath)) {
      onProgress('Mengunduh foto produk dari Showcase TikTok...');
      const r = await fetch(productPath);
      if (!r.ok) throw new Error(`Gagal mengunduh foto produk (HTTP ${r.status}).`);
      const dl = path.join(projectDir, 'produk.png');
      fs.writeFileSync(dl, Buffer.from(await r.arrayBuffer()));
      productPath = dl;
    }
    if (!productPath || !fs.existsSync(productPath)) throw new Error('Foto produk belum dipilih.');
    if (!backgroundImagePath || !fs.existsSync(backgroundImagePath)) throw new Error('Foto background belum dipilih.');
    const extras = (Array.isArray(extraProductImagePaths) ? extraProductImagePaths : [])
      .filter((p) => p && p !== productPath && fs.existsSync(p)).slice(0, 3);
    const photos = [productPath, ...extras, backgroundImagePath];

    // ---------- 1. ChatGPT ----------
    H.syncFromLegacyProfileIfEmpty(targetUserDataDir, ROOT_DIR);
    H.purgeLocks(targetUserDataDir);
    const cdpPort = 9233 + ((Number(options.workerId) || 1) - 1) * 10;
    H.killZombieChromeOnPort(cdpPort);
    await sleep(400);
    const chromeExe = H.getOriginalChromeExecutablePath();
    if (!chromeExe) throw new Error('Google Chrome tidak ditemukan di sistem.');

    onProgress(`Membuka sesi Chrome ChatGPT POV Tangan V2 (Port ${cdpPort} · Headless: ${isHeadless ? 'Aktif' : 'Nonaktif'})...`);
    const chromeArgs = [
      `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${targetUserDataDir}`, '--no-first-run', '--no-default-browser-check',
      '--disable-session-crashed-bubble', '--hide-crash-restore-bubble', '--disable-restore-session-state', '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled', '--lang=id-ID'
    ];
    if (isHeadless) {
      chromeArgs.push('--window-position=-32000,-32000', '--mute-audio', '--disable-features=CalculateNativeWinOcclusion',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling');
    } else chromeArgs.push('--window-position=0,0');
    chromeArgs.push('https://chatgpt.com/');
    chromeProcess = spawn(chromeExe, [...chromeArgs, ...chromeLiteArgs()], { detached: false, stdio: 'ignore' });

    await H.waitForChromeReady(cdpPort, 35, 500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages().find((p) => p.url().includes('chatgpt.com')) || context.pages()[0] || await context.newPage();
    if (isHeadless) await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
    await sleep(2500);

    const isLoginState = await page.evaluate(() => {
      const u = location.href.toLowerCase();
      return u.includes('/auth/') || u.includes('/login') || !!document.querySelector('button[data-testid="login-button"]');
    }).catch(() => false);
    if (isLoginState) {
      if (isHeadless) {
        try {
          const s = await context.newCDPSession(page);
          const { windowId } = await s.send('Browser.getWindowForTarget');
          await s.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0 } });
        } catch (e) {}
      }
      onProgress('Silakan selesaikan login ChatGPT di jendela browser yang terbuka...');
      await page.waitForFunction(() => !/\/auth\/|\/login/.test(location.href.toLowerCase()) && !!document.querySelector('#prompt-textarea, div.ProseMirror'), { timeout: 300000 }).catch(() => {});
      await sleep(2000);
    }

    onProgress(`Tahap 1: Memanggil plugin "${PLUGIN_NAME}"...`);
    await startPluginChat(page, PLUGIN_NAME, START_MESSAGE, onProgress, { prepare: (pg) => C.setWorkMode(pg, onProgress, MODEL_EFFORT) });
    await H.waitForSmartBotResponse(page, 90000, onProgress);

    onProgress(`Tahap 2: Mengirim ${photos.length - 1} foto produk + 1 foto background...`);
    const prevImages = await C.readAssistantImages(page);
    if (!(await C.uploadPhotosVerified(page, photos, onProgress))) {
      const shot = shotPath('upload');
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`Foto gagal diunggah ke ChatGPT (lampiran tidak muncul). Screenshot: ${shot}`);
    }
    await C.waitUploadsDone(page);
    await sleep(1200);
    if (extras.length) {
      // Beri tahu urutan foto bila produk lebih dari 1
      const input = await H.findChatInputWithRetry(page, 45000);
      await input.click().catch(() => {});
      await page.keyboard.press('End').catch(() => {});
      await page.keyboard.insertText(`Foto 1-${photos.length - 1} = produk (sisi berbeda), foto terakhir = background.`);
      await sleep(400);
    }
    await H.triggerSend(page);

    onProgress('Tahap 3: Menunggu gambar referensi dari ChatGPT...');
    let imgSrc = await waitForNewImage(page, prevImages, onProgress);
    if (!imgSrc) {
      onProgress('Gambar belum muncul → meminta ChatGPT membuat gambarnya...');
      await H.fillAndSendChat(page, 'Lanjut, buatkan gambar referensinya sekarang.');
      imgSrc = await waitForNewImage(page, prevImages, onProgress);
    }
    if (!imgSrc) {
      const shot = shotPath('gambar');
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`Gambar referensi dari ChatGPT tidak ditemukan. Screenshot: ${shot}`);
    }
    const refImagePath = path.join(projectDir, 'gambar_referensi.png');
    if (!(await C.saveImageFromPage(page, imgSrc, refImagePath))) throw new Error('Gagal menyimpan gambar referensi ChatGPT.');
    onProgress('Gambar referensi tersimpan ✓');

    onProgress('Tahap 4: Membalas "ya" → menunggu prompt video...');
    const prevCodes = await C.readCodeBlocks(page);
    await H.fillAndSendChat(page, 'ya');
    let res = await waitForPrompt(page, prevCodes, onProgress);
    if (!res) {
      onProgress('Prompt belum muncul → meminta ChatGPT menuliskannya...');
      await H.fillAndSendChat(page, 'ya, buatkan prompt video untuk Flow sekarang.');
      res = await waitForPrompt(page, prevCodes, onProgress);
    }
    if (!res) {
      const shot = shotPath('prompt');
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`Prompt video (kotak kode) dari ChatGPT tidak ditemukan. Screenshot: ${shot}`);
    }
    const promptText = res.prompt;
    fs.writeFileSync(path.join(projectDir, 'prompt_video.txt'), promptText, 'utf-8');
    if (res.all.length > 1) fs.writeFileSync(path.join(projectDir, 'kotak_kode_lain.txt'), res.all.filter((c) => c.trim() !== promptText).join('\n\n---\n\n'), 'utf-8');
    onProgress(`Prompt video tersalin (${promptText.length} karakter).`);

    await browser.close().catch(() => {});
    browser = null;
    try { chromeProcess.kill(); } catch (e) {}
    chromeProcess = null;

    // ---------- 2. Google Flow (sama seperti POV Tangan) ----------
    onProgress(`Tahap 5: Render di Google Flow (${flowModel} · ${flowResolution} · ${flowDuration} · x${flowOutputCount || '1'})...`);
    const flowResult = await runFlowProjectCreationTiktokPov({
      workerId: Number(options.workerId) || 1,
      projectFolder: projectDir,
      referenceImagePaths: [refImagePath],
      promptText,
      flowRatio, flowModel, flowResolution, flowDuration,
      flowOutputCount: flowOutputCount || '1',
      headless: isHeadless,
      onProgress: (m) => onProgress(m)
    });
    if (!flowResult?.success) throw new Error(flowResult?.error || 'Gagal saat render di Google Flow (POV Tangan V2).');

    onProgress('🎉 Sukses! Video POV Tangan V2 selesai dibuat.');
    return {
      success: true,
      concept: 'pov2',
      projectFolder: projectDir,
      bannerUsed: productPath,
      backgroundUsed: backgroundImagePath,
      storyboardImages: [refImagePath],
      promptText,
      videoPath: flowResult.videoPath,
      storagePath: flowResult.storagePath,
      fileName: path.basename(flowResult.videoPath || ''),
      thumbnailPath: flowResult.thumbnailPath || refImagePath,
      flowResult
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    if (chromeProcess) await cleanupFailedChrome({ proc: chromeProcess, profileDir: targetUserDataDir, onProgress });
    chromeProcess = null;
    return { success: false, error: error.message, projectFolder: projectDir };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
  }
}

module.exports = { runPovV2Pipeline, PLUGIN_NAME };
