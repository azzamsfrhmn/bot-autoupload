const { BrowserWindow, session, net } = require('electron');
const fs = require('fs');
const path = require('path');

// File per akun di sessions/akun/<platform>_<username>/ (baca: folder akun dulu, lalu file lama)
const af = require('../../core/accountFiles');

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const ACCOUNTS_REGISTRY_PATH = path.join(SESSIONS_DIR, 'accounts_registry.json');
const DEFAULT_SESSION_FILE = path.join(SESSIONS_DIR, 'instagram_session.json');

let TARGET_USERNAME = 'etnicpremium';

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Bersihkan nama username agar aman dijadikan nama file Windows/Linux
function sanitizeAccountFilename(name) {
  if (!name) return 'default';
  return String(name).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

// Path cache profil untuk DIBACA (folder akun bila ada, selain itu file lama)
function getAccountCachePath(accountId) {
  const safeId = sanitizeAccountFilename(accountId);
  return af.readPath(path.join(SESSIONS_DIR, `profile_cache_${safeId}.json`));
}
// Path cache profil untuk DITULIS (folder akun)
function getAccountCacheWritePath(accountId) {
  const safeId = sanitizeAccountFilename(accountId);
  return af.writePath(path.join(SESSIONS_DIR, `profile_cache_${safeId}.json`));
}

function getAccountAvatarPath(accountId) {
  const safeId = sanitizeAccountFilename(accountId);
  return path.join(SESSIONS_DIR, `profile_avatar_${safeId}.jpg`);
}

// =============================================================================
// MANAJEMEN REGISTRI MULTI-AKUN (INSTAGRAM & TIKTOK)
// =============================================================================

function getAccountsRegistry() {
  let reg = { activeAccountId: '', accounts: [] };

  if (fs.existsSync(ACCOUNTS_REGISTRY_PATH)) {
    try {
      reg = JSON.parse(fs.readFileSync(ACCOUNTS_REGISTRY_PATH, 'utf-8'));
      if (!Array.isArray(reg.accounts)) reg.accounts = [];
    } catch (e) {
      reg = { activeAccountId: '', accounts: [] };
    }
  }

  // Migrasi sesi default lama jika belum ada registri
  if (reg.accounts.length === 0 && fs.existsSync(DEFAULT_SESSION_FILE)) {
    const cleanUser = sanitizeAccountFilename(TARGET_USERNAME);
    const sessionPath = path.join(SESSIONS_DIR, `${cleanUser}.json`);
    
    try {
      if (!fs.existsSync(sessionPath)) {
        fs.copyFileSync(DEFAULT_SESSION_FILE, sessionPath);
      }
    } catch (e) {}

    reg.activeAccountId = cleanUser;
    reg.accounts.push({
      id: cleanUser,
      username: TARGET_USERNAME,
      platform: 'instagram',
      profilePicUrl: '',
      sessionFile: sessionPath,
      partition: `persist:ig_session_${cleanUser}`,
      createdAt: new Date().toISOString()
    });
    saveAccountsRegistry(reg);
    return reg;
  }

  let isDirty = false;
  if (reg.accounts.length > 0) {
    if (!reg.activeAccountId || !reg.accounts.some(a => a.id === reg.activeAccountId)) {
      reg.activeAccountId = reg.accounts[0].id;
      isDirty = true;
    }

    reg.accounts.forEach((acc) => {
      if (!acc.platform) {
        acc.platform = acc.id.startsWith('tt_') ? 'tiktok' : 'instagram';
        isDirty = true;
      }

      const cleanUser = sanitizeAccountFilename(acc.username || acc.id);
      if (!acc.sessionFile || !fs.existsSync(acc.sessionFile)) {
        const resolved = af.readPath(path.join(SESSIONS_DIR, `${cleanUser}.json`));
        if (acc.sessionFile !== resolved) { acc.sessionFile = resolved; isDirty = true; }
      }

      if (!acc.partition) {
        acc.partition = acc.platform === 'tiktok' 
          ? `persist:tiktok_session_${cleanUser}` 
          : `persist:ig_session_${cleanUser}`;
        isDirty = true;
      }
    });

    if (isDirty) {
      saveAccountsRegistry(reg);
    }
  }

  return reg;
}

function saveAccountsRegistry(data) {
  try {
    fs.writeFileSync(ACCOUNTS_REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[SessionManager] Gagal menyimpan accounts_registry.json:', err);
  }
}

function getActiveAccount() {
  const reg = getAccountsRegistry();
  if (!reg.accounts || reg.accounts.length === 0) return null;
  const active = reg.accounts.find((a) => a.id === reg.activeAccountId);
  return active || reg.accounts[0];
}

function setActiveAccount(accountId) {
  const reg = getAccountsRegistry();
  const target = reg.accounts.find((a) => a.id === accountId || a.username === accountId);
  if (target) {
    reg.activeAccountId = target.id;
    if (target.platform === 'instagram') {
      TARGET_USERNAME = target.username || TARGET_USERNAME;
    }
    saveAccountsRegistry(reg);
    return target;
  }
  return null;
}

function getActivePartitionName() {
  const active = getActiveAccount();
  if (active) {
    const cleanUser = sanitizeAccountFilename(active.username || active.id);
    return active.partition || (active.platform === 'tiktok' ? `persist:tiktok_session_${cleanUser}` : `persist:ig_session_${cleanUser}`);
  }
  return 'persist:ig_session';
}

function getActiveSessionFilePath() {
  const active = getActiveAccount();
  if (!active) return DEFAULT_SESSION_FILE;
  const cleanUser = sanitizeAccountFilename(active.username || active.id);
  const preferred = af.readPath(path.join(SESSIONS_DIR, `${cleanUser}.json`));
  if (fs.existsSync(preferred)) return preferred;
  return active.sessionFile || DEFAULT_SESSION_FILE;
}

// =============================================================================
// SIMPAN & AMBIL SESI COOKIES (NAMA FILE SESUAI USERNAME AKUN)
// =============================================================================

function saveSessionToFile(cookies, accountIdentifier = null) {
  try {
    const reg = getAccountsRegistry();
    const curActive = getActiveAccount();

    let cleanName = '';
    let targetAcc = null;

    if (accountIdentifier) {
      targetAcc = reg.accounts.find(a => a.id === accountIdentifier || a.username === accountIdentifier);
      cleanName = sanitizeAccountFilename(targetAcc?.username || accountIdentifier);
    } else {
      cleanName = sanitizeAccountFilename(curActive?.username || curActive?.id || TARGET_USERNAME);
    }

    // Folder akun (sessions/akun/<platform>_<username>/session.json) bila akun dikenal
    const namedFilePath = af.writePath(path.join(SESSIONS_DIR, `${cleanName}.json`), targetAcc || null);

    fs.writeFileSync(namedFilePath, JSON.stringify(cookies, null, 2), 'utf-8');

    // salinan session_<id>.json hanya untuk akun yang belum punya folder (format lama)
    if (targetAcc?.id && targetAcc.id !== cleanName && namedFilePath === path.join(SESSIONS_DIR, `${cleanName}.json`)) {
      try {
        fs.writeFileSync(path.join(SESSIONS_DIR, `session_${targetAcc.id}.json`), JSON.stringify(cookies, null, 2), 'utf-8');
      } catch (e) {}
    }

    if (!curActive || curActive.platform === 'instagram') {
      try {
        fs.writeFileSync(DEFAULT_SESSION_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
      } catch (e) {}
    }

    const accIndex = reg.accounts.findIndex((a) => a.id === (targetAcc?.id || accountIdentifier || curActive?.id));
    if (accIndex >= 0) {
      reg.accounts[accIndex].sessionFile = namedFilePath;
      reg.accounts[accIndex].lastUpdated = new Date().toISOString();
      saveAccountsRegistry(reg);
    }
    return namedFilePath;
  } catch (err) {
    console.error('[Session Error]', err);
    return null;
  }
}

function loadSessionFromFile(accountIdentifier = null) {
  try {
    const reg = getAccountsRegistry();
    let candidates = [];

    if (accountIdentifier) {
      const cleanInput = sanitizeAccountFilename(accountIdentifier);
      const matched = reg.accounts.find(a => a.id === accountIdentifier || a.username === accountIdentifier);
      const cleanUser = matched ? sanitizeAccountFilename(matched.username) : '';

      if (cleanUser) candidates.push(af.readPath(path.join(SESSIONS_DIR, `${cleanUser}.json`)));
      candidates.push(af.readPath(path.join(SESSIONS_DIR, `${cleanInput}.json`)));
      candidates.push(af.readPath(path.join(SESSIONS_DIR, `session_${accountIdentifier}.json`)));
      if (matched?.sessionFile) candidates.push(matched.sessionFile);
    } else {
      candidates.push(getActiveSessionFilePath());
    }

    candidates.push(DEFAULT_SESSION_FILE);

    for (const filePath of candidates) {
      if (filePath && fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error('[loadSessionFromFile Error]:', err.message);
  }
  return null;
}

// Sesi khusus akun Instagram (instagram_<user>.json) — dicari per akun Instagram agar tidak tertukar dengan akun TikTok ber-username sama
function loadInstagramSession(identifier) {
  try {
    const key = sanitizeAccountFilename(identifier);
    if (!key || key === 'default') return null;
    const reg = getAccountsRegistry();
    const acc = reg.accounts.find((a) => a.platform === 'instagram'
      && [a.id, a.username].some((v) => v && (sanitizeAccountFilename(v) === key || sanitizeAccountFilename(v) === `ig_${key}`)));
    const files = [acc?.sessionFile, af.readPath(path.join(SESSIONS_DIR, `instagram_${key.replace(/^ig_/, '')}.json`))].filter(Boolean);
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('[loadInstagramSession Error]:', err.message);
  }
  return null;
}

async function downloadAvatarToLocal(remoteUrl, partitionName = null, accountId = null) {
  if (!remoteUrl || !remoteUrl.startsWith('http')) return null;

  const targetId = sanitizeAccountFilename(accountId || getActiveAccount()?.username || 'default');
  const avatarFilePath = getAccountAvatarPath(targetId);

  return new Promise((resolve) => {
    try {
      const part = partitionName || getActivePartitionName();
      const customSession = session.fromPartition(part);
      const request = net.request({
        url: remoteUrl,
        session: customSession
      });

      request.setHeader('Referer', 'https://www.instagram.com/');
      request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
      request.setHeader('Accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');

      const chunks = [];
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }

        response.on('data', (chunk) => chunks.push(chunk));

        response.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            fs.writeFileSync(avatarFilePath, buffer);
            const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            resolve(base64Image);
          } catch (e) {
            resolve(null);
          }
        });
      });

      request.on('error', () => resolve(null));
      request.end();
    } catch (e) {
      resolve(null);
    }
  });
}

