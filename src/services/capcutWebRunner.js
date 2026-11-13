/**
 * src/services/capcutWebRunner.js
 * Runner Otomasi Template CapCut Web via Google Chrome Asli (CDP Mode)
 * Toleran Jaringan Lambat: Extended Polling, Auto-Scroll Lazy Load, & Long Timeout
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../core/perfProfile');

const ROOT_DIR = process.cwd();
const CAPCUT_PROFILE_DIR = path.resolve(ROOT_DIR, 'sessions/capcut_web_profile');
const TEMP_EXPORT_DIR = path.resolve(ROOT_DIR, 'temp/capcut_exports');
const CDP_PORT = 9245;

[CAPCUT_PROFILE_DIR, TEMP_EXPORT_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

function getOriginalChromeExecutablePath() {
  const p = os.platform();
  const c = [];
  if (p === 'win32') {
    c.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (p === 'linux') {
    c.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  } else if (p === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  return c.find((x) => x && fs.existsSync(x));
}

function cleanupCapCutProfileLocks() {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  lockFiles.forEach((file) => {
    const lockPath = path.join(CAPCUT_PROFILE_DIR, file);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch (e) {}
    }
  });
}

async function waitForChromeReady(port, maxRetries = 40, delay = 500) {
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

// Blokir domain pelacak/analitik yang membebani bandwidth koneksi lambat
async function setupBandwidthOptimizer(page) {
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url().toLowerCase();
      const blockedDomains = [
        'google-analytics.com',
        'googletagmanager.com',
        'googleadservices.com',
        'doubleclick.net',
        'clarity.ms',
        'bing.com/bat',
        'facebook.net',
        'connect.facebook.net',
        'mon-sg.capcutapi.com',
        'mcs-normal-sg.capcutapi.com'
      ];

      if (blockedDomains.some((d) => url.includes(d))) {
        return route.abort();
      }
      route.continue();
    });
  } catch (e) {}
}

async function dismissExplorerModals(page) {
  try {
    const closeButtons = page.locator('.lv-modal-close-icon, button[aria-label="Dismiss"], button:has-text("Got it"), button:has-text("Accept"), button:has-text("Agree")');
    const count = await closeButtons.count();
    for (let i = 0; i < count; i++) {
      if (await closeButtons.nth(i).isVisible().catch(() => false)) {
        await closeButtons.nth(i).click().catch(() => {});
        await sleep(300);
      }
    }
  } catch (e) {}
}

async function ensureNotLeavingEditor(editorPage) {
  try {
    const cancelLeaveBtn = editorPage.locator('button:has-text("Cancel"), div[role="dialog"] button:has-text("Cancel")').first();
    if (await cancelLeaveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancelLeaveBtn.click({ force: true });
      await sleep(500);
    }
  } catch (e) {}
}

async function openCapCutLoginSession() {
  cleanupCapCutProfileLocks();
  const chromeExe = getOriginalChromeExecutablePath();
  if (!chromeExe) throw new Error('Google Chrome asli tidak ditemukan di sistem.');

  spawn(chromeExe, [...chromeLiteArgs(), 
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CAPCUT_PROFILE_DIR}`,
    '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://www.capcut.com/'
  ], { detached: false, stdio: 'ignore' });

  await waitForChromeReady(CDP_PORT);
  console.log('[CapCut Web] Chrome login dibuka.');
  return { success: true };
}

/**
 * Memilih template secara acak HANYA yang berorientasi PORTRAIT dengan timeout panjang
 */
