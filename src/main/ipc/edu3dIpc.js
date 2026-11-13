/**
 * src/main/ipc/edu3dIpc.js
 * Konsep 3D Edukasi: ide topik AI & karakter ciri khas (gambar upload pengguna, disimpan sekali, dipakai di semua video).
 */
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { suggestTopic, getCharacterPath, CHARACTER_DIR } = require('../../services/aiVideoEdu3D');

module.exports = function registerEdu3DIpc(ipcMain, ctx) {
  function safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  // Ide topik "Tahu gak sih ...?" untuk kolom topik
  safeHandle('edu3d-suggest-topic', async () => {
    try {
      return await suggestTopic();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('edu3d-get-character', async () => ({ path: getCharacterPath() || '' }));

  // Pilih gambar karakter → salin ke storage/edu3d/karakter.<ext> (menggantikan karakter sebelumnya)
  safeHandle('edu3d-select-character', async () => {
    const win = ctx.getMainWindow?.();
    const res = await dialog.showOpenDialog(win, {
      title: 'Pilih gambar karakter ciri khas 3D Edukasi',
      properties: ['openFile'],
      filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (res.canceled || !res.filePaths?.[0]) return { canceled: true };
    try {
      fs.mkdirSync(CHARACTER_DIR, { recursive: true });
      fs.readdirSync(CHARACTER_DIR).filter((f) => /^karakter\./i.test(f)).forEach((f) => fs.rmSync(path.join(CHARACTER_DIR, f), { force: true }));
      const dest = path.join(CHARACTER_DIR, `karakter${path.extname(res.filePaths[0]).toLowerCase() || '.png'}`);
      fs.copyFileSync(res.filePaths[0], dest);
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('edu3d-clear-character', async () => {
    const p = getCharacterPath();
    if (p) fs.rmSync(p, { force: true });
    return { success: true };
  });
};
