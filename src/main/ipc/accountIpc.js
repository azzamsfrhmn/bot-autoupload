/**
 * src/main/ipc/accountIpc.js
 */
const { session } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { spawn } = require('child_process');

module.exports = function registerAccountIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    DATA_ROOT,
    TIKTOK_PROFILES_DIR,
    getAccountsRegistry,
    getActiveAccount,
    setActiveAccount,
    getActivePartitionName,
    saveAccountSession,
    loadSessionFromFile,
    restoreSessionToPartition,
    getInstagramProfileAndFeed,
    clearSessionData,
    getCachedProfile,
    TARGET_USERNAME,
    cleanUserIdentifier,
    getOriginalChromeExecutablePath,
    setupPartitionHeaders,
    loadInitialScreen,
    syncTikTokProfile
  } = ctx;

  const RUNTIME_ROOT = DATA_ROOT || PROJECT_ROOT;
  const SESSIONS_DIR = path.resolve(RUNTIME_ROOT, 'sessions');
  // File per akun di sessions/akun/<platform>_<username>/ (baca: folder akun dulu, lalu file lama)
  const af = require('../../core/accountFiles');
  const ACCOUNTS_FILE = path.resolve(SESSIONS_DIR, 'accounts.json');

  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  function safeHandle(channel, handler) {
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {}
    ipcMain.handle(channel, handler);
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

  function findTikTokProfileCache(accountId, username) {
    const rawId = String(accountId || '');
    const cleanId = cleanUserIdentifier ? cleanUserIdentifier(rawId) : rawId.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const rawUser = String(username || '').replace(/^@/, '');
    const cleanUser = cleanUserIdentifier ? cleanUserIdentifier(rawUser) : rawUser.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();

    const specificCandidates = [
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${rawUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_${rawUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_${cleanUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${rawId}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanId}.json`)
    ].map((p) => af.readPath(p));

    for (const cPath of specificCandidates) {
      if (fs.existsSync(cPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(cPath, 'utf-8'));
          const avatarUrl = data.avatar || data.profilePicUrl || data.avatarUrl || data.avatarThumb;
          if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.length > 10) {
            return data;
          }
        } catch (e) {}
      }
    }
    return null;
  }

  function saveTikTokCachedProfile(accountId, profileData, hint = null) {
    try {
      const cleanId = cleanUserIdentifier ? cleanUserIdentifier(accountId) : accountId;
      const cacheFile = af.writePath(path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanId}.json`),
        hint || (profileData?.username ? { platform: 'tiktok', username: profileData.username } : null));
      fs.writeFileSync(cacheFile, JSON.stringify(profileData, null, 2), 'utf-8');
    } catch (e) {}
  }

  async function getTikTokProfileAndFeed(activeAcc, { force = false } = {}) {
    if (!activeAcc) return null;
    const accountKey = activeAcc.id || activeAcc.username;

    if (typeof syncTikTokProfile === 'function') {
      try {
        // Sinkron dibatasi sekali per 30 menit (lihat tiktokSessionManager); force = tombol Refresh Profil
        const syncRes = await syncTikTokProfile(accountKey, { force });
        if (syncRes && syncRes.success && syncRes.account) {
          saveTikTokCachedProfile(accountKey, syncRes.account);
          return {
            profile: syncRes.account,
            posts: syncRes.posts || syncRes.account.posts || []
          };
        }
      } catch (e) {}
    }

    const existingCache = findTikTokProfileCache(activeAcc.id, activeAcc.username);
    return {
      profile: existingCache || activeAcc,
      posts: existingCache?.posts || activeAcc.posts || []
    };
  }

  async function openTikTokCdpLogin(accountUsername = null) {
    const chromePath = getOriginalChromeExecutablePath();
    if (!chromePath) throw new Error('Google Chrome asli tidak ditemukan di sistem.');

    const tempSessionId = `tiktok_${Date.now()}`;
    const targetUser = accountUsername || tempSessionId;
    const cleanUser = cleanUserIdentifier ? cleanUserIdentifier(targetUser) : targetUser;
    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanUser}`);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    purgeTikTokSessionLocks(profileDir);
    const cdpPort = 54000 + Math.floor(Math.random() * 5000);

    const chromeProc = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--disable-background-networking',
      '--disable-component-update',
      '--window-size=1080,820',
      '--window-position=80,60',
      'https://www.tiktok.com/login'
    ], { detached: false, stdio: 'ignore' });

    (async () => {
      let browser = null;
      for (let i = 0; i < 35; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
          if (browser) break;
        } catch (e) {}
      }
      if (!browser) return;

      const checkInterval = setInterval(async () => {
        if (!chromeProc || chromeProc.killed) {
          clearInterval(checkInterval);
          return;
        }
        try {
          const context = browser.contexts()[0];
          if (!context) return;
          const cookies = await context.cookies(['https://www.tiktok.com', 'https://shop.tiktok.com', 'https://creator.tiktokshop.com']);
          const hasSession = cookies.some((c) => c.name === 'sessionid' || c.name === 'sid_tt' || c.name === 'sessionid_ss');

          if (hasSession) {
            clearInterval(checkInterval);

            const pages = context.pages();
            const page = pages.find((p) => !p.url().includes('chrome://')) || pages[0];

            // 1. Dapatkan URL profil akun aktif
            let myProfileUrl = '';
            for (let attempt = 0; attempt < 12; attempt++) {
              myProfileUrl = await page.evaluate(async () => {
                try {
                  const res = await fetch('https://www.tiktok.com/passport/web/account/info/', { credentials: 'include' });
                  const json = await res.json();
                  if (json?.data?.username) {
                    return `https://www.tiktok.com/@${json.data.username}`;
                  }
                } catch (e) {}

                const allLinks = Array.from(document.querySelectorAll('a'));
                const navProfile = allLinks.find((a) => {
                  const txt = (a.innerText || '').toLowerCase();
                  const href = a.getAttribute('href') || '';
                  return (txt.includes('profile') || txt.includes('profil')) && href.includes('/@') && !href.includes('/@me');
                });
                if (navProfile) return navProfile.href;

                const avatarLink = document.querySelector('a[href*="/@"][data-e2e="profile-icon"]');
                if (avatarLink && !avatarLink.href.includes('/@me')) return avatarLink.href;

                return '';
              }).catch(() => '');

              if (myProfileUrl) break;
              await new Promise((r) => setTimeout(r, 600));
            }

            if (myProfileUrl) {
              await page.goto(myProfileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            }

            await page.waitForSelector('[data-e2e="user-post-item"]', { timeout: 8000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 2000));

            // 2. Ekstraksi data profil dan thumbnail video dari DOM
            const profileData = await page.evaluate(() => {
              let uname = '';
              let nname = '';
              let avtr = '';
              let fol = '0';
              let fans = '0';
              let heart = '0';
              let bio = '';
              const postsList = [];

              const urlMatch = window.location.pathname.match(/@([a-zA-Z0-9._]+)/);
              if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'me') {
                uname = urlMatch[1];
              }

              const postItems = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]'));
              postItems.forEach((item) => {
                const a = item.querySelector('a[href*="/video/"]');
                const viewsEl = item.querySelector('[data-e2e="video-views"]');
                
                let coverImgUrl = '';
                const sourceEl = item.querySelector('picture source[srcset]');
                if (sourceEl) {
                  const rawSrcset = sourceEl.getAttribute('srcset') || '';
                  coverImgUrl = rawSrcset.split(',')[0].trim().split(' ')[0];
                }

                if (!coverImgUrl) {
                  const imgEl = item.querySelector('img');
                  if (imgEl) {
                    const rawSrcset = imgEl.getAttribute('srcset') || '';
                    coverImgUrl = rawSrcset ? rawSrcset.split(',')[0].trim().split(' ')[0] : (imgEl.currentSrc || imgEl.src || '');
                  }
                }

                const imgEl = item.querySelector('img');
                const captionText = imgEl ? (imgEl.alt || '') : '';
                const viewsCount = viewsEl ? viewsEl.innerText.trim() : '0';

                if (a && a.href) {
                  postsList.push({
                    url: a.href,
                    imageUrl: coverImgUrl,
                    caption: captionText,
                    viewsCount: viewsCount
                  });
                }
              });

              const titleEl = document.querySelector('[data-e2e="user-title"], h1');
              if (titleEl) nname = titleEl.innerText.trim();

              const avatarImg = document.querySelector('[data-e2e="user-avatar"] img, img[class*="Avatar"]');
              if (avatarImg) avtr = avatarImg.currentSrc || avatarImg.src || '';

              const folEl = document.querySelector('[data-e2e="following-count"]');
              if (folEl) fol = folEl.innerText.trim();

              const fansEl = document.querySelector('[data-e2e="followers-count"]');
              if (fansEl) fans = fansEl.innerText.trim();

              const likesEl = document.querySelector('[data-e2e="likes-count"]');
              if (likesEl) heart = likesEl.innerText.trim();

              const bioEl = document.querySelector('[data-e2e="user-bio"]');
              if (bioEl) bio = bioEl.innerText.trim();

              return {
                username: uname,
                nickname: nname,
                avatar: avtr,
                following: fol,
                followers: fans,
                likes: heart,
                bio: bio,
                posts: postsList
              };
            }).catch(() => null);

            let finalUsername = profileData?.username ? profileData.username.replace(/^@/, '').trim() : targetUser;
            let finalNickname = profileData?.nickname || finalUsername;
            let finalAvatar = profileData?.avatar || '';
            let followingCount = profileData?.following || '0';
            let followersCount = profileData?.followers || '0';
            let likesCount = profileData?.likes || '0';
            let biography = profileData?.bio || '';
            let posts = profileData?.posts || [];

            const cleanId = cleanUserIdentifier ? cleanUserIdentifier(finalUsername) : finalUsername;

            // 3. Auto-Fetch Produk Showcase Etalase TikTok Shop di Latar Belakang
            try {
              const showcaseProducts = await page.evaluate(async () => {
                try {
                  const endpoints = [
                    'https://shop.tiktok.com/api/streamer/product/list?page_size=30&page_num=1',
                    'https://creator.tiktokshop.com/api/v1/streamer/product/list?page_size=30&page_num=1',
                    'https://shop.tiktok.com/api/streamer/showcase/product/list?page_size=30&page_num=1'
                  ];

                  for (const ep of endpoints) {
                    try {
                      const res = await fetch(ep, { credentials: 'include' });
                      const json = await res.json();
                      const list = json?.data?.products || json?.data?.list || json?.data?.product_list || [];
                      if (Array.isArray(list) && list.length > 0) {
                        return list.map((item) => ({
                          id: String(item.product_id || item.id || item.pid || ''),
                          productId: String(item.product_id || item.id || item.pid || ''),
                          title: item.title || item.product_name || item.name || '',
                          product_title: item.title || item.product_name || item.name || '',
                          price: item.format_price || item.price_str || (item.price ? `Rp${Number(item.price).toLocaleString('id-ID')}` : '-'),
                          coverUrl: item.cover_url || item.image || item.main_img || '',
                          images: item.images || item.image_list || [],
                          commission: item.commission_format || item.commission_str || ''
                        }));
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
                return [];
              }).catch(() => []);

              if (Array.isArray(showcaseProducts) && showcaseProducts.length > 0) {
                const showcaseFile = path.resolve(SESSIONS_DIR, 'showcase_products.json');
                const showcaseAccountFile = af.writePath(path.resolve(SESSIONS_DIR, `showcase_products_${cleanId}.json`),
                  { platform: 'tiktok', username: finalUsername });
                fs.writeFileSync(showcaseFile, JSON.stringify({ success: true, data: showcaseProducts }, null, 2), 'utf-8');
                fs.writeFileSync(showcaseAccountFile, JSON.stringify({ success: true, data: showcaseProducts }, null, 2), 'utf-8');
              }
            } catch (showcaseErr) {
              console.warn('[AccountIpc] Auto-fetch showcase produk dilewati:', showcaseErr.message);
            }

            // Tutup Chrome
            await browser.close().catch(() => {});
            try { chromeProc.kill(); } catch (e) {}

            await new Promise((r) => setTimeout(r, 800));

            // Rename folder profil
            let finalProfileDir = profileDir;
            const targetNamedDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);

            if (profileDir !== targetNamedDir) {
              try {
                if (fs.existsSync(targetNamedDir)) {
                  fs.rmSync(targetNamedDir, { recursive: true, force: true });
                }
                // Chrome yang baru ditutup masih mengunci file profil beberapa detik → coba ulang (maks ~15 dtk)
                for (let i = 0; i < 15; i++) {
                  try { fs.renameSync(profileDir, targetNamedDir); break; } catch (e) {
                    if (i === 14) throw e;
                    await new Promise((r) => setTimeout(r, 1000));
                  }
                }
                finalProfileDir = targetNamedDir;
              } catch (err) {
                console.warn('[AccountIpc] Rename profileDir gagal, menggunakan direktori aktif:', err.message);
              }
            }

            const accountPayload = {
              id: cleanId,
              username: finalUsername,
              name: finalNickname,
              fullName: finalNickname,
              platform: 'tiktok',
              partition: `persist:tiktok_session_${cleanId}`,
              profileDir: finalProfileDir,
              profileFolder: path.basename(finalProfileDir),
              avatar: finalAvatar,
              profilePicUrl: finalAvatar,
              followingCount,
              followersCount,
              likesCount,
              biography,
              posts
            };

            if (typeof saveAccountSession === 'function') {
              saveAccountSession(accountPayload, cookies);
            }

            saveTikTokCachedProfile(cleanId, accountPayload);

            // Simpan Cookie TikTok & Sinkronkan langsung ke Sesi Streamer
            const ttHint = { platform: 'tiktok', username: finalUsername };
            const specificCookie = af.writePath(path.resolve(SESSIONS_DIR, `tiktokshop_cookies_${cleanId}.json`), ttHint);
            const defaultCookie = path.resolve(SESSIONS_DIR, 'tiktokshop_cookies.json');
            fs.writeFileSync(specificCookie, JSON.stringify(cookies, null, 2), 'utf-8');
            fs.writeFileSync(defaultCookie, JSON.stringify(cookies, null, 2), 'utf-8');

            // satu file streamer_cookies.json di folder akun (dulu ditulis dobel: per id & per username)
            const streamerCookieId = af.writePath(path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${cleanId}.json`), ttHint);
            const streamerCookieUser = af.writePath(path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${finalUsername}.json`), ttHint);
            const streamerCookieDefault = path.resolve(SESSIONS_DIR, 'tiktok_streamer_cookies.json');
            fs.writeFileSync(streamerCookieId, JSON.stringify(cookies, null, 2), 'utf-8');
            fs.writeFileSync(streamerCookieUser, JSON.stringify(cookies, null, 2), 'utf-8');
            fs.writeFileSync(streamerCookieDefault, JSON.stringify(cookies, null, 2), 'utf-8');

            if (typeof setActiveAccount === 'function') {
              setActiveAccount(cleanId);
            }

            const win = ctx.getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('accounts-updated');
              win.webContents.send('profile-updated', accountPayload);
              win.loadFile(path.join(__dirname, '../../renderer/dashboard.html'));
            }
          }
        } catch (e) {}
      }, 1000);
    })();

    return { success: true, port: cdpPort };
  }

  // =========================================================================
  // IPC HANDLERS
  // =========================================================================
  safeHandle('get-all-accounts', async () => {
    try {
      let reg = (typeof getAccountsRegistry === 'function') ? getAccountsRegistry() : null;
      if (!reg && fs.existsSync(ACCOUNTS_FILE)) {
        try {
          const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
          reg = Array.isArray(raw) ? { activeAccountId: raw[0]?.id || '', accounts: raw } : raw;
        } catch (e) {}
      }

      if (!reg || !Array.isArray(reg.accounts)) return { activeAccountId: '', accounts: [] };

      let hasRegistryUpdate = false;
      const updatedAccounts = reg.accounts.map((acc) => {
        const isTikTok = acc.platform === 'tiktok' || String(acc.id).startsWith('tt_') || String(acc.id).startsWith('tiktok_');
        if (isTikTok) {
          const cacheData = findTikTokProfileCache(acc.id, acc.username);
          if (cacheData) {
            const resolvedAvatar = cacheData.avatar || cacheData.profilePicUrl || cacheData.avatarUrl || cacheData.avatarThumb;
            if (resolvedAvatar && acc.avatar !== resolvedAvatar) {
              acc.avatar = resolvedAvatar;
              acc.profilePicUrl = resolvedAvatar;
              hasRegistryUpdate = true;
            }
            if (cacheData.fullName || cacheData.name) {
              acc.name = cacheData.name || cacheData.fullName || acc.name;
              acc.fullName = cacheData.fullName || cacheData.name || acc.fullName;
            }
            if (cacheData.biography && !acc.biography) {
              acc.biography = cacheData.biography;
              hasRegistryUpdate = true;
            }
            if (Array.isArray(cacheData.posts) && cacheData.posts.length > 0 && (!acc.posts || acc.posts.length === 0)) {
              acc.posts = cacheData.posts;
              hasRegistryUpdate = true;
            }
          }
        }
        return acc;
      });

      if (hasRegistryUpdate && fs.existsSync(ACCOUNTS_FILE)) {
        try {
          const toSave = Array.isArray(reg) ? updatedAccounts : { ...reg, accounts: updatedAccounts };
          fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
        } catch (err) {}
      }

      return {
        ...reg,
        accounts: updatedAccounts
      };
    } catch (err) {
      return { activeAccountId: '', accounts: [] };
    }
  });

  safeHandle('switch-active-account', async (event, accountId) => {
    try {
      const active = setActiveAccount(accountId);
      if (active) {
        if (active.partition) {
          setupPartitionHeaders(active.partition);
          await restoreSessionToPartition(active.partition);
        }

        const win = ctx.getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('accounts-updated');
          win.webContents.send('profile-updated');
        }
        return { success: true, activeAccount: active };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
    return { success: false };
  });

  ipcMain.on('add-new-tiktok-account', async () => {
    try {
      await openTikTokCdpLogin(null);
    } catch (err) {}
  });

  safeHandle('login-tiktok-account', async (event, uname) => {
    try {
      const res = await openTikTokCdpLogin(uname || null);
      return { success: true, message: `Chrome dibuka di Port ${res.port}. Silakan login.` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // =========================================================================
  // LOGIN INSTAGRAM: Chrome asli → pengguna login manual → cookie & profil disimpan
  // =========================================================================
  // =========================================================================
  // AKUN FACEBOOK (untuk login Instagram): tiap akun Facebook = 1 profil Chrome permanen.
  // Instagram menolak login dari browser baru, tetapi menerima "Log in with Facebook"
  // dari Chrome yang sudah login Facebook → Login Instagram memakai profil Chrome Facebook tsb.
  // =========================================================================
  const igSessionMod = () => require('../../platforms/instagram/sessionManager');
  const FB_PROFILES_DIR = () => path.resolve(igSessionMod().SESSIONS_DIR, 'facebook_profiles');
  const FB_ACCOUNTS_FILE = () => path.join(igSessionMod().SESSIONS_DIR, 'facebook_accounts.json');

  function loadFacebookAccounts() {
    try {
      const list = JSON.parse(fs.readFileSync(FB_ACCOUNTS_FILE(), 'utf-8'));
      return Array.isArray(list) ? list.filter((a) => a && a.id && a.profileDir && fs.existsSync(a.profileDir)) : [];
    } catch (e) { return []; }
  }
  function saveFacebookAccounts(list) {
    fs.writeFileSync(FB_ACCOUNTS_FILE(), JSON.stringify(list, null, 2), 'utf-8');
  }

  const notifyLogin = (msg) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('instagram-login-status', msg);
  };

  // Chrome biasa TANPA remote debugging (Meta menolak browser yang dikendalikan) → pengguna login & menutup Chrome
  // → profil yang sama dibuka ulang tersembunyi untuk membaca hasilnya lewat onRead(context, page).
  let chromeLoginRunning = false;
  function runChromeLogin({ profileDir, urls, onRead }) {
    if (chromeLoginRunning) return { success: false, error: 'Masih ada Chrome login yang terbuka. Selesaikan / tutup dulu.' };
    const chromePath = getOriginalChromeExecutablePath();
    if (!chromePath) return { success: false, error: 'Google Chrome asli tidak ditemukan di sistem.' };
    fs.mkdirSync(profileDir, { recursive: true });
    purgeTikTokSessionLocks(profileDir);

    const loginProc = spawn(chromePath, [
      `--user-data-dir=${profileDir}`,
      '--hide-crash-restore-bubble',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1080,820',
      '--window-position=80,60',
      ...urls
    ], { detached: false, stdio: 'ignore' });
    chromeLoginRunning = true;

    loginProc.on('exit', async () => {
      let browser = null;
      let readerProc = null;
      try {
        notifyLogin({ status: 'info', message: 'Chrome ditutup → memeriksa login...' });
        await new Promise((r) => setTimeout(r, 1500));
        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 59000 + Math.floor(Math.random() * 5000);
        readerProc = spawn(getOriginalChromeExecutablePath(), [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--hide-crash-restore-bubble',
          '--remote-allow-origins=*',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-position=-32000,-32000',
          '--window-size=1080,820',
          'about:blank'
        ], { detached: false, stdio: 'ignore' });
        for (let i = 0; i < 30 && !browser; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => null);
        }
        if (!browser) throw new Error('Tidak bisa membaca sesi Chrome.');
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();
        // closeReader: matikan Chrome pembaca (mis. sebelum folder profil dipindah)
        const closeReader = async () => {
          if (browser) await browser.close().catch(() => {});
          browser = null;
          try { readerProc && readerProc.kill(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 2500));
        };
        await onRead(context, page, closeReader);
      } catch (err) {
        console.warn('[Chrome Login] Gagal:', err.message);
        notifyLogin({ status: 'error', message: err.message });
      } finally {
        if (browser) await browser.close().catch(() => {});
        try { readerProc && readerProc.kill(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 800));
        chromeLoginRunning = false;
        const win = ctx.getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
      }
    });
    return { success: true };
  }

  // Facebook Page → akun posting (platform 'facebook') di registri akun
  function registerFacebookPages(fbId, pages = []) {
    if (!pages.length) return 0;
    const igSession = igSessionMod();
    const reg = igSession.getAccountsRegistry();
    for (const pg of pages) {
      const id = `fbpage_${pg.pageId}`;
      const entry = {
        id,
        platform: 'facebook',
        username: pg.name,
        name: pg.name,
        fullName: pg.name,
        pageId: pg.pageId,
        profileUrl: pg.profileUrl || '',
        facebookId: fbId,
        avatar: pg.avatar || '',
        profilePicUrl: pg.avatar || '',
        lastActive: new Date().toISOString()
      };
      const idx = reg.accounts.findIndex((a) => a.id === id);
      if (idx >= 0) reg.accounts[idx] = { ...reg.accounts[idx], ...entry };
      else reg.accounts.push(entry);
    }
    igSession.saveAccountsRegistry(reg);
    return pages.length;
  }

  async function withHiddenChrome(profileDir, fn) {
    const chromePath = getOriginalChromeExecutablePath();
    if (!chromePath) throw new Error('Google Chrome asli tidak ditemukan di sistem.');
    purgeTikTokSessionLocks(profileDir);
    const port = 59000 + Math.floor(Math.random() * 5000);
    const proc = spawn(chromePath, [
      `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--remote-allow-origins=*',
      '--hide-crash-restore-bubble', '--no-first-run', '--no-default-browser-check',
      '--window-position=-32000,-32000', '--window-size=1280,900', 'about:blank'
    ], { detached: false, stdio: 'ignore' });
    let browser = null;
    try {
      for (let i = 0; i < 30 && !browser; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      }
      if (!browser) throw new Error('Tidak bisa membuka Chrome Facebook.');
      const context = browser.contexts()[0];
      return await fn(context, context.pages()[0] || await context.newPage());
    } finally {
      if (browser) await browser.close().catch(() => {});
      try { proc.kill(); } catch (e) {}
    }
  }

  safeHandle('sync-facebook-pages', async (event, fbId) => {
    try {
      if (chromeLoginRunning) return { success: false, error: 'Selesaikan / tutup Chrome login dulu.' };
      const fb = loadFacebookAccounts().find((a) => a.id === fbId);
      if (!fb) return { success: false, error: 'Akun Facebook tidak ditemukan.' };
      const { readFacebookPages } = require('../../platforms/facebook/facebookPages');
      const pages = await withHiddenChrome(fb.profileDir, (context, page) => readFacebookPages(page));
      const n = registerFacebookPages(fb.id, pages);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
      return { success: true, count: n };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  function openFacebookLogin() {
    const tempDir = path.join(FB_PROFILES_DIR(), `fb_login_${Date.now()}`);
    const res = runChromeLogin({
      profileDir: tempDir,
      urls: ['https://www.facebook.com/login/'],
      onRead: async (context, page, closeReader) => {
        const cookies = await context.cookies(['https://www.facebook.com']);
        const uid = cookies.find((c) => c.name === 'c_user' && c.value)?.value;
        if (!uid || !cookies.some((c) => c.name === 'xs' && c.value)) {
          throw new Error('Belum login Facebook. Klik Login Facebook lagi, login sampai masuk beranda Facebook, lalu tutup Chrome.');
        }
        // Nama & foto profil dari halaman profil (nama = teks tepat sebelum baris "followers / teman")
        await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForSelector('[role="main"] svg image', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const prof = await page.evaluate(() => {
          const main = document.querySelector('[role="main"]') || document.body;
          const texts = Array.from(main.querySelectorAll('h1, h2, span[dir="auto"]')).map((e) => (e.innerText || '').trim()).filter(Boolean);
          const idx = texts.findIndex((t) => /(followers?|following|friends?|pengikut|mengikuti|teman)/i.test(t));
          const skip = /^(edit|share|bagikan|tambah|add|dashboard|edit cover photo|share a thought.*)$/i;
          let name = '';
          for (let i = (idx > 0 ? idx - 1 : -1); i >= 0; i--) {
            if (!skip.test(texts[i]) && texts[i].length <= 80) { name = texts[i]; break; }
          }
          const img = main.querySelector('svg image');
          return { name, pic: img ? (img.getAttribute('xlink:href') || img.getAttribute('href') || '') : '' };
        }).catch(() => ({ name: '', pic: '' }));
        const name = prof.name;
        let avatar = '';
        if (prof.pic) {
          try {
            const r = await fetch(prof.pic, { headers: { Referer: 'https://www.facebook.com/' } });
            if (r.ok) avatar = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
          } catch (e) {}
        }

        // Facebook Page yang dikelola akun ini (untuk posting Reels)
        const { readFacebookPages } = require('../../platforms/facebook/facebookPages');
        const fbPages = await readFacebookPages(page).catch(() => []);

        // Matikan Chrome pembaca dulu sebelum folder profil dipindah ke nama tetap
        await closeReader();
        const finalDir = path.join(FB_PROFILES_DIR(), `fb_${uid}`);
        let profileDir = tempDir;
        try {
          if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
          for (let i = 0; i < 15; i++) {
            try { fs.renameSync(tempDir, finalDir); profileDir = finalDir; break; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
          }
        } catch (e) {}

        const list = loadFacebookAccounts().filter((a) => a.id !== `fb_${uid}`);
        list.push({ id: `fb_${uid}`, uid, name: name || `Facebook ${uid}`, avatar, profileDir, platform: 'facebook', lastActive: new Date().toISOString() });
        saveFacebookAccounts(list);
        const nPages = registerFacebookPages(`fb_${uid}`, fbPages);
        notifyLogin({ status: 'success', message: `Akun Facebook ${name || uid} tersimpan${nPages ? ` + ${nPages} Page` : ''}. Sekarang bisa Login Instagram lewat Facebook${nPages ? ' & posting Reels ke Page' : ''}.` });
      }
    });
    if (!res.success) return res;
    notifyLogin({ status: 'info', message: 'Chrome terbuka: login Facebook sampai masuk beranda, lalu TUTUP Chrome.' });
    return res;
  }

  // Login Instagram memakai profil Chrome akun Facebook: tombol "Log in with Facebook" diklik otomatis,
  // aplikasi menunggu sampai masuk, lalu mengambil profil lengkap & menutup Chrome sendiri.
  function openInstagramLogin(fbId) {
    const fbList = loadFacebookAccounts();
    const fb = fbList.find((a) => a.id === fbId) || (fbList.length === 1 ? fbList[0] : null);
    if (!fb) return { success: false, error: fbList.length ? 'Pilih akun Facebook untuk login Instagram.' : 'Login Facebook dulu sebelum login Instagram.' };
    if (chromeLoginRunning) return { success: false, error: 'Masih ada Chrome login yang terbuka. Selesaikan / tutup dulu.' };
    const chromePath = getOriginalChromeExecutablePath();
    if (!chromePath) return { success: false, error: 'Google Chrome asli tidak ditemukan di sistem.' };

    purgeTikTokSessionLocks(fb.profileDir);
    const cdpPort = 59000 + Math.floor(Math.random() * 5000);
    const chromeProc = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${fb.profileDir}`,
      '--remote-allow-origins=*',
      '--hide-crash-restore-bubble',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1080,820',
      '--window-position=80,60',
      'https://www.instagram.com/accounts/login/'
    ], { detached: false, stdio: 'ignore' });
    chromeLoginRunning = true;
    let chromeClosed = false;
    chromeProc.on('exit', () => { chromeClosed = true; });
    notifyLogin({ status: 'info', message: `Login Instagram lewat Facebook (${fb.name})... tombol "Log in with Facebook" diklik otomatis.` });

    (async () => {
      let browser = null;
      try {
        for (let i = 0; i < 30 && !browser && !chromeClosed; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => null);
        }
        if (!browser) throw new Error('Tidak bisa terhubung ke Chrome.');
        const context = browser.contexts()[0];

        // Klik tombol login Facebook / "Lanjutkan sebagai ..." di halaman Instagram & dialog Facebook
        const FB_BTN = /(log ?in with facebook|continue with facebook|masuk dengan facebook|lanjutkan dengan facebook|continue as|lanjutkan sebagai|masuk sebagai)/i;
        const clickFacebookButton = async () => {
          for (const pg of context.pages()) {
            const url = pg.url();
            if (!/instagram\.com\/accounts\/login|facebook\.com\/(dialog|login|v\d|privacy)/.test(url)) continue;
            const clicked = await pg.evaluate((src) => {
              const re = new RegExp(src, 'i');
              const els = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], input[type="submit"]'));
              const el = els.find((e) => re.test((e.innerText || e.value || e.getAttribute('aria-label') || '').trim()) && e.offsetParent !== null);
              if (!el) return false;
              el.click();
              return true;
            }, FB_BTN.source).catch(() => false);
            if (clicked) return true;
          }
          return false;
        };

        const deadline = Date.now() + 10 * 60 * 1000;
        let lastClick = 0;
        let loggedIn = false;
        while (!chromeClosed && Date.now() < deadline) {
          const ck = await context.cookies(['https://www.instagram.com']).catch(() => []);
          if (ck.some((c) => c.name === 'sessionid' && c.value)) { loggedIn = true; break; }
          if (Date.now() - lastClick > 4000 && await clickFacebookButton()) lastClick = Date.now();
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (chromeClosed) { notifyLogin({ status: 'cancelled', message: 'Chrome ditutup sebelum login Instagram selesai.' }); return; }
        if (!loggedIn) throw new Error('Waktu login Instagram habis (10 menit).');

        notifyLogin({ status: 'info', message: 'Login Instagram berhasil → mengambil data profil...' });
        await new Promise((r) => setTimeout(r, 3000));
        const page = context.pages().find((p) => /instagram\.com/.test(p.url())) || context.pages()[0] || await context.newPage();
        const { fetchProfileInPage } = require('../../platforms/instagram/igProfileFetcher');
        const profile = await fetchProfileInPage(page).catch(() => null);

        const raw = await context.cookies(['https://www.instagram.com', 'https://i.instagram.com']);
        const cookies = raw.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || 'None',
          ...(c.expires > 0 ? { expirationDate: c.expires, expires: c.expires } : {})
        }));
        const saved = await saveInstagramFromCookies(cookies, { facebookId: fb.id, ...(profile ? { profile } : {}) });
        if (!saved.success) throw new Error(saved.error);

        // Lepas sesi Instagram dari profil (Facebook tetap login) → bisa menambah akun Instagram lain
        try {
          await context.clearCookies({ name: 'sessionid', domain: '.instagram.com' });
          await context.clearCookies({ name: 'ds_user_id', domain: '.instagram.com' });
        } catch (e) {}
        await browser.close().catch(() => {});
        browser = null;
        try { chromeProc.kill(); } catch (e) {}

        notifyLogin({ status: 'success', message: `Akun Instagram @${saved.username} berhasil terhubung.` });
        const win = ctx.getMainWindow();
        if (win && !win.isDestroyed()) setTimeout(() => win.loadFile(path.join(__dirname, '../../renderer/dashboard.html')), 1200);
      } catch (err) {
        console.warn('[Instagram Login] Gagal:', err.message);
        notifyLogin({ status: 'error', message: `Login Instagram gagal: ${err.message}` });
      } finally {
        if (browser) await browser.close().catch(() => {});
        chromeLoginRunning = false;
        const win = ctx.getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
      }
    })();
    return { success: true };
  }

  // =========================================================================
  // AKUN SHOPEE (untuk posting Shopee Video): tiap akun = 1 profil Chrome permanen.
  // Login manual di Chrome biasa (QR / OTP / sandi) → tutup Chrome → sesi & profil dibaca.
  // =========================================================================
  const SHOPEE_PROFILES_DIR = () => path.resolve(igSessionMod().SESSIONS_DIR, 'shopee_profiles');

  async function readShopeeAccount(context, page) {
    const cookies = await context.cookies(['https://shopee.co.id']);
    const uid = cookies.find((c) => c.name === 'SPC_U' && c.value && c.value !== '-')?.value;
    if (!uid) return null;
    await page.goto('https://shopee.co.id/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const info = await page.evaluate(async () => {
      const tryGet = async (url) => {
        try {
          const r = await fetch(url, { credentials: 'include', headers: { 'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest' } });
          const j = await r.json();
          return j?.data || j || null;
        } catch (e) { return null; }
      };
      const a = await tryGet('/api/v4/account/basic/get_account_info');
      if (a && (a.username || a.userid)) return a;
      return await tryGet('/api/v2/user/account_info');
    }).catch(() => null);
    const username = String(info?.username || '').trim();
    const name = String(info?.nickname || info?.name || username || '').trim();
    let avatar = '';
    if (info?.portrait) {
      try {
        const r = await fetch(`https://down-id.img.susercontent.com/file/${info.portrait}`);
        if (r.ok) avatar = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      } catch (e) {}
    }
    return { uid: String(uid), username: username || `shopee_${uid}`, name: name || username || `Shopee ${uid}`, avatar };
  }

  function openShopeeLogin() {
    const tempDir = path.join(SHOPEE_PROFILES_DIR(), `shp_login_${Date.now()}`);
    const res = runChromeLogin({
      profileDir: tempDir,
      urls: ['https://shopee.co.id/buyer/login'],
      onRead: async (context, page, closeReader) => {
        const acc = await readShopeeAccount(context, page);
        if (!acc) throw new Error('Belum login Shopee. Klik Login Shopee lagi, login sampai masuk beranda Shopee, lalu tutup Chrome.');
        await closeReader();
        const finalDir = path.join(SHOPEE_PROFILES_DIR(), `shp_${acc.uid}`);
        let profileDir = tempDir;
        try {
          if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
          for (let i = 0; i < 15; i++) {
            try { fs.renameSync(tempDir, finalDir); profileDir = finalDir; break; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
          }
        } catch (e) {}
        const igSession = igSessionMod();
        const reg = igSession.getAccountsRegistry();
        const id = `shopee_${acc.uid}`;
        const entry = {
          id, platform: 'shopee', username: acc.username, name: acc.name, fullName: acc.name,
          shopeeUserId: acc.uid, profileDir, avatar: acc.avatar, profilePicUrl: acc.avatar,
          lastActive: new Date().toISOString()
        };
        const idx = reg.accounts.findIndex((a) => a.id === id);
        if (idx >= 0) reg.accounts[idx] = { ...reg.accounts[idx], ...entry };
        else reg.accounts.push(entry);
        if (!reg.activeAccountId) reg.activeAccountId = id;
        igSession.saveAccountsRegistry(reg);
        notifyLogin({ status: 'success', message: `Akun Shopee @${acc.username} tersimpan.` });
      }
    });
    if (!res.success) return res;
    notifyLogin({ status: 'info', message: 'Chrome terbuka: login Shopee sampai masuk beranda Shopee, lalu TUTUP Chrome.' });
    return res;
  }

  safeHandle('login-shopee-account', async () => {
    try { return openShopeeLogin(); } catch (e) { return { success: false, error: e.message }; }
  });

  // --- Shopee posting via HP Android (ADB + Tap-Server) ---
  const shopeeAdb = () => require('../../platforms/shopee/shopeeAdbUploader');
  function tapperApkPath() {
    const cands = [
      path.resolve(__dirname, '../../../tools/tapper/tapper.apk'),
      process.resourcesPath ? path.join(process.resourcesPath, 'tapper.apk') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'tools/tapper/tapper.apk') : null
    ].filter(Boolean);
    return cands.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
  }

  safeHandle('shopee-adb-status', async () => {
    try {
      const m = shopeeAdb();
      const saved = m.loadHpConfig();
      const device = await m.ensureConnected();   // USB, atau sambung ulang WiFi (pindai jika IP berubah)
      if (!device) return { connected: false, savedIp: saved.ip || '' };
      const [shopee, tapper, tapperState, screen] = await Promise.all([
        m.hasShopee(device), m.hasTapper(device), m.tapperState(device), m.getScreenSize(device)
      ]);
      if (tapper) await m.whitelistTapperBattery(device);   // cegah dimatikan penghemat baterai
      const enabled = tapperState === 'ok';
      const info = m.isTap(device) ? ((await m.tap.info(device)) || {}) : ((await m.listDevices()).find((d) => d.serial === device) || {});
      const via = m.isTap(device) ? 'tap' : (m.isWifiSerial(device) ? 'wifi' : 'usb');
      return { connected: true, device, via, model: info.model || saved.model || '', shopee, tapper, enabled, tapperState, screen,
        savedIp: m.loadHpConfig().ip || '' };
    } catch (e) { return { connected: false, error: e.message }; }
  });

  // --- Unduh Tap Server ke HP lewat WiFi: PC menyajikan APK di jaringan lokal + QR link ---
  let apkServer = null;
  let apkServerPort = 0;
  safeHandle('shopee-tap-apk-link', async () => {
    try {
      const apk = tapperApkPath();
      if (!apk) return { success: false, error: 'File tapper.apk tidak ditemukan.' };
      const http = require('http');
      if (!apkServer) {
        apkServer = http.createServer((req, res) => {
          if (!/^\/tapper\.apk(\?|$)/.test(req.url || '')) { res.writeHead(404); return res.end('Not found'); }
          const st = fs.statSync(apk);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': st.size,
            'Content-Disposition': 'attachment; filename="TapServer.apk"'
          });
          fs.createReadStream(apk).pipe(res);
        });
        for (const p of [8790, 8791, 8792, 0]) {
          const ok = await new Promise((resolve) => {
            apkServer.once('error', () => resolve(false));
            apkServer.listen(p, '0.0.0.0', () => resolve(true));
          });
          if (ok) { apkServerPort = apkServer.address().port; break; }
        }
      }
      const ips = [];
      for (const list of Object.values(require('os').networkInterfaces())) {
        for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal && /^(10|172|192)\./.test(ni.address)) ips.push(ni.address);
      }
      const localUrl = ips.length ? `http://${ips.find((x) => x.startsWith('192.168.')) || ips[0]}:${apkServerPort}/tapper.apk` : '';
      // Utama: unduh dari server publik (tidak terhalang firewall PC / WiFi pembeli).
      // ?v=<sidik APK> → tiap APK baru dapat link baru (hindari cache Cloudflare yang basi).
      const ver = require('crypto').createHash('sha1').update(fs.readFileSync(apk)).digest('hex').slice(0, 10);
      const url = `https://license.etnicstore.com/updates/tapper.apk?v=${ver}`;
      const qr = require('qrcode-generator')(0, 'M');
      qr.addData(url);
      qr.make();
      return { success: true, url, localUrl, svg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // --- HP tanpa kabel lewat TAP SERVER (tanpa ADB / Opsi pengembang) ---
  safeHandle('shopee-tap-discover', async () => {
    try {
      const found = await shopeeAdb().tap.discover((message) => notifyLogin({ status: 'info', message }));
      const saved = require('../../platforms/shopee/phoneStore').loadPhones();
      return { success: true, phones: found.map((f) => ({ ...f, paired: !!(saved[f.deviceId] && saved[f.deviceId].token) })) };
    } catch (e) { return { success: false, error: e.message, phones: [] }; }
  });
  safeHandle('shopee-tap-pair-code', async (event, code, addr) => {
    try { return { success: true, ...(await shopeeAdb().tap.pairByCode(code, (message) => notifyLogin({ status: 'info', message }), addr)) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  safeHandle('shopee-tap-pair', async (event, ip, port, code) => {
    try { return { success: true, ...(await shopeeAdb().tap.pair(ip, port, code)) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // --- HP tanpa kabel: Debugging nirkabel Android 11+ (pairing QR / kode 6 digit) ---
  let wifiPairing = null;   // { name, password, cancelled }
  safeHandle('shopee-wifi-pair-start', async () => {
    try {
      const m = shopeeAdb();
      if (wifiPairing) wifiPairing.cancelled = true;
      wifiPairing = { ...m.newQrPairing(), cancelled: false };
      const qrgen = require('qrcode-generator');
      const qr = qrgen(0, 'M');
      qr.addData(wifiPairing.qrText);
      qr.make();
      return { success: true, svg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }), name: wifiPairing.name };
    } catch (e) { return { success: false, error: e.message }; }
  });
  safeHandle('shopee-wifi-pair-wait', async () => {
    const pending = wifiPairing;
    if (!pending) return { success: false, error: 'Kode QR belum dibuat.' };
    try {
      const r = await shopeeAdb().waitQrPairing(pending, (message) => notifyLogin({ status: 'info', message }), 180000, () => pending.cancelled);
      return { success: true, ...r };
    } catch (e) { return { success: false, error: e.message, cancelled: pending.cancelled }; }
  });
  safeHandle('shopee-wifi-pair-cancel', async () => {
    if (wifiPairing) wifiPairing.cancelled = true;
    return { success: true };
  });
  safeHandle('shopee-wifi-pair-code', async (event, hostPort, code) => {
    try { return { success: true, ...(await shopeeAdb().pairWithCode(hostPort, code, (message) => notifyLogin({ status: 'info', message }))) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Hubungkan HP Shopee (pengganti login Chrome): akun dibaca LANGSUNG dari app Shopee di HP,
  // jadi akun yang tampil = akun yang memposting. 1 HP = 1 akun (dikenali nomor seri HP).
  // Return { ok, step, message, account? }  step: usb | shopee | tapper-install | tapper-enable | done
  // ---- Profil Shopee dibaca dari HP (beranda kreator) ----
  const shopeeShotDir = (prof) => af.accountDir({ platform: 'shopee', username: prof.username }, true);
  function shopeeProfileFields(acc) {
    const m = shopeeAdb();
    const out = {
      biography: acc.bio || '',
      followingCount: m.parseCount(acc.following),
      followersCount: m.parseCount(acc.followers),
      likesCount: m.parseCount(acc.likes),
      profileReadAt: new Date().toISOString()
    };
    if (acc.avatarFile && fs.existsSync(acc.avatarFile)) {
      const dataUrl = `data:image/png;base64,${fs.readFileSync(acc.avatarFile).toString('base64')}`;
      out.avatar = dataUrl; out.profilePicUrl = dataUrl;
    }
    if (Array.isArray(acc.videos)) {
      out.posts = acc.videos.map((v, i) => ({ id: `shopee_${i}`, coverLocal: v.coverFile || '', views: m.parseCount(v.views), viewsText: v.views }));
    }
    return out;
  }
  async function refreshShopeeFromPhone(active) {
    const m = shopeeAdb();
    const progress = (message) => notifyLogin({ status: 'info', message });
    if (!active.shopeeSerialNo) throw new Error('Akun ini belum ditautkan ke HP. Hubungkan HP Shopee dulu.');
    const device = await m.ensureConnected(active.shopeeSerialNo, progress);
    if (!device) throw new Error('HP akun ini tidak terhubung. Pastikan HP menyala, di WiFi yang sama, dan Tap Server aktif.');
    progress('Membaca profil Shopee dari HP (±30 detik)...');
    const acc = await m.readShopeeAccount(device, progress, { shotDir: shopeeShotDir });
    await m.screenOff(device).catch(() => {});
    if (String(acc.username).toLowerCase() !== String(active.username).toLowerCase()) {
      throw new Error(`HP sedang login sebagai @${acc.username}, bukan @${active.username}.`);
    }
    const igSession = igSessionMod();
    const reg = igSession.getAccountsRegistry();
    const idx = reg.accounts.findIndex((a) => a.id === active.id);
    if (idx < 0) throw new Error('Akun tidak ditemukan.');
    reg.accounts[idx] = { ...reg.accounts[idx], name: acc.name || reg.accounts[idx].name, fullName: acc.name || reg.accounts[idx].fullName, followers: acc.followers || '', ...shopeeProfileFields(acc) };
    igSession.saveAccountsRegistry(reg);
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
    return reg.accounts[idx];
  }
  const shopeeSessionInfo = (a) => ({
    isLoggedIn: a.connectMethod === 'hp' ? Boolean(a.shopeeSerialNo) : Boolean(a.profileDir && fs.existsSync(a.profileDir)),
    activeAccountId: a.id, platform: 'shopee', username: a.username,
    fullName: a.name || a.username, name: a.name || a.username,
    category: 'SHOPEE VIDEO',
    biography: a.biography || '',
    avatar: a.avatar || '', profilePicUrl: a.avatar || '',
    followersCount: a.followersCount || 0, followingCount: a.followingCount || 0, likesCount: a.likesCount || 0,
    phoneModel: a.phoneModel || '', profileReadAt: a.profileReadAt || '',
    postsCount: (a.posts || []).length, posts: a.posts || []
  });

  safeHandle('shopee-hp-connect', async () => {
    const m = shopeeAdb();
    const progress = (message) => notifyLogin({ status: 'info', message });
    try {
      const device = await m.ensureConnected('', progress);
      if (!device) return { ok: false, step: 'usb', message: 'HP belum terhubung. Pilih "Lewat WiFi" → Cari HP → masukkan kode dari Tap Server. (Atau "Lewat kabel USB".)' };
      if (!(await m.hasShopee(device))) return { ok: false, step: 'shopee', message: 'App Shopee belum terpasang di HP. Pasang dari Play Store & login dulu.' };
      if (!(await m.hasTapper(device))) {
        const apk = tapperApkPath();
        if (apk) await m.runAdb(`push "${apk}" "/sdcard/Download/tapper.apk"`, device).catch(() => {});
        return { ok: false, step: 'tapper-install', message: 'Di HP: File Manager → Download → tapper.apk → Pasang. Lalu klik "Cek Lagi".' };
      }
      const st = await m.tapperState(device);
      await m.whitelistTapperBattery(device);
      if (st !== 'ok') {
        return { ok: false, step: 'tapper-enable', message: 'Di HP: buka ikon Tap Server → "Buka Aksesibilitas" → aktifkan Tap Server. Lalu klik "Cek Lagi".' };
      }
      // tersambung lewat USB → aktifkan WiFi sekalian (supaya kabel boleh dicabut)
      let serialNo = await m.getSerialNo(device);
      let model = m.isTap(device)
        ? ((await m.tap.info(device)) || {}).model || ''
        : ((await m.listDevices()).find((d) => d.serial === device) || {}).model || '';
      let wifiNote = '';
      if (!m.isWifiSerial(device) && !m.isTap(device)) {
        try { const w = await m.enableWifi(progress, device); wifiNote = ` WiFi aktif (${w.ip}) — kabel boleh dicabut.`; }
        catch (e) { wifiNote = ' (WiFi belum aktif: tetap pakai kabel USB.)'; }
      }
      progress('Membaca akun Shopee dari HP (±30 detik)...');
      const acc = await m.readShopeeAccount(device, progress, { shotDir: shopeeShotDir });
      m.savePhone(serialNo, { model, username: acc.username });

      const igSession = igSessionMod();
      const reg = igSession.getAccountsRegistry();
      const same = (a) => a.platform === 'shopee' && String(a.username || '').toLowerCase() === acc.username.toLowerCase();
      const idx = reg.accounts.findIndex(same);
      const entry = {
        platform: 'shopee', username: acc.username, name: acc.name || acc.username, fullName: acc.name || acc.username,
        followers: acc.followers || '', shopeeSerialNo: serialNo, phoneModel: model, connectMethod: 'hp',
        lastActive: new Date().toISOString(),
        ...shopeeProfileFields(acc)
      };
      // akun lain yang dulu memakai HP ini → lepas tautan HP-nya (1 HP = 1 akun)
      reg.accounts.forEach((a) => { if (a.platform === 'shopee' && a.shopeeSerialNo === serialNo && !same(a)) a.shopeeSerialNo = ''; });
      let id;
      if (idx >= 0) { id = reg.accounts[idx].id; reg.accounts[idx] = { ...reg.accounts[idx], ...entry }; }
      else { id = `shopee_${acc.username}`; reg.accounts.push({ id, avatar: '', profilePicUrl: '', ...entry }); }
      if (!reg.activeAccountId) reg.activeAccountId = id;
      igSession.saveAccountsRegistry(reg);
      notifyLogin({ status: 'success', message: `Akun Shopee @${acc.username} terhubung lewat HP ${model}.${wifiNote}` });
      return { ok: true, step: 'done', message: `@${acc.username} terhubung.${wifiNote}`, account: { id, ...entry } };
    } catch (e) {
      return { ok: false, step: 'error', message: e.message };
    }
  });

  safeHandle('shopee-adb-enable-wifi', async () => {
    try { return { success: true, ...(await shopeeAdb().enableWifi()) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  safeHandle('shopee-adb-install-tapper', async () => {
    try {
      const m = shopeeAdb();
      const device = await m.getConnectedDevice();
      if (!device) return { success: false, error: 'HP tidak terhubung.' };
      const apk = tapperApkPath();
      if (!apk) return { success: false, error: 'File tapper.apk tidak ditemukan.' };
      await m.runAdb(`push "${apk}" "/sdcard/Download/tapper.apk"`, device);
      return { success: true, remote: '/sdcard/Download/tapper.apk',
        message: 'APK terkirim. Di HP: File Manager > Download > tapper.apk > Pasang. Lalu aktifkan di Setelan > Aksesibilitas > Tap Server.' };
    } catch (e) { return { success: false, error: e.message }; }
  });

  safeHandle('shopee-adb-pair', async (event, hostPort, code) => {
    try { return { success: true, out: await shopeeAdb().pairWifi(hostPort, code) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  safeHandle('shopee-adb-connect', async (event, hostPort) => {
    try { return { success: true, out: await shopeeAdb().connectWifi(hostPort) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  safeHandle('get-facebook-accounts', async () => loadFacebookAccounts().map(({ id, uid, name, avatar, lastActive }) => ({ id, uid, name, avatar, lastActive })));
  safeHandle('login-facebook-account', async () => {
    try { return openFacebookLogin(); } catch (e) { return { success: false, error: e.message }; }
  });
  safeHandle('delete-facebook-account', async (event, id) => {
    const list = loadFacebookAccounts();
    const target = list.find((a) => a.id === id);
    if (!target) return { success: false, error: 'Akun Facebook tidak ditemukan.' };
    saveFacebookAccounts(list.filter((a) => a.id !== id));
    try { fs.rmSync(target.profileDir, { recursive: true, force: true }); } catch (e) {}
    try {
      const igSession = igSessionMod();
      const reg = igSession.getAccountsRegistry();
      reg.accounts = reg.accounts.filter((a) => !(a.platform === 'facebook' && a.facebookId === id));
      if (!reg.accounts.some((a) => a.id === reg.activeAccountId)) reg.activeAccountId = reg.accounts[0]?.id || '';
      igSession.saveAccountsRegistry(reg);
    } catch (e) {}
    return { success: true };
  });

  safeHandle('login-instagram-account', async (event, fbId) => {
    try {
      return openInstagramLogin(fbId);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  // =========================================================================
  // IMPOR SESI INSTAGRAM (untuk akun yang tidak bisa login dari browser baru):
  // cookie dari Chrome yang sudah login (ekstensi Cookie-Editor → Export JSON / header cookie)
  // =========================================================================
  function parseInstagramCookies(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const sameSiteOf = (v) => {
      const s = String(v || '').toLowerCase();
      if (s === 'no_restriction' || s === 'none') return 'None';
      if (s.includes('strict')) return 'Strict';
      if (s.includes('lax')) return 'Lax';
      return 'None';
    };
    const norm = (c) => {
      const exp = Number(c.expirationDate || c.expires || c.expiry || 0);
      return {
        name: String(c.name || '').trim(),
        value: String(c.value ?? ''),
        domain: c.domain ? (String(c.domain).startsWith('.') ? c.domain : `.${String(c.domain).replace(/^www\./, '')}`) : '.instagram.com',
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: Boolean(c.httpOnly),
        sameSite: sameSiteOf(c.sameSite),
        ...(exp > 0 ? { expirationDate: exp, expires: exp } : {})
      };
    };
    // 1. JSON (Cookie-Editor / EditThisCookie)
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
        return list.filter((c) => c && c.name).map(norm).filter((c) => /instagram\.com$/.test(c.domain.replace(/^\./, '')));
      } catch (e) {
        throw new Error('Format JSON cookie tidak valid.');
      }
    }
    // 2. Format Netscape (cookies.txt)
    if (raw.split('\n').some((l) => l.split('\t').length >= 7)) {
      return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'))
        .filter((p) => p.length >= 7 && /instagram\.com/.test(p[0]))
        .map((p) => norm({ domain: p[0], path: p[2], secure: p[3] === 'TRUE', expirationDate: Number(p[4]), name: p[5], value: p[6] }));
    }
    // 3. Header cookie "name=value; name2=value2"
    return raw.replace(/^cookie:\s*/i, '').split(';').map((s) => s.trim()).filter((s) => s.includes('='))
      .map((s) => { const i = s.indexOf('='); return norm({ name: s.slice(0, i), value: s.slice(i + 1), expirationDate: Math.floor(Date.now() / 1000) + 180 * 24 * 3600 }); });
  }

  // Cookie Instagram → profil lengkap (dari halaman profil) → simpan akun, cache profil & jadikan aktif
  async function saveInstagramFromCookies(cookies, extra = {}) {
    try {
      const igSession = require('../../platforms/instagram/sessionManager');
      const { fetchInstagramProfileWithCookies } = require('../../platforms/instagram/igProfileFetcher');
      const sessionId = cookies.find((c) => c.name === 'sessionid' && c.value);
      const dsUserId = cookies.find((c) => c.name === 'ds_user_id' && c.value)?.value || (sessionId ? decodeURIComponent(sessionId.value).split(':')[0] : '');
      if (!sessionId) return { success: false, error: 'Cookie "sessionid" Instagram tidak ditemukan. Silakan login ulang.' };
      if (!cookies.some((c) => c.name === 'ds_user_id') && dsUserId) {
        cookies.push({ name: 'ds_user_id', value: dsUserId, domain: '.instagram.com', path: '/', secure: true, httpOnly: false, sameSite: 'None', expirationDate: sessionId.expirationDate, expires: sessionId.expirationDate });
      }

      const { profile: givenProfile, ...entryExtra } = extra;
      const profile = givenProfile || await fetchInstagramProfileWithCookies(cookies, getOriginalChromeExecutablePath());
      const reg = igSession.getAccountsRegistry();
      const prev = reg.accounts.find((a) => a.platform === 'instagram' && a.dsUserId && a.dsUserId === dsUserId);
      const username = profile?.username || prev?.username || `ig_${dsUserId}`;
      const cleanIg = String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      const igId = `ig_${cleanIg}`;

      const sessionFile = af.writePath(path.join(igSession.SESSIONS_DIR, `instagram_${cleanIg}.json`), { platform: 'instagram', username });
      fs.writeFileSync(sessionFile, JSON.stringify(cookies, null, 2), 'utf-8');

      const avatar = profile?.avatar || prev?.avatar || '';
      const entry = {
        id: igId,
        username,
        platform: 'instagram',
        dsUserId,
        name: profile?.fullName || prev?.name || username,
        fullName: profile?.fullName || prev?.fullName || '',
        avatar,
        profilePicUrl: avatar,
        followersCount: profile?.followersCount ?? prev?.followersCount ?? 0,
        followingCount: profile?.followingCount ?? prev?.followingCount ?? 0,
        postsCount: profile?.postsCount ?? prev?.postsCount ?? 0,
        biography: profile?.biography ?? prev?.biography ?? '',
        externalUrl: profile?.externalUrl ?? prev?.externalUrl ?? '',
        sessionFile,
        ...(prev?.facebookId ? { facebookId: prev.facebookId } : {}),
        ...entryExtra,
        partition: `persist:ig_session_${cleanIg}`,
        lastActive: new Date().toISOString()
      };

      // Hapus entri lama akun yang sama (mis. tersimpan sebagai ig_<angka> karena profil gagal terbaca)
      reg.accounts
        .filter((a) => a.platform === 'instagram' && a.id !== igId && (a.dsUserId === dsUserId || a.username === `ig_${dsUserId}`))
        .forEach((a) => { try { if (a.sessionFile && a.sessionFile !== sessionFile) fs.unlinkSync(a.sessionFile); } catch (e) {} });
      reg.accounts = reg.accounts.filter((a) => !(a.platform === 'instagram' && a.id !== igId && (a.dsUserId === dsUserId || a.username === `ig_${dsUserId}`)));
      const idx = reg.accounts.findIndex((a) => a.id === igId);
      if (idx >= 0) reg.accounts[idx] = { ...reg.accounts[idx], ...entry };
      else reg.accounts.push(entry);
      reg.activeAccountId = igId;
      igSession.saveAccountsRegistry(reg);

      // Cache profil untuk halaman "Profil & Postingan"
      if (profile) {
        try {
          fs.writeFileSync(af.writePath(path.join(igSession.SESSIONS_DIR, `profile_cache_${cleanIg}.json`), { platform: 'instagram', username }), JSON.stringify({
            username,
            fullName: entry.fullName || username,
            category: profile.category || 'AKUN BISNIS / KREATOR',
            biography: entry.biography,
            externalUrl: entry.externalUrl,
            postsCount: entry.postsCount,
            followersCount: entry.followersCount,
            followingCount: entry.followingCount,
            profilePicUrl: avatar,
            posts: profile.posts || [],
            updatedAt: new Date().toISOString()
          }, null, 2), 'utf-8');
        } catch (e) {}
      }

      const acc = setActiveAccount(igId);
      if (acc?.partition) {
        setupPartitionHeaders(acc.partition);
        await restoreSessionToPartition(acc.partition).catch(() => {});
      }
      return { success: true, username, verified: Boolean(profile) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  safeHandle('import-instagram-session', async (event, text) => {
    try {
      return await saveInstagramFromCookies(parseInstagramCookies(text));
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Tombol lama (halaman Pilih Platform & login.html)
  ipcMain.on('add-new-account', () => { try { openInstagramLogin(); } catch (e) {} });
  ipcMain.on('trigger-login', () => { try { openInstagramLogin(); } catch (e) {} });

  safeHandle('delete-account', async (event, accountId) => {
    try {
      const { removeAccount, getAccountsRegistry: regOf } = require('../../platforms/instagram/sessionManager');
      const target = (regOf().accounts || []).find((x) => x.id === accountId);
      if (typeof removeAccount === 'function') removeAccount(accountId);
      // Akun Shopee: hapus juga profil Chrome-nya
      if (target && target.platform === 'shopee' && target.profileDir && target.profileDir.startsWith(SHOPEE_PROFILES_DIR())) {
        try { fs.rmSync(target.profileDir, { recursive: true, force: true }); } catch (e) {}
      }
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('get-session-info', async () => {
    const active = getActiveAccount();
    const cookies = (active?.platform === 'instagram' ? require('../../platforms/instagram/sessionManager').loadInstagramSession(active.id) : null)
      || loadSessionFromFile(active?.username || active?.id);

    if (active?.platform === 'tiktok') {
      const hasSession = cookies && cookies.some((c) => c.name === 'sessionid' || c.name === 'sid_tt' || c.name === 'sessionid_ss');
      let cached = findTikTokProfileCache(active.id, active.username);

      const resolvedUsername = cached?.username || active.username || '';
      const resolvedName = cached?.name || cached?.fullName || active.name || active.fullName || resolvedUsername || 'Pengguna TikTok';

      return {
        isLoggedIn: Boolean(hasSession),
        userId: active.id || 'tiktok_user',
        activeAccountId: active.id || '',
        platform: 'tiktok',
        username: resolvedUsername,
        fullName: resolvedName,
        avatar: cached?.avatar || cached?.profilePicUrl || active.avatar || active.profilePicUrl || '',
        profilePicUrl: cached?.avatar || cached?.profilePicUrl || active.avatar || active.profilePicUrl || '',
        followingCount: cached?.followingCount ?? active.followingCount ?? 0,
        followersCount: cached?.followersCount ?? active.followersCount ?? 0,
        likesCount: cached?.likesCount ?? active.likesCount ?? 0,
        biography: cached?.biography || active.biography || '',
        postsCount: cached?.posts?.length ?? active.posts?.length ?? 0,
        posts: cached?.posts || active.posts || []
      };
    }

    if (active?.platform === 'shopee') return shopeeSessionInfo(active);
    if (active?.platform === 'facebook') {
      const fb = loadFacebookAccounts().find((a) => a.id === active.facebookId);
      return {
        isLoggedIn: Boolean(fb),
        activeAccountId: active.id,
        platform: 'facebook',
        username: active.username,
        fullName: active.name || active.username,
        category: 'FACEBOOK PAGE',
        biography: fb ? `Dikelola oleh ${fb.name}` : 'Akun Facebook pengelola tidak ditemukan — login Facebook ulang.',
        avatar: active.avatar || '',
        profilePicUrl: active.avatar || '',
        externalUrl: active.profileUrl || '',
        followersCount: active.followersCount || 0,
        followingCount: 0,
        postsCount: 0,
        posts: []
      };
    }
    if (!cookies) return { isLoggedIn: false, platform: 'instagram' };
    const sessionCookie = cookies.find((c) => c.name === 'sessionid');
    const cachedProfile = readInstagramCache(active) || getCachedProfile(active?.username || active?.id) || {};

    return {
      isLoggedIn: !!sessionCookie,
      activeAccountId: active?.id || '',
      platform: 'instagram',
      username: active?.username || TARGET_USERNAME,
      ...cachedProfile
    };
  });

  safeHandle('get-user-feed', async () => {
    const active = getActiveAccount();
    // Belum ada akun → jangan tampilkan feed bawaan/cache lama
    if (!active || !(igSessionMod().getAccountsRegistry().accounts || []).length) return { success: true, posts: [], profile: null, noAccount: true };
    if (active?.platform === 'tiktok') {
      const fresh = await getTikTokProfileAndFeed(active);
      return { success: true, posts: fresh?.posts || [], profile: fresh?.profile };
    }
    if (active?.platform === 'shopee') return { success: true, posts: active.posts || [], profile: shopeeSessionInfo(active) };
    if (active?.platform === 'facebook') return { success: true, posts: [], profile: null };
    if (active?.platform === 'instagram') {
      const cached = readInstagramCache(active);
      return { success: true, posts: cached?.posts || [], profile: cached };
    }
    const data = await getInstagramProfileAndFeed();
    return { success: true, posts: data?.posts || [] };
  });

  // Profil Instagram aktif dari cache login / refresh
  function readInstagramCache(active) {
    try {
      const igSession = require('../../platforms/instagram/sessionManager');
      const clean = String(active?.username || '').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      const f = af.readPath(path.join(igSession.SESSIONS_DIR, `profile_cache_${clean}.json`));
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
    } catch (e) { return null; }
  }
  async function refreshInstagramProfile(active) {
    const igSession = require('../../platforms/instagram/sessionManager');
    const cookies = igSession.loadInstagramSession(active.id) || igSession.loadInstagramSession(active.username);
    if (!cookies) return null;
    const res = await saveInstagramFromCookies(cookies, active.facebookId ? { facebookId: active.facebookId } : {});
    if (!res.success) return null;
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
    return readInstagramCache({ username: res.username });
  }

  safeHandle('refresh-profile', async (event, opts = {}) => {
    const active = getActiveAccount();
    if (active?.platform === 'tiktok') {
      const fresh = await getTikTokProfileAndFeed(active, { force: Boolean(opts?.force) });
      return { success: true, profile: fresh?.profile, posts: fresh?.posts || [] };
    }
    if (active?.platform === 'facebook') {
      return { success: true, profile: { username: active.username, fullName: active.name, profilePicUrl: active.avatar, category: 'FACEBOOK PAGE' }, posts: [] };
    }
    if (active?.platform === 'shopee') {
      if (active.connectMethod !== 'hp' || !opts?.force) return { success: true, profile: shopeeSessionInfo(active), posts: active.posts || [] };
      try {
        const fresh = await refreshShopeeFromPhone(active);
        return { success: true, profile: shopeeSessionInfo(fresh), posts: fresh.posts || [] };
      } catch (e) {
        return { success: false, error: e.message, profile: shopeeSessionInfo(active), posts: active.posts || [] };
      }
    }
    if (active?.platform === 'instagram') {
      const fresh = (await refreshInstagramProfile(active)) || readInstagramCache(active);
      return { success: Boolean(fresh), profile: fresh, posts: fresh?.posts || [] };
    }
    const data = await getInstagramProfileAndFeed();
    return { success: true, profile: data?.profile, posts: data?.posts || [] };
  });

  safeHandle('logout', async () => {
    const part = getActivePartitionName();
    const customSession = session.fromPartition(part);
    await customSession.clearStorageData();
    clearSessionData();
    loadInitialScreen();
    return true;
  });

  ipcMain.on('navigate-to-dashboard', () => {
    const win = ctx.getMainWindow();
    if (win) win.loadFile(path.join(__dirname, '../../renderer/dashboard.html'));
  });

  // Ganti Platform → halaman Pilih Platform (bukan halaman lisensi; lisensi sudah divalidasi saat aplikasi dibuka)
  const openPlatformSelection = () => {
    const win = ctx.getMainWindow();
    if (win) win.loadFile(path.join(__dirname, '../../renderer/select-account.html'));
  };
  ipcMain.on('navigate-to-select-account', openPlatformSelection);
  ipcMain.on('switch-platform', openPlatformSelection);
};