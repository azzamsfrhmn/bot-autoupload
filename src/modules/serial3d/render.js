/**
 * Render lokal pakai GPU: Chrome headless (WebGL di kartu grafis) → frame JPEG → ffmpeg
 * (encoder dicoba berurutan: h264_nvenc → h264_amf → libx264).
 * Engine three.js disajikan lewat server HTTP kecil (bisa membaca dari dalam app.asar).
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const FPS = 30, W = 1080, H = 1920;
const OUT_W = 900, OUT_H = 1600;   // ukuran video akhir (engine tetap menggambar 1080x1920 lalu diperkecil, teks lebih tajam)
const ENGINE_DIR = path.join(__dirname, 'engine');
const NODE_MODULES = path.resolve(__dirname, '../../../node_modules');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' };

const ENC = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-maxrate', '14M', '-bufsize', '28M'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-qp_b', '24'],
  libx264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17'],
};

/** encoder pertama yang benar-benar jalan di mesin ini (uji 3 frame) */
function pilihEncoder(ffmpeg, urutan = Object.keys(ENC)) {
  for (const e of urutan) {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=s=${W}x${H}:r=30`, '-frames:v', '3', ...ENC[e], '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { windowsHide: true, timeout: 30000 });
    if (r.status === 0) return e;
  }
  return 'libx264';
}

function cariChrome() {
  const c = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

/** server statis: /engine → engine, /vendor → node_modules (three, poppins), /proyek → folder proyek */
function mulaiServer(projectDir) {
  const roots = [['/engine/', ENGINE_DIR], ['/vendor/three/', path.join(NODE_MODULES, 'three/build')], ['/vendor/poppins/', path.join(NODE_MODULES, '@fontsource/poppins')], ['/proyek/', projectDir]];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    for (const [pre, dir] of roots) if (url.startsWith(pre)) { const p = path.normalize(path.join(dir, url.slice(pre.length))); if (p.startsWith(path.normalize(dir))) file = p; }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));   // readFileSync agar bisa membaca dari dalam app.asar
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** buka Chrome headless dengan GPU + engine; mengembalikan { info, frame(t), close } */
async function bukaEngine({ projectDir, chromePath, log = () => {} }) {
  const chrome = chromePath || cariChrome();
  if (!chrome) throw new Error('Google Chrome / Microsoft Edge tidak ditemukan. Render 3D butuh Chrome.');
  const { server, port } = await mulaiServer(projectDir);
  const cdpPort = 56000 + Math.floor(Math.random() * 3000);
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'serial3d-chrome-'));
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${udd}`,
    '--use-angle=d3d11', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1', '--force-color-profile=srgb', `--window-size=${W},${H}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--allow-pre-commit-input',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let browser = null;
  for (let i = 0; i < 40 && !browser; i++) { await new Promise((r) => setTimeout(r, 500)); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 3000 }); } catch (e) {} }
  const close = async () => { try { await browser?.close(); } catch (e) {} try { proc.kill(); } catch (e) {} try { server.close(); } catch (e) {} setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} }, 1500); };
  if (!browser) { await close(); throw new Error('Tidak bisa terhubung ke Chrome (CDP).'); }
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: W, height: H });
    page.on('pageerror', (e) => log('[engine] ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) log('[engine] ' + m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) log(`[engine] ${r.status()} ${r.url()}`); });
    page.on('requestfailed', (r) => log(`[engine] gagal memuat ${r.url()} ${r.failure()?.errorText || ''}`));
    await page.goto(`http://127.0.0.1:${port}/engine/index.html?render=1`, { waitUntil: 'load', timeout: 60000 });
    try { await page.waitForFunction('window.READY === true || !!window.ENGINE_ERROR', null, { timeout: 120000 }); }
    catch (e) { const st = await page.evaluate(() => ({ err: window.ENGINE_ERROR || '', ready: document.readyState, info: !!window.INFO })).catch(() => ({})); throw new Error(`Engine tidak siap dalam 120 dtk (${JSON.stringify(st)})`); }
    const err = await page.evaluate(() => window.ENGINE_ERROR || '');
    if (err) throw new Error('Engine gagal dimuat: ' + err);
    const info = await page.evaluate(() => window.INFO);
    const cdp = await context.newCDPSession(page);
    const frame = async (t, opt = {}) => {
      await page.evaluate((x) => window.renderAt(x), t);
      const r = await cdp.send('Page.captureScreenshot', { format: opt.format || 'jpeg', quality: opt.quality || 96, optimizeForSpeed: true });
      return Buffer.from(r.data, 'base64');
    };
    return { info, frame, close, page };
  } catch (e) { await close(); throw e; }
}

