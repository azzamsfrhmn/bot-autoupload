const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { loadSessionFromFile, getActiveAccount } = require('./sessionManager');

const SESSIONS_DIR = path.join(__dirname, '../../../sessions');
const DEFAULT_SESSION_FILE = path.join(SESSIONS_DIR, 'instagram_session.json');

let isUploading = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalisasi format cookies dari Electron agar sesuai dengan standar Playwright
 */
function sanitizeCookiesForPlaywright(rawCookies) {
  if (!Array.isArray(rawCookies)) return [];

  return rawCookies.map((c) => {
    const cookie = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: typeof c.secure === 'boolean' ? c.secure : true,
      httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : false
    };

    if (c.expirationDate) {
      cookie.expires = c.expirationDate;
    }

    const sameSiteLower = String(c.sameSite || '').toLowerCase();
    if (sameSiteLower.includes('strict')) {
      cookie.sameSite = 'Strict';
    } else if (sameSiteLower.includes('lax')) {
      cookie.sameSite = 'Lax';
    } else if (sameSiteLower.includes('none') || sameSiteLower.includes('no_restriction')) {
      cookie.sameSite = 'None';
    }

    return cookie;
  });
}

/**
 * Pembersih dialog/popup pengganggu agresif (Not Now / Lain Kali / Reels OK)
 */
async function dismissInstagramModals(page) {
  try {
    const reelsOkBtn = page.locator('div[role="dialog"] button:has-text("OK"), button:has-text("OK")').first();
    if (await reelsOkBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await reelsOkBtn.click({ force: true });
      await sleep(800);
    }

    await page.evaluate(() => {
      const dismissKeywords = [
        'not now',
        'lain kali',
        'jangan sekarang',
        'nanti saja',
        'batal',
        'cancel',
        'close',
        'ok'
      ];

      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (dismissKeywords.includes(txt) && !txt.includes('share') && !txt.includes('bagikan') && !txt.includes('next')) {
          btn.click();
          break;
        }
      }
    });

    await sleep(600);

    const dismissSelectors = [
      'button:has-text("Not Now")',
      'button:has-text("Lain Kali")',
      'button:has-text("Lain kali")',
      'button:has-text("Jangan Sekarang")',
      'button:has-text("Batal")',
      'button:has-text("Cancel")',
      'div[role="dialog"] button:has-text("Not Now")',
      'div[role="dialog"] button:has-text("Lain kali")'
    ];

    for (const selector of dismissSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await sleep(400);
      }
    }
  } catch (e) {}
}

/**
 * Fungsi utama upload media ke Instagram Feed / Reels (Multi-Akun Support)
 */
