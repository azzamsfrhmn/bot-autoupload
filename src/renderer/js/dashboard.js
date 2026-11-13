/**
 * src/renderer/js/dashboard.js
 */
import { initTabNavigation } from './modules/tabNavigation.js';
import { initAutoPilotManager } from './modules/autoPilotManager.js';
import { initScheduleManager } from './modules/scheduleManager.js';
import { initImageGenManager } from './modules/imageGenManager.js';
import { initImageStorageManager } from './modules/imageStorageManager.js';
import { initProfileManager, loadFullProfile, updateSidebarProfile } from './modules/profileManager.js';
import { initAiSettingsManager } from './modules/aiSettingsManager.js';
import { initAccountManager } from './modules/accountManager.js';
import { initAccountSwitcher } from './modules/accountSwitcher.js';
import { videoThumbHtml, hydrateVideoThumbs } from './modules/videoThumbs.js';
import { initShowcaseManager } from './modules/showcaseManager.js';
import { initLoadingIndicator } from './modules/loadingIndicator.js';
import { initVideoGenManager, startVideoTimer, stopVideoTimer } from '../../core/videoGenManager.js';
import { initRemotionManager } from './modules/remotionManager.js';
import { initKartun3DForm, getKartun3DState, removeKartunQueueItem } from './modules/kartun3dForm.js';

// State Konsep Reels Aktif (Default: 'jj')
let currentReelsConcept = 'jj';

// Refresh otomatis setelah video selesai: konsep & setelan Flow yang dipertahankan
const REELS_REOPEN_KEY = 'reelsReopenAfterRefresh';
// Jeda antar video dalam mode loop (detik)
const LOOP_PAUSE_SEC = 20;

const REELS_KEPT_SELECTS = [
  'tiktokVideoAspectRatio', 'tiktokFlowModelSelect', 'tiktokFlowResolutionSelect', 'tiktokFlowDurationSelect', 'tiktokFlowOutputCountSelect',
  'videoAspectRatio', 'flowModelSelect', 'flowResolutionSelect', 'flowDurationSelect', 'videoBatchCount', 'sensasiPoseSelect', 'povVoiceSelect',
  'reelsLoopCount', 'edu3dSceneCount', 'kartun3dDuration'
];

// Helper URL Aman untuk Gambar Lokal
function toSafeFileUrl(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  let clean = filePath.trim().replace(/\\/g, '/');
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('file://') || clean.startsWith('data:image')) {
    return clean;
  }
  clean = clean.replace(/^\/+/, '');
  return `file:///${clean}`;
}

// Template SVG Logo Platform
const PLATFORM_BRAND_ICONS = {
  tiktok: `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.49 6.3 6.3 0 0 0 1.86-4.49V8.78a8.18 8.18 0 0 0 4.91 1.64V6.97a4.85 4.85 0 0 1-1-.28z"/>
    </svg>
  `,
  instagram: `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  `
};

