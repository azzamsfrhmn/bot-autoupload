/**
 * src/services/ldplayerUploader.js
 * Otomasi Unggah TikTok LDPlayer dengan State Guard Loop (Anti-Lag & Verifikasi Layar)
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LDPLAYER_DIR = 'C:\\LDPlayer\\LDPlayer14';
const LDCONSOLE_PATH = path.join(LDPLAYER_DIR, 'ldconsole.exe');
const DNCONSOLE_PATH = path.join(LDPLAYER_DIR, 'dnconsole.exe');

const DEFAULT_ADB_PATHS = [
  path.join(LDPLAYER_DIR, 'adb.exe'),
  'C:\\LDPlayer\\LDPlayer9\\adb.exe',
  'adb'
];

const BRAND_REPLACEMENTS = [
  { pattern: /\b(spotify|spotipay|spotipai)\b/gi, replacement: 'aplikasi musik hijau' },
  { pattern: /\b(netflix|netflik)\b/gi, replacement: 'aplikasi streaming film' },
  { pattern: /\b(canva|kanva)\b/gi, replacement: 'aplikasi desain grafis' },
  { pattern: /\b(capcut|cap cut|kepkut)\b/gi, replacement: 'aplikasi edit video' },
  { pattern: /\b(youtube premium|yt premium)\b/gi, replacement: 'aplikasi video bebas iklan' },
  { pattern: /\b(disney\+?|disney hotstar)\b/gi, replacement: 'aplikasi film biru' },
  { pattern: /\b(jual|murah|order|wa|whatsapp)\b/gi, replacement: 'dapetin' }
];

function sanitizeCaption(text) {
  if (!text) return '';
  let cleaned = text;
  for (const item of BRAND_REPLACEMENTS) {
    cleaned = cleaned.replace(item.pattern, item.replacement);
  }
  return cleaned;
}

function getAdbPath() {
  for (const candidate of DEFAULT_ADB_PATHS) {
    if (candidate === 'adb') continue;
    if (fs.existsSync(candidate)) return `"${candidate}"`;
  }
  return 'adb';
}

function runAdb(cmd, deviceSerial = '') {
  return new Promise((resolve, reject) => {
    const adb = getAdbPath();
    const target = deviceSerial ? `-s ${deviceSerial} ` : '';
    const fullCommand = `${adb} ${target}${cmd}`;

    exec(fullCommand, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr?.trim() || error.message));
      resolve(stdout.trim());
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getConnectedDevice() {
  let output = await runAdb('devices').catch(() => '');
  let lines = output.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 2 && parts[1] === 'device') return parts[0];
  }

  try {
    await runAdb('connect 127.0.0.1:5555');
    output = await runAdb('devices');
    lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length >= 2 && parts[1] === 'device') return parts[0];
    }
  } catch (e) {}

  return null;
}

async function ensureLDPlayerRunning(onProgress) {
  const log = (msg) => {
    console.log(`[LDPlayer AutoLaunch] ${msg}`);
    if (typeof onProgress === 'function') onProgress(msg);
  };

  let device = await getConnectedDevice();
  if (device) {
    log(`LDPlayer aktif (${device}).`);
    return device;
  }

  log('Membuka LDPlayer secara otomatis...');
  const consoleTool = fs.existsSync(LDCONSOLE_PATH) ? LDCONSOLE_PATH : (fs.existsSync(DNCONSOLE_PATH) ? DNCONSOLE_PATH : null);

  if (consoleTool) {
    spawn(consoleTool, ['launch', '--index', '0'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    const dnplayer = path.join(LDPLAYER_DIR, 'dnplayer.exe');
    if (fs.existsSync(dnplayer)) {
      spawn(dnplayer, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      throw new Error(`Tidak menemukan instalasi LDPlayer di ${LDPLAYER_DIR}`);
    }
  }

  log('Menunggu sistem Android siap...');
  for (let i = 0; i < 45; i++) {
    await sleep(3000);
    device = await getConnectedDevice();
    if (device) {
      try {
        const boot = await runAdb('shell getprop sys.boot_completed', device);
        if (boot.trim() === '1') {
          log(`LDPlayer siap digunakan (${device})!`);
          await sleep(3500);
          return device;
        }
      } catch (e) {}
    }
  }
  throw new Error('LDPlayer gagal booting tepat waktu.');
}

async function getScreenSize(device) {
  try {
    const res = await runAdb('shell wm size', device);
    const match = res.match(/(\d+)x(\d+)/);
    if (match) return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  } catch (e) {}
  return { width: 720, height: 1280 };
}

async function getTikTokPackageName(device) {
  const pkgsRaw = await runAdb('shell pm list packages', device);
  const candidates = [
    'com.zhiliaoapp.musically',
    'com.ss.android.ugc.trill',
    'com.ss.android.ugc.aweme'
  ];

  for (const pkg of candidates) {
    if (pkgsRaw.includes(pkg)) return pkg;
  }
  return null;
}

async function launchTikTokByName(device) {
  const targetPackage = await getTikTokPackageName(device);
  if (!targetPackage) throw new Error('Aplikasi TikTok belum terinstal di LDPlayer.');

  try {
    const resolveOutput = await runAdb(`shell cmd package resolve-activity --brief ${targetPackage}`, device);
    const lines = resolveOutput.split('\n').map((l) => l.trim()).filter(Boolean);
    const mainActivity = lines.find((l) => l.includes('/') && !l.toLowerCase().includes('priority'));
    if (mainActivity) {
      await runAdb(`shell am start -n ${mainActivity}`, device);
      return targetPackage;
    }
  } catch (e) {}

  await runAdb(`shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${targetPackage}`, device).catch(async () => {
    await runAdb(`shell am start -n ${targetPackage}/com.ss.android.ugc.aweme.splash.SplashActivity`, device);
  });

  return targetPackage;
}

// Dump XML dengan penanganan batas waktu agar tidak hang jika emulator berat
async function getUiXml(device) {
  try {
    await runAdb('shell uiautomator dump /sdcard/window_dump.xml', device);
    return await runAdb('shell cat /sdcard/window_dump.xml', device);
  } catch (e) {
    return '';
  }
}

function parseBounds(xml, textQuery) {
  const regex = new RegExp(`(?:text|content-desc)="[^"]*${textQuery}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
  const match = xml.match(regex);
  if (match) {
    const left = parseInt(match[1], 10);
    const top = parseInt(match[2], 10);
    const right = parseInt(match[3], 10);
    const bottom = parseInt(match[4], 10);
    return {
      x: Math.round(left + (right - left) / 2),
      y: Math.round(top + (bottom - top) / 2)
    };
  }
  return null;
}

// Polling pintar yang menunggu elemen teks spesifik muncul
async function waitForElement(device, queryList, maxAttempts = 15, intervalMs = 2000) {
  const queries = Array.isArray(queryList) ? queryList : [queryList];
  for (let i = 0; i < maxAttempts; i++) {
    const xml = await getUiXml(device);
    for (const q of queries) {
      const pos = parseBounds(xml, q);
      if (pos) return { pos, query: q, xml };
    }
    await sleep(intervalMs);
  }
  return null;
}

async function inputSafeCaption(device, text) {
  if (!text) return;
  try {
    const cleanText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
    await runAdb(`shell "service call clipboard 2 i32 1 i32 0 s16 '${cleanText}'"`, device).catch(() => {});
    await sleep(600);
    await runAdb('shell input keyevent 279', device);
  } catch (e) {
    const fallbackText = text.replace(/\s+/g, '%s').replace(/&/g, '\\&');
    await runAdb(`shell input text "${fallbackText}"`, device).catch(() => {});
  }
}

async function uploadToLDPlayerTikTok({ mediaPaths, caption, onProgress }) {
  const log = (msg) => {
    console.log(`[LDPlayer TikTok] ${msg}`);
    if (typeof onProgress === 'function') onProgress(msg);
  };

  const files = Array.isArray(mediaPaths) ? mediaPaths : [mediaPaths];
  if (!files || files.length === 0 || !fs.existsSync(files[0])) {
    throw new Error('Berkas video tidak ditemukan di komputer.');
  }

  const localVideoPath = path.resolve(files[0]);
  const remoteFileName = `tt_${Date.now()}.mp4`;
  const remotePath = `/sdcard/DCIM/Camera/${remoteFileName}`;

  const device = await ensureLDPlayerRunning(onProgress);
  const screen = await getScreenSize(device);
  log(`Resolusi layar: ${screen.width}x${screen.height}`);

  const tap = async (x, y, delay = 2000) => {
    await runAdb(`shell input tap ${Math.round(x)} ${Math.round(y)}`, device);
    await sleep(delay);
  };

  const tapRatio = async (xRatio, yRatio, delay = 2000) => {
    await tap(screen.width * xRatio, screen.height * yRatio, delay);
  };

  try {
    // 1. Kirim video & refresh galeri Android
    log(`Mengirim file video (${path.basename(localVideoPath)})...`);
    await runAdb(`push "${localVideoPath}" "${remotePath}"`, device);
    log('Sinkronisasi galeri Android...');
    await runAdb(`shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remotePath}"`, device);
    await sleep(2500);

    // 2. Cabut izin kamera agar dialog LDPlayer tidak terpicu
    const ttPkg = (await getTikTokPackageName(device)) || 'com.zhiliaoapp.musically';
    log('Menyesuaikan konfigurasi izin kamera TikTok...');
    await runAdb(`shell pm revoke ${ttPkg} android.permission.CAMERA`, device).catch(() => {});

    // 3. Luncurkan TikTok
    log('Membuka aplikasi TikTok...');
    await launchTikTokByName(device);
    log('Menunggu beranda TikTok stabil...');
    await sleep(8000);

    // 4. Tekan Tombol Tambah (+)
    log("Menekan tombol '+' (Posting)...");
    await tapRatio(0.50, 0.945, 3000);

    // Safeguard dialog kamera & panel filter
    const closeX = screen.width * 0.905;
    const closeY = screen.height * 0.215;
    await tap(closeX, closeY, 1200);
    await tap(screen.width * 0.94, screen.height * 0.88, 1200);

    // 5. Buka Galeri (Thumbnail pojok kiri bawah)
    log('Menekan thumbnail Galeri di pojok kiri bawah...');
    const galleryX = Math.round(screen.width * 0.15);
    const galleryY = Math.round(screen.height * 0.93);
    await tap(galleryX, galleryY, 2500);

    // VERIFIKASI: Tunggu antarmuka Galeri benar-benar muncul
    log("Menunggu antarmuka Galeri ('Semua' / 'Video') siap...");
    let galleryOpened = false;

    for (let attempt = 1; attempt <= 12; attempt++) {
      const xml = await getUiXml(device);
      if (
        xml.includes('Semua') ||
        xml.includes('Video') ||
        xml.includes('Pilih lebih dari satu') ||
        xml.includes('Terbaru')
      ) {
        galleryOpened = true;
        log(`Antarmuka Galeri terkonfirmasi aktif!`);
        break;
      }

      log(`Galeri belum terbuka (mungkin emulator lag), mencoba ketuk lagi (${attempt}/12)...`);
      await tap(galleryX, galleryY, 2000);
      await sleep(1500);
    }

    if (!galleryOpened) {
      throw new Error('Gagal membuka galeri TikTok. Layar galeri tidak merespons.');
    }

    // 6. Pilih Video Pertama di Galeri
    log('Memilih item video pertama di galeri...');
    await sleep(2500);
    await tapRatio(0.16, 0.30, 2500);

    // 7. Tekan Tombol 'Berikutnya' dari Galeri
    log("Menekan tombol 'Berikutnya' pada galeri...");
    let nextGalleryBtn = await waitForElement(device, ['Berikutnya', 'Next'], 8, 2000);
    if (nextGalleryBtn) {
      await tap(nextGalleryBtn.pos.x, nextGalleryBtn.pos.y, 4000);
    } else {
      await tapRatio(0.72, 0.95, 4000);
    }

    // 8. STATE GUARD: Tangani Halaman Editor Video (Tambah Suara / AutoCut)
    // Jangan buru-buru, loop sampai halaman editor benar-benar lewat
    log('Mendeteksi transisi layar editor video...');
    for (let attempt = 1; attempt <= 15; attempt++) {
      const xml = await getUiXml(device);

      // Cek apakah sudah sampai di halaman posting akhir
      if (
        xml.includes('Tambah deskripsi') ||
        xml.includes('Posting') ||
        xml.includes('Tambah tautan') ||
        xml.includes('Draf')
      ) {
        log('Berhasil tiba di layar akhir postingan!');
        break;
      }

      // Jika masih ada di layar editor video (seperti pada screenshot Anda)
      if (xml.includes('Tambah suara') || xml.includes('AutoCut') || xml.includes('Story Anda') || xml.includes('Berikutnya')) {
        log(`Emulator masih di layar editor (Percobaan ${attempt}/15). Menekan tombol 'Berikutnya'...`);
        const editorNextPos = parseBounds(xml, 'Berikutnya');
        if (editorNextPos) {
          await tap(editorNextPos.x, editorNextPos.y, 3500);
        } else {
          // Koordinat tombol merah Berikutnya di kanan bawah
          await tapRatio(0.78, 0.95, 3500);
        }
      } else {
        log(`Sedang memproses transisi video... (${attempt}/15)`);
        await sleep(2500);
      }
    }

    // 9. Verifikasi Mutlak Layar Posting Akhir
    log('Memastikan halaman pengaturan deskripsi siap...');
    let postScreenReady = await waitForElement(device, ['Tambah deskripsi', 'Posting', 'Draf'], 12, 2000);
    if (!postScreenReady) {
      // Coba klik tombol berikutnya sekali lagi jika masih tersangkut
      await tapRatio(0.78, 0.95, 3000);
      postScreenReady = await waitForElement(device, ['Tambah deskripsi', 'Posting'], 5, 2000);
      if (!postScreenReady) {
        throw new Error('Emulator terlalu lambat atau gagal beralih ke halaman posting.');
      }
    }

    // 10. Bersihkan & Masukkan Caption Ramah FYP
    let rawCaption = caption;
    if (!rawCaption || rawCaption.trim().length === 0) {
      rawCaption = 'Dengerin lagu favorit bebas jeda iklan bikin mood seharian makin naik! 🎧✨ Playlist di aplikasi musik makin praktis.\n\nKalian lebih sering putar lagu apa nih? Tulis di komentar ya! 👇\n#serunyabelajar #tipsandtricks #rekomendasi #fyp #viral';
    }

    const safeCaption = sanitizeCaption(rawCaption);
    log(`Mengetik caption aman:\n"${safeCaption}"`);

    // Klik kotak "Tambah deskripsi..."
    log('Mengeklik area deskripsi...');
    const descPos = parseBounds(postScreenReady.xml || '', 'Tambah deskripsi');
    if (descPos) {
      await tap(descPos.x, descPos.y, 1500);
    } else {
      await tapRatio(0.25, 0.18, 1500);
    }

    await inputSafeCaption(device, safeCaption);
    await sleep(1200);

    // Sembunyikan keyboard Android
    await runAdb('shell input keyevent 4', device);
    await sleep(1500);

    log('======================================================');
    log('Berhasil! Video telah berada di layar publikasi.');
    log('Silakan tautkan produk Showcase Affiliate Anda, lalu tekan Posting.');
    log('======================================================');

    return {
      success: true,
      device,
      remotePath,
      captionUsed: safeCaption
    };
  } catch (err) {
    log(`Kendala: ${err.message}`);
    throw err;
  }
}

module.exports = {
  uploadToLDPlayerTikTok,
  getConnectedDevice,
  ensureLDPlayerRunning,
  getAdbPath,
  sanitizeCaption
};