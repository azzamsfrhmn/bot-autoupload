/**
 * src/main/ipc/serial3dIpc.js
 * Konsep Serial Animasi Day-N (SA): karakter dari gambar upload (dianalisis Gemini), premis & naskah AI,
 * validasi naskah JSON, pratinjau frame (tanpa suara), dan tes suara Gemini.
 */
const fs = require('fs');
const path = require('path');
const { dialog, clipboard } = require('electron');
const { KARAKTER, SUARA_GEMINI } = require('../../modules/serial3d/karakter');
const { validateNaskah, CONTOH, SHOT, EKSPRESI, GESTUR, KARTU } = require('../../modules/serial3d/naskah');
const simpanan = require('../../modules/serial3d/simpanan');
const { saveKartunKeys, describeKartunKeys } = require('../../core/kartunKeys');
const { previewSerial3D, testSerialVoice, buatNaskahAI, buatPremisRencanaAI, buatKarakterDariGambar, renderPotret } = require('../../services/aiVideoSerial3D');

// JSON tempelan: buang pembungkus ``` / ```json lalu parse
function parseTempelan(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  else t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('kosong');
  return JSON.parse(t.slice(a, b + 1));
}

module.exports = function registerSerial3DIpc(ipcMain, ctx = {}) {
  function safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (e) {}
    ipcMain.handle(channel, async (...a) => { try { return await handler(...a); } catch (err) { return { success: false, error: err.message }; } });
  }

  safeHandle('serial3d-presets', async () => ({
    milik: simpanan.daftarKarakter(),
    contoh: Object.values(KARAKTER).map((k) => ({ id: k.id, nama: k.nama, deskripsi: k.deskripsi, kulit: k.kulit, rambut: k.rambut, atasan: k.atasan, bawahan: k.bawahan, aksesori: k.aksesori, suara: k.suara })),
    naskah: Object.entries(CONTOH).map(([id, n]) => ({ id, judul: `${n.seri.judul} — ${n.seri.label} ${n.seri.hari}`, kalimat: n.kalimat.length, karakter: n.seri.karakter })),
    suara: SUARA_GEMINI,
    pustaka: { shot: SHOT, ekspresi: EKSPRESI, gestur: GESTUR, kartu: KARTU }
  }));

  // Langkah 1: pilih gambar referensi karakter
  safeHandle('serial3d-pick-image', async () => {
    const res = await dialog.showOpenDialog(ctx.getMainWindow?.(), {
      title: 'Pilih gambar referensi karakter (foto, kartun, maskot, atau gambar AI)',
      properties: ['openFile'], filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (res.canceled || !res.filePaths?.[0]) return { canceled: true };
    return { success: true, path: res.filePaths[0] };
  });

  // Paste gambar dari clipboard → disimpan permanen di storage/serial3d/gambar (bisa dipakai ulang tanpa paste lagi)
  const GAMBAR_DIR = () => path.resolve(process.cwd(), 'storage/serial3d/gambar');
  safeHandle('serial3d-paste-image', async () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { success: false, error: 'Clipboard tidak berisi gambar. Salin (copy) gambarnya dulu, lalu klik Paste / tekan Ctrl+V.' };
    fs.mkdirSync(GAMBAR_DIR(), { recursive: true });
    const size = img.getSize();
    const out = path.join(GAMBAR_DIR(), `gambar_${Date.now()}.png`);
    fs.writeFileSync(out, (size.width > 1200 || size.height > 1200 ? img.resize(size.width >= size.height ? { width: 1200 } : { height: 1200 }) : img).toPNG());
    return { success: true, path: out };
  });
  safeHandle('serial3d-list-images', async () => {
    try { return { success: true, files: fs.readdirSync(GAMBAR_DIR()).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().reverse().map((f) => path.join(GAMBAR_DIR(), f)) }; }
    catch (e) { return { success: true, files: [] }; }
  });
  safeHandle('serial3d-delete-image', async (e, p) => {
    const full = path.resolve(String(p || ''));
    if (!full.startsWith(GAMBAR_DIR())) return { success: false, error: 'bukan gambar galeri' };
    fs.rmSync(full, { force: true }); return { success: true };
  });

  // Gambar → Gemini membaca ciri → karakter 3D tersimpan + potret
  safeHandle('serial3d-create-character', async (e, { imagePath, nama, id } = {}) => {
    if (!imagePath) return { success: false, error: 'Pilih gambar karakter dulu.' };
    const k = await buatKarakterDariGambar({ imagePath, nama, id });
    return { success: true, karakter: k };
  });

  // Edit kecil (nama, warna, model rambut, suara) → simpan + render ulang potret
  safeHandle('serial3d-update-character', async (e, patch = {}) => {
    const lama = simpanan.daftarKarakter().find((k) => k.id === patch.id);
    if (!lama) return { success: false, error: 'Karakter tidak ditemukan.' };
    const baru = simpanan.simpanKarakter({ ...lama, ...patch, rambut: { ...lama.rambut, ...(patch.rambut || {}) }, atasan: { ...lama.atasan, ...(patch.atasan || {}) }, bawahan: { ...lama.bawahan, ...(patch.bawahan || {}) }, suara: { ...lama.suara, ...(patch.suara || {}) } });
    const potret = await renderPotret(baru.id).catch(() => '');
    return { success: true, karakter: { ...baru, potret } };
  });

  safeHandle('serial3d-delete-character', async (e, id) => { simpanan.hapusKarakter(id); return { success: true }; });

  safeHandle('serial3d-series-info', async (e, id) => {
    const s = simpanan.bacaSeri(id);
    return { success: true, premis: s.premis || '', rencana: s.rencana || '', latar: s.latar || '', suasana: s.suasana || '', judul: s.judul || '', episodes: (s.episodes || []).map((x) => ({ hari: x.hari, judul: x.judul, janji: x.janji })), hariBerikut: simpanan.hariBerikut(id) };
  });

  safeHandle('serial3d-save-premise', async (e, { id, premis, latar, suasana, rencana } = {}) => {
    const patch = { premis: String(premis || '') };
    if (latar !== undefined) patch.latar = String(latar || ''); if (suasana !== undefined) patch.suasana = String(suasana || '');
    if (rencana !== undefined) patch.rencana = String(rencana || '');
    simpanan.simpanSeri(id, patch); return { success: true };
  });

  // Ulang serial ke DAY 1: riwayat episode dihapus, premis/rencana/latar tetap (video lama tidak dihapus)
  safeHandle('serial3d-reset-series', async (e, id) => { simpanan.simpanSeri(id, { episodes: [] }); return { success: true }; });

  // Langkah 2: premis (bila kosong) + rencana DAY 1-10 otomatis
  safeHandle('serial3d-generate-plan', async (e, { karakterId, premis, latar, suasana } = {}) => ({ success: true, ...(await buatPremisRencanaAI({ karakterId, premis, latar, suasana })) }));

  // Langkah 3: Gemini menulis naskah dari premis
  safeHandle('serial3d-generate-script', async (e, { karakterId, premis, hari, latar, suasana, rencana } = {}) => {
    const r = await buatNaskahAI({ karakterId, premis, hari, latar, suasana, rencana });
    const n = r.naskah;
    return { success: true, json: JSON.stringify(n, null, 2), judul: `${n.seri.judul} — ${n.seri.label} ${n.seri.hari}`, kalimat: n.kalimat.length, model: r.model, premis: r.premis, rencana: r.rencana };
  });

  safeHandle('serial3d-example', async (e, id) => JSON.stringify(CONTOH[id] || CONTOH.pulau_day1, null, 2));

  safeHandle('serial3d-validate', async (e, text) => {
    let raw;
    try { raw = parseTempelan(text); } catch (err) { return { success: false, errors: ['JSON tidak valid / terpotong. Periksa tanda kurung dan koma, lalu tempel ulang.'] }; }
    const v = validateNaskah(raw);
    if (!v.ok) return { success: false, errors: v.errors };
    const n = v.naskah;
    return { success: true, naskah: n, judul: `${n.seri.judul} — ${n.seri.label} ${n.seri.hari}`, kalimat: n.kalimat.length, karakter: n.seri.karakter, dunia: n.seri.dunia };
  });

  safeHandle('serial3d-preview', async (e, opts = {}) => {
    const r = await previewSerial3D({ serialScript: opts.serialScript || null, serialScriptId: opts.serialScriptId || 'pulau_day1', serialCharacter: opts.serialCharacter || 'rere', serialWorld: opts.serialWorld || '', serialTime: opts.serialTime || '' });
    return { success: true, files: r.files, gpu: r.info.gpu, duration: r.info.duration };
  });

  safeHandle('serial3d-test-voice', async (e, opts = {}) => testSerialVoice(opts));

  // Key Gemini pribadi (gratis dari AI Studio) → kuota suara milik pelanggan sendiri, tidak berebut
  safeHandle('serial3d-get-key', async () => { const d = describeKartunKeys(); return { success: true, ada: d.hasGemini, masked: d.geminiMasked }; });
  safeHandle('serial3d-save-key', async (e, key) => {
    key = String(key || '').trim();
    if (key) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }).catch(() => null);
      if (!r || !r.ok) return { success: false, error: r ? `Key ditolak Google (${r.status}). Pastikan key dari aistudio.google.com/apikey disalin lengkap.` : 'Tidak bisa menghubungi Google, cek internet.' };
    }
    const d = saveKartunKeys({ geminiKey: key });
    return { success: true, ada: d.hasGemini, masked: d.geminiMasked };
  });
};
