/**
 * src/main/ipc/accountIpc.js
 */
const { session, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { spawn } = require('child_process');

module.exports = function registerAccountIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
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

  const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'sessions');
  const ACCOUNTS_FILE = path.resolve(SESSIONS_DIR, 'accounts.json');

  // Helper agar pendaftaran IPC aman dari error duplikasi
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

  /**
   * Helper pencari file cache profil TikTok ketat berdasarkan ID/Username spesifik
   */
  function findTikTokProfileCache(accountId, username) {
    const rawId = String(accountId || '');
    const cleanId = cleanUserIdentifier ? cleanUserIdentifier(rawId) : rawId.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const rawUser = String(username || '').replace(/^@/, '');
    const cleanUser = cleanUserIdentifier ? cleanUserIdentifier(rawUser) : rawUser.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();

    // Prioritaskan file yang namanya benar-benar mengandung ID atau Username akun aktif
    const specificCandidates = [
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${rawUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_${rawUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_${cleanUser}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${rawId}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanId}.json`),
      path.resolve(SESSIONS_DIR, `profile_cache_tiktok_tiktok_${cleanId.replace(/^tiktok_/, '')}.json`)
    ];

    for (const cPath of specificCandidates) {
      if (fs.existsSync(cPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(cPath, 'utf-8'));
          const avatarUrl = data.avatar || data.profilePicUrl || data.avatarUrl || data.avatarThumb;
          // Pastikan bukan cache milik Karuna jika akun yang dicari bukan karuna
          const isTargetKaruna = cleanUser.includes('karuna') || cleanId.includes('karuna');
          const isFileKaruna = cPath.toLowerCase().includes('karuna');

          if (!isTargetKaruna && isFileKaruna) continue;

          if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.length > 10) {
            return data;
          }
        } catch (e) {}
      }
    }

    return null;
  }

  function saveTikTokCachedProfile(accountId, profileData) {
    try {
      const cleanId = cleanUserIdentifier ? cleanUserIdentifier(accountId) : accountId;
      const cacheFile = path.resolve(SESSIONS_DIR, `profile_cache_tiktok_${cleanId}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify(profileData, null, 2), 'utf-8');
    } catch (e) {}
  }

  async function getTikTokProfileAndFeed(activeAcc) {
    if (!activeAcc) return null;
    const accountKey = activeAcc.id || activeAcc.username;

    if (typeof syncTikTokProfile === 'function') {
      try {
        const syncRes = await syncTikTokProfile(accountKey);
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

    const targetUser = accountUsername || `tiktok_${Date.now()}`;
    const cleanUser = cleanUserIdentifier ? cleanUserIdentifier(targetUser) : targetUser;
    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanUser}`);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    purgeTikTokSessionLocks(profileDir);
    const cdpPort = 54000 + Math.floor(Math.random() * 5000);

    const chromeProc = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1240,900',
      '--window-position=50,40',
      'https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fwww.tiktok.com%2Ftiktokstudio'
    ], { detached: false, stdio: 'ignore' });

    (async () => {
      let browser = null;
      for (let i = 0; i < 30; i++) {
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
          const cookies = await context.cookies(['https://www.tiktok.com']);
          const hasSession = cookies.some((c) => c.name === 'sessionid' || c.name === 'sid_tt' || c.name === 'sessionid_ss');

          if (hasSession) {
            clearInterval(checkInterval);

            const pages = context.pages();
            const page = pages.find((p) => !p.url().includes('chrome://')) || pages[0];
            let detectedAvatar = '';
            let detectedUsername = targetUser;
            let detectedNickname = '';

            if (page) {
              const info = await page.evaluate(() => {
                const img = document.querySelector('[data-e2e="user-avatar"] img, img.css-10s4roi-7937d88b--ImgAvatar, span[shape="circle"] img');
                const uLink = document.querySelector('a[href*="/@"]');
                const m = uLink ? uLink.getAttribute('href').match(/@([^/?#]+)/) : null;
                const h1 = document.querySelector('[data-e2e="user-title"], h1');
                return {
                  avatar: img ? (img.currentSrc || img.src || '') : '',
                  username: m ? m[1] : '',
                  nickname: h1 ? h1.innerText.trim() : ''
                };
              }).catch(() => ({ avatar: '', username: '', nickname: '' }));

              if (info.avatar) detectedAvatar = info.avatar;
              if (info.username && info.username !== 'me') detectedUsername = info.username;
              if (info.nickname) detectedNickname = info.nickname;
            }

            const cleanId = cleanUserIdentifier ? cleanUserIdentifier(detectedUsername) : detectedUsername;
            const accountPayload = {
              id: cleanId,
              username: detectedUsername,
              name: detectedNickname || detectedUsername,
              fullName: detectedNickname || detectedUsername,
              platform: 'tiktok',
              partition: `persist:tiktok_session_${cleanId}`,
              avatar: detectedAvatar,
              profilePicUrl: detectedAvatar
            };

            saveAccountSession(accountPayload, cookies);

            const specificCookie = path.resolve(PROJECT_ROOT, `sessions/tiktokshop_cookies_${cleanId}.json`);
            const defaultCookie = path.resolve(PROJECT_ROOT, 'sessions/tiktokshop_cookies.json');
            fs.writeFileSync(specificCookie, JSON.stringify(cookies, null, 2), 'utf-8');
            fs.writeFileSync(defaultCookie, JSON.stringify(cookies, null, 2), 'utf-8');

            setActiveAccount(cleanId);
            await browser.close().catch(() => {});
            try { chromeProc.kill(); } catch (e) {}

            const win = ctx.getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('accounts-updated');
              win.webContents.send('profile-updated');
              win.loadFile(path.join(__dirname, '../../renderer/dashboard.html'));
            }
          }
        } catch (e) {}
      }, 2000);
    })();

    return { success: true, port: cdpPort };
  }

  // =========================================================================
  // IPC HANDLERS AKUN & MULTI-PLATFORM
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
          }
        }
        return acc;
      });

      // Simpan pembaruan avatar ke accounts.json jika ada data baru
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

  safeHandle('delete-account', async (event, accountId) => {
    try {
      const { removeAccount } = require('../../platforms/instagram/sessionManager');
      if (typeof removeAccount === 'function') removeAccount(accountId);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('accounts-updated');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('get-session-info', async () => {
    const active = getActiveAccount();
    const cookies = loadSessionFromFile(active?.username || active?.id);

    if (active?.platform === 'tiktok') {
      const hasSession = cookies && cookies.some((c) => c.name === 'sessionid' || c.name === 'sid_tt' || c.name === 'sessionid_ss');
      let cached = findTikTokProfileCache(active.id, active.username);

      return {
        isLoggedIn: Boolean(hasSession),
        userId: active.id || 'tiktok_user',
        activeAccountId: active.id || '',
        platform: 'tiktok',
        username: cached?.username || active.username || 'sherlylovyou.id',
        fullName: cached?.name || cached?.fullName || active.name || active.fullName || 'Sherlylovyou',
        avatar: cached?.avatar || cached?.profilePicUrl || active.avatar || active.profilePicUrl || '',
        profilePicUrl: cached?.avatar || cached?.profilePicUrl || active.avatar || active.profilePicUrl || '',
        followingCount: cached?.followingCount ?? active.followingCount ?? 1,
        followersCount: cached?.followersCount ?? active.followersCount ?? 950,
        likesCount: cached?.likesCount ?? active.likesCount ?? 809,
        biography: cached?.biography || active.biography || '',
        postsCount: cached?.posts?.length ?? active.posts?.length ?? 0,
        posts: cached?.posts || active.posts || []
      };
    }

    if (!cookies) return { isLoggedIn: false, platform: 'instagram' };
    const sessionCookie = cookies.find((c) => c.name === 'sessionid');
    const cachedProfile = getCachedProfile(active?.username || active?.id) || {};

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
    if (active?.platform === 'tiktok') {
      const fresh = await getTikTokProfileAndFeed(active);
      return { success: true, posts: fresh?.posts || [], profile: fresh?.profile };
    }
    const data = await getInstagramProfileAndFeed();
    return { success: true, posts: data?.posts || [] };
  });

  safeHandle('refresh-profile', async () => {
    const active = getActiveAccount();
    if (active?.platform === 'tiktok') {
      const fresh = await getTikTokProfileAndFeed(active);
      return { success: true, profile: fresh?.profile, posts: fresh?.posts || [] };
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

  ipcMain.on('navigate-to-select-account', () => loadInitialScreen());
  ipcMain.on('switch-platform', () => loadInitialScreen());
};