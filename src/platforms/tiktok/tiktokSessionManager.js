/**
 * src/platforms/tiktok/tiktokSessionManager.js
 * Manajemen Login & Sesi TikTok via Google Chrome Asli (Pure CDP)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let ROOT_DIR = process.cwd();
let TIKTOK_BASE_DIR = path.resolve(ROOT_DIR, 'sessions/tiktok_profiles');
let ACCOUNTS_FILE = path.resolve(ROOT_DIR, 'sessions/accounts.json');

// Ubah item API TikTok (/api/post/item_list) menjadi data postingan untuk halaman Profil
function mapTikTokApiItem(item, username) {
  const stats = item.statsV2 || item.stats || {};
  const num = (v) => Number(v || 0) || 0;
  return {
    id: String(item.id),
    url: `https://www.tiktok.com/@${username || item.author?.uniqueId || ''}/video/${item.id}`,
    imageUrl: item.video?.cover || item.video?.originCover || item.video?.dynamicCover || item.imagePost?.cover?.imageURL?.urlList?.[0] || '',
    coverCandidates: [item.video?.cover, item.video?.originCover, item.video?.dynamicCover, ...(item.imagePost?.cover?.imageURL?.urlList || [])].filter(Boolean),
    caption: item.desc || '',
    createTime: num(item.createTime),
    duration: num(item.video?.duration),
    viewsCount: num(stats.playCount),
    likeCount: num(stats.diggCount),
    commentCount: num(stats.commentCount),
    shareCount: num(stats.shareCount),
    collectCount: num(stats.collectCount),
    isPinned: Boolean(item.isPinnedItem)
  };
}

// Simpan cover video ke disk: URL cover TikTok kedaluwarsa dalam hitungan jam (thumbnail jadi kosong)
// pageFetch(url) → base64 | null: ambil gambar lewat halaman TikTok (pakai cookie login) untuk cover yang menolak akses langsung
async function cacheTikTokCovers(posts, pageFetch = null) {
  const dir = path.resolve(ROOT_DIR, 'sessions/tiktok_covers');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  await Promise.all(posts.map(async (post) => {
    const candidates = post.coverCandidates?.length ? post.coverCandidates : [post.imageUrl].filter(Boolean);
    delete post.coverCandidates;
    if (!post.id || candidates.length === 0) return;
    const file = path.join(dir, `${post.id}.jpg`);
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
      post.coverLocal = file;
      return;
    }
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers: { Referer: 'https://www.tiktok.com/' } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) {
          fs.writeFileSync(file, buf);
          post.coverLocal = file;
          return;
        }
      } catch (e) {}
    }
    if (pageFetch) {
      for (const url of candidates) {
        const b64 = await pageFetch(url).catch(() => null);
        const buf = b64 ? Buffer.from(b64, 'base64') : null;
        if (buf && buf.length > 1000) {
          fs.writeFileSync(file, buf);
          post.coverLocal = file;
          return;
        }
      }
    }
  }));
  return posts;
}

function setBaseDirs({ dataRoot, profilesDir, accountsFile }) {
  if (dataRoot) ROOT_DIR = dataRoot;
  if (profilesDir) TIKTOK_BASE_DIR = profilesDir;
  if (accountsFile) ACCOUNTS_FILE = accountsFile;

  if (!fs.existsSync(TIKTOK_BASE_DIR)) {
    fs.mkdirSync(TIKTOK_BASE_DIR, { recursive: true });
  }
}

if (!fs.existsSync(TIKTOK_BASE_DIR)) {
  fs.mkdirSync(TIKTOK_BASE_DIR, { recursive: true });
}

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

function getTikTokProfileDir(accountId = 'user_default') {
  const cleanId = String(accountId || 'user_default').replace(/^@/, '').toLowerCase();
  const dir = path.join(TIKTOK_BASE_DIR, `acc_${cleanId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Membuka browser Chrome untuk Login
 * Diarahkan langsung ke TikTok Utama (Bukan Studio)
 */
async function launchTikTokLoginBrowser(accountId = null) {
  const chromePath = getChromePath();
  if (!chromePath) throw new Error('Google Chrome tidak ditemukan di sistem.');

  const targetId = accountId ? String(accountId).trim() : `tiktok_${Date.now()}`;
  const profileDir = getTikTokProfileDir(targetId);
  const cdpPort = 54000 + Math.floor(Math.random() * 5000);

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fwww.tiktok.com%2F'
  ];

  const chromeProc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  return { success: true, port: cdpPort, profileDir, accountId: targetId };
}

