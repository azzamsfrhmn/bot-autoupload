let lastGeneratedFilePath = null;

export function initImageGenManager() {
  const btnRunImageGen = document.getElementById('btnRunImageGen');
  const imagePromptInput = document.getElementById('imagePromptInput');
  const imageAspectRatio = document.getElementById('imageAspectRatio');
  const imageGenAlert = document.getElementById('imageGenAlert');
  const imageResultBox = document.getElementById('imageResultBox');
  const generatedImgTag = document.getElementById('generatedImgTag');
  const btnUseInSchedule = document.getElementById('btnUseInSchedule');
  const tabSchedule = document.getElementById('tabSchedule');

  function showAlert(msg, isError = false) {
    if (!imageGenAlert) return;
    imageGenAlert.style.display = 'block';
    imageGenAlert.className = `alert-card ${isError ? 'alert-error' : 'alert-success'}`;
    imageGenAlert.textContent = msg;
  }

  btnRunImageGen?.addEventListener('click', async () => {
    const prompt = imagePromptInput.value.trim();
    const ratio = imageAspectRatio.value;

    if (!prompt) {
      alert('Tulis deskripsi gambar terlebih dahulu!');
      return;
    }

    btnRunImageGen.disabled = true;
    btnRunImageGen.textContent = 'Membuat Gambar (Proses AI 10-20 detik)...';
    if (imageResultBox) imageResultBox.style.display = 'none';
    showAlert('Sedang memproses prompt gambar Anda...', false);

    try {
      const res = await window.electronAPI.generateAiImage({ prompt, aspectRatio: ratio });

      if (res?.success) {
        lastGeneratedFilePath = res.filePath;
        if (generatedImgTag) generatedImgTag.src = res.base64;
        if (imageResultBox) imageResultBox.style.display = 'block';
        showAlert('Gambar berhasil dibuat!', false);
      } else {
        showAlert(res?.error || 'Gagal membuat gambar.', true);
      }
    } catch (err) {
      showAlert(err.message || 'Kendala teknis.', true);
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

  // Tombol pintas: langsung masukkan gambar hasil AI ke antrean jadwal postingan
  btnUseInSchedule?.addEventListener('click', () => {
    if (lastGeneratedFilePath) {
      window.dispatchEvent(new CustomEvent('insert-media-file', { detail: lastGeneratedFilePath }));
      tabSchedule?.click();
    }
  });
}