function getCachedProfile(accountId = null) {
  const targetId = sanitizeAccountFilename(accountId || getActiveAccount()?.username || 'default');
  const cacheFile = getAccountCachePath(targetId);
  const avatarFile = getAccountAvatarPath(targetId);

  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (fs.existsSync(avatarFile)) {
        const buf = fs.readFileSync(avatarFile);
        cached.profilePicUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
      return cached;
    }
  } catch (e) {}
  return null;
}

async function restoreSessionToPartition(partitionName = null) {
  const active = getActiveAccount();
  const cookies = (active?.platform === 'instagram' ? loadInstagramSession(active.id) : null)
    || loadSessionFromFile(active?.username || active?.id);
  if (!cookies || !Array.isArray(cookies)) return false;

  const part = partitionName || getActivePartitionName();
  const customSession = session.fromPartition(part);

  for (const cookie of cookies) {
    const protocol = cookie.secure ? 'https://' : 'http://';
    const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    const url = `${protocol}${domain}${cookie.path || '/'}`;

    try {
      await customSession.cookies.set({
        url: url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate
      });
    } catch (err) {}
  }
  return true;
}

function saveAccountSession(accountData, cookies) {
  const reg = getAccountsRegistry();
  const platform = accountData.platform || 'instagram';
  const rawUsername = accountData.username || (platform === 'tiktok' ? 'tiktok_creator' : TARGET_USERNAME);
  const cleanUsername = sanitizeAccountFilename(rawUsername);
  
  // akun mungkin belum ada di registri → beri hint platform+username agar langsung ke foldernya
  const sessionFilePath = af.writePath(path.join(SESSIONS_DIR, `${cleanUsername}.json`), { platform, username: rawUsername });
  fs.writeFileSync(sessionFilePath, JSON.stringify(cookies, null, 2), 'utf-8');

  const partitionName = platform === 'tiktok' 
    ? `persist:tiktok_session_${cleanUsername}` 
    : `persist:ig_session_${cleanUsername}`;

  const targetId = accountData.id || cleanUsername;

  const info = {
    id: targetId,
    username: rawUsername.replace(/^@/, '').trim(),
    platform: platform,
    profilePicUrl: accountData.profilePicUrl || '',
    sessionFile: sessionFilePath,
    partition: partitionName,
    lastActive: new Date().toISOString()
  };

  const existingIdx = reg.accounts.findIndex((a) => a.id === targetId || a.username.toLowerCase() === rawUsername.toLowerCase());
  if (existingIdx >= 0) {
    reg.accounts[existingIdx] = { ...reg.accounts[existingIdx], ...info };
  } else {
    reg.accounts.push(info);
  }

  reg.activeAccountId = targetId;
  saveAccountsRegistry(reg);
  return info;
}

