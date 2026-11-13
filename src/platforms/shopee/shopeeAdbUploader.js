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

// ===================== HP lewat WiFi (tanpa colok USB terus) =====================
// Koneksi lokal per pengguna: PC ⇄ WiFi rumah ⇄ HP. Bisa BANYAK HP (1 HP = 1 akun Shopee),
// dikenali lewat nomor seri (ro.serialno). Disimpan di sessions/shopee_hp.json:
//   { phones: { "<serialNo>": { serialNo, ip, port, model, username, savedAt } } }
// Sebelum posting: HP sudah tersambung? → IP tersimpan → pindai jaringan lokal (port 5555).
const WIFI_PORT = 5555;
// Daftar HP tersimpan (dipakai bersama dengan jalur Tap Server)
const { loadPhones, savePhone, removePhone, loadHpConfig } = require('./phoneStore');
// Jalur Tap Server lewat WiFi (TANPA ADB): alamat perangkat "tap:<ip>:<port>|<deviceId>"
const tap = require('./tapLink');
const isTap = tap.isTap;

// Serial adb lewat jaringan: "192.168.1.7:5555" (tcpip) atau "adb-<seri>-xx._adb-tls-connect._tcp" (Debugging nirkabel)
const isWifiSerial = (s) => /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(String(s || '')) || /_adb-tls-connect\._tcp/.test(String(s || ''));

// ===================== Debugging nirkabel (Android 11+) — TANPA kabel sama sekali =====================
// HP dipasangkan sekali lewat QR / kode 6 digit, lalu ditemukan otomatis lewat mDNS walau port berubah.
async function mdnsServices() {
  const out = await runAdb('mdns services').catch(() => '');
  return out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, type, addr] = l.split(/\s+/);
    const m = String(addr || '').match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/);
    return { name: name || '', type: type || '', ip: m ? m[1] : '', port: m ? +m[2] : 0, addr: addr || '' };
  }).filter((s) => s.ip);
}

// Isi QR untuk "Pasangkan perangkat dengan kode QR" (format sama dengan Android Studio)
function newQrPairing() {
  const rnd = (n, chars) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const name = `botupload-${rnd(6, 'abcdefghijkmnpqrstuvwxyz23456789')}`;
  const password = rnd(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  return { name, password, qrText: `WIFI:T:ADB;S:${name};P:${password};;` };
}

// Setelah dipasangkan: cari layanan "connect" HP di IP yang sama lalu sambungkan
async function connectWirelessAt(ip, log = () => {}, timeoutMs = 25000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const svc = (await mdnsServices()).find((s) => s.type.includes('_adb-tls-connect') && s.ip === ip);
    if (svc) {
      const out = await runAdb(`connect ${svc.ip}:${svc.port}`).catch((e) => e.message);
      if (/connected to/i.test(out || '')) {
        const dev = `${svc.ip}:${svc.port}`;
        await sleep(1200);
        return dev;
      }
    }
    await sleep(1500);
  }
  throw new Error('HP sudah dipasangkan tapi belum bisa disambungkan. Pastikan "Debugging nirkabel" di HP masih AKTIF.');
}

async function rememberWireless(dev, log = () => {}) {
  const serialNo = await getSerialNo(dev);
  const model = ((await runAdb('shell getprop ro.product.model', dev).catch(() => '')) || '').trim().replace(/\s+/g, '_');
  const [ip, port] = dev.split(':');
  savePhone(serialNo, { ip, port: +port, model, method: 'wireless' });
  log(`HP ${model || serialNo} tersambung tanpa kabel (${ip}).`);
  return { device: dev, serialNo, model, ip };
}

// Tunggu HP men-scan QR → pasangkan → sambungkan. Return { device, serialNo, model, ip }.
async function waitQrPairing({ name, password }, log = () => {}, timeoutMs = 180000, shouldStop = () => false) {
  await ensureServer();
  const end = Date.now() + timeoutMs;
  log('Menunggu HP men-scan kode QR...');
  while (Date.now() < end) {
    if (shouldStop()) throw new Error('Dibatalkan.');
    const svc = (await mdnsServices()).find((s) => s.type.includes('_adb-tls-pairing') && s.name === name);
    if (svc) {
      log('HP terdeteksi, memasangkan...');
      const out = await runAdb(`pair ${svc.ip}:${svc.port} ${password}`).catch((e) => e.message);
      if (!/Successfully paired/i.test(out || '')) throw new Error(`Pemasangan gagal: ${String(out || '').trim().slice(0, 160)}`);
      const dev = await connectWirelessAt(svc.ip, log);
      return rememberWireless(dev, log);
    }
    await sleep(1500);
  }
  throw new Error('Waktu habis: HP belum men-scan kode QR. Coba lagi.');
}

