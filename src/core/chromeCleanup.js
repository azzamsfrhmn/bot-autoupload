/**
 * src/core/chromeCleanup.js
 * Bersihkan Chrome otomatis setelah pembuatan video GAGAL, agar proses berikutnya bisa langsung jalan
 * tanpa menutup aplikasi. chromeProcess.kill() di Windows hanya mematikan proses induk; proses anak Chrome
 * tetap hidup dan mengunci profil (lockfile/Cookies) sehingga Chrome berikutnya gagal dibuka.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, () => resolve());
  });
}

// Matikan proses beserta seluruh proses anaknya
async function killProcessTree(proc) {
  if (!proc || !proc.pid || process.platform !== 'win32') {
    try { proc?.kill(); } catch (e) {}
    return;
  }
  await run('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
}

// Matikan semua chrome.exe yang memakai profil ini (termasuk sisa render sebelumnya yang tidak tercatat)
async function killChromeForProfile(profileDir) {
  if (!profileDir || process.platform !== 'win32') return;
  const needle = `--user-data-dir=${path.resolve(profileDir)}`.replace(/'/g, "''");
  const script = "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 20000);
}

// Matikan semua chrome.exe yang --user-data-dir-nya memuat salah satu potongan path (satu kali pindai)
async function killChromeMatching(needles = []) {
  const list = needles.filter(Boolean);
  if (!list.length || process.platform !== 'win32') return;
  const conds = list.map((n) => `$_.CommandLine.ToLower().Contains('${String(n).toLowerCase().replace(/'/g, "''")}')`).join(' -or ');
  const script = "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
    `Where-Object { $_.CommandLine -and (${conds}) } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 20000);
}

// Tunggu kunci profil lepas lalu hapus sisa berkas kunci
async function releaseProfileLocks(profileDir, timeoutMs = 8000) {
  if (!profileDir || !fs.existsSync(profileDir)) return;
  const lockfile = path.join(profileDir, 'lockfile');
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(lockfile) && Date.now() < deadline) {
    try { fs.unlinkSync(lockfile); break; } catch (e) { await sleep(500); }
  }
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch (e) {}
  }
}

/** Bersihkan Chrome satu proses render yang gagal: proses + anaknya, Chrome lain di profil yang sama, kunci profil. */
async function cleanupFailedChrome({ proc = null, profileDir = '', onProgress = null } = {}) {
  try {
    await killProcessTree(proc);
    await killChromeForProfile(profileDir);
    await releaseProfileLocks(profileDir);
    if (onProgress) onProgress('Chrome sisa proses gagal sudah dibersihkan, siap dijalankan lagi.');
  } catch (e) {}
}

module.exports = { cleanupFailedChrome, killProcessTree, killChromeForProfile, killChromeMatching, releaseProfileLocks };
