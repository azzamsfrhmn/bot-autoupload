/**
 * src/main/ipc/scheduleIpc.js
 */
const { dialog } = require('electron');
const remoteUpload = require('../../core/remoteUploadClient');
const { enhanceVideoForTikTok } = require('../../core/videoEnhancer');

// Status job di server → status jadwal lokal (runner lokal hanya menjalankan 'pending')
const REMOTE_STATUS = {
  awaiting_media: 'remote_pending',
  pending: 'remote_pending',
  running: 'running',
  success: 'success',
  failed: 'failed',
  canceled: 'canceled'
};
const REMOTE_FINAL = ['success', 'failed', 'canceled'];

module.exports = function registerScheduleIpc(ipcMain, ctx) {
  const { loadSchedulesList, saveSchedulesList, uploadToTikTok, getActiveAccount, cleanUserIdentifier, TARGET_USERNAME } = ctx;

  // Riwayat jadwal per akun: hanya jadwal milik akun yang sedang aktif (jadwal lama tanpa data akun tetap tampil)
  ipcMain.handle('get-schedules', async () => {
    const list = loadSchedulesList();
    const acc = getActiveAccount();
    if (!acc) return list;
    const ids = new Set([acc.username, acc.id].filter(Boolean).map((v) => cleanUserIdentifier(v)));
    return list.filter((item) => {
      const owner = [item.accountId, item.accountUsername].filter(Boolean).map((v) => cleanUserIdentifier(v));
      return owner.length === 0 || owner.some((v) => ids.has(v));
    });
  });
  ipcMain.handle('get-product-video-counts', async () => ctx.getProductVideoCounts());
  ipcMain.handle('get-video-post-status', async () => ctx.getVideoPostStatus());

  ipcMain.handle('delete-schedule', async (event, id) => {
    // Jadwal di server: batalkan juga di server (abaikan jika sudah selesai / server tak terjangkau)
    const target = loadSchedulesList().find((item) => String(item.id) === String(id));
    if (target?.remote && target.remoteJobId && !REMOTE_FINAL.includes(target.status)) {
      await remoteUpload.cancelRemoteJob(ctx.getLicenseAuth(), target.remoteJobId).catch(() => {});
    }
    let list = loadSchedulesList().filter((item) => String(item.id) !== String(id));
    saveSchedulesList(list);
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('schedules-updated', list);
    return true;
  });

  ipcMain.handle('schedule-post', async (event, { mediaPaths, caption, scheduleTime, productId, productLinkTitle, concept, shareToFacebook = null, shopeeProductLinks = null }) => {
    // 3D Edukasi: narasi di dalam video → pengaturan suara saat posting sama dengan POV
    const conceptKey = ['edu3d', 'kartun3d', 'carakerja3d'].includes(concept) ? 'pov' : (['jj', 'daster', 'sensasi', 'pov'].includes(concept) ? concept : '');
    let files = Array.isArray(mediaPaths) ? mediaPaths : [mediaPaths];
    const activeAcc = getActiveAccount();
    const targetUser = activeAcc?.username || TARGET_USERNAME;
    const cleanId = cleanUserIdentifier(targetUser);

    const platform = activeAcc?.platform || 'instagram';

    // TikTok: video 720p dari Flow ditingkatkan ke 1080p bitrate tinggi sebelum dijadwalkan / dikirim ke server
    if (platform === 'tiktok' || platform === 'facebook') {
      files = await Promise.all(files.map((f) => enhanceVideoForTikTok(f)));
    }

    // Upload 24 jam: jadwal TikTok dikirim ke Worker server (tetap jalan walau aplikasi/PC mati)
    let remoteJob = null;
    // Upload 24 jam lewat server dihapus: jadwal TikTok kini memakai Schedule bawaan TikTok (diunggah lebih awal).
    // Jadwal server yang sudah terkirim tetap diproses server & statusnya tetap disinkronkan.
    if (false && platform === 'tiktok' && remoteUpload.getRemoteConfig().enabled) {
      try {
        remoteJob = await remoteUpload.createRemoteJob({
          auth: ctx.getLicenseAuth(),
          mediaPath: files[0],
          caption: caption || '',
          productId: productId || '',
          productLinkTitle: productLinkTitle || '',
          concept: conceptKey,
          scheduleTime: new Date(scheduleTime).toISOString(),
          accountUsername: targetUser
        });
      } catch (err) {
        return { success: false, error: `Gagal mengirim jadwal ke server 24 jam: ${err.message}` };
      }
    }

    const currentList = loadSchedulesList();
    currentList.unshift({
      id: Date.now(),
      ...(remoteJob ? { remote: true, remoteJobId: remoteJob.id, remoteMessage: remoteJob.message || '' } : {}),
      mediaPaths: files,
      filePath: files[0],
      caption: caption || '',
      scheduleTime,
      productId: productId || '',
      productLinkTitle: productLinkTitle || '',
      concept: conceptKey,
      accountId: cleanId,
      accountUsername: targetUser,
      accountRef: activeAcc?.id || '', // id akun di registri (Facebook Page memakai ini)
      ...(platform === 'instagram' && typeof shareToFacebook === 'boolean' ? { shareToFacebook } : {}),
      ...(platform === 'shopee' && Array.isArray(shopeeProductLinks) && shopeeProductLinks.length ? { shopeeProductLinks } : {}),
      platform,
      status: remoteJob ? REMOTE_STATUS[remoteJob.status] || 'remote_pending' : 'pending',
      createdAt: new Date().toISOString()
    });

    saveSchedulesList(currentList);
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('schedules-updated', currentList);
    return { success: true };
  });

  // ---- Worker Upload 24 jam ----
  async function syncRemoteSchedules() {
    const list = loadSchedulesList();
    const tracked = list.filter((item) => item.remote && item.remoteJobId && !REMOTE_FINAL.includes(item.status));
    if (tracked.length === 0) return { success: true, updated: 0 };

    const remoteJobs = await remoteUpload.listRemoteJobs(ctx.getLicenseAuth());
    let updated = 0;
    for (const item of tracked) {
      const job = remoteJobs.find((j) => String(j.id) === String(item.remoteJobId));
      if (!job) continue;
      const status = REMOTE_STATUS[job.status] || item.status;
      if (status !== item.status || job.message !== item.remoteMessage) {
        item.status = status;
        item.remoteMessage = job.message;
        if (status === 'failed') item.errorMessage = job.message;
        updated++;
      }
    }
    if (updated > 0) {
      saveSchedulesList(list);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('schedules-updated', list);
    }
    return { success: true, updated };
  }

  ipcMain.handle('remote-upload:get-config', async () => remoteUpload.getRemoteConfig());
  ipcMain.handle('remote-upload:set-config', async (event, patch) => {
    const cfg = remoteUpload.setRemoteConfig({ enabled: Boolean(patch?.enabled) });
    if (!cfg.enabled) return { ...cfg, online: null };
    try {
      await remoteUpload.checkRemoteHealth();
      return { ...cfg, online: true };
    } catch (err) {
      return { ...cfg, online: false, error: err.message };
    }
  });
  ipcMain.handle('remote-upload:sync', async () => {
    try {
      return await syncRemoteSchedules();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  // Perbarui status jadwal server tiap 1 menit selama aplikasi terbuka
  setInterval(() => { syncRemoteSchedules().catch(() => {}); }, 60 * 1000);

  ipcMain.handle('publish-tiktok-post', async (event, payload) => {
    const active = getActiveAccount();
    const sourceFiles = Array.isArray(payload?.mediaPaths) ? payload.mediaPaths : [payload?.mediaPaths].filter(Boolean);
    const mediaPaths = await Promise.all(sourceFiles.map((f) => enhanceVideoForTikTok(f)));
    return await uploadToTikTok({
      ...payload,
      concept: ['edu3d', 'kartun3d', 'carakerja3d'].includes(payload?.concept) ? 'pov' : payload?.concept,
      mediaPaths,
      accountId: active?.id || 'karuna_id'
    });
  });

  ipcMain.handle('select-files', async () => {
    const win = ctx.getMainWindow();
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['jpg', 'png', 'mp4'] }]
    });
    return res.filePaths || [];
  });
};