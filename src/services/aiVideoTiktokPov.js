/**
 * src/services/aiVideoTiktokPov.js
 * BOT-AUTOUPLOAD | Konsep POV Tangan (hands-only product review)
 * Alur sama seperti manual: RUN → pilih suara VO → kirim foto produk + foto background → salin prompt kotak kode apa adanya → render Flow.
 * Sinkronisasi Status Sakelar Headless & Stabilitas Eksekusi
 */

const { chromium } = require('playwright');
const { cleanupFailedChrome } = require('../core/chromeCleanup');
const { startPluginChat } = require('./chatgptPlugin');
const { withClipboardLock } = require('../core/clipboardLock');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { clipboard, nativeImage } = require('electron');

const { runFlowProjectCreationTiktokPov } = require('./flowVideoRunnerTiktokPov');
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../core/perfProfile');

// Nama plugin ChatGPT (dipanggil dengan @ di chat baru)
const PLUGIN_NAME = 'POV Product Creator';

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
      path.resolve(__dirname, '../sessions/flow_profiles/accounts_config.json'),
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
  } catch (e) {}
  return true; // default: mode senyap (headless) aktif
}

function resolveSharedProfileDir(customPath, baseDir) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const root = baseDir || process.cwd();
  return path.resolve(root, 'sessions/chatgpt_profile_shared');
}

function killZombieChromeOnPort(port) {
  try {
    if (os.platform() === 'win32') {
      const netstat = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const lines = netstat.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    }
  } catch (e) {}
}

