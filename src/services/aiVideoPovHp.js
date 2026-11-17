/**
 * src/services/aiVideoPovHp.js
 * BOT-AUTOUPLOAD | Konsep POV HP (review HP sudut pandang tangan, 3 scene)
 * Alur sama seperti manual di ChatGPT:
 *   @POV Gadget Reviewer + "VO Cowok/Cewek" → kirim foto HP + nama & spek → Scene 1 (gambar + prompt)
 *   → "lanjut" → Scene 2 → "lanjut" → Scene 3.
 * Tiap scene: gambar ChatGPT ditempel ke Google Flow + prompt kotak kode apa adanya → 3 klip → digabung jadi 1 video.
 */

const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { cleanupFailedChrome } = require('../core/chromeCleanup');
const { chromeLiteArgs } = require('../core/perfProfile');
const { getFfmpegPath } = require('../core/videoEnhancer');
const { startPluginChat } = require('./chatgptPlugin');
const { runFlowProjectCreationTiktokPov } = require('./flowVideoRunnerTiktokPov');
const { helpers: H } = require('./aiVideoTiktokPov');

// Nama plugin ChatGPT (dipanggil dengan @ di chat baru)
const PLUGIN_NAME = 'POV Gadget Reviewer';
const SCENE_COUNT = 3;

const { sleep, STOP_BTN_SELECTOR } = H;

