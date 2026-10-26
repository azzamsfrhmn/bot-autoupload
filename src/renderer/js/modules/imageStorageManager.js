/**
 * src/renderer/js/modules/imageStorageManager.js
 * Manajemen Penampungan Berkas Gambar AI, Generator & Modal Lightbox
 */

let latestGeneratedFilePath = null;
let activeModalFilePath = null;

// Helper URL file lokal yang aman untuk tag img
function getFileUrl(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('file://')) return filePath;
  return `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

// Inisialisasi Kontrol Modal Lightbox Fullscreen
function initLightboxModal() {
  const imageModal = document.getElementById('imageModal');
  const modalFullImage = document.getElementById('modalFullImage');
  const btnCloseImageModal = document.getElementById('btnCloseImageModal');
  const btnModalUseImage = document.getElementById('btnModalUseImage');
  const modalImageInfo = document.getElementById('modalImageInfo');

  function closeModal() {
    if (imageModal) imageModal.style.display = 'none';
    activeModalFilePath = null;
  }

  // Daftarkan fungsi global agar bisa dipanggil saat thumbnail diklik
  window.openImageFullModal = (encodedPath, ratio = '') => {
    const rawPath = decodeURIComponent(encodedPath);
    activeModalFilePath = rawPath;
    if (modalFullImage) {
      modalFullImage.src = getFileUrl(rawPath);
    }
    if (modalImageInfo) {
      modalImageInfo.textContent = ratio ? `Rasio Aspek: ${ratio}` : 'Pratinjau Gambar';
    }
    if (imageModal) {
      imageModal.style.display = 'flex';
    }
  };

  btnCloseImageModal?.addEventListener('click', closeModal);

  imageModal?.addEventListener('click', (e) => {
    if (e.target === imageModal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal && imageModal.style.display !== 'none') {
      closeModal();
    }
  });

  btnModalUseImage?.addEventListener('click', () => {
    if (activeModalFilePath) {
      const target = activeModalFilePath;
      closeModal();
      window.dispatchEvent(new CustomEvent('insert-media-file', { detail: target }));
      const tabSchedule = document.getElementById('tabSchedule');
      const viewSchedule = document.getElementById('viewSchedule');
      if (typeof window.switchAppTab === 'function' && tabSchedule && viewSchedule) {
        window.switchAppTab(tabSchedule, viewSchedule);
      } else {
        tabSchedule?.click();
      }
    }
  });
}

export async function renderSavedImages() {
  const container = document.getElementById('savedImagesGrid');
  const counterBadge = document.getElementById('storageCountBadge');
  if (!container) return;

  try {
    let list = [];
    if (window.electronAPI?.getSavedAiImages) {
      list = await window.electronAPI.getSavedAiImages();
    } else if (window.electronAPI?.getGeneratedImages) {
      list = await window.electronAPI.getGeneratedImages();
    }

    if (counterBadge) counterBadge.textContent = `(${list ? list.length : 0} Berkas)`;

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 50px 0; font-size: 13px;">
          Belum ada berkas gambar yang tersimpan.
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'storage-item-card';

      const fileSrc = getFileUrl(item.filePath);
      const ratio = item.aspectRatio || '4:5';

      card.innerHTML = `
        <div class="storage-thumb-wrapper" title="Klik untuk pratinjau penuh">
          <span class="storage-ratio-tag">${ratio}</span>
          <img src="${fileSrc}" alt="AI Image" loading="lazy">
        </div>
        <div class="storage-card-actions">
          <button type="button" class="btn-storage-use" data-path="${item.filePath}">Gunakan</button>
          <button type="button" class="btn-storage-del" data-id="${item.id || ''}" data-path="${item.filePath || ''}" title="Hapus Gambar">🗑</button>
        </div>
      `;

      // Klik thumbnail membuka modal fullscreen
      card.querySelector('.storage-thumb-wrapper')?.addEventListener('click', () => {
        if (typeof window.openImageFullModal === 'function') {
          window.openImageFullModal(encodeURIComponent(item.filePath), ratio);
        }
      });

      container.appendChild(card);
    });

    // Tombol Gunakan: Oper file ke form jadwal
    container.querySelectorAll('.btn-storage-use').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = e.currentTarget.getAttribute('data-path');
        if (filePath) {
          window.dispatchEvent(new CustomEvent('insert-media-file', { detail: filePath }));
          const tabSchedule = document.getElementById('tabSchedule');
          const viewSchedule = document.getElementById('viewSchedule');
          if (typeof window.switchAppTab === 'function' && tabSchedule && viewSchedule) {
            window.switchAppTab(tabSchedule, viewSchedule);
          } else {
            tabSchedule?.click();
          }
        }
      });
    });

  } catch (err) {
    console.error('Gagal memuat galeri penampungan:', err);
  }
}

// Fungsi eksekusi hapus gambar dengan fallback multi-channel
async function executeDeleteImage(targetId, targetPath) {
  const identifier = targetId || targetPath;
  if (!identifier) return false;

  try {
    if (window.electronAPI?.deleteAiImage) {
      return await window.electronAPI.deleteAiImage(identifier, targetPath);
    }
    if (window.electronAPI?.deleteGeneratedImage) {
      return await window.electronAPI.deleteGeneratedImage(identifier, targetPath);
    }
    if (window.electronAPI?.deleteImage) {
      return await window.electronAPI.deleteImage(identifier, targetPath);
    }
    if (window.electronAPI?.invoke) {
      return await window.electronAPI.invoke('delete-generated-image', identifier, targetPath);
    }
  } catch (e) {
    console.error('Error saat memanggil bridge delete image:', e);
  }
  return false;
}

export function initImageStorageManager() {
  const btnRunImageGen = document.getElementById('btnRunImageGen');
  const imagePromptInput = document.getElementById('imagePromptInput');
  const imageAspectRatio = document.getElementById('imageAspectRatio');
  const imageGenAlert = document.getElementById('imageGenAlert');
  const imageResultBox = document.getElementById('imageResultBox');
  const generatedImgTag = document.getElementById('generatedImgTag');
  const btnQuickUseSchedule = document.getElementById('btnQuickUseSchedule');
  const btnOpenFolder = document.getElementById('btnOpenFolder');
  const container = document.getElementById('savedImagesGrid');

  function showAlert(msg, isError = false) {
    if (!imageGenAlert) return;
    imageGenAlert.style.display = 'block';
    imageGenAlert.className = `alert-card ${isError ? 'alert-error' : 'alert-success'}`;
    imageGenAlert.textContent = msg;
  }

  // Siapkan kontrol modal
  initLightboxModal();

  // Event Delegation Terpusat untuk Tombol Hapus (Anti Macet)
  if (container && !container.dataset.hasDeleteListener) {
    container.dataset.hasDeleteListener = 'true';
    container.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.btn-storage-del');
      if (!delBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const id = delBtn.getAttribute('data-id');
      const pathStr = delBtn.getAttribute('data-path');

      if (!confirm('Hapus berkas gambar ini dari galeri penyimpanan?')) {
        return;
      }

      delBtn.disabled = true;
      delBtn.textContent = '⏳';

      const res = await executeDeleteImage(id, pathStr);

      if (res && res.success === false) {
        alert('Gagal menghapus gambar: ' + (res.error || 'Terjadi kesalahan sistem'));
        delBtn.disabled = false;
        delBtn.textContent = '🗑';
      } else {
        const card = delBtn.closest('.storage-item-card');
        if (card) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.9)';
          card.style.transition = 'all 0.2s ease';
          setTimeout(() => card.remove(), 200);
        }
        await renderSavedImages();
      }
    });
  }

  // Tombol Hasilkan Gambar AI
  btnRunImageGen?.addEventListener('click', async () => {
    const prompt = imagePromptInput?.value.trim();
    const ratio = imageAspectRatio?.value || '4:5';

    if (!prompt) {
      showAlert('Tuliskan deskripsi prompt visual untuk gambar Anda terlebih dahulu!', true);
      return;
    }

    btnRunImageGen.disabled = true;
    btnRunImageGen.innerHTML = `⏳ ChatGPT Sedang Merender Gambar (DALL·E 3)...`;
    if (imageResultBox) imageResultBox.style.display = 'none';
    showAlert('Sedang memproses prompt gambar Anda...', false);

    try {
      const res = await window.electronAPI.generateAiImage({ prompt, aspectRatio: ratio });

      if (res && res.success) {
        latestGeneratedFilePath = res.item.filePath;
        if (generatedImgTag) {
          generatedImgTag.src = res.base64 || getFileUrl(latestGeneratedFilePath);
          generatedImgTag.style.cursor = 'pointer';
          generatedImgTag.onclick = () => {
            if (typeof window.openImageFullModal === 'function') {
              window.openImageFullModal(encodeURIComponent(latestGeneratedFilePath), ratio);
            }
          };
        }
        if (imageResultBox) imageResultBox.style.display = 'block';
        showAlert('Gambar berhasil dibuat dan otomatis tersimpan ke penampungan!', false);

        renderSavedImages();
      } else {
        showAlert(res?.error || 'Gagal menghasilkan gambar.', true);
      }
    } catch (err) {
      showAlert(err.message || 'Kendala koneksi AI.', true);
    } finally {
      btnRunImageGen.disabled = false;
      btnRunImageGen.innerHTML = `
        <svg style="width: 18px; height: 18px; fill: currentColor;" viewBox="0 0 24 24">
          <path d="M7.5 5.6L10 0l2.5 5.6L18 8l-5.5 2.4L10 16 7.5 10.4 2 8l5.5-2.4zm10 8.4l1.5-3.4 1.5 3.4 3.5 1.6-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.6z"/>
        </svg>
        Hasilkan Gambar AI Sekarang
      `;
    }
  });

  // Tombol masukkan langsung ke jadwal dari hasil generasi baru
  btnQuickUseSchedule?.addEventListener('click', () => {
    if (latestGeneratedFilePath) {
      window.dispatchEvent(new CustomEvent('insert-media-file', { detail: latestGeneratedFilePath }));
      const tabSchedule = document.getElementById('tabSchedule');
      const viewSchedule = document.getElementById('viewSchedule');
      if (typeof window.switchAppTab === 'function' && tabSchedule && viewSchedule) {
        window.switchAppTab(tabSchedule, viewSchedule);
      } else {
        tabSchedule?.click();
      }
    }
  });

  // Tombol Buka Folder di Komputer
  btnOpenFolder?.addEventListener('click', async () => {
    if (window.electronAPI?.openAiImagesFolder) {
      await window.electronAPI.openAiImagesFolder();
    } else if (window.electronAPI?.openImagesFolder) {
      await window.electronAPI.openImagesFolder();
    }
  });

  window.addEventListener('refresh-image-storage', renderSavedImages);

  renderSavedImages();
}