async function clickRandomPortraitTemplateCard(page, onProgress) {
  const specificCardSelector = '.lv-template-card:visible, div[class*="lv-template-card"]:visible, div[class*="template-card"]:visible';
  const modalSelector = '.lv-modal.template_modal, .template-detail-wrapper';

  onProgress('Menunggu daftar kartu template terlihat...');
  await page.locator(specificCardSelector).first().waitFor({ state: 'visible', timeout: 60000 });
  await sleep(2000);

  const cards = page.locator(specificCardSelector);
  const totalCards = await cards.count();

  if (totalCards === 0) {
    throw new Error('Tidak ada kartu template yang ditemukan pada hasil pencarian.');
  }

  const indices = Array.from({ length: Math.min(totalCards, 16) }, (_, i) => i);
  indices.sort(() => Math.random() - 0.5);

  for (const randomIndex of indices) {
    const targetCard = cards.nth(randomIndex);

    try {
      await targetCard.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(400);

      const previewImg = targetCard.locator('.lv-template-card-preview-image img, img.main-image').first();
      const box = await previewImg.boundingBox().catch(() => null);

      if (box && box.width > 0 && box.height > 0) {
        const aspectRatio = box.width / box.height;
        if (aspectRatio > 1.05) {
          onProgress(`[Filter] Melewati template landscape (${aspectRatio.toFixed(2)})...`);
          continue;
        }
      }

      const cardTitle = await targetCard.locator('.lv-template-card-desc, h2').first().innerText().catch(() => `Urutan #${randomIndex + 1}`);
      onProgress(`Memilih template portrait: "${cardTitle.trim()}"...`);

      const previewArea = targetCard.locator('.lv-template-card-preview-image, img.main-image, .lv-template-card-main').first();
      
      if (await previewArea.isVisible().catch(() => false)) {
        await previewArea.hover({ force: true }).catch(() => {});
        await sleep(300);
        await previewArea.click({ force: true });
      } else {
        await targetCard.hover({ force: true }).catch(() => {});
        await sleep(300);
        await targetCard.click({ force: true });
      }

      const isModalOpen = await page.locator(modalSelector).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
      if (isModalOpen) return totalCards;

      const handle = await (previewArea.isVisible().catch(() => false) ? previewArea : targetCard).elementHandle();
      if (handle) {
        await page.evaluate((el) => el.click(), handle);
      }

      const isModalOpenAfterEval = await page.locator(modalSelector).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
      if (isModalOpenAfterEval) return totalCards;
    } catch (err) {}

    await sleep(600);
  }

  throw new Error('Gagal menemukan atau membuka template portrait yang valid.');
}

/**
 * Runner Utama Otomasi Pembuatan Video Template JJ CapCut Web
 */