// Plugin ini hanya benar di mode "Work" + GPT Sol tingkat berpikir Medium (mode Chat/Instant menggabung 3 scene jadi 1 kolase)
const WANT_EFFORT = 'Medium';
const EFFORTS = ['None', 'Minimal', 'Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra'];
async function setWorkModeMedium(page, onProgress = () => {}, wantEffort = WANT_EFFORT) {
  const placeholderIsWork = () => page.evaluate(() => {
    const e = document.querySelector('#prompt-textarea, div.ProseMirror');
    const ph = e?.getAttribute('placeholder') || e?.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') || e?.closest('form')?.innerText || '';
    return /work with chatgpt/i.test(ph) || /work with chatgpt/i.test(document.body.innerText.slice(0, 4000));
  }).catch(() => false);

  if (!(await placeholderIsWork())) {
    const tab = page.getByText('Work', { exact: true }).first();
    if (await tab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await tab.click().catch(() => {});
      await sleep(2500);
    }
  }
  onProgress((await placeholderIsWork()) ? 'Mode ChatGPT: Work ✓' : '[Peringatan] Mode Work ChatGPT tidak ditemukan, lanjut dengan mode sekarang.');

  // Tingkat berpikir: buka menu model → geser slider sampai label "Medium"
  const btn = page.locator('button[aria-label="Select ChatGPT model"]').last();
  if (!(await btn.isVisible({ timeout: 4000 }).catch(() => false))) return;
  const readLabel = () => page.evaluate(() => {
    const m = document.querySelector('[role="menuitem"][aria-label="Select model"]');
    return (m?.innerText || '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
  await btn.click().catch(() => {});
  await sleep(1000);
  for (let i = 0; i < 10; i++) {
    const label = await readLabel();
    const cur = EFFORTS.slice().reverse().find((e) => new RegExp(`\\b${e}\\b`, 'i').test(label));
    if (!label || !cur) break;
    if (cur === wantEffort) { onProgress(`Model ChatGPT: ${label} ✓`); break; }
    const slider = page.locator('[role="slider"], input[type="range"]').last();
    if (!(await slider.isVisible().catch(() => false))) break;
    await slider.focus().catch(() => {});
    await page.keyboard.press(EFFORTS.indexOf(cur) < EFFORTS.indexOf(wantEffort) ? 'ArrowRight' : 'ArrowLeft');
    await sleep(500);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(600);
}

// Gambar besar di jawaban ChatGPT (bukan avatar / foto yang diunggah pengguna)
const readAssistantImages = (page) => page.evaluate(() => {
  const out = [];
  // Mode Work: gambar hasil ada di [data-testid="generated-image-preview"] / alt "Generated image N" (tanpa penanda role pesan)
  const sel = 'img[alt^="Generated image" i], [data-testid*="generated-image"] img, div[data-message-author-role="assistant"] img';
  for (const img of document.querySelectorAll(sel)) {
    if (img.closest('div[data-message-author-role="user"]') || /user attachment/i.test(img.alt || '')) continue;
    const src = img.currentSrc || img.src || '';
    if (!src || /avatar/i.test(src + img.alt)) continue;
    if (!(img.complete && (img.naturalWidth >= 300 || img.width >= 300))) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}).catch(() => []);

// Isi semua kotak kode ("Plain text") di percakapan; textContent = persis hasil tombol Copy
const readCodeBlocks = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-code-block="true"] code, pre code'))
  .map((c) => c.textContent.replace(/\s+$/, ''))).catch(() => []);

const isStreaming = (page) => page.locator(STOP_BTN_SELECTOR).first().isVisible().catch(() => false);

const lastAssistantSnippet = (page) => page.evaluate(() => {
  const a = document.querySelectorAll('div[data-message-author-role="assistant"]');
  const t = (a[a.length - 1]?.innerText || '').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? '…' + t.slice(-90) : t;
}).catch(() => '');

async function saveImageFromPage(page, src, dest) {
  const b64 = await page.evaluate(async (s) => {
    try {
      const r = await fetch(s, { credentials: 'include' });
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(String(fr.result || '').split(',')[1] || null); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
    } catch (e) { return null; }
  }, src).catch(() => null);
  if (b64 && b64.length > 5000) { fs.writeFileSync(dest, Buffer.from(b64, 'base64')); return true; }
  // Cadangan: screenshot elemen gambar
  const loc = page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).last();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.screenshot({ path: dest }).catch(() => {});
  return fs.existsSync(dest) && fs.statSync(dest).size > 1000;
}

/**
 * Tunggu 1 scene baru: gambar baru + kotak kode baru, dan ChatGPT sudah selesai menulis.
 * prev = { images, codes } sebelum pesan dikirim. Mengembalikan { imageSrc, prompt } atau null bila waktu habis.
 */
async function waitForScene(page, prev, sceneNo, onProgress, timeoutMs = 6 * 60 * 1000) {
  const start = Date.now();
  let lastReport = Date.now();
  let stable = 0;
  let lastKey = '';
  while (Date.now() - start < timeoutMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const limited = await page.evaluate(() => /you've (hit|reached) (the|your) .*limit|rate limit|too many requests|batas (pemakaian|penggunaan)/i
      .test(document.querySelector('div[data-message-author-role="assistant"]:last-of-type')?.innerText || '')).catch(() => false);
    if (limited) throw new Error('ChatGPT membatasi pemakaian akun (limit).');
    const busy = await isStreaming(page);
    const imgs = (await readAssistantImages(page)).filter((s) => !prev.images.includes(s));
    // Dikenali dari ISI, bukan urutan: ChatGPT membuang pesan lama dari halaman (Scene 1 hilang saat Scene 3 dibuat)
    const codes = (await readCodeBlocks(page)).filter((c) => c.trim().length > 60 && !prev.codes.includes(c));
    if (!busy && imgs.length && codes.length) {
      const prompt = codes.reduce((a, b) => (b.length > a.length ? b : a), '');
      const key = imgs[imgs.length - 1] + '|' + prompt.length;
      stable = key === lastKey ? stable + 1 : 0;
      lastKey = key;
      if (stable >= 2) return { imageSrc: imgs[imgs.length - 1], prompt: prompt.trim() };
    }
    if (Date.now() - lastReport >= 20000) {
      lastReport = Date.now();
      const snip = await lastAssistantSnippet(page);
      onProgress(`Scene ${sceneNo}: menunggu gambar & prompt ChatGPT (${Math.round((Date.now() - start) / 1000)} dtk${imgs.length ? ' · gambar ✓' : ''}${codes.length ? ' · prompt ✓' : ''})${snip ? ` · GPT: "${snip}"` : ''}`);
    }
    await sleep(2000);
  }
  return null;
}

// Jumlah lampiran (thumbnail) di kotak chat ChatGPT
const countAttachments = (page) => page.evaluate(() => {
  const input = document.querySelector('#prompt-textarea, div.ProseMirror');
  const box = input?.closest('form') || input?.closest('[class*="composer"]') || document.querySelector('form');
  if (!box) return 0;
  const imgs = Array.from(box.querySelectorAll('img')).filter((i) => (i.width || i.naturalWidth) >= 28);
  const chips = box.querySelectorAll('[data-testid*="attachment" i], [aria-label*="Remove file" i], [aria-label*="Hapus file" i], button[aria-label*="Remove" i]');
  return Math.max(imgs.length, chips.length);
}).catch(() => 0);

async function waitAttachments(page, want, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await countAttachments(page)) >= want) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Unggah foto ke kotak chat ChatGPT dan PASTIKAN lampirannya muncul.
 * Urutan cara: input file (semua) → tombol "+" (pemilih file) → tempel clipboard per foto.
 */
async function uploadPhotosVerified(page, files, onProgress) {
  const { clipboard, nativeImage } = require('electron');
  const { withClipboardLock } = require('../core/clipboardLock');
  const input = await H.findChatInputWithRetry(page, 60000);
  await input.click({ force: true }).catch(() => {});
  const base = await countAttachments(page);
  const want = base + files.length;

  // 1) Setiap <input type="file"> di halaman (yang pertama belum tentu milik kotak chat)
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const info = await el.evaluate((e) => ({ multiple: e.multiple, accept: e.accept || '' })).catch(() => null);
    if (!info || (info.accept && !/image|\*/i.test(info.accept))) continue;
    try {
      if (info.multiple) await el.setInputFiles(files);
      else for (const f of files) { await el.setInputFiles(f); await sleep(800); }
    } catch (e) { continue; }
    if (await waitAttachments(page, want, 12000)) { onProgress(`Foto terunggah lewat input file ✓`); return true; }
  }

  // 2) Tombol "+" → pemilih file
  onProgress('Unggah langsung belum terlihat → mencoba tombol "+" ChatGPT...');
  for (const f of files) {
    const before = await countAttachments(page);
    const plus = page.locator('button[data-testid="composer-plus-btn"], button[aria-label*="Add files" i], button[aria-label*="Tambah" i], button[aria-label*="Attach" i], button[aria-label*="Lampir" i]').first();
    if (!(await plus.isVisible({ timeout: 3000 }).catch(() => false))) break;
    const chooserP = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await plus.click({ force: true }).catch(() => {});
    await sleep(700);
    const item = page.locator('[role="menuitem"]').filter({ hasText: /photo|file|foto|upload|unggah|komputer|computer/i }).first();
    if (await item.isVisible({ timeout: 2500 }).catch(() => false)) await item.click({ force: true }).catch(() => {});
    const chooser = await chooserP;
    if (!chooser) { await page.keyboard.press('Escape').catch(() => {}); break; }
    await chooser.setFiles(f).catch(() => {});
    await waitAttachments(page, before + 1, 12000);
  }
  if ((await countAttachments(page)) >= want) { onProgress('Foto terunggah lewat tombol "+" ✓'); return true; }

  // 3) Tempel gambar dari clipboard
  onProgress('Mencoba menempel foto lewat clipboard (Ctrl+V)...');
  for (const f of files) {
    const before = await countAttachments(page);
    const img = nativeImage.createFromPath(f);
    if (img.isEmpty()) continue;
    await withClipboardLock(async () => {
      clipboard.writeImage(img);
      await sleep(300);
      await input.click({ force: true }).catch(() => {});
      await page.keyboard.press('Control+v');
      await sleep(800);
    });
    await waitAttachments(page, before + 1, 12000);
  }
  return (await countAttachments(page)) > base;
}

