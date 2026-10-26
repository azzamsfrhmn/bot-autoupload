const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '../../../sessions');
const PINTEREST_SESSION_FILE = path.join(SESSIONS_DIR, 'pinterest_session.json');

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function savePinterestCookies(cookies) {
  try {
    fs.writeFileSync(PINTEREST_SESSION_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Pinterest Session Error]', err);
    return false;
  }
}

function loadPinterestCookies() {
  try {
    if (fs.existsSync(PINTEREST_SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(PINTEREST_SESSION_FILE, 'utf-8'));
    }
  } catch (err) {}
  return null;
}

function isPinterestLoggedIn() {
  const cookies = loadPinterestCookies();
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) return false;
  // Cek apakah ada cookie sesi Pinterest utama (misal _auth, _pinterest_sess)
  return cookies.some((c) => c.name === '_auth' && c.value === '1') || cookies.some((c) => c.name.includes('sess'));
}

function openPinterestLoginWindow(parentWindow, onLoggedIn) {
  const customSession = session.fromPartition('persist:pinterest_session');
  const loginWin = new BrowserWindow({
    width: 600,
    height: 750,
    parent: parentWindow,
    modal: true,
    autoHideMenuBar: true,
    title: 'Login Akun Pinterest',
    webPreferences: {
      session: customSession
    }
  });

  loginWin.loadURL('https://www.pinterest.com/login/');

  const checkLoginInterval = setInterval(async () => {
    if (loginWin.isDestroyed()) {
      clearInterval(checkLoginInterval);
      return;
    }

    try {
      const cookies = await customSession.cookies.get({ domain: '.pinterest.com' });
      const authCookie = cookies.find((c) => c.name === '_auth' && c.value === '1');

      if (authCookie) {
        clearInterval(checkLoginInterval);
        savePinterestCookies(cookies);
        if (typeof onLoggedIn === 'function') onLoggedIn({ success: true });
        if (!loginWin.isDestroyed()) loginWin.close();
      }
    } catch (e) {}
  }, 2000);

  loginWin.on('closed', () => {
    clearInterval(checkLoginInterval);
  });
}

module.exports = {
  savePinterestCookies,
  loadPinterestCookies,
  isPinterestLoggedIn,
  openPinterestLoginWindow,
  PINTEREST_SESSION_FILE
};