/**
 * Render video penuh.
 * @param {object} o { projectDir, outPath, ffmpeg, chromePath, onProgress(msg, frac), signal, buildAudio(info) -> path audio.wav | null, onInfo(info) }
 */
async function renderSerial({ projectDir, outPath, ffmpeg, chromePath, onProgress = () => {}, signal, buildAudio, encoderList }) {
  const eng = await bukaEngine({ projectDir, chromePath, log: (m) => onProgress(m, null) });
  try {
    const { info } = eng;
    fs.writeFileSync(path.join(projectDir, 'sfx.json'), JSON.stringify({ duration: info.duration, events: info.sfx, musik: info.musik }, null, 1));
    onProgress(`GPU: ${info.gpu} · durasi ${info.duration.toFixed(1)} dtk`, 0);
    if (/swiftshader|software/i.test(info.gpu)) onProgress('[Peringatan] WebGL berjalan di CPU (SwiftShader), render akan lambat.', 0);
    const audio = buildAudio ? await buildAudio(info) : null;
    const enc = pilihEncoder(ffmpeg, encoderList);
    onProgress(`Encoder: ${enc}`, 0);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const total = Math.round(info.duration * FPS);
    const ff = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      ...(audio ? ['-i', audio] : []), '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`, ...ENC[enc], '-pix_fmt', 'yuv420p', '-color_range', 'tv',
      ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []), '-movflags', '+faststart', outPath], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let ffErr = ''; ff.stderr.on('data', (d) => { ffErr += d.toString(); if (ffErr.length > 4000) ffErr = ffErr.slice(-4000); });
    const ffDone = new Promise((resolve) => ff.on('close', resolve));
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      if (signal?.aborted) { try { ff.kill(); } catch (e) {} throw new Error('Dibatalkan'); }
      const buf = await eng.frame(f / FPS);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 30 === 0) { const el = (Date.now() - t0) / 1000; const eta = f ? Math.round((total - f) * (el / f)) : 0; onProgress(`Render ${Math.round((f / total) * 100)}% (${f}/${total} frame${eta ? `, ±${eta} dtk lagi` : ''})`, f / total); }
    }
    ff.stdin.end();
    const code = await ffDone;
    if (code !== 0 || !fs.existsSync(outPath)) throw new Error('ffmpeg gagal: ' + ffErr.slice(-300));
    return { outPath, encoder: enc, gpu: info.gpu, frames: total, seconds: (Date.now() - t0) / 1000, duration: info.duration };
  } finally { await eng.close(); }
}

/** frame uji (jpeg) pada detik tertentu — untuk pratinjau & pengujian tanpa video penuh */
async function renderStills({ projectDir, outDir, times, chromePath, onProgress = () => {} }) {
  const eng = await bukaEngine({ projectDir, chromePath, log: (m) => onProgress(m) });
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const files = [];
    for (const t of times) { const f = path.join(outDir, `t${t.toFixed(2).padStart(6, '0')}.jpg`); fs.writeFileSync(f, await eng.frame(t, { quality: 88 })); files.push(f); }
    return { files, info: eng.info };
  } finally { await eng.close(); }
}

module.exports = { renderSerial, renderStills, bukaEngine, pilihEncoder, cariChrome, ENC, FPS };
