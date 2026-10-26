/**
 * src/main/ipc/scheduleIpc.js
 */
const { dialog } = require('electron');

module.exports = function registerScheduleIpc(ipcMain, ctx) {
  const { loadSchedulesList, saveSchedulesList, uploadToTikTok, getActiveAccount, cleanUserIdentifier, TARGET_USERNAME } = ctx;

  ipcMain.handle('get-schedules', async () => loadSchedulesList());

  ipcMain.handle('delete-schedule', async (event, id) => {
    let list = loadSchedulesList().filter((item) => String(item.id) !== String(id));
    saveSchedulesList(list);
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('schedules-updated', list);
    return true;
  });

  ipcMain.handle('schedule-post', async (event, { mediaPaths, caption, scheduleTime, productId }) => {
    const files = Array.isArray(mediaPaths) ? mediaPaths : [mediaPaths];
    const activeAcc = getActiveAccount();
    const targetUser = activeAcc?.username || TARGET_USERNAME;
    const cleanId = cleanUserIdentifier(targetUser);

    const currentList = loadSchedulesList();
    currentList.unshift({
      id: Date.now(),
      mediaPaths: files,
      filePath: files[0],
      caption: caption || '',
      scheduleTime,
      productId: productId || '',
      accountId: cleanId,
      platform: activeAcc?.platform || 'instagram',
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    saveSchedulesList(currentList);
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('schedules-updated', currentList);
    return { success: true };
  });

  ipcMain.handle('publish-tiktok-post', async (event, payload) => {
    const active = getActiveAccount();
    return await uploadToTikTok({
      ...payload,
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