/**
 * test_flow_standalone.js
 * Skrip uji isolasi render Google Flow menggunakan Chrome asli
 * Jalankan via terminal: node test_flow_standalone.js
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CDP_PORT = 9222;
const PROFILE_DIR = path.resolve(__dirname, 'sessions/flow_profiles/acc_1');
const TEST_IMAGE = path.resolve(__dirname, 'storage/storyboards/test_panel.png'); // Gambar 1 panel biasa

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getChromePath() {
  if (os.platform() === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  return '/usr/bin/google-chrome';
}

async function runTest() {
  console.log('[1/5] Membuka Chrome murni...');
  const chromeProcess = spawn(getChromePath(), [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--window-size=1280,800',
    'https://flow.google.com'
  ], { stdio: 'ignore' });

  await sleep(4000);

  console.log('[2/5] Menghubungkan Playwright CDP...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  console.log('[3/5] Menunggu halaman Flow siap...');
  await page.waitForLoadState('domcontentloaded');
  await sleep(3000);

  console.log('[4/5] Browser siap untuk pengetesan interaksi render.');
  console.log('Silakan amati respon jaringan, event drag, atau form submission di jendela yang terbuka.');

  // Biarkan browser tetap terbuka untuk observasi manual
}

runTest().catch(console.error);