async function initDashboardApp() {
  console.log('[Dashboard] Memulai inisialisasi modul...');

  // Konsep pribadi (Remotion, 3D Edukasi, 3D Cara Kerja, 3D Kartun) tersembunyi untuk pembeli.
  // Pemilik: tekan Ctrl+Shift+K untuk tampil/sembunyi (tersimpan di PC ini saja).
  try {
    if (localStorage.getItem('showPrivateConcepts') === '1') document.body.classList.add('show-private-concepts');
  } catch (e) {}
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      const on = document.body.classList.toggle('show-private-concepts');
      try { localStorage.setItem('showPrivateConcepts', on ? '1' : '0'); } catch (err) {}
    }
  });

  // 0. Kontrol Jendela Kustom (Custom Title Bar Frameless)
  const btnWinMinimize = document.getElementById('btnWinMinimize');
  const btnWinMaximize = document.getElementById('btnWinMaximize');
  const btnWinClose = document.getElementById('btnWinClose');

  btnWinMinimize?.addEventListener('click', () => {
    window.electronAPI?.minimizeWindow();
  });

  btnWinMaximize?.addEventListener('click', () => {
    window.electronAPI?.maximizeWindow();
  });

  btnWinClose?.addEventListener('click', () => {
    window.electronAPI?.closeWindow();
  });

  // 1. Tab Navigation
  try {
    initTabNavigation();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat tab navigation:', err);
  }

  // 2. Modul Kelola Multi-Akun dipasang LEBIH DULU (supaya kartu akun di sidebar tetap bisa diklik
  //    walaupun pemuatan profil lambat / belum ada akun sama sekali)
  try {
    initAccountManager();
    initAccountSwitcher();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat account manager:', err);
  }

  // 3. Modul Profil & Feed — feed tidak ditunggu (bisa lama / menggantung bila belum ada akun)
  try {
    initProfileManager();
    await Promise.race([updateSidebarProfile(), new Promise((r) => setTimeout(r, 4000))]);
    Promise.resolve().then(() => loadFullProfile()).catch((err) => console.warn('[Dashboard] Feed profil gagal:', err));
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat profileManager:', err);
  }

  // 3b. Auto-Sync profil TikTok akun aktif
  try {

    window.electronAPI?.getAllAccounts?.().then((accData) => {
      const activeId = accData?.activeAccountId || accData?.accounts?.[0]?.id;
      const activeAcc = accData?.accounts?.find((a) => a.id === activeId) || accData?.accounts?.[0];
      if (activeAcc && String(activeAcc.platform).toLowerCase() === 'tiktok') {
        const invokeFn = window.electronAPI?.invoke || window.electronAPI?.syncTikTokProfile;
        if (typeof invokeFn === 'function') {
          invokeFn('tiktok:sync-profile', activeAcc.id || activeAcc.username).then((res) => {
            if (res && res.success && res.account) {
              updateSidebarProfile(res.account.avatar);
              loadFullProfile(res.account, res.posts);
            }
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat accountManager:', err);
  }

  const tabProfileButtons = document.querySelectorAll('#tabProfile, [data-tab="profile"], [data-view="viewProfile"]');
  tabProfileButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      loadFullProfile();
    });
  });

  // 4. Modul Showcase Produk TikTok Affiliate
  try {
    initShowcaseManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat showcaseManager:', err);
  }

  // 5. Modul Jadwal Postingan
  try {
    initScheduleManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat scheduleManager:', err);
  }

  // Spinner otomatis untuk gambar yang sedang dimuat
  try {
    initLoadingIndicator();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat loadingIndicator:', err);
  }

  // 6. Modul Auto Pilot
  try {
    initAutoPilotManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat autoPilotManager:', err);
  }

  // 7. Modul Gambar AI & Penampungan Galeri
  try {
    initImageGenManager();
    initImageStorageManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat imageManager:', err);
  }

  // 8. Modul Pengaturan AI
  try {
    initAiSettingsManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat aiSettingsManager:', err);
  }

  // 8.1 Modul Video Reels Generator
  try {
    initVideoGenManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat videoGenManager:', err);
  }

  // 8.1b Konsep 3D Kartun: sumber naskah, Tempel JSON & pratinjau adegan
  try { initKartun3DForm(); } catch (e) { console.error('[Dashboard Error] Gagal memuat form 3D Kartun:', e); }

  // 8.2 Konsep Remotion (form di halaman Video Reels)
  try {
    initRemotionManager();
  } catch (err) {
    console.error('[Dashboard Error] Gagal memuat remotionManager:', err);
  }

  // 9. Tombol Tambah Akun TikTok via CDP
  const btnLoginTikTokCDP = document.getElementById('btnLoginTikTokCDP');
  btnLoginTikTokCDP?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const res = await window.electronAPI?.loginTikTokAccount?.(null);
      if (res?.success) {
        alert(res.message || 'Browser Chrome resmi telah dibuka untuk login TikTok.');
      } else {
        alert('Gagal membuka Chrome: ' + (res?.error || 'Terjadi kesalahan sistem.'));
      }
    } catch (err) {
      alert('Error login TikTok: ' + err.message);
    }
  });

  // Navigasi Konsep Video Reels
  const selectionView = document.getElementById('reelsConceptSelectionView');
  const formView = document.getElementById('reelsGeneratorFormView');
  const btnBackToConcepts = document.getElementById('btnBackToConcepts');
  const conceptIndicatorBadge = document.getElementById('activeConceptIndicatorBadge');
  const pipelineHeaderLabel = document.getElementById('pipelineTikTokHeaderLabel');
  const pipelineSteps = document.getElementById('pipelineTikTokSteps');
  const lblReferencePhoto = document.getElementById('lblReferencePhoto');
  const hintReferencePhoto = document.getElementById('hintReferencePhoto');
  const conceptCards = document.querySelectorAll('.reels-concept-card');
  const btnCreateJJCapcut = document.getElementById('btnCreateJJCapcut');
  const btnFlowToJJFromStoryboard = document.getElementById('btnFlowToJJFromStoryboard');

  function updateJJButtonVisibility() {
    const isJJ = currentReelsConcept === 'jj';
    if (btnCreateJJCapcut) {
      btnCreateJJCapcut.style.setProperty('display', isJJ ? 'flex' : 'none', 'important');
    }
    if (btnFlowToJJFromStoryboard) {
      btnFlowToJJFromStoryboard.style.setProperty('display', isJJ ? 'flex' : 'none', 'important');
    }
  }

  // Durasi hanya bisa diatur di Omni 1.1 Flash; model Veo di Google Flow selalu 8 detik
  const tiktokModelSelect = document.getElementById('tiktokFlowModelSelect');
  const tiktokDurationSelect = document.getElementById('tiktokFlowDurationSelect');

  function updateDurationVisibility() {
    const group = tiktokDurationSelect?.closest('.form-group');
    if (!group) return;
    const isOmni = /omni/i.test(tiktokModelSelect?.value || '');
    group.style.display = isOmni ? '' : 'none';
    if (group.parentElement) group.parentElement.style.gridTemplateColumns = `repeat(${isOmni ? 5 : 4}, 1fr)`;
    if (!isOmni) tiktokDurationSelect.value = '8 Detik';
  }

  tiktokModelSelect?.addEventListener('change', updateDurationVisibility);
  updateDurationVisibility();

  conceptCards.forEach((card) => {
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-3px)';
      card.style.borderColor = card.getAttribute('data-concept') === 'daster' ? 'rgba(52, 211, 153, 0.5)' : 'rgba(232, 162, 92, 0.5)';
      card.style.boxShadow = '0 8px 24px -4px rgba(0,0,0,0.45)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'translateY(0)';
      card.style.borderColor = card.getAttribute('data-concept') === 'daster' ? 'rgba(160, 159, 154, 0.18)' : 'rgba(232, 162, 92, 0.25)';
      card.style.boxShadow = 'none';
    });

    card.addEventListener('click', () => {
      currentReelsConcept = card.getAttribute('data-concept') || 'jj';

      if (currentReelsConcept === 'daster') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: Daster & Homewear Try-On';
          conceptIndicatorBadge.style.color = '#34d399';
          conceptIndicatorBadge.style.background = 'rgba(16, 185, 129, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
        }
        if (pipelineHeaderLabel) pipelineHeaderLabel.textContent = 'Pipeline Daster:';
        if (pipelineSteps) {
          pipelineSteps.innerHTML = `
            <span>1. Motif Daster</span><span>→</span><span>2. Master Ref Indoor</span><span>→</span>
            <span style="color: #34d399;">3. 3 Foto Kasual Rumah</span><span>→</span><span style="color: #6fcdbd; font-weight: 600;">4. Motion Video Halus</span>
          `;
        }
        if (lblReferencePhoto) lblReferencePhoto.textContent = 'Foto Suasana / Ruangan Rumah (Pinterest / Lokal)';
        if (hintReferencePhoto) hintReferencePhoto.textContent = 'Acuan ruangan kamar/teras/ruang santai keluarga';
      } else if (currentReelsConcept === 'pov') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: POV Tangan';
          conceptIndicatorBadge.style.color = '#6fcdbd';
          conceptIndicatorBadge.style.background = 'rgba(53, 178, 159, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(53, 178, 159, 0.35)';
        }
      } else if (currentReelsConcept === 'carakerja3d') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: 3D Cara Kerja';
          conceptIndicatorBadge.style.color = '#6fcdbd';
          conceptIndicatorBadge.style.background = 'rgba(53, 178, 159, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(53, 178, 159, 0.35)';
        }
      } else if (currentReelsConcept === 'kartun3d') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: 3D Kartun';
          conceptIndicatorBadge.style.color = '#f0bb85';
          conceptIndicatorBadge.style.background = 'rgba(232, 162, 92, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(232, 162, 92, 0.35)';
        }
      } else if (currentReelsConcept === 'edu3d') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: 3D Edukasi';
          conceptIndicatorBadge.style.color = '#6fcdbd';
          conceptIndicatorBadge.style.background = 'rgba(53, 178, 159, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(53, 178, 159, 0.35)';
        }
      } else if (currentReelsConcept === 'remotion') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: Remotion';
          conceptIndicatorBadge.style.color = '#f0bb85';
          conceptIndicatorBadge.style.background = 'rgba(232, 162, 92, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(232, 162, 92, 0.35)';
        }
      } else if (currentReelsConcept === 'sensasi') {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: Sensasi';
          conceptIndicatorBadge.style.color = '#f0bb85';
          conceptIndicatorBadge.style.background = 'rgba(232, 162, 92, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(232, 162, 92, 0.35)';
        }
        if (pipelineHeaderLabel) pipelineHeaderLabel.textContent = 'Pipeline Sensasi:';
        if (pipelineSteps) {
          pipelineSteps.innerHTML = `
            <span>1. Foto Model + Produk</span><span>→</span><span>2. Pilih Pose</span><span>→</span>
            <span style="color: #6fcdbd;">3. Gambar Pose + Prompt VO</span><span>→</span><span style="color: #f0bb85; font-weight: 600;">4. Render Google Flow</span>
          `;
        }
      } else {
        if (conceptIndicatorBadge) {
          conceptIndicatorBadge.textContent = 'Konsep: TikTok Affiliate JJ (Jedag-Jedug)';
          conceptIndicatorBadge.style.color = '#f0bb85';
          conceptIndicatorBadge.style.background = 'rgba(232, 162, 92, 0.15)';
          conceptIndicatorBadge.style.borderColor = 'rgba(232, 162, 92, 0.35)';
        }
        if (pipelineHeaderLabel) pipelineHeaderLabel.textContent = 'Pipeline TikTok:';
        if (pipelineSteps) {
          pipelineSteps.innerHTML = `
            <span>1. Baju Bersih</span><span>→</span><span>2. Master Ref (9:16)</span><span>→</span>
            <span style="color: #6fcdbd;">3. 3 Foto Candid (1K)</span><span>→</span><span style="color: #f0bb85; font-weight: 600;">4. Video Motion Flow</span>
          `;
        }
        if (lblReferencePhoto) lblReferencePhoto.textContent = 'Upload Foto Referensi (Pinterest / Lokal)';
        if (hintReferencePhoto) hintReferencePhoto.textContent = 'Acuan otomatis pose, angle, dan background ruangan';
      }

      updateJJButtonVisibility();

      if (selectionView) selectionView.style.display = 'none';
      if (formView) formView.style.display = 'block';
    });
  });

  btnBackToConcepts?.addEventListener('click', () => {
    if (formView) formView.style.display = 'none';
    if (selectionView) selectionView.style.display = 'block';
  });

  // Setelah refresh otomatis (video selesai): buka lagi tab Buat Video Reels dengan konsep & setelan yang sama
  let reelsReopen = null;
  try {
    reelsReopen = JSON.parse(sessionStorage.getItem(REELS_REOPEN_KEY) || 'null');
    sessionStorage.removeItem(REELS_REOPEN_KEY);
  } catch (e) {}
  if (reelsReopen) {
    setTimeout(() => {
      document.getElementById('tabAiVideo')?.click();
      Object.entries(reelsReopen.selects || {}).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && value && Array.from(el.options).some((o) => o.value === value)) {
          el.value = value;
          el.dispatchEvent(new Event('change'));
        }
      });
      if (reelsReopen.concept) {
        document.querySelector(`.reels-concept-card[data-concept="${reelsReopen.concept}"]`)?.click();
      }
    }, 300);
  }

  // Modal JJ CapCut
  const modalSelectJJAssets = document.getElementById('modalSelectJJAssets');
  const btnCloseJJModal = document.getElementById('btnCloseJJModal');
  const btnCancelJJModal = document.getElementById('btnCancelJJModal');
  const btnProcessJJCapcut = document.getElementById('btnProcessJJCapcut');

  const jjVideoGrid = document.getElementById('jjVideoPickerGrid');
  const jjPhotoGrid = document.getElementById('jjPhotoPickerGrid');
  const jjSelectedVideoCount = document.getElementById('jjSelectedVideoCount');
  const jjSelectedPhotoCount = document.getElementById('jjSelectedPhotoCount');
  const jjAssetStatusHint = document.getElementById('jjAssetStatusHint');

  let selectedJJVideo = null;
  const selectedJJPhotos = [];

  function updateJJModalUI() {
    if (jjSelectedVideoCount) jjSelectedVideoCount.textContent = selectedJJVideo ? '1' : '0';
    if (jjSelectedPhotoCount) jjSelectedPhotoCount.textContent = selectedJJPhotos.length.toString();

    const isReady = selectedJJVideo && selectedJJPhotos.length === 3;
    if (btnProcessJJCapcut) {
      btnProcessJJCapcut.disabled = !isReady;
      btnProcessJJCapcut.style.opacity = isReady ? '1' : '0.5';
      btnProcessJJCapcut.style.cursor = isReady ? 'pointer' : 'not-allowed';
    }
    if (jjAssetStatusHint) {
      if (isReady) {
        jjAssetStatusHint.textContent = 'Aset lengkap! Siap diproses ke template CapCut.';
        jjAssetStatusHint.style.color = '#34d399';
      } else {
        jjAssetStatusHint.textContent = `Pilih 1 video (${selectedJJVideo ? '✓' : '0/1'}) dan 3 foto (${selectedJJPhotos.length}/3).`;
        jjAssetStatusHint.style.color = '#f87171';
      }
    }
  }

  async function openJJAssetPickerModal() {
    selectedJJVideo = null;
    selectedJJPhotos.length = 0;
    updateJJModalUI();

    if (modalSelectJJAssets) modalSelectJJAssets.style.display = 'flex';
    if (jjVideoGrid) jjVideoGrid.innerHTML = '<div class="app-loader">Memuat berkas video...</div>';
    if (jjPhotoGrid) jjPhotoGrid.innerHTML = '<div class="app-loader">Memuat berkas foto...</div>';

    try {
      const videos = (await window.electronAPI?.getSavedVideos?.()) || [];
      if (jjVideoGrid) {
        if (videos.length === 0) {
          jjVideoGrid.innerHTML = '<div style="grid-column: 1 / -1; color: #9d9c97; font-size: 11px; padding: 10px;">Belum ada video tersimpan. Render video melalui form terlebih dahulu.</div>';
        } else {
          jjVideoGrid.innerHTML = '';
          videos.slice(0, 16).forEach((vid) => {
            const card = document.createElement('div');
            card.style.cssText = 'position: relative; aspect-ratio: 9/16; border-radius: 6px; overflow: hidden; background: #000; border: 2px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s ease;';
            card.innerHTML = `
              ${videoThumbHtml(vid.filePath, vid.thumbnailPath, 'width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;')}
              <div style="position: absolute; bottom: 0; inset-inline: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); font-size: 9px; padding: 6px 4px 2px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${vid.fileName}
              </div>
            `;
            card.onclick = () => {
              selectedJJVideo = vid.filePath;
              jjVideoGrid.querySelectorAll('div').forEach((d) => d.style.borderColor = 'rgba(255,255,255,0.1)');
              card.style.borderColor = '#35b29f';
              updateJJModalUI();
            };
            jjVideoGrid.appendChild(card);
          });
          hydrateVideoThumbs(jjVideoGrid);
        }
      }

      let images = [];
      if (typeof window.electronAPI?.getSavedAiImages === 'function') {
        images = await window.electronAPI.getSavedAiImages();
      } else if (typeof window.electronAPI?.getGeneratedImages === 'function') {
        images = await window.electronAPI.getGeneratedImages();
      } else if (typeof window.electronAPI?.getStorageImages === 'function') {
        images = await window.electronAPI.getStorageImages();
      }

      if (jjPhotoGrid) {
        if (!images || images.length === 0) {
          jjPhotoGrid.innerHTML = '<div style="grid-column: 1 / -1; color: #9d9c97; font-size: 11px; padding: 10px;">Belum ada foto candid tersimpan.</div>';
        } else {
          jjPhotoGrid.innerHTML = '';
          images.slice(0, 24).forEach((img) => {
            const rawPath = img.filePath || img.path || (img.fileName ? `sessions/generated_images/${img.fileName}` : '');
            if (!rawPath) return;

            const card = document.createElement('div');
            card.style.cssText = 'position: relative; aspect-ratio: 9/16; border-radius: 6px; overflow: hidden; background: #000; border: 2px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s ease;';
            card.innerHTML = `<img src="${toSafeFileUrl(rawPath)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy">`;

            card.onclick = () => {
              const idx = selectedJJPhotos.indexOf(rawPath);
              if (idx > -1) {
                selectedJJPhotos.splice(idx, 1);
                card.style.borderColor = 'rgba(255,255,255,0.1)';
              } else {
                if (selectedJJPhotos.length < 3) {
                  selectedJJPhotos.push(rawPath);
                  card.style.borderColor = '#f0bb85';
                }
              }
              updateJJModalUI();
            };
            jjPhotoGrid.appendChild(card);
          });
        }
      }
    } catch (err) {
      console.error('Gagal memuat daftar aset JJ:', err);
    }
  }

  btnCreateJJCapcut?.addEventListener('click', openJJAssetPickerModal);
  btnCloseJJModal?.addEventListener('click', () => {
    if (modalSelectJJAssets) modalSelectJJAssets.style.display = 'none';
  });
  btnCancelJJModal?.addEventListener('click', () => {
    if (modalSelectJJAssets) modalSelectJJAssets.style.display = 'none';
  });
  modalSelectJJAssets?.addEventListener('click', (e) => {
    if (e.target === modalSelectJJAssets) modalSelectJJAssets.style.display = 'none';
  });

  btnProcessJJCapcut?.addEventListener('click', async () => {
    if (!selectedJJVideo || selectedJJPhotos.length !== 3) return;

    modalSelectJJAssets.style.display = 'none';

    const progressBox = document.getElementById('videoProgressBox');
    const statusTitle = document.getElementById('videoStatusTitle');
    const progressBar = document.getElementById('videoProgressBar');
    const logsBox = document.getElementById('videoLogs');

    if (progressBox) progressBox.style.display = 'block';
    if (statusTitle) statusTitle.textContent = 'Menghubungkan ke CapCut Web...';
    startVideoTimer();
    if (progressBar) progressBar.style.width = '10%';
    if (logsBox) {
      logsBox.innerHTML = `<div>[${new Date().toLocaleTimeString()}] Memulai otomasi CapCut Web (1 Video + 3 Foto)...</div>`;
    }

    try {
      const res = await window.electronAPI?.runCapCutTemplate?.({
        searchKeyword: 'JJ',
        videoPath: selectedJJVideo,
        candidPaths: selectedJJPhotos
      });

      stopVideoTimer(Boolean(res?.success));
      if (res?.success) {
        if (statusTitle) statusTitle.textContent = 'Video JJ Selesai!';
        if (progressBar) progressBar.style.width = '100%';
        alert(`Sukses! Video JJ berhasil diekspor dari CapCut:\n${res.videoPath || res.fileName}`);
        window.dispatchEvent(new CustomEvent('refresh-video-storage'));
      } else {
        alert('Gagal membuat video JJ di CapCut: ' + (res?.error || 'Terjadi kesalahan pada otomasi CapCut.'));
      }
    } catch (err) {
      stopVideoTimer(false);
      alert('Error CapCut: ' + err.message);
    }
  });

  // --- Shopee: kontrol status HP (ADB + Tap Server) ---
  async function refreshShopeeHpStatus() {
    const el = document.getElementById('shopeeHpStatusText');
    const btnSetup = document.getElementById('btnShopeeHpSetup');
    const btnWifi = document.getElementById('btnShopeeHpWifi');
    if (!el) return;
    el.textContent = 'Mengecek HP...';
    if (btnWifi) btnWifi.style.display = 'none';
    try {
      const s = await window.electronAPI.shopeeAdbStatus();
      if (!s || !s.connected) {
        el.innerHTML = s && s.savedIp
          ? `🔴 HP tidak ditemukan di WiFi (terakhir ${s.savedIp}). Pastikan HP menyala & di WiFi yang sama dengan PC. Kalau HP baru restart: colok USB → klik "Aktifkan WiFi".`
          : '🔴 HP tidak terhubung. Colok USB (USB debugging ON), lalu klik "Aktifkan WiFi" agar ke depannya tanpa kabel.';
        if (btnSetup) btnSetup.textContent = 'Siapkan HP';
        return;
      }
      // tombol Aktifkan WiFi hanya saat HP tercolok USB
      if (btnWifi && s.via === 'usb') btnWifi.style.display = '';
      const model = `${s.model || 'HP'} · ${s.via === 'wifi' ? '📶 WiFi ' + (s.device || '').split(':')[0] : '🔌 USB'}`;
      if (!s.shopee) { el.innerHTML = `🟠 ${model}: app Shopee belum terpasang.`; return; }
      if (!s.tapper) { el.innerHTML = `🟠 ${model}: Tap Server belum terpasang. Klik "Siapkan HP".`; if (btnSetup) btnSetup.textContent = 'Kirim APK'; return; }
      if (s.tapperState === 'crashed') {
        el.innerHTML = `🟠 ${model}: Tap Server dimatikan sistem HP. Di HP: Setelan > Aplikasi > Tap Server > Mulai otomatis ON & Penghemat baterai "Tidak ada batasan", lalu Aksesibilitas > Tap Server matikan-nyalakan lagi.`;
        return;
      }
      if (!s.enabled) { el.innerHTML = `🟠 ${model}: Tap Server belum aktif. Aktifkan di Setelan > Aksesibilitas > Tap Server.`; return; }
      el.innerHTML = `🟢 ${model} siap (${s.screen ? s.screen.width + 'x' + s.screen.height : ''}). Shopee login + Tap Server aktif.`;
    } catch (e) {
      el.textContent = 'Gagal cek HP: ' + e.message;
    }
  }
  let _shopeeHpWired = false;
  function setupShopeeHpControls() {
    if (_shopeeHpWired) return;
    _shopeeHpWired = true;
    document.getElementById('btnShopeeHpRefresh')?.addEventListener('click', () => refreshShopeeHpStatus());
    document.getElementById('btnShopeeHpWifi')?.addEventListener('click', async () => {
      const el = document.getElementById('shopeeHpStatusText');
      if (el) el.textContent = 'Mengaktifkan mode WiFi...';
      try {
        const r = await window.electronAPI.shopeeAdbEnableWifi();
        if (r && r.success) {
          if (el) el.innerHTML = `✅ Mode WiFi aktif (${r.ip}). Sekarang kabel USB boleh dicabut — HP tetap dicas & di WiFi yang sama.`;
          setTimeout(() => refreshShopeeHpStatus(), 4000);
        } else {
          if (el) el.textContent = r?.error || 'Gagal mengaktifkan WiFi.';
        }
      } catch (e) { if (el) el.textContent = 'Gagal: ' + e.message; }
    });
    document.getElementById('btnShopeeHpSetup')?.addEventListener('click', async () => {
      const el = document.getElementById('shopeeHpStatusText');
      try {
        const r = await window.electronAPI.shopeeAdbInstallTapper();
        if (r && r.success) { if (el) el.textContent = r.message; }
        else alert(r?.error || 'Gagal menyiapkan HP.');
      } catch (e) { alert('Gagal: ' + e.message); }
    });
  }

  // Sinkronisasi Antarmuka Platform
  async function syncPlatformUI() {
    const brandIconEl = document.getElementById('mainBrandIcon') || document.querySelector('.brand-icon');
    const tabShowcase = document.getElementById('tabShowcase');
    const btnSchedule = document.getElementById('btnSchedule');

    const flowBadgeInstagram = document.getElementById('flowBadgeInstagram');
    const flowBadgeTikTok = document.getElementById('flowBadgeTikTok');
    const containerInstagramForm = document.getElementById('containerInstagramVideoForm');
    const containerTikTokForm = document.getElementById('containerTikTokVideoForm');
    const wrapperCharKeyword = document.getElementById('wrapperVideoCharacterKeyword');

    try {
      const sessionInfo = await window.electronAPI?.getSessionInfo?.();
      const accountsData = await window.electronAPI?.getAllAccounts?.();
      const activeAcc = accountsData?.accounts?.find((a) => a.id === accountsData.activeAccountId) 
                     || accountsData?.accounts?.[0];

      const currentPlatform = String(activeAcc?.platform || sessionInfo?.platform || '').toLowerCase();
      const isTikTok = currentPlatform === 'tiktok';
      const isFacebook = currentPlatform === 'facebook';
      const isShopee = currentPlatform === 'shopee';

      // Tombol "Bagikan juga ke Facebook" di Buat Jadwal hanya untuk akun Instagram
      const shareRow = document.getElementById('rowShareToFacebook');
      const shareToggle = document.getElementById('toggleShareToFacebook');
      if (shareRow) shareRow.style.display = (!isTikTok && !isFacebook && !isShopee) ? 'flex' : 'none';
      if (shareToggle && !shareToggle.dataset.bound) {
        shareToggle.dataset.bound = '1';
        try { shareToggle.checked = localStorage.getItem('igShareToFacebook') !== '0'; } catch (e) { shareToggle.checked = true; }
        shareToggle.addEventListener('change', () => {
          try { localStorage.setItem('igShareToFacebook', shareToggle.checked ? '1' : '0'); } catch (e) {}
        });
      }

      // Kartu TikTok Shop Streamer (Pengaturan AI) hanya untuk akun TikTok
      const streamerCard = document.getElementById('cardTikTokStreamer');
      if (streamerCard) streamerCard.style.display = isTikTok ? '' : 'none';

      // Petunjuk jadwal sesuai platform
      const hintEl = document.getElementById('schedulePlatformHint');
      if (hintEl) {
        hintEl.innerHTML = isTikTok
          ? 'Video di-upload lebih awal & dijadwalkan langsung di TikTok. Biarkan aplikasi terbuka sampai status <b>Terjadwal di TikTok</b>, setelah itu PC boleh dimatikan.'
          : isShopee
            ? 'Akun Shopee aktif: posting otomatis Shopee Video sedang dikembangkan.'
          : isFacebook
            ? 'Reels di-upload lebih awal & dijadwalkan langsung di Facebook Page (Meta Business Suite). Biarkan aplikasi terbuka sampai status <b>Terjadwal di Facebook</b>, setelah itu PC boleh dimatikan. Hanya video (Reels).'
            : 'Postingan di-upload lebih awal & dijadwalkan langsung di Instagram (Schedule content, maks ±25 hari). Biarkan aplikasi terbuka sampai status <b>Terjadwal di Instagram</b>, setelah itu PC boleh dimatikan.';
      }

      if (brandIconEl) {
        if (!activeAcc) {
          // Belum ada akun → logo aplikasi
          brandIconEl.innerHTML = '<img src="assets/icon.ico" alt="AutoUpload" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">';
          brandIconEl.style.background = 'transparent';
          brandIconEl.style.border = 'none';
          brandIconEl.style.color = '';
        } else if (isShopee) {
          brandIconEl.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a4.5 4.5 0 0 0-4.47 4H4.2a1 1 0 0 0-1 1.07l.9 13.1A2 2 0 0 0 6.1 22h11.8a2 2 0 0 0 2-1.83l.9-13.1a1 1 0 0 0-1-1.07h-3.33A4.5 4.5 0 0 0 12 2zm0 1.8A2.7 2.7 0 0 1 14.65 6h-5.3A2.7 2.7 0 0 1 12 3.8zm.15 5.2c1.6 0 2.6.7 2.9 1.05l-.8 1.1c-.4-.33-1.15-.75-2.1-.75-.9 0-1.4.4-1.4.9 0 .6.7.85 1.75 1.2 1.5.5 2.85 1.1 2.85 2.8 0 1.6-1.35 2.8-3.4 2.8-1.6 0-2.85-.7-3.4-1.3l.85-1.15c.6.55 1.5 1.05 2.55 1.05 1.05 0 1.65-.5 1.65-1.15 0-.75-.75-1-1.85-1.4-1.4-.45-2.7-1.05-2.7-2.6 0-1.45 1.3-2.55 3.1-2.55z"/></svg>';
          brandIconEl.style.background = '#ee4d2d';
          brandIconEl.style.border = '1px solid rgba(255, 255, 255, 0.15)';
          brandIconEl.style.color = '#ffffff';
        } else if (isFacebook) {
          brandIconEl.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>';
          brandIconEl.style.background = '#1877f2';
          brandIconEl.style.border = '1px solid rgba(255, 255, 255, 0.15)';
          brandIconEl.style.color = '#ffffff';
        } else if (isTikTok) {
          brandIconEl.innerHTML = PLATFORM_BRAND_ICONS.tiktok;
          brandIconEl.style.background = '#000000';
          brandIconEl.style.border = '1px solid rgba(255, 255, 255, 0.15)';
          brandIconEl.style.color = '#ffffff';
        } else {
          brandIconEl.innerHTML = PLATFORM_BRAND_ICONS.instagram;
          brandIconEl.style.background = '';
          brandIconEl.style.border = '';
          brandIconEl.style.color = '';
        }
      }

      if (true) { // Semua platform (TikTok / Instagram / Facebook): Buat Video Reels selalu mulai dari Pilih Konsep
        if (flowBadgeInstagram) flowBadgeInstagram.style.display = 'none';
        if (flowBadgeTikTok) flowBadgeTikTok.style.display = 'flex';
        if (containerInstagramForm) containerInstagramForm.style.display = 'none';
        if (containerTikTokForm) containerTikTokForm.style.display = 'block';
        if (wrapperCharKeyword) wrapperCharKeyword.style.display = 'none';
        updateJJButtonVisibility();
      } else {
        if (flowBadgeInstagram) flowBadgeInstagram.style.display = 'flex';
        if (flowBadgeTikTok) flowBadgeTikTok.style.display = 'none';
        if (containerInstagramForm) containerInstagramForm.style.display = 'block';
        if (containerTikTokForm) containerTikTokForm.style.display = 'none';
        if (wrapperCharKeyword) wrapperCharKeyword.style.display = 'block';

        if (btnCreateJJCapcut) btnCreateJJCapcut.style.setProperty('display', 'none', 'important');
        if (btnFlowToJJFromStoryboard) btnFlowToJJFromStoryboard.style.setProperty('display', 'none', 'important');
        if (selectionView) selectionView.style.display = 'none';
        if (formView) formView.style.display = 'block';
      }

      if (tabShowcase) {
        if (isTikTok) {
          tabShowcase.style.setProperty('display', 'flex', 'important');
        } else {
          tabShowcase.style.setProperty('display', 'none', 'important');
          
          const viewShowcase = document.getElementById('viewShowcase');
          if (viewShowcase && viewShowcase.classList.contains('active-view')) {
            const tabSchedule = document.getElementById('tabSchedule');
            tabSchedule?.click();
          }
        }
      }

      // Auto Pilot dihapus di semua platform: jangan pernah tampil
      if (document.getElementById('viewAutoPilot')?.classList.contains('active-view')) {
        document.getElementById('tabSchedule')?.click();
      }

      // Shopee: input link produk + status HP; sembunyikan produk TikTok
      const wrapShopee = document.getElementById('wrapperScheduleShopee');
      if (wrapShopee) wrapShopee.style.display = isShopee ? 'block' : 'none';
      if (isShopee) {
        const wrapTtProduct = document.getElementById('wrapperScheduleTiktokProduct');
        if (wrapTtProduct) wrapTtProduct.style.display = 'none';
        setupShopeeHpControls();
        refreshShopeeHpStatus();
      }

      if (btnSchedule) {
        const spanText = btnSchedule.querySelector('span');
        if (spanText) {
          spanText.textContent = isTikTok
            ? 'Jadwalkan Postingan ke TikTok'
            : isShopee ? 'Jadwalkan Video ke Shopee'
            : isFacebook ? 'Jadwalkan Reels ke Facebook Page' : 'Jadwalkan Postingan ke Instagram';
        }
      }
    } catch (err) {
      console.warn('[Dashboard] Gagal sinkronisasi antarmuka platform:', err);
    }
  }

  await syncPlatformUI();
  window.addEventListener('load-feed', syncPlatformUI);
  window.addEventListener('refresh-schedules', syncPlatformUI);

  if (window.electronAPI?.onAccountsUpdated) {
    window.electronAPI.onAccountsUpdated(() => syncPlatformUI());
  }

  if (window.electronAPI?.onProfileUpdated) {
    window.electronAPI.onProfileUpdated(() => syncPlatformUI());
  }

  // Modal Galeri Instagram
  const imagePickerModal = document.getElementById('imagePickerModal');
  const imagePickerGrid = document.getElementById('imagePickerGrid');
  const btnCloseImagePickerModal = document.getElementById('btnCloseImagePickerModal');
  const btnCancelImagePickerModal = document.getElementById('btnCancelImagePickerModal');

  async function openGalleryPickerModal() {
    if (!imagePickerModal || !imagePickerGrid) return;
    imagePickerGrid.innerHTML = '<div class="app-loader">Memuat berkas galeri...</div>';
    imagePickerModal.style.display = 'flex';

    try {
      let images = [];
      if (window.electronAPI) {
        if (typeof window.electronAPI.getSavedAiImages === 'function') {
          images = await window.electronAPI.getSavedAiImages();
        } else if (typeof window.electronAPI.getGeneratedImages === 'function') {
          images = await window.electronAPI.getGeneratedImages();
        } else if (typeof window.electronAPI.getSavedImages === 'function') {
          images = await window.electronAPI.getSavedImages();
        } else if (typeof window.electronAPI.getStorageImages === 'function') {
          images = await window.electronAPI.getStorageImages();
        }
      }

      if (!images || images.length === 0) {
        const domGalleryImgs = document.querySelectorAll('#savedImagesGrid .storage-card img, #savedImagesGrid img');
        if (domGalleryImgs.length > 0) {
          images = Array.from(domGalleryImgs).map((img, idx) => ({
            filePath: img.getAttribute('src') || '',
            fileName: `Banner_${idx + 1}.png`
          }));
        }
      }

      if (!images || images.length === 0) {
        imagePickerGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0; font-size: 12.5px;">Belum ada gambar yang tersimpan di Galeri Gambar AI.</div>';
        return;
      }

      imagePickerGrid.innerHTML = '';
      images.forEach((img, idx) => {
        const rawPath = img.filePath || img.path || (img.fileName ? `sessions/generated_images/${img.fileName}` : '');
        if (!rawPath) return;

        const safeSrc = toSafeFileUrl(rawPath);
        const card = document.createElement('div');
        card.style.cssText = 'position: relative; width: 100%; height: 240px; border-radius: 10px; overflow: hidden; background: #1b1d20; border: 2px solid rgba(255, 255, 255, 0.08); cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: transform 0.15s ease, border-color 0.15s ease;';

        const displayName = img.fileName || decodeURIComponent(rawPath.split(/[/\\]/).pop().split('?')[0]) || `Banner_${idx + 1}`;

        card.innerHTML = `
          <img src="${safeSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy" onerror="this.style.display='none'">
          <div style="position: absolute; inset: auto 0 0 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); padding: 10px 8px; pointer-events: none;">
            <span style="display: block; font-size: 11px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
          </div>
        `;

        card.onmouseenter = () => {
          card.style.borderColor = '#e8a25c';
          card.style.transform = 'translateY(-2px)';
        };
        card.onmouseleave = () => {
          card.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          card.style.transform = 'translateY(0)';
        };

        card.onclick = () => {
          let realPath = rawPath;
          if (realPath.startsWith('file:///')) {
            realPath = decodeURIComponent(realPath.replace(/^file:\/\/\//, ''));
          }

          const targetInput = document.getElementById('selectedCustomImagePath');
          if (targetInput) {
            targetInput.value = displayName;
            targetInput.title = realPath;
            targetInput.dataset.fullPath = realPath;
          }

          window._selectedCustomBannerPath = realPath;

          if (imagePickerModal) {
            imagePickerModal.style.display = 'none';
          }
        };

        imagePickerGrid.appendChild(card);
      });
    } catch (err) {
      imagePickerGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px 0; font-size: 12.5px;">Gagal memuat galeri: ${err.message}</div>`;
    }
  }

  // Modal Showcase TikTok
  const showcasePickerModal = document.getElementById('showcasePickerModal');
  const showcaseProductsGrid = document.getElementById('showcaseProductsGrid');
  const showcaseImagesGrid = document.getElementById('showcaseImagesGrid');
  const showcaseModalTitle = document.getElementById('showcaseModalTitle');
  const showcaseModalSubtitle = document.getElementById('showcaseModalSubtitle');
  const showcaseModalFooterInfo = document.getElementById('showcaseModalFooterInfo');
  const btnBackToShowcaseProducts = document.getElementById('btnBackToShowcaseProducts');
  const btnCloseShowcasePickerModal = document.getElementById('btnCloseShowcasePickerModal');
  const btnCancelShowcasePickerModal = document.getElementById('btnCancelShowcasePickerModal');

  let loadedProductsForShowcase = [];

  function resetShowcaseModalState() {
    if (showcaseProductsGrid) showcaseProductsGrid.style.display = 'grid';
    if (showcaseImagesGrid) {
      showcaseImagesGrid.style.display = 'none';
      showcaseImagesGrid.innerHTML = '';
    }
    if (btnBackToShowcaseProducts) btnBackToShowcaseProducts.style.display = 'none';
    if (showcaseModalTitle) showcaseModalTitle.textContent = 'Pilih Produk dari Showcase';
    if (showcaseModalSubtitle) showcaseModalSubtitle.textContent = 'Klik salah satu produk untuk melihat foto lengkapnya';
    if (showcaseModalFooterInfo) showcaseModalFooterInfo.textContent = 'Klik salah satu produk';
  }

  async function openShowcasePickerModal() {
    if (!showcasePickerModal || !showcaseProductsGrid) return;
    resetShowcaseModalState();
    showcaseProductsGrid.innerHTML = '<div class="app-loader">Memuat produk etalase...</div>';
    showcasePickerModal.style.display = 'flex';

    try {
      const res = await window.electronAPI?.getTiktokShowcaseProducts?.(false);
      loadedProductsForShowcase = res?.data || [];

      if (!loadedProductsForShowcase || loadedProductsForShowcase.length === 0) {
        showcaseProductsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 50px 0; font-size: 12.5px;">Belum ada produk di etalase. Buka menu Showcase Produk lalu klik "Sinkronkan Etalase".</div>';
        return;
      }

      showcaseProductsGrid.innerHTML = '';
      loadedProductsForShowcase.forEach((item, idx) => {
        const cover = item.coverUrl || item.product_img || '';
        const title = item.product_title || item.title || `Produk #${idx + 1}`;
        const price = item.price || item.itemPrice || '-';
        const pid = item.id || item.productId || '';

        const card = document.createElement('div');
        card.style.cssText = 'position: relative; border-radius: 10px; overflow: hidden; background: #17191c; border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer; padding: 10px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s ease;';

        card.innerHTML = `
          <div style="width: 100%; aspect-ratio: 1/1; border-radius: 6px; overflow: hidden; background: #000;">
            <img src="${cover}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.src='https://placehold.co/200x200/181920/a78bfa?text=No+Cover'">
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #fff; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${title}</div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: #10b981; font-weight: 700;">
            <span>${price}</span>
            <span style="color: #f0bb85;">Pilih Foto →</span>
          </div>
        `;

        card.onmouseenter = () => { card.style.borderColor = '#35b29f'; card.style.transform = 'translateY(-2px)'; };
        card.onmouseleave = () => { card.style.borderColor = 'rgba(255, 255, 255, 0.1)'; card.style.transform = 'translateY(0)'; };

        card.onclick = () => {
          showProductImagesStep(item);
        };

        showcaseProductsGrid.appendChild(card);
      });
    } catch (err) {
      showcaseProductsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 50px 0; font-size: 12.5px;">Gagal memuat: ${err.message}</div>`;
    }
  }

  async function showProductImagesStep(product) {
    if (!showcaseProductsGrid || !showcaseImagesGrid) return;

    const pid = String(product.id || product.productId || '').trim();
    const cover = product.coverUrl || product.product_img || '';
    const title = product.product_title || product.title || 'Produk';
    const price = product.price || product.itemPrice || '-';

    showcaseProductsGrid.style.display = 'none';
    showcaseImagesGrid.style.display = 'grid';
    showcaseImagesGrid.innerHTML = '<div class="app-loader">Memuat galeri foto lengkap produk...</div>';

    if (btnBackToShowcaseProducts) btnBackToShowcaseProducts.style.display = 'inline-flex';
    if (showcaseModalTitle) showcaseModalTitle.textContent = title;
    if (showcaseModalSubtitle) showcaseModalSubtitle.textContent = 'Klik pada foto yang ingin Anda jadikan bahan video reels';
    if (showcaseModalFooterInfo) showcaseModalFooterInfo.textContent = 'Memuat gambar...';

    let photos = [];
    if (Array.isArray(product.images) && product.images.length > 1) {
      photos = product.images;
    } else {
      try {
        const res = await window.electronAPI?.getTikTokProductImages?.(pid);
        if (res?.success && Array.isArray(res.images) && res.images.length > 0) {
          photos = res.images;
          product.images = res.images;
        }
      } catch (e) {}
    }

    const allPhotos = Array.from(new Set([cover, ...photos])).filter(Boolean);

    showcaseImagesGrid.innerHTML = '';
    if (showcaseModalFooterInfo) showcaseModalFooterInfo.textContent = `${allPhotos.length} foto tersedia untuk produk ini`;

    allPhotos.forEach((imgUrl, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: #17191c; border: 2px solid rgba(255, 255, 255, 0.1); cursor: pointer; transition: all 0.2s ease;';

      card.innerHTML = `
        <img src="${imgUrl}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;">
        <span style="position: absolute; bottom: 0; left: 0; right: 0; background: ${i === 0 ? '#35b29f' : 'rgba(0,0,0,0.75)'}; font-size: 10px; font-weight: 700; color: #fff; text-align: center; padding: 3px 0;">
          ${i === 0 ? 'Cover Utama' : `Foto ${i + 1}`}
        </span>
      `;

      card.onmouseenter = () => { card.style.borderColor = '#10b981'; card.style.transform = 'scale(1.03)'; };
      card.onmouseleave = () => { card.style.borderColor = 'rgba(255, 255, 255, 0.1)'; card.style.transform = 'scale(1)'; };

      card.onclick = () => {
        applySelectedTikTokProduct(imgUrl, title, price, pid);
        showcasePickerModal.style.display = 'none';
      };

      showcaseImagesGrid.appendChild(card);
    });
  }

  function applySelectedTikTokProduct(imgUrl, title, price, pid) {
    const targetInput = document.getElementById('selectedTiktokProductPath');
    const thumbImg = document.getElementById('showcaseSelectedThumb');
    const emptyIcon = document.getElementById('showcaseSelectedEmpty');

    if (targetInput) {
      targetInput.value = `${title} (${price})`;
      targetInput.title = imgUrl;
      targetInput.dataset.fullPath = imgUrl;
      targetInput.dataset.productId = pid;
    }

    if (thumbImg) {
      thumbImg.src = imgUrl;
      thumbImg.style.display = 'block';
      if (emptyIcon) emptyIcon.style.display = 'none';
    }

    window._selectedCustomBannerPath = imgUrl;
  }

  btnBackToShowcaseProducts?.addEventListener('click', () => {
    resetShowcaseModalState();
  });

  const btnOpenGallery = document.getElementById('btnOpenGalleryPickerModal');
  const inputCustomImage = document.getElementById('selectedCustomImagePath');
  btnOpenGallery?.addEventListener('click', openGalleryPickerModal);
  inputCustomImage?.addEventListener('click', openGalleryPickerModal);

  const btnOpenShowcase = document.getElementById('btnOpenShowcasePickerModal');
  const inputTiktokProduct = document.getElementById('selectedTiktokProductPath');
  const thumbWrapShowcase = document.getElementById('showcaseSelectedThumbWrap');

  btnOpenShowcase?.addEventListener('click', openShowcasePickerModal);
  inputTiktokProduct?.addEventListener('click', openShowcasePickerModal);
  thumbWrapShowcase?.addEventListener('click', openShowcasePickerModal);

  btnCloseImagePickerModal?.addEventListener('click', () => {
    if (imagePickerModal) imagePickerModal.style.display = 'none';
  });
  btnCancelImagePickerModal?.addEventListener('click', () => {
    if (imagePickerModal) imagePickerModal.style.display = 'none';
  });
  imagePickerModal?.addEventListener('click', (e) => {
    if (e.target === imagePickerModal) imagePickerModal.style.display = 'none';
  });

  btnCloseShowcasePickerModal?.addEventListener('click', () => {
    if (showcasePickerModal) showcasePickerModal.style.display = 'none';
  });
  btnCancelShowcasePickerModal?.addEventListener('click', () => {
    if (showcasePickerModal) showcasePickerModal.style.display = 'none';
  });
  showcasePickerModal?.addEventListener('click', (e) => {
    if (e.target === showcasePickerModal) showcasePickerModal.style.display = 'none';
  });

  // Unggah Foto Karakter Model
  const btnUploadCharacter = document.getElementById('btnUploadCharacterPhoto');
  const inputCharacterPath = document.getElementById('selectedCharacterImagePath');
  const thumbWrapCharacter = document.getElementById('characterSelectedThumbWrap');
  const thumbImgCharacter = document.getElementById('characterSelectedThumb');
  const emptyIconCharacter = document.getElementById('characterSelectedEmpty');
  const btnClearCharacter = document.getElementById('btnClearCharacterPhoto');

  async function handleSelectCharacterFile() {
    try {
      const files = await window.electronAPI?.selectFiles?.();
      if (files && files.length > 0) {
        const filePath = files[0];
        const fileName = filePath.split(/[/\\]/).pop();

        if (inputCharacterPath) {
          inputCharacterPath.value = fileName;
          inputCharacterPath.title = filePath;
          inputCharacterPath.dataset.fullPath = filePath;
        }

        if (thumbImgCharacter) {
          thumbImgCharacter.src = toSafeFileUrl(filePath);
          thumbImgCharacter.style.display = 'block';
          if (emptyIconCharacter) emptyIconCharacter.style.display = 'none';
        }

        if (btnClearCharacter) {
          btnClearCharacter.style.display = 'inline-flex';
        }

        window._selectedCustomCharacterPath = filePath;
      }
    } catch (err) {
      console.warn('[Dashboard] Gagal memilih foto karakter:', err.message);
    }
  }

  btnUploadCharacter?.addEventListener('click', handleSelectCharacterFile);
  inputCharacterPath?.addEventListener('click', handleSelectCharacterFile);
  thumbWrapCharacter?.addEventListener('click', handleSelectCharacterFile);

  btnClearCharacter?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (inputCharacterPath) {
      inputCharacterPath.value = '';
      inputCharacterPath.title = '';
      delete inputCharacterPath.dataset.fullPath;
    }
    if (thumbImgCharacter) {
      thumbImgCharacter.src = '';
      thumbImgCharacter.style.display = 'none';
      if (emptyIconCharacter) emptyIconCharacter.style.display = 'block';
    }
    if (btnClearCharacter) {
      btnClearCharacter.style.display = 'none';
    }
    window._selectedCustomCharacterPath = null;
  });

  // Foto Referensi (Pinterest / File Lokal)
  const btnPasteReference = document.getElementById('btnPasteReferencePhoto');
  const btnUploadReference = document.getElementById('btnUploadReferencePhoto');
  const inputReferencePath = document.getElementById('selectedReferenceImagePath');
  const thumbWrapReference = document.getElementById('referenceSelectedThumbWrap');
  const thumbImgReference = document.getElementById('referenceSelectedThumb');
  const emptyIconReference = document.getElementById('referenceSelectedEmpty');
  const btnClearReference = document.getElementById('btnClearReferencePhoto');

  function setReferenceImageDisplay(filePath, fileName) {
    if (inputReferencePath) {
      inputReferencePath.value = fileName || filePath.split(/[/\\]/).pop();
      inputReferencePath.title = filePath;
      inputReferencePath.dataset.fullPath = filePath;
    }

    if (thumbImgReference) {
      thumbImgReference.src = toSafeFileUrl(filePath);
      thumbImgReference.style.display = 'block';
      if (emptyIconReference) emptyIconReference.style.display = 'none';
    }

    if (btnClearReference) {
      btnClearReference.style.display = 'inline-flex';
    }

    window._selectedCustomReferencePath = filePath;
  }

  async function handlePasteReferencePhoto() {
    try {
      const res = await window.electronAPI?.pasteImageFromClipboard?.();
      if (res?.success && res.filePath) {
        setReferenceImageDisplay(res.filePath, res.fileName);
      } else {
        alert(res?.error || 'Tidak ada data gambar di clipboard. Salin gambar dulu di Pinterest (Klik kanan > Copy Image).');
      }
    } catch (err) {
      console.warn('[Dashboard] Gagal mem-paste gambar referensi:', err.message);
    }
  }

  async function handleSelectReferenceFile() {
    try {
      const files = await window.electronAPI?.selectFiles?.();
      if (files && files.length > 0) {
        setReferenceImageDisplay(files[0]);
      }
    } catch (err) {
      console.warn('[Dashboard] Gagal memilih berkas referensi:', err.message);
    }
  }

  btnPasteReference?.addEventListener('click', handlePasteReferencePhoto);
  btnUploadReference?.addEventListener('click', handleSelectReferenceFile);
  inputReferencePath?.addEventListener('click', handlePasteReferencePhoto);
  thumbWrapReference?.addEventListener('click', handlePasteReferencePhoto);

  btnClearReference?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (inputReferencePath) {
      inputReferencePath.value = '';
      inputReferencePath.title = '';
      delete inputReferencePath.dataset.fullPath;
    }
    if (thumbImgReference) {
      thumbImgReference.src = '';
      thumbImgReference.style.display = 'none';
      if (emptyIconReference) emptyIconReference.style.display = 'block';
    }
    if (btnClearReference) {
      btnClearReference.style.display = 'none';
    }
    window._selectedCustomReferencePath = null;
  });

  window.addEventListener('paste', (e) => {
    const viewAiVideo = document.getElementById('viewAiVideo');
    if (viewAiVideo && viewAiVideo.classList.contains('active-view')) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id !== 'selectedReferenceImagePath') {
        return;
      }
      handlePasteReferencePhoto();
    }
  });

  // Tombol Folder Storyboard & Folder Video ditangani videoGenManager (jangan didaftarkan ulang di sini → folder terbuka 2x)

  // Modal Detail Storyboard
  const modalStoryboard = document.getElementById('storyboardDetailModal');
  const btnCloseStoryboard = document.getElementById('btnCloseStoryboardDetail');
  const btnOkStoryboard = document.getElementById('btnOkStoryboardDetail');
  const btnCopyPrompt = document.getElementById('btnCopyStoryboardModalPrompt');

  const closeStoryboardModal = () => {
    if (modalStoryboard) modalStoryboard.style.display = 'none';
  };

  btnCloseStoryboard?.addEventListener('click', closeStoryboardModal);
  btnOkStoryboard?.addEventListener('click', closeStoryboardModal);
  modalStoryboard?.addEventListener('click', (e) => {
    if (e.target === modalStoryboard) closeStoryboardModal();
  });

  btnCopyPrompt?.addEventListener('click', () => {
    const promptText = document.getElementById('storyboardDetailCaption')?.textContent || '';
    if (promptText) {
      navigator.clipboard.writeText(promptText);
      const originalText = btnCopyPrompt.textContent;
      btnCopyPrompt.textContent = '✓ Tersalin!';
      setTimeout(() => {
        btnCopyPrompt.textContent = originalText;
      }, 2000);
    }
  });

  // Modal Video Reels
  const modalVideo = document.getElementById('videoModal');
  const btnCloseVideo = document.getElementById('btnCloseVideoModal');
  const btnOkVideo = document.getElementById('btnOkVideoModal');
  const popupVideoPlayer = document.getElementById('popupVideoPlayer');
  const popupStoryboardImage = document.getElementById('popupStoryboardImage');
  const modalStoryboardPreviewWrapper = document.getElementById('modalStoryboardPreviewWrapper');
  const btnModalUseVideo = document.getElementById('btnModalUseVideo');

  let activeVideoPathForSchedule = '';

  const closeVideoPopup = () => {
    if (modalVideo) modalVideo.style.display = 'none';
    if (popupVideoPlayer) {
      popupVideoPlayer.pause();
      popupVideoPlayer.src = '';
    }
  };

  btnCloseVideo?.addEventListener('click', closeVideoPopup);
  btnOkVideo?.addEventListener('click', closeVideoPopup);
  modalVideo?.addEventListener('click', (e) => {
    if (e.target === modalVideo) closeVideoPopup();
  });

  btnModalUseVideo?.addEventListener('click', () => {
    if (activeVideoPathForSchedule) {
      window.dispatchEvent(new CustomEvent('insert-media-file', { detail: activeVideoPathForSchedule }));
      closeVideoPopup();
    }
  });

  const loadVideoGalleries = async () => {
    try {
      if (window.electronAPI?.getStoryboardHistory) {
        const sbData = await window.electronAPI.getStoryboardHistory();
        renderStoryboardFrames(sbData?.items || []);
      }
      if (window.electronAPI?.getSavedVideos) {
        const videoList = await window.electronAPI.getSavedVideos();
        renderSavedVideos(videoList || [], (selectedVideoPath, videoSrc, videoIndex, videoItem) => {
          activeVideoPathForSchedule = selectedVideoPath;
          if (modalVideo && popupVideoPlayer) {
            popupVideoPlayer.src = videoSrc;

            let originThumbSrc = '';
            if (videoItem && (videoItem.thumbnailPath || videoItem.poster)) {
              originThumbSrc = toSafeFileUrl(videoItem.thumbnailPath || videoItem.poster);
            }

            if (!originThumbSrc) {
              const baseName = (videoItem?.fileName || selectedVideoPath.split(/[/\\]/).pop()).replace(/\.[^.]+$/, '');
              const renderedFrames = Array.from(document.querySelectorAll('#storyboardFramesGrid img'));
              const matchedImg = renderedFrames.find((img) => (img.currentSrc || img.src || '').includes(baseName));
              if (matchedImg) {
                originThumbSrc = matchedImg.currentSrc || matchedImg.src;
              }
            }

            if (popupStoryboardImage && modalStoryboardPreviewWrapper) {
              if (originThumbSrc) {
                popupStoryboardImage.removeAttribute('alt');
                popupStoryboardImage.src = originThumbSrc;
                popupStoryboardImage.style.display = 'block';
                modalStoryboardPreviewWrapper.style.display = 'flex';
              } else {
                popupStoryboardImage.src = '';
                popupStoryboardImage.style.display = 'none';
                modalStoryboardPreviewWrapper.style.display = 'none';
              }
            }

            modalVideo.style.display = 'flex';
            popupVideoPlayer.play().catch(() => {});
          }
        });
      }
    } catch (e) {
      console.warn('[Dashboard] Gagal memuat data galeri video:', e.message);
    }
  };

  document.getElementById('tabVideoGallery')?.addEventListener('click', loadVideoGalleries);
  document.getElementById('tabAiVideo')?.addEventListener('click', loadVideoGalleries);
  window.addEventListener('refresh-video-storage', loadVideoGalleries);
  loadVideoGalleries();

  // Render Pipeline Video
  let isGeneratingVideo = false;
  const rawBtnRunReels = document.getElementById('btnRunFullReelsPipeline');
  let btnRunFullReelsPipeline = rawBtnRunReels;

  if (rawBtnRunReels && rawBtnRunReels.parentNode) {
    btnRunFullReelsPipeline = rawBtnRunReels.cloneNode(true);
    rawBtnRunReels.parentNode.replaceChild(btnRunFullReelsPipeline, rawBtnRunReels);
  }

  const WORKER_COUNT_KEY = 'tiktokWorkerCount';
  const workerButtons = document.querySelectorAll('.tiktok-worker-btn');
  const workerHint = document.getElementById('tiktokWorkerHint');
  const workerModeLabel = document.getElementById('tiktokWorkerModeLabel');
  function setWorkerCount(count) {
    const n = Math.min(2, Math.max(1, Number(count) || 1));
    const input = document.getElementById('tiktokWorkerCount');
    if (input) input.value = String(n);
    workerButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.workers) === n));
    if (workerModeLabel) workerModeLabel.textContent = `${n} Worker`;
    if (workerHint) workerHint.textContent = n === 1 ? '1 video per proses' : '2 video bersamaan · butuh 2 akun Flow berkredit';
    try { localStorage.setItem(WORKER_COUNT_KEY, String(n)); } catch (e) {}
  }
  function getSelectedWorkerCount() {
    return Math.min(2, Math.max(1, Number(document.getElementById('tiktokWorkerCount')?.value) || 1));
  }
  workerButtons.forEach((b) => b.addEventListener('click', () => setWorkerCount(b.dataset.workers)));
  try { setWorkerCount(localStorage.getItem(WORKER_COUNT_KEY) || 1); } catch (e) { setWorkerCount(1); }

  btnRunFullReelsPipeline?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (isGeneratingVideo) return;

    const containerTikTokForm = document.getElementById('containerTikTokVideoForm');
    const isTikTokFormActive = containerTikTokForm && window.getComputedStyle(containerTikTokForm).display !== 'none';

    const sessionInfo = await window.electronAPI?.getSessionInfo?.();
    const accountsData = await window.electronAPI?.getAllAccounts?.();
    const activeAcc = accountsData?.accounts?.find((a) => a.id === accountsData.activeAccountId) 
                   || accountsData?.accounts?.[0];

    const currentPlatform = isTikTokFormActive 
      ? 'tiktok' 
      : String(activeAcc?.platform || sessionInfo?.platform || 'instagram').toLowerCase();

    const isTikTok = currentPlatform === 'tiktok';

    let bannerPath = '';
    let characterPath = '';
    let referencePath = '';

    // 3D Edukasi tidak memakai foto produk / karakter (naskah & visual dibuat AI dari topik)
    const isEdu3D = isTikTok && currentReelsConcept === 'edu3d';
    // 3D Kartun juga tanpa foto: karakter Dodo & Bongo dan dunianya digambar mesin 3D lokal
    // 3D Cara Kerja: mesin & pipeline yang sama dengan 3D Kartun (mode narator)
    const isKartun3D = isTikTok && (currentReelsConcept === 'kartun3d' || currentReelsConcept === 'carakerja3d');
    const kartunState = isKartun3D ? getKartun3DState(currentReelsConcept) : null;
    // Antrian naskah: tiap item = 1 video, dibuat berurutan
    const kartunQueue = kartunState?.source === 'queue' ? kartunState.queue : [];
    if (isKartun3D && kartunState.source === 'queue' && !kartunQueue.length) {
      alert('Antrian naskah masih kosong. Tempel JSON lalu klik "Tambah ke Antrian".');
      return;
    }
    if (isKartun3D && kartunState.source === 'json' && !kartunState.spec) {
      alert('Tempel JSON naskah yang valid terlebih dahulu.');
      return;
    }
    if (isTikTok && !isEdu3D && !isKartun3D) {
      const isJJ = currentReelsConcept === 'jj';
      const suffix = { daster: 'Daster', sensasi: 'Sensasi', pov: 'Pov' }[currentReelsConcept] || 'JJ';

      const productInput = document.getElementById(`selectedTiktokProductPath${suffix}`);

      const characterInput = document.getElementById(`selectedCharacterImagePath${suffix}`);

      const referenceInput = document.getElementById(
        'selectedReferenceImagePathJJ'
      );

      bannerPath = productInput?.dataset?.fullPath || '';
      characterPath = characterInput?.dataset?.fullPath || '';
      // Foto referensi Pinterest hanya untuk konsep JJ
      referencePath = isJJ ? (referenceInput?.dataset?.fullPath || '') : '';

      if (!bannerPath) {
        alert('Silakan pilih Foto Produk Showcase TikTok terlebih dahulu!');
        return;
      }
      if (!characterPath) {
        alert(currentReelsConcept === 'pov' ? 'Silakan pilih foto background / latar terlebih dahulu!' : 'Silakan upload foto karakter model Karuna terlebih dahulu!');
        return;
      }
      if (isJJ && !referencePath) {
        alert('Silakan salin foto pose referensi dari Pinterest lalu klik Paste Gambar!');
        return;
      }
    } else if (!isTikTok) {
      bannerPath = window._selectedCustomBannerPath || document.getElementById('selectedCustomImagePath')?.dataset?.fullPath || '';
      const bannerSource = document.getElementById('videoBannerSource')?.value || 'select_image';

      if (bannerSource === 'select_image' && !bannerPath) {
        alert('Silakan pilih gambar banner dari galeri terlebih dahulu!');
        return;
      }
    }

    const durSelectEl = isTikTok 
      ? document.getElementById('tiktokFlowDurationSelect')
      : document.getElementById('flowDurationSelect');
    const durText = durSelectEl?.options?.[durSelectEl.selectedIndex]?.text || durSelectEl?.value || '8 Detik';
    const durMatch = durText.match(/\d+/);
    const parsedDuration = durMatch ? `${durMatch[0]} Detik` : '8 Detik';

    const payload = {
      platform: currentPlatform,
      concept: isTikTok ? currentReelsConcept : 'instagram_standard',
      prompt: document.getElementById('videoPromptInput')?.value || '',
      bannerSource: isTikTok ? 'select_showcase' : (document.getElementById('videoBannerSource')?.value || 'select_image'),
      bannerImagePath: bannerPath,
      customCharacterPath: characterPath,
      referenceImagePath: referencePath,
      aspectRatio: isTikTok 
        ? (document.getElementById('tiktokVideoAspectRatio')?.value || '9:16')
        : (document.getElementById('videoAspectRatio')?.value || '9:16'),
      storyboardType: isTikTok ? '1' : (document.getElementById('videoStoryboardType')?.value || '1'),
      videoType: 'Bahan',
      model: isTikTok
        ? (document.getElementById('tiktokFlowModelSelect')?.value || 'Veo 3.1 - Lite')
        : (document.getElementById('flowModelSelect')?.value || 'Omni 1.1 Flash'),
      resolution: isTikTok
        ? (document.getElementById('tiktokFlowResolutionSelect')?.value || '720p')
        : (document.getElementById('flowResolutionSelect')?.value || '720p'),
      duration: parsedDuration,
      // Nama parameter yang dibaca pipeline Flow (Daster/JJ)
      flowRatio: isTikTok
        ? (document.getElementById('tiktokVideoAspectRatio')?.value || '9:16')
        : (document.getElementById('videoAspectRatio')?.value || '9:16'),
      flowModel: isTikTok
        ? (document.getElementById('tiktokFlowModelSelect')?.value || 'Veo 3.1 - Lite')
        : (document.getElementById('flowModelSelect')?.value || 'Omni 1.1 Flash'),
      flowResolution: isTikTok
        ? (document.getElementById('tiktokFlowResolutionSelect')?.value || '720p')
        : (document.getElementById('flowResolutionSelect')?.value || '720p'),
      flowDuration: parsedDuration,
      flowOutputCount: isTikTok ? (document.getElementById('tiktokFlowOutputCountSelect')?.value || '1') : '1',
      dasterClothingMode: document.querySelector('input[name="dasterClothingMode"]:checked')?.value === 'convert' ? 'convert' : 'original',
      sensasiPose: document.getElementById('sensasiPoseSelect')?.value || 'random',
      // POV Tangan: slot "karakter" berisi foto background
      backgroundImagePath: currentReelsConcept === 'pov' ? characterPath : '',
      povVoice: document.getElementById('povVoiceSelect')?.value || 'cewek',
      // 3D Edukasi: topik (diisi AI / manual) & jumlah adegan (suara narator dikunci di layanan)
      eduTopic: document.getElementById('edu3dTopicInput')?.value?.trim() || '',
      eduSceneCount: Number(document.getElementById('edu3dSceneCount')?.value) || 3,
      // 3D Kartun: topik (kosong = otomatis) & target durasi
      kartunTopic: document.getElementById('kartun3dTopicInput')?.value?.trim() || '',
      kartunDuration: Number(document.getElementById('kartun3dDuration')?.value) || 80,
      // Mode "Tempel JSON": naskah jadi dari claude.ai (sudah divalidasi) → tahap naskah AI dilewati
      kartunSpec: kartunState?.spec || null,
      voiceEngine: kartunState?.voiceEngine || 'gemini',
      geminiVoice: kartunState?.geminiVoice || 'Charon',
      batchCount: isTikTok ? '1' : (document.getElementById('videoBatchCount')?.value || '1'),
      characterKeyword: isTikTok ? '' : (document.getElementById('videoCharacterKeyword')?.value || 'wanita')
    };

    isGeneratingVideo = true;
    btnRunFullReelsPipeline.disabled = true;
    btnRunFullReelsPipeline.dataset.busy = '1';
    const oriHtml = btnRunFullReelsPipeline.innerHTML;
    btnRunFullReelsPipeline.innerHTML = '<span>Memproses Pipeline AI Video...</span>';

    const progressBox = document.getElementById('videoProgressBox');
    const statusTitle = document.getElementById('videoStatusTitle');
    const progressBar = document.getElementById('videoProgressBar');
    const logsBox = document.getElementById('videoLogs');

    if (progressBox) progressBox.style.display = 'block';
    const conceptLabel = String(currentReelsConcept || 'jj').toUpperCase();
    if (logsBox) logsBox.innerHTML = `<div>Memulai pipeline video ${currentPlatform.toUpperCase()} [${conceptLabel}] (${parsedDuration})...</div>`;

    // Log progres ditangani listener global di videoGenManager (agar tidak dobel)
    startVideoTimer();

    try {
      // Multi-worker: tiap worker membuat 1 video dengan bahan yang sama secara bersamaan.
      // Worker berikutnya mulai 2 detik kemudian (cukup agar Chrome ChatGPT tidak dibuka di detik yang sama).
      // 3D Edukasi membuat 3 klip Flow berurutan per video → selalu 1 worker
      const workerCount = isTikTok && !isEdu3D && !isKartun3D ? getSelectedWorkerCount() : 1;
      // Loop: video dibuat berulang dengan bahan & setelan yang sama (pelanggan tidak perlu input ulang)
      // Tempel JSON 3D Kartun: 1 JSON = 1 video (loop dimatikan)
      const loopCount = kartunQueue.length ? kartunQueue.length
        : isTikTok && !payload.kartunSpec ? Math.min(20, Math.max(1, Number(document.getElementById('reelsLoopCount')?.value) || 1)) : 1;
      // Log per worker: videoGenManager menyiapkan panel W1/W2 terpisah bila lebih dari 1 worker
      window.dispatchEvent(new CustomEvent('video-workers-start', { detail: { count: workerCount } }));

      const results = [];
      // Tombol Batalkan menghentikan loop (juga saat jeda antar video)
      let loopCancelled = false;
      const onCancelRequested = () => { loopCancelled = true; };
      window.addEventListener('video-cancel-requested', onCancelRequested);
      for (let round = 1; round <= loopCount && !loopCancelled; round++) {
        // Jeda antar video: beri waktu Chrome sebelumnya tertutup tuntas & hindari deteksi "terlalu sering" ChatGPT/Flow
        if (round > 1) {
          for (let s = LOOP_PAUSE_SEC; s > 0 && !loopCancelled; s--) {
            if (statusTitle) statusTitle.textContent = `Jeda ${s} dtk sebelum video ${round} dari ${loopCount}...`;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (loopCancelled) {
            results.push({ success: false, cancelled: true, error: 'Dibatalkan pengguna' });
            break;
          }
        }
        if (loopCount > 1) {
          if (statusTitle) statusTitle.textContent = `Video ${round} dari ${loopCount}...`;
          if (logsBox) {
            const line = document.createElement('div');
            line.style.cssText = 'color:#6fcdbd;font-weight:700;margin-top:6px;';
            line.textContent = `── Loop video ${round}/${loopCount} ──`;
            logsBox.appendChild(line);
            logsBox.scrollTop = logsBox.scrollHeight;
          }
        }
        // 3D Edukasi: video ke-2 dst. memakai topik baru dari AI (topik form hanya untuk video pertama)
        const queueItem = kartunQueue[round - 1] || null;
        const roundPayload = queueItem ? { ...payload, kartunSpec: queueItem.spec }
          : isEdu3D && round > 1 ? { ...payload, eduTopic: '' }
          : isKartun3D && round > 1 ? { ...payload, kartunTopic: '' } : payload;
        const runs = Array.from({ length: workerCount }, (_, i) => (async () => {
          if (i > 0) await new Promise((r) => setTimeout(r, i * 2000));
          return window.electronAPI?.generateAiVideo?.({ ...roundPayload, workerId: i + 1, workerCount });
        })());
        const settled = await Promise.allSettled(runs);
        const roundResults = settled.map((r) => (r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }));
        results.push(...roundResults);
        // Naskah antrian yang berhasil jadi video dikeluarkan dari antrian
        if (queueItem && roundResults.some((r) => r?.success)) removeKartunQueueItem(currentReelsConcept, queueItem.id);
        // Video yang sudah jadi langsung tampil di Galeri Video (tidak menunggu semua loop selesai)
        const savedNow = roundResults.filter((r) => r?.success);
        if (savedNow.length) {
          window.dispatchEvent(new CustomEvent('refresh-video-storage'));
          if (logsBox) {
            const line = document.createElement('div');
            line.style.cssText = 'color:#34d399;font-weight:700;';
            line.textContent = `✓ Video ${round}${loopCount > 1 ? '/' + loopCount : ''} tersimpan di folder lokal: ${savedNow.map((r) => r.fileName || '').join(', ')}`;
            logsBox.appendChild(line);
            logsBox.scrollTop = logsBox.scrollHeight;
          }
        }
        // Berhenti bila dibatalkan atau kredit Flow habis; kegagalan lain → lanjut ke video berikutnya
        if (roundResults.some((r) => r?.cancelled)) break;
        if (!roundResults.some((r) => r?.success) && roundResults.some((r) => r?.code === 'INSUFFICIENT_FLOW_CREDIT')) break;
      }
      window.removeEventListener('video-cancel-requested', onCancelRequested);

      const okCount = results.filter((r) => r?.success).length;
      const totalPlanned = loopCount * workerCount;
      const res = results.find((r) => r?.success) || results.find((r) => r?.cancelled) || results.find((r) => r?.code === 'INSUFFICIENT_FLOW_CREDIT') || results[0];
      if (res?.success) {
        const elapsed = stopVideoTimer(true);
        if (statusTitle) statusTitle.textContent = 'Render Video Selesai!';
        if (progressBar) progressBar.style.width = '100%';
        const failed = results.filter((r) => !r?.success);
        alert(totalPlanned > 1
          ? `${okCount} dari ${totalPlanned} video Reels ${currentPlatform.toUpperCase()} [${conceptLabel}] selesai dalam ${elapsed}.${failed.length ? '\n\nGagal / berhenti: ' + failed.map((r) => r?.error || 'kesalahan sistem').join(' | ') : ''}`
          : `Berhasil! Video Reels ${currentPlatform.toUpperCase()} [${conceptLabel}] selesai dibuat dalam ${elapsed}.`);
        // Refresh aplikasi agar form bersih, lalu kembali ke konsep & setelan Flow yang sama
        try {
          sessionStorage.setItem(REELS_REOPEN_KEY, JSON.stringify({
            concept: isTikTok ? currentReelsConcept : '',
            selects: Object.fromEntries(REELS_KEPT_SELECTS.map((id) => [id, document.getElementById(id)?.value]))
          }));
        } catch (e) {}
        window.location.reload();
        return;
      } else if (results.some((r) => r?.cancelled)) {
        // Dibatalkan lewat tombol Batalkan: tidak perlu pesan gagal
        stopVideoTimer(false);
        if (statusTitle) statusTitle.textContent = 'Proses dibatalkan';
      } else if (res?.code === 'INSUFFICIENT_FLOW_CREDIT') {
        stopVideoTimer(false);
        if (statusTitle) statusTitle.textContent = 'Kredit Google Flow tidak cukup';
        alert('' + res.error);
      } else {
        stopVideoTimer(false);
        alert('Gagal: ' + (res?.error || 'Terjadi kesalahan sistem.'));
      }
    } catch (err) {
      stopVideoTimer(false);
      alert('Error: ' + err.message);
    } finally {
      isGeneratingVideo = false;
      btnRunFullReelsPipeline.disabled = false;
      delete btnRunFullReelsPipeline.dataset.busy;
      btnRunFullReelsPipeline.innerHTML = oriHtml;
    }
  });

  if (window.electronAPI?.onRefreshImagesGallery) {
    window.electronAPI.onRefreshImagesGallery(() => {
      window.dispatchEvent(new CustomEvent('refresh-image-storage'));
    });
  }

  if (window.electronAPI?.onRefreshStoryboardGallery) {
    window.electronAPI.onRefreshStoryboardGallery(() => {
      window.dispatchEvent(new CustomEvent('refresh-video-storage'));
    });
  }

  if (window.electronAPI?.onRefreshVideoGallery) {
    window.electronAPI.onRefreshVideoGallery(() => {
      window.dispatchEvent(new CustomEvent('refresh-video-storage'));
    });
  }

  const btnSwitchPlatform = document.getElementById('btnSwitchPlatform');
  btnSwitchPlatform?.addEventListener('click', () => {
    if (window.electronAPI && typeof window.electronAPI.switchPlatform === 'function') {
      window.electronAPI.switchPlatform();
    } else if (window.electronAPI && typeof window.electronAPI.navigateToSelectAccount === 'function') {
      window.electronAPI.navigateToSelectAccount();
    }
  });

  const btnLogout = document.getElementById('btnLogout');
  btnLogout?.addEventListener('click', async () => {
    if (confirm('Apakah Anda yakin ingin keluar dari akun ini?')) {
      if (window.electronAPI && typeof window.electronAPI.logout === 'function') {
        await window.electronAPI.logout();
      }
    }
  });
}

