const fs = require('fs');
const path = require('path');

// 1. Impor dari platform Instagram
const { uploadToInstagram } = require('../platforms/instagram/uploader');
const {
  loadSessionFromFile,
  loadInstagramSession,
  getInstagramProfileAndFeed,
  getActiveAccount,
  PROFILE_CACHE_PATH,
  TARGET_USERNAME
} = require('../platforms/instagram/sessionManager');

// 2. Impor dari platform TikTok (Murni Web Creator Studio)
const { uploadToTikTok } = require('../platforms/tiktok/tiktokUploader');
const { uploadToFacebookReels } = require('../platforms/facebook/facebookReelsUploader');

// Akun Facebook Page di registri + profil Chrome akun Facebook pengelolanya
function resolveFacebookPage(item) {
  try {
    const sm = require('../platforms/instagram/sessionManager');
    const reg = sm.getAccountsRegistry();
    const clean = (v) => String(v || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const acc = reg.accounts.find((a) => a.id === item.accountRef)
      || reg.accounts.find((a) => a.platform === 'facebook' && (clean(a.username) === clean(item.accountId) || clean(a.username) === clean(item.accountUsername)));
    if (!acc) return null;
    const fbFile = path.join(sm.SESSIONS_DIR, 'facebook_accounts.json');
    const fbList = fs.existsSync(fbFile) ? JSON.parse(fs.readFileSync(fbFile, 'utf-8')) : [];
    const fb = fbList.find((f) => f.id === acc.facebookId);
    return { acc, fb, profileDir: fb?.profileDir || '' };
  } catch (e) {
    return null;
  }
}
const perfProfile = require('./perfProfile');
const { enhanceVideoForTikTok } = require('./videoEnhancer');

// 3. Path direktori sessions
const ROOT_DIR = process.cwd();
const SESSIONS_DIR = path.resolve(ROOT_DIR, 'sessions');
const SCHEDULES_FILE_PATH = path.join(SESSIONS_DIR, 'schedules.json');
// Catatan video yang sudah berhasil diposting per produk (PID → id jadwal); tidak berkurang saat riwayat jadwal dihapus
const PRODUCT_VIDEOS_FILE_PATH = path.join(SESSIONS_DIR, 'product_video_posts.json');

let isScheduleRunnerBusy = false;

function loadSchedulesList() {
  if (fs.existsSync(SCHEDULES_FILE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE_PATH, 'utf-8'));
    } catch (e) {}
  }
  return [];
}

