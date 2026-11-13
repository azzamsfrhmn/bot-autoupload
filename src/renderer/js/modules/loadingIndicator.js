/**
 * src/renderer/js/modules/loadingIndicator.js
 * Memasang spinner di tengah wadah gambar selama gambar belum selesai dimuat.
 */

function trackImage(img) {
  const holder = img.parentElement;
  if (!holder || holder === document.body) return;

  // Slot kosong (src belum diisi) atau gambar disembunyikan → tidak perlu spinner
  const src = img.getAttribute('src');
  if (!src || src === '#' || img.style.display === 'none') {
    holder.classList.remove('img-loading');
    return;
  }

  if (img.dataset.loadTracked === src) return;
  img.dataset.loadTracked = src;
  if (img.complete) {
    holder.classList.remove('img-loading');
    return;
  }

  if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
  holder.classList.add('img-loading');

  const done = () => holder.classList.remove('img-loading');
  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
}

function scan(root) {
  if (root.tagName === 'IMG') trackImage(root);
  else root.querySelectorAll?.('img').forEach(trackImage);
}

export function initLoadingIndicator() {
  scan(document.body);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target.tagName === 'IMG') trackImage(m.target);
      } else {
        m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
}
