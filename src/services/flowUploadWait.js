// Tunggu gambar referensi benar-benar terunggah di kotak prompt Google Flow.
// Selesai HANYA bila indikator persen upload (.loading-percentage) sudah hilang DAN chip gambar di kotak prompt
// sudah termuat. Upload yang gagal di Flow tampil macet di 99% tanpa pesan error → setelah batas waktu
// dilempar error agar prompt TIDAK dikirim dengan gambar yang belum ada.
const { agreeFlowImageRights } = require('./flowOnboarding');

const UPLOAD_STATE_EXPR = `
  (() => {
    const loaders = Array.from(document.querySelectorAll('.loading-percentage'));
    const percent = loaders.map((el) => (el.innerText || '').trim()).filter(Boolean).pop() || '';
    const chips = Array.from(document.querySelectorAll('flow-image-ingredient-chip, flow-ingredient-chip'));
    const readyChips = chips.filter((chip) => {
      const btn = chip.querySelector('button');
      if (btn && btn.getAttribute('aria-busy') === 'true') return false;
      const img = chip.querySelector('img');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }).length;
    return { uploading: loaders.length > 0, percent, readyChips, chips: chips.length };
  })()
`;

async function waitFlowImageUpload({ cdp, expectedChips = 1, onProgress = () => {}, sleep, timeoutMs = 300000, label = 'Gambar' }) {
  const start = Date.now();
  let last = null;
  let lastPct = '';
  while (Date.now() - start < timeoutMs) {
    await agreeFlowImageRights(cdp, onProgress, sleep);
    const res = await cdp.send('Runtime.evaluate', { expression: UPLOAD_STATE_EXPR, returnByValue: true }).catch(() => null);
    const st = res?.result?.value;
    if (st) {
      last = st;
      if (!st.uploading && st.readyChips >= expectedChips) {
        onProgress(`${label} selesai diunggah 100% (terlihat di kotak prompt).`);
        return st;
      }
      if (st.uploading && st.percent && st.percent !== lastPct) {
        lastPct = st.percent;
        onProgress(`Mengunggah ${label.toLowerCase()}: ${st.percent}...`);
      }
    }
    await sleep(2000);
  }
  const where = last?.uploading ? `macet di ${last.percent || '?'}` : `gambar tidak muncul di kotak prompt (${last?.readyChips || 0}/${expectedChips})`;
  throw new Error(`Upload ${label.toLowerCase()} ke Google Flow tidak selesai dalam ${Math.round(timeoutMs / 1000)} dtk (${where}). `
    + 'Prompt TIDAK dikirim agar video tidak dibuat tanpa gambar. Cek koneksi internet lalu coba lagi.');
}

module.exports = { waitFlowImageUpload };
