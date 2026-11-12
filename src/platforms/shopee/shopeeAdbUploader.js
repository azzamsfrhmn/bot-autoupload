// ============================================================================
// Shopee Video (Affiliate) uploader lewat HP Android asli + Tap-Server.
// Cabang feature/shopee-adb. Pakai app Shopee RESMI (com.shopee.id), tanpa patch.
//
// Input (tap/teks/scan) dikirim lewat AccessibilityService "com.botupload.tapper"
// via `am broadcast` -> lolos blokir INJECT_EVENTS di MIUI tanpa akun Mi.
// Koordinat disimpan sebagai RASIO layar (divalidasi di Redmi Note 8 1080x2340).
//
// Alur tervalidasi (posting nyata berhasil 2026-11-12):
//   launch -> tab Live&Video -> + buat -> (izin kamera) -> Galeri -> (izin media)
//   -> pilih video -> preview Lanjutkan -> editor Lanjutkan -> Tambah Keterangan
//   -> isi caption (OK) -> Tambah Produk -> Import Link -> tempel link -> Import
//   -> Pilih Semua -> Tambah -> Posting
// ============================================================================
'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ocr = require('./shopeeOcr');

const SHOPEE_PKG = 'com.shopee.id';
const TAPPER_PKG = 'com.botupload.tapper';

const ADB_CANDIDATES = [
  path.join(os.homedir(), 'AppData/Local/Android/Sdk/platform-tools/adb.exe'),
  'C:/Program Files/platform-tools/adb.exe',
  'C:/platform-tools/adb.exe'
];

function getAdbPath() {
  for (const c of ADB_CANDIDATES) {
    try { if (fs.existsSync(c)) return `"${c}"`; } catch (e) {}
  }
  return 'adb';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runAdb(cmd, serial = '') {
  return new Promise((resolve, reject) => {
    const target = serial ? `-s ${serial} ` : '';
    exec(`${getAdbPath()} ${target}${cmd}`, { windowsHide: true, maxBuffer: 1 << 25 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr && stderr.trim()) || err.message));
      resolve((stdout || '').trim());
    });
  });
}

let _serverSynced = false;
async function ensureServer() {
  if (_serverSynced) return;
  await runAdb('start-server').catch(() => {});
  _serverSynced = true;
}

// -------- device --------
async function listDevices() {
  const out = await runAdb('devices -l').catch(() => '');
  return out.split('\n').slice(1)
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+/);
      const model = (l.match(/model:(\S+)/) || [, ''])[1];
      return { serial: parts[0], state: parts[1] || '', model };
    });
}

async function getConnectedDevice(preferSerial = '') {
  await ensureServer();
  const devs = await listDevices();
  if (preferSerial) {
    const d = devs.find((x) => x.serial === preferSerial && x.state === 'device');
    if (d) return d.serial;
  }
  const real = devs.find((d) => d.state === 'device' && !/^emulator-/.test(d.serial));
  if (real) return real.serial;
  const any = devs.find((d) => d.state === 'device');
  return any ? any.serial : null;
}

async function pairWifi(hostPort, code) { await ensureServer(); return runAdb(`pair ${hostPort} ${code}`); }
async function connectWifi(hostPort) { await ensureServer(); return runAdb(`connect ${hostPort}`); }

async function getScreenSize(device) {
  try {
    const res = await runAdb('shell wm size', device);
    const m = res.match(/(\d+)x(\d+)/);
    if (m) return { width: +m[1], height: +m[2] };
  } catch (e) {}
  return { width: 1080, height: 2340 };
}

async function hasPackage(device, pkg) {
  const pkgs = await runAdb('shell pm list packages', device).catch(() => '');
  return pkgs.includes(pkg);
}
const hasShopee = (device) => hasPackage(device, SHOPEE_PKG);
const hasTapper = (device) => hasPackage(device, TAPPER_PKG);

