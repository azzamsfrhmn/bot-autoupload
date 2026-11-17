/**
 * src/renderer/js/modules/scheduleManager.js
 * Manajemen Form Penjadwalan Postingan dan Antrean Tabel Multi-Platform (Instagram & TikTok Web)
 */

let selectedMediaFiles = [];
let currentSchedulesCache = [];
let loadedShowcaseProducts = [];

import { videoThumbHtml, hydrateVideoThumbs } from './videoThumbs.js';

export function getSelectedMediaFiles() {
  return selectedMediaFiles;
}

export function clearSelectedMediaFiles() {
  selectedMediaFiles = [];
  updateMediaPreviews();
}

// Fungsi bantu menampilkan alert status
// Video sudah diunggah lebih awal & jam postingnya belum tiba (dijadwalkan oleh TikTok sendiri)
function isTikTokScheduledAhead(item) {
  const flagged = item.tiktokScheduled || /terjadwal di tiktok/i.test(item.remoteMessage || '');
  return Boolean(flagged) && new Date(item.scheduleTime).getTime() > Date.now();
}

const platformName = (item) => ({ facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', shopee: 'Shopee' })[String(item.platform || '').toLowerCase()] || 'TikTok';

function setStatus(text, type = 'success') {
  const statusAlert = document.getElementById('statusAlert');
  if (!statusAlert) return;
  statusAlert.style.display = 'block';
  statusAlert.className = `alert-card ${type === 'error' ? 'alert-error' : 'alert-success'}`;
  statusAlert.innerHTML = text;
  setTimeout(() => {
    statusAlert.style.display = 'none';
  }, 7000);
}

// ------------------------------------------------------------------ Log Posting (kartu terpisah)
const POST_LOG_KEY = 'postLogEntries';
const POST_LOG_MAX = 200;
let postLogEntries = [];
try { postLogEntries = JSON.parse(localStorage.getItem(POST_LOG_KEY) || '[]'); } catch (e) { postLogEntries = []; }
const escLog = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOG_BADGE = { running: ['BERJALAN', 'run'], success: ['SUKSES', 'ok'], failed: ['GAGAL', 'err'], pending: ['MENUNGGU', 'wait'], info: ['INFO', 'run'] };

function renderPostLog() {
  const list = document.getElementById('postLogList');
  if (!list) return;
  if (!postLogEntries.length) { list.innerHTML = '<div class="post-log-empty">Belum ada aktivitas posting.</div>'; return; }
  list.innerHTML = postLogEntries.map((e) => {
    const [label, cls] = LOG_BADGE[e.status] || LOG_BADGE.info;
    const warn = /peringatan|gagal|error/i.test(e.message) && e.status !== 'success' ? ' warn' : '';
    return `<div class="post-log-row${warn}"><span class="post-log-time">${escLog(e.time)}</span><span class="post-log-badge ${cls}">${label}</span><span class="post-log-msg">${escLog(e.message)}</span></div>`;
  }).join('');
  const live = document.getElementById('postLogLive');
  if (live) live.classList.toggle('on', postLogEntries[0]?.status === 'running' && Date.now() - (postLogEntries[0]?.at || 0) < 5 * 60 * 1000);
}

function addPostLog(status, message) {
  if (!message) return;
  const now = new Date();
  postLogEntries.unshift({ at: now.getTime(), time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), status: status || 'info', message: String(message) });
  postLogEntries = postLogEntries.slice(0, POST_LOG_MAX);
  try { localStorage.setItem(POST_LOG_KEY, JSON.stringify(postLogEntries)); } catch (e) {}
  renderPostLog();
  // Posting berhasil / terjadwal → bersihkan log langkah-langkah otomatis, sisakan baris hasilnya saja
  if (status === 'success') {
    const done = postLogEntries[0];
    clearTimeout(addPostLog._clearTimer);
    addPostLog._clearTimer = setTimeout(() => {
      if (postLogEntries[0] !== done) return; // sudah ada posting baru berjalan → jangan dihapus
      postLogEntries = [done];
      try { localStorage.setItem(POST_LOG_KEY, JSON.stringify(postLogEntries)); } catch (e) {}
      renderPostLog();
    }, 4000);
  }
}

// Format URL berkas lokal yang aman
function getFileUrl(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('file://')) return filePath;
  return `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

// Memperbarui pratinjau media dan mendeteksi mode otomatis (TikTok Video vs Instagram Feed)
export async function updateMediaPreviews() {
  const mediaPreviewContainer = document.getElementById('mediaPreviewContainer');
  const mediaCounterBadge = document.getElementById('mediaCounterBadge');
  const btnSchedule = document.getElementById('btnSchedule');
  const wrapperTiktokProduct = document.getElementById('wrapperScheduleTiktokProduct');
  if (!mediaPreviewContainer) return;

  mediaPreviewContainer.innerHTML = '';

  let currentPlatform = 'instagram';
  try {
    const sessionInfo = await window.electronAPI?.getSessionInfo?.();
    if (sessionInfo?.platform) currentPlatform = sessionInfo.platform;
  } catch (e) {}

  const isTikTok = currentPlatform === 'tiktok';
  const hasVideo = selectedMediaFiles.some((f) => /\.(mp4|mov|webm|mkv)$/i.test(f));
  document.dispatchEvent(new CustomEvent('schedule-media-changed'));

  // Tampilkan input produk keranjang kuning & pilihan konsep hanya jika mode TikTok
  if (wrapperTiktokProduct) {
    wrapperTiktokProduct.style.display = isTikTok ? 'block' : 'none';
  }
  const wrapperConcept = document.getElementById('wrapperScheduleConcept');
  if (wrapperConcept) wrapperConcept.style.display = isTikTok ? 'block' : 'none';

  // Penyesuaian Badge Pintar
  if (mediaCounterBadge) {
    if (selectedMediaFiles.length === 0) {
      mediaCounterBadge.textContent = '0 File Dipilih';
      mediaCounterBadge.style.background = '';
      mediaCounterBadge.style.color = '';
      mediaCounterBadge.style.borderColor = '';
    } else if (isTikTok && hasVideo) {
      mediaCounterBadge.textContent = 'Mode Unggah: Video TikTok';
      mediaCounterBadge.style.background = 'rgba(232, 162, 92, 0.15)';
      mediaCounterBadge.style.color = '#f0bb85';
      mediaCounterBadge.style.borderColor = 'rgba(232, 162, 92, 0.3)';
    } else if (isTikTok && !hasVideo) {
      mediaCounterBadge.textContent = `${selectedMediaFiles.length} Foto (Mode Unggah Foto TikTok)`;
      mediaCounterBadge.style.background = 'rgba(232, 162, 92, 0.15)';
      mediaCounterBadge.style.color = '#f0bb85';
      mediaCounterBadge.style.borderColor = 'rgba(232, 162, 92, 0.3)';
    } else {
      mediaCounterBadge.textContent = `${selectedMediaFiles.length} File Dipilih ${selectedMediaFiles.length > 1 ? '(Carousel Instagram)' : ''}`;
      mediaCounterBadge.style.background = 'rgba(53, 178, 159, 0.15)';
      mediaCounterBadge.style.color = '#6fcdbd';
      mediaCounterBadge.style.borderColor = 'rgba(53, 178, 159, 0.3)';
    }
  }

  // Penyesuaian Label Tombol Posting Sesuai Platform & Konten
  if (btnSchedule) {
    const labelSpan = btnSchedule.querySelector('span');
    if (labelSpan) {
      if (isTikTok) {
        labelSpan.textContent = 'Jadwalkan Postingan ke TikTok';
      } else {
        labelSpan.textContent = 'Jadwalkan Postingan ke Instagram';
      }
    }
  }

  selectedMediaFiles.forEach((filePath, index) => {
    const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(filePath);
    const item = document.createElement('div');
    item.className = 'media-preview-item';

    const fileSrc = getFileUrl(filePath);

    if (isVideo) {
      item.innerHTML = `
        <video src="${fileSrc}" muted></video>
        <span class="preview-type-badge" style="${isTikTok ? 'background: #e8a25c;' : ''}">VIDEO</span>
        <button type="button" class="btn-remove-media" data-index="${index}" title="Hapus file">×</button>
      `;
    } else {
      item.innerHTML = `
        <img src="${fileSrc}" alt="preview">
        <button type="button" class="btn-remove-media" data-index="${index}" title="Hapus file">×</button>
      `;
    }

    item.querySelector('.btn-remove-media')?.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMediaFiles.splice(index, 1);
      updateMediaPreviews();
    });

    mediaPreviewContainer.appendChild(item);
  });
}

// Format waktu lokal untuk input datetime-local
function formatDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

// Modal popup detail review postingan
export function openScheduleDetail(id) {
  const item = currentSchedulesCache.find((s) => String(s.id) === String(id));
  if (!item) return;

  const modal = document.getElementById('scheduleDetailModal');
  const imgTag = document.getElementById('detailModalImage');
  const captionEl = document.getElementById('detailModalCaption');
  const statusEl = document.getElementById('detailModalStatus');
  const timeEl = document.getElementById('detailModalTime');
  const thumbsContainer = document.getElementById('detailMediaThumbnails');

  if (!modal) return;

  if (timeEl) {
    timeEl.textContent = new Date(item.scheduleTime).toLocaleString('id-ID');
  }

  if (statusEl) {
    const isTT = (item.platform || '').toLowerCase() === 'tiktok';
    const platName = isTT ? 'TikTok' : 'Instagram';

    if (item.status === 'pending' || !item.status) {
      statusEl.textContent = `Menunggu (${platName})`;
      statusEl.style.color = '#eab308';
    } else if (item.status === 'running') {
      statusEl.textContent = `Sedang Mengunggah ke ${platName}...`;
      statusEl.style.color = '#35b29f';
    } else if ((item.status === 'success' || item.status === 'selesai') && isTikTokScheduledAhead(item)) {
      statusEl.textContent = `Sudah diunggah · terjadwal di ${platformName(item)}`;
      statusEl.style.color = '#10b981';
    } else if (item.status === 'success' || item.status === 'selesai') {
      statusEl.textContent = `Berhasil Terbit di ${platName}`;
      statusEl.style.color = '#10b981';
    } else {
      statusEl.textContent = item.errorMessage || item.status || 'Gagal';
      statusEl.style.color = '#ef4444';
    }
  }

  if (captionEl) {
    captionEl.textContent = item.caption || '(Tidak ada caption)';

    let captionHeaderContainer = document.getElementById('captionHeaderBarModal');
    const captionParent = captionEl.parentElement;

    if (!captionHeaderContainer && captionParent) {
      captionHeaderContainer = document.createElement('div');
      captionHeaderContainer.id = 'captionHeaderBarModal';
      captionHeaderContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
      captionHeaderContainer.innerHTML = `
        <span style="font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase;">Caption Lengkap</span>
        <button id="btnCopyCaptionModal" type="button" style="font-size: 11px; padding: 4px 10px; background: #27272a; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-weight: 600; transition: all 0.2s ease;">
          <span></span>
          <span id="txtCopyCaption">Salin Caption</span>
        </button>
      `;

      const prevTitle = Array.from(captionParent.children).find(
        (c) => c !== captionEl && (c.innerText || '').toUpperCase().includes('CAPTION LENGKAP')
      );
      if (prevTitle) {
        captionParent.replaceChild(captionHeaderContainer, prevTitle);
      } else {
        captionParent.insertBefore(captionHeaderContainer, captionEl);
      }
    }

    const btnCopy = document.getElementById('btnCopyCaptionModal');
    const txtCopy = document.getElementById('txtCopyCaption');

    if (btnCopy) {
      btnCopy.onclick = async () => {
        const textToCopy = item.caption || '';
        if (!textToCopy.trim()) return;

        try {
          await navigator.clipboard.writeText(textToCopy);
          if (txtCopy) txtCopy.textContent = 'Tersalin! ✓';
          btnCopy.style.borderColor = '#10b981';
          btnCopy.style.color = '#10b981';
          btnCopy.style.background = 'rgba(16, 185, 129, 0.15)';

          setTimeout(() => {
            if (txtCopy) txtCopy.textContent = 'Salin Caption';
            btnCopy.style.borderColor = '#3f3f46';
            btnCopy.style.color = '#f4f4f5';
            btnCopy.style.background = '#27272a';
          }, 2000);
        } catch (err) {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);

          if (txtCopy) txtCopy.textContent = 'Tersalin! ✓';
          btnCopy.style.borderColor = '#10b981';
          btnCopy.style.color = '#10b981';

          setTimeout(() => {
            if (txtCopy) txtCopy.textContent = 'Salin Caption';
            btnCopy.style.borderColor = '#3f3f46';
            btnCopy.style.color = '#f4f4f5';
          }, 2000);
        }
      };
    }
  }

  const files = item.mediaPaths && item.mediaPaths.length > 0 
    ? item.mediaPaths 
    : (item.filePath ? [item.filePath] : []);

  if (imgTag) {
    if (files.length > 0) {
      const isVid = /\.(mp4|mov|webm|mkv)$/i.test(files[0]);
      if (isVid) {
        imgTag.parentElement.innerHTML = `
          <video id="detailModalImage" src="${getFileUrl(files[0])}" controls style="width: 100%; height: 100%; object-fit: contain;"></video>
        `;
      } else {
        imgTag.src = getFileUrl(files[0]);
        imgTag.style.display = 'block';
      }
    } else {
      imgTag.src = '';
      imgTag.style.display = 'none';
    }
  }

  if (thumbsContainer) {
    thumbsContainer.innerHTML = '';
    if (files.length > 1) {
      files.forEach((file, idx) => {
        const thumbUrl = getFileUrl(file);
        const thumb = document.createElement('div');
        thumb.style.width = '48px';
        thumb.style.height = '48px';
        thumb.style.borderRadius = '6px';
        thumb.style.overflow = 'hidden';
        thumb.style.cursor = 'pointer';
        thumb.style.border = idx === 0 ? '2px solid #35b29f' : '1px solid #333';
        thumb.style.flexShrink = '0';

        thumb.innerHTML = `<img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
        thumb.onclick = () => {
          const mainPreview = document.getElementById('detailModalImage');
          if (mainPreview) mainPreview.src = thumbUrl;
          thumbsContainer.querySelectorAll('div').forEach((d) => (d.style.border = '1px solid #333'));
          thumb.style.border = '2px solid #35b29f';
        };
        thumbsContainer.appendChild(thumb);
      });
    }
  }

  modal.style.display = 'flex';
}