// Pasangkan dengan kode 6 digit (cadangan bila scan QR bermasalah). hostPort = "IP:port" dari layar HP.
async function pairWithCode(hostPort, code, log = () => {}) {
  await ensureServer();
  const hp = String(hostPort || '').trim();
  if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(hp)) throw new Error('Format alamat salah. Contoh: 192.168.1.7:37451');
  if (!/^\d{6}$/.test(String(code || '').trim())) throw new Error('Kode pasangan harus 6 angka.');
  log('Memasangkan HP...');
  const out = await runAdb(`pair ${hp} ${String(code).trim()}`).catch((e) => e.message);
  if (!/Successfully paired/i.test(out || '')) throw new Error(`Pemasangan gagal: ${String(out || '').trim().slice(0, 160)}`);
  const dev = await connectWirelessAt(hp.split(':')[0], log);
  return rememberWireless(dev, log);
}

// HP yang sudah pernah dipasangkan nirkabel: cari lewat mDNS (port bisa berubah) & sambungkan.
async function reconnectWireless(cfg, log = () => {}) {
  const svcs = (await mdnsServices()).filter((s) => s.type.includes('_adb-tls-connect'));
  // nama layanan: adb-<serialNo>-<acak>; cadangan: IP tersimpan
  const svc = svcs.find((s) => cfg.serialNo && s.name.includes(cfg.serialNo)) || svcs.find((s) => s.ip === cfg.ip);
  if (!svc) return null;
  log(`Menyambung ulang HP nirkabel (${svc.ip})...`);
  const out = await runAdb(`connect ${svc.ip}:${svc.port}`).catch((e) => e.message);
  if (!/connected to/i.test(out || '')) return null;
  const dev = `${svc.ip}:${svc.port}`;
  if (cfg.serialNo && (await getSerialNo(dev)) !== cfg.serialNo) return null;
  savePhone(cfg.serialNo, { ip: svc.ip, port: svc.port });
  return dev;
}

async function getSerialNo(device) {
  if (isTap(device)) return tap.parse(device).deviceId;
  return (await runAdb('shell getprop ro.serialno', device).catch(() => '')).trim();
}
async function getWifiIp(device) {
  const out = await runAdb('shell ip -f inet addr show wlan0', device).catch(() => '');
  const m = out.match(/inet (\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : '';
}

// Aktifkan mode WiFi saat HP masih tercolok USB. Simpan IP + serial.
// usbSerial opsional: pilih HP USB tertentu bila ada beberapa yang tercolok.
async function enableWifi(log = () => {}, usbSerial = '') {
  await ensureServer();
  const devs = await listDevices();
  const usb = devs.find((d) => d.state === 'device' && !isWifiSerial(d.serial) && !/^emulator-/.test(d.serial)
    && (!usbSerial || d.serial === usbSerial));
  if (!usb) throw new Error('Colok HP lewat USB dulu (USB debugging ON), lalu klik Aktifkan WiFi.');
  const ip = await getWifiIp(usb.serial);
  if (!ip) throw new Error('HP belum tersambung WiFi. Sambungkan HP ke WiFi yang sama dengan PC.');
  const serialNo = await getSerialNo(usb.serial);
  log(`Mengaktifkan mode WiFi (${ip})...`);
  await runAdb(`tcpip ${WIFI_PORT}`, usb.serial).catch(() => {});
  await sleep(3000);
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    const out = await runAdb(`connect ${ip}:${WIFI_PORT}`).catch((e) => e.message);
    ok = /connected to/i.test(out || '');
    if (!ok) await sleep(1500);
  }
  if (!ok) throw new Error(`Gagal tersambung ke HP via WiFi (${ip}). Pastikan HP & PC di WiFi yang sama (bukan WiFi publik/kos yang memblokir antar-perangkat).`);
  savePhone(serialNo, { ip, port: WIFI_PORT, model: usb.model || '' });
  return { ip, port: WIFI_PORT, serialNo, model: usb.model || '', device: `${ip}:${WIFI_PORT}` };
}

// Subnet /24 milik PC (untuk memindai HP kalau IP-nya berubah)
function localSubnets() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && /^(10|172|192)\./.test(ni.address)) {
        out.add(ni.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  return [...out];
}

function portOpen(host, port, timeout = 400) {
  return new Promise((resolve) => {
    const s = new (require('net').Socket)();
    let done = false;
    const end = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeout);
    s.once('connect', () => end(true));
    s.once('timeout', () => end(false));
    s.once('error', () => end(false));
    s.connect(port, host);
  });
}