async function runCapCutTemplatePipeline({
  searchKeyword = 'JJ',
  videoPath,
  candidPaths = [],
  onProgress = () => {}
}) {
  cleanupCapCutProfileLocks();
  onProgress('Menyiapkan Google Chrome resmi...');

  const chromeExe = getOriginalChromeExecutablePath();
  if (!chromeExe) throw new Error('Google Chrome asli tidak ditemukan di sistem.');

  let chromeProcess = spawn(chromeExe, [...chromeLiteArgs(), 
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CAPCUT_PROFILE_DIR}`,
    '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://www.capcut.com/template-explorer'
  ], { detached: false, stdio: 'ignore' });

  const isReady = await waitForChromeReady(CDP_PORT, 40, 500);
  if (!isReady) throw new Error('Gagal menghubungkan ke Google Chrome.');

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  let page = context.pages()[0] || (await context.newPage());

  await setupBandwidthOptimizer(page);

  try {
    onProgress('Membuka antarmuka CapCut Web (menyesuaikan kecepatan jaringan)...');
    await page.goto('https://www.capcut.com/template-explorer', {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    }).catch(() => {});

    await sleep(3000);

    const initialCardSelector = '.lv-template-card, div[class*="template-card"], div[class*="template-item"], .inspirationCard-WAHHZx';
    let isTemplatePageReady = false;

    // Loop sabar untuk jaringan lambat: hingga 90 detik, polling per 3 detik sambil auto-scroll
    const maxWaitSeconds = 90;
    const startWaitTime = Date.now();

    while ((Date.now() - startWaitTime) < (maxWaitSeconds * 1000)) {
      await dismissExplorerModals(page);

      // Cek apakah ada tab template lain yang terbuka
      const allTabs = context.pages();
      const directTemplateTab = allTabs.find((p) => p.url().includes('template-explorer') && !p.url().includes('my-cloud'));
      if (directTemplateTab && directTemplateTab !== page) {
        page = directTemplateTab;
        await page.bringToFront();
      }

      // Deteksi jika terlempar ke workspace/my-cloud
      const currentUrl = page.url();
      if (currentUrl.includes('my-cloud') || currentUrl.includes('from_page=work_space') || currentUrl.includes('my-edit')) {
        onProgress('Beralih dari workspace ke galeri template...');
        await page.goto('https://www.capcut.com/template-explorer', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
        await sleep(3000);
      }

      // Cek keberadaan kartu template
      const cardCount = await page.locator(initialCardSelector).count().catch(() => 0);
      if (cardCount > 0) {
        onProgress(`✓ Galeri template berhasil dimuat (${cardCount} template ditemukan).`);
        isTemplatePageReady = true;
        break;
      }

      // Scroll sedikit ke bawah untuk memicu trigger API lazy-load jika jaringan lambat
      await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
      const elapsed = Math.round((Date.now() - startWaitTime) / 1000);
      onProgress(`Menunggu galeri template dimuat oleh server... (${elapsed}s/${maxWaitSeconds}s)`);
      await sleep(3000);

      // Jika sudah 45 detik belum muncul sama sekali, refresh sekali secara aman
      if (elapsed === 45 && cardCount === 0) {
        onProgress('Menyegarkan halaman untuk memicu ulang pemuatan template...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      }
    }

    if (!isTemplatePageReady) {
      throw new Error('Koneksi internet lambat: Halaman template CapCut membutuhkan waktu terlalu lama untuk merespons. Silakan coba lagi.');
    }

    // 2. Pencarian Template JJ
    onProgress(`Mencari template dengan kata kunci: "${searchKeyword}"...`);
    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 30000 });
    await searchInput.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await searchInput.fill(searchKeyword);
    await page.keyboard.press('Enter');
    
    onProgress('Menunggu hasil pencarian template JJ muncul...');
    await sleep(6000);

    // 3. Pemilihan Template Portrait
    await clickRandomPortraitTemplateCard(page, onProgress);
    await sleep(2500);

    // 4. Deteksi Jumlah Klip dari Modal Popup (Filter Maksimal 4 Klip)
    let requiredSlots = 3;
    let validTemplateFound = false;
    let inspectAttempts = 0;
    const maxInspect = 15;

    while (!validTemplateFound && inspectAttempts < maxInspect) {
      inspectAttempts++;

      const clipsElement = page.locator('.template-detail-wrapper .keyword-wrapper .text-wrapper, span:has-text("clips"), div:has-text("clips"), span:has-text("klip")').first();
      const clipsInfoText = await clipsElement.innerText({ timeout: 6000 }).catch(() => '');
      const match = clipsInfoText.match(/(\d+)\s*(?:clips?|klip)/i);
      const clipsCount = match ? parseInt(match[1], 10) : 3;

      const templateTitle = await page.locator('.template-detail-wrapper h1.title').first().innerText().catch(() => 'Template');
      onProgress(`Mengecek "${templateTitle.trim()}": membutuhkan ${clipsCount} klip.`);

      if (clipsCount <= 4 && clipsCount >= 1) {
        requiredSlots = clipsCount;
        validTemplateFound = true;
        onProgress(`✓ Template cocok! ("${templateTitle.trim()}" - ${requiredSlots} klip).`);
        break;
      }

      onProgress(`Klip (${clipsCount}) > 4. Mencari template berikutnya...`);
      const arrowRightBtn = page.locator('.modal-controls-wrapper .arrow_right, div.arrow_right').first();

      if (await arrowRightBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await arrowRightBtn.click({ force: true });
        await sleep(3000);
      } else {
        const closeIcon = page.locator('.close-icon-box, .lv-modal-close-icon').first();
        await closeIcon.click({ force: true }).catch(() => {});
        await sleep(2000);
        await clickRandomPortraitTemplateCard(page, onProgress);
        await sleep(2500);
      }
    }

    // 5. Membuka Halaman Editor Template
    onProgress('Membuka antarmuka editor template...');
    const useBtn = page.locator('.button-area button:has-text("Use this template"), button:has-text("Use template")').first();
    await useBtn.waitFor({ state: 'visible', timeout: 30000 });
    await useBtn.click({ force: true });

    let editorPage = null;
    for (let i = 0; i < 40; i++) {
      await sleep(1500);
      const tabs = context.pages();
      const matched = tabs.find((t) => t.url().includes('editor-template'));
      if (matched) {
        editorPage = matched;
        break;
      }
    }

    if (!editorPage) {
      editorPage = context.pages()[context.pages().length - 1];
    }

    await setupBandwidthOptimizer(editorPage);
    await editorPage.bringToFront();
    await editorPage.waitForLoadState('domcontentloaded');

    // 6. Menunggu Antarmuka Timeline & Tombol Batch Replace Siap (Toleransi 180s)
    onProgress('Menunggu antarmuka timeline editor siap (mengunduh aset editor)...');
    const batchReplaceBtn = editorPage.locator('button:has-text("Batch replace"), div:has-text("Batch replace"), span:has-text("Batch replace")').first();
    await batchReplaceBtn.waitFor({ state: 'visible', timeout: 180000 });
    await sleep(3000);
    await ensureNotLeavingEditor(editorPage);

    // 7. Menyusun Berkas: Slot 1 = Video, Slot 2..N = Foto Candid
    const validCandidPhotos = (candidPaths || []).filter((f) => f && fs.existsSync(f));
    const targetSlotFiles = [videoPath];
    for (let s = 1; s < requiredSlots; s++) {
      const photoIdx = (s - 1) % (validCandidPhotos.length || 1);
      targetSlotFiles.push(validCandidPhotos[photoIdx] || videoPath);
    }

    onProgress(`Memasukkan ${targetSlotFiles.length} berkas media via Batch Replace...`);

    try {
      const [fileChooser] = await Promise.all([
        editorPage.waitForEvent('filechooser', { timeout: 15000 }),
        batchReplaceBtn.click({ force: true })
      ]);
      await fileChooser.setFiles(targetSlotFiles);
      onProgress('✓ Berkas berhasil dimasukkan ke seluruh slot batch!');
      await sleep(5000);
    } catch (batchErr) {
      onProgress(`Batch replace otomatis timeout, mengisi slot satu per satu...`);
      for (let idx = 0; idx < targetSlotFiles.length; idx++) {
        const slotItemLocator = editorPage.locator(`.segment-item[data-mutable-index="${idx}"]`).first();
        const slotUploader = slotItemLocator.locator('input[type="file"].mutable-file-uploader, input[type="file"]').first();
        if (await slotUploader.count() > 0) {
          await slotUploader.setInputFiles(targetSlotFiles[idx]).catch(() => {});
          await sleep(2500);
        }
      }
    }

    await ensureNotLeavingEditor(editorPage);
    onProgress('Seluruh slot batch telah terisi lengkap! Sinkronisasi efek jedag-jedug...');
    await sleep(6000);

    // 8. Tahap 1 Ekspor: Klik Tombol #export-video-btn
    onProgress('Mempersiapkan proses ekspor video...');
    const exportVideoBtn = editorPage.locator('#export-video-btn').first();
    await exportVideoBtn.waitFor({ state: 'visible', timeout: 45000 });
    await exportVideoBtn.click({ force: true });
    await sleep(2500);

    // 9. Tahap 2 Konfirmasi: Klik Tombol #export-confirm-button
    onProgress('Memulai render video di server CapCut...');
    const exportConfirmBtn = editorPage.locator('#export-confirm-button').first();
    await sleep(1500);
    await exportConfirmBtn.click({ force: true }).catch(async () => {
      await editorPage.evaluate(() => {
        const btn = document.getElementById('export-confirm-button');
        if (btn) btn.click();
      });
    });
    
    await sleep(4000);

    // 10. Memantau Proses Render Server (Exporting...) hingga Selesai
    onProgress('Menunggu proses render selesai (Exporting...). Jaringan lambat membutuhkan waktu lebih lama...');
    await editorPage.locator('text="Exporting"').waitFor({ state: 'detached', timeout: 450000 }).catch(() => {});
    await sleep(3000);

    // 11. Mengklik Tombol Download pada Modal Akhir
    onProgress('Mengunduh video hasil render ke komputer...');
    const downloadActionBtn = editorPage.locator('.button-container-ve4KPb, div:has-text("Download"):visible').last();
    
    const [download] = await Promise.all([
      editorPage.waitForEvent('download', { timeout: 120000 }),
      downloadActionBtn.click({ force: true }).catch(async () => {
        await editorPage.evaluate(() => {
          const els = Array.from(document.querySelectorAll('div, button, span'));
          const target = els.find(el => el.textContent && el.textContent.trim() === 'Download' && el.offsetParent !== null);
          if (target) target.click();
        });
      })
    ]);

    // 12. Menyimpan Berkas ke Folder Video
    const finalVideoPath = path.resolve(ROOT_DIR, `storage/videos/jj_capcut_${Date.now()}.mp4`);
    await download.saveAs(finalVideoPath);

    onProgress('Video JJ berhasil diekspor dan disimpan ke folder storage/videos!');
    await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}

    return {
      success: true,
      videoPath: finalVideoPath,
      fileName: path.basename(finalVideoPath)
    };
  } catch (err) {
    onProgress(`Kendala CapCut Web: ${err.message}`);
    await browser.close().catch(() => {});
    if (chromeProcess && !chromeProcess.killed) try { chromeProcess.kill(); } catch (e) {}
    return { success: false, error: err.message };
  }
}

module.exports = {
  openCapCutLoginSession,
  runCapCutTemplatePipeline
};