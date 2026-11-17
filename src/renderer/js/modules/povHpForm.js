/**
 * Form konsep POV HP: foto HP (1–4, upload / paste), nama + spek HP, suara VO.
 * Isian TIDAK disimpan: aplikasi dibuka / dimuat ulang = form kosong (seperti konsep lain).
 */
const $ = (id) => document.getElementById(id);
const MAX_PHOTOS = 4;
let photos = [];

// Bersihkan simpanan lama dari versi sebelumnya
try { localStorage.removeItem('povHpForm'); } catch (e) {}
const load = () => ({});
const save = () => {};
const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^file:\/\/\/([A-Za-z])%3A/, 'file:///$1:');

function status(msg, isError = false) {
  const el = $('povHpStatus');
  if (el) { el.textContent = msg; el.style.color = isError ? '#f87171' : 'var(--text-muted)'; }
}

function render() {
  const list = $('povHpPhotoList');
  if (!list) return;
  list.innerHTML = photos.map((p, i) => `
    <div style="position: relative; width: 52px; height: 52px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,.15); background: #111;" title="${p.replace(/"/g, '&quot;')}">
      <img src="${fileUrl(p)}" style="width: 100%; height: 100%; object-fit: cover;">
      <button type="button" data-i="${i}" class="povhp-del" title="Hapus" style="position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; border-radius: 50%; border: none; background: rgba(0,0,0,.7); color: #f87171; font-size: 11px; line-height: 18px; cursor: pointer; padding: 0;">✕</button>
    </div>`).join('') || '<span style="font-size: 12px; color: #73726d;">Belum ada foto HP</span>';
  list.querySelectorAll('.povhp-del').forEach((b) => b.addEventListener('click', () => { photos.splice(Number(b.dataset.i), 1); save(); render(); }));
}

function addPhotos(paths) {
  const imgs = (paths || []).filter((p) => /\.(png|jpe?g|webp)$/i.test(p) && !photos.includes(p));
  if (!imgs.length) return;
  photos = photos.concat(imgs).slice(0, MAX_PHOTOS);
  if (photos.length >= MAX_PHOTOS) status(`Maksimal ${MAX_PHOTOS} foto.`);
  save(); render();
}

export function initPovHpForm() {
  if (!$('containerTikTokPovHpForm')) return;
  const st = load();
  photos = Array.isArray(st.photos) ? st.photos.filter(Boolean) : [];
  if ($('povHpSpecInput') && st.spec) $('povHpSpecInput').value = st.spec;
  if ($('povHpVoiceSelect') && st.voice) $('povHpVoiceSelect').value = st.voice;
  render();

  $('povHpUploadBtn')?.addEventListener('click', async () => {
    const files = await window.electronAPI?.selectFiles?.().catch(() => []);
    addPhotos(files || []);
  });
  $('povHpPasteBtn')?.addEventListener('click', async () => {
    const res = await window.electronAPI?.pasteImageFromClipboard?.().catch(() => null);
    if (res?.success && res.filePath) addPhotos([res.filePath]);
    else status('Clipboard kosong — salin gambar HP dulu (klik kanan → Copy Image), lalu klik Paste.', true);
  });
  $('povHpSpecInput')?.addEventListener('input', save);
  $('povHpVoiceSelect')?.addEventListener('change', save);
}

export function getPovHpState() {
  const spec = ($('povHpSpecInput')?.value || '').trim();
  const voice = $('povHpVoiceSelect')?.value || 'cowok';
  if (!photos.length) return { ready: false, reason: 'Tambahkan minimal 1 foto HP dulu (Upload / Paste).' };
  if (spec.length < 5) return { ready: false, reason: 'Isi nama HP + spek dulu.' };
  return { ready: true, photos: photos.slice(), spec, voice };
}