async function scanForPhone(serialNo, subnets, log = () => {}) {
  for (const net of subnets) {
    log(`Mencari HP di jaringan ${net}.x ...`);
    const hosts = Array.from({ length: 254 }, (_, i) => `${net}.${i + 1}`);
    const open = [];
    for (let i = 0; i < hosts.length; i += 64) {
      const batch = hosts.slice(i, i + 64);
      const res = await Promise.all(batch.map((h) => portOpen(h, WIFI_PORT)));
      batch.forEach((h, k) => { if (res[k]) open.push(h); });
    }
    for (const h of open) {
      const out = await runAdb(`connect ${h}:${WIFI_PORT}`).catch((e) => e.message);
      if (!/connected to/i.test(out || '')) continue;
      const sn = await getSerialNo(`${h}:${WIFI_PORT}`);
      if (!serialNo || sn === serialNo) return h;
      await runAdb(`disconnect ${h}:${WIFI_PORT}`).catch(() => {});
    }
  }
  return null;
}

// HP yang sedang tersambung (USB/WiFi) beserta nomor serinya
async function connectedPhones() {
  const out = [];
  for (const d of await listDevices()) {
    if (d.state !== 'device' || /^emulator-/.test(d.serial)) continue;
    out.push({ device: d.serial, serialNo: await getSerialNo(d.serial), model: d.model, via: isWifiSerial(d.serial) ? 'wifi' : 'usb' });
  }
  return out;
}

// Pastikan HP tersambung (USB atau WiFi). serialNo = nomor seri HP target (kosong = HP mana saja).
// Return serial adb (mis. "a345da1e" atau "192.168.1.7:5555") atau null.
async function ensureConnected(serialNo = '', log = () => {}) {
  // 1) Jalur utama: Tap Server lewat WiFi (tanpa ADB) untuk HP yang sudah dipasangkan
  const viaTap = await tap.connectSaved(serialNo, log).catch(() => null);
  if (viaTap) return viaTap;
  const savedTap = serialNo && (loadPhones()[serialNo] || {}).method === 'tap';
  if (savedTap) return null;                      // HP ini dipasangkan lewat Tap Server → jangan coba ADB
  // 2) Cadangan: ADB (USB / WiFi ADB)
  await ensureServer();
  // bersihkan entri WiFi basi (offline) supaya tidak dipilih
  for (const d of await listDevices()) {
    if (isWifiSerial(d.serial) && d.state !== 'device') await runAdb(`disconnect ${d.serial}`).catch(() => {});
  }
  const live = await connectedPhones();
  const hit = serialNo ? live.find((p) => p.serialNo === serialNo) : (live.find((p) => p.via === 'usb') || live[0]);
  if (hit) return hit.device;

  // belum tersambung → coba IP tersimpan (HP target, atau semua HP tersimpan)
  const phones = loadPhones();
  const targets = serialNo ? [phones[serialNo]].filter(Boolean) : Object.values(phones);
  for (const cfg of targets) {
    if (!cfg.ip && !cfg.serialNo) continue;
    // Debugging nirkabel (Android 11+): port berubah-ubah → cari lewat mDNS, bukan port 5555
    const wl = await reconnectWireless(cfg, log).catch(() => null);
    if (wl) return wl;
    if (cfg.method === 'wireless' || !cfg.ip) continue;
    const port = cfg.port || WIFI_PORT;
    log(`Menyambung ulang HP via WiFi (${cfg.ip})...`);
    // cek port cepat dulu: kalau IP lama mati, jangan tunggu timeout adb connect (~20 dtk)
    const reachable = await portOpen(cfg.ip, port, 800);
    const out = reachable ? await runAdb(`connect ${cfg.ip}:${port}`).catch((e) => e.message) : '';
    if (/connected to/i.test(out || '')) {
      const dev = `${cfg.ip}:${port}`;
      if ((await getSerialNo(dev)) === cfg.serialNo) return dev;
      await runAdb(`disconnect ${dev}`).catch(() => {});
    }
    // IP berubah → pindai jaringan lokal
    const subnets = [...new Set([cfg.ip.split('.').slice(0, 3).join('.'), ...localSubnets()])];
    const found = await scanForPhone(cfg.serialNo, subnets, log);
    if (found) {
      savePhone(cfg.serialNo, { ip: found });
      log(`HP ditemukan di IP baru ${found}.`);
      return `${found}:${WIFI_PORT}`;
    }
  }
  return null;
}

async function getScreenSize(device) {
  if (isTap(device)) {
    const i = await tap.info(device);
    return i && i.width ? { width: i.width, height: i.height } : { width: 1080, height: 2340 };
  }
  try {
    const res = await runAdb('shell wm size', device);
    const m = res.match(/(\d+)x(\d+)/);
    if (m) return { width: +m[1], height: +m[2] };
  } catch (e) {}
  return { width: 1080, height: 2340 };
}

