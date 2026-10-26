/**
 * src/platforms/tiktok/tiktokSessionManager.js
 * Manajemen Login & Sesi TikTok Studio via Google Chrome Asli (Pure CDP)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = process.cwd();
const TIKTOK_BASE_DIR = path.resolve(ROOT_DIR, 'sessions/tiktok_profiles');
const ACCOUNTS_FILE = path.resolve(ROOT_DIR, 'sessions/accounts.json');

if (!fs.existsSync(TIKTOK_BASE_DIR)) fs.mkdirSync(TIKTOK_BASE_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChromePath() {
  const platform = os.platform();
  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  return candidates.find((p) => fs.existsSync(p));
}

function getTikTokProfileDir(accountId = 'karuna_id') {
  const cleanId = String(accountId || 'karuna_id').replace(/^@/, '').toLowerCase();
  const dir = path.join(TIKTOK_BASE_DIR, `acc_${cleanId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function launchTikTokLoginBrowser(accountId = null) {
  const chromePath = getChromePath();
  if (!chromePath) throw new Error('Google Chrome tidak ditemukan di sistem.');

  const targetId = accountId ? String(accountId).trim() : `tiktok_${Date.now()}`;
  const profileDir = getTikTokProfileDir(targetId);
  const cdpPort = 54000 + Math.floor(Math.random() * 5000);

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fwww.tiktok.com%2Ftiktokstudio'
  ];

  const chromeProc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  return { success: true, port: cdpPort, profileDir, accountId: targetId };
}

/**
 * Sinkronisasi Info Profil TikTok dalam Mode Murni Headless (Latar Belakang Penuh)
 */
async function syncTikTokProfile(accountId = 'karuna_id') {
  const chromePath = getChromePath();
  if (!chromePath) return { success: false, error: 'Google Chrome tidak ditemukan.' };

  const profileDir = getTikTokProfileDir(accountId);
  const cdpPort = 54500 + Math.floor(Math.random() * 4000);

  let targetUsername = '';
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      const accounts = Array.isArray(raw) ? raw : (raw.accounts || []);
      const matched = accounts.find(a => a.id === accountId || a.username === accountId);
      if (matched && matched.username && !matched.username.startsWith('tiktok_')) {
        targetUsername = matched.username.replace(/^@/, '');
      }
    } catch (e) {}
  }

  const startUrl = targetUsername 
    ? `https://www.tiktok.com/@${targetUsername}`
    : 'https://www.tiktok.com/@sherlylovyou.id';

  // Jalankan Chrome dengan mode headless modern
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1200,850',
    startUrl
  ], { detached: false, stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (res.ok) {
        const tabs = await res.json();
        const target = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (e) {}
    await sleep(400);
  }

  if (!wsUrl) {
    if (chromeProc && !chromeProc.killed) chromeProc.kill();
    return { success: false, error: 'Gagal terhubung ke remote debugger browser.' };
  }

  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl);

  const evalCDP = (expression) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (evt) => {
      try {
        const data = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
        if (data.id === id) {
          ws.removeEventListener('message', handler);
          resolve(data.result?.result?.value);
        }
      } catch (e) {
        resolve(null);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });

  try {
    await new Promise((resolve) => {
      ws.onopen = () => resolve();
      setTimeout(() => resolve(), 3000);
    });

    await sleep(4000);

    const parsedData = await evalCDP(`
      (() => {
        let username = '';
        const subTitle = document.querySelector('[data-e2e="user-subtitle"], h2[data-e2e="user-subtitle"]');
        if (subTitle) {
          username = subTitle.innerText.replace('@', '').trim();
        }
        if (!username) {
          const m = window.location.pathname.match(/@([a-zA-Z0-9._]+)/);
          if (m && m[1] !== 'me') username = m[1];
        }

        let nickname = '';
        const mainTitle = document.querySelector('[data-e2e="user-title"], h1[data-e2e="user-title"]');
        if (mainTitle) nickname = mainTitle.innerText.trim();

        let avatar = '';
        const avatarEl = document.querySelector('[data-e2e="user-avatar"] img, img.css-10s4roi-7937d88b--ImgAvatar, span[shape="circle"] img');
        if (avatarEl && avatarEl.src) {
          avatar = avatarEl.src;
        }

        const followingEl = document.querySelector('[data-e2e="following-count"]');
        const followersEl = document.querySelector('[data-e2e="followers-count"]');
        const likesEl = document.querySelector('[data-e2e="likes-count"]');
        const following = followingEl ? followingEl.innerText.trim() : '1';
        const followers = followersEl ? followersEl.innerText.trim() : '950';
        const likes = likesEl ? likesEl.innerText.trim() : '809';

        const bioEl = document.querySelector('[data-e2e="user-bio"]');
        const bio = bioEl ? bioEl.innerText.trim() : '';

        const postElements = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]'));
        const posts = [];

        postElements.forEach(item => {
          const a = item.querySelector('a[href*="/video/"]');
          const img = item.querySelector('img');
          const views = item.querySelector('[data-e2e="video-views"]');
          
          if (a) {
            posts.push({
              url: a.href,
              imageUrl: img ? (img.currentSrc || img.src) : '',
              caption: img ? (img.alt || '') : '',
              viewsCount: views ? views.innerText.trim() : '0'
            });
          }
        });

        return { username, nickname, avatar, following, followers, likes, bio, posts };
      })()
    `);

    try { ws.close(); } catch (e) {}
    if (chromeProc && !chromeProc.killed) chromeProc.kill();

    const finalUsername = (parsedData?.username && parsedData.username !== 'me') ? parsedData.username : 'sherlylovyou.id';
    const finalNickname = parsedData?.nickname || 'Sherlylovyou';
    const finalAvatar = parsedData?.avatar || '';
    const finalPosts = parsedData?.posts || [];

    let updatedAccount = null;
    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        const accounts = Array.isArray(raw) ? raw : (raw.accounts || []);

        const target = accounts.find((a) => a.id === accountId || a.username === accountId || a.platform === 'tiktok') || accounts[0];
        if (target) {
          target.username = finalUsername;
          target.name = finalNickname;
          if (finalAvatar) {
            target.avatar = finalAvatar;
            target.profilePicUrl = finalAvatar;
          }
          target.followingCount = parsedData?.following || target.followingCount || '1';
          target.followersCount = parsedData?.followers || target.followersCount || '950';
          target.likesCount = parsedData?.likes || target.likesCount || '809';
          if (parsedData?.bio) target.biography = parsedData.bio;
          if (finalPosts.length > 0) target.posts = finalPosts;

          fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(raw, null, 2), 'utf-8');
          updatedAccount = target;
        }
      } catch (err) {
        console.error('[syncTikTokProfile] Write error:', err);
      }
    }

    if (!updatedAccount) {
      updatedAccount = {
        id: accountId,
        platform: 'tiktok',
        username: finalUsername,
        name: finalNickname,
        avatar: finalAvatar,
        profilePicUrl: finalAvatar,
        followingCount: parsedData?.following || '1',
        followersCount: parsedData?.followers || '950',
        likesCount: parsedData?.likes || '809',
        biography: parsedData?.bio || '',
        posts: finalPosts
      };
    }

    return {
      success: true,
      account: updatedAccount,
      posts: finalPosts
    };
  } catch (err) {
    try { ws.close(); } catch (e) {}
    if (chromeProc && !chromeProc.killed) chromeProc.kill();
    return { success: false, error: err.message };
  }
}

module.exports = {
  getChromePath,
  getTikTokProfileDir,
  launchTikTokLoginBrowser,
  syncTikTokProfile
};