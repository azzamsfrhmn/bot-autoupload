/**
 * src/core/socialPublisher.js
 * Router Utama Publikasi Konten Multi-Platform:
 * - TikTok -> Dialihkan ke Web Creator Studio (Playwright)
 * - Instagram -> Dialihkan ke Web Automation Browser (Playwright / Puppeteer)
 */

const { uploadToTikTok } = require('../platforms/tiktok/tiktokUploader');
const { uploadToInstagram } = require('../platforms/instagram/uploader');

/**
 * Fungsi utama router publikasi otomatis
 * @param {Object} params
 * @param {string} params.platform - 'tiktok' | 'instagram'
 * @param {Array<string>|string} params.mediaPaths - Path file media/video lokal
 * @param {string} params.caption - Teks deskripsi / caption
 * @param {string} [params.accountId] - ID akun aktif
 * @param {Function} [params.onProgress] - Callback status progress
 * @param {Object} [params.authSession] - Data sesi/kuki akun jika diperlukan
 */
async function publishPost({ platform, mediaPaths, caption, accountId, onProgress, authSession }) {
  const log = (msg) => {
    console.log(`[Social Publisher] ${msg}`);
    if (typeof onProgress === 'function') onProgress(msg);
  };

  const targetPlatform = (platform || '').toLowerCase().trim();
  const files = Array.isArray(mediaPaths) ? mediaPaths : [mediaPaths];

  // 1. Jalur TikTok -> Otomasi Browser Web (TikTok Studio)
  if (targetPlatform === 'tiktok') {
    log('Platform TikTok terdeteksi. Mengarahkan proses publikasi ke TikTok Web Creator Studio...');

    return await uploadToTikTok({
      accountId: accountId || authSession?.id || 'default',
      mediaPaths: files,
      caption: caption || '',
      onProgress: (statusMsg) => log(statusMsg)
    });
  }

  // 2. Jalur Instagram -> Otomasi Browser Web
  if (targetPlatform === 'instagram') {
    log('Platform Instagram terdeteksi. Mengarahkan proses publikasi ke Web Instagram...');
    
    return await uploadToInstagram({
      mediaPaths: files,
      caption: caption || '',
      session: authSession,
      onProgress: (statusMsg) => log(statusMsg)
    });
  }

  // Jika ada penambahan platform seperti Pinterest nantinya:
  if (targetPlatform === 'pinterest') {
    log('Platform Pinterest terdeteksi...');
    throw new Error('Modul publikasi Pinterest belum dihubungkan ke publisher router.');
  }

  throw new Error(`Platform '${platform}' tidak dikenali. Pilih antara 'tiktok' atau 'instagram'.`);
}

module.exports = {
  publishPost
};