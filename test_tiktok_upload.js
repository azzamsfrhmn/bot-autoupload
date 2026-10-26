/**
 * test_tiktok_upload.js
 * Runner mandiri untuk menguji otomatisasi upload TikTok di LDPlayer
 */
const path = require('path');
const fs = require('fs');

// Impor fungsi uploader dan auto-launcher LDPlayer
const { uploadToLDPlayerTikTok, ensureLDPlayerRunning } = require('./src/services/ldplayerUploader');

async function main() {
  console.log('=== PENGUJIAN UPLOAD TIKTOK LDPLAYER ===\n');

  // 1. Pastikan LDPlayer aktif (jika mati, fungsi ini akan membukanya sendiri)
  try {
    const device = await ensureLDPlayerRunning((status) => {
      console.log(`👉 [LAUNCHER]: ${status}`);
    });
    console.log(`✅ Emulator siap digunakan: ${device}\n`);
  } catch (err) {
    console.error('❌ Gagal menyalakan/mendeteksi LDPlayer:', err.message);
    process.exit(1);
  }

  // 2. Cari berkas video untuk uji coba
  let testVideoPath = '';
  const candidateDirs = [
    path.resolve(__dirname, 'storage/videos'),
    path.resolve(__dirname, 'sessions/generated_videos'),
    path.resolve(__dirname, 'storage/bahan_video')
  ];

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
      if (files.length > 0) {
        testVideoPath = path.join(dir, files[0]);
        break;
      }
    }
  }

  if (!testVideoPath || !fs.existsSync(testVideoPath)) {
    console.error('❌ Tidak ada file video (.mp4) yang ditemukan untuk uji coba.');
    console.error('Tips: Taruh minimal 1 file video di storage/videos/ atau tentukan manual.');
    process.exit(1);
  }

  console.log(`🎬 Menggunakan berkas video: ${testVideoPath}`);

  // 3. Jalankan pipeline upload TikTok
  const testCaption = 'Promo Spesial Canva & CapCut Pro! Cek produk showcase di profil #affiliate #promo';

  console.log('\nMemulai proses pengunggahan ke emulator...');
  try {
    const result = await uploadToLDPlayerTikTok({
      mediaPaths: [testVideoPath],
      caption: testCaption,
      onProgress: (status) => {
        console.log(`👉 [PROGRESS]: ${status}`);
      }
    });

    console.log('\n🎉 UJI COBA BERHASIL!');
    console.log('Detail Hasil:', result);
  } catch (err) {
    console.error('\n❌ Terjadi kesalahan saat pengujian:', err.message);
  }
}

main();