// Memuat data tabel antrean jadwal
export async function loadSchedulesTable() {
  const scheduleTableBody = document.getElementById('scheduleTableBody');
  if (!scheduleTableBody) return;

  try {
    if (!window.electronAPI?.getSchedules) return;
    const list = await window.electronAPI.getSchedules();
    currentSchedulesCache = Array.isArray(list) ? list : [];

    if (currentSchedulesCache.length === 0) {
      scheduleTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-table">Belum ada jadwal postingan dibuat.</td>
        </tr>
      `;
      return;
    }

    scheduleTableBody.innerHTML = '';
    currentSchedulesCache.forEach((item) => {
      const tr = document.createElement('tr');
      const files = item.mediaPaths || (item.filePath ? [item.filePath] : []);
      const primaryFile = files[0] || '';
      const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(primaryFile);
      const isTikTok = (item.platform || '').toLowerCase() === 'tiktok';
      const fileSrc = getFileUrl(primaryFile);

      const mediaHtml = primaryFile ? (
        isVideo
          ? `<video src="${fileSrc}" muted></video>`
          : `<img src="${fileSrc}" alt="thumb">`
      ) : '<span style="font-size: 10px; color: #666;">No File</span>';

      const platformBadge = isTikTok
        ? `<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #e8a25c; background: rgba(232, 162, 92,0.12); padding: 2px 6px; border-radius: 4px; margin-bottom: 4px;">TIKTOK</span>`
        : `<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #6fcdbd; background: rgba(53, 178, 159,0.12); padding: 2px 6px; border-radius: 4px; margin-bottom: 4px;">INSTAGRAM</span>`;

      const pidBadge = item.productId || item.productPid
        ? `<span style="display: inline-block; font-size: 9.5px; font-weight: 600; color: #10b981; background: rgba(16,185,129,0.12); padding: 1px 5px; border-radius: 3px; margin-left: 4px;">PID: ${item.productId || item.productPid}</span>`
        : '';

      const countBadge = files.length > 1
        ? `<span class="table-badge-count">+${files.length - 1}</span>`
        : '';

      let statusBadge = item.remote
        ? `<span style="color: #eab308; font-weight: 600;" title="${item.remoteMessage || ''}">Menunggu (Server)</span>`
        : '<span style="color: #eab308; font-weight: 600;">Menunggu</span>';
      if (item.status === 'canceled') {
        statusBadge = '<span style="color: #9d9c97; font-weight: 600;">Dibatalkan</span>';
      }
      if (item.status === 'running') {
        statusBadge = '<span style="color: #35b29f; font-weight: 600;">Sedang Upload...</span>';
      } else if ((item.status === 'success' || item.status === 'selesai') && isTikTokScheduledAhead(item)) {
        statusBadge = `<span style="color: #10b981; font-weight: 600;" title="Video sudah diunggah; ${platformName(item)} yang memposting di jam jadwal">Terjadwal di ${platformName(item)}</span>`;
      } else if (item.status === 'success' || item.status === 'selesai') {
        statusBadge = '<span style="color: #10b981; font-weight: 600;">Selesai</span>';
      } else if (item.status === 'failed') {
        statusBadge = `<span style="color: #ef4444; font-weight: 600;" title="${item.errorMessage || item.error || ''}">Gagal</span>`;
      }

      const dateFormatted = new Date(item.scheduleTime).toLocaleString('id-ID');

      tr.innerHTML = `
        <td style="width: 70px;">
          <div class="table-thumb-box">
            ${mediaHtml}
            ${countBadge}
          </div>
        </td>
        <td>
          <div style="display: flex; flex-direction: column; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 4px;">
              ${platformBadge}
              ${pidBadge}
            </div>
            <div class="table-caption-cell" title="${item.caption || ''}">
              ${item.caption || '<em style="color:#737373;">Tanpa Caption</em>'}
            </div>
          </div>
        </td>
        <td style="font-size: 12px; color: #a8a8a8; width: 170px;">${dateFormatted}</td>
        <td style="text-align: center; width: 120px;">${statusBadge}</td>
        <td style="text-align: center; width: 70px;">
          <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
            <button type="button" class="btn-view-detail" data-id="${item.id}" title="Review Detail Media & Caption" style="background: none; border: none; color: #35b29f; cursor: pointer; display: inline-flex; align-items: center; padding: 2px;">
              <svg style="width: 17px; height: 17px; fill: currentColor;" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </button>
            <button type="button" class="btn-del-schedule" data-id="${item.id}" title="Hapus Jadwal" style="background: none; border: none; color: #ef4444; cursor: pointer; display: inline-flex; align-items: center; padding: 2px;">
              <svg style="width: 16px; height: 16px; fill: currentColor;" viewBox="0 0 24 24">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </td>
      `;

      scheduleTableBody.appendChild(tr);
    });

    scheduleTableBody.querySelectorAll('.btn-view-detail').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openScheduleDetail(id);
      });
    });

    scheduleTableBody.querySelectorAll('.btn-del-schedule').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Batalkan dan hapus jadwal ini?')) {
          await window.electronAPI.deleteSchedule(id);
          loadSchedulesTable();
        }
      });
    });
  } catch (err) {
    console.error('Gagal memuat jadwal:', err);
  }
}

