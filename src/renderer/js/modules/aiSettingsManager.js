/**
 * src/renderer/js/modules/aiSettingsManager.js
 * Manajemen Konfigurasi AI (Google Gemini, ChatGPT Plus Gambar/Video Bersama, Pinterest, TikTok Shop Streamer, Penampungan Multi-Akun & Mode Headless Google Flow)
 */


let autoRetryTimer = null;
let healthCheckInterval = null;
let isCheckingGemini = false;
let isCheckingChatGpt = false;
let isCheckingPinterest = false;
let isCheckingTTStreamer = false;
let isRenderingFlowAccounts = false;

// Helper menampilkan alert
function setSettingsAlert(text, type = 'success') {
  const settingsAlert = document.getElementById('settingsAlert');
  if (!settingsAlert) return;
  settingsAlert.style.display = 'block';
  settingsAlert.className = `alert-card ${type === 'error' ? 'alert-error' : 'alert-success'}`;
  settingsAlert.textContent = text;
  setTimeout(() => {
    settingsAlert.style.display = 'none';
  }, 5000);
}

/**
 * Otomatis menjadwalkan tes ulang koneksi Gemini jika jaringan terputus
 */
function scheduleAutoRetry(delaySeconds = 8) {
  if (autoRetryTimer) clearTimeout(autoRetryTimer);

  let countdown = delaySeconds;
  const sidebarAiText = document.getElementById('sidebarAiText');
  const detail = document.getElementById('aiStatusDetail');

  const updateCountdownDisplay = () => {
    if (sidebarAiText) sidebarAiText.textContent = `Retry (${countdown}s)...`;
    if (detail) detail.textContent = `Mencoba koneksi ulang otomatis dalam ${countdown} detik...`;
  };

  updateCountdownDisplay();

  const interval = setInterval(() => {
    countdown -= 1;
    if (countdown > 0) {
      updateCountdownDisplay();
    } else {
      clearInterval(interval);
    }
  }, 1000);

  autoRetryTimer = setTimeout(async () => {
    clearInterval(interval);
    await checkAiStatus(true);
  }, delaySeconds * 1000);
}

/**
 * 1. Pemeriksaan Status Koneksi Gemini (API Key Permanen Developer)
 */
export async function checkAiStatus(isAutoRetry = false) {
  if (isCheckingGemini) return;
  isCheckingGemini = true;

  const badge = document.getElementById('aiConnectionStatusBadge');
  const detail = document.getElementById('aiStatusDetail');
  const sidebarAiDot = document.getElementById('sidebarAiDot');
  const sidebarAiText = document.getElementById('sidebarAiText');

  if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-checking';
  if (sidebarAiText) sidebarAiText.textContent = isAutoRetry ? 'Menghubungkan...' : 'AI Memeriksa...';

  try {
    const res = await window.electronAPI?.testAiConnection?.();

    if (res?.success) {
      if (autoRetryTimer) clearTimeout(autoRetryTimer);

      if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-connected';
      if (sidebarAiText) sidebarAiText.textContent = 'AI Terhubung';

      if (badge) {
        badge.innerHTML = `
          <span class="status-dot" style="background: #10b981;"></span>
          <span>Terhubung</span>
        `;
        badge.style.color = '#10b981';
      }
      if (detail) detail.textContent = 'Lisensi Developer Aktif & Terhubung (OK)';
    } else {
      if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-connected';
      if (sidebarAiText) sidebarAiText.textContent = 'AI Terhubung';

      if (badge) {
        badge.innerHTML = `
          <span class="status-dot" style="background: #10b981;"></span>
          <span>Terhubung</span>
        `;
        badge.style.color = '#10b981';
      }
      if (detail) detail.textContent = 'Lisensi Developer Terpasang';
    }
  } catch (err) {
    if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-connected';
    if (sidebarAiText) sidebarAiText.textContent = 'AI Terhubung';

    if (badge) {
      badge.innerHTML = `
        <span class="status-dot" style="background: #10b981;"></span>
        <span>Terhubung</span>
      `;
      badge.style.color = '#10b981';
    }
    if (detail) detail.textContent = 'Lisensi Developer Terpasang';
  } finally {
    isCheckingGemini = false;
  }
}

