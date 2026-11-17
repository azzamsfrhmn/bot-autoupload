/**
 * src/core/accountFiles.js
 * File sesi per akun di folder sendiri: sessions/akun/<platform>_<username>/
 *
 * "Jalan tengah" (tanpa migrasi paksa):
 *  - TULIS  → selalu ke folder akun (dibuat otomatis).
 *  - BACA   → folder akun dulu; kalau belum ada, file lama di sessions/ (akun lama tidak logout).
 *  - Nama file lama yang mengandung identitas akun dikenali & dipetakan otomatis, mis.
 *      tiktokshop_cookies_sherlylovyou.id.json → akun/tiktok_sherlylovyou.id/shop_cookies.json
 *  - File global (license.json, schedules.json, cookies bawaan tanpa akun, dll.) & nama yang tidak
 *    cocok dengan akun terdaftar TIDAK diubah.
 *
 * Akun dicocokkan lewat sessions/accounts_registry.json (dibaca langsung, tanpa require
 * sessionManager → tidak ada dependensi melingkar).
 */
const fs = require('fs');
const path = require('path');

const sessionsDir = () => path.join(process.cwd(), 'sessions');
const ACCOUNT_ROOT = () => path.join(sessionsDir(), 'akun');

// Pola nama file lama → nama file di folder akun. Urutan penting (prefix terpanjang dulu).
const PATTERNS = [
  { re: /^showcase_products_(.+)\.json$/i, file: 'showcase_products.json' },
  { re: /^showcase_metrics_(.+)\.json$/i, file: 'showcase_metrics.json' },
  { re: /^showcase_(.+)\.json$/i, file: 'showcase.json' },
  { re: /^tiktok_streamer_cookies_(.+)\.json$/i, file: 'streamer_cookies.json' },
  { re: /^tiktokshop_cookies_(.+)\.json$/i, file: 'shop_cookies.json' },
  { re: /^tiktok_cookies_(.+)\.json$/i, file: 'cookies.json' },
  { re: /^session_tiktok_(.+)\.json$/i, file: 'cookies.json' },
  { re: /^profile_cache_tiktok_(.+)\.json$/i, file: 'profile_cache.json' },
  { re: /^profile_cache_(.+)\.json$/i, file: 'profile_cache.json' },
  { re: /^instagram_(.+)\.json$/i, file: 'session.json' },
  { re: /^session_(.+)\.json$/i, file: 'session.json' },
  { re: /^(.+)\.json$/i, file: 'session.json', exactAccountOnly: true }   // "<username>.json"
];

const clean = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
const slug = (s) => clean(s).replace(/[^a-z0-9]/g, '');
const safeFolder = (s) => String(s || '').trim().replace(/^@/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'akun';

let regCache = { mtime: 0, accounts: [] };
function accounts() {
  const f = path.join(sessionsDir(), 'accounts_registry.json');
  try {
    const m = fs.statSync(f).mtimeMs;
    if (m !== regCache.mtime) {
      const reg = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
      regCache = { mtime: m, accounts: Array.isArray(reg.accounts) ? reg.accounts : [] };
    }
  } catch (e) { regCache = { mtime: 0, accounts: [] }; }
  return regCache.accounts;
}

function platformOf(acc) {
  const p = String(acc.platform || '').toLowerCase();
  const id = String(acc.id || '').toLowerCase();
  if (p) return p;
  if (id.startsWith('fbpage_')) return 'facebook';
  if (id.startsWith('shopee_')) return 'shopee';
  if (id.startsWith('yt_')) return 'youtube';
  if (id.startsWith('ig_')) return 'instagram';
  return 'tiktok';
}

// Cari akun dari identitas (id / username / tanpa prefix id / slug). exact = tanpa slug.
function findAccount(ident, exact = false) {
  const c = clean(ident);
  if (!c) return null;
  const list = accounts();
  const hit = list.find((a) => [a.id, a.username, String(a.id || '').replace(/^(ig_|tiktok_|fbpage_|shopee_|yt_)/i, '')]
    .some((v) => v && clean(v) === c));
  if (hit || exact) return hit || null;
  const s = slug(ident);
  return s ? (list.find((a) => [a.id, a.username].some((v) => v && slug(v) === s)) || null) : null;
}

// Folder akun. acc = objek registri, atau { platform, username } bila akun belum terdaftar.
function accountDir(acc, create = false) {
  if (!acc) return null;
  const name = acc.username || acc.name || acc.id;
  const dir = path.join(ACCOUNT_ROOT(), `${platformOf(acc)}_${safeFolder(name)}`);
  if (create) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Petakan nama file lama → { acc, newPath }. null bila bukan file per akun.
function mapLegacy(legacyName, hint = null) {
  const base = path.basename(String(legacyName || ''));
  for (const p of PATTERNS) {
    const m = base.match(p.re);
    if (!m) continue;
    const acc = hint || findAccount(m[1], !!p.exactAccountOnly);
    if (!acc) { if (p.exactAccountOnly) return null; continue; }
    return { acc, newPath: path.join(accountDir(acc), p.file) };
  }
  return null;
}

/**
 * Path untuk MEMBACA. legacy = path lengkap file lama (di sessions/ atau storage/).
 * Kembalikan file di folder akun bila ada, selain itu path lama apa adanya.
 */
function readPath(legacy, hint = null) {
  const m = mapLegacy(legacy, hint);
  if (m && fs.existsSync(m.newPath)) return m.newPath;
  return legacy;
}

/**
 * Path untuk MENULIS. File per akun → folder akun (dibuat otomatis); lainnya path lama.
 * hint = { platform, username } untuk akun yang belum masuk registri (mis. saat login).
 */
function writePath(legacy, hint = null) {
  const m = mapLegacy(legacy, hint);
  if (!m) return legacy;
  fs.mkdirSync(path.dirname(m.newPath), { recursive: true });
  return m.newPath;
}

// Apakah file (baru atau lama) ada
function exists(legacy, hint = null) {
  return fs.existsSync(readPath(legacy, hint));
}

module.exports = { readPath, writePath, exists, accountDir, findAccount, mapLegacy, ACCOUNT_ROOT };
