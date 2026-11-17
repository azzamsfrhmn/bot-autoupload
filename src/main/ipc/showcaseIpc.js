/**
 * src/main/ipc/showcaseIpc.js
 * Manajemen IPC Showcase TikTok Streamer & Kalodata
 * (Perbaikan: Isolasi Mutlak Multi-Akun Profile Chrome & Anti-Fallback Session Leak)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { dialog } = require('electron');

module.exports = function registerShowcaseIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    DATA_ROOT,
    TIKTOK_PROFILES_DIR,
    getActiveAccount,
    cleanUserIdentifier,
    getOriginalChromeExecutablePath
  } = ctx;

  const RUNTIME_ROOT = DATA_ROOT || PROJECT_ROOT;
  const SESSIONS_DIR = path.resolve(RUNTIME_ROOT, 'sessions');
  const STORAGE_DIR = path.resolve(RUNTIME_ROOT, 'storage');
  const ACCOUNTS_FILE = path.resolve(SESSIONS_DIR, 'accounts.json');
  const METRICS_STORE_PATH = path.resolve(SESSIONS_DIR, 'showcase_metrics_store.json');
  // File per akun di sessions/akun/<platform>_<username>/ (baca: folder akun dulu, lalu file lama)
  const af = require('../../core/accountFiles');

  const STREAMER_SHOWCASE_URL = 'https://shop.tiktok.com/streamer/showcase/product/list';

  [SESSIONS_DIR, STORAGE_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  function safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  function normalizeId(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^@/, '').toLowerCase();
  }

  function safeFileSlug(raw) {
    const norm = normalizeId(raw);
    return norm.replace(/[^a-z0-9._-]/g, '_');
  }

  // Port CDP Chrome bot yang SEDANG terbuka dengan profil ini (mis. jendela Chrome yang terlihat).
  // Port-nya acak, jadi dibaca dari baris perintah proses chrome.exe.
  function findProfileCdpPorts(profileDir) {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine }"],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      const want = path.resolve(profileDir).toLowerCase();
      const ports = [];
      for (const line of out.split(/\r?\n/)) {
        const dir = (line.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/) || []).slice(1).find(Boolean);
        const port = (line.match(/--remote-debugging-port=(\d+)/) || [])[1];
        if (dir && port && path.resolve(dir.replace(/"/g, '')).toLowerCase() === want) ports.push(Number(port));
      }
      return ports;
    } catch (e) { return []; }
  }

  function purgeTikTokSessionLocks(profileDir) {
    if (!fs.existsSync(profileDir)) return;
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    });
  }

  function getSystemActiveUsername() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        const accList = Array.isArray(raw) ? raw : (raw.accounts || []);
        const activeId = raw.activeAccountId || raw.activeId;
        const matched = accList.find((a) => a.id === activeId) || (accList.length > 0 ? accList[0] : null);
        if (matched) {
          return normalizeId(matched.username || matched.name || matched.id);
        }
      }
    } catch (e) {}

    const active = typeof getActiveAccount === 'function' ? getActiveAccount() : null;
    return normalizeId(active?.username || active?.id || 'default');
  }

  /**
   * Mengembalikan folder profil sesi Chrome yang mutlak terisolasi untuk akun yang dituju
   */
  function resolveActiveProfileDir(explicitUser = null) {
    const targetUser = normalizeId(explicitUser || getSystemActiveUsername());
    const slugUser = safeFileSlug(targetUser);
    const cleanId = typeof cleanUserIdentifier === 'function' ? cleanUserIdentifier(targetUser) : slugUser;

    const baseProfilesDir = TIKTOK_PROFILES_DIR || path.resolve(SESSIONS_DIR, 'tiktok_profiles');
    if (!fs.existsSync(baseProfilesDir)) {
      fs.mkdirSync(baseProfilesDir, { recursive: true });
    }

    // 1. Cek folder dengan nama unik spesifik
    const preferredCandidates = [
      path.resolve(baseProfilesDir, `profile_${cleanId}`),
      path.resolve(baseProfilesDir, `profile_${slugUser}`),
      path.resolve(baseProfilesDir, `acc_${cleanId}`),
      path.resolve(baseProfilesDir, `acc_${slugUser}`),
      path.resolve(baseProfilesDir, cleanId),
      path.resolve(baseProfilesDir, slugUser)
    ];

    for (const p of preferredCandidates) {
      if (fs.existsSync(p)) return p;
    }

    // 1b. Folder profil yang tercatat di data akun (mis. acc_tiktok_<angka> saat rename sesudah login gagal)
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        const list = Array.isArray(raw) ? raw : (raw.accounts || []);
        const acc = list.find((a) => [a.id, a.username].filter(Boolean).some((v) => normalizeId(v) === targetUser || safeFileSlug(normalizeId(v)) === slugUser));
        const recorded = acc && (acc.profileDir || (acc.profileFolder && path.resolve(baseProfilesDir, acc.profileFolder)));
        if (recorded && fs.existsSync(recorded)) return recorded;
      }
    } catch (e) {}

    // 2. Jika belum ada, buat folder baru khusus akun ini (JANGAN PINJAM AKUN LAIN)
    const newTargetDir = path.resolve(baseProfilesDir, `profile_${cleanId || 'default'}`);
    if (!fs.existsSync(newTargetDir)) {
      fs.mkdirSync(newTargetDir, { recursive: true });
    }
    return newTargetDir;
  }

  async function ensureTikTokShopAuthenticated(context, page, explicitUser = null) {
    try {
      const activeUser = normalizeId(explicitUser || getSystemActiveUsername());
      const slugUser = safeFileSlug(activeUser);
      const cleanId = typeof cleanUserIdentifier === 'function' ? cleanUserIdentifier(activeUser) : slugUser;

      const cookieFiles = [
        path.resolve(SESSIONS_DIR, `tiktok_cookies_${activeUser}.json`),
        path.resolve(SESSIONS_DIR, `tiktok_cookies_${slugUser}.json`),
        path.resolve(SESSIONS_DIR, `tiktok_cookies_${cleanId}.json`),
        path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeUser}.json`),
        path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${slugUser}.json`),
        path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${cleanId}.json`)
      ].map((p) => af.readPath(p));

      let diskCookies = [];
      for (const f of cookieFiles) {
        if (fs.existsSync(f)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
            if (Array.isArray(parsed)) diskCookies = diskCookies.concat(parsed);
          } catch (e) {}
        }
      }

      const liveCookies = await context.cookies(['https://www.tiktok.com', 'https://shop.tiktok.com']).catch(() => []);
      const combined = [...liveCookies, ...diskCookies];

      const targetDomains = [
        '.tiktok.com',
        'shop.tiktok.com',
        '.tiktokshop.com',
        'business.tiktokshop.com',
        'creator.tiktokshop.com'
      ];

      const authCookies = [];
      for (const c of combined) {
        if (!c || !c.name || !c.value) continue;
        const nameLow = c.name.toLowerCase();
        if (
          nameLow.includes('session') ||
          nameLow.includes('sid_') ||
          nameLow.includes('uid_') ||
          nameLow.includes('odin_') ||
          nameLow.includes('token') ||
          nameLow.includes('ttwid') ||
          nameLow.includes('passport')
        ) {
          for (const dom of targetDomains) {
            authCookies.push({
              name: c.name,
              value: c.value,
              domain: dom,
              path: '/',
              secure: true,
              httpOnly: Boolean(c.httpOnly),
              sameSite: 'None'
            });
          }
        }
      }

      if (authCookies.length > 0) {
        await context.addCookies(authCookies).catch(() => {});
      }

      // Cookie lengkap dari sesi login (domain asli). Teruji: profil kosong + cookie ini langsung menampilkan etalase.
      const fullCookieFiles = [
        `tiktok_streamer_cookies_${cleanId}.json`, `tiktok_streamer_cookies_${slugUser}.json`,
        `tiktokshop_cookies_${cleanId}.json`, `tiktokshop_cookies_${slugUser}.json`,
        `session_tiktok_${cleanId}.json`, `session_${cleanId}.json`
      ].map((f) => af.readPath(path.resolve(SESSIONS_DIR, f)));
      const liveNames = new Set(liveCookies.map((c) => `${c.name}@${c.domain}`));
      const loggedInLive = liveCookies.some((c) => c.name === 'sessionid' && c.value);
      if (!loggedInLive) {
        for (const f of fullCookieFiles) {
          if (!fs.existsSync(f)) continue;
          let raw = null;
          try { raw = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { continue; }
          const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.cookies) ? raw.cookies : []);
          for (const c of list) {
            if (!c || !c.name || !c.value || !c.domain || liveNames.has(`${c.name}@${c.domain}`)) continue;
            const exp = Number(c.expires || c.expirationDate || 0);
            const cookie = {
              name: c.name, value: String(c.value), domain: c.domain, path: c.path || '/',
              secure: c.secure !== false, httpOnly: Boolean(c.httpOnly),
              sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'None',
              ...(exp > 0 ? { expires: exp } : {})
            };
            try { await context.addCookies([cookie]); liveNames.add(`${c.name}@${c.domain}`); } catch (e) {}
          }
          break; // satu berkas sesi lengkap sudah cukup
        }
      }

      if (!page.url().includes('/streamer/showcase/product/list')) {
        await page.goto(STREAMER_SHOWCASE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      }
      await page.waitForTimeout(2000);

      if (page.url().includes('/creator/live')) {
        const joinClicked = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
          const joinBtn = els.find((el) => {
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            return txt === 'join now' || txt === 'ikuti sekarang' || txt === 'log in' || txt === 'masuk';
          });
          if (joinBtn) {
            joinBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (joinClicked) {
          await page.waitForTimeout(3500);

          await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
            const ssoBtn = els.find((el) => {
              const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
              return (
                txt.includes('with tiktok') ||
                txt.includes('dengan tiktok') ||
                txt === 'authorize' ||
                txt === 'otorisasi' ||
                txt === 'continue' ||
                txt === 'lanjutkan'
              );
            });
            if (ssoBtn) ssoBtn.click();
          }).catch(() => {});

          await page.waitForTimeout(4000);

          if (!page.url().includes('/streamer/showcase/product/list')) {
            await page.goto(STREAMER_SHOWCASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(2000);
          }
        }
      }
    } catch (e) {}
  }

  function loadCachedShowcaseProducts(explicitUser = null) {
    const targetUser = normalizeId(explicitUser || getSystemActiveUsername());
    const slugUser = safeFileSlug(targetUser);
    const cleanId = typeof cleanUserIdentifier === 'function' ? cleanUserIdentifier(targetUser) : slugUser;

    const candidateFiles = [
      path.resolve(STORAGE_DIR, `showcase_${cleanId}.json`),
      path.resolve(STORAGE_DIR, `showcase_${slugUser}.json`),
      path.resolve(SESSIONS_DIR, `showcase_${cleanId}.json`),
      path.resolve(SESSIONS_DIR, `showcase_products_${cleanId}.json`),
      path.resolve(SESSIONS_DIR, `showcase_products_${slugUser}.json`)
    ].map((p) => af.readPath(p));

    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
          const list = Array.isArray(parsed) ? parsed : (parsed.data || []);
          if (Array.isArray(list)) return list;
        } catch (e) {}
      }
    }

    return [];
  }

  function saveShowcaseCacheAllVariants(items, explicitUser = null) {
    if (!Array.isArray(items)) return;
    const targetUser = normalizeId(explicitUser || getSystemActiveUsername());
    const slugUser = safeFileSlug(targetUser);
    const cleanId = typeof cleanUserIdentifier === 'function' ? cleanUserIdentifier(targetUser) : slugUser;

    const targets = [
      path.resolve(STORAGE_DIR, `showcase_${cleanId}.json`),
      path.resolve(SESSIONS_DIR, `showcase_${cleanId}.json`),
      path.resolve(SESSIONS_DIR, `showcase_products_${cleanId}.json`)
    ];

    // Pertahankan daftar foto lengkap yang sudah pernah diambil (sinkron etalase hanya membawa foto sampul)
    let previous = [];
    try { previous = JSON.parse(fs.readFileSync(af.readPath(targets[0]), 'utf-8')); } catch (e) {}
    const prevImages = new Map((Array.isArray(previous) ? previous : [])
      .filter((p) => p?.imagesVer === 2 && Array.isArray(p?.images) && p.images.length > 1)
      .map((p) => [String(p.productId || p.id), p.images]));
    const merged = items.map((p) => {
      const keep = prevImages.get(String(p?.productId || p?.id));
      return keep && !(p?.imagesVer === 2 && Array.isArray(p?.images) && p.images.length >= keep.length) ? { ...p, images: keep, imagesVer: 2 } : p;
    });

    // ke folder akun (showcase.json & showcase_products.json); akun tak dikenal → path lama
    [...new Set(targets.map((t) => af.writePath(t)))].forEach((t) => {
      try { fs.writeFileSync(t, JSON.stringify(merged, null, 2), 'utf-8'); } catch (e) {}
    });
  }

  safeHandle('get-tiktok-streamer-status', async (event, explicitUser = null) => {
    try {
      const activeUser = normalizeId(explicitUser || getSystemActiveUsername());
      const profileDir = resolveActiveProfileDir(activeUser);
      if (fs.existsSync(profileDir)) {
        const c1 = path.join(profileDir, 'Default', 'Network', 'Cookies');
        const c2 = path.join(profileDir, 'Network', 'Cookies');
        if (fs.existsSync(c1) || fs.existsSync(c2)) {
          return { success: true, isLoggedIn: true, status: 'Sesi Aktif', accountName: activeUser };
        }
      }
      return { success: true, isLoggedIn: false, status: 'Belum Login', accountName: activeUser };
    } catch (e) {
      return { success: false, isLoggedIn: false, status: 'Belum Login' };
    }
  });

  safeHandle('get-tiktokshop-status', async (event, explicitUser = null) => {
    const profileDir = resolveActiveProfileDir(explicitUser);
    const hasCookies = fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies')) ||
                       fs.existsSync(path.join(profileDir, 'Network', 'Cookies'));
    return { success: true, isLoggedIn: hasCookies };
  });

  safeHandle('login-tiktok-streamer', async (event, explicitUser = null) => {
    try {
      const activeUser = normalizeId(explicitUser || getSystemActiveUsername());
      const profileDir = resolveActiveProfileDir(activeUser);
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
      purgeTikTokSessionLocks(profileDir);

      const chromeExe = getOriginalChromeExecutablePath();
      if (!chromeExe) return { success: false, error: 'Google Chrome tidak ditemukan.' };

      const cdpPort = 53800 + Math.floor(Math.random() * 1000);

      const proc = spawn(chromeExe, [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--lang=id-ID',
        '--window-size=1280,900',
        '--window-position=60,40',
        STREAMER_SHOWCASE_URL
      ], { detached: true, stdio: 'ignore' });
      proc.unref();

      (async () => {
        let browser = null;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {}
        }
        if (!browser) return;

        const context = browser.contexts()[0];
        if (!context) return;
        const page = context.pages()[0] || await context.newPage();

        await ensureTikTokShopAuthenticated(context, page, activeUser);

        try {
          await page.waitForSelector('tbody tr, .arco-table-tr, [role="row"]', { timeout: 10000 });
          await page.waitForTimeout(1000);
          const scraped = await scrapeProductsFromPage(page);
          if (scraped.length > 0) {
            saveShowcaseCacheAllVariants(scraped, activeUser);
            const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send('load-showcase');
            }
          }
        } catch (e) {}
      })().catch(() => {});

      return { success: true, port: cdpPort };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // TikTok Shop mengosongkan tabel untuk --headless: pakai jendela Chrome asli di luar layar
  // Windows mengunci file "lockfile" selama Chrome memakai profil ini (mis. sinkron profil sesudah login).
  // Chrome kedua di profil yang sama langsung menutup diri, jadi tunggu sampai profil bebas.
  async function waitForProfileFree(profileDir, timeoutMs = 200000) {
    const lockPath = path.join(profileDir, 'lockfile');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!fs.existsSync(lockPath)) return true;
      try {
        fs.unlinkSync(lockPath);
        return true;
      } catch (e) {
        if (e.code !== 'EBUSY' && e.code !== 'EPERM') return true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async function launchOffscreenShowcaseChrome(profileDir, chromeExe) {
    await waitForProfileFree(profileDir);
    purgeTikTokSessionLocks(profileDir);
    const port = 54250 + Math.floor(Math.random() * 400);
    const proc = spawn(chromeExe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
      '--remote-allow-origins=*',
      '--window-position=-32000,-32000',
      '--window-size=1280,900',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--lang=id-ID',
      STREAMER_SHOWCASE_URL
    ], { detached: false, stdio: 'ignore' });

    let browser = null;
    for (let i = 0; i < 30 && !browser; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch (e) {}
    }
    return { proc, browser };
  }

  async function closeOffscreenShowcaseChrome(proc, browser) {
    if (browser) await browser.close().catch(() => {});
    if (proc?.pid && process.platform === 'win32') {
      await new Promise((resolve) => {
        try {
          const k = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
          k.on('exit', resolve);
          k.on('error', resolve);
        } catch (e) { resolve(); }
      });
    }
  }

  // Tunggu tabel etalase benar-benar terisi (atau memang kosong), lalu baca SEMUA halaman (20 produk per halaman)
  async function waitForShowcaseRows(page, timeoutMs = 45000) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    // "24 products in showcase" / "24 produk di etalase"
    const readTotal = () => page.evaluate(() => {
      const m = (document.body?.innerText || '').match(/([\d.,]+)\s*(?:products? in showcase|produk di etalase|produk dalam etalase)/i);
      return m ? Number(m[1].replace(/[.,]/g, '')) : -1;
    }).catch(() => -1);
    let items = [];
    while (Date.now() < deadline) {
      items = await scrapeProductsFromPage(page);
      if (items.length > 0) break;
      if (await readTotal() === 0) return [];
      const isEmptyTable = await page.evaluate(() => !!document.querySelector('.arco-empty, .arco-table-no-data')).catch(() => false);
      // Tanda "kosong" bisa muncul lama sebelum data datang (internet lambat): percayai setelah 20 detik
      if (isEmptyTable && Date.now() - startedAt > 20000) return [];
      await page.waitForTimeout(1000);
    }
    if (!items.length) return [];
    await page.waitForTimeout(800);
    const all = new Map((await scrapeProductsFromPage(page)).map((p) => [p.productId, p]));
    const total = await readTotal();

    // Halaman berikutnya (paginasi arco)
    for (let pg = 0; pg < 100 && (total < 0 || all.size < total); pg++) {
      const next = page.locator('.arco-pagination-item-next, li[aria-label="Next"], button[aria-label="Next"]').first();
      if (!(await next.isVisible().catch(() => false))) break;
      const cls = (await next.getAttribute('class').catch(() => '')) || '';
      if (/disabled/.test(cls) || (await next.getAttribute('aria-disabled').catch(() => '')) === 'true') break;
      const before = [...(await scrapeProductsFromPage(page))].map((p) => p.productId).join(',');
      await next.click({ timeout: 5000 }).catch(() => {});
      let changed = false;
      for (let t = 0; t < 30 && !changed; t++) {
        await page.waitForTimeout(500);
        const now = await scrapeProductsFromPage(page);
        if (now.length && now.map((p) => p.productId).join(',') !== before) {
          await page.waitForTimeout(600);
          (await scrapeProductsFromPage(page)).forEach((p) => { if (!all.has(p.productId)) all.set(p.productId, p); });
          changed = true;
        }
      }
      if (!changed) break;
    }
    console.log('[Showcase] Total di TikTok:', total, '| terbaca:', all.size);
    return [...all.values()];
  }

  async function scrapeProductsFromPage(page) {
    return await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
      const list = [];

      rows.forEach((r) => {
        const txt = (r.innerText || '').trim();
        if (!txt) return;

        const pidMatch = txt.match(/ID[:\s]*(\d{15,22})/i) || txt.match(/(\d{17,21})/);
        if (!pidMatch) return;

        const pid = pidMatch[1];
        const img = r.querySelector('img')?.src || '';
        const rpMatches = txt.match(/Rp[\d,.]+/g) || [];
        const price = rpMatches[0] || 'Rp0';
        const commission = rpMatches[1] || '-';

        const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
        const title = lines.find((l) =>
          l.length > 5 &&
          !l.toLowerCase().startsWith('id:') &&
          !l.toLowerCase().startsWith('rp') &&
          !['hide', 'edit', 'remove', 'hapus', 'live', 'in stock', 'product', 'no.'].includes(l.toLowerCase())
        ) || 'Produk TikTok Shop';

        const stockMatch = txt.match(/([\d.,]+[kK]?)\s*(?:terjual|stock|in stock)?/i);
        const stock = stockMatch ? stockMatch[1] : '';

        if (!list.some((item) => item.productId === pid)) {
          list.push({
            id: pid,
            productId: pid,
            title,
            product_title: title,
            coverUrl: img,
            price,
            commission,
            stock,
            isStreamerShowcase: true
          });
        }
      });
      return list;
    }).catch(() => []);
  }

  // Satu sinkron per akun: panggilan bersamaan (login, buka tab, tombol) menunggu hasil yang sama
  const showcaseSyncJobs = new Map();

  safeHandle('get-tiktok-showcase-products', async (event, forceRefresh = false, explicitUser = null) => {
    const activeUser = normalizeId(explicitUser || getSystemActiveUsername());

    if (!forceRefresh) {
      const cached = loadCachedShowcaseProducts(activeUser);
      if (cached.length > 0) {
        return { success: true, data: cached, account: activeUser };
      }
    }

    if (showcaseSyncJobs.has(activeUser)) return showcaseSyncJobs.get(activeUser);
    const job = syncShowcaseFromTikTok(activeUser).finally(() => showcaseSyncJobs.delete(activeUser));
    showcaseSyncJobs.set(activeUser, job);
    return job;
  });

  async function syncShowcaseFromTikTok(activeUser) {
    const profileDir = resolveActiveProfileDir(activeUser);
    const chromeExe = getOriginalChromeExecutablePath();
    console.log('[Showcase] Sinkron mulai:', activeUser, '| profil:', profileDir);
    if (!chromeExe || !fs.existsSync(profileDir)) {
      const fallback = loadCachedShowcaseProducts(activeUser);
      return { success: true, data: fallback, account: activeUser };
    }

    // Chrome bot yang sedang terbuka dengan profil ini (port acak) dipakai langsung
    const candidatePorts = findProfileCdpPorts(profileDir) /* hanya Chrome milik profil akun ini */;
    let browser = null;
    for (const p of candidatePorts) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
        if (browser) break;
      } catch (e) {}
    }

    let tempProc = null;
    if (!browser) {
      const launched = await launchOffscreenShowcaseChrome(profileDir, chromeExe);
      tempProc = launched.proc;
      browser = launched.browser;
    }

    if (!browser) {
      if (tempProc) await closeOffscreenShowcaseChrome(tempProc, null);
      const fallback = loadCachedShowcaseProducts(activeUser);
      return {
        success: fallback.length > 0, data: fallback, account: activeUser,
        error: 'Chrome bot tidak bisa dibuka (profil sedang dipakai). Tutup jendela Chrome TikTok Shop lalu coba Sinkronkan lagi.'
      };
    }

    try {
      const context = browser.contexts()[0];
      let page = context?.pages().find((p) => p.url().includes('/streamer/showcase'));
      if (!page) {
        page = context.pages()[0] || await context.newPage();
      }

      console.log('[Showcase] Chrome:', tempProc ? 'baru (luar layar)' : 'pakai yang terbuka');
      await ensureTikTokShopAuthenticated(context, page, activeUser);
      console.log('[Showcase] Halaman:', page.url());

      const items = await waitForShowcaseRows(page);
      console.log('[Showcase] Produk terbaca:', items.length, '| URL akhir:', page.url());

      if (items.length > 0) {
        saveShowcaseCacheAllVariants(items, activeUser);
        notifyShowcaseUpdated();
        return { success: true, data: items, account: activeUser };
      }
      const fallback = loadCachedShowcaseProducts(activeUser);
      return {
        success: fallback.length > 0,
        data: fallback,
        account: activeUser,
        error: fallback.length === 0 ? 'Belum ada produk ditemukan. Pastikan akun sudah terdaftar di TikTok Shop Affiliate.' : undefined
      };
    } catch (err) {
      const fallback = loadCachedShowcaseProducts(activeUser);
      return { success: fallback.length > 0, data: fallback, account: activeUser, error: err.message };
    } finally {
      if (tempProc) await closeOffscreenShowcaseChrome(tempProc, browser);
    }
  }

  function notifyShowcaseUpdated() {
    const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
    if (win && !win.isDestroyed()) win.webContents.send('load-showcase');
  }

  safeHandle('preview-tiktok-product-url', async (event, productUrl) => {
    const activeUser = getSystemActiveUsername();
    const profileDir = resolveActiveProfileDir(activeUser);
    const chromeExe = getOriginalChromeExecutablePath();

    if (!productUrl) return { success: false, error: 'URL produk kosong.' };

    const pidMatch = String(productUrl).match(/(\d{15,22})/);
    const targetPid = pidMatch ? pidMatch[1] : '';
    const finalUrl = productUrl.startsWith('http')
      ? productUrl
      : `https://www.tiktok.com/view/product/${targetPid}`;

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = findProfileCdpPorts(profileDir) /* hanya Chrome milik profil akun ini */;
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      if (!browser) {
        if (!chromeExe || !fs.existsSync(profileDir)) {
          return { success: false, error: 'Sesi Chrome atau profil akun belum siap.' };
        }

        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 53888;
        procToClose = spawn(chromeExe, [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
          '--remote-allow-origins=*',
          '--headless=new',
          '--no-first-run',
          '--lang=id-ID',
          STREAMER_SHOWCASE_URL
        ], { detached: true, stdio: 'ignore' });
        procToClose.unref();

        for (let i = 0; i < 20; i++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!browser) return { success: false, error: 'Gagal menghubungkan bot ke browser Chrome.' };

      const context = browser.contexts()[0];
      let page = context?.pages().find((p) => p.url().includes('shop.tiktok.com'));
      if (!page) page = context.pages()[0] || await context.newPage();

      await ensureTikTokShopAuthenticated(context, page, activeUser);
      // Chrome tersembunyi kadang berlayar kecil → tombol di modal berada di luar layar ("outside of the viewport")
      await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
      // Klik biasa; gagal (di luar layar / tertutup elemen lain) → klik langsung lewat DOM
      const safeClick = async (loc) => {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        try {
          await loc.click({ force: true, timeout: 5000 });
        } catch (e) {
          await loc.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
        }
      };

      // TikTok kini memakai panel samping (arco-drawer) dengan tab "My Shop" / "Product URL".
      // Semua langkah dibatasi ke panel itu (jangan menyentuh tabel showcase di belakangnya).
      const drawerSel = '.arco-drawer:visible';
      let drawer = page.locator(drawerSel).last();
      if (!(await drawer.isVisible().catch(() => false))) {
        const btnAddProducts = page.locator('button:has-text("Add new products"), button:has-text("Tambah produk baru"), button:has-text("Tambah produk")').first();
        await btnAddProducts.waitFor({ state: 'visible', timeout: 15000 });
        await safeClick(btnAddProducts);
        await page.locator(drawerSel).last().waitFor({ state: 'visible', timeout: 10000 });
        drawer = page.locator(drawerSel).last();
      }

      // Tab "Product URL" (kolom URL baru muncul setelah tab ini dipilih)
      // Panel masih bergeser (animasi) → klik tab bisa tak terbaca; ulangi sampai kolom URL tampil.
      // Tab non-aktif tetap ada di DOM (digeser ke luar layar), jadi patokannya aria-selected.
      await page.waitForTimeout(1200);
      const urlTab = drawer.locator('[role="tab"]').filter({ hasText: /Product URL|URL Produk|Tautan produk/ }).first();
      const tabActive = async () => (await urlTab.getAttribute('aria-selected').catch(() => '')) === 'true';
      for (let i = 0; i < 5 && !(await tabActive()); i++) {
        await urlTab.click({ timeout: 5000 }).catch(() => safeClick(urlTab).catch(() => {}));
        await page.waitForTimeout(1000);
      }
      if (!(await tabActive())) return { success: false, error: 'Tab "Product URL" di TikTok tidak bisa dibuka.' };
      const pane = drawer.locator('.arco-tabs-content-item-active').first();
      const inputField = pane.locator('input[data-tid="m4b_input"], input[placeholder*="productURL"], input[placeholder*="URL"]').first();
      await inputField.waitFor({ state: 'visible', timeout: 8000 });
      await inputField.fill('');
      await inputField.fill(finalUrl);
      await page.waitForTimeout(500);

      const btnProductUrls = pane.locator('button:has-text("Product URLs"), button:has-text("URL Produk"), button[data-btm="d85319"]').first();
      await btnProductUrls.waitFor({ state: 'visible', timeout: 8000 });
      await safeClick(btnProductUrls);

      // Tunggu produk muncul: footer panel menampilkan "Select X/Y Products" (otomatis tercentang)
      const footer = drawer.locator('.m4b-drawer-footer, .arco-drawer-footer').first();
      const readSel = async () => {
        const m = ((await footer.innerText().catch(() => '')) || '').match(/(\d+)\s*\/\s*(\d+)/);
        return m ? { sel: +m[1], total: +m[2] } : { sel: 0, total: 0 };
      };
      let st = { sel: 0, total: 0 };
      for (let i = 0; i < 15 && !st.total; i++) { await page.waitForTimeout(1000); st = await readSel(); }
      if (!st.total) {
        const txt = (await pane.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        return { success: false, error: `Produk tidak bisa ditambahkan dari URL ini (bukan produk afiliasi / tidak tersedia). ${txt}` };
      }
      // Label "Added" di bawah gambar produk = sudah ada di showcase
      const addedBadge = pane.getByText(/^(Added|Ditambahkan)$/).first();
      const isAdded = async () => addedBadge.isVisible().catch(() => false);
      if (await isAdded()) return { success: true, productId: targetPid, already: true };

      if (!st.sel) {                                           // belum tercentang → centang semua
        await safeClick(pane.locator('.arco-checkbox').first()).catch(() => {});
        await page.waitForTimeout(600);
        st = await readSel();
        if (!st.sel) return { success: false, error: 'Produk ditemukan tetapi tidak bisa dipilih (tidak memenuhi syarat afiliasi).' };
      }

      const btnConfirmAdd = drawer.locator('button.pc_add_product, button:has-text("Add products"), button:has-text("Tambahkan produk")').first();
      await btnConfirmAdd.waitFor({ state: 'visible', timeout: 8000 });
      await safeClick(btnConfirmAdd);

      // Berhasil = panel tertutup ATAU produk berlabel "Added". Selain itu ambil pesan dari TikTok.
      let ok = false;
      for (let i = 0; i < 15 && !ok; i++) {
        await page.waitForTimeout(1000);
        ok = !(await page.locator(drawerSel).last().isVisible().catch(() => false)) || await isAdded();
      }
      if (!ok) {
        const toast = (await page.locator('.arco-message, .arco-notification').allInnerTexts().catch(() => [])).join(' ').trim();
        return { success: false, error: toast || 'TikTok belum menerima produk (tidak ada konfirmasi "Added").' };
      }

      return { success: true, productId: targetPid };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (procToClose) await closeOffscreenShowcaseChrome(procToClose, browser);
    }
  });

  safeHandle('remove-tiktok-showcase-product', async (event, productId) => {
    const activeUser = getSystemActiveUsername();
    const profileDir = resolveActiveProfileDir(activeUser);
    const chromeExe = getOriginalChromeExecutablePath();
    const targetPid = String(productId).trim();

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = findProfileCdpPorts(profileDir) /* hanya Chrome milik profil akun ini */;
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      if (!browser) {
        if (!chromeExe || !fs.existsSync(profileDir)) {
          return { success: false, error: 'Sesi Chrome atau profil akun belum siap.' };
        }
        const launched = await launchOffscreenShowcaseChrome(profileDir, chromeExe);
        procToClose = launched.proc;
        browser = launched.browser;
      }

      if (!browser) return { success: false, error: 'Gagal menghubungkan bot ke browser Chrome.' };

      const context = browser.contexts()[0];
      let page = context?.pages().find((p) => p.url().includes('/streamer/showcase'));
      if (!page) page = context.pages()[0] || await context.newPage();

      await ensureTikTokShopAuthenticated(context, page, activeUser);
      await waitForShowcaseRows(page);

      const removeClicked = await page.evaluate((pid) => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
        const targetRow = rows.find((r) => (r.innerText || '').includes(pid));
        if (!targetRow) return false;

        const elements = Array.from(targetRow.querySelectorAll('span.arco-link, button, a, span'));
        const removeEl = elements.find((el) => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt === 'remove' || txt === 'hapus';
        });

        if (removeEl) {
          removeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          removeEl.click();
          return true;
        }
        return false;
      }, targetPid);

      if (!removeClicked) {
        return { success: false, error: `Produk dengan ID ${targetPid} tidak ditemukan di halaman tabel.` };
      }

      await page.waitForSelector('.arco-modal button, [role="dialog"] button', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);

      await page.evaluate(() => {
        const modalButtons = Array.from(document.querySelectorAll('.arco-modal button, [role="dialog"] button, button'));
        const deleteBtn = modalButtons.find((btn) => {
          const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          return txt === 'delete' || txt === 'confirm' || txt === 'hapus';
        });
        if (deleteBtn) deleteBtn.click();
      });

      // Tunggu baris produk hilang dari tabel, lalu baca produk yang tersisa dari halaman yang sama
      let remaining = [];
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000);
        remaining = await scrapeProductsFromPage(page);
        if (!remaining.some((item) => item.productId === targetPid)) break;
      }
      remaining = remaining.filter((item) => item.productId !== targetPid);
      if (remaining.length === 0) {
        remaining = loadCachedShowcaseProducts(activeUser).filter((item) => String(item.productId || item.id) !== targetPid);
      }
      saveShowcaseCacheAllVariants(remaining, activeUser);
      notifyShowcaseUpdated();

      return { success: true, productId: targetPid, data: remaining, account: activeUser };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (procToClose) {
        if (browser) await browser.close().catch(() => {});
        if (procToClose.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(procToClose.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  });

  const productImageJobs = new Map();
  safeHandle('get-tiktok-product-images', async (event, productId) => {
    const key = `${getSystemActiveUsername()}|${String(productId).trim()}`;
    if (productImageJobs.has(key)) return productImageJobs.get(key);
    const job = fetchTikTokProductImages(productId).finally(() => productImageJobs.delete(key));
    productImageJobs.set(key, job);
    return job;
  });

  async function fetchTikTokProductImages(productId) {
    const activeUser = getSystemActiveUsername();
    const targetPid = String(productId).trim();
    const cached = loadCachedShowcaseProducts(activeUser);
    const found = cached.find((item) => String(item.productId || item.id) === targetPid);

    const sanitizeTikTokImageUrl = (raw) => {
      if (!raw || typeof raw !== 'string') return '';
      let clean = raw.trim().replace(/&amp;/g, '&');
      if (!clean.startsWith('http')) return '';
      return clean;
    };

    // Kunci gambar = path tanpa query (URL TikTok bertanda tangan berubah-ubah, path-nya tetap)
    const imgKey = (u) => String(u || '').split('?')[0].replace(/~tplv-[^/]*$/, '').toLowerCase();
    // Sampul produk LAIN di etalase: tidak boleh ikut masuk galeri produk ini
    const otherCovers = new Set(cached
      .filter((item) => String(item.productId || item.id) !== targetPid)
      .map((item) => imgKey(item.coverUrl || item.product_img))
      .filter(Boolean));
    const cleanImages = (list) => {
      const seen = new Set();
      const out = [];
      const cover = sanitizeTikTokImageUrl(found?.coverUrl || found?.product_img || '');
      [cover, ...(list || [])].forEach((u) => {
        const url = sanitizeTikTokImageUrl(u);
        const k = imgKey(url);
        if (!url || !k || seen.has(k) || otherCovers.has(k)) return;
        if (/avatar|logo|icon|emoji|sprite|\.svg/i.test(url)) return;
        seen.add(k);
        out.push(url);
      });
      return out;
    };

    // Hanya cache versi 2 (hasil pengambilan yang sudah diperbaiki) yang dipakai langsung
    if (found && found.imagesVer === 2 && Array.isArray(found.images) && found.images.length > 1) {
      return { success: true, productId: targetPid, images: cleanImages(found.images) };
    }

    const profileDir = resolveActiveProfileDir(activeUser);
    const chromeExe = getOriginalChromeExecutablePath();
    if (!chromeExe || !fs.existsSync(profileDir)) {
      return { success: false, error: 'Profil Chrome belum siap.', images: found?.coverUrl ? [found.coverUrl] : [] };
    }

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = findProfileCdpPorts(profileDir) /* hanya Chrome milik profil akun ini */;
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      if (!browser) {
        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 53888;
        procToClose = spawn(chromeExe, [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
          '--remote-allow-origins=*',
          '--headless=new',
          '--no-first-run',
          '--lang=id-ID',
          STREAMER_SHOWCASE_URL
        ], { detached: true, stdio: 'ignore' });
        procToClose.unref();

        for (let i = 0; i < 20; i++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!browser) return { success: false, error: 'Gagal terhubung ke Chrome.', images: found?.coverUrl ? [found.coverUrl] : [] };

      const context = browser.contexts()[0];
      let page = context?.pages().find((p) => p.url().includes('/streamer/showcase'));
      if (!page) page = context.pages()[0] || await context.newPage();

      await ensureTikTokShopAuthenticated(context, page, activeUser);

      await page.waitForSelector('tbody tr, .arco-table-tr, [role="row"]', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(600);

      let extractedImages = [];

      const responsePromise = page.waitForResponse(async (response) => {
        try {
          if (response.status() === 200) {
            const text = await response.text().catch(() => '');
            if (text.includes(targetPid) && text.includes('images') && text.includes('url_list')) {
              const json = JSON.parse(text);
              const productList = json?.data?.products || json?.data?.item_list || json?.products || [];
              const matchedProd = productList.find((p) => String(p.product_id || p.id) === targetPid);

              if (matchedProd && Array.isArray(matchedProd.images)) {
                extractedImages = matchedProd.images
                  .map((imgObj) => {
                    const list = imgObj.url_list || imgObj.thumb_url_list || [];
                    return sanitizeTikTokImageUrl(list[0]);
                  })
                  .filter(Boolean);
                return extractedImages.length > 0;
              }
            }
          }
        } catch (e) {}
        return false;
      }, { timeout: 6000 }).catch(() => null);

      const editClicked = await page.evaluate((pid) => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
        const targetRow = rows.find((r) => (r.innerText || '').includes(pid));
        if (!targetRow) return false;

        const editBtn = Array.from(targetRow.querySelectorAll('a, button, span, [data-tid="m4b_link"]')).find((el) => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt === 'edit' || txt === 'ubah';
        });

        if (editBtn) {
          editBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          editBtn.click();
          return true;
        }
        return false;
      }, targetPid);

      if (editClicked) {
        await responsePromise;
        await page.waitForTimeout(1000);

        if (extractedImages.length === 0) {
          const domUrls = await page.evaluate(() => {
            const modal = Array.from(document.querySelectorAll('.arco-modal, [role="dialog"]')).filter((m) => m.offsetParent !== null).pop();
            if (!modal) return [];
            const imgs = Array.from(modal.querySelectorAll('img.sc-eDPEul, img.imhSto, span.sc-eldPxv img, img'));
            return imgs
              .map((img) => img.currentSrc || img.src || img.getAttribute('data-src'))
              .filter((s) => s && s.startsWith('http') && !s.includes('avatar') && !s.includes('icon'));
          });
          extractedImages = domUrls.map(sanitizeTikTokImageUrl).filter(Boolean);
        }

        await page.evaluate(() => {
          const cancelBtn = Array.from(document.querySelectorAll('.arco-modal button, [role="dialog"] button, [aria-label="Close"]')).find((b) => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt === 'cancel' || txt === 'batal' || b.getAttribute('aria-label') === 'Close';
          });
          if (cancelBtn) cancelBtn.click();
        }).catch(() => {});
      }

      extractedImages = cleanImages(extractedImages);

      if (extractedImages.length === 0 && found?.coverUrl) {
        extractedImages = [sanitizeTikTokImageUrl(found.coverUrl)];
      }

      if (extractedImages.length > 1 && cached.length > 0) {
        const updated = cached.map((p) => {
          if (String(p.productId || p.id) === targetPid) return { ...p, images: extractedImages, imagesVer: 2 };
          return p;
        });
        saveShowcaseCacheAllVariants(updated, activeUser);
      }

      return {
        success: extractedImages.length > 0,
        productId: targetPid,
        images: extractedImages
      };
    } catch (err) {
      return { success: false, error: err.message, images: found?.coverUrl ? [found.coverUrl] : [] };
    } finally {
      if (procToClose) {
        if (browser) await browser.close().catch(() => {});
        if (procToClose.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(procToClose.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  }

  safeHandle('get-kalodata-products', async () => {
    const p = path.resolve(SESSIONS_DIR, 'kalodata_products.json');
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return { success: true, data: Array.isArray(d) ? d : [] };
      } catch (e) {}
    }
    return { success: true, data: [] };
  });

  safeHandle('save-kalodata-raw-json', async (event, payload) => {
    try {
      const p = path.resolve(SESSIONS_DIR, 'kalodata_products.json');
      let items = [];

      if (Array.isArray(payload)) {
        items = payload;
      } else if (payload && Array.isArray(payload.data)) {
        items = payload.data;
      } else if (payload && typeof payload === 'object') {
        items = [payload];
      }

      let existing = [];
      if (fs.existsSync(p)) {
        try {
          existing = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (!Array.isArray(existing)) existing = [];
        } catch (e) {}
      }

      const mergedMap = new Map();
      existing.forEach((item) => {
        const id = String(item.id || item.productId || item.product_id || '').trim();
        if (id) mergedMap.set(id, item);
      });

      items.forEach((item) => {
        const id = String(item.id || item.productId || item.product_id || '').trim();
        if (id) {
          mergedMap.set(id, {
            ...mergedMap.get(id),
            ...item,
            id: id,
            productId: id
          });
        }
      });

      const finalData = Array.from(mergedMap.values());
      fs.writeFileSync(p, JSON.stringify(finalData, null, 2), 'utf-8');

      return { success: true, count: finalData.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('clear-kalodata-products', async () => {
    try {
      const p = path.resolve(SESSIONS_DIR, 'kalodata_products.json');
      if (fs.existsSync(p)) {
        fs.writeFileSync(p, JSON.stringify([], null, 2), 'utf-8');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('import-kalodata-file', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Pilih File JSON Kalodata',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });

      if (canceled || filePaths.length === 0) return { success: false };

      const content = fs.readFileSync(filePaths[0], 'utf-8');
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : [parsed]);

      const p = path.resolve(SESSIONS_DIR, 'kalodata_products.json');
      fs.writeFileSync(p, JSON.stringify(items, null, 2), 'utf-8');

      return { success: true, count: items.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('get-showcase-metrics-store', async (event, explicitUser = null) => {
    const targetUser = normalizeId(explicitUser || getSystemActiveUsername());
    const metricsPath = af.readPath(path.resolve(STORAGE_DIR, `showcase_metrics_${targetUser}.json`));
    if (fs.existsSync(metricsPath)) {
      try { return JSON.parse(fs.readFileSync(metricsPath, 'utf-8')); } catch (e) {}
    }
    if (fs.existsSync(METRICS_STORE_PATH)) {
      try { return JSON.parse(fs.readFileSync(METRICS_STORE_PATH, 'utf-8')); } catch (e) {}
    }
    return {};
  });

  safeHandle('save-showcase-metrics-store', async (e, payload, explicitUser = null) => {
    try {
      const targetUser = normalizeId(explicitUser || getSystemActiveUsername());
      const legacyMetrics = path.resolve(STORAGE_DIR, `showcase_metrics_${targetUser}.json`);
      const readMetrics = af.readPath(legacyMetrics);
      let cur = fs.existsSync(readMetrics) ? JSON.parse(fs.readFileSync(readMetrics, 'utf-8')) : {};
      const metricsPath = af.writePath(legacyMetrics);
      fs.writeFileSync(metricsPath, JSON.stringify({ ...cur, ...payload }, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  });
};