async function hasPackage(device, pkg) {
  if (isTap(device)) return pkg === TAPPER_PKG ? true : tap.hasPackage(device, pkg);
  const pkgs = await runAdb('shell pm list packages', device).catch(() => '');
  return pkgs.includes(pkg);
}
const hasShopee = (device) => hasPackage(device, SHOPEE_PKG);
const hasTapper = (device) => hasPackage(device, TAPPER_PKG);

// Status Tap Server yang SEBENARNYA: 'ok' (terikat & jalan) | 'crashed' (dimatikan sistem,
// mis. MIUI OneKeyClean + autostart ditolak) | 'off' (belum diaktifkan di Aksesibilitas).
async function tapperState(device) {
  if (isTap(device)) return (await tap.info(device)) ? 'ok' : 'off';   // server hanya hidup saat layanan aktif
  const out = await runAdb('shell dumpsys accessibility', device).catch(() => '');
  const line = (label) => (out.match(new RegExp(`${label}:\\{([^\\n]*)`)) || [, ''])[1];
  const bound = line('Bound services');   // ditulis sbg label ("Tap Server") atau nama paket, tergantung versi Android
  if (bound.includes(TAPPER_PKG) || bound.includes('label=Tap Server')) return 'ok';
  if (line('Crashed services').includes(TAPPER_PKG)) return 'crashed';
  return 'off';
}
async function tapperEnabled(device) { return (await tapperState(device)) === 'ok'; }

// Kecualikan Tap Server dari penghemat baterai Android (Doze) agar tidak dimatikan.
async function whitelistTapperBattery(device) {
  if (isTap(device)) return '';                    // tanpa ADB: diatur manual (Setelan > Baterai)
  return runAdb(`shell cmd deviceidle whitelist +${TAPPER_PKG}`, device).catch((e) => e.message);
}

// -------- UI dump (hanya berguna di halaman non-native, mis. dialog izin) --------
async function getUiXml(device) {
  if (isTap(device)) return tap.dump(device).catch(() => '');
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
// Pengaman: ketuk/geser HANYA bila yang tampil adalah Shopee (atau dialog izin sistem).
// Kalau Shopee tertutup (layar utama, browser, kamera bawaan) ketukan dibatalkan → tidak salah buka app lain.
const SAFE_FOCUS = /com.shopee.id|permissioncontroller|packageinstaller|com.android.systemui/;
async function shopeeOnScreen(device) {
  if (!isTap(device)) return true;                   // jalur ADB lama: dicek per langkah
  const f = await currentFocus(device).catch(() => '');
  return !f || SAFE_FOCUS.test(f);
}
async function tapAbs(device, x, y) {
  if (isTap(device)) {
    if (!(await shopeeOnScreen(device))) return false;
    return tap.tapXY(device, x, y).catch(() => {});
  }
  return bcast(device, 'TAP', `--ei x ${Math.round(x)} --ei y ${Math.round(y)}`);
}
async function swipeAbs(device, x1, y1, x2, y2, dur = 300) {
  if (isTap(device)) {
    if (!(await shopeeOnScreen(device))) return false;
    return tap.swipe(device, x1, y1, x2, y2, dur).catch(() => {});
  }
  return bcast(device, 'SWIPE', `--ei x1 ${x1|0} --ei y1 ${y1|0} --ei x2 ${x2|0} --ei y2 ${y2|0} --ei dur ${dur|0}`);
}
function setText(device, text) {
  if (isTap(device)) return tap.text(device, text).catch(() => {});
  const b64 = Buffer.from(String(text || ''), 'utf8').toString('base64');
  return bcast(device, 'TEXT', `--es b64 ${b64}`);
}
function scanMedia(device, remotePath) {
  if (isTap(device)) return tap.scan(device, remotePath).catch(() => {});
  return bcast(device, 'SCAN', `--es path ${remotePath}`);
}

// Nyalakan layar + buka keyguard (tanpa injeksi power). Butuh kunci swipe/none.
async function wakeScreen(device) {
  if (isTap(device)) { await tap.wake(device).catch(() => {}); await sleep(1500); return; }
  await bcast(device, 'WAKE');
  await runAdb(`shell am start -n ${TAPPER_PKG}/${TAPPER_PKG}.WakeActivity`, device).catch(() => {});
  await sleep(1500);
}
// Matikan layar (lock) biar HP adem di antara jadwal.
async function screenOff(device) {
  if (isTap(device)) return tap.screenOff(device).catch(() => {});
  await bcast(device, 'SCREEN_OFF');
}

async function isScreenOn(device) {
  if (isTap(device)) { const i = await tap.info(device); return !!(i && i.screenOn); }
  const out = await runAdb('shell dumpsys power', device).catch(() => '');
  return /mWakefulness=Awake|Display Power: state=ON/.test(out);
}

// Koordinat sebagai rasio layar (Redmi Note 8 1080x2340 → divalidasi).
const RATIO = {
  liveVideoTab: [0.500, 0.896],
  sayaTab:      [0.900, 0.896],
  creatorProfileBtn: [0.059, 0.0624],   // ikon profil kiri atas di feed Live & Video
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
    path.join(process.cwd(), 'sessions', 'shopee_ratio_overrides.json'),
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
  if (isTap(device)) {                              // kirim lewat WiFi; Tap Server simpan ke Galeri & pindai
    const remotePath = await tap.upload(device, path.resolve(localVideoPath), `shp_${Date.now()}.mp4`);
    await sleep(2500);
    return remotePath;
  }
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

// Tutup popup promo Shopee (mis. "Belanja Instant") yang menutupi layar saat app dibuka.
// Ciri tombol X: kecil, persegi, clickable, tanpa resource-id & content-desc, di area tengah layar.
async function dismissPopups(device, maxRounds = 3) {
  const screen = await getScreenSize(device);
  let closed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const xml = await getUiXml(device);
    let target = null;
    for (const n of (xml.match(/<node[^>]*>/g) || [])) {
      const g = (a) => (n.match(new RegExp(`${a}="([^"]*)"`)) || [, ''])[1];
      if (g('clickable') !== 'true' || g('resource-id') || g('content-desc') || g('text')) continue;
      const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!b) continue;
      const [l, t, r, bo] = [+b[1], +b[2], +b[3], +b[4]];
      const w = r - l, h = bo - t;
      const minS = screen.width * 0.045, maxS = screen.width * 0.12;
      if (w < minS || w > maxS || Math.abs(w - h) > w * 0.2) continue;          // kecil & persegi
      if (t < screen.height * 0.15 || bo > screen.height * 0.85) continue;      // bukan header / bottom-nav
      target = { x: Math.round((l + r) / 2), y: Math.round((t + bo) / 2) };
      break;
    }
    if (!target) break;
    await tapAbs(device, target.x, target.y);
    closed++;
    await sleep(1500);
  }
  return closed;
}

