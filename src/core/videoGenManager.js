/**
 * src/core/videoGenManager.js
 * Manajemen Antarmuka AI Storyboard Builder, Google Flow Render, & Integrasi CapCut JJ / Daster
 * (Versi Utuh: Seluruh Fitur Asli + Dual Konsep Terisolasi + Ekstraksi Path Aman + Mode Pakaian Daster + Output Count + Robust Headless State Resolution)
 */

// =========================================================================
// TIMER DURASI PEMBUATAN VIDEO (menggantikan tampilan persen)
// =========================================================================
let videoTimerInterval = null;
let videoTimerStart = 0;

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Tombol Batalkan di kotak progres: tampil selama proses video berjalan (semua konsep, termasuk Remotion)
function setCancelButtonVisible(visible) {
  const btn = document.getElementById('btnCancelVideo');
  if (!btn) return;
  if (!btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      if (!confirm('Batalkan proses pembuatan video yang sedang berjalan?')) return;
      btn.disabled = true;
      btn.textContent = 'Membatalkan...';
      // Mode loop: hentikan juga putaran berikutnya (termasuk saat sedang jeda antar video)
      window.dispatchEvent(new CustomEvent('video-cancel-requested'));
      try {
        // Saat jeda loop belum ada proses di backend → "tidak ada proses" bukan kesalahan
        await window.electronAPI?.cancelAiVideo?.();
      } finally {
        btn.disabled = false;
        btn.textContent = '✕ Batalkan';
      }
    });
  }
  btn.style.display = visible ? '' : 'none';
}

export function startVideoTimer() {
  stopVideoTimer();
  setCancelButtonVisible(true);
  // Setiap proses baru mulai dengan satu log; mode multi-worker memasang panel W1/W2 sesudahnya
  window.dispatchEvent(new CustomEvent('video-workers-start', { detail: { count: 1 } }));
  videoTimerStart = Date.now();
  const render = () => {
    const el = document.getElementById('videoPercent');
    if (el) el.textContent = `⏱ ${formatElapsed(Date.now() - videoTimerStart)}`;
  };
  render();
  videoTimerInterval = setInterval(render, 1000);
}

