/**
 * src/platforms/facebook/facebookReelsUploader.js
 * Posting Reels ke Facebook Page lewat Meta Business Suite (reels_composer), memakai profil Chrome
 * akun Facebook yang mengelola Page tersebut. Mendukung jadwal bawaan Facebook (Schedule).
 */
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const FB_SCHEDULE_MIN_LEAD_MS = 20 * 60 * 1000; // Facebook: jadwal minimal ±10 menit ke depan → pakai 20 menit agar aman
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let isUploading = false;

function purgeLocks(profileDir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try { fs.unlinkSync(require('path').join(profileDir, f)); } catch (e) {}
  }
}

// Tunggu tombol aktif lalu klik (maks timeoutMs)
async function clickWhenReady(page, re, opts = {}, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await clickByText(page, re, opts)) return true;
    await sleep(1500);
  }
  return false;
}

async function clickByText(page, re, { last = false } = {}) {
  return page.evaluate(({ src, last }) => {
    const rx = new RegExp(src, 'i');
    const els = Array.from(document.querySelectorAll('[role="button"], button, [role="radio"], [role="tab"]'))
      .filter((e) => e.offsetParent !== null && e.getAttribute('aria-disabled') !== 'true' && !e.disabled
        && rx.test((e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')));
    const el = last ? els[els.length - 1] : els[0];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, { src: re.source, last });
}

// Isi jadwal: tanggal (dd/mm/yyyy) + jam + menit di zona waktu browser
async function setFacebookSchedule(page, targetMs, onProgress) {
  const want = await page.evaluate((ms) => {
    const t = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()}`, hh: p(t.getHours()), mm: p(t.getMinutes()), label: `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()} ${p(t.getHours())}:${p(t.getMinutes())}` };
  }, targetMs);

  if (!(await clickByText(page, /^schedule$|^jadwalkan$/))) return { ok: false, reason: 'pilihan Schedule tidak ditemukan' };
  await sleep(2000);

  const dateInput = page.locator('input[placeholder="dd/mm/yyyy"], input[placeholder="hh/bb/tttt"]').first();
  if (!(await dateInput.count())) return { ok: false, reason: 'kolom tanggal jadwal tidak ditemukan' };
  await dateInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(want.date, { delay: 40 });
  await page.keyboard.press('Enter').catch(() => {});
  await sleep(500);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(600);

  const hours = page.locator('input[aria-label="hours"], input[aria-label="jam"]').first();
  const minutes = page.locator('input[aria-label="minutes"], input[aria-label="menit"]').first();
  if (!(await hours.count()) || !(await minutes.count())) return { ok: false, reason: 'kolom jam jadwal tidak ditemukan' };
  // Spinbutton jam/menit: fokus lalu ketik angka; bila belum masuk, naikkan/turunkan dengan panah
  const setSpin = async (loc, target) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ force: true }).catch(() => {});
    await loc.focus().catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(target, { delay: 80 });
    await sleep(400);
    for (let i = 0; i < 70; i++) {
      const v = parseInt((await loc.getAttribute('aria-valuenow').catch(() => '')) || 'NaN', 10);
      if (v === Number(target)) return true;
      await loc.focus().catch(() => {});
      await page.keyboard.press(Number.isNaN(v) || v < Number(target) ? 'ArrowUp' : 'ArrowDown');
      await sleep(40);
    }
    return false;
  };
  await setSpin(hours, want.hh);
  await setSpin(minutes, want.mm);
  await sleep(600);
  // Klik area kosong untuk menutup pemilih
  await page.mouse.click(5, 300).catch(() => {});
  await sleep(800);

  const vals = await page.evaluate(() => ({
    date: document.querySelector('input[placeholder="dd/mm/yyyy"], input[placeholder="hh/bb/tttt"]')?.value || '',
    hh: document.querySelector('input[aria-label="hours"], input[aria-label="jam"]')?.getAttribute('aria-valuenow') || '',
    mm: document.querySelector('input[aria-label="minutes"], input[aria-label="menit"]')?.getAttribute('aria-valuenow') || ''
  }));
  const [d, m, y] = want.date.split('/');
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dateOk = vals.date === want.date || new RegExp(`^0?${Number(d)}\\s+${monthNames[Number(m) - 1]}\\s+${y}$`, 'i').test(vals.date.trim());
  if (!dateOk || vals.hh.padStart(2, '0') !== want.hh || vals.mm.padStart(2, '0') !== want.mm) {
    return { ok: false, reason: `jadwal terbaca "${vals.date} ${vals.hh}:${vals.mm}", seharusnya ${want.label}` };
  }
  onProgress(`Jadwal Facebook diatur: ${want.label}`);
  return { ok: true, value: want.label, at: new Date(targetMs).toISOString() };
}

/**
 * @param {object} o
 * @param {string[]} o.mediaPaths  video (file pertama dipakai)
 * @param {string} o.caption
 * @param {string} o.pageId        asset_id Facebook Page
 * @param {string} o.profileDir    profil Chrome akun Facebook pengelola Page
 * @param {string} [o.scheduleAt]  ISO → pakai jadwal bawaan Facebook
 * @param {boolean} [o.dryRun]     berhenti sebelum klik Share/Schedule (uji)
 */
async function uploadToFacebookReels({ mediaPaths = [], caption = '', pageId = '', profileDir = '', scheduleAt = '', dryRun = false, chromePath = '', onProgress = () => {} }) {
  if (isUploading) throw new Error('Ada proses upload Facebook lain yang sedang berjalan.');
  const video = (mediaPaths || []).find((f) => /\.(mp4|mov|webm)$/i.test(f) && fs.existsSync(f));
  if (!video) throw new Error('Facebook Reels butuh 1 file video (MP4/MOV).');
  if (!pageId) throw new Error('Facebook Page belum dipilih.');
  if (!profileDir || !fs.existsSync(profileDir)) throw new Error('Profil Chrome akun Facebook tidak ditemukan. Login Facebook ulang di Kelola Akun.');
  const exe = chromePath || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

  isUploading = true;
  let browser = null;
  let proc = null;
  try {
    purgeLocks(profileDir);
    const port = 55500 + Math.floor(Math.random() * 3000);
    const showBrowser = process.env.FACEBOOK_SHOW_BROWSER === '1';
    proc = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--remote-allow-origins=*',
      '--hide-crash-restore-bubble',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      ...(showBrowser ? [] : ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']),
      'about:blank'
    ], { detached: false, stdio: 'ignore' });
    for (let i = 0; i < 30 && !browser; i++) {
      await sleep(1000);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    }
    if (!browser) throw new Error('Tidak bisa membuka Chrome Facebook.');
    const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
    page.setDefaultTimeout(60000);

    onProgress('Membuka Meta Business Suite (Buat Reel)...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(`https://business.facebook.com/latest/reels_composer?asset_id=${encodeURIComponent(pageId)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        onProgress(`Gagal membuka Business Suite (${String(e.message).split(String.fromCharCode(10))[0]}) → coba lagi...`);
        await sleep(5000);
      }
    }
    if (/login|checkpoint/.test(page.url())) throw new Error('Sesi Facebook kedaluwarsa. Login Facebook ulang di Kelola Akun.');
    const addVideo = page.getByRole('button', { name: /^(Add video|Tambahkan video)$/i }).first();
    await addVideo.waitFor({ timeout: 45000 });

    onProgress('Mengunggah video ke Facebook...');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 20000 }), addVideo.click()]);
    await chooser.setFiles(video);

    // Tunggu unggah & proses selesai (pemilih thumbnail muncul)
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60 * 1000) {
      const ready = await page.evaluate(() => /Auto-generated thumbnail|Choose frame|Pilih bingkai/i.test(document.body.innerText)
        || Array.from(document.querySelectorAll('[aria-label]')).some((e) => /Auto-generated thumbnail/i.test(e.getAttribute('aria-label'))));
      if (ready) break;
      await sleep(2000);
    }
    await sleep(2000);

    if (caption) {
      onProgress('Menulis deskripsi Reel...');
      const desc = page.locator('[contenteditable="true"]').first();
      await desc.click();
      await page.keyboard.type(caption, { delay: 8 });
      await sleep(800);
    }

    onProgress('Lanjut ke langkah Edit...');
    if (!(await clickWhenReady(page, /^(next|berikutnya|selanjutnya)$/, { last: true }))) throw new Error('Tombol Next (langkah 1) tidak aktif / tidak ditemukan.');
    await sleep(5000);
    onProgress('Lanjut ke langkah Share...');
    if (!(await clickWhenReady(page, /^(next|berikutnya|selanjutnya)$/, { last: true }))) throw new Error('Tombol Next (langkah 2) tidak aktif / tidak ditemukan.');
    await sleep(5000);

    let scheduled = null;
    if (scheduleAt) {
      const targetMs = new Date(scheduleAt).getTime();
      if (!Number.isNaN(targetMs) && targetMs > Date.now()) {
        const effMs = Math.ceil(Math.max(targetMs, Date.now() + FB_SCHEDULE_MIN_LEAD_MS) / 60000) * 60000;
        onProgress('Mengatur jadwal posting di Facebook (Schedule)...');
        const res = await setFacebookSchedule(page, effMs, onProgress);
        if (!res.ok) {
          const e = new Error(`Gagal mengatur jadwal di Facebook: ${res.reason}`);
          e.code = 'FACEBOOK_SCHEDULE_FAILED';
          throw e;
        }
        scheduled = res;
      }
    }

    if (dryRun) {
      onProgress('[Uji] Berhenti sebelum tombol akhir.');
      return { success: true, dryRun: true, facebookScheduled: Boolean(scheduled), scheduledFor: scheduled?.at || '' };
    }

    onProgress(scheduled ? 'Klik tombol Schedule...' : 'Klik tombol Share...');
    const finalRe = scheduled ? /^(schedule|jadwalkan)$/ : /^(share|bagikan|publish|terbitkan)$/;
    if (!(await clickByText(page, finalRe, { last: true }))) throw new Error('Tombol akhir Share/Schedule tidak ditemukan.');

    // Sukses: keluar dari composer / muncul notifikasi
    const t1 = Date.now();
    let ok = false;
    while (Date.now() - t1 < 3 * 60 * 1000) {
      await sleep(2000);
      const state = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 4000)
      })).catch(() => ({ url: '', text: '' }));
      if (!/reels_composer/.test(state.url) || /(reel|post).{0,40}(scheduled|shared|published|dijadwalkan|dibagikan|dipublikasikan)/i.test(state.text)) { ok = true; break; }
      if (/something went wrong|terjadi kesalahan|couldn.t (share|publish)/i.test(state.text)) throw new Error('Facebook menolak posting Reel (Something went wrong).');
    }
    if (!ok) throw new Error('Tidak ada konfirmasi dari Facebook setelah klik tombol akhir.');
    onProgress(scheduled ? `Reel terjadwal di Facebook untuk ${scheduled.value}` : 'Reel berhasil dipublikasikan ke Facebook Page!');
    return { success: true, facebookScheduled: Boolean(scheduled), scheduledFor: scheduled?.at || '' };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { proc && proc.kill(); } catch (e) {}
    isUploading = false;
  }
}

module.exports = { uploadToFacebookReels, setFacebookSchedule, FB_SCHEDULE_MIN_LEAD_MS };