async function tapperEnabled(device) {
  const svc = await runAdb('shell settings get secure enabled_accessibility_services', device).catch(() => '');
  return svc.includes(TAPPER_PKG);
}

// -------- UI dump (hanya berguna di halaman non-native, mis. dialog izin) --------
async function getUiXml(device) {
  try {
    await runAdb('shell uiautomator dump /sdcard/pf_ui.xml', device);
    return await runAdb('shell cat /sdcard/pf_ui.xml', device);
  } catch (e) { return ''; }
}
function findByText(xml, query) {
  const nodes = xml.match(/<node[^>]*>/g) || [];
  const q = query.toLowerCase();
  for (const n of nodes) {
    const text = (n.match(/text="([^"]*)"/) || [, ''])[1];
    const desc = (n.match(/content-desc="([^"]*)"/) || [, ''])[1];
    if (text.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
      const b = (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) );
      if (b) return { x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2) };
    }
  }
  return null;
}

// Cari elemen di layar (text/desc) via satu dump.
async function dumpFind(device, queries) {
  const xml = await getUiXml(device);
  for (const q of (Array.isArray(queries) ? queries : [queries])) {
    const pos = findByText(xml, q);
    if (pos) return pos;
  }
  return null;
}

// -------- Tap-Server (broadcast) --------
async function bcast(device, action, extras = '') {
  return runAdb(`shell "am broadcast -a ${TAPPER_PKG}.${action} -p ${TAPPER_PKG} ${extras}"`, device).catch(() => {});
}
function tapAbs(device, x, y) { return bcast(device, 'TAP', `--ei x ${Math.round(x)} --ei y ${Math.round(y)}`); }
function swipeAbs(device, x1, y1, x2, y2, dur = 300) {
  return bcast(device, 'SWIPE', `--ei x1 ${x1|0} --ei y1 ${y1|0} --ei x2 ${x2|0} --ei y2 ${y2|0} --ei dur ${dur|0}`);
}
function setText(device, text) {
  const b64 = Buffer.from(String(text || ''), 'utf8').toString('base64');
  return bcast(device, 'TEXT', `--es b64 ${b64}`);
}
function scanMedia(device, remotePath) { return bcast(device, 'SCAN', `--es path ${remotePath}`); }

// Nyalakan layar + buka keyguard (tanpa injeksi power). Butuh kunci swipe/none.
async function wakeScreen(device) {
  await bcast(device, 'WAKE');
  await runAdb(`shell am start -n ${TAPPER_PKG}/${TAPPER_PKG}.WakeActivity`, device).catch(() => {});
  await sleep(1500);
}
// Matikan layar (lock) biar HP adem di antara jadwal.
async function screenOff(device) { await bcast(device, 'SCREEN_OFF'); }

async function isScreenOn(device) {
  const out = await runAdb('shell dumpsys power', device).catch(() => '');
  return /mWakefulness=Awake|Display Power: state=ON/.test(out);
}

// Koordinat sebagai rasio layar (Redmi Note 8 1080x2340 → divalidasi).
const RATIO = {
  liveVideoTab: [0.500, 0.896],
  createBtn:    [0.944, 0.0624],
  galeriBtn:    [0.793, 0.752],
  galleryFirst: [0.122, 0.210],
  previewNext:  [0.825, 0.894],
  editorNext:   [0.837, 0.882],
  captionField: [0.606, 0.141],
  captionOk:    [0.930, 0.0611],
  addProduct:   [0.657, 0.311],
  importIcon:   [0.926, 0.0611],
  linkField:    [0.498, 0.201],
  importBtn:    [0.498, 0.390],
  pilihSemua:   [0.055, 0.882],
  addConfirm:   [0.641, 0.882],
  postingBtn:   [0.567, 0.904]
};