async function launchShopeeFresh(device) {
  if (isTap(device)) {                              // tanpa ADB: buka dari awal (task lama dibersihkan)
    await tap.home(device).catch(() => {});
    await sleep(800);
    await tap.launch(device, SHOPEE_PKG, true).catch(() => {});
    await waitShopeeOpened(device);
    await sleep(6000);
    return;
  }
  await runAdb(`shell am force-stop ${SHOPEE_PKG}`, device).catch(() => {});
  await sleep(1000);
  await runAdb(`shell monkey -p ${SHOPEE_PKG} -c android.intent.category.LAUNCHER 1`, device).catch(() => {});
  await sleep(8000);
  // Catatan: popup promo TIDAK ditebak-tutup (berisiko salah klik). Ditangani reaktif:
  // bila halaman tujuan tak tercapai → pressBack() lalu coba lagi.
}

// Tap Server: pastikan Shopee benar-benar terbuka. MIUI diam-diam memblokir app membuka app lain dari
// latar belakang → tanpa cek ini bot akan mengetuk layar utama (kena browser/kamera).
const BG_START_HELP = 'MIUI memblokir Tap Server membuka Shopee. Di HP: buka app Tap Server → ketuk "Izinkan SEMUA izin" → Izin lainnya → aktifkan SEMUANYA (termasuk "Menampilkan jendela pop-up saat berjalan di latar belakang"), lalu coba lagi.';
async function waitShopeeOpened(device, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = await currentFocus(device).catch(() => '');
    if (f.includes(SHOPEE_PKG)) return true;
    await sleep(1000);
  }
  const info = await tap.info(device).catch(() => null);
  if (info && info.bgStart === false) throw new Error(BG_START_HELP);
  throw new Error('Shopee tidak terbuka di HP. ' + BG_START_HELP);
}

// Tombol Back Android lewat Tap Server (input keyevent diblokir MIUI). Menutup popup / kembali.
async function pressBack(device) {
  if (isTap(device)) await tap.back(device).catch(() => {});
  else await bcast(device, 'BACK');
  await sleep(1500);
}

