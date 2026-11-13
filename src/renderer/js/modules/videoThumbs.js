/**
 * Thumbnail video untuk grid galeri.
 * Grid TIDAK memakai <video> per kartu (Chromium membatasi jumlah pemutar → sebagian kartu
 * hitam & tak bisa diputar). Kartu memakai <img> dari <nama>_thumb.png; bila belum ada,
 * thumbnail dibuat di main process (ensure-video-thumb) lalu dipasang.
 */
const toUrl = (p) => {
  if (!p) return '';
  const s = String(p).trim().replace(/\\/g, '/');
  if (/^(file|https?):|^data:/i.test(s)) return s;
  return `file:///${encodeURI(s.replace(/^\/+/, '')).replace(/#/g, '%23')}`;
};

// HTML <img> thumbnail. thumbPath opsional (kalau sudah ada dari get-saved-videos).
export function videoThumbHtml(videoPath, thumbPath = '', style = 'width:100%;height:100%;object-fit:cover;display:block;') {
  const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');
  const src = thumbPath ? toUrl(thumbPath) : '';
  return `<img class="video-thumb" data-video="${esc(videoPath)}" ${src ? `src="${esc(src)}"` : ''} alt="" loading="lazy" style="${style}background:#111;">`;
}

// Isi thumbnail yang belum ada (berurutan, tidak membebani PC)
export async function hydrateVideoThumbs(root) {
  const imgs = [...(root || document).querySelectorAll('img.video-thumb[data-video]:not([src])')];
  for (const img of imgs) {
    if (!img.isConnected) continue;
    try {
      const res = await window.electronAPI?.ensureVideoThumb?.(img.getAttribute('data-video'));
      if (res && res.thumb && img.isConnected) img.src = `${toUrl(res.thumb)}?t=${Date.now()}`;
    } catch (e) {}
  }
}
