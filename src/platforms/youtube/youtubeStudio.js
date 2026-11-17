/**
 * src/platforms/youtube/youtubeStudio.js
 * YouTube lewat Chrome asli (profil per channel) + YouTube Studio:
 *  - baca info channel (nama, handle, foto, subscriber, video) dari ytInitialData halaman publik
 *  - upload Shorts / video biasa lewat studio.youtube.com (judul, deskripsi, anak-anak: tidak,
 *    produk YouTube Shopping opsional, Publik / Jadwal)
 * Chrome dijalankan di luar layar (bukan --headless: Google lebih ketat pada headless).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILES_DIR = () => path.join(process.cwd(), 'sessions', 'youtube_profiles');
let busy = false;

function chromeExe() {
  const cands = [
    path.join(process.env['PROGRAMFILES'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ];
  return cands.find((p) => p && fs.existsSync(p)) || '';
}

function purgeLocks(profileDir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch (e) {}
  }
}

// Chrome di luar layar dengan CDP. Return { proc, browser, page, close() }
async function openStudioChrome(profileDir, { visible = false } = {}) {
  const exe = chromeExe();
  if (!exe) throw new Error('Google Chrome tidak ditemukan di komputer.');
  if (!fs.existsSync(profileDir)) throw new Error('Profil Chrome akun YouTube tidak ditemukan. Login YouTube ulang di Kelola Akun.');
  purgeLocks(profileDir);
  const port = 55100 + Math.floor(Math.random() * 800);
  const proc = spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--hide-crash-restore-bubble',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--lang=id-ID',
    '--window-size=1366,900',
    ...(visible ? ['--window-position=60,40'] : ['--window-position=-32000,-32000',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling']),
    'about:blank'
  ], { detached: false, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) { try { proc.kill(); } catch (e) {} throw new Error('Chrome YouTube tidak bisa dibuka (profil mungkin sedang dipakai).'); }
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  await page.setViewportSize({ width: 1366, height: 900 }).catch(() => {});
  const close = async () => {
    await browser.close().catch(() => {});
    if (proc?.pid && process.platform === 'win32') {
      await new Promise((res) => { const k = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' }); k.on('exit', res); k.on('error', res); });
    } else { try { proc.kill(); } catch (e) {} }
  };
  return { proc, browser, context, page, close };
}

// ---------------- Info channel ----------------
const parseCount = (txt) => {
  const s = String(txt || '').toLowerCase().replace(/subscriber|pelanggan|video|subscribers|videos/g, '').trim();
  const m = s.match(/([\d.,]+)\s*(rb|ribu|k|jt|juta|m|b|mlyr)?/i);
  if (!m) return 0;
  const unit = (m[2] || '').toLowerCase();
  const mult = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e6, b: 1e9, mlyr: 1e9 }[unit] || 1;
  const num = parseFloat(unit ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''));
  return Math.round(num * mult) || 0;
};

// Channel yang login di profil ini: buka Studio → URL /channel/UC...
async function readChannelId(page) {
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 30; i++) {
    const url = page.url();
    const m = url.match(/\/channel\/(UC[\w-]{20,})/);
    if (m) return m[1];
    if (/accounts\.google\.com/.test(url)) return '';              // belum login
    if (/\/create_channel|youtube\.com\/create/.test(url)) throw new Error('Akun Google ini belum punya channel YouTube. Buat channel dulu di YouTube.');
    const id = await page.evaluate(() => (window.ytcfg && window.ytcfg.get && window.ytcfg.get('CHANNEL_ID')) || '').catch(() => '');
    if (/^UC/.test(id || '')) return id;
    await sleep(1000);
  }
  return '';
}

// Data publik channel dari ytInitialData (nama, handle, foto, subscriber, jumlah video, daftar video)
async function readChannelPublic(page, channelId) {
  await page.goto(`https://www.youtube.com/channel/${channelId}/videos`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => !!window.ytInitialData, null, { timeout: 20000 }).catch(() => {});
  const info = await page.evaluate(() => {
    const d = window.ytInitialData || {};
    const meta = d.metadata?.channelMetadataRenderer || {};
    const txt = (o) => (o ? (o.simpleText || (o.runs || []).map((r) => r.text).join('') || o.content || '') : '');
    // header baru (pageHeaderRenderer) atau lama (c4TabbedHeaderRenderer)
    let handle = ''; let subs = ''; let videos = ''; let avatar = '';
    const ph = d.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
    if (ph) {
      const rows = ph.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = rows.flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content || ''));
      handle = parts.find((p) => p.startsWith('@')) || '';
      subs = parts.find((p) => /subscriber|pelanggan/i.test(p)) || '';
      videos = parts.find((p) => /video/i.test(p)) || '';
      const srcs = ph.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources || [];
      avatar = (srcs[srcs.length - 1] || {}).url || '';
    }
    const c4 = d.header?.c4TabbedHeaderRenderer;
    if (c4) {
      handle = handle || txt(c4.channelHandleText);
      subs = subs || txt(c4.subscriberCountText);
      videos = videos || txt(c4.videosCountText);
      const th = c4.avatar?.thumbnails || [];
      avatar = avatar || (th[th.length - 1] || {}).url || '';
    }
    if (!avatar) { const th = meta.avatar?.thumbnails || []; avatar = (th[th.length - 1] || {}).url || ''; }
    // daftar video (tab Video)
    const list = [];
    const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    for (const t of tabs) {
      const items = t.tabRenderer?.content?.richGridRenderer?.contents || [];
      for (const it of items) {
        const v = it.richItemRenderer?.content?.videoRenderer;
        const lk = it.richItemRenderer?.content?.lockupViewModel;
        if (!v && lk && lk.contentId) {                      // format baru YouTube
          const md = lk.metadata?.lockupMetadataViewModel || {};
          const rows = md.metadata?.contentMetadataViewModel?.metadataRows || [];
          const parts = rows.flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content || ''));
          const img = (JSON.stringify(lk.contentImage || {}).match(/https:\/\/i\.ytimg\.com\/[^"\\]+/) || [])[0] || '';
          list.push({ id: lk.contentId, title: md.title?.content || '', coverUrl: img, viewsText: parts[0] || '', published: parts[1] || '', url: `https://www.youtube.com/watch?v=${lk.contentId}` });
          continue;
        }
        if (!v) continue;
        const th = v.thumbnail?.thumbnails || [];
        list.push({ id: v.videoId, title: txt(v.title), coverUrl: (th[th.length - 1] || {}).url || '', viewsText: txt(v.shortViewCountText || v.viewCountText), published: txt(v.publishedTimeText), url: `https://www.youtube.com/watch?v=${v.videoId}` });
      }
    }
    return { name: meta.title || '', description: meta.description || '', handle, subs, videos, avatar, list };
  }).catch(() => null);
  return info;
}

// Shorts channel (tab Shorts) — melengkapi daftar video
async function readChannelShorts(page, channelId) {
  await page.goto(`https://www.youtube.com/channel/${channelId}/shorts`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => !!window.ytInitialData, null, { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => {
    const d = window.ytInitialData || {};
    const out = [];
    for (const t of d.contents?.twoColumnBrowseResultsRenderer?.tabs || []) {
      for (const it of t.tabRenderer?.content?.richGridRenderer?.contents || []) {
        const s = it.richItemRenderer?.content?.shortsLockupViewModel;
        if (!s) continue;
        const id = (s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId) || (s.entityId || '').replace(/^shorts-shelf-item-/, '');
        const srcs = s.thumbnail?.sources || s.thumbnailViewModel?.thumbnailViewModel?.image?.sources || [];
        const anyImg = (JSON.stringify(s).match(/https:\/\/i\.ytimg\.com\/[^"\\]+/) || [])[0] || '';
        out.push({ id, title: s.overlayMetadata?.primaryText?.content || '', coverUrl: (srcs[0] || {}).url || anyImg, viewsText: s.overlayMetadata?.secondaryText?.content || '', isShort: true, url: `https://www.youtube.com/shorts/${id}` });
      }
    }
    return out;
  }).catch(() => []);
}

async function fetchAvatarDataUrl(url) {
  if (!url) return '';
  try {
    const r = await fetch(url);
    if (!r.ok) return '';
    return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch (e) { return ''; }
}

// Profil lengkap channel. page = halaman Chrome profil channel.
async function readChannelProfile(page, knownChannelId = '') {
  const channelId = knownChannelId || await readChannelId(page);
  if (!channelId) return null;
  // Halaman kadang belum siap / dialihkan sesaat setelah login → ulangi sampai nama channel terbaca
  let pub = {};
  for (let i = 0; i < 3 && !pub.name; i++) {
    if (i) await sleep(3000);
    pub = (await readChannelPublic(page, channelId)) || {};
  }
  const shorts = await readChannelShorts(page, channelId).catch(() => []);
  const handle = String(pub.handle || '').replace(/^@/, '');
  return {
    channelId,
    name: pub.name || handle || channelId,
    handle,
    biography: pub.description || '',
    avatarUrl: pub.avatar || '',
    avatar: await fetchAvatarDataUrl(pub.avatar),
    subscribersText: pub.subs || '',
    followersCount: parseCount(pub.subs),
    videosText: pub.videos || '',
    postsCount: parseCount(pub.videos),
    posts: [...(shorts || []).slice(0, 30), ...(pub.list || []).slice(0, 30)]
  };
}

// ---------------- Upload ----------------
// Klik elemen Studio (custom element) lewat DOM bila klik biasa tertutup elemen lain
async function studioClick(page, selector, timeout = 15000) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  try { await loc.click({ timeout: 5000 }); } catch (e) { await loc.evaluate((el) => el.click()); }
}

async function typeInto(page, selector, text) {
  const box = page.locator(selector).first();
  await box.waitFor({ state: 'visible', timeout: 30000 });
  await box.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  // insertText: emoji & teks panjang aman (tanpa simulasi ketukan per huruf)
  await page.keyboard.insertText(text);
  await sleep(400);
}

const progressText = (page) => page.evaluate(() => {
  const el = document.querySelector('ytcp-video-upload-progress .progress-label, .progress-label');
  return el ? el.innerText.trim() : '';
}).catch(() => '');

/**
 * opts: { profileDir, channelId, videoPath, title, description, tags[], productQueries[],
 *         scheduleAt (ISO, kosong = publik sekarang), visible, onProgress }
 * Return { success, videoUrl, scheduledFor, message }
 */