// Pastikan Shopee di depan (mis. setelah Back ternyata keluar app) tanpa force-stop.
async function ensureShopeeForeground(device) {
  const focus = await currentFocus(device);
  if (!focus.includes(SHOPEE_PKG)) {
    if (isTap(device)) { await tap.launch(device, SHOPEE_PKG, false).catch(() => {}); await waitShopeeOpened(device); await sleep(4000); return; }
    await runAdb(`shell monkey -p ${SHOPEE_PKG} -c android.intent.category.LAUNCHER 1`, device).catch(() => {});
    await sleep(6000);
  }
}
async function currentFocus(device) {
  if (isTap(device)) { const f = await tap.focus(device); return `${f.pkg || ''}/${f.cls || ''}`; }
  const out = await runAdb('shell dumpsys window', device).catch(() => '');
  return (out.split('\n').find((l) => /mCurrentFocus/.test(l)) || '').trim();
}

// Baca username akun Shopee yang login di app HP (tab "Saya", elemen id labelUserName).
// Anggap Shopee sudah terbuka di beranda (panggil launchShopeeFresh dulu).
async function readLoggedInUsername(device, log = () => {}) {
  const screen = await getScreenSize(device);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await tapAbs(device, screen.width * RATIO.sayaTab[0], screen.height * RATIO.sayaTab[1]);
    await sleep(3500);
    for (let i = 0; i < 4; i++) {
      const xml = await getUiXml(device);
      const node = (xml.match(/<node[^>]*resource-id="[^"]*labelUserName"[^>]*>/) || [])[0];
      const name = node ? (node.match(/text="([^"]*)"/) || [, ''])[1].trim() : '';
      if (name) return name;
      await sleep(1200);
    }
    log(`Tab Saya belum terbaca, ulangi (${attempt}/3)...`);
    await pressBack(device);              // tutup popup / halaman nyasar
    await ensureShopeeForeground(device);
  }
  return '';
}

// Baca akun dari BERANDA KREATOR Shopee Video (Live & Video → ikon profil kiri atas).
// Halaman ini terbaca uiautomator: "Username: xxx", nama tampilan, jumlah pengikut.
// Setelah terbaca, kembali ke feed (Back). Return {username, name, followers} atau null.
async function readCreatorAccount(device, log = () => {}, opts = {}) {
  const screen = await getScreenSize(device);
  const tap = (k) => tapAbs(device, screen.width * RATIO[k][0], screen.height * RATIO[k][1]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ensureShopeeForeground(device);
    await tap('liveVideoTab'); await sleep(3500);
    await tap('creatorProfileBtn'); await sleep(4000);
    for (let i = 0; i < 3; i++) {
      const xml = await getUiXml(device);
      const prof = parseCreatorProfile(xml);
      if (prof) {
        if (opts.shotDir) {                            // foto profil & sampul video: potong dari screenshot
          await captureCreatorImages(device, prof, typeof opts.shotDir === 'function' ? opts.shotDir(prof) : opts.shotDir, screen).catch((e) => log(`Gambar profil gagal: ${e.message}`));
        }
        await pressBack(device);                       // kembali ke feed
        return prof;
      }
      await sleep(1200);
    }
    log(`Beranda kreator belum terbaca, ulangi (${attempt}/3)...`);
    await pressBack(device);                           // tutup popup / halaman nyasar
  }
  return null;
}

