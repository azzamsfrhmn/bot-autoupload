/**
 * src/renderer/js/modules/autoPilotManager.js
 * Manajemen Alur Kerja 1-Klik Otomatisasi Penuh (Tab Terpisah Gambar & Video)
 */

export function initAutoPilotManager() {
  // Tombol & Kontainer Sub-Tab Switcher
  const tabAutoPilotImageMode = document.getElementById('tabAutoPilotImageMode');
  const tabAutoPilotVideoMode = document.getElementById('tabAutoPilotVideoMode');
  const containerAutoPilotImageForm = document.getElementById('containerAutoPilotImageForm');
  const containerAutoPilotVideoForm = document.getElementById('containerAutoPilotVideoForm');

  // Input Bersama
  const autoPilotTopic = document.getElementById('autoPilotTopic');

  // Input Khusus Mode Gambar
  const autoPilotRatio = document.getElementById('autoPilotRatio');
  const autoPilotImageScheduleTime = document.getElementById('autoPilotImageScheduleTime');
  const btnRunAutoPilot = document.getElementById('btnRunAutoPilot');

  // Input Khusus Mode Video
  const autoPilotVideoRatio = document.getElementById('autoPilotVideoRatio');
  const autoPilotVideoCharacter = document.getElementById('autoPilotVideoCharacter');
  const autoPilotVideoStoryboardType = document.getElementById('autoPilotVideoStoryboardType');
  const autoPilotVideoScheduleTime = document.getElementById('autoPilotVideoScheduleTime');
  const btnRunAutoPilotVideo = document.getElementById('btnRunAutoPilotVideo');

  // Progres Bar & Log Element
  const autoPilotProgressBox = document.getElementById('autoPilotProgressBox');
  const autoPilotStatusTitle = document.getElementById('autoPilotStatusTitle');
  const autoPilotPercent = document.getElementById('autoPilotPercent');
  const autoPilotProgressBar = document.getElementById('autoPilotProgressBar');
  const autoPilotLogs = document.getElementById('autoPilotLogs');
  const autoPilotAlert = document.getElementById('autoPilotAlert');

  // ========================================================
  // NAVIGASI SUB-TAB: GAMBAR FEED VS VIDEO REELS
  // ========================================================
  tabAutoPilotImageMode?.addEventListener('click', () => {
    tabAutoPilotImageMode.classList.add('active');
    tabAutoPilotVideoMode?.classList.remove('active');
    if (containerAutoPilotImageForm) containerAutoPilotImageForm.style.display = 'block';
    if (containerAutoPilotVideoForm) containerAutoPilotVideoForm.style.display = 'none';
  });

  tabAutoPilotVideoMode?.addEventListener('click', () => {
    tabAutoPilotVideoMode.classList.add('active');
    tabAutoPilotImageMode?.classList.remove('active');
    if (containerAutoPilotVideoForm) containerAutoPilotVideoForm.style.display = 'block';
    if (containerAutoPilotImageForm) containerAutoPilotImageForm.style.display = 'none';
  });

  // Waktu default 30 menit ke depan
  const setDefaultTime = (minutesAhead = 30) => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minutesAhead);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if (autoPilotImageScheduleTime) autoPilotImageScheduleTime.value = iso;
    if (autoPilotVideoScheduleTime) autoPilotVideoScheduleTime.value = iso;
  };
  setDefaultTime(30);

  // Template cepat bersama
  document.querySelectorAll('.btn-quick-topic').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (autoPilotTopic) autoPilotTopic.value = btn.getAttribute('data-topic');
    });
  });

  // Pintasan jam tayang sesuai target formulir aktif
  document.querySelectorAll('.btn-auto-time').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const targetInput = targetId ? document.getElementById(targetId) : null;
      const minutes = btn.getAttribute('data-minutes');
      const preset = btn.getAttribute('data-preset');
      const now = new Date();

      if (minutes) {
        now.setMinutes(now.getMinutes() + parseInt(minutes, 10));
      } else if (preset === 'tomorrow-morning') {
        now.setDate(now.getDate() + 1);
        now.setHours(9, 0, 0, 0);
      }
      const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      if (targetInput) targetInput.value = iso;
    });
  });

  function addLog(text) {
    if (!autoPilotLogs) return;
    const time = new Date().toLocaleTimeString('id-ID');
    const p = document.createElement('div');
    p.innerHTML = `<span style="color: #666;">[${time}]</span> ${text}`;
    autoPilotLogs.appendChild(p);
    autoPilotLogs.scrollTop = autoPilotLogs.scrollHeight;
  }

  function updateProgress(percent, title) {
    if (autoPilotProgressBar) autoPilotProgressBar.style.width = `${percent}%`;
    if (autoPilotPercent) autoPilotPercent.textContent = `${percent}%`;
    if (autoPilotStatusTitle) autoPilotStatusTitle.textContent = title;
  }

  function showAlert(msg, isError = false) {
    if (!autoPilotAlert) return;
    autoPilotAlert.style.display = 'block';
    autoPilotAlert.className = `alert-card ${isError ? 'alert-error' : 'alert-success'}`;
    autoPilotAlert.textContent = msg;
  }

  function cleanVisualPrompt(rawText) {
    if (!rawText) return '';
    return rawText
      .replace(/^["']|["']$/g, '')
      .replace(/^(Prompt|Here is the prompt|Visual description):?/i, '')
      .trim();
  }

  // ========================================================
  // PIPELINE 1: AUTO PILOT GAMBAR FEED
  // ========================================================
  btnRunAutoPilot?.addEventListener('click', async () => {
    const topic = autoPilotTopic?.value.trim();
    const ratio = autoPilotRatio?.value || '4:5';
    const scheduleTime = autoPilotImageScheduleTime?.value;

    if (!topic) {
      alert('Tuliskan atau pilih topik produk terlebih dahulu!');
      return;
    }
    if (!scheduleTime) {
      alert('Tentukan jadwal waktu publikasi!');
      return;
    }

    btnRunAutoPilot.disabled = true;
    if (btnRunAutoPilotVideo) btnRunAutoPilotVideo.disabled = true;
    autoPilotProgressBox.style.display = 'block';
    autoPilotLogs.innerHTML = '';
    if (autoPilotAlert) autoPilotAlert.style.display = 'none';

    try {
      updateProgress(15, 'Merancang Prompt Gambar (Gemini)...');
      addLog(`Menyusun konsep visual murni untuk produk "<strong>${topic}</strong>"...`);

      const visualRes = await window.electronAPI.generateCaption({
        prompt: `Buat instruksi prompt visual deskriptif berbahasa Inggris untuk DALL-E 3 membuat banner/poster Instagram produk: "${topic}".
Syarat ketat:
- HANYA deskripsi visual (objek 3D, pencahayaan, tipografi logo produk, background estetik, warna tema).
- JANGAN sertakan harga, nomor WA, kalimat promosi/copywriting, atau hashtag apa pun.
- Tulis langsung deskripsi visualnya dalam 1 paragraf ringkas tanpa tanda kutip.`,
        tone: 'formal'
      });

      let visualPrompt = cleanVisualPrompt(visualRes?.caption);
      if (!visualPrompt || visualPrompt.length < 20) {
        visualPrompt = `A sleek modern 3D promotional Instagram banner for ${topic}, glowing neon elements, premium floating icons, clean studio lighting, vibrant colors, aesthetic commercial product showcase, 8k resolution.`;
      }

      addLog(`Prompt visual siap dikirim ke ChatGPT.`);

      updateProgress(45, 'Merender & Mengunduh Gambar di ChatGPT Plus...');
      addLog('Mengirim instruksi visual murni ke ChatGPT...');

      const imgRes = await window.electronAPI.generateAiImage({
        prompt: visualPrompt,
        aspectRatio: ratio
      });

      if (!imgRes?.success || !imgRes.item?.filePath) {
        throw new Error(imgRes?.error || 'Gagal menghasilkan gambar di ChatGPT');
      }

      const generatedFilePath = imgRes.item.filePath;
      addLog(`Gambar berhasil diunduh dan disimpan.`);

      updateProgress(75, 'Menyusun Caption & Tagar Instagram (Gemini)...');
      addLog('Membuat teks caption promosi terpisah untuk postingan...');

      const captionRes = await window.electronAPI.generateCaption({
        prompt: `Buat caption promosi Instagram yang menarik dan rapi untuk produk "${topic}". Gunakan gaya bahasa santai dan persuasif, sertakan emoji yang relevan, ajakan order lewat link di bio / WhatsApp, dan akhiri dengan 10 hashtag yang relevan.`,
        tone: 'promo',
        mediaFiles: [generatedFilePath]
      });

      const finalCaption = captionRes?.caption || `Upgrade kebutuhan digitalmu sekarang dengan ${topic}! Kualitas terjamin, proses cepat, dan bergaransi resmi hanya di @etnicpremium. Order langsung via link di bio! ✨`;
      addLog('Teks caption dan hashtag berhasil dibuat.');

      updateProgress(90, 'Menyimpan Postingan ke Antrean Jadwal...');
      addLog(`Menjadwalkan publikasi otomatis pada: ${new Date(scheduleTime).toLocaleString('id-ID')}`);

      const scheduleRes = await window.electronAPI.schedulePost({
        mediaPaths: [generatedFilePath],
        caption: finalCaption,
        scheduleTime: scheduleTime
      });

      if (!scheduleRes?.success) {
        throw new Error(scheduleRes?.message || 'Gagal menyimpan ke database antrean');
      }

      updateProgress(100, 'Selesai! Berhasil Masuk Antrean');
      addLog('Semua alur selesai! Postingan gambar siap dipublikasikan sesuai waktu.');
      showAlert('Postingan gambar otomatis berhasil dibuat dan masuk antrean jadwal tayang!', false);

      window.dispatchEvent(new CustomEvent('refresh-schedules'));
    } catch (err) {
      console.error(err);
      updateProgress(0, 'Terjadi Kesalahan');
      addLog(`❌ Error: ${err.message}`);
      showAlert(`Gagal: ${err.message}`, true);
    } finally {
      btnRunAutoPilot.disabled = false;
      if (btnRunAutoPilotVideo) btnRunAutoPilotVideo.disabled = false;
    }
  });

  // ========================================================
  // PIPELINE 2: AUTO PILOT VIDEO REELS 1-KLIK LENGKAP
  // ========================================================
  btnRunAutoPilotVideo?.addEventListener('click', async () => {
    const topic = autoPilotTopic?.value.trim();
    const ratio = autoPilotVideoRatio?.value || '9:16';
    const characterKeyword = autoPilotVideoCharacter?.value.trim() || 'wanita';
    const storyboardType = autoPilotVideoStoryboardType?.value || '1';
    const scheduleTime = autoPilotVideoScheduleTime?.value;

    if (!topic) {
      alert('Tuliskan atau pilih topik produk terlebih dahulu!');
      return;
    }

    btnRunAutoPilot.disabled = true;
    btnRunAutoPilotVideo.disabled = true;
    autoPilotProgressBox.style.display = 'block';
    autoPilotLogs.innerHTML = '';
    if (autoPilotAlert) autoPilotAlert.style.display = 'none';

    updateProgress(5, 'Menyiapkan Pipeline Auto Pilot Video...');
    addLog(`Memulai alur otomatisasi Reels untuk: "<strong>${topic}</strong>"`);
    addLog(`Pengaturan Video: Rasio [${ratio}] | Karakter [${characterKeyword}] | Tipe Storyboard [#${storyboardType}]`);

    // Listener progres realtime dari backend
    if (window.electronAPI && typeof window.electronAPI.onAutoPilotVideoProgress === 'function') {
      window.electronAPI.onAutoPilotVideoProgress((data) => {
        if (data) {
          updateProgress(data.percent || 0, data.title || 'Memproses...');
          addLog(`[Tahap ${data.step || 1}] ${data.title}`);
        }
      });
    }

    try {
      const res = await window.electronAPI.runAutoPilotVideo({
        topic: topic,
        aspectRatio: ratio,
        characterKeyword: characterKeyword,
        storyboardType: storyboardType,
        scheduleTime: scheduleTime || null
      });

      if (res && res.success) {
        updateProgress(100, 'Selesai! Video Berhasil Diproses');
        addLog(`Video Reels 1080p berhasil dibuat dan tersimpan!`);
        if (res.scheduled) {
          addLog(`Video langsung didaftarkan ke antrean jadwal postingan.`);
        }
        showAlert(
          `Auto Pilot Video Berhasil! Video telah dibuat dan ${res.scheduled ? 'langsung masuk ke jadwal postingan.' : 'tersimpan di galeri video.'}`,
          false
        );

        window.dispatchEvent(new CustomEvent('refresh-schedules'));
      } else {
        throw new Error(res?.error || 'Gagal menjalankan alur Auto Pilot Video');
      }
    } catch (err) {
      console.error(err);
      updateProgress(0, 'Terjadi Kesalahan Video');
      addLog(`❌ Error: ${err.message}`);
      showAlert(`Gagal Auto Pilot Video: ${err.message}`, true);
    } finally {
      btnRunAutoPilot.disabled = false;
      btnRunAutoPilotVideo.disabled = false;
    }
  });
}