/**
 * server/upload-worker/pack.js
 * Menyiapkan folder siap upload ke server: dist-worker/ berisi worker.js, package.json, README.md
 * dan salinan uploader TikTok dari src/ (lib/). Jalankan dari root proyek: node server/upload-worker/pack.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'dist-worker');

const files = [
  ['server/upload-worker/worker.js', 'worker.js'],
  ['server/upload-worker/package.json', 'package.json'],
  ['server/upload-worker/README.md', 'README.md'],
  ['src/platforms/tiktok/tiktokUploader.js', 'lib/platforms/tiktok/tiktokUploader.js'],
  ['src/platforms/tiktok/tiktokSessionManager.js', 'lib/platforms/tiktok/tiktokSessionManager.js'],
  ['src/services/aiCaption.js', 'lib/services/aiCaption.js'],
  ['src/core/perfProfile.js', 'lib/core/perfProfile.js']
];

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of files) {
  const dest = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), dest);
}
console.log(`Siap upload ke server: ${OUT}`);
