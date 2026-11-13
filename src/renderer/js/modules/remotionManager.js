/**
 * src/renderer/js/modules/remotionManager.js
 * Form konsep Remotion di halaman Video Reels:
 * mode foto (daftar foto produk) / mode video, teks dari AI (bisa diedit), lalu render di PC.
 */
import { startVideoTimer, stopVideoTimer } from '../../../core/videoGenManager.js';

const MAX_PHOTOS = 6;

export function initRemotionManager() {
  const form = document.getElementById('containerTikTokRemotionForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const slotInput = $('selectedTiktokProductPathRemotion');
  const photoList = $('remotionPhotoList');
  let mode = 'photo';
  let photos = [];

  const toFileUrl = (p) => (/^(https?:|file:|data:)/.test(p) ? p : `file:///${encodeURI(p.replace(/\\/g, '/'))}`);
  const escapeHtml = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderPhotos() {
    photoList.innerHTML = photos.map((p, i) => `
      <div style="position: relative; width: 64px; height: 64px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-subtle); background: #111;" title="${escapeHtml(p)}">
        <img src="${escapeHtml(toFileUrl(p))}" style="width: 100%; height: 100%; object-fit: cover;">
        <button type="button" data-remove="${i}" title="Hapus foto" style="position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px; line-height: 20px; padding: 0; cursor: pointer;">✕</button>
      </div>`).join('') || '<span style="font-size: 11.5px; color: var(--text-muted);">Belum ada foto. Foto yang dipilih akan tampil bergantian di video.</span>';
    photoList.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
      photos.splice(Number(btn.dataset.remove), 1);
      renderPhotos();
    }));
  }

  function addPhotos(paths) {
    for (const p of paths) {
      if (p && !photos.includes(p) && photos.length < MAX_PHOTOS) photos.push(p);
    }
    renderPhotos();
  }

  // Slot produk dipakai bersama tombol Etalase & Paste: setiap foto baru di slot ikut masuk daftar
  if (slotInput) {
    new MutationObserver(() => {
      const p = slotInput.dataset.fullPath;
      if (!p) return;
      addPhotos([p]);
      // Dari etalase, isi slot = judul produk → jadikan nama produk bila masih kosong
      const title = slotInput.value.trim();
      if (title && title !== p && !$('remotionProductName').value.trim()) $('remotionProductName').value = title;
    }).observe(slotInput, { attributes: true, attributeFilter: ['data-full-path'] });
  }

  form.querySelectorAll('.remotion-mode-btn').forEach((btn) => btn.addEventListener('click', () => {
    mode = btn.dataset.mode === 'video' ? 'video' : 'photo';
    form.querySelectorAll('.remotion-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('remotionPhotoSection').style.display = mode === 'photo' ? 'block' : 'none';
    $('remotionVideoSection').style.display = mode === 'video' ? 'block' : 'none';
    // Durasi mode video mengikuti panjang video sumber
    $('remotionDurationGroup').style.display = mode === 'photo' ? 'block' : 'none';
  }));

  $('btnRemotionAddPhotos')?.addEventListener('click', async () => {
    const files = await window.electronAPI?.remotionSelectMedia?.('photo');
    if (files?.length) addPhotos(files);
  });

  $('btnRemotionPickVideo')?.addEventListener('click', async () => {
    const files = await window.electronAPI?.remotionSelectMedia?.('video');
    if (files?.[0]) {
      $('remotionVideoPath').value = files[0];
      $('remotionVideoPath').dataset.fullPath = files[0];
    }
  });

  $('btnRemotionWriteScript')?.addEventListener('click', async () => {
    const btn = $('btnRemotionWriteScript');
    const productName = $('remotionProductName').value.trim();
    const localPhotos = photos.filter((p) => !/^https?:/.test(p));
    if (!productName && !localPhotos.length) {
      alert('Isi nama produk atau pilih foto produk dulu agar AI tahu produknya.');
      return;
    }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Menulis...';
    try {
      const res = await window.electronAPI?.remotionGenerateScript?.({
        productName,
        price: $('remotionPrice').value.trim(),
        imagePaths: mode === 'photo' ? localPhotos : []
      });
      if (res) {
        $('remotionHook').value = res.hook || '';
        (res.points || []).forEach((t, i) => { if ($(`remotionPoint${i + 1}`)) $(`remotionPoint${i + 1}`).value = t; });
        if (res.cta) $('remotionCta').value = res.cta;
        if (!res.success && res.error) alert(res.error);
      }
    } catch (err) {
      alert('Gagal menulis teks: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  $('btnRemotionRender')?.addEventListener('click', async () => {
    const btn = $('btnRemotionRender');
    const payload = {
      mode,
      imagePaths: photos,
      videoPath: $('remotionVideoPath').dataset.fullPath || '',
      hook: $('remotionHook').value.trim(),
      points: [1, 2, 3].map((i) => $(`remotionPoint${i}`).value.trim()).filter(Boolean),
      price: $('remotionPrice').value.trim(),
      cta: $('remotionCta').value.trim(),
      durationSec: Number($('remotionDuration').value) || 15
    };
    if (mode === 'photo' && !payload.imagePaths.length) return alert('Pilih minimal 1 foto produk.');
    if (mode === 'video' && !payload.videoPath) return alert('Pilih video yang akan diberi teks.');
    if (!payload.hook || !payload.points.length) return alert('Isi hook dan minimal 1 keunggulan (atau klik "Tulis dengan AI").');

    btn.disabled = true;
    btn.style.opacity = '0.6';
    const logBox = document.getElementById('videoLogs');
    if (logBox) logBox.innerHTML = '';
    startVideoTimer();
    try {
      const res = await window.electronAPI?.remotionRender?.(payload);
      stopVideoTimer(Boolean(res?.success));
      if (res?.success) alert(`Video Remotion selesai: ${res.fileName}\nBuka Galeri Video untuk melihat atau menjadwalkan posting.`);
      else if (!res?.cancelled) alert('Gagal render: ' + (res?.error || 'Terjadi kesalahan.'));
    } catch (err) {
      stopVideoTimer(false);
      alert('Gagal render: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  });

  renderPhotos();
}
