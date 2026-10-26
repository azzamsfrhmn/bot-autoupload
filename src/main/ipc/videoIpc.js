/**
 * src/main/ipc/videoIpc.js
 */
const path = require('path');
const fs = require('fs');
const { clipboard, nativeImage, shell } = require('electron');

module.exports = function registerVideoIpc(ipcMain, ctx) {
  const {
    PROJECT_ROOT,
    getActiveAccount,
    runTikTokVideoPipeline,
    runInstagramStoryboardPipeline,
    runFlowProjectCreation,
    runFlowProjectCreationTiktok,
    getFlowAccountsConfig,
    addFlowAccount,
    deleteFlowAccount,
    openFlowLoginWindow,
    silentSyncAccountCredits,
    generateAndStoreAiImage,
    getGeneratedImagesList,
    openImagesFolder,
    getSavedVideosList,
    openVideoFolder,
    openStoryboardFolder,
    openBahanVideoFolder,
    deleteSavedVideo,
    deleteSavedStoryboard
  } = ctx;

  // --- GENERATOR & STORAGE GAMBAR AI ---
  ipcMain.handle('generate-ai-image', async (event, params) => {
    try {
      let prompt = '';
      let aspectRatio = '1:1';
      if (typeof params === 'object' && params !== null) {
        prompt = params.prompt || '';
        aspectRatio = params.aspectRatio || '1:1';
      }
      return await generateAndStoreAiImage(prompt, aspectRatio, { workerId: 1 });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-saved-ai-images', async () => getGeneratedImagesList());
  ipcMain.handle('open-ai-images-folder', async () => openImagesFolder());

  // --- GENERATOR AI VIDEO ---
  ipcMain.handle('generate-ai-video', async (event, params) => {
    const activeAcc = getActiveAccount();
    const isTikTok =
      activeAcc?.platform === 'tiktok' ||
      params?.platform === 'tiktok' ||
      Boolean(params?.referenceImagePath) ||
      Boolean(params?.customCharacterPath) ||
      params?.bannerSource === 'select_showcase';

    const win = ctx.getMainWindow();

    if (isTikTok) {
      const result = await runTikTokVideoPipeline({
        ...params,
        platform: 'tiktok',
        workerId: 1,
        onProgress: (status, percent = 50) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('video-gen-progress', { status, percent, workerId: 1 });
          }
        }
      });

      if (result && result.success && win && !win.isDestroyed()) {
        setTimeout(() => {
          win.webContents.send('refresh-video-gallery', result);
          win.webContents.send('flow-video-saved', result);
          win.webContents.send('refresh-images-gallery');
          win.webContents.send('refresh-storyboard-gallery');
        }, 500);
      }
      return result;
    }

    return await runInstagramStoryboardPipeline({
      ...params,
      platform: 'instagram',
      workerId: 1,
      onProgress: (status, percent = 0) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('video-gen-progress', { status, percent, workerId: 1 });
        }
      }
    });
  });

  // --- RIWAYAT STORYBOARD ---
  const handleGetStoryboardHistory = async () => {
    const storyboardDir = path.resolve(PROJECT_ROOT, 'storage/storyboards');
    const metadataJson = path.resolve(PROJECT_ROOT, 'sessions/generated_images/metadata.json');
    const bahanDir = path.resolve(PROJECT_ROOT, 'storage/bahan_video');

    const exactPromptMap = new Map();

    if (fs.existsSync(bahanDir)) {
      try {
        fs.readdirSync(bahanDir).filter((d) => fs.statSync(path.join(bahanDir, d)).isDirectory()).forEach((d) => {
          const pPromptFile = path.join(bahanDir, d, 'prompt_video.txt');
          if (fs.existsSync(pPromptFile)) {
            const c = fs.readFileSync(pPromptFile, 'utf-8').trim();
            const match = d.match(/\d{10,13}/);
            if (match) exactPromptMap.set(match[0], c);
          }
        });
      } catch (e) {}
    }

    if (fs.existsSync(metadataJson)) {
      try {
        const metaList = JSON.parse(fs.readFileSync(metadataJson, 'utf-8'));
        if (Array.isArray(metaList)) {
          metaList.forEach((entry) => {
            if (entry?.videoPromptText) {
              if (entry.fileName) exactPromptMap.set(entry.fileName, entry.videoPromptText);
              if (entry.id) exactPromptMap.set(String(entry.id), entry.videoPromptText);
            }
          });
        }
      } catch (e) {}
    }

    const foundImages = [];
    if (fs.existsSync(storyboardDir)) {
      try {
        fs.readdirSync(storyboardDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).forEach((f) => {
          const full = path.join(storyboardDir, f);
          const stat = fs.statSync(full);
          const match = f.match(/\d{10,13}/);
          foundImages.push({ path: full, mtime: stat.mtimeMs, ts: match ? match[0] : '', fileName: f });
        });
      } catch (e) {}
    }

    foundImages.sort((a, b) => b.mtime - a.mtime);

    const items = foundImages.map((img) => ({
      path: img.path,
      mtime: img.mtime,
      promptText: exactPromptMap.get(img.fileName) || exactPromptMap.get(img.ts) || ''
    }));

    return { items, frames: items.map((i) => i.path) };
  };

  ipcMain.handle('get-storyboard-history', handleGetStoryboardHistory);
  ipcMain.handle('ai-video:get-storyboard-history', handleGetStoryboardHistory);

  // --- RIWAYAT VIDEO JADI ---
  const handleGetSavedVideos = async () => {
    const targetDir = path.resolve(PROJECT_ROOT, 'storage/videos');
    const metaPath = path.resolve(targetDir, 'metadata.json');
    let metaList = [];
    if (fs.existsSync(metaPath)) {
      try { metaList = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) {}
    }

    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
      return files.map((file) => {
        const fullPath = path.join(targetDir, file);
        const stat = fs.statSync(fullPath);
        const meta = metaList.find((m) => m.fileName === file) || {};
        const base = path.basename(file, path.extname(file));
        const thumb = path.join(targetDir, `${base}_thumb.png`);

        return {
          id: meta.id || `vid_${stat.mtimeMs}`,
          fileName: file,
          name: file,
          filePath: fullPath,
          storagePath: fullPath,
          previewUrl: fullPath,
          url: fullPath,
          thumbnailPath: fs.existsSync(thumb) ? thumb : (meta.thumbnailPath || ''),
          poster: fs.existsSync(thumb) ? thumb : (meta.poster || ''),
          timestamp: stat.mtimeMs,
          createdAt: stat.mtime.toISOString(),
          createdDate: stat.mtime.toLocaleString('id-ID')
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
    }
    return [];
  };

  ipcMain.handle('get-saved-videos', handleGetSavedVideos);
  ipcMain.handle('ai-video:get-saved-videos', handleGetSavedVideos);
  ipcMain.handle('get-generated-videos', handleGetSavedVideos);

  // --- BACA GAMBAR KE BASE64 ---
  ipcMain.handle('read-image-as-base64', async (event, imagePath) => {
    try {
      if (!imagePath) return '';
      let target = path.resolve(String(imagePath).replace('file:///', ''));
      if (fs.existsSync(target)) {
        const ext = path.extname(target).toLowerCase().replace('.', '') || 'png';
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
        return `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`;
      }
    } catch (e) {}
    return '';
  });

  // --- PENGHAPUSAN FILE GALERI GAMBAR AI ---
  const handleDeleteAiImage = async (e, targetInput, fallbackPath) => {
    try {
      let targetId = '';
      let targetPathStr = '';

      if (typeof targetInput === 'object' && targetInput !== null) {
        targetId = targetInput.id ? String(targetInput.id) : '';
        targetPathStr = targetInput.filePath || targetInput.path || targetInput.fileName || '';
      } else {
        const strVal = String(targetInput || '').trim();
        targetId = strVal;
        targetPathStr = fallbackPath ? String(fallbackPath).trim() : strVal;
      }

      const metaFiles = [
        path.resolve(PROJECT_ROOT, 'sessions/generated_images/metadata.json'),
        path.resolve(PROJECT_ROOT, 'storage/images/metadata.json')
      ];

      let physicalFilesToDelete = new Set();
      if (targetPathStr) physicalFilesToDelete.add(path.resolve(targetPathStr.replace('file:///', '')));

      metaFiles.forEach((metaFile) => {
        if (!fs.existsSync(metaFile)) return;
        try {
          let list = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
          if (Array.isArray(list)) {
            const updated = list.filter((item) => {
              const itemId = item.id ? String(item.id) : '';
              const itemPath = item.filePath || item.storagePath || '';
              const itemFile = item.fileName || path.basename(itemPath);

              const isMatch =
                (targetId && (itemId === targetId || itemFile === targetId)) ||
                (targetPathStr && (itemPath.includes(targetPathStr) || targetPathStr.includes(itemPath) || itemFile === path.basename(targetPathStr)));

              if (isMatch) {
                if (item.filePath) physicalFilesToDelete.add(path.resolve(item.filePath));
                if (item.storagePath) physicalFilesToDelete.add(path.resolve(item.storagePath));
                return false;
              }
              return true;
            });

            fs.writeFileSync(metaFile, JSON.stringify(updated, null, 2), 'utf-8');
          }
        } catch (err) {}
      });

      physicalFilesToDelete.forEach((filePath) => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {}
      });

      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('refresh-images-gallery');
        win.webContents.send('refresh-image-storage');
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  ipcMain.handle('delete-ai-image', handleDeleteAiImage);
  ipcMain.handle('delete-generated-image', handleDeleteAiImage);

  ipcMain.handle('delete-storyboard-frame', async (e, targetInput) => {
    try {
      const targetStr = typeof targetInput === 'object' ? (targetInput?.path || targetInput?.filePath || '') : String(targetInput);
      const targetPath = path.resolve(targetStr);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('refresh-storyboard-gallery');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-saved-video', async (e, videoData) => {
    try {
      const fName = typeof videoData === 'object' ? (videoData?.fileName || path.basename(videoData?.filePath || '')) : path.basename(String(videoData));
      const targetPath = path.resolve(PROJECT_ROOT, 'storage/videos', fName);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      const thumb = path.resolve(PROJECT_ROOT, 'storage/videos', `${path.basename(fName, path.extname(fName))}_thumb.png`);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('refresh-video-gallery');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- CLIPBOARD & GOOGLE FLOW ---
  ipcMain.handle('paste-image-from-clipboard', async () => {
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return { success: false, error: 'Clipboard kosong.' };
      const refDir = path.resolve(PROJECT_ROOT, 'storage/reference_images');
      if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
      const fileName = `ref_${Date.now()}.png`;
      const targetPath = path.join(refDir, fileName);
      fs.writeFileSync(targetPath, img.toPNG());
      return { success: true, filePath: targetPath, fileName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-flow-accounts', async () => getFlowAccountsConfig());
  ipcMain.handle('add-flow-account', async () => addFlowAccount());
  ipcMain.handle('delete-flow-account', async (e, id) => deleteFlowAccount(id));
  ipcMain.handle('open-flow-login', async (e, id) => openFlowLoginWindow(id || 'acc_1'));
  ipcMain.handle('sync-flow-account-credits', async (e, id) => ({ success: true, credits: await silentSyncAccountCredits(id) }));

  ipcMain.handle('open-video-folder', async () => shell.openPath(path.resolve(PROJECT_ROOT, 'storage/videos')));
  ipcMain.handle('open-storyboard-folder', async () => shell.openPath(path.resolve(PROJECT_ROOT, 'storage/storyboards')));
  ipcMain.handle('open-bahan-folder', async (e, folderPath) => {
    if (typeof openBahanVideoFolder === 'function') return openBahanVideoFolder(folderPath);
  });
};