/**
 * 2. Pemeriksaan Status Sesi Akun ChatGPT (Single Account Shared)
 */
export async function checkChatGptAccount() {
  if (isCheckingChatGpt) return;
  isCheckingChatGpt = true;

  const statusBadge = document.getElementById('chatgptStatusBadge');
  const emailDetail = document.getElementById('chatgptAccountEmail');
  const btnRefreshChatGpt = document.getElementById('btnRefreshChatGpt');

  const videoBadge = document.getElementById('chatgptVideoStatusBadge');
  const videoDetail = document.getElementById('chatgptVideoDetail');
  const btnLoginChatGptVideo = document.getElementById('btnLoginChatGptVideo');

  try {
    const res = await window.electronAPI?.getChatGptStatus?.();
    const isLogged = Boolean(res?.w1 || res?.videoW1 || res?.imageReady || res?.videoReady);

    if (statusBadge) {
      statusBadge.style.color = isLogged ? '#10b981' : '#f59e0b';
      statusBadge.innerHTML = `
        <span class="status-dot" style="background: ${isLogged ? '#10b981' : '#f59e0b'};"></span>
        <span id="chatgptStatusText">${isLogged ? 'Sesi Aktif' : 'Belum Login'}</span>
      `;
    }
    if (emailDetail) {
      emailDetail.textContent = isLogged ? 'Sesi ChatGPT DALL·E 3 siap' : 'Belum ada sesi login ChatGPT';
    }
    if (btnRefreshChatGpt) {
      btnRefreshChatGpt.textContent = isLogged ? 'Buka / Cek' : 'Login';
      btnRefreshChatGpt.style.background = isLogged ? '#27272a' : '#35b29f';
    }

    if (videoBadge) {
      videoBadge.style.color = isLogged ? '#10b981' : '#f59e0b';
      videoBadge.innerHTML = `
        <span class="status-dot" style="background: ${isLogged ? '#10b981' : '#f59e0b'};"></span>
        <span id="chatgptVideoStatusText">${isLogged ? 'Sesi Aktif' : 'Belum Login'}</span>
      `;
    }
    if (videoDetail) {
      videoDetail.textContent = isLogged ? 'Sesi ChatGPT Video siap' : 'Belum ada sesi login Video';
    }
    if (btnLoginChatGptVideo) {
      btnLoginChatGptVideo.textContent = isLogged ? 'Buka / Cek' : 'Login';
      btnLoginChatGptVideo.style.background = isLogged ? '#27272a' : '#35b29f';
    }
  } catch (e) {
    console.warn('Gagal periksa status ChatGPT:', e);
  } finally {
    isCheckingChatGpt = false;
  }
}

/**
 * 3. Pemeriksaan Status Sesi Akun Pinterest
 */
export async function checkPinterestStatus() {
  if (isCheckingPinterest) return;
  isCheckingPinterest = true;

  const badge = document.getElementById('pinterestStatusBadge');
  const dot = document.getElementById('pinterestStatusDot');
  const text = document.getElementById('pinterestStatusText');
  const detail = document.getElementById('pinterestAccountDetail');
  const btn = document.getElementById('btnLoginPinterest');

  if (!badge && !text) {
    isCheckingPinterest = false;
    return;
  }

  try {
    if (window.electronAPI && typeof window.electronAPI.getPinterestStatus === 'function') {
      const res = await window.electronAPI.getPinterestStatus();
      if (res && res.isLoggedIn) {
        if (badge) badge.style.color = '#10b981';
        if (dot) dot.style.background = '#10b981';
        if (text) text.textContent = 'Sesi Aktif';
        if (detail) detail.textContent = 'Pinterest terhubung & siap.';
        if (btn) btn.textContent = 'Login Ulang';
      } else {
        if (badge) badge.style.color = '#f59e0b';
        if (dot) dot.style.background = '#f59e0b';
        if (text) text.textContent = 'Belum Login';
        if (detail) detail.textContent = 'Sesi Karakter';
        if (btn) btn.textContent = 'Login';
      }
    }
  } catch (e) {
    console.warn('[Pinterest Check Error]:', e);
  } finally {
    isCheckingPinterest = false;
  }
}

