/**
 * server/upload-worker/worker.js
 * Worker Upload TikTok 24 jam untuk semua pembeli aplikasi (dijalankan di server, bukan di PC pelanggan).
 *
 * - Akses memakai license key + machine id pelanggan (diverifikasi ke verify.php server lisensi).
 * - Aplikasi mengirim jadwal (POST /api/jobs) lalu file video (PUT /api/jobs/:id/media).
 * - Satu upload berjalan dalam satu waktu (server 2 core), antrean urut jam tayang.
 * - Cookie login TikTok pelanggan disimpan terenkripsi (AES-256-GCM) & dihapus setelah upload selesai.
 *
 * Jalankan: WORKER_SECRET=... xvfb-run -a node worker.js   (lihat README.md)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.WORKER_PORT || 3100);
const HOST = process.env.WORKER_HOST || '127.0.0.1';
const SECRET = process.env.WORKER_SECRET || '';
const LICENSE_VERIFY_URL = process.env.LICENSE_VERIFY_URL || 'https://license.etnicstore.com/verify.php';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAX_PENDING_PER_LICENSE = Number(process.env.MAX_PENDING_PER_LICENSE || 30);
const MAX_DAILY_PER_LICENSE = Number(process.env.MAX_DAILY_PER_LICENSE || 30);
const MAX_MEDIA_MB = Number(process.env.MAX_MEDIA_MB || 300);
const MAX_ATTEMPTS = 2;
const KEEP_FINISHED_DAYS = 7;
const URL_PREFIX = '/upload-worker';

if (SECRET.length < 32) {
  console.error('[Worker] WORKER_SECRET wajib diisi (minimal 32 karakter acak).');
  process.exit(1);
}

// Uploader: hasil pack (lib/) di server, atau langsung dari src/ saat dijalankan dari repo (WORKER_UPLOADER untuk tes)
const uploaderPath = process.env.WORKER_UPLOADER || (fs.existsSync(path.join(__dirname, 'lib/platforms/tiktok/tiktokUploader.js'))
  ? './lib/platforms/tiktok/tiktokUploader'
  : '../../src/platforms/tiktok/tiktokUploader');
const { uploadToTikTok } = require(uploaderPath);

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const DEBUG_DIR = path.join(DATA_DIR, 'debug');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
[DATA_DIR, MEDIA_DIR, PROFILES_DIR, DEBUG_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------
// Penyimpanan antrean
// ---------------------------------------------------------------------------
let jobs = [];
try {
  jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
} catch (e) {
  jobs = [];
}
// Worker mati saat upload berjalan → coba lagi
// Job yang terputus saat worker mati: ulangi bila masih ada jatah percobaan, selain itu tandai gagal
jobs.forEach((j) => {
  if (j.status !== 'running') return;
  if (j.cancelRequested) Object.assign(j, { status: 'canceled', message: 'Dibatalkan pengguna', cookiesEnc: null });
  else if ((j.attempts || 0) >= MAX_ATTEMPTS) Object.assign(j, { status: 'failed', message: 'Gagal: worker berhenti saat upload', cookiesEnc: null });
  else j.status = 'pending';
});

function saveJobs() {
  const tmp = `${JOBS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, JOBS_FILE);
}

function publicJob(j) {
  return {
    id: j.id,
    accountUsername: j.accountUsername,
    caption: j.caption,
    productId: j.productId,
    scheduleTime: j.scheduleTime,
    status: j.status,
    message: j.message || '',
    attempts: j.attempts || 0,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt
  };
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  saveJobs();
}

// ---------------------------------------------------------------------------
// Enkripsi cookie pelanggan
// ---------------------------------------------------------------------------
const KEY = crypto.createHash('sha256').update(SECRET).digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = String(payload).split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

// ---------------------------------------------------------------------------
// Verifikasi lisensi (cache 10 menit valid, 1 menit tidak valid)
// ---------------------------------------------------------------------------
const licenseCache = new Map();

function postJson(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = (url.startsWith('https:') ? https : http).request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 8000
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

async function authenticate(req) {
  const licenseKey = String(req.headers['x-license-key'] || '').trim();
  const machineId = String(req.headers['x-machine-id'] || '').trim();
  if (!licenseKey || !machineId) return null;

  const cacheKey = `${licenseKey}|${machineId}`;
  const cached = licenseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.licenseId;

  const result = await postJson(LICENSE_VERIFY_URL, { license_key: licenseKey, machine_id: machineId });
  if (!result) return null; // server lisensi tidak bisa dihubungi: jangan di-cache
  const licenseId = result.valid ? crypto.createHash('sha256').update(licenseKey).digest('hex').slice(0, 16) : null;
  licenseCache.set(cacheKey, { licenseId, expires: Date.now() + (licenseId ? 10 : 1) * 60 * 1000 });
  return licenseId;
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('Body terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

const ALLOWED_MEDIA = /\.(mp4|mov|webm)$/i;

async function handleCreateJob(req, res, licenseId) {
  const body = await readJsonBody(req);
  const accountUsername = String(body.accountUsername || '').replace(/^@/, '').trim();
  const scheduleTime = new Date(body.scheduleTime || Date.now());
  const mediaName = path.basename(String(body.mediaName || 'video.mp4'));

  if (!accountUsername || !/^[\w.-]{1,64}$/.test(accountUsername)) return send(res, 400, { error: 'Username akun TikTok tidak valid.' });
  if (Number.isNaN(scheduleTime.getTime())) return send(res, 400, { error: 'Waktu jadwal tidak valid.' });
  if (!ALLOWED_MEDIA.test(mediaName)) return send(res, 400, { error: 'Worker server hanya menerima video (mp4/mov/webm).' });
  if (!Array.isArray(body.cookies) || !body.cookies.some((c) => c && c.name === 'sessionid' && c.value)) {
    return send(res, 400, { error: 'Sesi login TikTok akun ini tidak ditemukan. Login ulang akun di aplikasi.' });
  }

  const mine = jobs.filter((j) => j.licenseId === licenseId);
  if (mine.filter((j) => ['awaiting_media', 'pending', 'running'].includes(j.status)).length >= MAX_PENDING_PER_LICENSE) {
    return send(res, 429, { error: `Antrean server penuh (maks ${MAX_PENDING_PER_LICENSE} jadwal aktif per lisensi).` });
  }
  const day = new Date(scheduleTime); day.setHours(0, 0, 0, 0);
  const sameDay = mine.filter((j) => j.status !== 'canceled' && new Date(j.scheduleTime).setHours(0, 0, 0, 0) === day.getTime()).length;
  if (sameDay >= MAX_DAILY_PER_LICENSE) {
    return send(res, 429, { error: `Batas ${MAX_DAILY_PER_LICENSE} upload per hari per lisensi tercapai untuk tanggal itu.` });
  }

  const id = `${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const job = {
    id,
    licenseId,
    accountUsername,
    caption: String(body.caption || '').slice(0, 2200),
    productId: String(body.productId || '').replace(/[^\d]/g, '').slice(0, 32),
    productLinkTitle: String(body.productLinkTitle || '').slice(0, 30),
    concept: ['jj', 'daster', 'sensasi', 'pov'].includes(body.concept) ? body.concept : '',
    scheduleTime: scheduleTime.toISOString(),
    mediaName,
    mediaFile: path.join(MEDIA_DIR, `${id}_${mediaName.replace(/[^\w.-]/g, '_')}`),
    cookiesEnc: encrypt(body.cookies),
    status: 'awaiting_media',
    attempts: 0,
    createdAt: now,
    updatedAt: now
  };
  jobs.push(job);
  saveJobs();
  log(`[Job ${id}] dibuat · lisensi ${licenseId} · @${accountUsername} · ${job.scheduleTime}`);
  send(res, 201, publicJob(job));
}

function handleUploadMedia(req, res, job) {
  if (job.status !== 'awaiting_media') return send(res, 409, { error: 'Video untuk jadwal ini sudah diterima.' });
  const limit = MAX_MEDIA_MB * 1024 * 1024;
  if (Number(req.headers['content-length'] || 0) > limit) return send(res, 413, { error: `Video melebihi ${MAX_MEDIA_MB} MB.` });

  const tmp = `${job.mediaFile}.part`;
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit && !aborted) {
      aborted = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(tmp, { force: true }, () => {});
      send(res, 413, { error: `Video melebihi ${MAX_MEDIA_MB} MB.` });
      req.destroy();
    }
  });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    if (size < 50 * 1024) {
      fs.rm(tmp, { force: true }, () => {});
      return send(res, 400, { error: 'File video kosong / rusak.' });
    }
    fs.renameSync(tmp, job.mediaFile);
    updateJob(job, { status: 'pending', message: 'Menunggu jam tayang' });
    log(`[Job ${job.id}] video diterima (${Math.round(size / 1024)} KB)`);
    send(res, 200, publicJob(job));
  });
  out.on('error', () => {
    if (!aborted) send(res, 500, { error: 'Gagal menyimpan video di server.' });
  });
}

function removeJobFiles(job) {
  if (job.mediaFile) fs.rm(job.mediaFile, { force: true }, () => {});
  if (job.mediaFile) fs.rm(`${job.mediaFile}.part`, { force: true }, () => {});
}

const server = http.createServer(async (req, res) => {
  try {
    let url = new URL(req.url, 'http://localhost').pathname;
    if (url.startsWith(URL_PREFIX)) url = url.slice(URL_PREFIX.length) || '/';

    if (req.method === 'GET' && url === '/health') {
      return send(res, 200, { ok: true, queue: jobs.filter((j) => j.status === 'pending').length, busy: Boolean(runningJobId) });
    }

    const licenseId = await authenticate(req);
    if (!licenseId) return send(res, 401, { error: 'Lisensi tidak valid untuk Worker Upload.' });

    if (req.method === 'GET' && url === '/api/jobs') {
      return send(res, 200, { jobs: jobs.filter((j) => j.licenseId === licenseId).map(publicJob) });
    }
    if (req.method === 'POST' && url === '/api/jobs') {
      return await handleCreateJob(req, res, licenseId);
    }

    const m = url.match(/^\/api\/jobs\/([\w-]+)(\/media)?$/);
    const job = m && jobs.find((j) => j.id === m[1] && j.licenseId === licenseId);
    if (m && !job) return send(res, 404, { error: 'Jadwal tidak ditemukan.' });

    if (job && m[2] && req.method === 'PUT') return handleUploadMedia(req, res, job);
    if (job && !m[2] && req.method === 'DELETE') {
      if (job.status === 'running') {
        // Hentikan di langkah berikutnya (onProgress melempar error → Chrome ditutup uploader)
        updateJob(job, { cancelRequested: true, message: 'Membatalkan upload yang sedang berjalan...' });
        log(`[Job ${job.id}] pembatalan diminta saat upload berjalan`);
        return send(res, 200, publicJob(job));
      }
      removeJobFiles(job);
      updateJob(job, { status: 'canceled', message: 'Dibatalkan pengguna', cookiesEnc: null });
      return send(res, 200, publicJob(job));
    }

    send(res, 404, { error: 'Endpoint tidak dikenal.' });
  } catch (err) {
    log('[HTTP] error', err.message);
    if (!res.headersSent) send(res, 400, { error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Runner antrean (satu upload dalam satu waktu)
// ---------------------------------------------------------------------------
let runningJobId = null;

async function runNextJob() {
  if (runningJobId) return;
  const now = Date.now();
  const byTime = (a, b) => new Date(a.scheduleTime) - new Date(b.scheduleTime);
  const pending = jobs.filter((j) => j.status === 'pending');
  // Jatuh tempo dulu; kalau tidak ada: langsung diunggah (maks 25 hari ke depan) dengan jadwal bawaan TikTok,
  // jadi video tetap terposting walau server mati saat jam posting.
  const dueJob = pending.filter((j) => new Date(j.scheduleTime).getTime() <= now).sort(byTime)[0];
  const earlyJob = dueJob ? null : pending.filter((j) => {
    if (j.noTikTokSchedule) return false;
    const left = new Date(j.scheduleTime).getTime() - now;
    return left > 0 && left <= 25 * 24 * 3600 * 1000;
  }).sort(byTime)[0];
  const job = dueJob || earlyJob;
  if (!job) return;
  const useTikTokSchedule = Boolean(earlyJob);

  runningJobId = job.id;
  updateJob(job, { status: 'running', attempts: (job.attempts || 0) + 1, message: 'Mengunggah ke TikTok...' });
  log(`[Job ${job.id}] mulai upload @${job.accountUsername} (percobaan ${job.attempts})`);

  try {
    const cookies = decrypt(job.cookiesEnc);
    const result = await uploadToTikTok({
      accountId: job.accountUsername,
      mediaPaths: [job.mediaFile],
      caption: job.caption,
      productId: job.productId,
      productLinkTitle: job.productLinkTitle || '',
      concept: job.concept,
      scheduleAt: useTikTokSchedule ? job.scheduleTime : '',
      cookies,
      profileDir: path.join(PROFILES_DIR, `${job.licenseId}_${job.accountUsername.toLowerCase()}`),
      debugDir: path.join(DEBUG_DIR, job.id),
      onProgress: (msg) => {
        if (job.cancelRequested) throw new Error('Dibatalkan pengguna');
        log(`[Job ${job.id}] ${msg}`);
      }
    });
    removeJobFiles(job);
    const msg = result && result.tiktokScheduled ? 'Terjadwal di TikTok (video sudah diunggah)' : 'Berhasil diposting ke TikTok';
    updateJob(job, { status: 'success', message: msg, cookiesEnc: null });
    log(`[Job ${job.id}] SUKSES · ${msg}`);
  } catch (err) {
    if (job.cancelRequested) {
      removeJobFiles(job);
      updateJob(job, { status: 'canceled', message: 'Dibatalkan pengguna', cookiesEnc: null });
      log(`[Job ${job.id}] DIBATALKAN saat upload`);
      return;
    }
    if (useTikTokSchedule && err.code === 'TIKTOK_SCHEDULE_FAILED') {
      // Jadwal TikTok tidak bisa diatur → tunggu jam jadwal & posting cara lama (Now); percobaan tidak dihitung
      updateJob(job, { status: 'pending', noTikTokSchedule: true, attempts: Math.max(0, (job.attempts || 1) - 1), message: `Jadwal TikTok gagal, akan diposting saat jam jadwal: ${err.message}` });
      log(`[Job ${job.id}] jadwal TikTok gagal → menunggu jam jadwal: ${err.message}`);
      return;
    }
    const retry = (job.attempts || 0) < MAX_ATTEMPTS;
    if (!retry) removeJobFiles(job);
    updateJob(job, {
      status: retry ? 'pending' : 'failed',
      message: `${retry ? 'Gagal, dicoba ulang' : 'Gagal'}: ${err.message}`,
      ...(retry ? {} : { cookiesEnc: null })
    });
    log(`[Job ${job.id}] GAGAL (${retry ? 'akan dicoba ulang' : 'final'}): ${err.message}`);
  } finally {
    runningJobId = null;
  }
}

// Bersihkan jadwal lama & video yang tidak pernah selesai dikirim
function cleanup() {
  const cutoff = Date.now() - KEEP_FINISHED_DAYS * 24 * 3600 * 1000;
  const staleUpload = Date.now() - 6 * 3600 * 1000;
  const before = jobs.length;
  jobs = jobs.filter((j) => {
    const updated = new Date(j.updatedAt).getTime();
    if (['success', 'failed', 'canceled'].includes(j.status) && updated < cutoff) {
      fs.rm(path.join(DEBUG_DIR, j.id), { recursive: true, force: true }, () => {});
      return false;
    }
    if (j.status === 'awaiting_media' && updated < staleUpload) { removeJobFiles(j); return false; }
    return true;
  });
  if (jobs.length !== before) saveJobs();
}

setInterval(() => { runNextJob().catch((e) => log('[Runner] error', e.message)); }, 10000);
setInterval(cleanup, 3600 * 1000);
cleanup();

server.listen(PORT, HOST, () => {
  log(`[Worker] Upload worker aktif di http://${HOST}:${PORT}${URL_PREFIX} · data: ${DATA_DIR}`);
});