export const loadScheduleQueue = loadSchedulesTable;

export function setScheduleMedia(filePaths) {
  if (Array.isArray(filePaths)) {
    selectedMediaFiles = [...filePaths];
  } else if (filePaths) {
    selectedMediaFiles = [filePaths];
  }
  updateMediaPreviews();

  const tabSchedule = document.getElementById('tabSchedule');
  const viewSchedule = document.getElementById('viewSchedule');
  if (typeof window.switchAppTab === 'function' && tabSchedule && viewSchedule) {
    window.switchAppTab(tabSchedule, viewSchedule);
  }
}

export function initScheduleManager() {
  const dropzonePicker = document.getElementById('dropzonePicker');
  const captionInput = document.getElementById('captionInput');
  const captionCounter = document.getElementById('captionCounter');
  const aiPromptInput = document.getElementById('aiPromptInput');
  const aiToneSelect = document.getElementById('aiToneSelect');
  const btnGenerateAI = document.getElementById('btnGenerateAI');
  const scheduleTimeInput = document.getElementById('scheduleTimeInput');
  const btnSchedule = document.getElementById('btnSchedule');
  const btnRefreshSchedules = document.getElementById('btnRefreshSchedules');

  // Input PID Keranjang Kuning TikTok
  const scheduleTiktokPid = document.getElementById('scheduleTiktokPid');
  const btnPickProductForSchedule = document.getElementById('btnPickProductForSchedule');
  const scheduleSelectedProductPreview = document.getElementById('scheduleSelectedProductPreview');
  // Judul keranjang kuning manual (maks 30 karakter TikTok); kosong = dibuat AI saat upload
  const scheduleLinkTitle = document.getElementById('scheduleLinkTitle');
  const scheduleLinkTitleCounter = document.getElementById('scheduleLinkTitleCounter');
  const updateLinkTitleCounter = () => {
    if (scheduleLinkTitleCounter) scheduleLinkTitleCounter.textContent = String(scheduleLinkTitle?.value.length || 0);
  };
  scheduleLinkTitle?.addEventListener('input', updateLinkTitleCounter);

  // Pakai / tanpa keranjang kuning: tanpa → PID tidak dikirim, uploader melewati langkah tautkan produk
  let useYellowBasket = true;
  const basketButtons = document.querySelectorAll('.schedule-basket-btn');
  const scheduleBasketFields = document.getElementById('scheduleBasketFields');
  const setYellowBasket = (on) => {
    useYellowBasket = on;
    basketButtons.forEach((b) => b.classList.toggle('active', (b.dataset.basket === 'on') === on));
    if (scheduleBasketFields) scheduleBasketFields.style.display = on ? 'block' : 'none';
  };
  basketButtons.forEach((b) => b.addEventListener('click', () => setYellowBasket(b.dataset.basket === 'on')));

  // Modal Pemilih Produk Showcase
  const scheduleProductPickerModal = document.getElementById('scheduleProductPickerModal');
  const scheduleProductPickerGrid = document.getElementById('scheduleProductPickerGrid');
  const scheduleProductSearchInput = document.getElementById('scheduleProductSearchInput');
  const btnCloseScheduleProductPickerModal = document.getElementById('btnCloseScheduleProductPickerModal');
  const btnCancelScheduleProductPickerModal = document.getElementById('btnCancelScheduleProductPickerModal');

  const modalDetail = document.getElementById('scheduleDetailModal');
  const btnCloseDetail = document.getElementById('btnCloseScheduleDetail');
  const btnOkDetail = document.getElementById('btnOkScheduleDetail');

  const closeScheduleDetailModal = () => {
    if (modalDetail) modalDetail.style.display = 'none';
  };

  btnCloseDetail?.addEventListener('click', closeScheduleDetailModal);
  btnOkDetail?.addEventListener('click', closeScheduleDetailModal);
  modalDetail?.addEventListener('click', (e) => {
    if (e.target === modalDetail) closeScheduleDetailModal();
  });

  const closeProductPickerModal = () => {
    if (scheduleProductPickerModal) scheduleProductPickerModal.style.display = 'none';
  };

  btnCloseScheduleProductPickerModal?.addEventListener('click', closeProductPickerModal);
  btnCancelScheduleProductPickerModal?.addEventListener('click', closeProductPickerModal);
  scheduleProductPickerModal?.addEventListener('click', (e) => {
    if (e.target === scheduleProductPickerModal) closeProductPickerModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalDetail && modalDetail.style.display === 'flex') closeScheduleDetailModal();
      if (scheduleProductPickerModal && scheduleProductPickerModal.style.display === 'flex') closeProductPickerModal();
    }
  });

  function renderShowcasePickerCards(products = []) {
    if (!scheduleProductPickerGrid) return;
    scheduleProductPickerGrid.innerHTML = '';

    if (!products || products.length === 0) {
      scheduleProductPickerGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 50px 0; font-size: 12.5px;">
          Tidak ada produk showcase yang cocok.
        </div>
      `;
      return;
    }

    products.forEach((p) => {
      const pid = p.productId || p.id || '';
      const title = p.product_title || p.title || 'Produk TikTok Shop';
      const price = p.price || p.revenue || 'Rp0';
      const imgSrc = p.coverUrl || p.product_img || '';

      const card = document.createElement('div');
      card.style.cssText = `
        position: relative;
        background: #1b1d20;
        border: 2px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.15s ease, border-color 0.15s ease;
        display: flex;
        flex-direction: column;
      `;

      card.innerHTML = `
        <div style="width: 100%; aspect-ratio: 1/1; background: #000; overflow: hidden; flex-shrink: 0; position: relative;">
          <img src="${imgSrc}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='';">
          <span style="position: absolute; top: 8px; right: 8px; background: rgba(16, 185, 129, 0.85); color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Active</span>
        </div>
        <div style="padding: 10px; display: flex; flex-direction: column; gap: 4px; flex: 1;">
          <div style="font-size: 12px; font-weight: 600; color: #fff; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${title}">
            ${title}
          </div>
          <div style="font-size: 12px; font-weight: 700; color: #6fcdbd; margin-top: auto;">
            ${price}
          </div>
          <div style="font-size: 10px; color: var(--text-dim); font-family: monospace;">
            PID: ${pid}
          </div>
        </div>
      `;

      card.onmouseenter = () => {
        card.style.borderColor = '#35b29f';
        card.style.transform = 'translateY(-2px)';
      };
      card.onmouseleave = () => {
        card.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        card.style.transform = 'translateY(0)';
      };

      card.onclick = () => {
        if (scheduleTiktokPid) scheduleTiktokPid.value = pid;
        if (scheduleSelectedProductPreview) {
          scheduleSelectedProductPreview.textContent = `✓ Produk Terpilih: ${title} (PID: ${pid})`;
          scheduleSelectedProductPreview.style.display = 'block';
        }
        setStatus(`Produk keranjang kuning dipilih: ${title}`, 'success');
        closeProductPickerModal();

        // Caption otomatis dari nama produk
        if (aiPromptInput) aiPromptInput.value = title;
        generateScheduleCaption();
      };

      scheduleProductPickerGrid.appendChild(card);
    });
  }

  // Filter pencarian produk di dalam modal
  scheduleProductSearchInput?.addEventListener('input', () => {
    const q = scheduleProductSearchInput.value.toLowerCase().trim();
    if (!q) {
      renderShowcasePickerCards(loadedShowcaseProducts);
      return;
    }
    const filtered = loadedShowcaseProducts.filter((p) => {
      const title = (p.product_title || p.title || '').toLowerCase();
      const pid = String(p.productId || p.id || '').toLowerCase();
      return title.includes(q) || pid.includes(q);
    });
    renderShowcasePickerCards(filtered);
  });

  // Tombol Buka Modal Ambil Produk Showcase
  btnPickProductForSchedule?.addEventListener('click', async () => {
    if (!scheduleProductPickerModal || !scheduleProductPickerGrid) return;

    if (scheduleProductSearchInput) scheduleProductSearchInput.value = '';
    scheduleProductPickerGrid.innerHTML = `
      <div class="app-loader">
        Memuat produk showcase...
      </div>
    `;
    scheduleProductPickerModal.style.display = 'flex';

    try {
      const res = await window.electronAPI?.getTiktokShowcaseProducts?.(false);
      if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
        loadedShowcaseProducts = res.data;
        renderShowcasePickerCards(loadedShowcaseProducts);
      } else {
        scheduleProductPickerGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 50px 0; font-size: 12.5px;">
            Belum ada produk di etalase. Buka tab <strong>Showcase Produk</strong> untuk sinkronisasi.
          </div>
        `;
      }
    } catch (err) {
      scheduleProductPickerGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 50px 0; font-size: 12.5px;">
          Gagal memuat produk showcase: ${err.message}
        </div>
      `;
    }
  });

  // Pemilihan file explorer
  // Pilih video hasil render dari Galeri Video (tanpa drag & drop)
  const videoPickerModal = document.getElementById('scheduleVideoPickerModal');
  const videoPickerGrid = document.getElementById('scheduleVideoPickerGrid');
  const closeVideoPicker = () => { if (videoPickerModal) videoPickerModal.style.display = 'none'; };
  document.getElementById('btnCloseScheduleVideoPickerModal')?.addEventListener('click', closeVideoPicker);
  document.getElementById('btnCancelScheduleVideoPickerModal')?.addEventListener('click', closeVideoPicker);
  videoPickerModal?.addEventListener('click', (e) => { if (e.target === videoPickerModal) closeVideoPicker(); });

  document.getElementById('btnPickVideoFromGallery')?.addEventListener('click', async () => {
    if (!videoPickerModal || !videoPickerGrid) return;
    videoPickerModal.style.display = 'flex';
    videoPickerGrid.innerHTML = '<div class="app-loader">Memuat galeri video...</div>';

    const [videos, postStatus] = await Promise.all([
      window.electronAPI.getSavedVideos?.().catch(() => []),
      window.electronAPI.getVideoPostStatus?.().catch(() => ({}))
    ]).then(([v, p]) => [v || [], p || {}]);
    videoPickerGrid.innerHTML = '';
    if (!videos.length) {
      videoPickerGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 50px 0; font-size: 12.5px;">Galeri video masih kosong. Buat video dulu di menu Buat Video Reels.</div>';
      return;
    }

    // Tanda seperti di Showcase: sudah diposting berapa kali / masih terjadwal
    const postBadge = (filePath) => {
      const key = String(filePath || '').split(/[\\/]/).pop().toLowerCase();
      const st = postStatus[key];
      if (st?.posted) return `<span style="position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; background: rgba(53, 178, 159, 0.92); color: #0f1f1c;">Diposting ${st.posted}x</span>`;
      if (st?.scheduled) return '<span style="position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; background: rgba(232, 162, 92, 0.92); color: #2a1a08;">Terjadwal</span>';
      return '<span style="position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; background: rgba(0, 0, 0, 0.6); color: #d0cec8;">Belum diposting</span>';
    };

    videos.forEach((v) => {
      const filePath = v.filePath || v.storagePath;
      const poster = v.thumbnailPath || v.poster;
      const card = document.createElement('div');
      card.style.cssText = 'background: #1b1d20; border: 2px solid rgba(255, 255, 255, 0.08); border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease; display: flex; flex-direction: column;';
      card.innerHTML = `
        <div style="position: relative; width: 100%; aspect-ratio: 9/16; background: #000; overflow: hidden; flex-shrink: 0;">
          ${videoThumbHtml(filePath, poster, 'width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;')}
          ${postBadge(filePath)}
        </div>
        <div style="padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 11px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.fileName || ''}">${v.fileName || 'Video'}</div>
          <div style="font-size: 10px; color: var(--text-dim);">${v.createdDate || ''}</div>
        </div>
      `;
      // Pratinjau saat hover: <video> dibuat hanya saat kursor masuk & dibuang saat keluar
      // (dulu tiap kartu punya <video> → terlalu banyak pemutar, sebagian hitam & tak bisa diputar)
      const mediaBox = card.firstElementChild;
      let hoverVideo = null;
      card.onmouseenter = () => {
        card.style.borderColor = '#35b29f'; card.style.transform = 'translateY(-2px)';
        hoverVideo = document.createElement('video');
        hoverVideo.src = getFileUrl(filePath);
        hoverVideo.muted = true; hoverVideo.loop = true; hoverVideo.playsInline = true;
        hoverVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;';
        mediaBox.appendChild(hoverVideo);
        hoverVideo.play().catch(() => {});
      };
      card.onmouseleave = () => {
        card.style.borderColor = 'rgba(255, 255, 255, 0.08)'; card.style.transform = 'translateY(0)';
        if (hoverVideo) { hoverVideo.pause(); hoverVideo.removeAttribute('src'); hoverVideo.load(); hoverVideo.remove(); hoverVideo = null; }
      };
      card.onclick = () => {
        // Satu postingan video: pilihan galeri menggantikan media sebelumnya
        selectedMediaFiles = [filePath];
        updateMediaPreviews();
        setStatus(`Video dipilih dari galeri: ${v.fileName || ''}`, 'success');
        closeVideoPicker();
      };
      videoPickerGrid.appendChild(card);
    });
    hydrateVideoThumbs(videoPickerGrid);
  });

  dropzonePicker?.addEventListener('click', async () => {
    const files = await window.electronAPI.selectFiles();
    if (files && files.length > 0) {
      files.forEach((f) => {
        if (!selectedMediaFiles.includes(f) && selectedMediaFiles.length < 10) {
          selectedMediaFiles.push(f);
        }
      });
      updateMediaPreviews();
    }
  });

  // Drag and drop
  dropzonePicker?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzonePicker.classList.add('dragover');
  });

  dropzonePicker?.addEventListener('dragleave', () => {
    dropzonePicker.classList.remove('dragover');
  });

  dropzonePicker?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzonePicker.classList.remove('dragover');
    if (e.dataTransfer?.files.length) {
      Array.from(e.dataTransfer.files).forEach((file) => {
        if (/\.(jpg|jpeg|png|mp4|mov|webm|mkv)$/i.test(file.path)) {
          if (!selectedMediaFiles.includes(file.path) && selectedMediaFiles.length < 10) {
            selectedMediaFiles.push(file.path);
          }
        }
      });
      updateMediaPreviews();
    }
  });

  captionInput?.addEventListener('input', () => {
    if (captionCounter) captionCounter.textContent = `${captionInput.value.length} / 2.200`;
  });

  // Dipakai tombol "Buat Caption" & otomatis setelah memilih produk dari showcase
  async function generateScheduleCaption() {
    const prompt = aiPromptInput?.value.trim();
    const tone = aiToneSelect?.value || 'promo';

    // Video buatan bot (mis. 3D Edukasi) cukup dipilih: isi video dibaca otomatis tanpa perlu mengetik topik
    if (!prompt && !selectedMediaFiles.length) {
      setStatus('Ketikkan topik atau ringkasan produk terlebih dahulu.', 'error');
      return;
    }
    if (!btnGenerateAI || btnGenerateAI.disabled) return;

    btnGenerateAI.disabled = true;
    btnGenerateAI.innerHTML = `Membuat Caption...`;

    try {
      const res = await window.electronAPI.generateCaption({
        prompt,
        tone,
        mediaFiles: selectedMediaFiles,
        platform: (await window.electronAPI.getSessionInfo?.().catch(() => null))?.platform || ''
      });

      if (res && res.success) {
        captionInput.value = res.caption;
        if (captionCounter) captionCounter.textContent = `${res.caption.length} / 2.200`;
        setStatus('Caption AI berhasil dibuat!', 'success');
      } else {
        setStatus(`Gagal membuat caption: ${res?.error || 'Periksa API Key'}`, 'error');
      }
    } catch (err) {
      setStatus(`Terjadi kesalahan: ${err.message}`, 'error');
    } finally {
      btnGenerateAI.disabled = false;
      btnGenerateAI.innerHTML = `<span>Buat Caption</span>`;
    }
  }

  btnGenerateAI?.addEventListener('click', generateScheduleCaption);

  document.querySelectorAll('.btn-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const minutes = btn.getAttribute('data-minutes');
      const preset = btn.getAttribute('data-preset');
      const now = new Date();

      if (minutes) {
        now.setMinutes(now.getMinutes() + parseInt(minutes, 10));
        scheduleTimeInput.value = formatDateTimeLocal(now);
      } else if (preset === 'tomorrow-morning') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        scheduleTimeInput.value = formatDateTimeLocal(tomorrow);
      } else if (preset === 'tomorrow-evening') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(19, 0, 0, 0);
        scheduleTimeInput.value = formatDateTimeLocal(tomorrow);
      }
    });
  });

  // Pilihan konsep video: menentukan pengaturan audio saat posting TikTok
  //   JJ → musik -60 dB · Daster → suara asli mati, musik default · Sensasi → suara asli tetap, musik -25 dB
  const CONCEPT_AUDIO_HINT = {
    jj: 'JJ: musik -60 dB, suara asli video tetap',
    daster: 'Daster: suara asli tetap, musik -25 dB',
    sensasi: 'Sensasi: suara karakter tetap, musik -25 dB',
    pov: 'POV Tangan: voice over tetap, musik -30 dB',
    edu3d: '3D Edukasi: narasi tetap, musik -30 dB',
    kartun3d: '3D Kartun: dialog & musik video tetap, musik TikTok -30 dB',
    carakerja3d: '3D Cara Kerja: narasi & musik video tetap, musik TikTok -30 dB',
    serial3d: 'Serial Animasi: suara karakter & musik video tetap, musik TikTok -30 dB'
  };
  let selectedScheduleConcept = '';
  const conceptButtons = document.querySelectorAll('.schedule-concept-btn');
  const conceptHint = document.getElementById('scheduleConceptHint');
  let conceptAutoDetected = false;
  const setScheduleConcept = (concept, auto = false) => {
    selectedScheduleConcept = concept || '';
    conceptAutoDetected = auto && Boolean(selectedScheduleConcept);
    conceptButtons.forEach((b) => b.classList.toggle('active', b.dataset.concept === selectedScheduleConcept));
    const hint = CONCEPT_AUDIO_HINT[selectedScheduleConcept];
    if (conceptHint) conceptHint.textContent = hint ? (auto ? `Terdeteksi otomatis · ${hint}` : hint) : 'Wajib dipilih: menentukan pengaturan suara saat posting';
  };
  conceptButtons.forEach((b) => b.addEventListener('click', () => setScheduleConcept(b.dataset.concept)));

  // Deteksi konsep otomatis dari nama file video buatan bot:
  //   video_daster_* → Daster · video_sensasi_* → Sensasi · video_pov_* → POV Tangan · video_tiktok_* / jj_capcut_* → JJ
  // File lain (tidak dikenali) → pilih manual
  const detectConceptFromFile = (filePath) => {
    const name = String(filePath || '').split(/[\\/]/).pop().toLowerCase();
    if (/daster/.test(name)) return 'daster';
    if (/sensasi/.test(name)) return 'sensasi';
    if (/^video_pov_/.test(name)) return 'pov';
    // Remotion: dari foto (tanpa suara) diatur seperti Daster, overlay video (suara asli) seperti POV
    if (/^video_remotion_foto_/.test(name)) return 'daster';
    // 3D Edukasi: narasi suara AI di video → pengaturan suara seperti POV (suara asli tetap, musik pelan)
    if (/^video_edu3d_/.test(name)) return 'edu3d';
    if (/^video_kartun3d_/.test(name)) return 'kartun3d';
    if (/^video_carakerja3d_/.test(name)) return 'carakerja3d';
    if (/^video_serial3d_/.test(name)) return 'serial3d';
    if (/^video_remotion_video_/.test(name)) return 'pov';
    if (/^(video_tiktok_|jj_capcut_)/.test(name)) return 'jj';
    return '';
  };
  document.addEventListener('schedule-media-changed', () => {
    const video = selectedMediaFiles.find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f));
    const detected = detectConceptFromFile(video);
    if (detected) setScheduleConcept(detected, true);
    // File tidak dikenali: buang hasil deteksi file sebelumnya (pilihan manual pengguna tetap dipertahankan)
    else if (conceptAutoDetected) setScheduleConcept('');
  });
  // Terapkan tampilan sesuai platform sejak halaman dibuka (pilihan konsep hanya untuk TikTok)
  updateMediaPreviews();

  // Tombol Submit Penjadwalan & Eksekusi Langsung TikTok Web
  btnSchedule?.addEventListener('click', async () => {
    if (selectedMediaFiles.length === 0) {
      setStatus('Pilih minimal 1 file gambar atau video!', 'error');
      return;
    }

    let currentPlatform = 'instagram';
    try {
      const sessionInfo = await window.electronAPI?.getSessionInfo?.();
      if (sessionInfo?.platform) currentPlatform = sessionInfo.platform;
    } catch (e) {}

    const isTikTok = currentPlatform === 'tiktok';
    const scheduleTimeVal = scheduleTimeInput?.value;
    const targetPid = useYellowBasket ? scheduleTiktokPid?.value?.trim() || '' : '';
    const linkTitle = useYellowBasket ? scheduleLinkTitle?.value?.trim() || '' : '';

    if (isTikTok && useYellowBasket && !targetPid) {
      setStatus('Pilih produk / isi PID keranjang kuning, atau pilih "Tanpa Keranjang Kuning".', 'error');
      document.getElementById('wrapperScheduleTiktokProduct')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (isTikTok && !selectedScheduleConcept) {
      setStatus('Pilih konsep video dulu (JJ / Daster / Sensasi / POV Tangan) agar pengaturan suara saat posting sesuai.', 'error');
      document.getElementById('wrapperScheduleConcept')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Jika TikTok dan jadwal tidak disetel, unggah langsung via Web Creator Studio
    if (isTikTok && (!scheduleTimeVal || new Date(scheduleTimeVal) <= new Date())) {
      const confirmImmediate = confirm('Jadwal jam tayang kosong atau waktu sekarang. Apakah Anda ingin langsung mengunggah video ke TikTok Web sekarang?');
      if (confirmImmediate) {
        btnSchedule.disabled = true;
        const btnNowHtml = btnSchedule.innerHTML;
        btnSchedule.innerHTML = '<span>Mengunggah ke TikTok Web...</span>';
        setStatus('Membuka browser otomatisasi dan mengunggah video ke TikTok Web...', 'success');

        try {
          const res = await window.electronAPI.publishTikTokPost({
            mediaPaths: selectedMediaFiles,
            caption: captionInput.value,
            productId: targetPid,
            productPid: targetPid,
            productLinkTitle: linkTitle,
            concept: selectedScheduleConcept,
            useLdPlayer: false
          });

          if (res && res.success) {
            clearSelectedMediaFiles();
            captionInput.value = '';
            if (captionCounter) captionCounter.textContent = '0 / 2.200';
            scheduleTimeInput.value = '';
            if (scheduleTiktokPid) scheduleTiktokPid.value = '';
            if (scheduleLinkTitle) scheduleLinkTitle.value = '';
            updateLinkTitleCounter();
            if (scheduleSelectedProductPreview) scheduleSelectedProductPreview.style.display = 'none';
            setStatus('Postingan TikTok Web berhasil dipublikasikan!', 'success');
          } else {
            setStatus(res?.error || 'Gagal mengunggah ke TikTok.', 'error');
          }
        } catch (err) {
          setStatus(`Kendala upload: ${err.message}`, 'error');
        } finally {
          btnSchedule.innerHTML = btnNowHtml;
          btnSchedule.disabled = false;
          updateMediaPreviews();
        }
        return;
      }
    }

    if (!scheduleTimeVal) {
      setStatus('Pilih tanggal & jam publikasi otomatis terlebih dahulu!', 'error');
      return;
    }

    btnSchedule.disabled = true;
    // Simpan isi tombol (ikon + <span> label) → dipulihkan setelah selesai (dulu textContent menghapus <span> → label macet)
    const btnScheduleHtml = btnSchedule.innerHTML;
    const btnLabel = btnSchedule.querySelector('span');
    if (btnLabel) btnLabel.textContent = 'Memproses Jadwal...'; else btnSchedule.textContent = 'Memproses Jadwal...';
    setStatus(toggleRemoteUpload?.checked
      ? 'Mengirim video & jadwal ke server 24 jam... (tunggu sampai video selesai terkirim)'
      : 'Menyimpan jadwal postingan...', 'success');

    try {
      const res = await window.electronAPI.schedulePost({
        mediaPaths: selectedMediaFiles,
        caption: captionInput.value,
        scheduleTime: scheduleTimeVal,
        productId: targetPid,
        productPid: targetPid,
        productLinkTitle: isTikTok ? linkTitle : '',
        concept: isTikTok ? selectedScheduleConcept : '',
        // Instagram: bagikan juga ke Facebook (null = bukan Instagram / biarkan bawaan)
        shareToFacebook: document.getElementById('rowShareToFacebook')?.style.display === 'flex'
          ? Boolean(document.getElementById('toggleShareToFacebook')?.checked)
          : null,
        // Shopee: link produk affiliate (1 per baris) untuk keranjang kuning
        shopeeProductLinks: (document.getElementById('shopeeProductLinks')?.value || '')
          .split('\n').map((s) => s.trim()).filter(Boolean),
        // YouTube: judul & produk YouTube Shopping
        youtubeTitle: (document.getElementById('youtubeTitleInput')?.value || '').trim(),
        youtubeProductQueries: (document.getElementById('youtubeProductQueries')?.value || '')
          .split('\n').map((s) => s.trim()).filter(Boolean)
      });

      if (res && res.success) {
        clearSelectedMediaFiles();
        captionInput.value = '';
        if (captionCounter) captionCounter.textContent = '0 / 2.200';
        scheduleTimeInput.value = '';
        if (scheduleTiktokPid) scheduleTiktokPid.value = '';
        if (scheduleLinkTitle) scheduleLinkTitle.value = '';
        updateLinkTitleCounter();
        if (scheduleSelectedProductPreview) scheduleSelectedProductPreview.style.display = 'none';
        setStatus(res.message || 'Jadwal berhasil ditambahkan!', 'success');
        loadSchedulesTable();
      } else {
        setStatus(res?.error || res?.message || 'Gagal menyimpan jadwal.', 'error');
      }
    } catch (err) {
      setStatus(`Terjadi kesalahan: ${err.message}`, 'error');
    } finally {
      btnSchedule.innerHTML = btnScheduleHtml;
      btnSchedule.disabled = false;
      updateMediaPreviews();
    }
  });

  // Upload 24 jam lewat server
  const toggleRemoteUpload = document.getElementById('toggleRemoteUpload');
  const remoteUploadInfo = document.getElementById('remoteUploadInfo');
  const REMOTE_INFO_DEFAULT = remoteUploadInfo?.textContent || '';
  const showRemoteState = (cfg) => {
    if (!cfg || !toggleRemoteUpload) return;
    toggleRemoteUpload.checked = Boolean(cfg.enabled);
    if (!remoteUploadInfo) return;
    if (cfg.enabled && cfg.online === false) {
      remoteUploadInfo.textContent = `Server 24 jam tidak bisa dihubungi: ${cfg.error || ''}`;
      remoteUploadInfo.style.color = '#f87171';
    } else {
      remoteUploadInfo.textContent = cfg.enabled
        ? '✓ Aktif — jadwal TikTok baru dikirim ke server dan diposting walau aplikasi ditutup / PC mati.'
        : REMOTE_INFO_DEFAULT;
      remoteUploadInfo.style.color = cfg.enabled ? '#34d399' : '';
    }
  };
  window.electronAPI?.getRemoteUploadConfig?.().then(showRemoteState).catch(() => {});
  toggleRemoteUpload?.addEventListener('change', async () => {
    showRemoteState(await window.electronAPI?.setRemoteUploadConfig?.({ enabled: toggleRemoteUpload.checked }).catch(() => null));
  });

  btnRefreshSchedules?.addEventListener('click', async () => {
    await window.electronAPI?.syncRemoteSchedules?.().catch(() => {});
    loadSchedulesTable();
  });
  document.getElementById('tabSchedule')?.addEventListener('click', loadSchedulesTable);
  window.addEventListener('refresh-schedules', loadSchedulesTable);

  window.addEventListener('insert-media-file', (e) => {
    const filePath = e.detail;
    if (filePath) {
      setScheduleMedia([filePath]);
    }
  });

  // Listener IPC status progres upload TikTok (Web)
  if (window.electronAPI && typeof window.electronAPI.onTikTokProgress === 'function') {
    window.electronAPI.onTikTokProgress((data) => {
      if (data?.status) addPostLog('running', `[TikTok Web] ${data.status}`);
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onUploadStatus === 'function') {
    window.electronAPI.onUploadStatus((data) => {
      addPostLog(data?.status, data?.message);
      // Tabel riwayat cukup dimuat ulang saat status berubah (bukan tiap baris progres)
      if (data?.status && data.status !== 'running') loadSchedulesTable();
    });
  }

  renderPostLog();
  document.getElementById('btnClearPostLog')?.addEventListener('click', () => {
    postLogEntries = [];
    try { localStorage.removeItem(POST_LOG_KEY); } catch (e) {}
    renderPostLog();
  });

  // Listener IPC saat ada pembaruan jadwal dari backend
  if (window.electronAPI && typeof window.electronAPI.onSchedulesUpdated === 'function') {
    window.electronAPI.onSchedulesUpdated(() => {
      loadSchedulesTable();
    });
  }

  // Update tampilan saat akun/platform beralih
  if (window.electronAPI && typeof window.electronAPI.onAccountsUpdated === 'function') {
    window.electronAPI.onAccountsUpdated(() => {
      updateMediaPreviews();
      loadSchedulesTable();
    });
  }

  updateMediaPreviews();
  loadSchedulesTable();
}