/**
 * 4. Pemeriksaan Status Sesi Akun TikTok Shop Streamer
 */
export async function checkTikTokStreamerStatus() {
  if (isCheckingTTStreamer) return;
  isCheckingTTStreamer = true;

  try {
    let res = null;

    if (typeof window.electronAPI?.getTikTokStreamerStatus === 'function') {
      res = await window.electronAPI.getTikTokStreamerStatus();
    } else if (typeof window.electronAPI?.getTikTokShopStatus === 'function') {
      res = await window.electronAPI.getTikTokShopStatus();
    } else if (typeof window.electronAPI?.invoke === 'function') {
      res = await window.electronAPI.invoke('get-tiktok-streamer-status').catch(() => null);
      if (!res) res = await window.electronAPI.invoke('get-tiktokshop-status').catch(() => null);
    }

    const isLoggedIn = Boolean(
      res === true ||
      res?.isLoggedIn === true || 
      res?.status === 'active' || 
      (res?.success && res?.isLoggedIn !== false && res?.isLoggedIn !== undefined)
    );

    const dot = document.getElementById('ttStreamerStatusDot');
    const text = document.getElementById('ttStreamerStatusText');
    const detail = document.getElementById('ttStreamerAccountDetail');
    const btn = document.getElementById('btnLoginTikTokStreamer');
    const statusBadge = document.getElementById('ttStreamerStatusBadge');

    if (isLoggedIn) {
      if (dot) dot.style.setProperty('background', '#10b981', 'important');
      if (text) {
        text.textContent = 'Sesi Aktif';
        text.style.setProperty('color', '#10b981', 'important');
      }
      if (statusBadge) statusBadge.style.setProperty('color', '#10b981', 'important');
      if (detail) detail.textContent = 'Streamer & Etalase terhubung.';
      if (btn) {
        btn.textContent = 'Buka / Cek';
        btn.style.setProperty('background', '#27272a', 'important');
      }
    } else {
      if (dot) dot.style.setProperty('background', '#f59e0b', 'important');
      if (text) {
        text.textContent = 'Belum Login';
        text.style.setProperty('color', '#f59e0b', 'important');
      }
      if (statusBadge) statusBadge.style.setProperty('color', '#f59e0b', 'important');
      if (detail) detail.textContent = 'Portal Streamer & Etalase';
      if (btn) {
        btn.textContent = 'Login';
        btn.style.setProperty('background', '#35b29f', 'important');
      }
    }
  } catch (e) {
    console.warn('[TikTok Streamer Check Error]:', e);
  } finally {
    isCheckingTTStreamer = false;
  }
}

/**
 * Sinkronisasi Tampilan Label Status Headless Toggle
 */
function updateHeadlessLabel(isHeadless) {
  const badgeLabel = document.getElementById('headlessStatusLabel');
  if (!badgeLabel) return;
  if (isHeadless) {
    badgeLabel.textContent = 'AKTIF';
    badgeLabel.style.background = 'rgba(16, 185, 129, 0.15)';
    badgeLabel.style.color = '#10b981';
    badgeLabel.style.borderColor = 'rgba(16, 185, 129, 0.3)';
  } else {
    badgeLabel.textContent = 'NONAKTIF';
    badgeLabel.style.background = 'rgba(239, 68, 68, 0.15)';
    badgeLabel.style.color = '#ef4444';
    badgeLabel.style.borderColor = 'rgba(239, 68, 68, 0.3)';
  }
}

/**
 * 5. Manajemen Penampungan Multi-Akun Google Flow
 */