function syncFromLegacyProfileIfEmpty(targetDir, rootDir) {
  const hasCookies = (dir) => {
    if (!fs.existsSync(dir)) return false;
    return fs.existsSync(path.join(dir, 'Default', 'Network', 'Cookies')) ||
           fs.existsSync(path.join(dir, 'Network', 'Cookies'));
  };

  if (hasCookies(targetDir)) return;

  const sessionsDir = path.resolve(rootDir, 'sessions');
  const legacyCandidates = [
    'chatgpt_video_profile',
    'chatgpt_profile_w1',
    'chatgpt_video_profile_w1',
    'chatgpt_profile'
  ];

  for (const name of legacyCandidates) {
    const srcDir = path.resolve(sessionsDir, name);
    if (hasCookies(srcDir)) {
      try {
        fs.cpSync(srcDir, targetDir, { recursive: true, force: true });
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

    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

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

    // 1. Direct input file jika tersedia
    try {
      const fileInputLocator = page.locator('input[type="file"]').first();
      if (await fileInputLocator.count() > 0) {
        await fileInputLocator.setInputFiles(filePath);
        uploadSuccess = true;
      }
    } catch (e) {
      uploadSuccess = false;
    }

    // 2. Tombol Attach (+)
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

// Tunggu ChatGPT selesai menjawab. Selama menunggu: lapor tiap 20 dtk (lama menunggu + kalimat terakhir GPT)
// agar jendela tersembunyi tidak terlihat macet; berhenti lebih awal bila ChatGPT menampilkan batas pemakaian.
async function waitForSmartBotResponse(page, timeoutMs = 240000, onProgress = null) {
  timeoutMs = scaleMs(timeoutMs);
  const assistantMsgSelector = 'div[data-message-author-role="assistant"], article[data-testid^="conversation-turn"]';
  const prevCount = await page.locator(assistantMsgSelector).count();

  const startWait = Date.now();
  // Tombol "Start voice" (gelombang suara) muncul = ChatGPT sudah diam → tidak perlu menunggu sampai 45 dtk
  const VOICE_BTN = 'button[data-testid="composer-speech-button"], button[aria-label*="voice" i], button[aria-label*="suara" i]';
  let idleHits = 0;
  while (Date.now() - startWait < 45000) {
    const currentCount = await page.locator(assistantMsgSelector).count();
    const isStopping = await page.locator(STOP_BTN_SELECTOR).first().isVisible().catch(() => false);
    if (currentCount > prevCount || isStopping) break;
    const voiceReady = await page.locator(VOICE_BTN).first().isVisible().catch(() => false);
    idleHits = voiceReady && Date.now() - startWait >= 3000 ? idleHits + 1 : 0;
    if (idleHits >= 2) break;
    await sleep(700);
  }

  let lastReport = Date.now();
  while (Date.now() - startWait < timeoutMs) {
    const state = await page.evaluate((stopSel) => {
      const busy = Boolean(document.querySelector(stopSel) || document.querySelector('.result-streaming'));
      const turns = document.querySelectorAll('div[data-message-author-role="assistant"]');
      const txt = (turns[turns.length - 1]?.innerText || '').replace(/\s+/g, ' ').trim();
      const limited = /you've (hit|reached) (the|your) .*limit|rate limit|too many requests|batas (pemakaian|penggunaan)/i.test(txt);
      return { busy, limited, snippet: txt.length > 90 ? '…' + txt.slice(-90) : txt };
    }, STOP_BTN_SELECTOR).catch(() => ({ busy: false, limited: false, snippet: '' }));
    if (state.limited) throw new Error(`ChatGPT membatasi pemakaian akun: "${state.snippet}"`);
    if (!state.busy) break;
    if (onProgress && Date.now() - lastReport >= 20000) {
      lastReport = Date.now();
      onProgress(`Masih menunggu ChatGPT (${Math.round((Date.now() - startWait) / 1000)} dtk)${state.snippet ? ` · GPT: "${state.snippet}"` : ''}`);
    }
    await sleep(1000);
  }

  await page.waitForFunction(() => {
    const input = document.querySelector('#prompt-textarea, div.ProseMirror, div[contenteditable="true"], textarea[data-id="root"]');
    const isInputReady = input && !input.getAttribute('disabled');
    const isStopGone = !document.querySelector('button[aria-label="Stop"], button[data-testid="stop-button"]');
    return isInputReady && isStopGone;
  }, { timeout: 45000 }).catch(() => {});

  await sleep(800);
}

/**
 * Pilih suara Voiceover di menu GPT (radio "Cewek" / "Cowok" lalu tombol "Konfirmasi Suara VO"),
 * sama seperti klik manual. Mengembalikan false jika menu tidak ditemukan.
 */
function normalizePovVoice(voice) {
  return String(voice || '').toLowerCase() === 'cowok' ? 'Cowok' : 'Cewek';
}

async function clickPovVoiceOption(page, voiceLabel) {
  const clickByText = async (pattern) => {
    const box = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const candidates = Array.from(document.querySelectorAll('main button, main label, main [role="radio"]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && re.test((el.innerText || el.getAttribute('aria-label') || '').trim());
      });
      const el = candidates[candidates.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, pattern).catch(() => null);
    if (!box) return false;
    await sleep(300);
    await page.mouse.click(box.x, box.y);
    await sleep(800);
    return true;
  };

  if (!(await clickByText(`^\\W*${voiceLabel}\\s*$`))) return false;
  return clickByText('^\\W*konfirmasi suara');
}

async function runTikTokPovPipeline(options = {}) {
  const {
    bannerImagePath,
    backgroundImagePath,
    extraProductImagePaths = [],
    povVoice = 'cewek',
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

  // PRIORITAS PENENTUAN STATUS HEADLESS:
  // 1. Nilai boolean dari parameter options (jika dikirim true atau false)
  // 2. Pembacaan dari file JSON accounts_config.json
  // 3. Default: false (Jendela terlihat dan responsif)
  let isHeadless = false;
  if (typeof options.headless === 'boolean') {
    isHeadless = options.headless;
  } else {
    const diskHeadless = getFlowHeadlessConfig(dataRoot);
    if (typeof diskHeadless === 'boolean') {
      isHeadless = diskHeadless;
    }
  }

  const ROOT_DIR = dataRoot || process.cwd();
  const STORYBOARD_DIR = path.resolve(ROOT_DIR, 'storage/storyboards');
  const BAHAN_VIDEO_DIR = path.resolve(ROOT_DIR, 'storage/bahan_video');
  const targetUserDataDir = chatgptProfileDir || profileDir || resolveSharedProfileDir(null, ROOT_DIR);

  [STORYBOARD_DIR, BAHAN_VIDEO_DIR, targetUserDataDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  if (!PLUGIN_NAME) {
    return { success: false, error: 'Nama plugin ChatGPT belum diatur (PLUGIN_NAME di aiVideoTiktokPov.js).' };
  }

  try {
    const timestamp = Date.now();
    const currentProjectDir = path.join(BAHAN_VIDEO_DIR, `proyek_tiktok_pov_${timestamp}`);
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
    if (!backgroundImagePath || !fs.existsSync(backgroundImagePath)) {
      throw new Error('Foto background belum dipilih.');
    }
    // Foto produk utama + tambahan (sisi lain / detail), lalu background paling akhir
    const extraProducts = (Array.isArray(extraProductImagePaths) ? extraProductImagePaths : [])
      .filter((p) => p && p !== localProductBannerPath && fs.existsSync(p)).slice(0, 3);
    const productPhotos = [localProductBannerPath, ...extraProducts];
    if (extraProducts.length) onProgress(`Foto produk: ${productPhotos.length} gambar (+ 1 background).`);

    syncFromLegacyProfileIfEmpty(targetUserDataDir, ROOT_DIR);
    purgeLocks(targetUserDataDir);

    // Port Chrome ChatGPT per worker (worker 2 = 9243, dst.) agar beberapa worker bisa berjalan bersamaan
    const cdpPort = 9233 + ((Number(options.workerId) || 1) - 1) * 10;
    killZombieChromeOnPort(cdpPort);
    await sleep(400);

    const chromeExe = getOriginalChromeExecutablePath();
    if (!chromeExe) throw new Error('Google Chrome tidak ditemukan di sistem.');

    onProgress(`Membuka sesi Chrome ChatGPT POV Tangan (Port ${cdpPort} · Headless: ${isHeadless ? 'Aktif' : 'Nonaktif'})...`);

    // Jaga agar jendela ChatGPT selalu memiliki layer rendering aktif
    const chromeArgs = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${targetUserDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-restore-session-state',
      '--window-size=1280,900',
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

    // Storyboard kini lewat plugin ChatGPT (@Nama Plugin) di chat baru, bukan link Custom GPT
    onProgress('Tahap 1: Menjalankan perintah RUN...');
    await startPluginChat(page, PLUGIN_NAME, 'RUN', onProgress);
    await waitForSmartBotResponse(page, 75000, onProgress);

    const voiceLabel = normalizePovVoice(povVoice);
    onProgress(`Tahap 2: Memilih suara VO ${voiceLabel} (klik pilihan)...`);
    if (!(await clickPovVoiceOption(page, voiceLabel))) {
      onProgress(`Menu suara VO tidak ditemukan → memilih lewat ketikan...`);
      await fillAndSendChat(page, `Saya pilih VO suara ${voiceLabel}.`);
    }
    await waitForSmartBotResponse(page, 75000, onProgress);

    onProgress(`Tahap 3: Mengunggah ${productPhotos.length} foto produk dan foto background...`);
    const isUploaded = await uploadFilesToChatGPT(page, [...productPhotos, backgroundImagePath]);
    if (!isUploaded) throw new Error('Gagal mengunggah foto produk dan background ke ChatGPT.');
    await sleep(1500);
    // Sama seperti manual: cukup kirim foto tanpa teks
    await triggerSend(page);
    onProgress('Tahap 4: Menunggu ChatGPT membuat prompt gambar + video + VO...');

    // Salin prompt MURNI dari kotak kode ("Plain text") jawaban GPT, tanpa diubah sedikit pun.
    // Tunggu sampai GPT selesai menulis (tombol stop hilang & isi kotak kode tidak berubah lagi).
    onProgress('Menyalin prompt video dari kotak kode ChatGPT (tanpa diubah)...');
    const readCodeBlockPrompt = () => page.evaluate(() => {
      // Tampilan ChatGPT baru: <div data-code-block="true"> … <code>isi</code> (tanpa <pre>, tanpa penanda role pesan).
      // Ambil kotak kode TERAKHIR di percakapan; textContent = persis hasil tombol "Copy code".
      const blocks = Array.from(document.querySelectorAll('[data-code-block="true"] code, pre code'));
      const last = blocks[blocks.length - 1];
      return last ? last.textContent.replace(/\s+$/, '') : '';
    }).catch(() => '');

    let rawPrompt = '';
    let stableCount = 0;
    const promptDeadline = Date.now() + 180000;
    while (Date.now() < promptDeadline) {
      const streaming = await page.locator(STOP_BTN_SELECTOR).first().isVisible().catch(() => false);
      const current = await readCodeBlockPrompt();
      if (current && current === rawPrompt && !streaming) {
        if (++stableCount >= 2) break;
      } else {
        stableCount = 0;
      }
      rawPrompt = current;
      await sleep(1500);
    }

    if (!rawPrompt.trim()) {
      const shotPath = path.join(os.tmpdir(), `chatgpt_noprompt_${Date.now()}.png`);
      await page.screenshot({ path: shotPath }).catch(() => {});
      throw new Error(`Prompt video (kotak kode) dari ChatGPT tidak ditemukan. Screenshot: ${shotPath}`);
    }
    onProgress(`Prompt video tersalin (${rawPrompt.length} karakter).`);

    const formattedPromptsResult = rawPrompt.trim();

    const projectPromptPath = path.join(currentProjectDir, 'prompt_video.txt');
    fs.writeFileSync(projectPromptPath, formattedPromptsResult, 'utf-8');

    if (browser) await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}

    onProgress(`Menghubungkan ke Google Flow POV Tangan (${flowModel} · ${flowResolution} · ${flowDuration} · x${flowOutputCount || '1'})...`);

    // Alur Google Flow selalu aman dijalankan sesuai sakelar isHeadless
    const flowResult = await runFlowProjectCreationTiktokPov({
      workerId: Number(options.workerId) || 1,
      projectFolder: currentProjectDir,
      // Foto produk + background ditempel ke Flow sebagai referensi gambar ("use image preference")
      referenceImagePaths: [...productPhotos, backgroundImagePath],
      promptText: formattedPromptsResult,
      flowRatio: flowRatio || '9:16',
      flowModel: flowModel || 'Veo 3.1 - Lite',
      flowResolution: flowResolution || '720p',
      flowDuration: flowDuration || '8 Detik',
      flowOutputCount: flowOutputCount || '1',
      headless: isHeadless,
      onProgress: (status) => onProgress(status)
    });

    if (!flowResult || !flowResult.success) {
      throw new Error(flowResult?.error || 'Gagal saat memproses rendering di Google Flow TikTok POV Tangan.');
    }

    onProgress('🎉 Sukses! Video POV Tangan selesai dibuat.');

    return {
      success: true,
      concept: 'pov',
      projectFolder: currentProjectDir,
      bannerUsed: localProductBannerPath,
      backgroundUsed: backgroundImagePath,
      storyboardImages: [],
      promptText: formattedPromptsResult,
      videoPath: flowResult.videoPath,
      storagePath: flowResult.storagePath,
      fileName: path.basename(flowResult.videoPath || ''),
      thumbnailPath: flowResult.thumbnailPath,
      flowResult
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
  runTikTokPovPipeline,
  // Dipakai ulang konsep POV HP (aiVideoPovHp.js)
  helpers: {
    sleep, getFlowHeadlessConfig, resolveSharedProfileDir, syncFromLegacyProfileIfEmpty, purgeLocks,
    killZombieChromeOnPort, getOriginalChromeExecutablePath, waitForChromeReady, uploadFilesToChatGPT,
    findChatInputWithRetry, triggerSend, fillAndSendChat, waitForSmartBotResponse, STOP_BTN_SELECTOR
  }
};