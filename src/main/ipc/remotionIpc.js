/**
 * src/main/ipc/remotionIpc.js
 * Konsep Remotion: tulis teks video (Gemini), pilih media, dan render template jadi MP4.
 */
const path = require('path');
const { dialog } = require('electron');
const { generateRemotionScript } = require('../../services/aiCaption');
const { renderRemotionVideo } = require('../../services/remotionRenderer');

module.exports = function registerRemotionIpc(ipcMain, ctx) {
  const { DATA_ROOT } = ctx;
  let rendering = false;

  function safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  function sendProgress(event, payload) {
    if (event?.sender && !event.sender.isDestroyed()) event.sender.send('video-gen-progress', payload);
  }

  safeHandle('remotion-generate-script', async (event, payload = {}) => {
    try {
      return await generateRemotionScript(payload);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('remotion-select-media', async (event, kind = 'photo') => {
    const isVideo = kind === 'video';
    const res = await dialog.showOpenDialog(ctx.getMainWindow(), {
      title: isVideo ? 'Pilih video untuk diberi teks' : 'Pilih foto produk (bisa lebih dari satu)',
      defaultPath: path.join(DATA_ROOT, isVideo ? 'storage/videos' : 'storage'),
      properties: isVideo ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: isVideo
        ? [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }]
        : [{ name: 'Gambar', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    return res.canceled ? [] : (res.filePaths || []);
  });

  safeHandle('remotion-render', async (event, payload = {}) => {
    if (rendering) return { success: false, error: 'Masih ada video Remotion yang sedang dirender.' };
    rendering = true;
    const startedAt = Date.now();
    const log = (status, percent) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      sendProgress(event, { status: `[[${elapsed}s]] ${status}`, percent });
    };
    try {
      log('Memulai render Remotion...', 5);
      const result = await renderRemotionVideo(payload, (msg) => {
        const m = msg.match(/(\d+)%/);
        log(msg, m ? Math.max(10, Math.min(98, Number(m[1]))) : 8);
      });
      sendProgress(event, { status: `Sukses! Video Remotion disimpan: ${result.fileName}`, percent: 100, success: true, videoPath: result.videoPath });
      return result;
    } catch (err) {
      // Tombol Batalkan (makeCancelSignal) → bukan kegagalan
      if (/cancel/i.test(err.message)) {
        sendProgress(event, { status: 'Render Remotion dibatalkan.', percent: 0, success: false });
        return { success: false, cancelled: true, error: 'Dibatalkan pengguna' };
      }
      sendProgress(event, { status: `Gagal render Remotion: ${err.message}`, percent: 0, success: false });
      return { success: false, error: err.message };
    } finally {
      rendering = false;
    }
  });
};