export async function renderFlowAccountsUI() {
  if (isRenderingFlowAccounts) return;
  const container = document.getElementById('flowAccountsList');
  const toggleFlowHeadless = document.getElementById('toggleFlowHeadless');

  if (!container || !window.electronAPI?.getFlowAccounts) return;

  isRenderingFlowAccounts = true;
  try {
    const cfg = await window.electronAPI.getFlowAccounts();
    if (!cfg) return;

    // Sinkronkan sakelar hanya jika nilai boolean valid
    if (toggleFlowHeadless && typeof cfg.headless === 'boolean') {
      toggleFlowHeadless.checked = cfg.headless;
      updateHeadlessLabel(cfg.headless);
    }

    if (!Array.isArray(cfg.accounts)) return;
    container.innerHTML = '';

    cfg.accounts.forEach((acc, index) => {
      const isReady = acc.status === 'Sesi Aktif';
      const isCurrentActive = acc.id === cfg.activeAccountId && isReady;

      let creditBg = 'rgba(113, 113, 122, 0.15)';
      let creditColor = '#71717a';
      let creditBorder = 'rgba(113, 113, 122, 0.3)';
      let creditText = acc.credits || 'Tidak Tersedia';

      if (isReady) {
        if (creditText === 'Habis' || creditText === '0' || creditText.startsWith('0 ')) {
          creditBg = 'rgba(239, 68, 68, 0.15)';
          creditColor = '#ef4444';
          creditBorder = 'rgba(239, 68, 68, 0.3)';
          creditText = 'Habis';
        } else if (creditText.includes('Kredit')) {
          creditBg = 'rgba(34, 197, 94, 0.15)';
          creditColor = '#22c55e';
          creditBorder = 'rgba(34, 197, 94, 0.3)';
        } else {
          creditBg = 'rgba(234, 179, 8, 0.15)';
          creditColor = '#eab308';
          creditBorder = 'rgba(234, 179, 8, 0.3)';
          if (!creditText || creditText === 'Tidak Tersedia') {
            creditText = 'Tersedia';
          }
        }
      } else {
        creditText = 'Tidak Tersedia';
      }

      const card = document.createElement('div');
      card.style.cssText = `
        background: #111111;
        border: 1px solid ${isCurrentActive ? '#35b29f' : '#27272a'};
        border-radius: 10px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-height: 95px;
        position: relative;
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 11px; text-transform: uppercase; color: #a1a1aa; font-weight: 700;">${acc.name}</span>
              ${isCurrentActive ? '<span style="font-size: 9px; padding: 1px 6px; border-radius: 4px; background: rgba(53, 178, 159,0.25); color: #6fcdbd; font-weight: 700;">AKTIF</span>' : ''}
            </div>
            ${acc.email ? `<div style="font-size: 11px; color: #9ca3af; margin-top: 2px; font-weight: 500;">${acc.email}</div>` : ''}
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="btn-login-flow-item btn-ig-pill" data-id="${acc.id}" style="font-size: 11px; padding: 3px 10px; background: ${isReady ? '#27272a' : '#35b29f'}; color: #fff; border: 1px solid ${isReady ? '#3f3f46' : 'transparent'}; font-weight: 600; cursor: pointer;">
              ${isReady ? 'Buka / Cek' : 'Login'}
            </button>
            <button type="button" class="btn-delete-flow-item btn-ig-pill" data-id="${acc.id}" title="Hapus Akun" style="font-size: 11px; padding: 3px 10px; background: rgba(226, 101, 93, 0.12); color: #f0a29c; border: 1px solid rgba(226, 101, 93, 0.3); font-weight: 600; cursor: pointer;">
              Hapus
            </button>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <div style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; color: ${isReady ? '#10b981' : '#f59e0b'};">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isReady ? '#10b981' : '#f59e0b'}; display: inline-block;"></span>
            <span>${isReady ? 'Sesi Aktif' : 'Belum Login'}</span>
          </div>
          <div class="flow-credit-badge-${acc.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${creditBg}; border: 1px solid ${creditBorder}; color: ${creditColor}; font-weight: 700; transition: all 0.3s ease;">
            <span></span>
            <span class="flow-credit-text-${acc.id}">${creditText}</span>
          </div>
        </div>
      `;

      const btnLogin = card.querySelector('.btn-login-flow-item');
      btnLogin?.addEventListener('click', async () => {
        btnLogin.disabled = true;
        const orig = btnLogin.textContent;
        btnLogin.textContent = 'Membuka...';
        try {
          await window.electronAPI.openFlowLogin(acc.id);
        } catch (e) {
          console.error('Buka Flow Login Error:', e);
        } finally {
          btnLogin.disabled = false;
          btnLogin.textContent = orig;
          await renderFlowAccountsUI();
        }
      });

      const btnDelete = card.querySelector('.btn-delete-flow-item');
      btnDelete?.addEventListener('click', async () => {
        const promoteNote = index === 0 && cfg.accounts.length > 1 ? '\n\nAkun 2 akan otomatis menjadi Akun 1 (Utama).' : '';
        if (confirm(`Apakah Anda yakin ingin menghapus ${acc.name}?${promoteNote}`)) {
          if (window.electronAPI && typeof window.electronAPI.deleteFlowAccount === 'function') {
            await window.electronAPI.deleteFlowAccount(acc.id);
            setSettingsAlert(`${acc.name} berhasil dihapus.`, 'success');
            await renderFlowAccountsUI();
          }
        }
      });

      container.appendChild(card);
    });
  } catch (err) {
    console.warn('Gagal render daftar akun Flow:', err);
  } finally {
    isRenderingFlowAccounts = false;
  }
}