function saveSchedulesList(list) {
  try {
    fs.writeFileSync(SCHEDULES_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {}
  recordPostedProductVideos(list);
}

function loadProductVideoPosts() {
  try {
    if (fs.existsSync(PRODUCT_VIDEOS_FILE_PATH)) return JSON.parse(fs.readFileSync(PRODUCT_VIDEOS_FILE_PATH, 'utf-8')) || {};
  } catch (e) {}
  return {};
}

// Catat jadwal berstatus berhasil yang menautkan produk (PID); aman dipanggil berulang
function recordPostedProductVideos(list) {
  const posts = loadProductVideoPosts();
  let changed = false;
  for (const item of Array.isArray(list) ? list : []) {
    const pid = String(item?.productId || item?.productPid || '').replace(/[^\d]/g, '');
    if (!pid || !['success', 'selesai'].includes(item.status)) continue;
    const ids = posts[pid] || (posts[pid] = []);
    if (!ids.includes(String(item.id))) {
      ids.push(String(item.id));
      changed = true;
    }
  }
  if (changed) {
    try {
      fs.writeFileSync(PRODUCT_VIDEOS_FILE_PATH, JSON.stringify(posts, null, 2), 'utf-8');
    } catch (e) {}
  }
  return posts;
}

// Jumlah video terposting per PID, contoh { "1737072959279761070": 2 }
function getProductVideoCounts() {
  const posts = recordPostedProductVideos(loadSchedulesList());
  return Object.fromEntries(Object.entries(posts).map(([pid, ids]) => [pid, ids.length]));
}

// Status posting per file video (untuk tanda di galeri pemilih video halaman Jadwal).
// Jadwal menyimpan salinan "_hd" hasil peningkatan 1080p → disamakan dengan nama file asli di galeri.
// Video yang sudah berhasil diposting dicatat permanen (tetap tertandai walau jadwalnya dihapus).
const POSTED_VIDEO_FILES_PATH = path.join(SESSIONS_DIR, 'posted_video_files.json');
const videoKeyOf = (filePath) => path.basename(String(filePath || '')).replace(/_hd(\.[a-z0-9]+)$/i, '$1').toLowerCase();

function getVideoPostStatus() {
  let posted = {};
  try {
    if (fs.existsSync(POSTED_VIDEO_FILES_PATH)) posted = JSON.parse(fs.readFileSync(POSTED_VIDEO_FILES_PATH, 'utf-8')) || {};
  } catch (e) {}

  const scheduled = {};
  let changed = false;
  for (const item of loadSchedulesList()) {
    const files = Array.isArray(item.mediaPaths) && item.mediaPaths.length ? item.mediaPaths : [item.filePath];
    for (const f of files) {
      const key = videoKeyOf(f);
      if (!key || !/\.(mp4|mov|webm)$/.test(key)) continue;
      if (['success', 'selesai'].includes(item.status)) {
        const ids = posted[key] || (posted[key] = []);
        if (!ids.includes(String(item.id))) { ids.push(String(item.id)); changed = true; }
      } else if (['pending', 'remote_pending', 'running'].includes(item.status)) {
        scheduled[key] = (scheduled[key] || 0) + 1;
      }
    }
  }
  if (changed) {
    try { fs.writeFileSync(POSTED_VIDEO_FILES_PATH, JSON.stringify(posted, null, 2), 'utf-8'); } catch (e) {}
  }
  // { "video_pov_123.mp4": { posted: 1, scheduled: 0 } }
  const result = {};
  for (const [key, ids] of Object.entries(posted)) result[key] = { posted: ids.length, scheduled: 0 };
  for (const [key, n] of Object.entries(scheduled)) result[key] = { posted: result[key]?.posted || 0, scheduled: n };
  return result;
}

function updateScheduleStatus(id, status, errorMsg = '') {
  const list = loadSchedulesList();
  const item = list.find((s) => String(s.id) === String(id));
  if (item) {
    item.status = status;
    if (errorMsg) item.errorMessage = errorMsg;
    item.updatedAt = new Date().toISOString();
    saveSchedulesList(list);
  }
  return list;
}

function checkAccountCookies(targetUsername, targetAccountId, isTikTok) {
  const cleanId = String(targetAccountId || targetUsername || '').trim().replace(/^@/, '').toLowerCase();
  
  if (isTikTok) {
    const candidates = [
      path.join(SESSIONS_DIR, `session_tiktok_${cleanId}.json`),
      path.join(SESSIONS_DIR, `session_${cleanId}.json`),
      path.join(SESSIONS_DIR, `tiktokshop_cookies_${cleanId}.json`),
      path.join(SESSIONS_DIR, 'session_tiktok_karuna_id.json'),
      path.join(SESSIONS_DIR, 'tiktokshop_cookies_karuna_id.json')
    ].map((p) => require('./accountFiles').readPath(p))   // folder akun dulu, lalu file lama;

    for (const f of candidates) {
      if (fs.existsSync(f)) {
        try {
          const raw = JSON.parse(fs.readFileSync(f, 'utf-8'));
          if (Array.isArray(raw) && raw.length > 0) return raw;
        } catch (e) {}
      }
    }
  }

  // Instagram / Fallback umum (sesi khusus Instagram dulu)
  let cookies = (!isTikTok && (loadInstagramSession(targetAccountId) || loadInstagramSession(targetUsername))) ||
                loadSessionFromFile(targetUsername) || 
                loadSessionFromFile(targetAccountId) || 
                loadSessionFromFile(cleanId) ||
                loadSessionFromFile();

  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    const activeAcc = typeof getActiveAccount === 'function' ? getActiveAccount() : null;
    if (activeAcc?.username) {
      cookies = loadSessionFromFile(activeAcc.username);
    }
  }

  return Array.isArray(cookies) && cookies.length > 0 ? cookies : null;
}

async function processPendingSchedulesQueue(mainWindow, showDesktopNotification) {
  if (isScheduleRunnerBusy) return;
  // Perangkat ringan: jangan buka Chrome TikTok saat Chrome render masih berjalan (dicoba lagi di putaran berikutnya)
  if (perfProfile.getPerfProfile().lite && perfProfile.isTaskActive('render')) return;

  const schedules = loadSchedulesList();
  const now = new Date();

  // Ambil antrean pending yang telah jatuh tempo.
  // TikTok: jadwal langsung diproses (diunggah sekarang) dengan Schedule bawaan TikTok (maks 25 hari ke depan),
  // jadi TikTok yang memposting di jam jadwal walau PC mati. Jadwal < 16 menit lagi dimundurkan ke batas minimal TikTok.
  const EARLY_MIN_MS = 0;
  const EARLY_MAX_MS = 25 * 24 * 3600 * 1000;
  const pendingList = schedules.filter((s) => s.status === 'pending');
  const dueItem = pendingList.find((s) => new Date(s.scheduleTime) <= now);
  const earlyItem = dueItem ? null : pendingList
    .filter((s) => {
      if (!['tiktok', 'facebook', 'instagram'].includes((s.platform || '').toLowerCase()) || s.noTikTokSchedule) return false;
      const left = new Date(s.scheduleTime).getTime() - now.getTime();
      return left > EARLY_MIN_MS && left <= EARLY_MAX_MS;
    })
    .sort((a, b) => new Date(a.scheduleTime) - new Date(b.scheduleTime))[0];
  const currentItem = dueItem || earlyItem;

  if (!currentItem) return;
  const useTikTokSchedule = Boolean(earlyItem);

  const targetAccountId = currentItem.accountId;
  const targetUsername = currentItem.accountUsername || '';
  const isTikTok = (currentItem.platform || '').toLowerCase() === 'tiktok';
  const isFacebook = (currentItem.platform || '').toLowerCase() === 'facebook';
  const platformLabel = isTikTok ? 'TikTok' : (isFacebook ? 'Facebook' : 'Instagram');
  const fbTarget = isFacebook ? resolveFacebookPage(currentItem) : null;
  // Jadwal lama tidak menyimpan accountUsername → pakai accountId (username akun yang dipilih)
  const accountUser = targetUsername || targetAccountId || (isTikTok ? 'karuna_id' : TARGET_USERNAME);

  // Shopee Video: posting otomatis lewat HP Android asli + Tap-Server (ADB).
  if ((currentItem.platform || '').toLowerCase() === 'shopee') {
    const sendShopee = (status, message) => {
      const updated = updateScheduleStatus(currentItem.id, status, message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', { id: currentItem.id, status, message });
        mainWindow.webContents.send('schedules-updated', updated);
      }
    };
    const shopeeFiles = currentItem.mediaPaths || (currentItem.filePath ? [currentItem.filePath] : []);
    const shopeeVideo = shopeeFiles.find((f) => f && fs.existsSync(f));
    if (!shopeeVideo) { sendShopee('failed', 'Berkas video Shopee tidak ditemukan di komputer.'); return; }
    if (isScheduleRunnerBusy) return;
    isScheduleRunnerBusy = true;
    try {
      const { postShopeeVideo } = require('../platforms/shopee/shopeeAdbUploader');
      const links = currentItem.shopeeProductLinks
        || currentItem.productLinks
        || (currentItem.productLink ? [currentItem.productLink] : []);
      // akun jadwal → HP miliknya (nomor seri) + username untuk dicek di HP (cegah salah akun)
      let shpAcc = null;
      try {
        const reg = require('../platforms/instagram/sessionManager').getAccountsRegistry();
        shpAcc = (reg.accounts || []).find((a) => a.id === currentItem.accountRef)
          || (reg.accounts || []).find((a) => a.platform === 'shopee'
            && String(a.username || '').toLowerCase() === String(currentItem.accountUsername || '').toLowerCase());
      } catch (e) {}
      if (shpAcc && shpAcc.connectMethod === 'hp' && !shpAcc.shopeeSerialNo) {
        sendShopee('failed', `Akun Shopee @${shpAcc.username} belum terhubung ke HP. Buka Kelola Akun → "+ Hubungkan HP Shopee".`);
        return;
      }
      sendShopee('running', 'Menyiapkan posting Shopee Video via HP...');
      const res = await postShopeeVideo({
        videoPath: shopeeVideo,
        caption: currentItem.caption || '',
        productLinks: links,
        serialNo: shpAcc?.shopeeSerialNo || '',
        expectUsername: shpAcc?.connectMethod === 'hp' ? shpAcc.username : '',
        onProgress: (msg) => sendShopee('running', msg)
      });
      if (res && res.success) sendShopee('success', res.posted ? 'Video Shopee berhasil diposting.' : 'Shopee: siap (berhenti sebelum Posting).');
      else sendShopee('failed', 'Posting Shopee gagal.');
    } catch (e) {
      sendShopee('failed', `Posting Shopee gagal: ${e.message}`);
    } finally {
      isScheduleRunnerBusy = false;
    }
    return;
  }

  // 1. Validasi keberadaan file media fisik
  const files = currentItem.mediaPaths || (currentItem.filePath ? [currentItem.filePath] : []);
  const validFiles = files.filter((f) => f && fs.existsSync(f));

  if (validFiles.length === 0) {
    const errMsg = `Berkas video fisik untuk jadwal ID ${currentItem.id} tidak ditemukan di komputer.`;
    console.warn(`[Queue Runner] ${errMsg}`);
    const updated = updateScheduleStatus(currentItem.id, 'failed', errMsg);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-status', { id: currentItem.id, status: 'failed', message: errMsg });
      mainWindow.webContents.send('schedules-updated', updated);
    }
    return;
  }

  // 2. Validasi sesi login akun
  const cookies = isFacebook
    ? (fbTarget?.profileDir && fs.existsSync(fbTarget.profileDir) ? [true] : null)
    : checkAccountCookies(targetUsername, targetAccountId, isTikTok);
  if (!cookies) {
    const errMsg = isFacebook
      ? `Facebook Page "${accountUser}" atau akun Facebook pengelolanya tidak ditemukan. Login Facebook ulang di Kelola Akun.`
      : `Sesi cookie tidak ditemukan untuk akun ${platformLabel}: @${accountUser}`;
    console.warn(`[Queue Runner] ${errMsg}`);
    const updated = updateScheduleStatus(currentItem.id, 'failed', errMsg);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-status', { id: currentItem.id, status: 'failed', message: errMsg });
      mainWindow.webContents.send('schedules-updated', updated);
    }
    return;
  }

  isScheduleRunnerBusy = true;
  console.log(`[Queue Runner] Menjalankan jadwal posting ${platformLabel} (ID: ${currentItem.id}) untuk @${accountUser}`);
  const updatedRunning = updateScheduleStatus(currentItem.id, 'running');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('upload-status', {
      id: currentItem.id,
      status: 'running',
      message: `Mempersiapkan publikasi ke ${platformLabel}...`
    });
    mainWindow.webContents.send('schedules-updated', updatedRunning);
  }

  try {
    let result = { success: false, message: '' };

    if (isTikTok) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', {
          id: currentItem.id,
          status: 'running',
          message: 'Membuka TikTok Studio Web via Playwright...'
        });
      }

      // Jadwal lama (dibuat sebelum fitur HD) juga ditingkatkan ke 1080p; file _hd yang sudah ada dipakai ulang
      const uploadFiles = await Promise.all(validFiles.map((f) => enhanceVideoForTikTok(f, (msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('upload-status', { id: currentItem.id, status: 'running', message: msg });
        }
      })));

      result = await uploadToTikTok({
        accountId: targetAccountId || targetUsername || 'karuna_id',
        mediaPaths: uploadFiles,
        caption: currentItem.caption || '',
        productId: currentItem.productId || currentItem.productPid || '', // Kirim PID ke uploader
        productLinkTitle: currentItem.productLinkTitle || '', // Judul keranjang kuning manual (kosong = AI)
        concept: currentItem.concept || '', // Pengaturan audio per konsep (JJ / Daster / Sensasi)
        scheduleAt: useTikTokSchedule ? new Date(currentItem.scheduleTime).toISOString() : '',
        onProgress: (msg) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('upload-status', {
              id: currentItem.id,
              status: 'running',
              message: msg
            });
          }
        }
      });
    } else if (isFacebook) {
      result = await uploadToFacebookReels({
        mediaPaths: validFiles,
        caption: currentItem.caption || '',
        pageId: fbTarget.acc.pageId,
        profileDir: fbTarget.profileDir,
        scheduleAt: useTikTokSchedule ? new Date(currentItem.scheduleTime).toISOString() : '',
        onProgress: (msg) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('upload-status', { id: currentItem.id, status: 'running', message: msg });
          }
        }
      });
      if (result && result.facebookScheduled) result.tiktokScheduled = true; // tanda "terjadwal di platform"
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', {
          id: currentItem.id,
          status: 'running',
          message: 'Mengunggah postingan via Web Instagram...'
        });
      }

      result = await uploadToInstagram({
        mediaPaths: validFiles,
        caption: currentItem.caption || '',
        accountUsername: accountUser,
        accountId: currentItem.accountRef || targetAccountId,
        scheduleAt: useTikTokSchedule ? new Date(currentItem.scheduleTime).toISOString() : '',
        shareToFacebook: typeof currentItem.shareToFacebook === 'boolean' ? currentItem.shareToFacebook : null,
        onProgress: (msg) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('upload-status', {
              id: currentItem.id,
              status: 'running',
              message: msg
            });
      if (result && result.instagramScheduled) result.tiktokScheduled = true; // tanda "terjadwal di platform"
          }
        }
      });
    }

    // Unggah awal (jadwal bawaan platform) gagal → ke catch: kembali menunggu & diposting saat jam jadwal
    if (useTikTokSchedule && !(result && result.success)) {
      throw new Error(result?.message || result?.error || `Unggah awal ke ${platformLabel} gagal.`);
    }

    if (result && result.success) {
      if (result.tiktokScheduled) {
        const l = loadSchedulesList();
        const it = l.find((x) => String(x.id) === String(currentItem.id));
        if (it) {
          it.tiktokScheduled = true;
          it.tiktokScheduledFor = result.scheduledFor || '';
          // Platform bisa memundurkan jam (min. 15-20 menit ke depan, kelipatan 5 menit) → tampilkan jam yang benar-benar dipakai
          if (result.scheduledFor && new Date(result.scheduledFor).getTime() !== new Date(it.scheduleTime).getTime()) {
            if (!it.originalScheduleTime) it.originalScheduleTime = it.scheduleTime;
            it.scheduleTime = result.scheduledFor;
            currentItem.scheduleTime = result.scheduledFor;
          }
          saveSchedulesList(l);
        }
      }
      const updatedSuccess = updateScheduleStatus(currentItem.id, 'success');

      if (typeof showDesktopNotification === 'function') {
        showDesktopNotification(
          result.tiktokScheduled ? `Terjadwal di ${platformLabel} ✅` : `Posting ${platformLabel} Berhasil! 🎉`,
          result.tiktokScheduled ? `Video @${accountUser} sudah diunggah & akan diposting ${platformLabel} pada ${new Date(currentItem.scheduleTime).toLocaleString('id-ID')}.` : `Konten berhasil dipublikasikan untuk akun @${accountUser}.`,
          true
        );
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', {
          id: currentItem.id,
          status: 'success',
          message: result.tiktokScheduled ? `Video sudah diunggah & terjadwal di ${platformLabel}.` : `Postingan berhasil dipublikasikan ke ${platformLabel}!`
        });
        mainWindow.webContents.send('schedules-updated', updatedSuccess);
        mainWindow.webContents.send('profile-updated');
      }

      if (!isTikTok && !isFacebook) {
        if (fs.existsSync(PROFILE_CACHE_PATH)) {
          try { fs.unlinkSync(PROFILE_CACHE_PATH); } catch (e) {}
        }

        getInstagramProfileAndFeed().then((freshData) => {
          if (freshData && freshData.profile) {
            const updatedCache = { ...freshData.profile, posts: freshData.posts || [] };
            try { fs.writeFileSync(PROFILE_CACHE_PATH, JSON.stringify(updatedCache, null, 2)); } catch (e) {}
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('profile-updated', { 
                profile: updatedCache, 
                posts: freshData.posts || [] 
              });
            }
          }
        }).catch(() => {});
      }
    } else {
      const errMsg = result?.message || result?.error || `Gagal publikasi ke ${platformLabel}.`;
      const updatedFailed = updateScheduleStatus(currentItem.id, 'failed', errMsg);

      if (typeof showDesktopNotification === 'function') {
        showDesktopNotification(
          `Posting ${platformLabel} Gagal ❌`,
          `Gagal publikasi ke @${accountUser}: ${errMsg}`,
          false
        );
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', {
          id: currentItem.id,
          status: 'failed',
          message: `Gagal upload: ${errMsg}`
        });
        mainWindow.webContents.send('schedules-updated', updatedFailed);
      }
    }
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    if (useTikTokSchedule) {
      // Unggah awal gagal → kembali menunggu; saat jatuh tempo diposting cara lama (Now)
      const l = loadSchedulesList();
      const it = l.find((x) => String(x.id) === String(currentItem.id));
      if (it) {
        it.status = 'pending';
        it.noTikTokSchedule = true;
        it.errorMessage = `Jadwal ${platformLabel} gagal (${errorText}) → akan diposting saat jam jadwal.`;
        it.updatedAt = new Date().toISOString();
        saveSchedulesList(l);
      }
      console.warn(`[Queue Runner] Unggah awal (jadwal TikTok) gagal → menunggu jam jadwal: ${errorText}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', { id: currentItem.id, status: 'pending', message: `Jadwal ${platformLabel} gagal → akan diposting saat jam jadwal. (${errorText})` });
        mainWindow.webContents.send('schedules-updated', l);
      }
      return;
    }
    const updatedError = updateScheduleStatus(currentItem.id, 'failed', errorText);

    if (typeof showDesktopNotification === 'function') {
      showDesktopNotification(
        `Posting ${platformLabel} Gagal ❌`,
        `Terjadi kendala pada @${accountUser}: ${errorText}`,
        false
      );
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-status', {
        id: currentItem.id,
        status: 'failed',
        message: `Terjadi kendala: ${errorText}`
      });
      mainWindow.webContents.send('schedules-updated', updatedError);
    }
  } finally {
    isScheduleRunnerBusy = false;
  }
}

module.exports = {
  loadSchedulesList,
  saveSchedulesList,
  getProductVideoCounts,
  getVideoPostStatus,
  processPendingSchedulesQueue
};