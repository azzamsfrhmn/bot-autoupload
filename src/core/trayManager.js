const { Tray, Menu, Notification, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;

function showDesktopNotification(title, body, isSuccess = true, onNotifClick = null) {
  if (Notification.isSupported()) {
    const notif = new Notification({
      title: title,
      body: body,
      silent: false,
      urgency: isSuccess ? 'normal' : 'critical'
    });

    if (onNotifClick) {
      notif.on('click', onNotifClick);
    }
    notif.show();
  }
}

function createSystemTray(getMainWindow, onQuit) {
  if (tray) return tray;

  const iconPath = path.join(__dirname, '../../../assets/icon.png');
  let trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('Instagram Auto Poster (@etnicpremium)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Buka Instagram Auto Poster',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        }
      }
    },
    { label: 'Status: Berjalan di Latar Belakang', enabled: false },
    { type: 'separator' },
    {
      label: 'Keluar Aplikasi',
      click: () => onQuit()
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isVisible()) win.hide();
      else { win.show(); win.focus(); }
    }
  });

  return tray;
}

module.exports = {
  createSystemTray,
  showDesktopNotification
};