/**
 * Sinkronisasi Info Profil TikTok
 * Otomatis mendeteksi username aktif dari sesi login Chrome CDP
 */
// Tutup Chrome beserta seluruh proses anaknya (kill() biasa kadang menyisakan jendela Chrome di Windows)
function killChromeTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (os.platform() === 'win32') execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch (e) {}
}

// Bersihkan Chrome sinkron (jendela di luar layar) yang tertinggal dari sinkron sebelumnya untuk profil ini.
// Jendela login TikTok yang dibuka pengguna (tanpa --window-position=-32000) tidak disentuh.
function killLeftoverSyncChrome(profileDir) {
  if (os.platform() !== 'win32') return;
  const dirName = path.basename(profileDir).replace(/'/g, '');
  const script = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${dirName}*' -and $_.CommandLine -like '*window-position=-32000*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { stdio: 'ignore', timeout: 15000 });
  } catch (e) {}
}

// Sinkron bisa dipicu bersamaan (buka aplikasi, tab Profil, Refresh): satu proses per akun, yang lain menunggu hasilnya
const syncJobs = new Map();

// Tiap sinkron membuka Chrome tersembunyi (berat) → paling sering sekali per 30 menit per akun.
// Di antaranya pemanggil memakai data tersimpan; tombol "Refresh Profil" memaksa sinkron (force).
const SYNC_COOLDOWN_MS = 30 * 60 * 1000;
const lastSyncResults = new Map();
const syncTimesFile = () => path.resolve(ROOT_DIR, 'sessions/tiktok_profile_sync_times.json');

function readSyncTimes() {
  try { return JSON.parse(fs.readFileSync(syncTimesFile(), 'utf-8')) || {}; } catch (e) { return {}; }
}

function writeSyncTime(key) {
  try {
    const times = readSyncTimes();
    times[key] = Date.now();
    fs.writeFileSync(syncTimesFile(), JSON.stringify(times, null, 2), 'utf-8');
  } catch (e) {}
}

function syncTikTokProfile(accountId, { force = false } = {}) {
  if (!accountId) return Promise.resolve({ success: false, error: 'ID Akun tidak diberikan.' });
  const key = String(accountId).toLowerCase();
  if (syncJobs.has(key)) return syncJobs.get(key);

  // Waktu sinkron terakhir disimpan di file agar jeda tetap berlaku walau aplikasi dibuka ulang
  const lastAt = readSyncTimes()[key] || 0;
  if (!force && Date.now() - lastAt < SYNC_COOLDOWN_MS) {
    const minutes = Math.ceil((SYNC_COOLDOWN_MS - (Date.now() - lastAt)) / 60000);
    // Hasil sinkron terakhir (sesi aplikasi ini) bila ada; selain itu pemanggil memakai cache profil di disk
    return Promise.resolve(lastSyncResults.get(key) || { success: false, skipped: true, error: `Sinkron profil dilewati (berikutnya ±${minutes} menit lagi).` });
  }

  syncJobs.set(key, runTikTokProfileSync(accountId)
    .then((res) => {
      if (res?.success) lastSyncResults.set(key, res);
      // Gagal pun dicatat: jangan membuka Chrome berulang kali saat TikTok sedang bermasalah
      writeSyncTime(key);
      return res;
    })
    .finally(() => syncJobs.delete(key)));
  return syncJobs.get(key);
}