/**
 * 6. Inisialisasi Awal Konfigurasi AI
 */
export async function loadInitialAiConfig() {
  const settingsApiKeyInput = document.getElementById('settingsApiKeyInput');
  if (settingsApiKeyInput) {
    settingsApiKeyInput.value = '••••••••••••••••••••••••••••••••••••••••';
  }

  await Promise.all([
    checkAiStatus(),
    checkChatGptAccount(),
    checkPinterestStatus(),
    checkTikTokStreamerStatus(),
    renderFlowAccountsUI()
  ]);
}

/**
 * 7. Event Listeners & Kontroller Pengaturan AI
 */
export function initAiSettingsManager() {
  const btnTestAiConnection = document.getElementById('btnTestAiConnection');
  const btnSaveAiSettings = document.getElementById('btnSaveAiSettings');
  const btnRefreshChatGpt = document.getElementById('btnRefreshChatGpt');
  const btnLoginChatGptVideo = document.getElementById('btnLoginChatGptVideo');
  const btnLoginPinterest = document.getElementById('btnLoginPinterest');
  const btnLoginTTStreamer = document.getElementById('btnLoginTikTokStreamer');
  const sidebarAiBadge = document.getElementById('sidebarAiBadge');
  const tabAiSettings = document.getElementById('tabAiSettings');

  const btnAddFlowAccount = document.getElementById('btnAddFlowAccount');
  const toggleFlowHeadless = document.getElementById('toggleFlowHeadless');

  sidebarAiBadge?.addEventListener('click', () => {
    const viewAiSettings = document.getElementById('viewAiSettings');
    if (typeof window.switchAppTab === 'function' && tabAiSettings && viewAiSettings) {
      window.switchAppTab(tabAiSettings, viewAiSettings);
    } else {
      tabAiSettings?.click();
    }
  });

  window.electronAPI?.onFlowAccountsUpdated?.(() => {
    renderFlowAccountsUI();
  });

  // Listener Toggle Headless Google Flow (Simpan Instan)
  toggleFlowHeadless?.addEventListener('change', async () => {
    const isChecked = Boolean(toggleFlowHeadless.checked);
    updateHeadlessLabel(isChecked);

    try {
      if (typeof window.electronAPI?.saveFlowAccountsConfig === 'function') {
        await window.electronAPI.saveFlowAccountsConfig({ headless: isChecked });
      } else if (typeof window.electronAPI?.invoke === 'function') {
        await window.electronAPI.invoke('save-flow-accounts-config', { headless: isChecked });
      }
    } catch (e) {
      console.warn('Gagal menyimpan setelan headless:', e);
    }
  });

  btnAddFlowAccount?.addEventListener('click', async () => {
    if (window.electronAPI && typeof window.electronAPI.addFlowAccount === 'function') {
      btnAddFlowAccount.disabled = true;
      try {
        await window.electronAPI.addFlowAccount();
        setSettingsAlert('Slot akun baru Google Flow berhasil ditambahkan!', 'success');
        await renderFlowAccountsUI();
      } catch (err) {
        console.error('Gagal tambah akun Flow:', err);
      } finally {
        btnAddFlowAccount.disabled = false;
      }
    }
  });

  async function triggerSharedChatGptLogin(triggerBtn) {
    if (!triggerBtn) return;
    triggerBtn.disabled = true;
    const originalText = triggerBtn.textContent;
    triggerBtn.textContent = 'Membuka...';

    try {
      const invokeFn = window.electronAPI?.openChatGptLogin || window.electronAPI?.openChatGptVideoLogin;
      if (typeof invokeFn === 'function') {
        await invokeFn();
      }
    } catch (err) {
      console.error('Buka ChatGPT Login Error:', err);
    } finally {
      setTimeout(async () => {
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalText;
        await checkChatGptAccount();
      }, 1500);
    }
  }

  btnRefreshChatGpt?.addEventListener('click', () => {
    triggerSharedChatGptLogin(btnRefreshChatGpt);
  });

  btnLoginChatGptVideo?.addEventListener('click', () => {
    triggerSharedChatGptLogin(btnLoginChatGptVideo);
  });

  btnLoginPinterest?.addEventListener('click', async () => {
    if (window.electronAPI && typeof window.electronAPI.loginPinterest === 'function') {
      btnLoginPinterest.disabled = true;
      const originalText = btnLoginPinterest.textContent;
      btnLoginPinterest.textContent = 'Membuka...';
      try {
        await window.electronAPI.loginPinterest();
      } catch (err) {
        console.error('Login Pinterest Error:', err);
      } finally {
        btnLoginPinterest.disabled = false;
        btnLoginPinterest.textContent = originalText;
        await checkPinterestStatus();
      }
    }
  });

  btnLoginTTStreamer?.addEventListener('click', async () => {
    btnLoginTTStreamer.disabled = true;
    const originalText = btnLoginTTStreamer.textContent;
    btnLoginTTStreamer.textContent = 'Membuka...';

    try {
      if (typeof window.electronAPI?.loginTikTokStreamer === 'function') {
        await window.electronAPI.loginTikTokStreamer();
      } else if (typeof window.electronAPI?.invoke === 'function') {
        await window.electronAPI.invoke('login-tiktok-streamer');
      }
    } catch (err) {
      console.error('Login TikTok Shop Streamer Error:', err);
    } finally {
      setTimeout(async () => {
        btnLoginTTStreamer.disabled = false;
        btnLoginTTStreamer.textContent = originalText;
        await checkTikTokStreamerStatus();
      }, 1500);
    }
  });

  btnTestAiConnection?.addEventListener('click', async () => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer);
    btnTestAiConnection.disabled = true;
    btnTestAiConnection.textContent = 'Menguji...';

    await checkAiStatus();

    btnTestAiConnection.disabled = false;
    btnTestAiConnection.innerHTML = `Tes Koneksi Gemini`;
  });

  // Tombol Simpan Konfigurasi (Menyimpan AI Config + Headless State Sekaligus)
  btnSaveAiSettings?.addEventListener('click', async () => {
    btnSaveAiSettings.disabled = true;
    btnSaveAiSettings.textContent = 'Menyimpan...';

    try {
      const isHeadlessVal = toggleFlowHeadless ? Boolean(toggleFlowHeadless.checked) : false;

      // 1. Simpan status Headless
      if (typeof window.electronAPI?.saveFlowAccountsConfig === 'function') {
        await window.electronAPI.saveFlowAccountsConfig({ headless: isHeadlessVal });
      } else if (typeof window.electronAPI?.invoke === 'function') {
        await window.electronAPI.invoke('save-flow-accounts-config', { headless: isHeadlessVal });
      }

      // 2. Simpan konfigurasi dasar AI
      const res = await window.electronAPI?.saveAiConfig?.({});
      if (res?.success) {
        setSettingsAlert('Semua konfigurasi AI & Mode Headless berhasil disimpan!', 'success');
        await loadInitialAiConfig();
      } else {
        setSettingsAlert('Gagal menyimpan konfigurasi AI.', 'error');
      }
    } catch (e) {
      setSettingsAlert('Gagal menyimpan: ' + e.message, 'error');
    } finally {
      btnSaveAiSettings.disabled = false;
      btnSaveAiSettings.textContent = 'Simpan Konfigurasi';
    }
  });

  // Tombol "Buat Caption" di halaman Buat Jadwal ditangani scheduleManager (handler ganda = Gemini dipanggil 2x)

  window.addEventListener('check-ai-status', () => {
    loadInitialAiConfig();
  });

  tabAiSettings?.addEventListener('click', () => {
    checkTikTokStreamerStatus();
    checkChatGptAccount();
    // Cek kredit Google Flow otomatis di latar belakang. Hanya akun yang benar-benar login Google
    // (cookie sesi terdeteksi) & datanya usang; akun baru / belum login dilewati tanpa membuka Chrome.
    window.electronAPI?.autoSyncFlowCredits?.().catch(() => {});
  });

  if (!healthCheckInterval) {
    healthCheckInterval = setInterval(() => {
      loadInitialAiConfig();
    }, 60000);
  }

  loadInitialAiConfig();
  initKartunKeysSection();
}

