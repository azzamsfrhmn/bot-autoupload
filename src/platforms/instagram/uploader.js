const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { loadSessionFromFile, loadInstagramSession, getActiveAccount } = require('./sessionManager');

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
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

// ---------------------------------------------------------------------------
// Jadwal bawaan Instagram ("Schedule content") & saklar "Share to Facebook"
// ---------------------------------------------------------------------------
// Instagram: jadwal minimal 20 menit dari sekarang → 22 menit (cadangan waktu proses)
const IG_SCHEDULE_MIN_LEAD_MS = 22 * 60 * 1000;

// Saklar (input checkbox) pada baris yang memuat teks tertentu di dialog posting
async function setDialogSwitch(page, textRe, wantOn) {
  return page.evaluate(({ src, wantOn }) => {
    const re = new RegExp(src, 'i');
    const dialog = document.querySelector('div[role="dialog"]') || document.body;
    const boxes = Array.from(dialog.querySelectorAll('input[type="checkbox"]'));
    for (const box of boxes) {
      let row = box.parentElement;
      for (let i = 0; i < 6 && row; i++) {
        if (re.test(row.innerText || '')) break;
        row = row.parentElement;
      }
      if (!row || !re.test(row.innerText || '')) continue;
      // Baris harus milik saklar ini saja (bukan bagian besar yang memuat beberapa saklar)
      if (row.querySelectorAll('input[type="checkbox"]').length > 1) continue;
      if (box.checked !== wantOn) box.click();
      return { found: true, checked: box.checked };
    }
    return { found: false };
  }, { src: textRe.source, wantOn });
}