function removeAccount(accountId) {
  const reg = getAccountsRegistry();
  const target = reg.accounts.find((a) => a.id === accountId || a.username === accountId);
  if (target) {
    const cleanUser = sanitizeAccountFilename(target.username || target.id);
    const candidateFiles = [
      target.sessionFile,
      path.join(SESSIONS_DIR, `${cleanUser}.json`),
      path.join(SESSIONS_DIR, `session_${target.id}.json`)
    ];

    candidateFiles.forEach((f) => {
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    });

    const cacheFile = getAccountCachePath(cleanUser);
    const avatarFile = getAccountAvatarPath(cleanUser);
    if (fs.existsSync(cacheFile)) try { fs.unlinkSync(cacheFile); } catch (e) {}
    if (fs.existsSync(avatarFile)) try { fs.unlinkSync(avatarFile); } catch (e) {}

    // Hapus folder akun (sessions/akun/<platform>_<username>/) beserta isinya
    try {
      const dir = af.accountDir(target);
      if (dir && dir.startsWith(af.ACCOUNT_ROOT()) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}

    reg.accounts = reg.accounts.filter((a) => a.id !== target.id && a.username !== target.username);
    if (reg.activeAccountId === target.id) {
      reg.activeAccountId = reg.accounts[0]?.id || '';
    }
    saveAccountsRegistry(reg);
    return true;
  }
  return false;
}

// =============================================================================
// AMBIL PROFIL & FEED REALTIME (DENGAN SMART MERGE & ANTI-WIPING)
// =============================================================================

async function getInstagramProfileAndFeed() {
  const activeAccount = getActiveAccount();
  const accIdentifier = activeAccount?.username || activeAccount?.id || 'default';
  const existingCache = getCachedProfile(accIdentifier);

  if (activeAccount?.platform === 'tiktok') {
    return {
      profile: {
        username: activeAccount.username || 'tiktok_creator',
        fullName: activeAccount.username || 'TikTok Creator',
        category: 'Kreator TikTok',
        biography: '',
        externalUrl: '',
        postsCount: 0,
        followersCount: 0,
        followingCount: 0,
        profilePicUrl: activeAccount.profilePicUrl || ''
      },
      posts: []
    };
  }

  const part = getActivePartitionName();
  await restoreSessionToPartition(part);

  const customSession = session.fromPartition(part);
  let currentTarget = activeAccount?.username || TARGET_USERNAME;

  return new Promise((resolve) => {
    const bgWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        session: customSession,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    bgWindow.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    let isResolved = false;

    const cleanup = () => {
      if (!bgWindow.isDestroyed()) bgWindow.destroy();
    };

    const finishWithFallback = () => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve({ profile: existingCache || null, posts: existingCache?.posts || [] });
    };

    const timeout = setTimeout(() => {
      finishWithFallback();
    }, 25000);

    bgWindow.webContents.on('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 3500));
        await bgWindow.webContents.executeJavaScript(`window.scrollTo(0, 400);`);
        await new Promise((r) => setTimeout(r, 2000));

        const result = await bgWindow.webContents.executeJavaScript(`
          (() => {
            try {
              const mainScope = document.querySelector('main') || document.body;
              const headerEl = mainScope.querySelector('header') || mainScope;

              let realUsername = '';
              const h2User = headerEl.querySelector('h2');
              if (h2User && h2User.textContent) {
                realUsername = h2User.textContent.trim();
              }
              if (!realUsername) {
                const parts = window.location.pathname.split('/').filter(Boolean);
                if (parts.length > 0 && !['accounts', 'explore', 'reels', 'direct'].includes(parts[0])) {
                  realUsername = parts[0];
                }
              }

              let avatarUrl = '';
              const headerImg = headerEl.querySelector('button[title*="photo" i] img, button[title*="foto" i] img, div[style*="150px"] img, header img');
              if (headerImg) {
                const src = headerImg.currentSrc || headerImg.src || '';
                if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
                  avatarUrl = src;
                }
              }

              let postsCount = 0;
              let followersCount = 0;
              let followingCount = 0;

              const parseNum = (str) => {
                if (!str) return 0;
                const clean = str.toLowerCase().trim().replace(/,/g, '.');
                let mult = 1;
                if (clean.includes('k') || clean.includes('rb')) mult = 1000;
                if (clean.includes('m') || clean.includes('jt')) mult = 1000000;
                const n = parseFloat(clean.replace(/[^0-9.]/g, ''));
                return isNaN(n) ? 0 : Math.round(n * mult);
              };

              const statElements = Array.from(headerEl.querySelectorAll('span, a, div, li'));
              for (const el of statElements) {
                const txt = (el.textContent || '').trim();
                if (!txt || txt.length > 60) continue;

                if (!postsCount && /\\b([0-9.,]+)\\s*(?:posts|kiriman)\\b/i.test(txt)) {
                  const m = txt.match(/([0-9.,]+)\\s*(?:posts|kiriman)/i);
                  if (m) postsCount = parseInt(m[1].replace(/[^0-9]/g, ''), 10);
                }

                if (!followersCount && /\\b([0-9.,]+(?:k|m|rb|jt)?)\\s*(?:followers|pengikut)\\b/i.test(txt)) {
                  const titleAttr = el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title');
                  if (titleAttr && /^[0-9.,]+$/.test(titleAttr.trim())) {
                    followersCount = parseInt(titleAttr.replace(/[^0-9]/g, ''), 10);
                  } else {
                    const m = txt.match(/([0-9.,]+(?:k|m|rb|jt)?)\\s*(?:followers|pengikut)/i);
                    if (m) followersCount = parseNum(m[1]);
                  }
                }

                if (!followingCount && /\\b([0-9.,]+(?:k|m|rb|jt)?)\\s*(?:following|mengikuti)\\b/i.test(txt)) {
                  const titleAttr = el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title');
                  if (titleAttr && /^[0-9.,]+$/.test(titleAttr.trim())) {
                    followingCount = parseInt(titleAttr.replace(/[^0-9]/g, ''), 10);
                  } else {
                    const m = txt.match(/([0-9.,]+(?:k|m|rb|jt)?)\\s*(?:following|mengikuti)/i);
                    if (m) followingCount = parseNum(m[1]);
                  }
                }
              }

              let biography = '';
              let externalUrl = '';

              const bioSpan = headerEl.querySelector('span._ap3a div span._ap3a') || headerEl.querySelector('span._ap3a') || headerEl.querySelector('h1 + div');
              if (bioSpan) {
                biography = bioSpan.innerText ? bioSpan.innerText.trim() : bioSpan.textContent.trim();
              }

              const allBtns = Array.from(headerEl.querySelectorAll('button div, a, span'));
              for (const b of allBtns) {
                const t = (b.textContent || '').trim();
                if (t.includes('wa.me')) {
                  const m = t.match(/(wa\\.me\\/[0-9]+)/);
                  if (m) {
                    externalUrl = 'https://' + m[1];
                    break;
                  }
                }
              }

              const postLinks = Array.from(mainScope.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
              const posts = [];
              const seen = new Set();

              postLinks.forEach(a => {
                const href = a.getAttribute('href') || '';
                const parts = href.split('/').filter(Boolean);
                const code = parts[parts.length - 1] || href;

                if (!seen.has(code)) {
                  const img = a.querySelector('img');
                  if (img) {
                    const imgSrc = img.currentSrc || img.src || '';
                    if (imgSrc) {
                      seen.add(code);
                      posts.push({
                        id: code,
                        shortcode: code,
                        imageUrl: imgSrc,
                        isVideo: href.includes('/reel/'),
                        likeCount: 0,
                        commentCount: 0,
                        caption: img.alt || ''
                      });
                    }
                  }
                }
              });

              return {
                detectedUsername: realUsername,
                profile: {
                  username: realUsername || '${currentTarget}',
                  fullName: realUsername || '${currentTarget}',
                  category: 'AKUN BISNIS / KREATOR',
                  biography: biography,
                  externalUrl: externalUrl,
                  postsCount: postsCount || posts.length,
                  followersCount: followersCount,
                  followingCount: followingCount,
                  profilePicUrl: avatarUrl
                },
                posts: posts
              };
            } catch (err) {
              return { error: err.message, posts: [] };
            }
          })()
        `);

        clearTimeout(timeout);
        cleanup();
        isResolved = true;

        if (result && result.profile) {
          // --- SMART MERGE: Pertahankan data lama jika scraping menghasilkan nilai kosong / 0 ---
          const mergedProfile = {
            username: result.profile.username || existingCache?.username || currentTarget,
            fullName: result.profile.fullName || existingCache?.fullName || currentTarget,
            category: result.profile.category || existingCache?.category || 'AKUN BISNIS / KREATOR',
            biography: result.profile.biography || existingCache?.biography || '',
            externalUrl: result.profile.externalUrl || existingCache?.externalUrl || '',
            postsCount: result.profile.postsCount || existingCache?.postsCount || 0,
            followersCount: result.profile.followersCount || existingCache?.followersCount || 0,
            followingCount: result.profile.followingCount || existingCache?.followingCount || 0,
            profilePicUrl: existingCache?.profilePicUrl || ''
          };

          if (result.detectedUsername && activeAccount) {
            const reg = getAccountsRegistry();
            const idx = reg.accounts.findIndex((a) => a.id === activeAccount.id);
            if (idx >= 0 && reg.accounts[idx].username !== result.detectedUsername) {
              reg.accounts[idx].username = result.detectedUsername;
              saveAccountsRegistry(reg);
            }
          }

          // Unduh avatar jika ada URL baru, JANGAN hapus avatar lama jika fetch avatar gagal/kosong
          if (result.profile.profilePicUrl && result.profile.profilePicUrl.startsWith('http')) {
            const base64Avatar = await downloadAvatarToLocal(result.profile.profilePicUrl, part, accIdentifier);
            if (base64Avatar) {
              mergedProfile.profilePicUrl = base64Avatar;
            }
          }

          if (activeAccount && mergedProfile.profilePicUrl) {
            const reg = getAccountsRegistry();
            const idx = reg.accounts.findIndex((a) => a.id === activeAccount.id);
            if (idx >= 0) {
              reg.accounts[idx].profilePicUrl = mergedProfile.profilePicUrl;
              saveAccountsRegistry(reg);
            }
          }

          const finalPosts = (result.posts && result.posts.length > 0) ? result.posts : (existingCache?.posts || []);
          mergedProfile.posts = finalPosts;

          try {
            fs.writeFileSync(getAccountCacheWritePath(accIdentifier), JSON.stringify(mergedProfile, null, 2), 'utf-8');
          } catch (e) {}

          resolve({ profile: mergedProfile, posts: finalPosts });
        } else {
          finishWithFallback();
        }
      } catch (err) {
        clearTimeout(timeout);
        finishWithFallback();
      }
    });

    const targetUrl = currentTarget.startsWith('user_') 
      ? 'https://www.instagram.com/' 
      : `https://www.instagram.com/${currentTarget}/`;

    bgWindow.loadURL(targetUrl);
  });
}

function clearSessionData() {
  const active = getActiveAccount();
  if (active) {
    removeAccount(active.id);
  }
  if (fs.existsSync(DEFAULT_SESSION_FILE)) {
    try { fs.unlinkSync(DEFAULT_SESSION_FILE); } catch (err) {}
  }
}

module.exports = {
  getAccountsRegistry,
  getActiveAccount,
  setActiveAccount,
  getActivePartitionName,
  getActiveSessionFilePath,
  saveAccountSession,
  removeAccount,
  saveSessionToFile,
  loadSessionFromFile,
  loadInstagramSession,
  saveAccountsRegistry,
  restoreSessionToPartition,
  getInstagramProfileAndFeed,
  clearSessionData,
  getCachedProfile,
  TARGET_USERNAME,
  PROFILE_CACHE_PATH: path.join(SESSIONS_DIR, 'profile_cache_default.json'),
  SESSION_FILE_PATH: DEFAULT_SESSION_FILE,
  LOCAL_AVATAR_PATH: path.join(SESSIONS_DIR, 'profile_avatar_default.jpg'),
  SESSIONS_DIR
};