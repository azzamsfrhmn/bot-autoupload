/**
 * src/main/ipc/aiConfigIpc.js
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

module.exports = function registerAiConfigIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    generateInstagramCaption,
    testGeminiConnection,
    getSavedApiKey,
    isPinterestLoggedIn,
    openPinterestLoginWindow,
    getOriginalChromeExecutablePath,
    getTikTokProfileDir
  } = ctx;

  const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'sessions');
  const ACCOUNTS_FILE = path.resolve(SESSIONS_DIR, 'accounts.json');

  // Helper agar tidak terjadi error "Attempted to register a second handler"
  function safeHandle(channel, handler) {
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  function getActiveAccountInfo() {
    let activeId = '';
    let activeUsername = '';

    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        const accList = Array.isArray(raw) ? raw : (raw.accounts || []);
        activeId = raw.activeAccountId || raw.activeId || '';
        const activeAcc = accList.find((a) => a.id === activeId) || accList[0];
        if (activeAcc) {
          activeId = activeAcc.id || activeId;
          activeUsername = (activeAcc.username || '').replace(/^@/, '').toLowerCase();
        }
      } catch (e) {}
    }
    return { activeId, activeUsername };
  }

  function checkTikTokStreamerSession() {
    const { activeId, activeUsername } = getActiveAccountInfo();

    // 1. Cek seluruh variasi file cookie streamer / tiktokshop
    const candidateFiles = [
      activeId ? path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeId}.json`) : null,
      activeUsername ? path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeUsername}.json`) : null,
      activeId ? path.resolve(SESSIONS_DIR, `tiktokshop_cookies_${activeId}.json`) : null,
      activeUsername ? path.resolve(SESSIONS_DIR, `tiktokshop_cookies_${activeUsername}.json`) : null,
      path.resolve(SESSIONS_DIR, 'tiktok_streamer_cookies.json'),
      path.resolve(SESSIONS_DIR, 'tiktokshop_cookies.json')
    ].filter(Boolean);

    // Cari juga file dinamis yang cocok di folder sessions/
    if (fs.existsSync(SESSIONS_DIR)) {
      try {
        const dynamicFiles = fs.readdirSync(SESSIONS_DIR)
          .filter((f) => (f.startsWith('tiktokshop_cookies_') || f.startsWith('tiktok_streamer_cookies_')) && f.endsWith('.json'))
          .map((f) => path.resolve(SESSIONS_DIR, f));
        candidateFiles.push(...dynamicFiles);
      } catch (e) {}
    }

    for (const cPath of candidateFiles) {
      if (fs.existsSync(cPath)) {
        try {
          const raw = fs.readFileSync(cPath, 'utf-8');
          const cookies = JSON.parse(raw);
          if (Array.isArray(cookies) && cookies.length > 0) {
            const hasAuth = cookies.some((c) => {
              const name = String(c.name || '').toLowerCase();
              return (
                name.includes('sessionid') ||
                name.includes('sid_') ||
                name.includes('streamer') ||
                name === 'passport_csrf_token'
              );
            });

            if (hasAuth) {
              // Jika file tiktokshop_cookies valid, otomatis sinkronkan salinan tiktok_streamer_cookies
              try {
                const streamerById = path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeId}.json`);
                if (!fs.existsSync(streamerById) && activeId) {
                  fs.writeFileSync(streamerById, JSON.stringify(cookies, null, 2), 'utf-8');
                }
              } catch (err) {}
              return true;
            }
          }
        } catch (e) {}
      }
    }

    // 2. Deteksi direktori profil browser Chrome TikTok yang sedang login
    const chromeProfileDir = path.resolve(SESSIONS_DIR, 'tiktok_profiles');
    if (fs.existsSync(chromeProfileDir)) {
      try {
        const subDirs = fs.readdirSync(chromeProfileDir);
        for (const sub of subDirs) {
          const cookieDb = path.join(chromeProfileDir, sub, 'Default', 'Network', 'Cookies');
          const altCookieDb = path.join(chromeProfileDir, sub, 'Network', 'Cookies');
          if (fs.existsSync(cookieDb) || fs.existsSync(altCookieDb)) return true;
        }
      } catch (e) {}
    }

    return false;
  }

  // --- Konfigurasi Dasar AI ---
  safeHandle('get-ai-config', async () => ({ geminiApiKey: getSavedApiKey() }));

  safeHandle('save-ai-config', async (event, { geminiApiKey }) => {
    try {
      const cfgPath = path.join(PROJECT_ROOT, 'sessions/config.json');
      let current = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) : {};
      if (geminiApiKey !== undefined) current.geminiApiKey = geminiApiKey.trim();
      fs.writeFileSync(cfgPath, JSON.stringify(current, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('test-ai-connection', async (e, key) => testGeminiConnection(key));

  safeHandle('generate-caption', async (e, data) => {
    try {
      const caption = await generateInstagramCaption(data.prompt, data.tone, data.mediaFiles);
      return { success: true, caption };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('get-pinterest-status', async () => ({ isLoggedIn: isPinterestLoggedIn() }));
  safeHandle('login-pinterest', async () => {
    const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
    return new Promise((resolve) => openPinterestLoginWindow(win, resolve));
  });

  safeHandle('get-chatgpt-status', async () => ({
    w1: true,
    w2: true,
    videoW1: true,
    videoW2: true
  }));

  // --- Handler Pengecekan Status Streamer Terpadu ---
  safeHandle('get-tiktok-streamer-status', async () => {
    return { success: true, isLoggedIn: checkTikTokStreamerSession() };
  });

  safeHandle('get-tiktokshop-status', async () => {
    return { success: true, isLoggedIn: checkTikTokStreamerSession() };
  });

  // --- Handler Login & Otomatis Simpan File Cookie Streamer ---
  safeHandle('login-tiktok-streamer', async () => {
    try {
      const chromePath = typeof getOriginalChromeExecutablePath === 'function'
        ? getOriginalChromeExecutablePath()
        : null;

      if (!chromePath) throw new Error('Google Chrome tidak ditemukan di sistem.');

      const { activeId, activeUsername } = getActiveAccountInfo();
      const targetUser = activeId || activeUsername || 'karuna_id';

      const profileDir = typeof getTikTokProfileDir === 'function'
        ? getTikTokProfileDir(targetUser)
        : path.resolve(SESSIONS_DIR, `tiktok_profiles/acc_${targetUser}`);

      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

      const cdpPort = 54100 + Math.floor(Math.random() * 4000);
      const args = [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,900',
        'https://shop.tiktok.com/streamer/showcase/product/list'
      ];

      const chromeProc = spawn(chromePath, args, { detached: false, stdio: 'ignore' });

      // Latar belakang: Ekstrak cookie otomatis begitu browser siap
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

            const cookies = await context.cookies([
              'https://shop.tiktok.com',
              'https://www.tiktok.com',
              'https://creator.tiktokshop.com'
            ]);

            const hasSession = cookies.some((c) => {
              const n = String(c.name || '').toLowerCase();
              return n.includes('sessionid') || n.includes('sid_') || n.includes('streamer');
            });

            if (hasSession && cookies.length > 0) {
              const nameById = path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeId}.json`);
              const nameByUser = path.resolve(SESSIONS_DIR, `tiktok_streamer_cookies_${activeUsername || 'sherlylovyou_id'}.json`);
              const defaultStreamer = path.resolve(SESSIONS_DIR, 'tiktok_streamer_cookies.json');
              const defaultShop = path.resolve(SESSIONS_DIR, 'tiktokshop_cookies.json');

              fs.writeFileSync(nameById, JSON.stringify(cookies, null, 2), 'utf-8');
              fs.writeFileSync(nameByUser, JSON.stringify(cookies, null, 2), 'utf-8');
              fs.writeFileSync(defaultStreamer, JSON.stringify(cookies, null, 2), 'utf-8');
              fs.writeFileSync(defaultShop, JSON.stringify(cookies, null, 2), 'utf-8');

              const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
              if (win && !win.isDestroyed()) {
                win.webContents.send('check-ai-status');
              }
            }
          } catch (e) {}
        }, 3000);
      })().catch(() => {});

      return { success: true, port: cdpPort };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
};