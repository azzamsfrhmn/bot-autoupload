/**
 * src/core/videoEnhancer.js
 * Menyiapkan video sebelum diunggah ke TikTok: hasil Google Flow (720p, bitrate rendah) di-upscale ke 1080x1920
 * dengan bitrate tinggi agar kompresi ulang TikTok tidak membuatnya buram.
 * Hasil disimpan di samping file asli sebagai <nama>_hd.mp4 (dipakai ulang jika sudah ada).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TARGET_W = 1080;
const TARGET_H = 1920;

function getFfmpegPath() {
  try {
    // Di aplikasi terpasang, binary berada di app.asar.unpacked (asarUnpack) — tidak bisa dijalankan dari dalam asar
    const p = require('ffmpeg-static');
    const unpacked = p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : null;
    if (unpacked && fs.existsSync(unpacked)) return unpacked;
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return null;
}

// Baca lebar x tinggi track video dari header MP4 (box tkhd), tanpa memanggil ffprobe
function readMp4Dimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, 4 * 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    let moov = buf.indexOf('moov');
    if (moov < 0 && size > buf.length) {
      // moov di akhir file
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      moov = buf.indexOf('moov');
    }
    fs.closeSync(fd);
    let i = buf.indexOf('tkhd', Math.max(0, moov));
    while (i > 0) {
      const version = buf[i + 4];
      const off = i + 4 + (version === 1 ? 88 : 76);
      const w = buf.readUInt32BE(off) / 65536;
      const h = buf.readUInt32BE(off + 4) / 65536;
      if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
      i = buf.indexOf('tkhd', i + 4);
    }
  } catch (e) {}
  return null;
}

function runFfmpeg(ffmpeg, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('FFmpeg melebihi batas waktu.')); }, timeoutMs);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg gagal (kode ${code}): ${stderr.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
    });
  });
}

/**
 * Mengembalikan path video siap upload. Video yang sudah >= 1080 lebar, bukan MP4, atau gagal diproses
 * dikembalikan apa adanya (upload tetap jalan dengan file asli).
 */
// Satu file hanya di-encode sekali walau diminta bersamaan (mis. encode latar setelah render + saat dijadwalkan)
const inFlight = new Map();

function enhanceVideoForTikTok(inputPath, onProgress = () => {}) {
  const key = String(inputPath || '').toLowerCase();
  if (inFlight.has(key)) return inFlight.get(key);
  const job = enhanceVideoForTikTokInner(inputPath, onProgress).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function enhanceVideoForTikTokInner(inputPath, onProgress = () => {}) {
  if (!inputPath || !/\.(mp4|mov)$/i.test(inputPath) || !fs.existsSync(inputPath)) return inputPath;
  if (/_hd\.mp4$/i.test(inputPath)) return inputPath;

  const dims = readMp4Dimensions(inputPath);
  if (dims && Math.min(dims.width, dims.height) >= TARGET_W) return inputPath;

  const outPath = inputPath.replace(/\.(mp4|mov)$/i, '_hd.mp4');
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100000) return outPath;

  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    onProgress('[Kualitas Video] FFmpeg tidak tersedia, video diunggah dengan resolusi asli.');
    return inputPath;
  }

  const portrait = !dims || dims.height >= dims.width;
  const [w, h] = portrait ? [TARGET_W, TARGET_H] : [TARGET_H, TARGET_W];
  const tmpPath = outPath.replace(/\.mp4$/i, '.tmp.mp4');
  onProgress(`[Kualitas Video] Meningkatkan ${dims ? dims.width + 'x' + dims.height : 'video'} → ${w}x${h} (bitrate tinggi) agar tidak buram di TikTok...`);

  try {
    await runFfmpeg(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.5:5:5:0`,
      // veryfast + CRF 20 / maks 8 Mbps: ~3x lebih cepat & file ~45% lebih kecil (upload ke server lebih cepat),
      // tetap jauh di atas bitrate yang dipakai TikTok sehingga hasil tidak buram
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-maxrate', '8M', '-bufsize', '16M',
      '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
      '-movflags', '+faststart',
      tmpPath
    ], 5 * 60 * 1000);
    fs.renameSync(tmpPath, outPath);
    onProgress(`[Kualitas Video] Video HD siap (${Math.round(fs.statSync(outPath).size / 1024 / 1024 * 10) / 10} MB).`);
    return outPath;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    onProgress(`[Kualitas Video] Gagal meningkatkan kualitas (${err.message}), video diunggah dengan resolusi asli.`);
    return inputPath;
  }
}

module.exports = { enhanceVideoForTikTok, readMp4Dimensions, getFfmpegPath };
