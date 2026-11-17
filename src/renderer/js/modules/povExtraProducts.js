// POV Tangan: foto produk tambahan (sisi lain / detail). Foto utama tetap dari "Pilih Gambar".
// Tidak disimpan: hilang saat aplikasi ditutup.
const MAX_EXTRA = 3;
let extras = [];

const toUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').replace(/#/g, '%23');

function render() {
  const list = document.getElementById('povExtraProductList');
  const count = document.getElementById('povExtraProductCount');
  if (count) count.textContent = `${extras.length}/${MAX_EXTRA}`;
  ['povExtraProductAddBtn', 'povExtraProductPasteBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = extras.length >= MAX_EXTRA;
  });
  if (!list) return;
  list.innerHTML = '';
  extras.forEach((p, i) => {
    const item = document.createElement('div');
    item.style.cssText = 'position:relative;width:44px;height:44px;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);flex-shrink:0;background:#111;';
    item.title = p;
    const img = document.createElement('img');
    img.src = toUrl(p);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Hapus foto';
    del.style.cssText = 'position:absolute;top:0;right:0;width:16px;height:16px;padding:0;border:none;border-radius:0 0 0 4px;background:rgba(0,0,0,0.75);color:#fff;font-size:12px;line-height:16px;cursor:pointer;';
    del.addEventListener('click', () => { extras.splice(i, 1); render(); });
    item.append(img, del);
    list.appendChild(item);
  });
}

function add(paths) {
  for (const p of paths) {
    if (p && extras.length < MAX_EXTRA && !extras.includes(p)) extras.push(p);
  }
  render();
}

export function initPovExtraProducts() {
  document.getElementById('povExtraProductAddBtn')?.addEventListener('click', async () => {
    const files = await window.electronAPI?.selectFiles?.().catch(() => []);
    const list = (Array.isArray(files) ? files : (files?.filePaths || files?.paths || []))
      .map((f) => (typeof f === 'string' ? f : f?.path))
      .filter((f) => f && /\.(png|jpe?g|webp)$/i.test(f));
    add(list);
  });
  document.getElementById('povExtraProductPasteBtn')?.addEventListener('click', async () => {
    const res = await window.electronAPI?.pasteImageFromClipboard?.().catch(() => null);
    const p = typeof res === 'string' ? res : (res?.path || res?.filePath || '');
    if (p) add([p]);
    else alert(res?.error || 'Tidak ada gambar di clipboard. Salin gambar dulu (Copy Image).');
  });
  render();
}

export function getPovExtraProducts() {
  return [...extras];
}
