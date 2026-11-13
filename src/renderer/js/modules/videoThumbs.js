/**
 * Thumbnail video untuk grid galeri.
 * Grid TIDAK memakai <video> per kartu (Chromium membatasi jumlah pemutar → sebagian kartu
 * hitam & tak bisa diputar). Kartu memakai <img> dari <nama>_thumb.png; bila belum ada,
 * thumbnail dibuat di main process (ensure-video-thumb) lalu dipasang.
 * Selama dibuat / bila gagal, kartu menampilkan placeholder (bukan kotak hitam polos).
 */
const toUrl = (p) => {
  if (!p) return '';
  const s = String(p).trim().replace(/\\/g, '/');
  if (/^(file|https?):|^data:/i.test(s)) return s;
  return `file:///${encodeURI(s.replace(/^\/+/, '')).replace(/#/g, '%23')}`;
};

// Placeholder SVG (ikon play + teks) sebagai data URL
const placeholder = (text) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640" viewBox="0 0 360 640">
    <rect width="360" height="640" fill="#1b1f27"/>
    <circle cx="180" cy="290" r="44" fill="none" stroke="#64748b" stroke-width="4"/>
    <path d="M168 268 L200 290 L168 312 Z" fill="#64748b"/>
    <text x="180" y="380" text-anchor="middle" font-family="Segoe UI, Arial" font-size="22" fill="#94a3b8">${text}</text>
  </svg>`);
const PH_LOADING = placeholder('Memuat pratinjau…');
const PH_FAILED = placeholder('Pratinjau tidak tersedia');

// HTML <img> thumbnail. thumbPath opsional (kalau sudah ada dari get-saved-videos).
export function videoThumbHtml(videoPath, thumbPath = '', style = 'width:100%;height:100%;object-fit:cover;display:block;') {
  const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');
  const src = thumbPath ? toUrl(thumbPath) : PH_LOADING;
  return `<img class="video-thumb" data-video="${esc(videoPath)}" data-thumb="${thumbPath ? 'ready' : 'pending'}" src="${esc(src)}" alt="" loading="lazy" style="${style}background:#1b1f27;">`;
}

async function fillThumb(img) {
  img.setAttribute('data-thumb', 'loading');
  try {
    const res = await window.electronAPI?.ensureVideoThumb?.(img.getAttribute('data-video'));
    if (!img.isConnected) return;
    if (res && res.thumb) {
      img.setAttribute('data-thumb', 'ready');
      img.src = `${toUrl(res.thumb)}?t=${Date.now()}`;
      return;
    }
  } catch (e) {}
  if (img.isConnected) { img.setAttribute('data-thumb', 'failed'); img.src = PH_FAILED; }
}

// Isi thumbnail yang belum ada (berurutan, tidak membebani PC)
export async function hydrateVideoThumbs(root) {
  const scope = root || document;
  // gambar thumbnail rusak/terhapus → buat ulang sekali
  scope.querySelectorAll('img.video-thumb[data-thumb="ready"]').forEach((img) => {
    if (img._thumbErrBound) return;
    img._thumbErrBound = true;
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('loading') !== 'lazy') img.setAttribute('data-thumb', 'pending');
    img.addEventListener('error', () => {
      if (img._thumbRetried) { img.setAttribute('data-thumb', 'failed'); img.src = PH_FAILED; return; }
      img._thumbRetried = true;
      fillThumb(img);
    });
  });
  const imgs = [...scope.querySelectorAll('img.video-thumb[data-video][data-thumb="pending"]')];
  for (const img of imgs) {
    if (img.isConnected) await fillThumb(img);
  }
}
