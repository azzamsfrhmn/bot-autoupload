const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { saveGeneratedImage } = require('./imageStorage');

// Direktori profil dasar
const DEFAULT_USER_DATA_DIR = path.resolve(process.cwd(), 'sessions/chatgpt_profile');

if (!fs.existsSync(DEFAULT_USER_DATA_DIR)) {
  fs.mkdirSync(DEFAULT_USER_DATA_DIR, { recursive: true });
}

// Tambahan instruksi wajib otomatis
const MANDATORY_DESIGN_PROMPT = 
  'buat desain semenarik mungkin. jangan gunakan desain yang sebelumnya buat dengan gaya yang berbeda dari sebelumnya Buat menarik dan simple. Tambahkan HEADLINE agar menarik pembeli.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deteksi path file executable Google Chrome asli di OS
 */
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
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable'
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    );
  }

  for (const binPath of candidates) {
    if (fs.existsSync(binPath)) return binPath;
  }
  return undefined;
}

/**
 * Tunggu endpoint remote debugging aktif
 */
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

/**
 * Pastikan direktori profil worker tersedia tanpa menyalin data sesi secara mentah
 * agar enkripsi kredensial DPAPI Windows tidak rusak.
 */
function ensureWorkerProfileInitialized(targetWorkerDir) {
  if (!fs.existsSync(targetWorkerDir)) {
    fs.mkdirSync(targetWorkerDir, { recursive: true });
  }
}

/**
 * Otomasi ChatGPT Web: generate via DALL·E 3, tangkap download event, dan tutup browser otomatis
 * @param {string} promptText Deskripsi visual prompt atau topik produk
 * @param {string} aspectRatio Rasio gambar (misal: '4:5', '1:1', '9:16')
 * @param {boolean|object} optionsOrHeadless Opsi worker { workerId } atau boolean headless
 */