// Urai halaman "beranda kreator" (dump aksesibilitas) → data profil lengkap.
const parseBounds = (b) => { const m = String(b || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m ? m.slice(1).map(Number) : null; };
function parseCreatorProfile(xml) {
  const nodes = (String(xml).match(/<node[^>]*>/g) || []).map((n) => ({
    text: ((n.match(/text="([^"]*)"/) || [, ''])[1] || '').trim(),
    desc: ((n.match(/content-desc="([^"]*)"/) || [, ''])[1] || '').trim(),
    b: parseBounds((n.match(/bounds="([^"]*)"/) || [, ''])[1])
  }));
  const texts = nodes.filter((n) => n.text);
  const k = texts.findIndex((n) => /^Username:/i.test(n.text));
  if (k < 0) return null;
  const username = texts[k].text.replace(/^Username:\s*/i, '').trim();
  if (!username) return null;
  const before = (re) => { const i = texts.findIndex((n) => re.test(n.text)); return i > 0 ? texts[i - 1].text : ''; };
  const STOP = /^(Toko Saya|Acara Live|Ubah Profil|Pusat Kreator|Posting|Live|Produk|Disukai|Atur)$/i;
  const bioNode = texts[k + 1];
  const bio = bioNode && !STOP.test(bioNode.text) ? bioNode.text : '';
  // kotak angka statistik → posisi foto profil (di kiri baris statistik)
  const statBox = (nodes.find((n) => /click following nums/i.test(n.desc)) || {}).b;
  const nameBox = (nodes.find((n) => /nick name of me/i.test(n.desc)) || {}).b;
  // video yang terlihat di tab Posting
  const videos = nodes.filter((n) => /^click video \d+$/i.test(n.desc) && n.b).map((n) => {
    const [x1, y1, x2, y2] = n.b;
    const v = texts.find((t) => t.b && t.b[0] >= x1 && t.b[2] <= x2 && t.b[1] >= y1 && t.b[3] <= y2 && /^[\d.,]+\s*(RB|JT|K|M)?$/i.test(t.text));
    return { bounds: n.b, views: v ? v.text : '0' };
  });
  return {
    username,
    name: k > 0 ? texts[k - 1].text : '',
    bio,
    following: before(/^(Mengikuti|Following)$/i),
    followers: before(/^(Pengikut|Followers)$/i),
    likes: before(/^(Suka|Likes)$/i),
    videos,
    _layout: { statBox, nameBox }
  };
}

// "4,1RB" → 4100, "1,2JT" → 1200000
function parseCount(v) {
  const m = String(v || '').trim().match(/^([\d.,]+)\s*(RB|JT|K|M)?$/i);
  if (!m) return 0;
  const unit = (m[2] || '').toUpperCase();
  const num = parseFloat(unit ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''));
  return Math.round(num * ({ RB: 1e3, K: 1e3, JT: 1e6, M: 1e6 }[unit] || 1)) || 0;
}

async function cropPng(src, dst, x, y, w, h, scale = 0) {
  const { getFfmpegPath } = require('../../core/videoEnhancer');
  const bin = getFfmpegPath();
  if (!bin) throw new Error('ffmpeg tidak ditemukan');
  const vf = `crop=${Math.round(w)}:${Math.round(h)}:${Math.round(x)}:${Math.round(y)}${scale ? `,scale=${scale}:-2` : ''}`;
  await new Promise((res) => require('child_process').execFile(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, '-frames:v', '1', dst], { windowsHide: true }, () => res()));
  return fs.existsSync(dst) ? dst : '';
}

async function captureCreatorImages(device, prof, dir, screen) {
  fs.mkdirSync(dir, { recursive: true });
  const shot = path.join(dir, '_profile_shot.png');
  await screenshot(device, shot);
  if (!fs.existsSync(shot) || fs.statSync(shot).size < 1000) throw new Error('screenshot HP tidak tersedia');
  const { statBox, nameBox } = prof._layout || {};
  if (statBox) {
    const size = Math.round(screen.width * 0.19);
    const cy = (statBox[1] + statBox[3]) / 2;
    const x = nameBox ? nameBox[0] : Math.round(screen.width * 0.04);
    const out = await cropPng(shot, path.join(dir, 'avatar.png'), x, Math.max(0, cy - size / 2), size, size, 256);
    if (out) prof.avatarFile = out;
  }
  prof.videos.forEach((v, i) => { v.coverFile = path.join(dir, `video_${i}.png`); });
  for (const v of prof.videos) {
    const [x1, y1, x2, y2] = v.bounds;
    if (!(await cropPng(shot, v.coverFile, x1, y1, x2 - x1, y2 - y1, 360))) v.coverFile = '';
  }
  try { fs.unlinkSync(shot); } catch (e) {}
}

// Hubungkan / baca akun: buka Shopee di HP lalu ambil akun kreator yang login.
async function readShopeeAccount(device, log = () => {}, opts = {}) {
  if (!(await hasShopee(device))) throw new Error('Aplikasi Shopee belum terpasang di HP.');
  if ((await tapperState(device)) !== 'ok') throw new Error('Tap Server belum aktif di HP.');
  await wakeScreen(device);
  log('Membuka Shopee di HP...');
  await launchShopeeFresh(device);
  log('Membaca akun dari beranda kreator...');
  let acc = await readCreatorAccount(device, log, opts);
  if (!acc) {                                          // cadangan: tab "Saya"
    const u = await readLoggedInUsername(device, log);
    if (u) acc = { username: u, name: '', followers: '' };
  }
  if (!acc) throw new Error('Akun Shopee tidak terbaca. Pastikan app Shopee di HP sudah LOGIN, lalu coba lagi.');
  return acc;
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
  if (isTap(device)) { await tap.screenshot(device, outPath).catch(() => false); return outPath; }
  await runAdb(`exec-out screencap -p > "${outPath}"`, device).catch(() => {});
  return outPath;
}

// -------- alur utama --------
// opts: { videoPath, caption, productLinks:[], serialNo, expectUsername, onProgress, stopBeforePost, speed }
//   serialNo       = nomor seri HP milik akun (kosong = HP mana saja yang tersambung)
//   expectUsername = username Shopee akun jadwal; bila diisi, dicek dulu di HP (cegah salah akun)
async function postShopeeVideo(opts) {
  const { videoPath, caption = '', productLinks = [], onProgress, stopBeforePost = false, screenOffWhenDone = true, expectUsername = '' } = opts || {};
  const serial = (opts && (opts.serialNo || opts.serial)) || '';
  const k = opts && opts.speed ? opts.speed : 1;          // pengali waktu tunggu (HP lambat → naikkan)
  const log = (m) => { console.log(`[Shopee ADB] ${m}`); if (typeof onProgress === 'function') onProgress(m); };
  const wait = (ms) => sleep(Math.round(ms * k));

  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Berkas video tidak ditemukan di komputer.');

  const device = await ensureConnected(serial, log);
  if (!device) {
    const cfg = loadHpConfig(serial);
    throw new Error(cfg.ip
      ? `HP tidak ditemukan di WiFi (terakhir ${cfg.ip}). Pastikan HP menyala & di WiFi yang sama dengan PC (bukan data seluler). Kalau HP baru restart: colok USB sekali lalu klik "Aktifkan WiFi".`
      : 'HP Android tidak terhubung. Colok USB (USB debugging ON), lalu klik "Aktifkan WiFi" supaya ke depannya tanpa kabel.');
  }
  if (!(await hasShopee(device))) throw new Error('Aplikasi Shopee belum terpasang di HP.');
  if (!(await hasTapper(device))) throw new Error('Tap Server belum terpasang di HP.');
  if (!(await tapperEnabled(device))) throw new Error('Tap Server belum diaktifkan di Setelan > Aksesibilitas.');

  const screen = await getScreenSize(device);
  // rasio: default → kalibrasi file per-model → override per-panggilan (prioritas tertinggi)
  const devInfo = isTap(device)
    ? { model: ((await tap.info(device)) || {}).model || '' }
    : ((await listDevices()).find((x) => x.serial === device) || {});
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
      if (isTap(device)) {                          // Tap Server: screenshot Android 11+; HP lama → pakai rasio
        if (!(await tap.screenshot(device, ocrShot).catch(() => false))) return false;
      } else {
        await runAdb(`exec-out screencap -p > "${ocrShot}"`, device);
      }
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

  // 0. Pastikan akun yang login di HP = akun jadwal (cegah video masuk ke akun lain)
  if (expectUsername) {
    const acc = await readCreatorAccount(device, log);
    const now = acc ? acc.username : await readLoggedInUsername(device, log);
    if (!now) throw new Error('Akun Shopee di HP tidak terbaca (mungkin belum login). Posting dibatalkan.');
    if (now.toLowerCase() !== String(expectUsername).toLowerCase()) {
      throw new Error(`HP sedang login akun @${now}, bukan @${expectUsername}. Posting dibatalkan agar tidak salah akun.`);
    }
    log(`Akun cocok: @${now}.`);
  }

  // 1. Live & Video (native, rasio) → kamera. Loop retry agar tahan timing/feed LIVE.
  log('Masuk ke Live & Video...');
  await tapR('liveVideoTab', 3500);
  let onCamera = false;
  for (let attempt = 1; attempt <= 3 && !onCamera; attempt++) {
    log(`Membuka kamera buat video... (percobaan ${attempt}/3)`);
    await tapR('createBtn', 3000);
    await grantIfPermissionDialog(device, ['SAAT APLIKASINYA DIGUNAKAN', 'Saat aplikasi digunakan', 'IZINKAN', 'Izinkan']);
    onCamera = await waitText(['Galeri', 'Pilih Musik'], { attempts: 5 });
    if (!onCamera) {                                   // popup / nyasar / feed LIVE → Back lalu ke tab lagi
      await pressBack(device);
      await ensureShopeeForeground(device);
      await tapR('liveVideoTab', 3000);
    }
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
  parseCreatorProfile,
  parseCount,
  SHOPEE_PKG,
  TAPPER_PKG,
  RATIO,
  getAdbPath,
  runAdb,
  listDevices,
  getConnectedDevice,
  pairWifi,
  connectWifi,
  enableWifi,
  newQrPairing,
  waitQrPairing,
  pairWithCode,
  mdnsServices,
  ensureConnected,
  loadHpConfig,
  loadPhones,
  savePhone,
  removePhone,
  connectedPhones,
  getSerialNo,
  readShopeeAccount,
  readLoggedInUsername,
  readCreatorAccount,
  pressBack,
  ensureShopeeForeground,
  isWifiSerial,
  isTap,
  tap,
  getScreenSize,
  hasShopee,
  hasTapper,
  tapperEnabled,
  tapperState,
  whitelistTapperBattery,
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
  dismissPopups,
  postShopeeVideo
};
