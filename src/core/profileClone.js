/**
 * src/core/profileClone.js
 * Salinan profil Chrome untuk worker ke-2 dst. (satu folder profil tidak bisa dibuka dua Chrome sekaligus).
 * Worker N memakai salinan profil yang SAMA (login ChatGPT / akun Flow yang sama dengan worker 1).
 *
 * - Disalin ulang hanya bila profil sumber berubah sejak salinan terakhir. Penandanya = waktu ubah file Cookies
 *   sumber saat disalin (Chrome worker N ikut menulis Cookies-nya sendiri, jadi membandingkan waktu file
 *   kedua profil tidak bisa dipakai: salinan basi terlihat "lebih baru").
 * - Cookies dikunci selama Chrome profil sumber berjalan (EBUSY) → salinan lama dipakai apa adanya.
 * - Penyalinan asinkron (tidak membekukan aplikasi); salinan ke folder yang sama tidak pernah berjalan bersamaan.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PROFILE_SKIP = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnCache', 'DawnGraphiteCache',
  'DawnWebGPUCache', 'Service Worker', 'blob_storage', 'Crashpad', 'component_crx_cache',
  'optimization_guide_model_store', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'
]);
const STAMP_FILE = '.synced-from';
const inFlight = new Map();

const cookieOf = (dir) => path.join(dir, 'Default', 'Network', 'Cookies');

function workerProfileDir(sourceDir, workerId) {
  return `${sourceDir}_w${workerId}`;
}

async function copyClone(sourceDir, targetDir) {
  const sourceCookies = cookieOf(sourceDir);
  if (!fs.existsSync(sourceCookies)) return { dir: targetDir, status: 'no-source' };

  const stampPath = path.join(targetDir, STAMP_FILE);
  const sourceStamp = String(fs.statSync(sourceCookies).mtimeMs);
  const lastStamp = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8') : '';
  if (lastStamp === sourceStamp && fs.existsSync(cookieOf(targetDir))) return { dir: targetDir, status: 'current' };

  try {
    // Cookies dulu: bila terkunci (Chrome sumber sedang jalan) batalkan seluruh salinan
    await fsp.mkdir(path.dirname(cookieOf(targetDir)), { recursive: true });
    await fsp.copyFile(sourceCookies, cookieOf(targetDir));
    await fsp.cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      filter: (src) => !PROFILE_SKIP.has(path.basename(src))
    });
    await fsp.writeFile(stampPath, sourceStamp);
    return { dir: targetDir, status: 'synced' };
  } catch (e) {
    return { dir: targetDir, status: 'locked', error: e.code || e.message };
  }
}

/** @returns {Promise<{ dir: string, status: 'synced' | 'current' | 'locked' | 'no-source', error?: string }>} */
function syncProfileClone(sourceDir, targetDir) {
  if (!inFlight.has(targetDir)) {
    inFlight.set(targetDir, copyClone(sourceDir, targetDir).finally(() => inFlight.delete(targetDir)));
  }
  return inFlight.get(targetDir);
}

/** Salinan sudah pernah dibuat (boleh dipakai walau belum sempat disinkronkan ulang) */
function hasUsableClone(targetDir) {
  return fs.existsSync(cookieOf(targetDir));
}

module.exports = { syncProfileClone, workerProfileDir, hasUsableClone };