async function uploadToInstagram({ mediaPaths = [], caption = '', accountUsername = '', accountId = '', onProgress = () => {} }) {
  if (isUploading) {
    throw new Error('Ada proses upload lain yang sedang berjalan. Menunggu antrean...');
  }

  isUploading = true;
  let browser = null;
  let context = null;

  try {
    // 1. Ambil Cookies sesuai nama akun yang dikirim oleh scheduleRunner
    let rawCookies = null;

    if (accountUsername) {
      rawCookies = loadSessionFromFile(accountUsername);
    }
    if (!rawCookies && accountId) {
      rawCookies = loadSessionFromFile(accountId);
    }
    if (!rawCookies) {
      const active = typeof getActiveAccount === 'function' ? getActiveAccount() : null;
      if (active?.username) {
        rawCookies = loadSessionFromFile(active.username);
      }
    }
    if (!rawCookies) {
      rawCookies = loadSessionFromFile();
    }

    if (!rawCookies || !Array.isArray(rawCookies) || rawCookies.length === 0) {
      throw new Error(`Sesi login Instagram untuk @${accountUsername || 'akun aktif'} tidak ditemukan.`);
    }

    if (!mediaPaths || mediaPaths.length === 0) {
      throw new Error('Tidak ada file media yang dipilih.');
    }

    for (const file of mediaPaths) {
      if (!fs.existsSync(file)) {
        throw new Error(`File media tidak ditemukan: ${file}`);
      }
    }

    onProgress('Membuka browser otomatis Google Chrome...');
    
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-notifications',
        '--window-size=1280,900'
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      permissions: []
    });

    const validCookies = sanitizeCookiesForPlaywright(rawCookies);
    await context.addCookies(validCookies);

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    onProgress('Membuka Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 50000 });
    await sleep(5000);

    if (page.url().includes('/accounts/login/')) {
      throw new Error('Sesi Instagram telah kedaluwarsa. Silakan login ulang.');
    }

    onProgress('Memeriksa dan menutup pop-up notifikasi...');
    await dismissInstagramModals(page);
    await sleep(1500);

    // 1. KLIK TOMBOL "BUAT" / "CREATE"
    onProgress('Mencari tombol Buat (+)...');
    const createBtnSelector = [
      'a[href="#"]:has(svg[aria-label="Postingan baru"])',
      'a[href="#"]:has(svg[aria-label="New post"])',
      'a:has-text("Buat")',
      'a:has-text("Create")',
      'div[role="button"]:has-text("Buat")',
      'div[role="button"]:has-text("Create")',
      'svg[aria-label="Postingan baru"]',
      'svg[aria-label="New post"]',
      'svg[aria-label="Buat"]',
      'svg[aria-label="Create"]'
    ].join(', ');

    const createBtn = page.locator(createBtnSelector).first();
    await createBtn.waitFor({ state: 'visible', timeout: 20000 });
    await createBtn.click({ force: true });
    await sleep(2500);

    // 2. KLIK SUBMENU "POSTINGAN" / "POST"
    onProgress('Memilih jenis "Postingan"...');
    const clickedPostMenu = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('span, div[role="button"], div[role="menuitem"], a'));
      const target = elements.find((el) => {
        const txt = (el.innerText || el.textContent || '').trim();
        return txt === 'Postingan' || txt === 'Post';
      });

      if (target) {
        const clickable = target.closest('div[role="button"], div[role="menuitem"], a, div.html-div') || target;
        clickable.click();
        return true;
      }
      return false;
    });

    if (!clickedPostMenu) {
      const postSubMenuLocator = page.locator('//span[normalize-space()="Postingan" or normalize-space()="Post"]').first();
      if (await postSubMenuLocator.isVisible({ timeout: 4000 }).catch(() => false)) {
        await postSubMenuLocator.click({ force: true });
      }
    }

    await sleep(3000);

    // 3. UPLOAD FILE KE MODAL
    onProgress('Mengunggah file media...');
    const selectFromComputerBtn = page.locator('button:has-text("Select from computer"), button:has-text("Pilih dari komputer")').first();
    const fileInput = page.locator('input[type="file"]').first();

    let fileUploaded = false;
    if (await selectFromComputerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          selectFromComputerBtn.click({ force: true })
        ]);
        if (fileChooser) {
          await fileChooser.setFiles(mediaPaths);
          fileUploaded = true;
        }
      } catch (err) {}
    }

    if (!fileUploaded) {
      await fileInput.waitFor({ state: 'attached', timeout: 20000 });
      await fileInput.setInputFiles(mediaPaths);
    }

    onProgress('Menunggu media selesai diproses canvas...');
    await sleep(4000);

    // 3b. TUTUP POPUP REELS JIKA MUNCUL
    onProgress('Memeriksa popup notifikasi Reels...');
    const okBtn = page.locator('button:has-text("OK"), div[role="dialog"] button:has-text("OK")').first();
    if (await okBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await okBtn.click({ force: true });
      await sleep(1500);
    }

    // 4. MEMBUKA MENU RASIO DAN MEMILIH "ORIGINAL"
    onProgress('Mengatur rasio gambar menjadi Original...');
    const cropBtn = page.locator([
      'button:has(svg[aria-label="Select crop"])',
      'button:has(svg[aria-label="Pilih potong"])',
      'div[role="dialog"] button:has(svg path[d*="M19 15.5"])',
      'svg[aria-label="Select crop"]',
      'svg[aria-label="Pilih potong"]'
    ].join(', ')).first();

    if (await cropBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await cropBtn.click({ force: true });
      await sleep(1500);

      const originalOption = page.locator([
        'button:has-text("Original")',
        'div[role="button"]:has-text("Original")',
        'button:has-text("Asli")',
        'div[role="button"]:has-text("Asli")',
        'button:has-text("9:16")',
        'div[role="button"]:has-text("9:16")'
      ].join(', ')).first();

      if (await originalOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await originalOption.click({ force: true });
        await sleep(1000);
      }

      await cropBtn.click({ force: true }).catch(() => {});
    }

    await sleep(2000);

    // 5. KLIK NEXT PERTAMA
    onProgress('Menekan tombol Next pertama...');
    const nextBtnSelectors = [
      'div[role="dialog"] div[role="button"]:has-text("Next")',
      'div[role="dialog"] button:has-text("Next")',
      'div[role="dialog"] div[role="button"]:has-text("Selanjutnya")',
      'div[role="dialog"] button:has-text("Selanjutnya")',
      'button:text-is("Next")',
      'button:text-is("Selanjutnya")'
    ].join(', ');

    const nextBtn1 = page.locator(nextBtnSelectors).first();
    await nextBtn1.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1000);
    await nextBtn1.click({ force: true });
    await sleep(3000);

    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await okBtn.click({ force: true });
      await sleep(1500);
    }

    // 6. KLIK NEXT KEDUA
    onProgress('Menekan tombol Next kedua (menuju caption)...');
    const nextBtn2 = page.locator(nextBtnSelectors).first();
    await nextBtn2.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1000);
    await nextBtn2.click({ force: true });
    await sleep(3500);

    // 7. MENGISI CAPTION
    if (caption && caption.trim()) {
      onProgress('Menulis caption...');
      const captionAreaSelectors = [
        'div[aria-label="Write a caption..."]',
        'div[aria-label="Tulis keterangan..."]',
        'div[aria-label*="caption" i]',
        'div[aria-label*="keterangan" i]',
        'div[role="textbox"]'
      ].join(', ');

      const captionBox = page.locator(captionAreaSelectors).first();
      await captionBox.waitFor({ state: 'visible', timeout: 15000 });
      await sleep(800);
      await captionBox.click({ force: true });
      await sleep(600);
      await captionBox.fill(caption);
      await sleep(2000);
    }

    // 8. KLIK TOMBOL "BAGIKAN" / "SHARE"
    onProgress('Mempublikasikan postingan / Reels...');
    const shareBtnSelectors = [
      'div[role="dialog"] div[role="button"]:has-text("Share")',
      'div[role="dialog"] button:has-text("Share")',
      'div[role="dialog"] div[role="button"]:has-text("Bagikan")',
      'div[role="dialog"] button:has-text("Bagikan")',
      'button:text-is("Bagikan")',
      'button:text-is("Share")'
    ].join(', ');

    const shareBtn = page.locator(shareBtnSelectors).first();
    await shareBtn.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1500);
    await shareBtn.click({ force: true });

    // 9. MENUNGGU KONFIRMASI TERBIT
    onProgress('Menunggu konfirmasi terbit dari Instagram...');
    const successIndicators = [
      'text="Your post has been shared."',
      'text="Postingan Anda telah dibagikan."',
      'text="Your reel has been shared."',
      'text="Reel Anda telah dibagikan."',
      'text="Your reel has been shared"',
      'text="Reel Anda telah dibagikan"'
    ];

    let postSuccess = false;
    for (let i = 0; i < 45; i++) {
      for (const indicator of successIndicators) {
        if (await page.locator(indicator).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          postSuccess = true;
          break;
        }
      }
      if (postSuccess) break;
      await sleep(2000);
    }

    if (!postSuccess) {
      const isCreateModalClosed = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => false));
      if (!isCreateModalClosed) {
        throw new Error('Timeout menunggu konfirmasi postingan berhasil diterbitkan.');
      }
    }

    onProgress('Postingan / Reels berhasil diterbitkan!');
    await sleep(3500);

    return {
      success: true,
      message: 'Postingan berhasil diunggah ke Instagram.'
    };
  } catch (error) {
    console.error('[Uploader Error]:', error);
    await sleep(4000);
    return {
      success: false,
      message: error.message || 'Terjadi kesalahan saat proses upload.'
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    await sleep(2000);
    isUploading = false;
  }
}

module.exports = {
  uploadToInstagram
};