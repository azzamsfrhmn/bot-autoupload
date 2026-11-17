/**
 * src/core/clipboardLock.js
 * Clipboard Windows dipakai bersama oleh semua worker (salin gambar/prompt → Ctrl+V ke Flow/ChatGPT).
 * Urutan "tulis clipboard → tempel" harus berjalan satu per satu agar isi worker lain tidak tertempel.
 */
let chain = Promise.resolve();

// Langkah yang menggantung (mis. halaman ditutup saat render gagal) tidak boleh mengunci clipboard selamanya
const LOCK_TIMEOUT_MS = 90000;

function withClipboardLock(fn) {
  const run = chain.then(() => fn());
  // Antrean tetap jalan walau langkah sebelumnya gagal atau menggantung
  chain = Promise.race([run, new Promise((r) => setTimeout(r, LOCK_TIMEOUT_MS))]).catch(() => {});
  return run;
}

module.exports = { withClipboardLock };
