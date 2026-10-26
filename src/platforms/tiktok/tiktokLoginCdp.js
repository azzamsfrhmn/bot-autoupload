/**
 * src/platforms/tiktok/tiktokLoginCdp.js
 * Membuka Google Chrome asli berbasis CDP untuk Login Akun TikTok
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = process.cwd();
const TIKTOK_PROFILES_DIR = path.resolve(ROOT_DIR, 'sessions/tiktok_profiles');

if (!fs.existsSync(TIKTOK_PROFILES_DIR)) {
  fs.mkdirSync(TIKTOK_PROFILES_DIR, { recursive: true });
}

function getOriginalChromeExecutablePath() {
  const platform = os.platform();
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }

  return candidates.find((p) => fs.existsSync(p));
}

function purgeTransientSessionData(profileDir) {
  if (!fs.existsSync(profileDir)) return;
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach((file) => {
    const fPath = path.join(profileDir, file);
    if (fs.existsSync(fPath)) {
      try { fs.unlinkSync(fPath); } catch (e) {}
    }
  });
}

async function openTikTokCdpLogin(accountUsername = 'karuna_id') {
  const chromePath = getOriginalChromeExecutablePath();
  if (!chromePath) {
    throw new Error('Google Chrome asli tidak ditemukan di komputer.');
  }

  const cleanUsername = String(accountUsername || 'karuna_id').trim().replace(/^@/, '').toLowerCase();
  const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanUsername}`);
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  purgeTransientSessionData(profileDir);

  const cdpPort = 52000 + Math.floor(Math.random() * 5000);

  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--window-size=1200,900',
    '--window-position=60,40',
    'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video'
  ];

  const chromeProcess = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: 'ignore'
  });
  chromeProcess.unref();

  return {
    success: true,
    port: cdpPort,
    profileDir,
    username: cleanUsername
  };
}

module.exports = {
  openTikTokCdpLogin,
  getOriginalChromeExecutablePath
};