/**
 * src/main/ipc/windowIpc.js
 */
module.exports = function registerWindowIpc(ipcMain, ctx) {
  ipcMain.on('window-minimize', () => {
    const win = ctx.getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.on('window-maximize', () => {
    const win = ctx.getMainWindow();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    const win = ctx.getMainWindow();
    if (win) win.close();
  });
};