// Inisialisasi aman: langsung jalan tanpa bergantung pada penundaan DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboardApp);
} else {
  initDashboardApp();
}

// Helper Render UI Storyboard Frames
function renderStoryboardFrames(items) {
  const container = document.getElementById('storyboardFramesGrid');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); font-size: 13px; padding: 25px 0;">
        Belum ada frame storyboard yang ditarik.
      </div>`;
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const fileSrc = `file:///${item.path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    return `
      <div class="storage-card">
        <img src="${fileSrc}" alt="Storyboard" style="width: 100%; height: 100%; object-fit: cover;">
        
        <div class="storage-card-overlay">
          <div style="display: flex; justify-content: flex-end;">
            <button type="button" class="btn-action-delete btn-del-storyboard" data-path="${item.path}" title="Hapus Storyboard">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
          <button type="button" class="btn-action-primary btn-preview-storyboard" data-index="${index}">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            <span>Pratinjau & Prompt</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-preview-storyboard').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-index'));
      const item = items[idx];
      if (!item) return;

      const modal = document.getElementById('storyboardDetailModal');
      const img = document.getElementById('storyboardDetailImage');
      const caption = document.getElementById('storyboardDetailCaption');

      if (img) img.src = `file:///${item.path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
      if (caption) caption.textContent = item.promptText || '(Prompt video tidak ditemukan)';
      if (modal) modal.style.display = 'flex';
    });
  });

  container.querySelectorAll('.btn-del-storyboard').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetPath = btn.getAttribute('data-path');
      if (confirm('Hapus frame storyboard beserta berkas proyek ini?')) {
        await window.electronAPI?.deleteStoryboardFrame?.(targetPath);
        window.dispatchEvent(new CustomEvent('refresh-video-storage'));
      }
    });
  });
}

// Helper Render UI Video Jadi
function renderSavedVideos(videos, onPlayCallback) {
  const container = document.getElementById('savedVideosGrid');
  const countBadge = document.getElementById('videoStorageCountBadge');
  if (countBadge) countBadge.textContent = `(${videos.length} Berkas)`;
  if (!container) return;

  if (!videos || videos.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); font-size: 13px; padding: 30px 0;">
        Belum ada berkas video yang dibuat.
      </div>`;
    return;
  }

  container.innerHTML = videos.map((v, index) => {
    const fileSrc = `file:///${v.filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    return `
      <div class="storage-card">
        ${videoThumbHtml(v.filePath, v.thumbnailPath)}

        <div class="storage-card-overlay">
          <div style="display: flex; justify-content: flex-end;">
            <button type="button" class="btn-action-delete btn-del-video" data-path="${v.filePath}" data-file="${v.fileName}" title="Hapus Video">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
          <button type="button" class="btn-action-primary btn-play-video" data-index="${index}" data-src="${fileSrc}" data-path="${v.filePath}">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <span>Putar Video</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-play-video').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoSrc = btn.getAttribute('data-src');
      const videoPath = btn.getAttribute('data-path');
      const videoIndex = Number(btn.getAttribute('data-index') || 0);
      const videoItem = videos[videoIndex] || null;

      if (typeof onPlayCallback === 'function') {
        onPlayCallback(videoPath, videoSrc, videoIndex, videoItem);
      }
    });
  });

  container.querySelectorAll('.btn-del-video').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filePath = btn.getAttribute('data-path');
      const fileName = btn.getAttribute('data-file');
      if (confirm(`Hapus video ${fileName}?`)) {
        await window.electronAPI?.deleteSavedVideo?.({ filePath, fileName });
        window.dispatchEvent(new CustomEvent('refresh-video-storage'));
      }
    });
  });

  // buat thumbnail yang belum ada (berurutan, di belakang layar)
  hydrateVideoThumbs(container);
}