// Kalibrasi rasio per-model HP (drop-in). File JSON: { "Redmi_Note_8": { "postingBtn": [0.57,0.90] }, ... }
// Lokasi: sessions/shopee_ratio_overrides.json (atau path di env SHOPEE_RATIO_FILE).
function loadRatioOverrides(model) {
  const files = [
    process.env.SHOPEE_RATIO_FILE,
    path.resolve(__dirname, '../../../sessions/shopee_ratio_overrides.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'shopee_ratio_overrides.json') : null
  ].filter(Boolean);
  for (const f of files) {
    try {
      if (!fs.existsSync(f)) continue;
      const data = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
      const key = Object.keys(data).find((k) => k && model && model.toLowerCase().includes(k.toLowerCase()));
      if (key) return data[key] || {};
    } catch (e) {}
  }
  return {};
}

// -------- helpers --------
async function pushVideo(device, localVideoPath) {
  const remote = `/sdcard/DCIM/Camera/shp_${Date.now()}.mp4`;
  await runAdb(`push "${path.resolve(localVideoPath)}" "${remote}"`, device);
  await scanMedia(device, remote);  // ekstrak metadata biar muncul di galeri Shopee
  await sleep(2500);
  return remote;
}

// Dialog izin sistem BISA dibaca uiautomator → tap via teks (hanya muncul 1x).
async function grantIfPermissionDialog(device, labels) {
  const xml = await getUiXml(device);
  for (const label of labels) {
    const pos = findByText(xml, label);
    if (pos) { await tapAbs(device, pos.x, pos.y); await sleep(1500); return true; }
  }
  return false;
}

async function launchShopeeFresh(device) {
  await runAdb(`shell am force-stop ${SHOPEE_PKG}`, device).catch(() => {});
  await sleep(1000);
  await runAdb(`shell monkey -p ${SHOPEE_PKG} -c android.intent.category.LAUNCHER 1`, device).catch(() => {});
  await sleep(8000);
}

async function probeScreen(device) {
  const xml = await getUiXml(device);
  const nodes = xml.match(/<node[^>]*>/g) || [];
  const rows = nodes.map((n) => ({
    text: (n.match(/text="([^"]*)"/) || [, ''])[1],
    desc: (n.match(/content-desc="([^"]*)"/) || [, ''])[1],
    id: (n.match(/resource-id="([^"]*)"/) || [, ''])[1],
    bounds: (n.match(/bounds="([^"]*)"/) || [, ''])[1]
  })).filter((r) => r.text || r.desc || r.id);
  return { rows, xml };
}

async function screenshot(device, outPath) {
  await runAdb(`exec-out screencap -p > "${outPath}"`, device).catch(() => {});
  return outPath;
}

// -------- alur utama --------
// opts: { videoPath, caption, productLinks:[], serial, onProgress, stopBeforePost, speed }
async function postShopeeVideo(opts) {
  const { videoPath, caption = '', productLinks = [], serial = '', onProgress, stopBeforePost = false, screenOffWhenDone = true } = opts || {};
  const k = opts && opts.speed ? opts.speed : 1;          // pengali waktu tunggu (HP lambat → naikkan)
  const log = (m) => { console.log(`[Shopee ADB] ${m}`); if (typeof onProgress === 'function') onProgress(m); };
  const wait = (ms) => sleep(Math.round(ms * k));

  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Berkas video tidak ditemukan di komputer.');

  const device = await getConnectedDevice(serial);
  if (!device) throw new Error('HP Android tidak terhubung (ADB). Hubungkan HP dulu.');
  if (!(await hasShopee(device))) throw new Error('Aplikasi Shopee belum terpasang di HP.');
  if (!(await hasTapper(device))) throw new Error('Tap Server belum terpasang di HP.');
  if (!(await tapperEnabled(device))) throw new Error('Tap Server belum diaktifkan di Setelan > Aksesibilitas.');

  const screen = await getScreenSize(device);
  // rasio: default → kalibrasi file per-model → override per-panggilan (prioritas tertinggi)
  const devInfo = (await listDevices()).find((x) => x.serial === device) || {};
  const fileOv = loadRatioOverrides(devInfo.model || '');
  const R = { ...RATIO, ...fileOv, ...((opts && opts.ratioOverride) || {}) };
  if (Object.keys(fileOv).length) log(`Kalibrasi rasio untuk ${devInfo.model} dimuat (${Object.keys(fileOv).length} titik).`);
  // tap berbasis rasio (untuk halaman native yang tak terbaca uiautomator)
  const tapR = async (key, ms = 2500) => {
    const [rx, ry] = R[key];
    await tapAbs(device, screen.width * rx, screen.height * ry);
    await wait(ms);
  };
  // tap berbasis TEKS (universal lintas HP) — cari lalu ketuk
  const tapText = async (queries, { attempts = 6, interval = 1200, after = 1800 } = {}) => {
    for (let i = 0; i < attempts; i++) {
      const pos = await dumpFind(device, queries);
      if (pos) { await tapAbs(device, pos.x, pos.y); await wait(after); return true; }
      await wait(interval);
    }
    return false;
  };
  const waitText = async (queries, { attempts = 10, interval = 1500 } = {}) => {
    for (let i = 0; i < attempts; i++) {
      if (await dumpFind(device, queries)) return true;
      await wait(interval);
    }
    return false;
  };
  // tap berbasis OCR (baca teks dari screenshot) — untuk halaman native yg beda posisi antar HP
  const ocrShot = path.join(os.tmpdir(), `shp_ocr_${String(device).replace(/[^\w]/g, '')}.png`);
  const ocrTap = async (queries, after = 1800) => {
    try {
      await runAdb(`exec-out screencap -p > "${ocrShot}"`, device);
      const pos = await ocr.findInImage(ocrShot, queries);
      if (pos) { await tapAbs(device, pos.x, pos.y); await wait(after); return true; }
    } catch (e) { log(`OCR gagal: ${e.message}`); }
    return false;
  };
  log(`HP ${device} (${screen.width}x${screen.height}) siap.`);

  log('Menyalakan layar HP...');
  await wakeScreen(device);
  log('Mengirim video ke HP...');
  const remote = await pushVideo(device, videoPath);
  log('Membuka Shopee...');
  await launchShopeeFresh(device);

  // 1. Live & Video (native, rasio) → kamera. Loop retry agar tahan timing/feed LIVE.
  log('Masuk ke Live & Video...');
  await tapR('liveVideoTab', 3500);
  let onCamera = false;
  for (let attempt = 1; attempt <= 3 && !onCamera; attempt++) {
    log(`Membuka kamera buat video... (percobaan ${attempt}/3)`);
    await tapR('createBtn', 3000);
    await grantIfPermissionDialog(device, ['SAAT APLIKASINYA DIGUNAKAN', 'Saat aplikasi digunakan', 'IZINKAN', 'Izinkan']);
    onCamera = await waitText(['Galeri', 'Pilih Musik'], { attempts: 5 });
    if (!onCamera) { await tapR('liveVideoTab', 3000); } // mungkin belum di feed / kebuka LIVE → balik ke tab
  }
  if (!onCamera) {
    throw new Error('Gagal masuk halaman kamera Shopee — tombol buat video (+) meleset untuk HP ini.');
  }

  // 2. Galeri (TEKS, universal)
  log('Membuka Galeri...');
  if (!(await tapText(['Galeri'], { attempts: 6, after: 3000 }))) await tapR('galeriBtn', 3000);
  await grantIfPermissionDialog(device, ['IZINKAN', 'Izinkan', 'SAAT APLIKASINYA DIGUNAKAN']);
  if (!(await waitText(['Semua', 'Lanjutkan'], { attempts: 8 }))) {
    throw new Error('Galeri Shopee tidak terbuka.');
  }

  // 3. Pilih video pertama (thumbnail, rasio) → preview
  log('Memilih video...');
  await tapR('galleryFirst', 2800);

  // 4. Lanjutkan preview (TEKS) → editor
  if (!(await tapText(['Lanjutkan'], { attempts: 6, after: 3500 }))) await tapR('previewNext', 3500);
  await waitText(['Potong', 'Efek Suara', 'Lanjutkan'], { attempts: 6 }); // konfirmasi editor

  // 5. Lanjutkan editor (TEKS) → Tambah Keterangan (native)
  if (!(await tapText(['Lanjutkan'], { attempts: 6, after: 4500 }))) await tapR('editorNext', 4500);
  await wait(1500);

  // 6. Caption (native, rasio) — best-effort
  if (caption) {
    log('Mengisi caption...');
    await tapR('captionField', 1800);
    await setText(device, caption);
    await wait(1200);
    await tapR('captionOk', 2000);
  }

  // 7. Produk affiliate (halaman produk & import = TEKS, universal)
  const links = (Array.isArray(productLinks) ? productLinks : [productLinks]).filter(Boolean);
  if (links.length) {
    log(`Menambahkan ${links.length} produk affiliate...`);
    // OCR cari pill "Tambah Produk dan Voucher" (universal lintas HP); rasio sbg cadangan
    if (!(await ocrTap(['Voucher', 'Produk dan Voucher'], 2800))) await tapR('addProduct', 2800);
    if (!(await waitText(['Tambahkan Produk', 'Cari Produk'], { attempts: 8 }))) {
      throw new Error('Gagal buka Tambah Produk — tombol di halaman caption meleset untuk HP ini.');
    }
    await tapR('importIcon', 2200);     // ikon Import Link kanan atas (rasio)
    if (!(await waitText(['Link Produk', 'Paste Link'], { attempts: 6 }))) {
      await tapR('importIcon', 2200);
      if (!(await waitText(['Link Produk', 'Paste Link'], { attempts: 5 }))) {
        throw new Error('Gagal buka Import Link — ikon link kanan atas meleset untuk HP ini.');
      }
    }
    const lf = await dumpFind(device, ['Link Produk']);   // anchor kolom link (universal)
    if (lf) { await tapAbs(device, lf.x, lf.y + Math.round(screen.height * 0.05)); await wait(1200); }
    else { await tapR('linkField', 1200); }
    await setText(device, links.join('\n'));
    await wait(1500);
    await tapR('importBtn', 4500);      // tombol Import di tengah kotak link (rasio; teks "Import" ambigu dgn judul)
    if (!(await waitText(['Komisi', 'terjual', 'Rp'], { attempts: 8 }))) {
      throw new Error('Produk gagal di-import dari link (cek link & internet HP).');
    }
    await tapText(['Pilih Semua'], { attempts: 4, after: 1500 });   // centang semua (TEKS)
    if (!(await tapText(['Tambah'], { attempts: 5, after: 3500 }))) await tapR('addConfirm', 3500);
    await waitText(['Tambah Lainnya', 'Posting'], { attempts: 6 }); // balik ke caption page
  }

  log('Menunggu proses unggah video...');
  await wait(4000);

  let posted = false;
  if (stopBeforePost) {
    log('BERHENTI sebelum Posting (mode aman).');
  } else {
    log('Menekan Posting...');
    await tapR('postingBtn', 6000);
    log('Posting terkirim.');
    posted = true;
  }

  if (screenOffWhenDone && posted) {
    await wait(2000);
    log('Mematikan layar HP...');
    await screenOff(device);
  }
  return { success: true, device, remote, posted };
}

module.exports = {
  SHOPEE_PKG,
  TAPPER_PKG,
  RATIO,
  getAdbPath,
  runAdb,
  listDevices,
  getConnectedDevice,
  pairWifi,
  connectWifi,
  getScreenSize,
  hasShopee,
  hasTapper,
  tapperEnabled,
  getUiXml,
  findByText,
  probeScreen,
  screenshot,
  tapAbs,
  swipeAbs,
  setText,
  scanMedia,
  wakeScreen,
  screenOff,
  isScreenOn,
  pushVideo,
  launchShopeeFresh,
  postShopeeVideo
};