export function stopVideoTimer(success = null) {
  setCancelButtonVisible(false);
  if (!videoTimerInterval) return null;
  clearInterval(videoTimerInterval);
  videoTimerInterval = null;
  const elapsed = formatElapsed(Date.now() - videoTimerStart);
  const el = document.getElementById('videoPercent');
  if (el) el.textContent = `${success === false ? '✗' : '✓'} ${elapsed}`;
  const logs = document.getElementById('videoLogs');
  if (logs && success !== null) {
    const item = document.createElement('div');
    item.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${success ? 'Selesai' : 'Berhenti'} · Total waktu: ${elapsed}`;
    logs.appendChild(item);
    logs.scrollTop = logs.scrollHeight;
  }
  return elapsed;
}

export function initVideoGenManager() {
  const btnRunFullReelsPipeline = document.getElementById('btnRunFullReelsPipeline');
  const btnRunStoryboardOnly = document.getElementById('btnRunStoryboardOnly');
  const btnRunFlowOnly = document.getElementById('btnRunFlowOnly');

  // Tombol Alur Cepat Storyboard -> Flow -> CapCut JJ
  const btnFlowToJJFromStoryboard = document.getElementById('btnFlowToJJFromStoryboard');
  const btnCreateJJCapcut = document.getElementById('btnCreateJJCapcut');

  // Kontainer Tampilan Konsep & Form
  const reelsConceptSelectionView = document.getElementById('reelsConceptSelectionView');
  const reelsGeneratorFormView = document.getElementById('reelsGeneratorFormView');
  const btnBackToConcepts = document.getElementById('btnBackToConcepts');
  const activeConceptIndicatorBadge = document.getElementById('activeConceptIndicatorBadge');

  // Formulir Terpisah per Platform & Konsep
  const containerInstagramVideoForm = document.getElementById('containerInstagramVideoForm');
  const containerTikTokJJForm = document.getElementById('containerTikTokJJForm');
  const containerTikTokDasterForm = document.getElementById('containerTikTokDasterForm');
  const containerTikTokSensasiForm = document.getElementById('containerTikTokSensasiForm');
  const containerTikTokPovForm = document.getElementById('containerTikTokPovForm');
  const wrapperTikTokFlowSettings = document.getElementById('wrapperTikTokFlowSettings');

  const wrapperDasterClothingMode = document.getElementById('wrapperDasterClothingMode');

  function getDasterClothingMode() {
    const selected = document.querySelector(
      'input[name="dasterClothingMode"]:checked'
    );
    return selected?.value === 'convert' ? 'convert' : 'original';
  }

  // Fungsi Pembaca Status Toggle Headless (Hybrid: DOM + IPC Config)
  async function isHeadlessEnabledAsync() {
    // 1. Coba baca dari toggle DOM jika sedang berada di layar yang sama
    const toggleEl = document.getElementById('toggleFlowHeadless');
    if (toggleEl) {
      return Boolean(toggleEl.checked);
    }

    // 2. Jika tidak ada di DOM (karena user sedang di tab Buat Video Reels), tanyakan ke backend IPC
    try {
      if (typeof window.electronAPI?.getFlowAccounts === 'function') {
        const cfg = await window.electronAPI.getFlowAccounts();
        if (cfg && typeof cfg.headless === 'boolean') {
          return cfg.headless;
        }
      }
      if (typeof window.electronAPI?.invoke === 'function') {
        const cfg = await window.electronAPI.invoke('get-flow-accounts');
        if (cfg && typeof cfg.headless === 'boolean') {
          return cfg.headless;
        }
      }
    } catch (e) {}

    return true; // Default fallback: senyap
  }

  // Badge Status Pipeline
  const flowBadgeInstagram = document.getElementById('flowBadgeInstagram');
  const flowBadgeTikTokJJ = document.getElementById('flowBadgeTikTokJJ');
  const flowBadgeTikTokDaster = document.getElementById('flowBadgeTikTokDaster');
  const flowBadgeTikTokSensasi = document.getElementById('flowBadgeTikTokSensasi');
  const flowBadgeTikTokPov = document.getElementById('flowBadgeTikTokPov');

  // Modal Frame Storyboard Baru (Untuk Flow -> JJ)
  const modalSelectStoryboardFrame = document.getElementById('modalSelectStoryboardFrame');
  const storyboardFrameGrid = document.getElementById('storyboardFrameGrid');
  const btnCloseStoryboardModal = document.getElementById('btnCloseStoryboardModal');
  const btnCancelStoryboardModal = document.getElementById('btnCancelStoryboardModal');
  const btnConfirmStoryboardToFlowJJ = document.getElementById('btnConfirmStoryboardToFlowJJ');
  const storyboardFrameHint = document.getElementById('storyboardFrameHint');

  // Modal Aset JJ Manual
  const modalSelectJJAssets = document.getElementById('modalSelectJJAssets');
  const btnCloseJJModal = document.getElementById('btnCloseJJModal');
  const btnCancelJJModal = document.getElementById('btnCancelJJModal');

  // Modal Detail Storyboard (Pratinjau & Copy Prompt)
  const storyboardDetailModal = document.getElementById('storyboardDetailModal');
  const storyboardDetailImage = document.getElementById('storyboardDetailImage');
  const storyboardDetailCaption = document.getElementById('storyboardDetailCaption');
  const storyboardDetailType = document.getElementById('storyboardDetailType');
  const btnCloseStoryboardDetail = document.getElementById('btnCloseStoryboardDetail');
  const btnOkStoryboardDetail = document.getElementById('btnOkStoryboardDetail');
  const btnCopyStoryboardModalPrompt = document.getElementById('btnCopyStoryboardModalPrompt');

  // Modal Pemilih Galeri Gambar AI (Instagram / Umum)
  const imagePickerModal = document.getElementById('imagePickerModal');
  const imagePickerGrid = document.getElementById('imagePickerGrid');
  const btnCloseImagePickerModal = document.getElementById('btnCloseImagePickerModal');
  const btnCancelImagePickerModal = document.getElementById('btnCancelImagePickerModal');

  // Input Form Instagram & Umum
  const videoPromptInput = document.getElementById('videoPromptInput');
  const videoBannerSource = document.getElementById('videoBannerSource');
  const wrapperVideoBatchCount = document.getElementById('wrapperVideoBatchCount');
  const wrapperCustomImagePicker = document.getElementById('wrapperCustomImagePicker');
  let selectedCustomImagePath = document.getElementById('selectedCustomImagePath');
  let btnBrowseCustomImage = document.getElementById('btnOpenGalleryPickerModal') ||
                             document.getElementById('btnBrowseCustomImage');
  const videoCharacterKeyword = document.getElementById('videoCharacterKeyword');
  const videoAspectRatio = document.getElementById('videoAspectRatio');
  const videoStoryboardType = document.getElementById('videoStoryboardType');

  // Input Background & Pose TikTok
  const tiktokBackgroundSelect = document.getElementById('tiktokBackgroundSelect');
  const tiktokCustomBackgroundInput = document.getElementById('tiktokCustomBackgroundInput');
  const tiktokPoseSelect = document.getElementById('tiktokPoseSelect');
  const tiktokCustomPoseInput = document.getElementById('tiktokCustomPoseInput');

  // Feedback, Progres, & Galeri Storyboard
  const videoGenAlert = document.getElementById('videoGenAlert');
  const videoProgressBox = document.getElementById('videoProgressBox');
  const videoStatusTitle = document.getElementById('videoStatusTitle');
  const videoPercent = document.getElementById('videoPercent');
  const videoProgressBar = document.getElementById('videoProgressBar');
  const videoLogs = document.getElementById('videoLogs');
  const storyboardFramesGrid = document.getElementById('storyboardFramesGrid');
  const videoStorageCountBadge = document.getElementById('videoStorageCountBadge');
  const btnOpenStoryboardFolder = document.getElementById('btnOpenStoryboardFolder');
  const btnOpenVideoFolder = document.getElementById('btnOpenVideoFolder');
  const btnOpenBahanVideoFolder = document.getElementById('btnOpenBahanVideoFolder');

  const videoResultBox = document.getElementById('videoResultBox');
  if (videoResultBox) videoResultBox.style.display = 'none';

  let currentProjectFolder = null;
  let latestStoryboardItem = null;
  let chosenBannerPath = null;
  let chosenStoryboardFrameForJJ = null;
  let currentSelectedConcept = 'jj'; // 'jj' | 'daster' | 'sensasi' | 'pov'

  // =========================================================================
  // HELPER EKSTRAKSI PATH FILE & URL AMAN (MENCEGAH [object Object])
  // =========================================================================
  function extractFilePath(rawResult) {
    if (!rawResult) return '';
    if (typeof rawResult === 'string') return rawResult.trim();
    if (typeof rawResult === 'object') {
      if (rawResult.canceled || rawResult.error) return '';
      const candidate =
        rawResult.filePath ||
        rawResult.path ||
        rawResult.savedPath ||
        rawResult.imagePath ||
        rawResult.url ||
        rawResult.data ||
        (Array.isArray(rawResult.filePaths) ? rawResult.filePaths[0] : '');
      if (typeof candidate === 'string') return candidate.trim();
    }
    return '';
  }

  function toSafeFileUrl(rawInput) {
    const filePath = extractFilePath(rawInput);
    if (!filePath) return '';
    let clean = filePath.replace(/\\/g, '/');
    if (
      clean.startsWith('http://') ||
      clean.startsWith('https://') ||
      clean.startsWith('file://') ||
      clean.startsWith('data:image')
    ) {
      return clean;
    }
    clean = clean.replace(/^\/+/, '');
    return `file:///${clean}`;
  }

  function getFileNameOnly(rawInput) {
    const filePath = extractFilePath(rawInput);
    if (!filePath) return '';
    return filePath.split(/[/\\]/).pop() || filePath;
  }

  function showAlert(message, type = 'error') {
    if (!videoGenAlert) return;
    videoGenAlert.className = `alert-card ${type === 'error' ? 'alert-error' : 'alert-success'}`;
    videoGenAlert.textContent = message;
    videoGenAlert.style.display = 'block';
  }

  function hideAlert() {
    if (videoGenAlert) videoGenAlert.style.display = 'none';
  }

  function addLog(text) {
    if (!videoLogs) return;
    const time = new Date().toLocaleTimeString('id-ID');
    const logItem = document.createElement('div');
    logItem.textContent = `[${time}] ${text}`;
    videoLogs.appendChild(logItem);
    videoLogs.scrollTop = videoLogs.scrollHeight;
  }

  function updateProgress(title, percent) {
    if (videoProgressBox) videoProgressBox.style.display = 'block';
    if (videoStatusTitle) videoStatusTitle.textContent = title;
    // Teks videoPercent kini diisi timer durasi (lihat startVideoTimer)
    if (videoProgressBar) videoProgressBar.style.width = `${percent}%`;
    addLog(title);
  }

  function isPlatformTikTok() {
    if (window._currentPlatform === 'tiktok' || window.currentPlatform === 'tiktok') {
      return true;
    }
    const profileUser = document.getElementById('displayUsername')?.textContent || '';
    if (profileUser.includes('@') || profileUser.includes('tiktok') || profileUser.includes('sherlylovyou')) {
      return true;
    }
    const sidebarText = document.querySelector('.sidebar')?.innerText || '';
    if (sidebarText.includes('Showcase Produk') || sidebarText.includes('TikTok')) {
      return true;
    }
    return true;
  }

  tiktokBackgroundSelect?.addEventListener('change', () => {
    if (tiktokCustomBackgroundInput) {
      tiktokCustomBackgroundInput.style.display = tiktokBackgroundSelect.value === 'custom' ? 'block' : 'none';
      if (tiktokBackgroundSelect.value === 'custom') tiktokCustomBackgroundInput.focus();
    }
  });

  tiktokPoseSelect?.addEventListener('change', () => {
    if (tiktokCustomPoseInput) {
      tiktokCustomPoseInput.style.display = tiktokPoseSelect.value === 'custom' ? 'block' : 'none';
      if (tiktokPoseSelect.value === 'custom') tiktokCustomPoseInput.focus();
    }
  });

  // =========================================================================
  // LOGIKA SWITCHING KONSEP
  // =========================================================================
  const CONCEPT_BADGES = {
    jj: { text: 'Konsep: TikTok Affiliate JJ (Jedag-Jedug)', color: '#f0bb85', rgb: '232, 162, 92' },
    daster: { text: 'Konsep: Daster & Homewear Try-On', color: '#34d399', rgb: '16, 185, 129' },
    sensasi: { text: 'Konsep: Sensasi', color: '#f0bb85', rgb: '232, 162, 92' },
    pov: { text: 'Konsep: POV Tangan', color: '#6fcdbd', rgb: '53, 178, 159' },
    pov2: { text: 'Konsep: POV Tangan V2', color: '#6fcdbd', rgb: '53, 178, 159' },
    povhp: { text: 'Konsep: POV HP', color: '#6fcdbd', rgb: '53, 178, 159' },
    remotion: { text: 'Konsep: Remotion', color: '#f0bb85', rgb: '232, 162, 92' },
    edu3d: { text: 'Konsep: 3D Edukasi', color: '#6fcdbd', rgb: '53, 178, 159' },
    kartun3d: { text: 'Konsep: 3D Kartun', color: '#f0bb85', rgb: '232, 162, 92' },
    carakerja3d: { text: 'Konsep: 3D Cara Kerja', color: '#6fcdbd', rgb: '53, 178, 159' },
    serial3d: { text: 'Konsep: Serial Animasi Day-N', color: '#6fcdbd', rgb: '53, 178, 159' }
  };

  function applyActiveConcept(conceptKey) {
    currentSelectedConcept = CONCEPT_BADGES[conceptKey] ? conceptKey : 'jj';
    conceptKey = currentSelectedConcept;
    const isTikTok = isPlatformTikTok();
    const show = (el, on, mode = 'block') => { if (el) el.style.display = on ? mode : 'none'; };

    show(wrapperDasterClothingMode, isTikTok && conceptKey === 'daster');

    if (activeConceptIndicatorBadge) {
      const badge = CONCEPT_BADGES[conceptKey];
      activeConceptIndicatorBadge.textContent = badge.text;
      activeConceptIndicatorBadge.style.color = badge.color;
      activeConceptIndicatorBadge.style.borderColor = `rgba(${badge.rgb}, 0.35)`;
      activeConceptIndicatorBadge.style.background = `rgba(${badge.rgb}, 0.15)`;
    }

    show(containerInstagramVideoForm, !isTikTok);
    show(flowBadgeInstagram, !isTikTok, 'flex');
    // Remotion dirender di PC (tanpa Google Flow) dan punya tombol render sendiri
    const isRemotion = isTikTok && conceptKey === 'remotion';
    show(wrapperTikTokFlowSettings, isTikTok && !isRemotion);
    show(document.getElementById('btnRunFullReelsPipeline'), !isRemotion, 'block');
    show(document.getElementById('containerTikTokRemotionForm'), isRemotion);
    show(document.getElementById('flowBadgeTikTokRemotion'), isRemotion, 'flex');
    // Judul form: Remotion tidak memakai Custom GPT / Google Flow
    const titleEl = document.getElementById('reelsFormTitle');
    const subtitleEl = document.getElementById('reelsFormSubtitle');
    const engineTag = titleEl?.closest('.card-header-row')?.querySelector('.model-tag');
    [titleEl, subtitleEl, engineTag].forEach((el) => { if (el && el.dataset.defaultText === undefined) el.dataset.defaultText = el.textContent; });
    // 3D Edukasi: tanpa ChatGPT & tanpa foto (naskah Gemini + 3 klip Flow + narasi TTS)
    const isEdu3D = isTikTok && conceptKey === 'edu3d';
    show(document.getElementById('containerTikTokEdu3DForm'), isEdu3D);
    show(document.getElementById('flowBadgeTikTokEdu3D'), isEdu3D, 'flex');
    // 3D Kartun: naskah AI + suara ElevenLabs + render di PC → setelan Flow & worker disembunyikan (loop tetap ada)
    // 3D Cara Kerja memakai mesin yang sama (narator, tanpa karakter)
    const isCaraKerja = isTikTok && conceptKey === 'carakerja3d';
    const isKartun = isTikTok && (conceptKey === 'kartun3d' || isCaraKerja);
    show(document.getElementById('containerTikTokKartun3DForm'), isKartun && !isCaraKerja);
    show(document.getElementById('flowBadgeTikTokKartun3D'), isKartun && !isCaraKerja, 'flex');
    show(document.getElementById('containerTikTokCaraKerja3DForm'), isCaraKerja);
    show(document.getElementById('flowBadgeTikTokCaraKerja3D'), isCaraKerja, 'flex');
    // Serial Animasi Day-N: karakter parametrik + naskah JSON + suara Gemini + render three.js di GPU (tanpa Flow)
    const isSerial = isTikTok && conceptKey === 'serial3d';
    show(document.getElementById('containerTikTokSerial3DForm'), isSerial);
    show(document.getElementById('flowBadgeTikTokSerial3D'), isSerial, 'flex');
    show(document.getElementById('tiktokFlowSettingsGrid'), !isKartun && !isSerial, 'grid');
    show(document.getElementById('tiktokWorkerCountBlock'), !isKartun && !isSerial && conceptKey !== 'povhp');
    const flowHeading = document.getElementById('tiktokFlowSettingsHeading');
    if (flowHeading) flowHeading.textContent = isKartun || isSerial ? 'Setelan Pembuatan Video' : 'Setelan Mesin Render Google Flow';
    if (titleEl) titleEl.textContent = isSerial ? 'Video Serial Animasi Day-N' : isRemotion ? 'Video Promosi Remotion' : isEdu3D ? 'Video 3D Edukasi' : isCaraKerja ? 'Video 3D Cara Kerja' : isKartun ? 'Video 3D Kartun Dodo & Bongo' : titleEl.dataset.defaultText;
    if (subtitleEl) {
      subtitleEl.textContent = isSerial ? 'Serial 3D low-poly "day N ... dari nol": 1 karakter bernarasi, caption kata-per-kata, kartu pop-up, badge DAY N, penutup BESOK DAY N+1. Dirender di GPU PC, gratis.'
        : isRemotion ? 'Template teks + foto/video dirender 1080p langsung di PC, tanpa kredit Google Flow.'
        : isEdu3D ? 'Video "tahu gak sih" 3–6 adegan: animasi 3D Google Flow + narasi Veo + teks per kata.'
          : isCaraKerja ? 'Video "cara kerja" 60–75 detik tanpa karakter: animasi 3D jalan & infrastruktur, 1 suara narator, callout & lencana.'
          : isKartun ? 'Dodo & Bongo "bikin X dari nol": animasi 3D low-poly dirender di PC, dialog 2 suara ElevenLabs, caption per kata.'
            : subtitleEl.dataset.defaultText;
    }
    if (engineTag) engineTag.textContent = isSerial ? 'JSON + Gemini TTS + three.js GPU' : isRemotion ? 'Gemini + Remotion' : isEdu3D ? 'Gemini + Flow + Remotion' : isCaraKerja ? 'JSON + Gemini TTS + Remotion' : isKartun ? 'Claude/Gemini + ElevenLabs + Remotion' : engineTag.dataset.defaultText;

    show(containerTikTokJJForm, isTikTok && conceptKey === 'jj');
    show(containerTikTokDasterForm, isTikTok && conceptKey === 'daster');
    show(containerTikTokSensasiForm, isTikTok && conceptKey === 'sensasi');
    // POV Tangan V2 memakai form POV Tangan (foto produk + background), tanpa pilihan suara VO
    show(containerTikTokPovForm, isTikTok && (conceptKey === 'pov' || conceptKey === 'pov2'));
    show(document.getElementById('povVoiceGroup'), conceptKey !== 'pov2');
    show(document.getElementById('flowBadgeTikTokPov2'), isTikTok && conceptKey === 'pov2', 'flex');
    show(flowBadgeTikTokJJ, isTikTok && conceptKey === 'jj', 'flex');
    show(flowBadgeTikTokDaster, isTikTok && conceptKey === 'daster', 'flex');
    show(flowBadgeTikTokSensasi, isTikTok && conceptKey === 'sensasi', 'flex');
    show(flowBadgeTikTokPov, isTikTok && conceptKey === 'pov', 'flex');
    show(document.getElementById('containerTikTokPovHpForm'), isTikTok && conceptKey === 'povhp');
    show(document.getElementById('flowBadgeTikTokPovHp'), isTikTok && conceptKey === 'povhp', 'flex');

    // Tombol khusus JJ (Flow dari frame storyboard & CapCut)
    if (isTikTok) {
      show(btnFlowToJJFromStoryboard, conceptKey === 'jj', 'flex');
      show(btnCreateJJCapcut, conceptKey === 'jj', 'flex');
    }
  }

  // Sufiks id elemen form sesuai konsep aktif: JJ / Daster / Sensasi
  function conceptSuffix() {
    return { daster: 'Daster', sensasi: 'Sensasi', pov: 'Pov', pov2: 'Pov', povhp: 'PovHp', remotion: 'Remotion', edu3d: 'Edu3D', kartun3d: 'Kartun3D', carakerja3d: 'CaraKerja3D', serial3d: 'Serial3D' }[currentSelectedConcept] || 'JJ';
  }

  // 3D Edukasi: kolom topik diisi ide "Tahu gak sih ...?" dari AI (otomatis saat kosong, atau lewat tombol Topik AI)
  const edu3dTopicInput = document.getElementById('edu3dTopicInput');
  const btnEdu3DSuggestTopic = document.getElementById('btnEdu3DSuggestTopic');
  let edu3dTopicLoading = false;
  async function fillEdu3DTopic() {
    if (!edu3dTopicInput || edu3dTopicLoading || !window.electronAPI?.suggestEdu3DTopic) return;
    edu3dTopicLoading = true;
    const oriText = btnEdu3DSuggestTopic?.textContent;
    if (btnEdu3DSuggestTopic) { btnEdu3DSuggestTopic.disabled = true; btnEdu3DSuggestTopic.textContent = 'Mencari ide...'; }
    edu3dTopicInput.placeholder = 'AI sedang mencari ide topik...';
    try {
      const res = await window.electronAPI.suggestEdu3DTopic();
      if (res?.success && res.topic) edu3dTopicInput.value = res.topic;
      else edu3dTopicInput.placeholder = res?.error || 'Gagal mengambil ide topik, ketik manual atau coba lagi.';
    } finally {
      edu3dTopicLoading = false;
      if (btnEdu3DSuggestTopic) { btnEdu3DSuggestTopic.disabled = false; btnEdu3DSuggestTopic.textContent = oriText; }
    }
  }
  btnEdu3DSuggestTopic?.addEventListener('click', fillEdu3DTopic);

  // 3D Edukasi: keterangan kredit & durasi mengikuti jumlah adegan × durasi klip Flow
  const edu3dSceneCount = document.getElementById('edu3dSceneCount');
  const edu3dCostInfo = document.getElementById('edu3dCostInfo');
  function updateEdu3DCostInfo() {
    if (!edu3dCostInfo) return;
    const n = Number(edu3dSceneCount?.value) || 3;
    const durText = document.getElementById('tiktokFlowDurationSelect')?.value || '8 Detik';
    const clipSec = parseInt(durText, 10) || 8;
    edu3dCostInfo.textContent = `1 video = ${n} klip Google Flow (±${n}x kredit 1 video biasa) · durasi ±${n * clipSec} detik · selalu 1 worker.`;
  }
  edu3dSceneCount?.addEventListener('change', updateEdu3DCostInfo);
  document.getElementById('tiktokFlowDurationSelect')?.addEventListener('change', updateEdu3DCostInfo);
  document.getElementById('tiktokFlowModelSelect')?.addEventListener('change', () => setTimeout(updateEdu3DCostInfo, 0));

  // 3D Edukasi: karakter ciri khas (gambar disimpan di storage/edu3d, dipakai di semua video)
  const edu3dCharPreview = document.getElementById('edu3dCharacterPreview');
  const edu3dCharStatus = document.getElementById('edu3dCharacterStatus');
  const btnEdu3DSelectCharacter = document.getElementById('btnEdu3DSelectCharacter');
  const btnEdu3DClearCharacter = document.getElementById('btnEdu3DClearCharacter');
  function renderEdu3DCharacter(filePath) {
    if (!edu3dCharPreview) return;
    const url = filePath ? `file:///${encodeURI(filePath.replace(/\\/g, '/'))}?t=${Date.now()}` : '';
    edu3dCharPreview.style.backgroundImage = url ? `url("${url}")` : 'none';
    if (edu3dCharStatus) edu3dCharStatus.textContent = filePath ? 'Karakter tersimpan ✓ · tampil di setiap adegan' : 'Belum ada karakter · video dibuat tanpa tokoh tetap';
    if (btnEdu3DSelectCharacter) btnEdu3DSelectCharacter.textContent = filePath ? 'Ganti Karakter' : 'Upload Karakter';
    if (btnEdu3DClearCharacter) btnEdu3DClearCharacter.style.display = filePath ? '' : 'none';
  }
  async function loadEdu3DCharacter() {
    const res = await window.electronAPI?.getEdu3DCharacter?.().catch(() => null);
    renderEdu3DCharacter(res?.path || '');
  }
  btnEdu3DSelectCharacter?.addEventListener('click', async () => {
    const res = await window.electronAPI?.selectEdu3DCharacter?.();
    if (res?.success) renderEdu3DCharacter(res.path);
    else if (res?.error) alert(`Gagal menyimpan karakter: ${res.error}`);
  });
  btnEdu3DClearCharacter?.addEventListener('click', async () => {
    if (!confirm('Hapus karakter ciri khas? Video berikutnya dibuat tanpa tokoh tetap.')) return;
    await window.electronAPI?.clearEdu3DCharacter?.();
    renderEdu3DCharacter('');
  });

  document.querySelectorAll('.reels-concept-card').forEach((card) => {
    card.addEventListener('click', () => {
      const concept = card.getAttribute('data-concept') || 'jj';
      if (reelsConceptSelectionView) reelsConceptSelectionView.style.display = 'none';
      if (reelsGeneratorFormView) reelsGeneratorFormView.style.display = 'block';
      applyActiveConcept(concept);
      if (concept === 'edu3d') {
        loadEdu3DCharacter();
        updateEdu3DCostInfo();
        if (edu3dTopicInput && !edu3dTopicInput.value.trim()) fillEdu3DTopic();
      }
    });
  });

  btnBackToConcepts?.addEventListener('click', () => {
    if (reelsGeneratorFormView) reelsGeneratorFormView.style.display = 'none';
    if (reelsConceptSelectionView) reelsConceptSelectionView.style.display = 'block';
  });

  // =========================================================================
  // PARAMETER MESIN RENDER GOOGLE FLOW
  // =========================================================================
  function getSelectedFlowParams() {
    const allSelects = Array.from(document.querySelectorAll('select'));

    let rawDurText = '';
    const durSelectEl =
      document.getElementById('tiktokFlowDurationSelect') ||
      document.getElementById('flowDurationSelect') ||
      document.querySelector('select[id*="duration" i]');

    if (durSelectEl) {
      rawDurText = durSelectEl.options?.[durSelectEl.selectedIndex]?.text || durSelectEl.value || '';
    } else {
      const matchedDurSelect = allSelects.find((sel) =>
        Array.from(sel.options || []).some((o) => /detik|dtk|\d\s*s/i.test(o.text || o.value))
      );
      if (matchedDurSelect) {
        rawDurText = matchedDurSelect.options?.[matchedDurSelect.selectedIndex]?.text || matchedDurSelect.value || '';
      }
    }

    const durMatch = String(rawDurText).match(/\d+/);
    const parsedDur = durMatch ? `${durMatch[0]} Detik` : '8 Detik';

    const findSelectValue = (idCandidates, optionPattern, defaultVal) => {
      for (const id of idCandidates) {
        const el = document.getElementById(id);
        if (el) {
          const selectedText = el.options?.[el.selectedIndex]?.text || '';
          return `${el.value || ''} ${selectedText}`.trim();
        }
      }
      const matchedSelect = allSelects.find((sel) => {
        const allOptionsText = Array.from(sel.options || []).map((o) => `${o.value} ${o.text}`).join(' ');
        return optionPattern.test(allOptionsText);
      });
      if (matchedSelect) {
        const selOpt = matchedSelect.options?.[matchedSelect.selectedIndex];
        return selOpt ? `${selOpt.value} ${selOpt.text}`.trim() : matchedSelect.value;
      }
      return defaultVal;
    };

    const rawRatio = findSelectValue(['tiktokVideoAspectRatio', 'videoAspectRatio'], /9:16|16:9|4:5/i, '9:16');
    const rawModel = findSelectValue(['tiktokFlowModelSelect', 'flowModelSelect'], /Omni|Veo/i, 'Veo 3.1 - Lite');
    const rawRes = findSelectValue(['tiktokFlowResolutionSelect', 'flowResolutionSelect'], /360p|720p|1080p/i, '720p');

    const rawOutput = findSelectValue(['tiktokFlowOutputCountSelect'], /1\s*video|x1|x2|x3|x4/i, '1');
    const outputMatch = String(rawOutput).match(/\d+/);
    const parsedOutputCount = outputMatch ? outputMatch[0] : '1';

    let parsedModel = 'Veo 3.1 - Lite';
    // Fast / Quality / Omni 1.1 dihentikan Google (5 Des 2026) → Veo 3.1 - Lite / Omni 1.2 Flash
    if (/omni/i.test(rawModel)) parsedModel = 'Omni 1.2 Flash';

    const parsedRes = rawRes.includes('360') ? '360p' : rawRes.includes('1080') ? '1080p' : '720p';
    const parsedRatio = rawRatio.includes('16:9') ? '16:9' : rawRatio.includes('4:5') ? '4:5' : '9:16';

    return {
      flowRatio: parsedRatio,
      flowVideoType: 'Bahan',
      flowModel: parsedModel,
      flowResolution: parsedRes,
      flowDuration: parsedDur,
      flowOutputCount: parsedOutputCount
    };
  }

  // =========================================================================
  // PENANGANAN INPUT ASET PADA FORM AKTIF
  // =========================================================================
  function getActiveFormAssetPayload() {
    const suffix = conceptSuffix();
    const prodInput =
      document.getElementById(`selectedTiktokProductPath${suffix}`) || document.getElementById('selectedTiktokProductPath');
    const charInput =
      document.getElementById(`selectedCharacterImagePath${suffix}`) || document.getElementById('selectedCharacterImagePath');
    const refInput =
      document.getElementById('selectedReferenceImagePathJJ') || document.getElementById('selectedReferenceImagePath');

    const rawProd = prodInput?.dataset?.fullPath || prodInput?.value?.trim() || '';
    const rawChar = charInput?.dataset?.fullPath || charInput?.value?.trim() || '';
    const rawRef = refInput?.dataset?.fullPath || refInput?.value?.trim() || '';

    return {
      productPath: rawProd !== '[object Object]' ? rawProd : '',
      characterPath: rawChar !== '[object Object]' ? rawChar : '',
      // Foto referensi Pinterest hanya dipakai konsep JJ
      referencePath: suffix !== 'JJ' ? null : (rawRef !== '[object Object]' ? rawRef : '')
    };
  }

  function applyImageToField({ inputEl, thumbEl, emptyEl, rawPath, displayTitle }) {
    const cleanPath = extractFilePath(rawPath);
    if (!cleanPath) return false;

    const labelText = displayTitle || getFileNameOnly(cleanPath) || cleanPath;

    if (inputEl) {
      inputEl.value = labelText;
      inputEl.title = cleanPath;
      inputEl.dataset.fullPath = cleanPath;
    }
    if (thumbEl) {
      thumbEl.src = toSafeFileUrl(cleanPath);
      thumbEl.style.display = 'block';
    }
    if (emptyEl) {
      emptyEl.style.display = 'none';
    }
    return true;
  }

  window.handleShowcaseProductSelected = function (imagePath, title = '', customThumb = null, closeModal = true) {
    const cleanUrl = extractFilePath(imagePath);
    if (!cleanUrl) return;

    const suffix = conceptSuffix();

    const targetInput =
      document.getElementById(`selectedTiktokProductPath${suffix}`) || document.getElementById('selectedTiktokProductPath');

    const targetThumb =
      document.getElementById(`showcaseSelectedThumb${suffix}`) || document.getElementById('showcaseSelectedThumb');

    const targetEmpty =
      document.getElementById(`showcaseSelectedEmpty${suffix}`) || document.getElementById('showcaseSelectedEmpty');

    if (targetInput) {
      targetInput.value = title || cleanUrl;
      targetInput.title = cleanUrl;
      targetInput.dataset.fullPath = cleanUrl;
    }
    if (targetThumb) {
      targetThumb.src = toSafeFileUrl(customThumb || cleanUrl);
      targetThumb.style.display = 'block';
    }
    if (targetEmpty) {
      targetEmpty.style.display = 'none';
    }

    if (closeModal) {
      const modal =
        document.getElementById('showcasePickerModal') ||
        document.getElementById('modalShowcasePicker') ||
        document.querySelector('[id*="showcasePicker" i][id*="modal" i]');
      if (modal) modal.style.display = 'none';
      showAlert(`Foto produk terpilih (${suffix}):${title || getFileNameOnly(cleanUrl)}`, 'success');
    }
  };

  async function pickLocalImageViaDialog() {
    if (window.electronAPI) {
      const dialogMethods = [
        'selectLocalImageFile',
        'selectImageFile',
        'openFileDialog',
        'selectFile',
        'browseImageFile',
        'pickImageFile',
        'chooseImageFile'
      ];
      for (const method of dialogMethods) {
        if (typeof window.electronAPI[method] === 'function') {
          try {
            const res = await window.electronAPI[method]();
            const extracted = extractFilePath(res);
            if (extracted) return extracted;
          } catch (e) {}
        }
      }
    }

    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp,image/jpg';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.onchange = (e) => {
        const file = e.target.files?.[0];
        document.body.removeChild(fileInput);
        if (!file) return resolve('');
        return resolve(file.path || URL.createObjectURL(file));
      };

      fileInput.oncancel = () => {
        document.body.removeChild(fileInput);
        resolve('');
      };

      fileInput.click();
    });
  }

  async function pasteImageViaClipboard() {
    if (window.electronAPI) {
      const clipMethods = [
        'pasteImageFromClipboard',
        'saveClipboardImage',
        'getClipboardImage',
        'readClipboardImage'
      ];
      for (const method of clipMethods) {
        if (typeof window.electronAPI[method] === 'function') {
          try {
            const res = await window.electronAPI[method]();
            const extracted = extractFilePath(res);
            if (extracted) return extracted;
          } catch (e) {}
        }
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            return await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result || '');
              reader.onerror = () => resolve('');
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch (e) {}
    }
    return '';
  }

  function normalizeShowcasePhotos(product) {
    const result = [];
    const seen = new Set();

    function collect(value, depth = 0) {
      if (!value || depth > 5) return;

      if (Array.isArray(value)) {
        value.forEach((item) => collect(item, depth + 1));
        return;
      }

      if (typeof value === 'string') {
        const url = value.trim();
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
          if (!seen.has(url)) {
            seen.add(url);
            result.push(url);
          }
          return;
        }

        if (url.startsWith('[') || url.startsWith('{')) {
          try {
            collect(JSON.parse(url), depth + 1);
          } catch (e) {}
        }
        return;
      }

      if (typeof value === 'object') {
        [
          'url',
          'src',
          'uri',
          'imageUrl',
          'image_url',
          'image',
          'originUrl',
          'origin_url',
          'originalUrl',
          'original_url',
          'displayUrl',
          'cover',
          'images',
          'productImages',
          'gallery',
          'imageList',
          'image_list',
          'urls'
        ].forEach((key) => {
          if (value[key] !== undefined) {
            collect(value[key], depth + 1);
          }
        });
      }
    }

    // Sampul produk dulu (foto utama), baru galeri foto lainnya
    [
      product.coverUrl,
      product.product_img,
      product.cover,
      product.imageUrl,
      product.image,
      product.images,
      product.productImages,
      product.gallery,
      product.imageList,
      product.image_list,
      product.imageUrls
    ].forEach((item) => collect(item));

    return result;
  }

  async function getCompleteProductPhotos(product) {
    const photos = normalizeShowcasePhotos(product);
    const pid = String(product.pid || product.productId || product.product_id || product.id || '').trim();
    if (!pid || typeof window.electronAPI?.getTikTokProductImages !== 'function') return photos;

    try {
      const res = await window.electronAPI.getTikTokProductImages(pid);
      const images = Array.isArray(res) ? res :
        (Array.isArray(res?.images) ? res.images :
        (Array.isArray(res?.data?.images) ? res.data.images : []));

      if (res?.success === false) return photos;
      return [...new Set([...photos, ...normalizeShowcasePhotos({ images })])];
    } catch (error) {
      console.warn('[AI VIDEO] Gagal mengambil galeri produk:', error);
      return photos;
    }
  }

  async function fetchFullShowcaseProductsData() {
    let rawList = [];

    // Utama: etalase akun TikTok yang aktif (cache sinkron Showcase; belum ada → disinkronkan otomatis)
    if (typeof window.electronAPI?.getTiktokShowcaseProducts === 'function') {
      try {
        const res = await window.electronAPI.getTiktokShowcaseProducts(false);
        if (Array.isArray(res?.data) && res.data.length > 0) rawList = res.data;
      } catch (e) {}
    }

    // Cadangan: daftar produk lain (mis. Kalodata) bila etalase akun masih kosong
    if (rawList.length === 0 && window.electronAPI) {
      const candidateMethods = [
        'getShowcaseProducts',
        'getShowcaseItems',
        'loadShowcaseProducts',
        'getSavedShowcaseProducts',
        'getTikTokShowcase',
        'getKalodataProducts'
      ];
      for (const fnName of candidateMethods) {
        if (typeof window.electronAPI[fnName] === 'function') {
          try {
            const res = await window.electronAPI[fnName]();
            const arr = Array.isArray(res) ? res : (res?.products || res?.items || res?.data || []);
            if (Array.isArray(arr) && arr.length > 0) {
              rawList = arr;
              break;
            }
          } catch (e) {}
        }
      }
    }

    if (rawList.length === 0) {
      const globalCandidates = [
        window._showcaseProductsCache,
        window.showcaseProducts,
        window.cachedShowcaseProducts,
        window.kalodataProducts
      ];
      for (const cand of globalCandidates) {
        if (Array.isArray(cand) && cand.length > 0) {
          rawList = cand;
          break;
        }
      }
    }

    if (rawList.length === 0) {
      const showcaseContainer = document.getElementById('viewShowcase') || document.body;
      const removeBtns = Array.from(showcaseContainer.querySelectorAll('button')).filter((b) =>
        (b.innerText || b.textContent || '').includes('Remove dari Etalase')
      );

      if (removeBtns.length > 0) {
        rawList = removeBtns
          .map((rBtn, idx) => {
            let card = rBtn.parentElement;
            while (card && card !== showcaseContainer) {
              if (card.querySelector('img') && (card.innerText || '').includes('PID:')) break;
              card = card.parentElement;
            }
            const targetCard = card || rBtn.closest('div');
            const allTexts = targetCard ? Array.from(targetCard.querySelectorAll('h3, h4, div, span, p')) : [];

            let title = '';
            let pid = '';
            for (const el of allTexts) {
              const t = (el.innerText || el.textContent || '').trim();
              if (t.includes('PID:')) {
                pid = t.replace('PID:', '').trim();
              } else if (
                !title &&
                t.length > 10 &&
                !t.includes('Harga:') &&
                !t.includes('Komisi') &&
                !t.includes('Remove') &&
                !t.includes('Stok:')
              ) {
                title = t;
              }
            }

            let parsedImages = [];
            if (targetCard) {
              const allImgEls = Array.from(targetCard.querySelectorAll('img'));
              parsedImages = allImgEls
                .map((im) => im.getAttribute('src') || im.src || im.dataset?.src)
                .filter((u) => u && typeof u === 'string' && u.startsWith('http') && !u.includes('avatar'));
            }

            if (targetCard && targetCard.dataset) {
              for (const key of Object.keys(targetCard.dataset)) {
                const val = targetCard.dataset[key];
                if (val && (val.startsWith('[') || val.startsWith('{') || val.includes('http'))) {
                  try {
                    const parsed = JSON.parse(val);
                    if (Array.isArray(parsed)) parsedImages = [...parsedImages, ...parsed];
                    else if (Array.isArray(parsed.images)) parsedImages = [...parsedImages, ...parsed.images];
                  } catch (e) {
                    if (val.startsWith('http')) parsedImages.push(val);
                  }
                }
              }
            }

            const uniqueImages = Array.from(new Set(parsedImages));
            const coverSrc = uniqueImages[0] || '';

            return {
              id: pid || String(idx),
              pid,
              title: title || 'Produk Showcase',
              imageUrl: coverSrc,
              images: uniqueImages
            };
          })
          .filter((p) => p.imageUrl && p.imageUrl.startsWith('http'));
      }
    }

    return rawList;
  }

  // =========================================================================
  // HANDLER TOMBOL PILIH GAMBAR, UPLOAD KARAKTER, & PASTE PINTEREST
  // =========================================================================
  function setupAssetButtonListeners() {
    [
      'selectedReferenceImagePathJJ',
      'selectedReferenceImagePath',
      'selectedCharacterImagePathJJ',
      'selectedCharacterImagePathDaster',
      'selectedCharacterImagePathSensasi',
      'selectedCharacterImagePathPov',
      'selectedTiktokProductPathJJ',
      'selectedTiktokProductPathDaster',
      'selectedTiktokProductPathSensasi',
      'selectedTiktokProductPathPov'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.value === '[object Object]') {
        el.value = '';
      }
    });

    document.querySelectorAll('.btn-open-showcase-picker').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const modal =
          document.getElementById('showcasePickerModal') ||
          document.getElementById('modalShowcasePicker') ||
          document.querySelector('[id*="showcasePicker" i][id*="modal" i]');

        if (!modal) {
          showAlert('Modal pemilih produk showcase tidak ditemukan.', 'error');
          return;
        }

        modal.style.display = 'flex';

        // Elemen diambil lewat ID tetap: selector longgar bisa salah tangkap isi judul saat modal dibuka ulang
        const modalTitle = document.getElementById('showcaseModalTitle') || modal.querySelector('h3');
        const footerHint = document.getElementById('showcaseModalFooterInfo');
        const grid = document.getElementById('showcaseProductsGrid');
        const imagesGridOld = document.getElementById('showcaseImagesGrid');
        if (imagesGridOld) imagesGridOld.style.display = 'none';
        const oldBackBtn = document.getElementById('btnBackToShowcaseProducts');
        if (oldBackBtn && !modalTitle?.contains(oldBackBtn)) oldBackBtn.style.display = 'none';
        // Hanya pembukaan modal terakhir yang boleh menggambar ulang isi modal
        const openToken = (window.__showcasePickerToken = (window.__showcasePickerToken || 0) + 1);

        const defaultTitle = 'Pilih Produk dari Showcase';
        if (modalTitle) modalTitle.textContent = defaultTitle;
        if (footerHint) footerHint.textContent = 'Klik produk untuk melihat daftar foto';

        if (grid) {
          grid.innerHTML =
            '<div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 40px 0; font-size: 13px;">Memuat produk etalase TikTok...</div>';
        }

        try {
          const products = await fetchFullShowcaseProductsData();
          if (window.__showcasePickerToken !== openToken) return;

          if (!products || products.length === 0) {
            if (grid) {
              grid.innerHTML =
                '<div style="grid-column: 1 / -1; text-align: center; color: #f87171; padding: 40px 0; font-size: 13px;">Belum ada produk di etalase. Silakan sinkronkan etalase di tab Showcase Produk terlebih dahulu.</div>';
            }
            return;
          }

          function renderStep1Products() {
            if (grid) delete grid.dataset.activeProduct;
            if (modalTitle) modalTitle.textContent = defaultTitle;
            if (footerHint) footerHint.textContent = 'Klik produk untuk melihat daftar foto';
            if (!grid) return;

            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(145px, 1fr))';
            grid.style.gap = '12px';
            grid.style.maxHeight = '420px';
            grid.style.overflowY = 'auto';
            grid.style.padding = '12px';
            grid.innerHTML = '';

            products.forEach((prod) => {
              const allPhotos = normalizeShowcasePhotos(prod);
              const coverUrl = allPhotos[0] || '';
              const title = prod.title || prod.name || prod.productName || 'Produk Showcase';
              if (!coverUrl) return;

              const card = document.createElement('div');
              card.style.cssText = `
                position: relative;
                border-radius: 8px;
                overflow: hidden;
                background: #181920;
                border: 2px solid rgba(255, 255, 255, 0.1);
                cursor: pointer;
                transition: transform 0.15s ease, border-color 0.15s ease;
                height: 195px;
                display: flex;
                flex-direction: column;
              `;

              card.innerHTML = `
                <div style="flex: 1; overflow: hidden; position: relative; background: #0f172a;">
                  <img src="${coverUrl}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy">
                  ${
                    allPhotos.length > 1
                      ? `<span style="position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.75); color: #38bdf8; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(56,189,248,0.3);">${allPhotos.length} Foto</span>`
                      : ''
                  }
                </div>
                <div style="padding: 8px; background: rgba(15, 23, 42, 0.95); border-top: 1px solid rgba(255, 255, 255, 0.08);">
                  <div style="font-size: 11px; color: #fff; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${title}">
                    ${title}
                  </div>
                </div>
              `;
              card.onmouseenter = () => {
                card.style.transform = 'translateY(-2px)';
                card.style.borderColor = '#38bdf8';
              };
              card.onmouseleave = () => {
                card.style.transform = 'translateY(0)';
                card.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              };

              card.onclick = async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                if (card.dataset.loading === 'true') return;
                card.dataset.loading = 'true';

                grid.dataset.activeProduct = String(
                  prod.pid || prod.productId || prod.product_id || prod.id || title
                );

                const knownPhotos = [...new Set([...allPhotos, ...((window.__showcasePhotoMemory && window.__showcasePhotoMemory.get(
                  String(prod.pid || prod.productId || prod.product_id || prod.id || title))) || [])])];
                renderStep2ProductPhotos(title, knownPhotos);

                if (footerHint) {
                  footerHint.textContent = 'Mengambil foto produk lengkap...';
                }

                try {
                  const fetched = await getCompleteProductPhotos(prod);
                  const pidKey = String(prod.pid || prod.productId || prod.product_id || prod.id || title);
                  // Jangan pernah menyusut: gabungkan dengan foto yang sudah pernah didapat untuk produk ini
                  window.__showcasePhotoMemory = window.__showcasePhotoMemory || new Map();
                  const remembered = window.__showcasePhotoMemory.get(pidKey) || [];
                  const completePhotos = [...new Set([...allPhotos, ...remembered, ...fetched])];
                  window.__showcasePhotoMemory.set(pidKey, completePhotos);
                  if (
                    window.__showcasePickerToken !== openToken ||
                    modal.style.display === 'none' ||
                    grid.dataset.activeProduct !== String(
                      prod.pid || prod.productId || prod.product_id || prod.id || title
                    )
                  ) {
                    return;
                  }

                  renderStep2ProductPhotos(
                    title,
                    completePhotos.length ? completePhotos : allPhotos
                  );
                } catch (error) {
                  console.warn('[AI VIDEO] Gagal memperbarui galeri:', error);
                } finally {
                  card.dataset.loading = 'false';
                }
              };

              grid.appendChild(card);
            });
          }

          function renderStep2ProductPhotos(productTitle, photosList) {
            if (!grid) return;

            if (modalTitle) {
              modalTitle.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px;">
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <button type="button" id="btnBackToShowcaseProducts" class="chip-btn" style="padding: 4px 10px; font-size: 11.5px; cursor: pointer; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 6px; white-space: nowrap;">
                      ← Kembali
                    </button>
                    <span style="font-size: 13.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${productTitle}
                    </span>
                  </div>
                  <span style="font-size: 11px; color: #64748b; white-space: nowrap;">
                    ${photosList.length} foto tersedia
                  </span>
                </div>
              `;

              const backButton = modalTitle.querySelector('#btnBackToShowcaseProducts');
              if (backButton) {
                backButton.onclick = (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  renderStep1Products();
                };
              }
            }

            if (footerHint) {
              footerHint.textContent = `${photosList.length} foto tersedia untuk produk ini`;
            }

            grid.innerHTML = '';
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
            grid.style.gap = '12px';
            grid.style.padding = '14px';

            photosList.forEach((photoUrl, idx) => {
              const isCover = idx === 0;
              const photoCard = document.createElement('div');

              photoCard.style.cssText = `
                position: relative;
                border-radius: 10px;
                overflow: hidden;
                background: #181920;
                border: 2px solid ${isCover ? '#10b981' : 'rgba(255, 255, 255, 0.12)'};
                cursor: pointer;
                transition: transform 0.15s ease, border-color 0.15s ease;
                aspect-ratio: 1 / 1;
                height: 125px;
              `;

              photoCard.innerHTML = `
                <img
                  src="${photoUrl}"
                  alt="Foto ${idx + 1}"
                  style="width: 100%; height: 100%; object-fit: cover; display: block;"
                  loading="lazy"
                >
                <div style="position: absolute; bottom: 0; inset-inline: 0; background: ${
                  isCover ? '#10b981' : 'rgba(15, 23, 42, 0.85)'
                }; color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; padding: 3px 0;">
                  ${isCover ? 'Cover Utama' : `Foto ${idx + 1}`}
                </div>
              `;

              photoCard.onmouseenter = () => {
                photoCard.style.transform = 'scale(1.03)';
                photoCard.style.borderColor = '#38bdf8';
              };

              photoCard.onmouseleave = () => {
                photoCard.style.transform = 'scale(1)';
                photoCard.style.borderColor = isCover ? '#10b981' : 'rgba(255, 255, 255, 0.12)';
              };

              photoCard.onclick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                window.handleShowcaseProductSelected(photoUrl, productTitle, photoUrl, true);
              };

              grid.appendChild(photoCard);
            });
          }

          renderStep1Products();
        } catch (err) {
          if (grid) {
            grid.innerHTML = `
              <div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px 0; font-size: 13px;">
                Gagal memuat produk: ${err.message}
              </div>
            `;
          }
        }
      });
    });

    const cancelModalBtns = document.querySelectorAll(
      '#showcasePickerModal button, #modalShowcasePicker button, [id*="showcasePicker" i] button'
    );

    cancelModalBtns.forEach((btn) => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'batal' || txt === 'cancel' || btn.classList.contains('btn-close')) {
        btn.addEventListener('click', () => {
          const modal =
            document.getElementById('showcasePickerModal') ||
            document.getElementById('modalShowcasePicker') ||
            document.querySelector('[id*="showcasePicker" i][id*="modal" i]');
          if (modal) modal.style.display = 'none';
        });
      }
    });

    // 2. Upload Karakter
    const handleCharacterUpload = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const rawSelected = await pickLocalImageViaDialog();
      const cleanPath = extractFilePath(rawSelected);
      if (!cleanPath) return;

      const suffix = conceptSuffix();

      const charInput =
        document.getElementById(`selectedCharacterImagePath${suffix}`) ||
        document.getElementById('selectedCharacterImagePath');

      const thumbImg =
        document.getElementById(`characterSelectedThumb${suffix}`) ||
        document.getElementById('characterSelectedThumb');

      const emptySpan =
        document.getElementById(`characterSelectedEmpty${suffix}`) ||
        document.getElementById('characterSelectedEmpty');

      if (
        applyImageToField({
          inputEl: charInput,
          thumbEl: thumbImg,
          emptyEl: emptySpan,
          rawPath: cleanPath
        })
      ) {
        showAlert(`Foto ${suffix === 'Pov' ? 'background' : 'karakter'} terpilih: ${getFileNameOnly(cleanPath)}`, 'success');
      }
    };

    document
      .querySelectorAll(
        '.btn-upload-character-photo, #btnUploadCharacterPhoto, #btnBrowseCharacterImage, #selectedCharacterImagePathJJ, #selectedCharacterImagePathDaster, #selectedCharacterImagePathSensasi, #selectedCharacterImagePathPov'
      )
      .forEach((el) => {
        el.addEventListener('click', handleCharacterUpload);
      });

    // 3. Paste Gambar Pinterest (Khusus JJ)
    const handlePinterestPaste = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      try {
        const rawPasted = await pasteImageViaClipboard();
        const cleanPath = extractFilePath(rawPasted);

        if (cleanPath) {
          const refInput =
            document.getElementById('selectedReferenceImagePathJJ') ||
            document.getElementById('selectedReferenceImagePath');

          const thumbImg =
            document.getElementById('referenceSelectedThumbJJ') ||
            document.getElementById('referenceSelectedThumb');

          const emptySpan =
            document.getElementById('referenceSelectedEmptyJJ') ||
            document.getElementById('referenceSelectedEmpty');

          applyImageToField({
            inputEl: refInput,
            thumbEl: thumbImg,
            emptyEl: emptySpan,
            rawPath: cleanPath,
            displayTitle: getFileNameOnly(cleanPath) || 'Gambar Pinterest (Clipboard)'
          });

          showAlert('Gambar Pinterest berhasil ditempel dari Clipboard!', 'success');
        } else {
          showAlert('Clipboard tidak berisi data gambar. Buka Pinterest lalu klik kanan "Copy Image".', 'error');
        }
      } catch (err) {
        showAlert('Gagal menempel gambar: ' + err.message, 'error');
      }
    };

    document
      .querySelectorAll(
        '.btn-paste-reference-photo, #btnPasteReferencePhoto, #btnPastePinterestImage'
      )
      .forEach((btn) => {
        btn.addEventListener('click', handlePinterestPaste);
      });

    document.addEventListener('paste', async (e) => {
      if (currentSelectedConcept !== 'jj') return;
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'textarea' || (activeTag === 'input' && !document.activeElement.readOnly)) {
        return;
      }
      if (reelsGeneratorFormView && window.getComputedStyle(reelsGeneratorFormView).display !== 'none') {
        await handlePinterestPaste();
      }
    });

    // 3b. Paste Gambar ke Foto Produk / Karakter (semua konsep)
    const handlePastePhoto = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget.dataset.pasteTarget;
      const suffix = conceptSuffix();

      try {
        const cleanPath = extractFilePath(await pasteImageViaClipboard());
        if (!cleanPath) {
          showAlert('Clipboard tidak berisi gambar. Di browser klik kanan gambar lalu pilih "Copy Image".', 'error');
          return;
        }

        if (target === 'product') {
          window.handleShowcaseProductSelected(cleanPath, getFileNameOnly(cleanPath) || 'Gambar dari Clipboard', null, false);
          showAlert('Foto produk berhasil ditempel dari clipboard.', 'success');
        } else {
          applyImageToField({
            inputEl: document.getElementById(`selectedCharacterImagePath${suffix}`),
            thumbEl: document.getElementById(`characterSelectedThumb${suffix}`),
            emptyEl: document.getElementById(`characterSelectedEmpty${suffix}`),
            rawPath: cleanPath
          });
          showAlert(`Foto ${suffix === 'Pov' ? 'background' : 'karakter'} berhasil ditempel dari clipboard.`, 'success');
        }
      } catch (err) {
        showAlert('Gagal menempel gambar: ' + err.message, 'error');
      }
    };

    document.querySelectorAll('.btn-paste-photo').forEach((btn) => {
      btn.addEventListener('click', handlePastePhoto);
    });

    // 4. Pilih File Referensi Pinterest Manual (Khusus JJ)
    const handlePinterestFileUpload = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const rawSelected = await pickLocalImageViaDialog();
      const cleanPath = extractFilePath(rawSelected);
      if (!cleanPath) return;

      const refInput =
        document.getElementById('selectedReferenceImagePathJJ') ||
        document.getElementById('selectedReferenceImagePath');

      const thumbImg =
        document.getElementById('referenceSelectedThumbJJ') ||
        document.getElementById('referenceSelectedThumb');

      const emptySpan =
        document.getElementById('referenceSelectedEmptyJJ') ||
        document.getElementById('referenceSelectedEmpty');

      if (
        applyImageToField({
          inputEl: refInput,
          thumbEl: thumbImg,
          emptyEl: emptySpan,
          rawPath: cleanPath
        })
      ) {
        showAlert(`File referensi terpilih: ${getFileNameOnly(cleanPath)}`, 'success');
      }
    };

    document
      .querySelectorAll(
        '.btn-upload-reference-photo, #btnUploadReferencePhoto, #btnBrowseReferenceImage'
      )
      .forEach((btn) => {
        btn.addEventListener('click', handlePinterestFileUpload);
      });
  }

  setupAssetButtonListeners();

  // =========================================================================
  // GALERI STORYBOARD, MODAL PRATINJAU DETAIL, & SALIN PROMPT
  // =========================================================================
  function openStoryboardDetailModal(imageSrc, promptText) {
    if (!storyboardDetailModal) return;

    if (storyboardDetailImage) {
      storyboardDetailImage.src = toSafeFileUrl(imageSrc);
      storyboardDetailImage.style.display = 'block';
    }

    const finalText =
      promptText &&
      typeof promptText === 'string' &&
      promptText.trim().length > 20
        ? promptText.trim()
        : 'Belum ada teks prompt video yang tersimpan.';

    if (storyboardDetailCaption) {
      storyboardDetailCaption.textContent = finalText;
    }

    if (storyboardDetailType && videoStoryboardType) {
      const selectedOption = videoStoryboardType.options[videoStoryboardType.selectedIndex];
      storyboardDetailType.textContent = selectedOption ? selectedOption.text : '1. PROBLEM–SOLUTION';
    }

    storyboardDetailModal.style.display = 'flex';
  }

  function closeStoryboardDetailModal() {
    if (storyboardDetailModal) {
      storyboardDetailModal.style.display = 'none';
    }
  }

  btnCloseStoryboardDetail?.addEventListener('click', closeStoryboardDetailModal);
  btnOkStoryboardDetail?.addEventListener('click', closeStoryboardDetailModal);

  storyboardDetailModal?.addEventListener('click', (e) => {
    if (e.target === storyboardDetailModal) {
      closeStoryboardDetailModal();
    }
  });

  btnCopyStoryboardModalPrompt?.addEventListener('click', () => {
    if (!storyboardDetailCaption || !storyboardDetailCaption.textContent.trim()) {
      return;
    }

    const textToCopy = storyboardDetailCaption.textContent.trim();
    if (textToCopy.startsWith('Belum ada teks prompt')) return;

    navigator.clipboard.writeText(textToCopy).then(() => {
      const orig = btnCopyStoryboardModalPrompt.textContent;
      btnCopyStoryboardModalPrompt.textContent = '✅ Disalin!';
      setTimeout(() => {
        btnCopyStoryboardModalPrompt.textContent = orig;
      }, 2000);
    });
  });

  function renderStoryboardFrames(rawItems = []) {
    if (!storyboardFramesGrid) return;
    storyboardFramesGrid.innerHTML = '';

    if (!rawItems || rawItems.length === 0) {
      if (videoStorageCountBadge) {
        videoStorageCountBadge.textContent = '(0 Berkas)';
      }
      storyboardFramesGrid.innerHTML =
        '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-size: 12px; padding: 25px 0;">Belum ada frame storyboard yang tersimpan.</div>';
      latestStoryboardItem = null;
      return;
    }

    latestStoryboardItem = rawItems[0];

    if (videoStorageCountBadge) {
      videoStorageCountBadge.textContent = `(${rawItems.length} Berkas)`;
    }

    rawItems.forEach((item, idx) => {
      const filePath = typeof item === 'string' ? item : (item.path || item.filePath);
      const itemPrompt = typeof item === 'object' && item.promptText ? item.promptText : '';

      if (!filePath) return;

      const safeSrc = toSafeFileUrl(filePath);
      const frameCard = document.createElement('div');
      frameCard.className = 'storage-card';

      frameCard.innerHTML = `
        <img
          src="${safeSrc}"
          loading="lazy"
          style="width: 100%; height: 100%; object-fit: cover; display: block;"
          onerror="this.style.display='none'"
        >
        <div class="storage-card-overlay">
          <div style="display: flex; justify-content: flex-end; width: 100%;">
            <button
              type="button"
              class="btn-action-delete"
              title="Hapus Frame"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
          <button
            type="button"
            class="btn-action-primary btn-card-preview"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5z"/>
            </svg>
            Pratinjau & Prompt
          </button>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); color: #fff; font-size: 11px; font-weight: 600; padding: 12px 6px 6px; text-align: center; pointer-events: none;">
          Storyboard ${idx + 1}
        </div>
      `;

      frameCard
        .querySelector('.btn-card-preview')
        .addEventListener('click', (e) => {
          e.stopPropagation();
          openStoryboardDetailModal(safeSrc, itemPrompt);
        });

      frameCard
        .querySelector('.btn-action-delete')
        .addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Hapus Storyboard ${idx + 1}?`)) {
            if (window.electronAPI?.deleteStoryboardFrame) {
              await window.electronAPI.deleteStoryboardFrame(filePath);
            }
            await loadExistingStoryboards();
          }
        });

      storyboardFramesGrid.appendChild(frameCard);
    });
  }

  async function loadExistingStoryboards() {
    try {
      if (window.electronAPI?.getStoryboardHistory) {
        const history = await window.electronAPI.getStoryboardHistory();
        if (history) {
          const listToRender = Array.isArray(history)
            ? history
            : (history.items && Array.isArray(history.items))
              ? history.items
              : (history.frames || []).map((f) =>
                  typeof f === 'string' ? { path: f, promptText: '' } : f
                );

          renderStoryboardFrames(listToRender);
          return listToRender;
        }
      }
    } catch (e) {
      console.error('Gagal memuat riwayat storyboard:', e);
    }
    return [];
  }

  // =========================================================================
  // MODAL STORYBOARD FRAME PICKER (KE FLOW + CAPCUT JJ)
  // =========================================================================
  async function openStoryboardFramePickerModal() {
    if (!modalSelectStoryboardFrame || !storyboardFrameGrid) return;

    storyboardFrameGrid.innerHTML =
      '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0; font-size: 12.5px;">Memuat koleksi Storyboard...</div>';

    modalSelectStoryboardFrame.style.display = 'flex';
    chosenStoryboardFrameForJJ = null;

    if (btnConfirmStoryboardToFlowJJ) {
      btnConfirmStoryboardToFlowJJ.disabled = true;
      btnConfirmStoryboardToFlowJJ.style.opacity = '0.5';
      btnConfirmStoryboardToFlowJJ.style.cursor = 'not-allowed';
    }

    if (storyboardFrameHint) {
      storyboardFrameHint.textContent = 'Pilih salah satu gambar frame storyboard di atas.';
      storyboardFrameHint.style.color = '#94a3b8';
    }

    const items = await loadExistingStoryboards();

    if (!items || items.length === 0) {
      storyboardFrameGrid.innerHTML =
        '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0; font-size: 12.5px;">Belum ada berkas frame storyboard yang tersimpan. Buat Storyboard terlebih dahulu.</div>';
      return;
    }

    storyboardFrameGrid.innerHTML = '';

    items.forEach((item, idx) => {
      const rawPath = typeof item === 'string' ? item : (item.path || item.filePath);
      if (!rawPath) return;

      const safeSrc = toSafeFileUrl(rawPath);
      const card = document.createElement('div');

      card.style.cssText =
        'position: relative; height: 200px; border-radius: 8px; overflow: hidden; background: #181920; border: 2px solid rgba(255, 255, 255, 0.1); cursor: pointer; transition: all 0.2s ease;';

      card.innerHTML = `
        <img
          src="${safeSrc}"
          style="width: 100%; height: 100%; object-fit: cover; display: block;"
          loading="lazy"
        >
        <div style="position: absolute; bottom: 0; inset-inline: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); padding: 8px 6px; text-align: center;">
          <span style="font-size: 11px; color: #fff; font-weight: 600;">
            Frame #${idx + 1}
          </span>
        </div>
      `;

      card.onclick = () => {
        storyboardFrameGrid.querySelectorAll('div').forEach((c) => {
          c.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          c.style.transform = 'scale(1)';
        });

        card.style.borderColor = '#38bdf8';
        card.style.transform = 'scale(1.02)';
        chosenStoryboardFrameForJJ = item;

        if (btnConfirmStoryboardToFlowJJ) {
          btnConfirmStoryboardToFlowJJ.disabled = false;
          btnConfirmStoryboardToFlowJJ.style.opacity = '1';
          btnConfirmStoryboardToFlowJJ.style.cursor = 'pointer';
        }

        if (storyboardFrameHint) {
          storyboardFrameHint.textContent = `Frame terpilih: ${getFileNameOnly(rawPath)}`;
          storyboardFrameHint.style.color = '#38bdf8';
        }
      };

      storyboardFrameGrid.appendChild(card);
    });
  }

  btnFlowToJJFromStoryboard?.addEventListener('click', (e) => {
    e.preventDefault();
    openStoryboardFramePickerModal();
  });

  btnCloseStoryboardModal?.addEventListener('click', () => {
    if (modalSelectStoryboardFrame) {
      modalSelectStoryboardFrame.style.display = 'none';
    }
  });

  btnCancelStoryboardModal?.addEventListener('click', () => {
    if (modalSelectStoryboardFrame) {
      modalSelectStoryboardFrame.style.display = 'none';
    }
  });

  btnConfirmStoryboardToFlowJJ?.addEventListener('click', async () => {
    if (!chosenStoryboardFrameForJJ) {
      alert('Silakan pilih salah satu frame storyboard terlebih dahulu.');
      return;
    }

    const selectedPath =
      typeof chosenStoryboardFrameForJJ === 'string'
        ? chosenStoryboardFrameForJJ
        : (chosenStoryboardFrameForJJ.path || chosenStoryboardFrameForJJ.filePath);

    const selectedPrompt =
      typeof chosenStoryboardFrameForJJ === 'object'
        ? chosenStoryboardFrameForJJ.promptText || ''
        : '';

    const targetProjectDir =
      typeof chosenStoryboardFrameForJJ === 'object'
        ? chosenStoryboardFrameForJJ.projectFolder || ''
        : '';

    if (modalSelectStoryboardFrame) {
      modalSelectStoryboardFrame.style.display = 'none';
    }

    hideAlert();

    const origText = btnFlowToJJFromStoryboard
      ? btnFlowToJJFromStoryboard.innerHTML
      : '';

    if (btnFlowToJJFromStoryboard) {
      btnFlowToJJFromStoryboard.disabled = true;
      btnFlowToJJFromStoryboard.innerHTML =
        '<span>⏳ Memproses Flow & CapCut JJ...</span>';
    }

    if (videoProgressBox) {
      videoProgressBox.style.display = 'block';
      videoProgressBox.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }

    if (videoLogs) videoLogs.innerHTML = '';
    startVideoTimer();
    let jjSuccess = false;

    updateProgress(
      'Menyiapkan eksekusi Google Flow & CapCut JJ dari frame terpilih...',
      10
    );

    try {
      const flowParams = getSelectedFlowParams();

      updateProgress(
        'Langkah 1/2: Menjalankan render Google Flow (3 Candid + 1 Video)...',
        30
      );

      const isHeadless = await isHeadlessEnabledAsync();

      const requestPayload = {
        storyboardImagePath: selectedPath,
        projectFolder: targetProjectDir,
        promptText: selectedPrompt,
        ...flowParams,
        headless: isHeadless,
        searchKeyword: 'JJ'
      };

      let result = null;

      if (typeof window.electronAPI?.runFlowToJJFromStoryboard === 'function') {
        result = await window.electronAPI.runFlowToJJFromStoryboard(requestPayload);
      } else if (typeof window.electronAPI?.invoke === 'function') {
        result = await window.electronAPI.invoke('run-flow-to-jj-from-storyboard', requestPayload);
      } else {
        throw new Error('Metode runFlowToJJFromStoryboard tidak ditemukan pada preload.');
      }

      if (result && result.success) {
        jjSuccess = true;
        updateProgress(
          `Selesai! Video JJ berhasil dibuat (${result.durationMinutes || 0} menit)`,
          100
        );

        showAlert(
          `Sukses! Video JJ berhasil dirender dan disimpan di: ${result.videoPath}`,
          'success'
        );
      } else if (result && result.error !== 'Dibatalkan') {
        showAlert(
          result.error || 'Gagal menjalankan alur Flow & CapCut JJ.',
          'error'
        );
      }
    } catch (err) {
      showAlert(
        err.message || 'Terjadi kesalahan sistem saat memproses video.',
        'error'
      );
    } finally {
      stopVideoTimer(jjSuccess);
      if (btnFlowToJJFromStoryboard) {
        btnFlowToJJFromStoryboard.disabled = false;
        btnFlowToJJFromStoryboard.innerHTML = origText;
      }
    }
  });

  btnCreateJJCapcut?.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalSelectJJAssets) {
      modalSelectJJAssets.style.display = 'flex';
      if (typeof window.loadJJModalAssets === 'function') {
        window.loadJJModalAssets();
      }
    }
  });

  btnCloseJJModal?.addEventListener('click', () => {
    if (modalSelectJJAssets) modalSelectJJAssets.style.display = 'none';
  });

  btnCancelJJModal?.addEventListener('click', () => {
    if (modalSelectJJAssets) modalSelectJJAssets.style.display = 'none';
  });

  // =========================================================================
  // EKSEKUSI PIPELINE UTAMA (REELS / TIKTOK JJ & DASTER)
  // =========================================================================
  async function handleExecuteStoryboard(continueToFlow = true) {
    hideAlert();

    const btnTarget = btnRunFullReelsPipeline || btnRunStoryboardOnly;
    const origText = btnTarget ? btnTarget.innerHTML : '';
    const isTikTok = isPlatformTikTok();
    const isDaster = currentSelectedConcept === 'daster';
    const isSensasi = currentSelectedConcept === 'sensasi';
    const isPov = currentSelectedConcept === 'pov' || currentSelectedConcept === 'pov2';
    const isJJ = !isDaster && !isSensasi && !isPov;

    const assets = getActiveFormAssetPayload();

    if (isTikTok) {
      if (!assets.productPath) {
        showAlert(
          isDaster
            ? 'Silakan pilih foto produk daster dari showcase terlebih dahulu.'
            : 'Silakan pilih foto produk dari showcase terlebih dahulu.'
        );
        return;
      }

      if (!assets.characterPath) {
        showAlert(isPov ? 'Silakan pilih foto background / latar terlebih dahulu.' : 'Silakan pilih foto model/karakter terlebih dahulu.');
        return;
      }

      if (isJJ && !assets.referencePath) {
        showAlert('Silakan unggah atau paste foto referensi pose Pinterest terlebih dahulu.');
        return;
      }
    }

    if (btnTarget) {
      btnTarget.disabled = true;
      btnTarget.textContent = isTikTok
        ? isDaster
          ? '⏳ Memproses Storyboard Daster 5 Scene...'
          : isSensasi
            ? '⏳ Memproses Storyboard & Video Sensasi...'
            : '⏳ Memproses Storyboard, Flow, & CapCut JJ...'
        : '⏳ Memproses Storyboard 4 Panel...';
    }

    if (btnRunFlowOnly) {
      btnRunFlowOnly.disabled = true;
    }

    if (videoLogs) {
      videoLogs.innerHTML = '';
    }
    startVideoTimer();
    let pipelineSuccess = false;

    updateProgress('Menyiapkan parameter pembuatan visual dan video...', 10);

    try {
      const flowParams = getSelectedFlowParams();

      let finalBg = tiktokBackgroundSelect?.value || 'indoor';
      if (finalBg === 'custom' && tiktokCustomBackgroundInput?.value.trim()) {
        finalBg = tiktokCustomBackgroundInput.value.trim();
      }

      let finalPose = tiktokPoseSelect?.value || '1';
      if (finalPose === 'custom' && tiktokCustomPoseInput?.value.trim()) {
        finalPose = tiktokCustomPoseInput.value.trim();
      }

      // Ambil nilai Headless aktual dari backend config/DOM
      const isHeadless = await isHeadlessEnabledAsync();

      const payload = {
        concept: currentSelectedConcept,

        ...(isDaster
          ? {
              dasterClothingMode: getDasterClothingMode()
            }
          : {}),

        ...(isSensasi ? { sensasiPose: document.getElementById('sensasiPoseSelect')?.value || 'random' } : {}),
        // POV Tangan: slot "karakter" berisi foto background
        ...(isPov ? { backgroundImagePath: assets.characterPath, povVoice: document.getElementById('povVoiceSelect')?.value || 'cewek' } : {}),

        platform: isTikTok ? 'tiktok' : 'instagram',

        prompt: videoPromptInput?.value?.trim() || 'Product Promotion Banner',

        bannerSource: isTikTok
          ? 'select_showcase'
          : videoBannerSource?.value || 'auto_generate',

        selectedBannerPath: assets.productPath,
        bannerImagePath: assets.productPath,
        customCharacterPath: assets.characterPath,
        referenceImagePath: isJJ ? assets.referencePath : null,

        backgroundCustom: finalBg,
        poseCustom: finalPose,

        characterKeyword: videoCharacterKeyword?.value?.trim() || 'wanita',

        aspectRatio: flowParams.flowRatio,
        storyboardType: videoStoryboardType?.value || '1',

        ...flowParams,

        // Teruskan status boolean headless langsung ke backend
        headless: isHeadless,

        workerId: 1
      };

      updateProgress(
        isTikTok
          ? isDaster
            ? 'Memproses analisis model, produk daster & 5 Scene ChatGPT...'
            : isSensasi
              ? 'Memproses foto model & produk di Custom GPT Sensasi...'
              : 'Memproses sintesis karakter, busana & kanvas Storyboard ChatGPT...'
          : 'Membuat visual storyboard 4 panel dan prompt Veo...',
        25
      );

      const res = await window.electronAPI.generateAiVideo(payload);

      if (res && res.success) {
        pipelineSuccess = true;
        currentProjectFolder = res.projectFolder;

        await loadExistingStoryboards();

        const finalVid = res.videoPath || res.flowResult?.videoPath;

        updateProgress(
          isDaster
            ? '🎉 Seluruh 5 Scene Daster & Video Motion selesai dibuat!'
            : isSensasi
              ? '🎉 Storyboard & Video Sensasi selesai dibuat!'
              : '🎉 Seluruh alur selesai 100%! Video berhasil dirakit dan disimpan.',
          100
        );

        showAlert(`Selesai! Video berhasil dibuat: ${finalVid || ''}`, 'success');
      } else {
        showAlert(res?.error || 'Gagal memproses pembuatan video.', 'error');
      }
    } catch (err) {
      console.error('[Execute Storyboard Error]:', err);
      showAlert('Terjadi kesalahan: ' + err.message, 'error');
    } finally {
      stopVideoTimer(pipelineSuccess);
      if (btnTarget) {
        btnTarget.disabled = false;
        btnTarget.innerHTML = origText;
      }

      if (btnRunFlowOnly) {
        btnRunFlowOnly.disabled = false;
      }
    }
  }

  btnRunFullReelsPipeline?.addEventListener('click', () => handleExecuteStoryboard(true));

  loadExistingStoryboards();

  document
    .getElementById('tabAiVideo')
    ?.addEventListener('click', loadExistingStoryboards);

  // =========================================================================
  // LOG PER WORKER: mode 2 worker → panel W1 & W2 terpisah (judul, progress bar, log masing-masing)
  // =========================================================================
  const workerPanelsBox = document.getElementById('videoWorkerPanels');
  const workerPanels = new Map();
  let activeWorkerCount = 1;

  function buildWorkerPanels(count) {
    activeWorkerCount = count;
    workerPanels.clear();
    if (!workerPanelsBox) return;
    workerPanelsBox.innerHTML = '';
    const multi = count > 1;
    workerPanelsBox.style.display = multi ? 'grid' : 'none';
    if (videoLogs) videoLogs.style.display = multi ? 'none' : '';
    if (!multi) return;

    for (let id = 1; id <= count; id++) {
      const panel = document.createElement('div');
      panel.style.cssText = 'background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 10px; min-width: 0;';
      panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; font-weight: 700; color: #fff; margin-bottom: 5px;">
          <span>Worker ${id}</span>
          <span data-role="pct" style="color: var(--accent-2-text);">0%</span>
        </div>
        <div data-role="title" style="font-size: 11px; color: #d0cec8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px;">Menunggu giliran...</div>
        <div style="height: 4px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
          <div data-role="bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #e8a25c, #35b29f); transition: width 0.4s ease;"></div>
        </div>
        <div data-role="logs" style="font-family: monospace; font-size: 10.5px; color: var(--text-muted); line-height: 1.5; max-height: 220px; overflow-y: auto; overflow-wrap: anywhere;"></div>`;
      workerPanelsBox.appendChild(panel);
      workerPanels.set(id, {
        title: panel.querySelector('[data-role="title"]'),
        pct: panel.querySelector('[data-role="pct"]'),
        bar: panel.querySelector('[data-role="bar"]'),
        logs: panel.querySelector('[data-role="logs"]'),
        percent: 0
      });
    }
  }

  function updateWorkerProgress(workerId, text, percent) {
    const panel = workerPanels.get(workerId);
    if (!panel) return false;
    if (videoProgressBox) videoProgressBox.style.display = 'block';
    panel.percent = percent;
    panel.title.textContent = text;
    panel.pct.textContent = `${Math.round(percent)}%`;
    panel.bar.style.width = `${percent}%`;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${text}`;
    panel.logs.appendChild(line);
    panel.logs.scrollTop = panel.logs.scrollHeight;

    // Bar utama = rata-rata progres semua worker
    const all = Array.from(workerPanels.values());
    const avg = all.reduce((sum, p) => sum + p.percent, 0) / all.length;
    if (videoStatusTitle) videoStatusTitle.textContent = `${all.length} worker berjalan · W${workerId}: ${text}`;
    if (videoProgressBar) videoProgressBar.style.width = `${avg}%`;
    return true;
  }

  window.addEventListener('video-workers-start', (e) => buildWorkerPanels(Number(e.detail?.count) || 1));

  if (window.electronAPI?.onVideoGenProgress) {
    window.electronAPI.onVideoGenProgress((data) => {
      if (data) {
        const text = data.status || 'Memproses...';
        let pct = typeof data.percent === 'number' ? data.percent : null;

        if (pct === null) {
          if (text.includes('[CapCut]')) pct = 75;
          else if (text.includes('Tahap 3') || text.includes('Scene')) pct = 45;
          else if (text.includes('[PHOTO CANDID 1')) pct = 30;
          else if (text.includes('[PHOTO CANDID 2')) pct = 40;
          else if (text.includes('[PHOTO CANDID 3')) pct = 50;
          else if (text.includes('[VIDEO MOTION')) pct = 60;
          else pct = 20;
        }

        // Mode 2 worker: masuk ke panel worker-nya sendiri
        if (activeWorkerCount > 1 && data.workerId && updateWorkerProgress(Number(data.workerId), text, pct)) return;
        updateProgress(text, pct);
      }
    });
  }

  btnOpenStoryboardFolder?.addEventListener('click', () => {
    window.electronAPI?.openStoryboardFolder?.();
  });

  btnOpenVideoFolder?.addEventListener('click', () => {
    window.electronAPI?.openVideoFolder?.();
  });

  btnOpenBahanVideoFolder?.addEventListener('click', () => {
    window.electronAPI?.openBahanVideoFolder?.(currentProjectFolder);
  });

  applyActiveConcept('jj');
}