async function setInstagramSchedule(page, targetMs, onProgress = () => {}) {
  const want = await page.evaluate((ms) => {
    const t = new Date(ms);
    const h = t.getHours();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return {
      y: t.getFullYear(), m: t.getMonth(), d: t.getDate(),
      monthLabel: `${months[t.getMonth()]} ${t.getFullYear()}`,
      h12: h % 12 === 0 ? 12 : h % 12, min: t.getMinutes(), pm: h >= 12,
      label: `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()} ${String(h).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    };
  }, targetMs);

  // 1. Nyalakan "Schedule content"
  const sw = await setDialogSwitch(page, /schedule content|jadwalkan konten/, true);
  if (!sw.found) return { ok: false, reason: 'saklar Schedule content tidak ditemukan' };
  await sleep(1500);

  // 2. Tanggal: buka kalender → geser bulan → klik hari
  if (process.env.IG_DEBUG_POPUP) await page.screenshot({ path: process.env.IG_DEBUG_POPUP }).catch(() => {});
  // Klik lewat script: popup notifikasi Instagram bisa menutupi tombol (klik mouse tertahan)
  const openedCal = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('div[role="dialog"] [role="button"]'))
      .find((e) => /\b\d{4}$/.test((e.innerText || '').trim()));
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  });
  if (!openedCal) return { ok: false, reason: 'tombol tanggal jadwal tidak ditemukan' };
  await sleep(1200);
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  for (let i = 0; i < 4; i++) {
    const head = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('span, div, h1, h2, h3')).find((e) => e.children.length === 0
        && /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i.test((e.innerText || '').trim()));
      return el ? el.innerText.trim() : '';
    });
    const hm = head.match(/^(\w+)\s+(\d{4})$/);
    if (!hm) return { ok: false, reason: 'kalender jadwal tidak terbaca' };
    const diff = (want.y - Number(hm[2])) * 12 + (want.m - monthNames.indexOf(hm[1].toLowerCase()));
    if (diff === 0) break;
    await page.evaluate((lbl) => document.querySelector(`[aria-label="${lbl}"]`)?.click(), diff > 0 ? 'Next month' : 'Previous month');
    await sleep(800);
  }
  const dayClicked = await page.evaluate((d) => {
    const cell = Array.from(document.querySelectorAll('[role="gridcell"]'))
      .find((e) => (e.innerText || '').trim() === String(d) && e.getAttribute('aria-disabled') !== 'true');
    if (!cell) return false;
    cell.click();
    return true;
  }, want.d);
  if (!dayClicked) return { ok: false, reason: `tanggal ${want.label} tidak bisa dipilih di Instagram (di luar batas jadwal)` };
  await sleep(1000);

  // 3. Jam (1–12), menit, AM/PM — spinbutton dibaca dari aria-valuenow
  const setSpin = async (label, target) => {
    const loc = page.locator(`div[role="dialog"] input[aria-label="${label}"]`).first();
    if (!(await loc.count())) return false;
    await loc.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); }).catch(() => {});
    for (let i = 0; i < 70; i++) {
      const v = parseInt((await loc.getAttribute('aria-valuenow').catch(() => '')) || 'NaN', 10);
      if (v === target) return true;
      await loc.focus().catch(() => {});
      await page.keyboard.press(Number.isNaN(v) || v < target ? 'ArrowUp' : 'ArrowDown');
      await sleep(35);
    }
    return false;
  };
  const okH = await setSpin('Hours', want.h12);
  const okM = await setSpin('Minutes', want.min);
  const okP = await setSpin('AM PM', want.pm ? 1 : 0);
  await sleep(800);

  const got = await page.evaluate(() => {
    const q = (l) => document.querySelector(`div[role="dialog"] input[aria-label="${l}"]`);
    const dateBtnEl = Array.from(document.querySelectorAll('div[role="dialog"] [role="button"]')).find((e) => /\b\d{4}$/.test((e.innerText || '').trim()));
    return { date: dateBtnEl ? dateBtnEl.innerText.trim() : '', h: q('Hours')?.getAttribute('aria-valuenow'), m: q('Minutes')?.getAttribute('aria-valuenow'), p: q('AM PM')?.getAttribute('aria-valuetext') };
  });
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateOk = new RegExp(`${shortMonths[want.m]}\\w*\\s+${want.d},\\s+${want.y}`, 'i').test(got.date);
  if (!okH || !okM || !okP || !dateOk) {
    return { ok: false, reason: `jadwal terbaca "${got.date} ${got.h}:${got.m} ${got.p}", seharusnya ${want.label}` };
  }
  const warn = await page.evaluate(() => {
    const d = document.querySelector('div[role="dialog"]');
    const m = (d ? d.innerText : '').match(/choose a time at least[^\n]*|pilih waktu minimal[^\n]*/i);
    return m ? m[0] : '';
  }).catch(() => '');
  if (warn) return { ok: false, reason: `Instagram menolak jam jadwal: "${warn}"` };
  onProgress(`Jadwal Instagram diatur: ${want.label}`);
  return { ok: true, value: want.label, at: new Date(targetMs).toISOString() };
}

/**
 * Fungsi utama upload media ke Instagram Feed / Reels (Multi-Akun Support)
 */
async function uploadToInstagram({ mediaPaths = [], caption = '', accountUsername = '', accountId = '', scheduleAt = '', shareToFacebook = null, dryRun = false, onProgress = () => {} }) {
  if (isUploading) {
    throw new Error('Ada proses upload lain yang sedang berjalan. Menunggu antrean...');
  }

  isUploading = true;
  let browser = null;
  let context = null;

  try {
    // 1. Ambil Cookies sesuai nama akun yang dikirim oleh scheduleRunner
    let rawCookies = loadInstagramSession(accountId) || loadInstagramSession(accountUsername) || null;

    if (!rawCookies && accountUsername) {
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
    
    // Jendela di luar layar (mode headless sering ditolak Instagram)
    const showBrowser = process.env.INSTAGRAM_SHOW_BROWSER === '1';
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: [
        ...(showBrowser ? [] : ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']),
        '--hide-crash-restore-bubble',
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
    if (process.env.IG_DEBUG_CROP) await page.screenshot({ path: process.env.IG_DEBUG_CROP }).catch(() => {});

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

    // 8a. "Share to Facebook" sesuai pilihan di aplikasi (null = biarkan bawaan Instagram)
    if (shareToFacebook === true || shareToFacebook === false) {
      const fbSw = await setDialogSwitch(page, /facebook/, shareToFacebook);
      if (fbSw.found && shareToFacebook === false) {
        // Konfirmasi "Stop sharing to Facebook?" → "Don't share this post" (hanya posting ini)
        await sleep(1000);
        await page.evaluate(() => {
          const re = /^(don.t share this post|jangan bagikan postingan ini|jangan bagikan kiriman ini)$/i;
          const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((e) => re.test((e.innerText || '').trim()));
          if (b) b.click();
        }).catch(() => {});
        await sleep(1000);
      }
      onProgress(fbSw.found
        ? `Bagikan ke Facebook: ${fbSw.checked ? 'AKTIF' : 'MATI'}`
        : 'Pilihan "Share to Facebook" tidak ada di akun ini (dilewati).');
      await sleep(800);
    }

    // 8b. Jadwal bawaan Instagram (diunggah lebih awal, Instagram yang memposting di jam jadwal)
    let igScheduled = null;
    if (scheduleAt) {
      const targetMs = new Date(scheduleAt).getTime();
      if (!Number.isNaN(targetMs) && targetMs > Date.now()) {
        const effMs = Math.ceil(Math.max(targetMs, Date.now() + IG_SCHEDULE_MIN_LEAD_MS) / 60000) * 60000;
        onProgress('Mengatur jadwal posting di Instagram (Schedule content)...');
        const sched = await setInstagramSchedule(page, effMs, onProgress);
        if (!sched.ok) {
          const e = new Error(`Gagal mengatur jadwal di Instagram: ${sched.reason}`);
          e.code = 'INSTAGRAM_SCHEDULE_FAILED';
          throw e;
        }
        igScheduled = sched;
      }
    }
    if (dryRun) {
      if (process.env.IG_DEBUG_SHOT) await page.screenshot({ path: process.env.IG_DEBUG_SHOT }).catch(() => {});
      onProgress('[Uji] Berhenti sebelum tombol Share.');
      return { success: true, dryRun: true, instagramScheduled: Boolean(igScheduled), scheduledFor: igScheduled?.at || '', message: 'Uji berhasil sampai tombol Share.' };
    }
    if (igScheduled) {
      // Tombol header berubah jadi "Schedule"
      let clickedSched = false;
      for (let i = 0; i < 10 && !clickedSched; i++) {
        clickedSched = await page.evaluate(() => {
          const re = /^(schedule|jadwalkan)$/i;
          const el = Array.from(document.querySelectorAll('[role="button"], button'))
            .filter((e) => re.test((e.innerText || '').trim()) && e.offsetParent !== null)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          if (!el) return false;
          el.click();
          return true;
        }).catch(() => false);
        if (!clickedSched) await sleep(1500);
      }
      if (!clickedSched) throw new Error('Tombol Schedule Instagram tidak ditemukan.');
    } else {
      await shareBtn.click({ force: true });
    }

    // 9. MENUNGGU KONFIRMASI TERBIT
    onProgress('Menunggu konfirmasi terbit dari Instagram...');
    const successIndicators = [
      'text="Your post has been shared."',
      'text="Postingan Anda telah dibagikan."',
      'text="Your reel has been shared."',
      'text="Reel Anda telah dibagikan."',
      'text="Your reel has been shared"',
      'text="Reel Anda telah dibagikan"',
      'text=/(post|reel) (has been|is) scheduled/i',
      'text=/(postingan|reel) (anda )?(telah )?dijadwalkan/i'
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
      // Teks konfirmasi lain (mis. "Your post will be shared on ...", "scheduled", "dijadwalkan")
      const state = await page.evaluate(() => {
        const d = document.querySelector('div[role="dialog"]');
        return { open: Boolean(d), text: d ? (d.innerText || '').slice(0, 3000) : '' };
      }).catch(() => ({ open: true, text: '' }));
      if (/(has been|was|is) (shared|scheduled)|will be (shared|posted)|scheduled for|telah (dibagikan|dijadwalkan)|akan (dibagikan|diposting)|dijadwalkan untuk/i.test(state.text)) { postSuccess = true; break; }
      if (i > 3 && !/create new post|new reel|buat postingan baru|reel baru|sharing|membagikan/i.test(state.text) && !state.open) { postSuccess = true; break; }
      await sleep(2000);
    }
    if (process.env.IG_DEBUG_AFTER) await page.screenshot({ path: process.env.IG_DEBUG_AFTER }).catch(() => {});

    if (!postSuccess) {
      const isCreateModalClosed = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => false));
      if (!isCreateModalClosed) {
        throw new Error('Timeout menunggu konfirmasi postingan berhasil diterbitkan.');
      }
    }

    onProgress(igScheduled ? `Postingan terjadwal di Instagram untuk ${igScheduled.value}` : 'Postingan / Reels berhasil diterbitkan!');
    await sleep(3500);

    return {
      success: true,
      instagramScheduled: Boolean(igScheduled),
      scheduledFor: igScheduled?.at || '',
      message: igScheduled ? `Postingan terjadwal di Instagram (${igScheduled.value}).` : 'Postingan berhasil diunggah ke Instagram.'
    };
  } catch (error) {
    if (error && error.code === 'INSTAGRAM_SCHEDULE_FAILED') throw error;
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