async function generateAndStoreAiImage(promptText, aspectRatio = '1:1', optionsOrHeadless = true) {
  if (!promptText || !promptText.trim()) {
    throw new Error('Deskripsi prompt gambar tidak boleh kosong.');
  }

  // Ekstraksi nomor worker
  let workerId = 1;
  if (typeof optionsOrHeadless === 'object' && optionsOrHeadless !== null) {
    workerId = Number(optionsOrHeadless.workerId || 1);
  }

  // Tentukan direktori profil terisolasi dan port unik per worker
  const cdpPort = 9220 + workerId; // Worker 1 = 9221, Worker 2 = 9222
  const targetUserDataDir = workerId === 1 
    ? DEFAULT_USER_DATA_DIR 
    : path.resolve(process.cwd(), `sessions/chatgpt_profile_worker_${workerId}`);

  ensureWorkerProfileInitialized(targetUserDataDir);

  const chromeExe = getOriginalChromeExecutablePath();
  if (!chromeExe) {
    throw new Error('Google Chrome tidak ditemukan di komputer.');
  }

  // Format baku dengan tambahan instruksi wajib otomatis
  const cleanPrompt = promptText.trim();
  const fullPrompt = `Buatkan gambar dengan aspek rasio ${aspectRatio}: ${cleanPrompt}. ${MANDATORY_DESIGN_PROMPT}`;

  console.log(`[Worker ${workerId}] Meluncurkan window Chrome mandiri (Port ${cdpPort})...`);

  // Posisi window: Worker 1 di sisi kiri, Worker 2 di sisi kanan monitor
  const windowPosArg = workerId === 1 ? '--window-position=0,0' : '--window-position=960,0';

  const chromeProcess = spawn(chromeExe, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${targetUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=960,1000',
    windowPosArg,
    'https://chatgpt.com/'
  ], { detached: false, stdio: 'ignore' });

  const isReady = await waitForChromeReady(cdpPort, 25, 400);
  if (!isReady) {
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGKILL');
    throw new Error(`[Worker ${workerId}] Chrome tidak merespons pada port ${cdpPort}.`);
  }

  // Sambungkan kontrol Playwright ke window Chrome yang baru di-spawn
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    await page.waitForLoadState('domcontentloaded');

    const inputSelector = '#prompt-textarea, div[contenteditable="true"]';

    // 1. Tunggu input chat tersedia
    await page.waitForSelector(inputSelector, { timeout: 35000 });
    await sleep(1000);

    // 2. Klik dan isi teks prompt
    await page.click(inputSelector);
    await sleep(400);

    await page.evaluate((text) => {
      const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
      if (el) {
        el.focus();
        if (el.tagName === 'TEXTAREA') {
          el.value = '';
        } else {
          el.innerHTML = '';
        }
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, fullPrompt);

    await sleep(800);

    // 3. Kirim pesan
    const sent = await page.evaluate(() => {
      const btn = document.querySelector('button[data-testid="send-button"]') ||
                  document.querySelector('button[aria-label="Send prompt"]') ||
                  document.querySelector('button[aria-label="Kirim perintah"]') ||
                  document.querySelector('form button[type="submit"]');
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!sent) {
      await page.keyboard.press('Enter');
    }

    console.log(`[Worker ${workerId}] Prompt terkirim:`, fullPrompt);

    // 4. Tunggu sampai elemen gambar muncul di respons assistant (timeout 4 menit)
    const imgSelector = 'div[data-message-author-role="assistant"] img, img[alt*="image" i], img[alt*="Generated by" i]';
    await page.waitForSelector(imgSelector, { timeout: 240000 });

    // Tunggu jeda render selesai
    await sleep(4000);

    let base64Data = null;

    // 5. Tangkap via event download tombol bawaan
    try {
      console.log(`[Worker ${workerId}] Menangkap file via tombol unduh bawaan...`);
      
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });

      const clickedDownload = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const dlBtn = buttons.reverse().find(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          const html = b.innerHTML.toLowerCase();
          return label.includes('download') || label.includes('unduh') || title.includes('download') || html.includes('download') || html.includes('m12 16l4-4h-3v-6h-2v6h-3l4 4z');
        });

        if (dlBtn) {
          dlBtn.click();
          return true;
        }
        return false;
      });

      if (clickedDownload) {
        const download = await downloadPromise;
        const tempPath = path.join(targetUserDataDir, `temp_${Date.now()}.png`);
        await download.saveAs(tempPath);

        const fileBuffer = fs.readFileSync(tempPath);
        base64Data = fileBuffer.toString('base64');
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    } catch (dlErr) {
      console.warn(`[Worker ${workerId}] Tombol download bawaan tidak merespons, beralih ke ekstraksi langsung:`, dlErr.message);
    }

    // 6. Fallback: Ekstraksi buffer langsung via fetch di dalam page
    if (!base64Data) {
      base64Data = await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"] img, img'));
        const validImgs = imgs.filter(im => im.naturalWidth > 200 || im.clientWidth > 200);
        const target = validImgs[validImgs.length - 1];
        if (!target) return null;

        const res = await fetch(target.src);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
      });
    }

    if (!base64Data) {
      throw new Error(`Worker ${workerId} gagal mengambil data gambar yang telah selesai dirender.`);
    }

    // 7. Simpan file gambar ke storage lokal
    const saved = saveGeneratedImage({
      base64Data,
      prompt: fullPrompt,
      aspectRatio
    });

    console.log(`[Worker ${workerId}] Berhasil mengunduh gambar ke penyimpanan lokal!`);

    return {
      success: true,
      workerId,
      item: saved.item,
      base64: `data:image/png;base64,${base64Data}`
    };
  } finally {
    // 8. Tutup koneksi Playwright dan proses browser Chrome
    await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) {
      try { chromeProcess.kill('SIGKILL'); } catch (e) {}
    }
  }
}

module.exports = {
  generateAndStoreAiImage
};