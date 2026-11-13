/**
 * src/main/ipc/windowIpc.js
 */
module.exports = function registerWindowIpc(ipcMain, ctx) {
  const minimize = () => {
    const win = ctx.getMainWindow();
    if (win) win.minimize();
  };

  const maximize = () => {
    const win = ctx.getMainWindow();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  };

  const close = () => {
    const win = ctx.getMainWindow();
    if (win) win.close();
  };

  // Support kedua format penamaan event
  ipcMain.on('window-minimize', minimize);
  ipcMain.on('window:minimize', minimize);

  ipcMain.on('window-maximize', maximize);
  ipcMain.on('window:maximize', maximize);

  ipcMain.on('window-close', close);
  ipcMain.on('window:close', close);
};