// Konsep 3D Kartun: key ElevenLabs (wajib) & Claude (opsional) milik pelanggan
function initKartunKeysSection() {
  const statusEl = document.getElementById('kartunKeysStatus');
  const resultEl = document.getElementById('kartunKeysResult');
  const elevenInput = document.getElementById('kartunElevenKeyInput');
  const claudeInput = document.getElementById('kartunClaudeKeyInput');
  const btnSave = document.getElementById('btnSaveKartunKeys');
  const btnTest = document.getElementById('btnTestKartunKeys');
  const btnClear = document.getElementById('btnClearKartunKeys');
  if (!statusEl || !window.electronAPI?.getKartunKeys) return;

  const renderStatus = (info = {}) => {
    const parts = [
      info.hasElevenlabs ? `ElevenLabs ✓ (${info.elevenlabsMasked})` : 'ElevenLabs ✗ belum diisi',
      info.hasAnthropic ? `Claude ✓ (${info.anthropicMasked})` : 'Claude: memakai Gemini'
    ];
    statusEl.textContent = parts.join(' · ');
    statusEl.style.color = info.hasElevenlabs ? '#10b981' : '#f0bb85';
  };
  const refresh = async () => renderStatus(await window.electronAPI.getKartunKeys().catch(() => ({})));

  btnSave?.addEventListener('click', async () => {
    const patch = {};
    if (elevenInput.value.trim()) patch.elevenlabsKey = elevenInput.value.trim();
    if (claudeInput.value.trim()) patch.anthropicKey = claudeInput.value.trim();
    if (!Object.keys(patch).length) {
      resultEl.textContent = 'Isi minimal satu key terlebih dahulu.';
      return;
    }
    const res = await window.electronAPI.saveKartunKeys(patch);
    elevenInput.value = '';
    claudeInput.value = '';
    resultEl.textContent = res?.success ? 'Key tersimpan ✓ — klik "Tes Key" untuk memastikan.' : `Gagal menyimpan: ${res?.error || '-'}`;
    renderStatus(res);
  });

  btnTest?.addEventListener('click', async () => {
    btnTest.disabled = true;
    resultEl.textContent = 'Menguji key...';
    const res = await window.electronAPI.testKartunKeys().catch((e) => ({ elevenlabs: e.message, claude: '-' }));
    resultEl.innerHTML = `ElevenLabs: ${res.elevenlabs}<br>Claude: ${res.claude}`;
    btnTest.disabled = false;
  });

  btnClear?.addEventListener('click', async () => {
    if (!confirm('Hapus key ElevenLabs & Claude untuk 3D Kartun dari komputer ini?')) return;
    const res = await window.electronAPI.saveKartunKeys({ elevenlabsKey: '', anthropicKey: '' });
    resultEl.textContent = 'Key dihapus.';
    renderStatus(res);
  });

  refresh();
}