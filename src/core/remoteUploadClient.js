/**
 * src/core/remoteUploadClient.js
 * Klien Worker Upload 24 Jam (server/upload-worker di license.etnicstore.com).
 * Jadwal TikTok + video dikirim ke server, lalu server yang memposting tepat waktu walau PC mati.
 * Setelan disimpan di sessions/remote_upload.json: { enabled, baseUrl }.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_BASE_URL = 'https://license.etnicstore.com/upload-worker';

let sessionsDir = path.resolve(process.cwd(), 'sessions');

function initRemoteUpload(dir) {
  if (dir) sessionsDir = dir;
}

function configPath() {
  return path.join(sessionsDir, 'remote_upload.json');
}

function getRemoteConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    return { enabled: Boolean(cfg.enabled), baseUrl: cfg.baseUrl || DEFAULT_BASE_URL };
  } catch (e) {
    return { enabled: false, baseUrl: DEFAULT_BASE_URL };
  }
}

function setRemoteConfig(patch = {}) {
  const next = { ...getRemoteConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// Cookie login TikTok akun (disimpan aplikasi saat login) → dikirim ke server bersama jadwal
function loadAccountCookies(username) {
  const clean = String(username || '').replace(/^@/, '').toLowerCase();
  const candidates = [`${clean}.json`, `tiktok_streamer_cookies_${clean}.json`, `tiktokshop_cookies_${clean}.json`];
  for (const name of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(require('./accountFiles').readPath(path.join(sessionsDir, name)), 'utf-8'));
      const list = Array.isArray(raw) ? raw : (raw.cookies || []);
      if (list.some((c) => c.name === 'sessionid' && c.value)) return list.filter((c) => /tiktok/i.test(c.domain || ''));
    } catch (e) {}
  }
  return null;
}

function request(method, url, { auth, json, filePath, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const headers = {
      'x-license-key': auth?.licenseKey || '',
      'x-machine-id': auth?.machineId || ''
    };
    let body = null;
    if (json) {
      body = Buffer.from(JSON.stringify(json));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    } else if (filePath) {
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Length'] = fs.statSync(filePath).size;
    }

    const req = client.request(target, { method, headers, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        reject(new Error(data?.error || `Server worker membalas ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Koneksi ke server worker timeout.')));
    req.on('error', (err) => reject(new Error(`Server worker tidak bisa dihubungi: ${err.message}`)));

    if (filePath) {
      fs.createReadStream(filePath).on('error', reject).pipe(req);
    } else {
      if (body) req.write(body);
      req.end();
    }
  });
}

async function checkRemoteHealth() {
  const { baseUrl } = getRemoteConfig();
  return request('GET', `${baseUrl}/health`, { timeoutMs: 10000 });
}

/**
 * Kirim satu jadwal ke server: buat job, lalu unggah videonya.
 * Mengembalikan job dari server ({ id, status, ... }).
 */
async function createRemoteJob({ auth, mediaPath, caption, productId, productLinkTitle = '', scheduleTime, accountUsername, concept = '' }) {
  if (!auth?.licenseKey || !auth?.machineId) throw new Error('Lisensi aplikasi belum aktif di perangkat ini.');
  if (!mediaPath || !fs.existsSync(mediaPath)) throw new Error('File video tidak ditemukan.');
  if (!/\.(mp4|mov|webm)$/i.test(mediaPath)) throw new Error('Upload 24 jam lewat server hanya untuk video (mp4/mov/webm).');

  const cookies = loadAccountCookies(accountUsername);
  if (!cookies) throw new Error(`Sesi login TikTok @${accountUsername} tidak ditemukan. Login ulang akun di aplikasi.`);

  const { baseUrl } = getRemoteConfig();
  const job = await request('POST', `${baseUrl}/api/jobs`, {
    auth,
    json: {
      accountUsername,
      caption,
      productId,
      productLinkTitle,
      scheduleTime,
      mediaName: path.basename(mediaPath),
      // Konsep dipilih di halaman Jadwal; cadangan dari nama file video
      concept: concept || (() => {
        const k = (path.basename(mediaPath).match(/daster|sensasi|_pov_|remotion_foto|remotion_video|edu3d/i) || [''])[0].toLowerCase().replace(/_/g, '');
        return { remotionfoto: 'daster', remotionvideo: 'pov', edu3d: 'pov' }[k] || k;
      })(),
      cookies
    }
  });

  try {
    // Video bisa besar & koneksi upload rumah lambat → batas waktu longgar
    return await request('PUT', `${baseUrl}/api/jobs/${job.id}/media`, { auth, filePath: mediaPath, timeoutMs: 15 * 60 * 1000 });
  } catch (err) {
    await request('DELETE', `${baseUrl}/api/jobs/${job.id}`, { auth }).catch(() => {});
    throw err;
  }
}

async function listRemoteJobs(auth) {
  const { baseUrl } = getRemoteConfig();
  const res = await request('GET', `${baseUrl}/api/jobs`, { auth });
  return Array.isArray(res?.jobs) ? res.jobs : [];
}

async function cancelRemoteJob(auth, id) {
  const { baseUrl } = getRemoteConfig();
  return request('DELETE', `${baseUrl}/api/jobs/${id}`, { auth });
}

module.exports = {
  initRemoteUpload,
  getRemoteConfig,
  setRemoteConfig,
  checkRemoteHealth,
  createRemoteJob,
  listRemoteJobs,
  cancelRemoteJob
};
