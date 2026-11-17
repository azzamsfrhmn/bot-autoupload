/**
 * src/core/galleryOwner.js
 * Galeri per akun: setiap video / gambar / storyboard yang dibuat bot ditandai dengan akun yang aktif saat dibuat
 * (storage/gallery_owners.json: { "<nama file>": "<platform>:<username>" }). Galeri hanya menampilkan milik akun aktif.
 * File lama (dibuat sebelum fitur ini, tanpa tanda) hanya tampil di akun TikTok (bukan Instagram / Facebook).
 */
const fs = require('fs');
const path = require('path');

let ownersFile = path.resolve(process.cwd(), 'storage', 'gallery_owners.json');
let getActiveAccountFn = () => null;
let cache = null;

function initGalleryOwner({ dataRoot, getActiveAccount } = {}) {
  if (dataRoot) ownersFile = path.join(dataRoot, 'storage', 'gallery_owners.json');
  if (typeof getActiveAccount === 'function') getActiveAccountFn = getActiveAccount;
  cache = null;
}

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(ownersFile, 'utf-8')) || {}; } catch (e) { cache = {}; }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(ownersFile), { recursive: true });
    fs.writeFileSync(ownersFile, JSON.stringify(cache || {}, null, 1), 'utf-8');
  } catch (e) {}
}

const keyOf = (p) => path.basename(String(p || '')).toLowerCase().replace(/_hd(\.mp4)$/i, '$1');

function currentOwner() {
  try {
    const acc = getActiveAccountFn();
    if (!acc) return '';
    return `${acc.platform || 'instagram'}:${String(acc.username || acc.id || '').replace(/^@/, '').toLowerCase()}`;
  } catch (e) {
    return '';
  }
}

// Tandai file milik akun (default: akun aktif sekarang)
function tagFiles(files = [], owner = currentOwner()) {
  if (!owner) return;
  const map = load();
  let changed = false;
  for (const f of [].concat(files).filter(Boolean)) {
    if (typeof f !== 'string') continue;
    const k = keyOf(f);
    if (k && map[k] !== owner) { map[k] = owner; changed = true; }
  }
  if (changed) save();
}

// Ambil semua path file hasil dari objek hasil pipeline (videoPath, storagePath, storyboardImages, dst.)
function filesFromResult(result) {
  if (!result || typeof result !== 'object') return [];
  const out = [];
  for (const k of ['videoPath', 'storagePath', 'filePath', 'fileName', 'thumbnailPath', 'outputPath']) {
    if (typeof result[k] === 'string') out.push(result[k]);
  }
  for (const k of ['storyboardImages', 'images', 'frames']) {
    if (Array.isArray(result[k])) result[k].forEach((x) => out.push(typeof x === 'string' ? x : (x?.filePath || x?.path)));
  }
  if (result.flowResult) out.push(...filesFromResult(result.flowResult));
  if (result.item) out.push(...filesFromResult(result.item));
  return out.filter(Boolean);
}

// true = boleh tampil di galeri akun aktif
function isVisibleToActive(fileOrName) {
  const owner = load()[keyOf(fileOrName)];
  // File lama tanpa tanda dibuat saat aplikasi masih khusus TikTok → hanya tampil di akun TikTok
  if (!owner) { const cur = currentOwner(); return !cur || cur.startsWith('tiktok:'); }
  return owner === currentOwner();
}

function forgetFile(fileOrName) {
  const map = load();
  const k = keyOf(fileOrName);
  if (map[k]) { delete map[k]; save(); }
}

module.exports = { initGalleryOwner, currentOwner, tagFiles, filesFromResult, isVisibleToActive, forgetFile };