// Tunggu proses unggah selesai (spinner / progres hilang) sebelum pesan dikirim
async function waitUploadsDone(page, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const busy = await page.evaluate(() => {
      const input = document.querySelector('#prompt-textarea, div.ProseMirror');
      const box = input?.closest('form') || document;
      return Boolean(box.querySelector('[role="progressbar"], circle[stroke-dasharray], .animate-spin'));
    }).catch(() => false);
    if (!busy) return;
    await sleep(800);
  }
}

function concatClips(clips, outPath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return Promise.reject(new Error('FFmpeg tidak ditemukan.'));
  const inputs = clips.flatMap((c) => ['-i', c]);
  const parts = clips.map((_, i) => `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  const filter = `${parts.join(';')};${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[v][a]`;
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-hide_banner', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath],
    { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => {
      if (err || !fs.existsSync(outPath)) return reject(new Error(`Gagal menggabungkan klip: ${(se || err?.message || '').toString().slice(-300)}`));
      resolve(outPath);
    });
  });
}

async function runPovHpPipeline(options = {}) {
  const {
    phoneImagePaths = [],
    phoneSpec = '',
    povVoice = 'cowok',
    flowRatio = '9:16',
    flowModel = 'Veo 3.1 - Lite',
    flowResolution = '720p',
    flowDuration = '8 Detik',
    chatgptProfileDir,
    profileDir,
    dataRoot,
    onProgress = () => {}
  } = options;

  const isHeadless = typeof options.headless === 'boolean' ? options.headless : Boolean(H.getFlowHeadlessConfig(dataRoot));
  const ROOT_DIR = dataRoot || process.cwd();
  const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
  const OUTPUT_VIDEOS_DIR = path.resolve(ROOT_DIR, 'storage/videos');
  const SESSIONS_VIDEOS_DIR = path.resolve(ROOT_DIR, 'sessions/generated_videos');
  const targetUserDataDir = chatgptProfileDir || profileDir || H.resolveSharedProfileDir(null, ROOT_DIR);
  [BAHAN_VIDEO_DIR, OUTPUT_VIDEOS_DIR, targetUserDataDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const photos = (Array.isArray(phoneImagePaths) ? phoneImagePaths : [phoneImagePaths]).filter((p) => p && fs.existsSync(p)).slice(0, 4);
  const spec = String(phoneSpec || '').trim();
  if (!photos.length) return { success: false, error: 'Foto HP belum dipilih.' };
  if (spec.length < 5) return { success: false, error: 'Nama HP + spek belum diisi.' };
  const voiceLabel = String(povVoice).toLowerCase() === 'cewek' ? 'Cewek' : 'Cowok';

  const timestamp = Date.now();
  const projectDir = path.join(BAHAN_VIDEO_DIR, `proyek_pov_hp_${timestamp}`);
  fs.mkdirSync(projectDir, { recursive: true });

  let browser = null;
  let chromeProcess = null;
  const scenes = [];
  try {
    // ---------- 1. ChatGPT: storyboard 3 scene ----------
    H.syncFromLegacyProfileIfEmpty(targetUserDataDir, ROOT_DIR);
    H.purgeLocks(targetUserDataDir);
    const cdpPort = 9233 + ((Number(options.workerId) || 1) - 1) * 10;
    H.killZombieChromeOnPort(cdpPort);
    await sleep(400);
    const chromeExe = H.getOriginalChromeExecutablePath();
    if (!chromeExe) throw new Error('Google Chrome tidak ditemukan di sistem.');

    onProgress(`Membuka sesi Chrome ChatGPT POV HP (Port ${cdpPort} · Headless: ${isHeadless ? 'Aktif' : 'Nonaktif'})...`);
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
    let page = context.pages().find((p) => p.url().includes('chatgpt.com')) || context.pages()[0] || await context.newPage();
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

    onProgress(`Tahap 1: Memanggil plugin "${PLUGIN_NAME}" (VO ${voiceLabel})...`);
    await startPluginChat(page, PLUGIN_NAME, `VO ${voiceLabel}`, onProgress, { prepare: (pg) => setWorkModeMedium(pg, onProgress) });
    await H.waitForSmartBotResponse(page, 90000, onProgress);

    onProgress(`Tahap 2: Mengirim ${photos.length} foto HP + nama & spek...`);
    let prev = { images: await readAssistantImages(page), codes: await readCodeBlocks(page) };
    if (!(await uploadPhotosVerified(page, photos, onProgress))) {
      const shot = path.join(os.tmpdir(), `chatgpt_povhp_upload_${Date.now()}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`Foto HP gagal diunggah ke ChatGPT (lampiran tidak muncul). Screenshot: ${shot}`);
    }
    await waitUploadsDone(page);
    await sleep(1200);
    const input = await H.findChatInputWithRetry(page, 45000);
    await input.click().catch(() => {});
    await page.keyboard.press('End').catch(() => {});
    await page.keyboard.insertText(spec);
    await sleep(500);
    await H.triggerSend(page);

    for (let n = 1; n <= SCENE_COUNT; n++) {
      onProgress(`Tahap 3: Menunggu ChatGPT membuat Scene ${n}/${SCENE_COUNT} (gambar + prompt video)...`);
      let sc = await waitForScene(page, prev, n, onProgress);
      if (!sc) {
        // ChatGPT berhenti / bertanya → dorong sekali lagi
        onProgress(`Scene ${n} belum muncul → meminta ChatGPT melanjutkan...`);
        await H.fillAndSendChat(page, `lanjut, buat Scene ${n} sekarang (gambar + prompt video + VO).`);
        sc = await waitForScene(page, prev, n, onProgress);
      }
      if (!sc) {
        const shot = path.join(os.tmpdir(), `chatgpt_povhp_scene${n}_${Date.now()}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        throw new Error(`Scene ${n} (gambar + prompt) dari ChatGPT tidak ditemukan. Screenshot: ${shot}`);
      }
      const imgPath = path.join(projectDir, `scene_${n}.png`);
      if (!(await saveImageFromPage(page, sc.imageSrc, imgPath))) throw new Error(`Gagal menyimpan gambar Scene ${n}.`);
      fs.writeFileSync(path.join(projectDir, `prompt_scene_${n}.txt`), sc.prompt, 'utf-8');
      scenes.push({ imagePath: imgPath, prompt: sc.prompt });
      onProgress(`Scene ${n} tersimpan ✓ (prompt ${sc.prompt.length} karakter).`);

      if (n < SCENE_COUNT) {
        prev = { images: await readAssistantImages(page), codes: await readCodeBlocks(page) };
        await H.fillAndSendChat(page, 'lanjut');
      }
    }

    await browser.close().catch(() => {});
    browser = null;
    try { chromeProcess.kill(); } catch (e) {}
    chromeProcess = null;

    // ---------- 2. Google Flow: 1 klip per scene ----------
    const clips = [];
    for (const [i, s] of scenes.entries()) {
      const tag = `[Klip ${i + 1}/${scenes.length}]`;
      if (i > 0) {
        // Jeda antar klip agar akun Flow tidak membuat video beruntun terlalu cepat
        const pause = 45 + Math.floor(Math.random() * 30);
        onProgress(`${tag} Jeda ${pause} dtk sebelum render berikutnya...`);
        await new Promise((r) => setTimeout(r, pause * 1000));
      }
      onProgress(`Tahap 4: ${tag} Render di Google Flow (${flowModel} · ${flowResolution})...`);
      const res = await runFlowProjectCreationTiktokPov({
        workerId: Number(options.workerId) || 1,
        projectFolder: projectDir,
        referenceImagePaths: [s.imagePath],
        promptText: s.prompt,
        flowRatio, flowModel, flowResolution, flowDuration,
        flowOutputCount: '1',
        headless: isHeadless,
        onProgress: (msg) => onProgress(`${tag} ${msg}`)
      });
      if (!res?.success) throw new Error(`Klip scene ${i + 1} gagal dibuat: ${res?.error || 'tidak diketahui'}`);
      // Klip mentah dipindah ke folder proyek agar tidak tampil sendiri-sendiri di galeri
      const source = res.storagePath && fs.existsSync(res.storagePath) ? res.storagePath : res.videoPath;
      const clipPath = path.join(projectDir, `klip_${i + 1}.mp4`);
      fs.copyFileSync(source, clipPath);
      for (const left of new Set([res.storagePath, res.videoPath, path.join(SESSIONS_VIDEOS_DIR, path.basename(source))])) {
        if (left && fs.existsSync(left)) fs.rmSync(left, { force: true });
      }
      clips.push(clipPath);
      onProgress(`${tag} Klip selesai ✓`);
    }

    // ---------- 3. Gabung ----------
    onProgress(`Tahap 5: Menggabungkan ${clips.length} klip jadi 1 video...`);
    const fileName = `video_pov_hp_${timestamp}.mp4`;
    const outPath = path.join(OUTPUT_VIDEOS_DIR, fileName);
    await concatClips(clips, outPath);

    onProgress('🎉 Sukses! Video POV HP selesai dibuat.');
    return {
      success: true,
      concept: 'povhp',
      projectFolder: projectDir,
      storyboardImages: scenes.map((s) => s.imagePath),
      promptText: scenes.map((s, i) => `SCENE ${i + 1}\n${s.prompt}`).join('\n\n'),
      videoPath: outPath,
      storagePath: outPath,
      fileName,
      thumbnailPath: scenes[0]?.imagePath || ''
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    if (chromeProcess) await cleanupFailedChrome({ proc: chromeProcess, profileDir: targetUserDataDir, onProgress });
    return { success: false, error: error.message, projectFolder: projectDir };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
  }
}

module.exports = {
  runPovHpPipeline,
  PLUGIN_NAME,
  // Dipakai ulang konsep POV Tangan V2 (aiVideoPovV2.js)
  chatHelpers: { setWorkMode: setWorkModeMedium, readAssistantImages, readCodeBlocks, isStreaming, lastAssistantSnippet, saveImageFromPage, uploadPhotosVerified, waitUploadsDone }
};
