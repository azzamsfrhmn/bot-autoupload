/**
 * Jalur Tap Server lewat WiFi — PC mengendalikan HP TANPA ADB / kabel / Opsi pengembang.
 * Tap Server (APK) menjalankan server HTTP mini di HP (port 8765–8767) selama layanan
 * Aksesibilitasnya aktif. PC dipasangkan sekali memakai kode 6 digit di layar Tap Server,
 * lalu memakai token untuk semua perintah.
 *
 * Alamat perangkat di engine: "tap:<ip>:<port>|<deviceId>"
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { loadPhones, savePhone } = require('./phoneStore');

const PORTS = [8765, 8766, 8767];
const isTap = (dev) => String(dev || '').startsWith('tap:');

function parse(dev) {
  const m = String(dev || '').match(/^tap:(\d+\.\d+\.\d+\.\d+):(\d+)\|(.*)$/);
  return m ? { ip: m[1], port: +m[2], deviceId: m[3] } : null;
}
const makeDev = (ip, port, deviceId) => `tap:${ip}:${port}|${deviceId}`;
const tokenOf = (deviceId) => (loadPhones()[deviceId] || {}).token || '';

// ---------- HTTP dasar ----------
function request(ip, port, method, pathName, { body = null, token = '', timeout = 20000, binary = false, stream = null, streamLen = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['X-Token'] = token;
    let payload = null;
    if (stream) { headers['Content-Length'] = streamLen; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== null) {
      payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const req = http.request({ host: ip, port, method, path: pathName, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (binary) return resolve({ status: res.statusCode, data: buf });
        const text = buf.toString('utf8');
        let data = text;
        if (/json/i.test(res.headers['content-type'] || '')) { try { data = JSON.parse(text); } catch (e) {} }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tap Server tidak merespons (timeout).')));
    req.on('error', reject);
    if (stream) { stream.on('error', reject); stream.pipe(req); }
    else { if (payload) req.write(payload); req.end(); }
  });
}

// Perintah ke HP terhubung (dengan token)
async function call(dev, method, pathName, body = null, opts = {}) {
  const p = parse(dev);
  if (!p) throw new Error('Alamat Tap Server tidak valid.');
  const res = await request(p.ip, p.port, method, pathName, { body, token: tokenOf(p.deviceId), ...opts });
  if (res.status === 401) throw new Error('PC belum dipasangkan dengan Tap Server (token ditolak). Hubungkan ulang HP.');
  if (res.status >= 400 && !opts.allowError) throw new Error(`Tap Server error ${res.status}: ${JSON.stringify(res.data).slice(0, 120)}`);
  return res.data;
}

// ---------- pencarian HP di WiFi ----------
function portOpen(host, port, timeout = 450) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const end = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeout);
    s.once('connect', () => end(true));
    s.once('timeout', () => end(false));
    s.once('error', () => end(false));
    s.connect(port, host);
  });
}
function localSubnets() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && /^(10|172|192)\./.test(ni.address)) out.add(ni.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}
async function infoAt(ip, port, timeout = 2500) {
  try {
    const r = await request(ip, port, 'GET', '/info', { timeout });
    return r.status === 200 && r.data && r.data.app === 'tapserver' ? { ...r.data, ip, port } : null;
  } catch (e) { return null; }
}

// Cari semua Tap Server di jaringan lokal. Return [{ip, port, deviceId, model, brand, android, ...}]
async function discover(log = () => {}, subnets = null) {
  const nets = subnets || localSubnets();
  const found = [];
  for (const n of nets) {
    log(`Mencari Tap Server di jaringan ${n}.x ...`);
    const targets = [];
    for (let i = 1; i <= 254; i++) for (const p of PORTS) targets.push([`${n}.${i}`, p]);
    for (let i = 0; i < targets.length; i += 96) {
      const batch = targets.slice(i, i + 96);
      const open = await Promise.all(batch.map(([h, p]) => portOpen(h, p)));
      const hits = batch.filter((_, k) => open[k]);
      for (const [h, p] of hits) {
        const info = await infoAt(h, p);
        if (info && !found.some((f) => f.deviceId === info.deviceId)) found.push(info);
      }
    }
  }
  return found;
}

// Pasangkan PC dengan Tap Server memakai kode 6 digit di layar HP
async function pair(ip, port, code) {
  const r = await request(ip, port, 'POST', '/pair', { body: { code: String(code || '').trim() }, timeout: 8000 });
  if (!r.data || !r.data.ok) throw new Error('Kode pasangan salah. Lihat kode terbaru di layar Tap Server (kode berganti setiap kali dipakai).');
  const info = await infoAt(ip, port);
  if (!info) throw new Error('Tap Server tidak terbaca setelah dipasangkan.');
  savePhone(info.deviceId, { ip, port, token: r.data.token, model: info.model, brand: info.brand, android: info.android, method: 'tap' });
  return { device: makeDev(ip, port, info.deviceId), ...info };
}

// Pasangkan cukup dengan KODE: cari HP di WiFi lalu coba kode ke tiap Tap Server yang ditemukan.
// manualAddr (opsional) = "192.168.1.5" atau "192.168.1.5:8765" dari layar Tap Server.
async function pairByCode(code, log = () => {}, manualAddr = '') {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) throw new Error('Kode harus 6 angka (lihat layar app Tap Server).');
  let candidates = [];
  const m = String(manualAddr || '').trim().match(/^(\d+\.\d+\.\d+\.\d+)(?::(\d+))?$/);
  if (manualAddr && !m) throw new Error('Alamat HP tidak valid. Contoh: 192.168.1.5');
  if (m) {
    for (const port of m[2] ? [+m[2]] : PORTS) {
      const info = await infoAt(m[1], port, 6000);
      if (info) { candidates.push(info); break; }
    }
    if (!candidates.length) throw new Error(`Tap Server tidak menjawab di ${m[1]}. Pastikan app Tap Server terbuka & layanannya AKTIF.`);
  } else {
    // alamat HP yang pernah tersimpan dulu (cepat), lalu pindai jaringan
    for (const p of Object.values(loadPhones())) {
      if (!p.ip) continue;
      const info = await infoAt(p.ip, p.port || PORTS[0]);
      if (info) candidates.push(info);
    }
    log('Mencari HP di WiFi...');
    for (const f of await discover(log)) if (!candidates.some((c) => c.deviceId === f.deviceId)) candidates.push(f);
  }
  if (!candidates.length) throw new Error('HP tidak ditemukan di WiFi ini. Biarkan layar app Tap Server tetap terbuka, pastikan layanannya AKTIF dan HP & PC di WiFi yang sama — atau isi alamat HP secara manual.');
  let wrong = 0;
  for (const c of candidates) {
    try { return await pair(c.ip, c.port, code); }
    catch (e) { wrong++; }
  }
  throw new Error(candidates.length === 1
    ? 'Kode salah. Lihat kode terbaru di layar Tap Server (kode berganti setiap kali dipakai).'
    : `Kode tidak cocok dengan ${wrong} HP yang ditemukan. Cek lagi kode di layar Tap Server.`);
}

// Sambungkan HP Tap Server yang sudah dipasangkan (deviceId opsional = HP tertentu).
// Coba IP tersimpan dulu; kalau IP berubah, pindai jaringan & cocokkan deviceId. Return alamat dev atau null.
async function connectSaved(deviceId = '', log = () => {}) {
  const phones = Object.values(loadPhones()).filter((p) => p.method === 'tap' && p.token && (!deviceId || p.serialNo === deviceId));
  if (!phones.length) return null;
  // HP yang layarnya mati bisa "tidur" (CPU & WiFi hemat daya) → paket pertama hanya membangunkannya.
  // Ketuk berulang ±30 dtk di alamat terakhir sebelum memindai jaringan.
  for (const p of phones) {
    if (!p.ip) continue;
    const t0 = Date.now();
    let first = true;
    while (Date.now() - t0 < 30000) {
      const info = await infoAt(p.ip, p.port || PORTS[0], first ? 2500 : 6000);
      if (info && info.deviceId === p.serialNo) return makeDev(p.ip, info.port, p.serialNo);
      if (first) log('Membangunkan HP (layar mati)...');
      first = false;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  log('HP tidak di alamat lama, mencari di jaringan...');
  const found = await discover(log, [...new Set([...phones.map((p) => String(p.ip || '').split('.').slice(0, 3).join('.')).filter(Boolean), ...localSubnets()])]);
  for (const p of phones) {
    const f = found.find((x) => x.deviceId === p.serialNo);
    if (f) {
      savePhone(p.serialNo, { ip: f.ip, port: f.port });
      log(`HP ditemukan di alamat baru ${f.ip}.`);
      return makeDev(f.ip, f.port, p.serialNo);
    }
  }
  return null;
}

// ---------- operasi untuk engine ----------
const info = async (dev) => { const p = parse(dev); return p ? infoAt(p.ip, p.port) : null; };
const tapXY = (dev, x, y) => call(dev, 'POST', '/tap', { x: Math.round(x), y: Math.round(y) });
const swipe = (dev, x1, y1, x2, y2, dur = 300) => call(dev, 'POST', '/swipe', { x1: x1 | 0, y1: y1 | 0, x2: x2 | 0, y2: y2 | 0, dur: dur | 0 });
const text = (dev, t) => call(dev, 'POST', '/text', { text: String(t || '') });
const back = (dev) => call(dev, 'POST', '/back', {});
const home = (dev) => call(dev, 'POST', '/home', {});
const wake = (dev) => call(dev, 'POST', '/wake', {});
const screenOff = (dev) => call(dev, 'POST', '/screen-off', {});
const scan = (dev, p) => call(dev, 'POST', '/scan', { path: p });
const launch = (dev, pkg, fresh = true) => call(dev, 'POST', '/launch', { pkg, fresh: fresh ? 1 : 0 });
const dump = (dev) => call(dev, 'GET', '/dump', null, { timeout: 15000 }).then((x) => (typeof x === 'string' ? x : ''));
const focus = (dev) => call(dev, 'GET', '/focus').catch(() => ({ pkg: '', cls: '' }));
async function hasPackage(dev, pkg) {
  const r = await call(dev, 'GET', `/packages?names=${encodeURIComponent(pkg)}`).catch(() => ({}));
  return !!(r && r[pkg]);
}
// Screenshot PNG → simpan ke outPath. Return true/false (Android 10 ke bawah: false).
async function screenshot(dev, outPath) {
  const p = parse(dev);
  if (!p) return false;
  const res = await request(p.ip, p.port, 'GET', '/screenshot', { token: tokenOf(p.deviceId), binary: true, timeout: 30000 }).catch(() => null);
  if (!res || res.status !== 200 || !res.data || res.data.length < 1000) return false;
  fs.writeFileSync(outPath, res.data);
  return true;
}
// Kirim video ke Galeri HP. Return path di HP.
async function upload(dev, localPath, name) {
  const size = fs.statSync(localPath).size;
  const res = await call(dev, 'PUT', `/upload?name=${encodeURIComponent(name)}`, null, { stream: fs.createReadStream(localPath), streamLen: size, timeout: 600000 });
  if (!res || !res.ok) throw new Error(`Gagal mengirim video ke HP: ${res && res.error ? res.error : 'tidak diketahui'}`);
  return res.path || name;
}

module.exports = {
  PORTS, isTap, parse, makeDev, discover, pair, connectSaved, infoAt, localSubnets,
  pairByCode, info, tapXY, swipe, text, back, home, wake, screenOff, scan, launch, dump, focus, hasPackage, screenshot, upload
};
