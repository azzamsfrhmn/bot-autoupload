// OCR offline (tesseract.js) untuk menemukan tombol berteks di halaman native Shopee.
// Dipakai untuk tombol yang posisinya beda-beda antar HP (halaman caption):
// caption field, "Pilih Cover", "Tambah Produk dan Voucher".
'use strict';

const path = require('path');
const fs = require('fs');

let _worker = null;
let _initPromise = null;

function resolvePaths() {
  // Catatan: JANGAN set workerPath di Node (tesseract.js pakai worker Node internalnya;
  // menunjuk ke dist/worker.min.js browser bikin error "addEventListener is not a function").
  let coreDir = null;
  try { coreDir = path.dirname(require.resolve('tesseract.js-core/package.json')); } catch (e) {}
  const langCandidates = [
    path.resolve(__dirname, '../../../tools/ocr'),
    process.resourcesPath ? path.join(process.resourcesPath, 'ocr') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'tools/ocr') : null
  ].filter(Boolean);
  const langPath = langCandidates.find((d) => { try { return fs.existsSync(path.join(d, 'eng.traineddata')); } catch (e) { return false; } });
  return { coreDir, langPath };
}

async function getWorker() {
  if (_worker) return _worker;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const { createWorker } = require('tesseract.js');
    const { coreDir, langPath } = resolvePaths();
    const opts = { cacheMethod: 'none', gzip: false, logger: () => {}, errorHandler: () => {} };
    if (coreDir) opts.corePath = coreDir;
    if (langPath) opts.langPath = langPath;
    _worker = await createWorker('eng', 1, opts);
    return _worker;
  })();
  return _initPromise;
}

function collectWords(data) {
  const out = [];
  for (const b of (data.blocks || [])) {
    for (const p of (b.paragraphs || [])) {
      for (const l of (p.lines || [])) {
        for (const wd of (l.words || [])) out.push(wd);
      }
    }
  }
  return out;
}

// Cari salah satu query (substring, abaikan huruf besar/kecil) di gambar PNG.
// Return {x, y} pusat kata (koordinat piksel gambar = piksel layar) atau null.
async function findInImage(pngPath, queries, minConf = 45) {
  const list = Array.isArray(queries) ? queries : [queries];
  const w = await getWorker();
  const { data } = await w.recognize(pngPath, {}, { blocks: true });
  const words = collectWords(data);
  for (const q of list) {
    const ql = q.toLowerCase();
    const hit = words.find((wd) => (wd.text || '').toLowerCase().includes(ql) && (wd.confidence || 0) >= minConf);
    if (hit) return { x: Math.round((hit.bbox.x0 + hit.bbox.x1) / 2), y: Math.round((hit.bbox.y0 + hit.bbox.y1) / 2), text: hit.text };
  }
  return null;
}

async function terminate() {
  try { if (_worker) await _worker.terminate(); } catch (e) {}
  _worker = null; _initPromise = null;
}

module.exports = { findInImage, getWorker, terminate, resolvePaths };