async function runTikTokProfileSync(accountId) {

  const chromePath = getChromePath();
  if (!chromePath) return { success: false, error: 'Google Chrome tidak ditemukan.' };

  const profileDir = getTikTokProfileDir(accountId);
  const cdpPort = 54500 + Math.floor(Math.random() * 4000);
  killLeftoverSyncChrome(profileDir);

  let targetUsername = '';
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      const accounts = Array.isArray(raw) ? raw : (raw.accounts || []);
      const matched = accounts.find((a) => a.id === accountId || a.username === accountId);
      if (matched && matched.username && !matched.username.startsWith('tiktok_')) {
        targetUsername = matched.username.replace(/^@/, '');
      }
    } catch (e) {}
  }

  // Jika username sudah diketahui, buka langsung profilnya. Jika belum, buka tiktok.com untuk deteksi username
  const startUrl = targetUsername 
    ? `https://www.tiktok.com/@${targetUsername}`
    : 'https://www.tiktok.com/';

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
    // TikTok mengosongkan daftar video untuk --headless: pakai jendela asli di luar layar
    '--window-position=-32000,-32000',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1200,850',
    startUrl
  ], { detached: false, stdio: 'ignore' });
  // Pengaman: apa pun yang terjadi, Chrome sinkron ditutup paling lambat 3 menit
  const watchdog = setTimeout(() => killChromeTree(chromeProc), 180000);

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
    clearTimeout(watchdog);
    killChromeTree(chromeProc);
    return { success: false, error: 'Gagal terhubung ke remote debugger browser.' };
  }

  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl);

  // Satu pendengar untuk semua balasan CDP (dulu 1 pendengar per perintah → peringatan MaxListenersExceeded)
  const pendingCDP = new Map();
  let cdpSeq = 0;
  ws.addEventListener('message', (evt) => {
    let data = null;
    try { data = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString()); } catch (e) { return; }
    const done = data && data.id != null ? pendingCDP.get(data.id) : null;
    if (done) { pendingCDP.delete(data.id); done(data); }
  });
  const callCDP = (method, params, timeoutMs, pick) => new Promise((resolve) => {
    const id = ++cdpSeq;
    const timer = setTimeout(() => { pendingCDP.delete(id); resolve(null); }, timeoutMs);
    pendingCDP.set(id, (data) => { clearTimeout(timer); resolve(pick(data)); });
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(timer); pendingCDP.delete(id); resolve(null); }
  });
  const evalCDP = (expression) => callCDP('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 30000, (d) => d.result?.result?.value);
  const navigateCDP = (url) => callCDP('Page.navigate', { url }, 20000, (d) => d.result);

  try {
    await new Promise((resolve) => {
      ws.onopen = () => resolve();
      setTimeout(() => resolve(), 3000);
    });

    // Tangkap data video asli (views, like, komentar) dari API yang dipanggil halaman profil TikTok
    const apiItems = new Map();
    const itemListUrls = new Set();
    const sendCDP = (method, params = {}) => callCDP(method, params, 15000, (d) => d.result || null);
    // Cegat respons item_list saat lewat (URL bertanda tangan tidak bisa diambil ulang), baca isinya, lalu teruskan
    ws.addEventListener('message', async (evt) => {
      let data = null;
      try {
        data = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
      } catch (e) {
        return;
      }
      if (data.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = data.params || {};
      try {
        itemListUrls.add(request?.url || '');
        const body = await sendCDP('Fetch.getResponseBody', { requestId });
        const text = body?.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body?.body;
        (JSON.parse(text || '{}').itemList || []).forEach((it) => it?.id && apiItems.set(String(it.id), it));
      } catch (e) {}
      sendCDP('Fetch.continueRequest', { requestId });
    });
    await sendCDP('Fetch.enable', { patterns: [{ urlPattern: '*/api/post/item_list*', requestStage: 'Response' }] });

    await sleep(4000);

    // Langkah 1: Jika belum punya username, ekstrak identitas user dari sesi aktif TikTok
    if (!targetUsername) {
      const detectedUsername = await evalCDP(`
        (() => {
          try {
            // Coba ambil dari SIGI_STATE
            if (window.SIGI_STATE && window.SIGI_STATE.UserModule && window.SIGI_STATE.UserModule.users) {
              const keys = Object.keys(window.SIGI_STATE.UserModule.users);
              if (keys.length > 0) return keys[0];
            }
            // Coba ambil dari link profile di header / navbar
            const profileLink = document.querySelector('a[href*="/@"][data-e2e="profile-icon"], a[href^="/@"]');
            if (profileLink) {
              const m = profileLink.getAttribute('href').match(/@([a-zA-Z0-9._]+)/);
              if (m && m[1]) return m[1];
            }
            // Coba cek cookie session atau path saat ini
            const currentMatch = window.location.pathname.match(/@([a-zA-Z0-9._]+)/);
            if (currentMatch && currentMatch[1]) return currentMatch[1];
          } catch(e) {}
          return '';
        })()
      `);

      if (detectedUsername) {
        targetUsername = detectedUsername.replace(/^@/, '').trim();
        // Arahkan page ke profil target yang baru terdeteksi
        await navigateCDP(`https://www.tiktok.com/@${targetUsername}`);
        await sleep(4500);
      }
    }

    if (targetUsername) {
      await navigateCDP(`https://www.tiktok.com/@${targetUsername}`);
      for (let i = 0; i < 20 && itemListUrls.size === 0; i++) await sleep(500);
      for (let i = 0; i < 3; i++) {
        await evalCDP('window.scrollTo(0, document.body.scrollHeight)');
        await sleep(1500);
      }
    }

    // Langkah 2: Scraping data profil lengkap
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
        const following = followingEl ? followingEl.innerText.trim() : '0';
        const followers = followersEl ? followersEl.innerText.trim() : '0';
        const likes = likesEl ? likesEl.innerText.trim() : '0';

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

    const finalUsername = (parsedData?.username && parsedData.username !== 'me') 
      ? parsedData.username 
      : (targetUsername || accountId);
    const finalNickname = parsedData?.nickname || finalUsername;
    // Avatar pemilik profil dari data API (selektor DOM bisa menangkap foto akun lain)
    const apiAuthor = Array.from(apiItems.values()).map((it) => it.author).find((a) => a && a.uniqueId === finalUsername);
    const finalAvatar = apiAuthor?.avatarLarger || apiAuthor?.avatarMedium || parsedData?.avatar || '';
    // Utamakan data API (lengkap: views, like, komentar, share); DOM hanya cadangan
    let finalPosts = parsedData?.posts || [];
    if (apiItems.size > 0) {
      finalPosts = Array.from(apiItems.values())
        .map((it) => mapTikTokApiItem(it, finalUsername))
        .sort((a, b) => (b.isPinned - a.isPinned) || (b.createTime - a.createTime));
    }
    const pageFetch = (url) => evalCDP(`fetch(${JSON.stringify(url)}, { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(String(fr.result).split(',')[1] || null); fr.readAsDataURL(b); }))
      .catch(() => null)`);
    await cacheTikTokCovers(finalPosts, pageFetch);

    try { ws.close(); } catch (e) {}
    clearTimeout(watchdog);
    killChromeTree(chromeProc);

    let updatedAccount = null;
    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        let accounts = Array.isArray(raw) ? raw : (raw.accounts || []);

        let target = accounts.find((a) => a.id === accountId || a.username === accountId);
        
        if (!target) {
          // Jika belum ada di list akun, buat entri akun baru
          target = {
            id: accountId,
            platform: 'tiktok',
            username: finalUsername,
            name: finalNickname,
            avatar: finalAvatar,
            profilePicUrl: finalAvatar,
            followingCount: parsedData?.following || '0',
            followersCount: parsedData?.followers || '0',
            likesCount: parsedData?.likes || '0',
            biography: parsedData?.bio || '',
            posts: finalPosts
          };
          accounts.push(target);
        } else {
          target.username = finalUsername;
          target.name = finalNickname;
          if (finalAvatar) {
            target.avatar = finalAvatar;
            target.profilePicUrl = finalAvatar;
          }
          target.followingCount = parsedData?.following || target.followingCount || '0';
          target.followersCount = parsedData?.followers || target.followersCount || '0';
          target.likesCount = parsedData?.likes || target.likesCount || '0';
          if (parsedData?.bio) target.biography = parsedData.bio;
          if (finalPosts.length > 0) {
            // Halaman profil tidak selalu memuat semua video: pertahankan video lama yang tidak ikut termuat kali ini
            const freshIds = new Set(finalPosts.map((p) => p.id).filter(Boolean));
            const older = finalPosts[0]?.id ? (target.posts || []).filter((p) => p.id && !freshIds.has(p.id)) : [];
            finalPosts = [...finalPosts, ...older]
              .sort((a, b) => (b.isPinned - a.isPinned) || ((b.createTime || 0) - (a.createTime || 0)));
            target.posts = finalPosts;
          }
        }

        const toSave = Array.isArray(raw) 
          ? accounts 
          : { ...raw, accounts, activeAccountId: target.id };

        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
        updatedAccount = target;
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
        followingCount: parsedData?.following || '0',
        followersCount: parsedData?.followers || '0',
        likesCount: parsedData?.likes || '0',
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
    clearTimeout(watchdog);
    killChromeTree(chromeProc);
    return { success: false, error: err.message };
  }
}

module.exports = {
  setBaseDirs,
  getChromePath,
  getTikTokProfileDir,
  launchTikTokLoginBrowser,
  syncTikTokProfile
};