async function uploadToYouTube(opts) {
  const log = opts.onProgress || (() => {});
  if (busy) return { success: false, message: 'Upload YouTube lain sedang berjalan.' };
  if (!opts.videoPath || !fs.existsSync(opts.videoPath)) return { success: false, message: 'Berkas video tidak ditemukan.' };
  busy = true;
  let chrome = null;
  try {
    log('Membuka YouTube Studio...');
    chrome = await openStudioChrome(opts.profileDir, { visible: !!opts.visible });
    const { page } = chrome;
    const channelId = opts.channelId || await readChannelId(page);
    if (!channelId) return { success: false, message: 'Sesi YouTube habis / belum login. Login YouTube ulang di Kelola Akun.' };

    await page.goto(`https://studio.youtube.com/channel/${channelId}/videos/upload?d=ud`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/accounts\.google\.com/.test(page.url())) return { success: false, message: 'Sesi YouTube habis. Login YouTube ulang di Kelola Akun.' };

    log('Mengunggah berkas video...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 60000 });
    await fileInput.setInputFiles(opts.videoPath);

    // Halaman Detail
    await page.locator('#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox').first().waitFor({ state: 'visible', timeout: 120000 });
    await sleep(2500);
    const title = String(opts.title || '').replace(/[<>]/g, '').trim().slice(0, 100) || path.basename(opts.videoPath, path.extname(opts.videoPath));
    log('Mengisi judul & deskripsi...');
    await typeInto(page, '#title-textarea #textbox', title);
    const desc = String(opts.description || '').replace(/[<>]/g, '').slice(0, 4900);
    if (desc) await typeInto(page, '#description-textarea #textbox', desc);

    // Bukan konten anak-anak (wajib dipilih)
    await page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await studioClick(page, 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]', 30000);
    await sleep(800);

    // Produk YouTube Shopping (opsional; hanya channel yang memenuhi syarat)
    let productNote = '';
    if (Array.isArray(opts.productQueries) && opts.productQueries.length) {
      const r = await addShoppingProducts(page, opts.productQueries, log).catch((e) => ({ added: 0, error: e.message }));
      productNote = r.added ? ` · ${r.added} produk ditautkan` : ` · produk tidak ditautkan (${r.error || 'tidak ditemukan'})`;
    }

    // Lanjut ke Visibilitas (Detail → Elemen video → Pemeriksaan → Visibilitas)
    for (let i = 0; i < 3; i++) {
      await studioClick(page, '#next-button', 30000);
      await sleep(1800);
    }

    let scheduledFor = '';
    if (opts.scheduleAt && new Date(opts.scheduleAt).getTime() > Date.now() + 5 * 60000) {
      log('Mengatur jadwal tayang di YouTube...');
      scheduledFor = await setStudioSchedule(page, new Date(opts.scheduleAt));
    } else {
      const vis = ['PRIVATE', 'UNLISTED'].includes(String(opts.visibility || '').toUpperCase()) ? String(opts.visibility).toUpperCase() : 'PUBLIC';
      await studioClick(page, `tp-yt-paper-radio-button[name="${vis}"]`, 30000);
    }
    await sleep(1000);

    // Tunggu unggahan selesai (tombol Selesai/Publikasikan aktif)
    log('Menunggu unggahan ke YouTube selesai...');
    const t0 = Date.now();
    while (Date.now() - t0 < 30 * 60000) {
      const label = await progressText(page);
      const uploaded = /upload complete|unggahan selesai|checks complete|pemeriksaan selesai|processing|memproses|selesai diproses|tidak ditemukan masalah/i.test(label);
      const doneEnabled = await page.evaluate(() => { const b = document.querySelector('#done-button'); return !!b && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true'; }).catch(() => false);
      if (doneEnabled && (uploaded || !/uploading|mengupload|mengunggah|\d+%/i.test(label))) break;
      if (label) log(`YouTube: ${label}`);
      await sleep(4000);
    }
    const videoUrl = await page.evaluate(() => {
      const a = document.querySelector('.video-url-fadeable a, ytcp-video-info a[href*="youtu"]');
      return a ? a.href : '';
    }).catch(() => '');

    await studioClick(page, '#done-button', 30000);
    log('Menyimpan & mempublikasikan...');
    // Dialog konfirmasi ("Video dipublikasikan" / "Video dijadwalkan")
    await page.locator('ytcp-video-share-dialog, ytcp-prechecks-warning-dialog, #close-button').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    // Peringatan pemeriksaan → "Tetap publikasikan"
    const warn = page.locator('ytcp-prechecks-warning-dialog #primary-action-button, ytcp-prechecks-warning-dialog ytcp-button#secondary-action-button').first();
    if (await warn.isVisible().catch(() => false)) { await warn.click().catch(() => {}); await sleep(3000); }
    await sleep(2000);
    return { success: true, videoUrl, scheduledFor, youtubeScheduled: !!scheduledFor, message: (scheduledFor ? 'Video terjadwal di YouTube' : 'Video dipublikasikan ke YouTube') + productNote };
  } catch (e) {
    return { success: false, message: `Upload YouTube gagal: ${e.message}` };
  } finally {
    if (chrome) await chrome.close();
    busy = false;
  }
}

// Visibilitas → Jadwalkan: tanggal & jam (zona waktu PC). Return ISO jam yang dipakai.
async function setStudioSchedule(page, when) {
  await studioClick(page, '#second-container-expand-button', 20000);
  await sleep(1200);
  // Tanggal: buka pemilih tanggal lalu ketik tanggal dalam format yang ditampilkan Studio
  await studioClick(page, '#datepicker-trigger', 15000);
  await sleep(800);
  const dateInput = page.locator('ytcp-date-picker tp-yt-paper-input input, #input-1 input, ytcp-date-picker input').first();
  await dateInput.waitFor({ state: 'visible', timeout: 15000 });
  const shown = await dateInput.inputValue().catch(() => '');
  const dateText = formatLikeStudio(shown, when);
  await dateInput.fill('');
  await dateInput.fill(dateText);
  await page.keyboard.press('Enter');
  await sleep(800);
  // Jam: kolom teks "HH.MM" / "h:mm AM"
  const timeInput = page.locator('#time-of-day-container input, ytcp-form-input-container#time-of-day-container input').first();
  await timeInput.waitFor({ state: 'visible', timeout: 15000 });
  const shownTime = await timeInput.inputValue().catch(() => '');
  // Studio memakai kelipatan 15 menit → bulatkan ke atas
  const t = new Date(when.getTime());
  t.setSeconds(0, 0);
  const rem = t.getMinutes() % 15;
  if (rem) t.setMinutes(t.getMinutes() + (15 - rem));
  const p = (n) => String(n).padStart(2, '0');
  let timeText;
  if (/am|pm/i.test(shownTime)) {
    const h12 = t.getHours() % 12 || 12;
    timeText = `${h12}:${p(t.getMinutes())} ${t.getHours() < 12 ? 'AM' : 'PM'}`;
  } else {
    timeText = `${p(t.getHours())}${shownTime.includes('.') ? '.' : ':'}${p(t.getMinutes())}`;
  }
  await timeInput.click();
  await timeInput.fill('');
  await timeInput.fill(timeText);
  await page.keyboard.press('Enter');
  await sleep(600);
  await page.keyboard.press('Escape').catch(() => {});
  return t.toISOString();
}

// Tiru format tanggal yang sedang tampil di Studio (mis. "13 Nov 2026", "Nov 13, 2026", "13/11/2026")
function formatLikeStudio(sample, d) {
  const idMon = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const enMon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  const s = String(sample || '').trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (/^[A-Za-z]{3}\s+\d{1,2},\s*\d{4}$/.test(s)) return `${enMon[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (/(Mei|Agu|Okt|Des)/.test(s) || /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(s)) {
    const isEn = enMon.some((m) => s.includes(m)) && !idMon.some((m) => s.includes(m) && !enMon.includes(m));
    return `${d.getDate()} ${(isEn ? enMon : idMon)[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${d.getDate()} ${idMon[d.getMonth()]} ${d.getFullYear()}`;
}

// YouTube Shopping: Detail → "Produk" → Tambahkan produk → cari → pilih → Simpan
async function addShoppingProducts(page, queries, log) {
  const section = page.locator('ytcp-shopping-products-section, #shopping-products-section, ytcp-video-metadata-shopping').first();
  if (!(await section.count())) return { added: 0, error: 'channel belum memenuhi syarat YouTube Shopping' };
  await section.scrollIntoViewIfNeeded().catch(() => {});
  const addBtn = section.locator('ytcp-button, button').filter({ hasText: /add products|tambahkan produk|tambah produk/i }).first();
  if (!(await addBtn.count())) return { added: 0, error: 'tombol tambah produk tidak ada' };
  await addBtn.click().catch(() => addBtn.evaluate((el) => el.click()));
  await sleep(2500);
  let added = 0;
  for (const q of queries.slice(0, 30)) {
    const search = page.locator('ytcp-product-picker input, ytshopping-product-picker input, [role="dialog"] input[type="text"]').first();
    if (!(await search.isVisible().catch(() => false))) break;
    log(`Mencari produk: ${String(q).slice(0, 60)}...`);
    await search.fill('');
    await search.fill(String(q));
    await page.keyboard.press('Enter');
    await sleep(3500);
    const first = page.locator('[role="dialog"] [role="listitem"], [role="dialog"] ytcp-product-picker-item, [role="dialog"] tp-yt-paper-checkbox').first();
    if (await first.isVisible().catch(() => false)) {
      await first.click().catch(() => first.evaluate((el) => el.click()));
      added++;
      await sleep(800);
    }
  }
  const save = page.locator('[role="dialog"] ytcp-button, [role="dialog"] button').filter({ hasText: /^(done|selesai|save|simpan|continue|lanjutkan)$/i }).last();
  if (await save.isVisible().catch(() => false)) { await save.click().catch(() => {}); await sleep(2000); }
  return { added };
}

module.exports = { PROFILES_DIR, openStudioChrome, readChannelId, readChannelProfile, uploadToYouTube, parseCount, chromeExe };
