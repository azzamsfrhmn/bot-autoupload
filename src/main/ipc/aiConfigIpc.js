/**
 * src/main/ipc/aiConfigIpc.js
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// API Key Gemini Permanen (sumber tunggal di aiCaption.js)
const { HARDCODED_GEMINI_API_KEY } = require('../../services/aiCaption');

module.exports = function registerAiConfigIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    DATA_ROOT,
    generateInstagramCaption,
    testGeminiConnection,
    isPinterestLoggedIn,
    openPinterestLoginWindow,
    getOriginalChromeExecutablePath
  } = ctx;

  const RUNTIME_ROOT = DATA_ROOT || PROJECT_ROOT;
  const SESSIONS_DIR = path.resolve(RUNTIME_ROOT, 'sessions');
  const CHATGPT_SHARED_PROFILE = path.resolve(SESSIONS_DIR, 'chatgpt_profile_shared');

  function safeHandle(channel, handler) {
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  function purgeLocks(profileDir) {
    if (!fs.existsSync(profileDir)) return;
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    });
  }

  function hasActualChatGptSession(profileDir) {
    if (!profileDir || !fs.existsSync(profileDir)) return false;

    const cookieDbCandidates = [
      path.join(profileDir, 'Default', 'Network', 'Cookies'),
      path.join(profileDir, 'Network', 'Cookies')
    ];

    for (const dbPath of cookieDbCandidates) {
      if (fs.existsSync(dbPath)) {
        try {
          const stat = fs.statSync(dbPath);
          if (stat.size > 28672) {
            const buf = fs.readFileSync(dbPath);
            if (
              buf.includes(Buffer.from('session-token')) ||
              buf.includes(Buffer.from('__Secure-next-auth')) ||
              buf.includes(Buffer.from('oai-did'))
            ) {
              return true;
            }
          }
        } catch (e) {}
      }
    }
    return false;
  }

  function checkChatGptSessionStatus() {
    const isSharedActive = hasActualChatGptSession(CHATGPT_SHARED_PROFILE);
    const isLegacyActive =
      hasActualChatGptSession(path.resolve(SESSIONS_DIR, 'chatgpt_profile_w1')) ||
      hasActualChatGptSession(path.resolve(SESSIONS_DIR, 'chatgpt_video_profile_w1')) ||
      hasActualChatGptSession(path.resolve(SESSIONS_DIR, 'chatgpt_video_profile'));

    const isActive = Boolean(isSharedActive || isLegacyActive);

    return {
      isLoggedIn: isActive,
      w1: isActive,
      videoW1: isActive
    };
  }

  function openChatGptWindow(targetUrl = 'https://chatgpt.com') {
    const chromePath = typeof getOriginalChromeExecutablePath === 'function'
      ? getOriginalChromeExecutablePath()
      : null;

    if (!chromePath) throw new Error('Google Chrome tidak ditemukan di sistem.');

    if (!fs.existsSync(CHATGPT_SHARED_PROFILE)) {
      fs.mkdirSync(CHATGPT_SHARED_PROFILE, { recursive: true });
    }

    purgeLocks(CHATGPT_SHARED_PROFILE);

    const cdpPort = 54200 + Math.floor(Math.random() * 3000);
    const args = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${CHATGPT_SHARED_PROFILE}`,
      '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      targetUrl
    ];

    const proc = spawn(chromePath, args, { detached: false, stdio: 'ignore' });

    const checkTimer = setInterval(() => {
      if (proc.killed) {
        clearInterval(checkTimer);
        return;
      }
      if (hasActualChatGptSession(CHATGPT_SHARED_PROFILE)) {
        const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          win.webContents.send('check-ai-status');
        }
      }
    }, 4000);

    return { success: true, port: cdpPort };
  }

  // --- Konfigurasi Dasar Gemini Permanen ---
  safeHandle('get-ai-config', async () => ({
    geminiApiKey: '••••••••••••••••••••••••••••••••••••••••',
    isPermanent: true
  }));

  safeHandle('save-ai-config', async () => {
    try {
      const cfgPath = path.join(SESSIONS_DIR, 'config.json');
      let current = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) : {};
      current.geminiApiKey = HARDCODED_GEMINI_API_KEY;
      fs.writeFileSync(cfgPath, JSON.stringify(current, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Handler Headless Global untuk Pengaturan AI
  safeHandle('save-ai-headless-config', async (e, isHeadless) => {
    try {
      const flowProfilesDir = path.resolve(RUNTIME_ROOT, 'sessions/flow_profiles');
      if (!fs.existsSync(flowProfilesDir)) fs.mkdirSync(flowProfilesDir, { recursive: true });
      const cfgPath = path.join(flowProfilesDir, 'accounts_config.json');

      let current = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) : {};
      current.headless = Boolean(isHeadless);
      fs.writeFileSync(cfgPath, JSON.stringify(current, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('get-ai-headless-config', async () => {
    try {
      const cfgPath = path.resolve(RUNTIME_ROOT, 'sessions/flow_profiles/accounts_config.json');
      if (fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        return { headless: Boolean(raw.headless) };
      }
    } catch (e) {}
    return { headless: false };
  });

  safeHandle('test-ai-connection', async () => {
    if (typeof testGeminiConnection === 'function') {
      return testGeminiConnection(HARDCODED_GEMINI_API_KEY);
    }
    return { success: true, message: 'Gemini siap & terhubung (Permanen Aktif)' };
  });

  safeHandle('generate-caption', async (e, data) => {
    try {
      const caption = await generateInstagramCaption(data.prompt, data.tone, data.mediaFiles, data.platform);
      return { success: true, caption };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Pinterest ---
  safeHandle('get-pinterest-status', async () => ({
    isLoggedIn: typeof isPinterestLoggedIn === 'function' ? isPinterestLoggedIn() : false
  }));

  safeHandle('login-pinterest', async () => {
    const win = ctx.getMainWindow ? ctx.getMainWindow() : null;
    return new Promise((resolve) => openPinterestLoginWindow(win, resolve));
  });

  // --- ChatGPT: Satu Sesi Bersama Terpadu ---
  safeHandle('get-chatgpt-status', async () => {
    return checkChatGptSessionStatus();
  });

  safeHandle('open-chatgpt-login', async () => {
    try {
      return openChatGptWindow('https://chatgpt.com');
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('open-chatgpt-video-login', async () => {
    try {
      return openChatGptWindow('https://chatgpt.com');
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
};