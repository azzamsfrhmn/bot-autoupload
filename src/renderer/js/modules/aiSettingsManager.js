/**
 * src/renderer/js/modules/aiSettingsManager.js
 * Manajemen Konfigurasi AI (Google Gemini, ChatGPT Plus Gambar/Video, Pinterest, TikTok Shop Streamer, & Penampungan Multi-Akun Google Flow)
 */

import { getSelectedMediaFiles } from './scheduleManager.js';

let autoRetryTimer = null;
let healthCheckInterval = null;
let isCheckingGemini = false;
let isCheckingChatGpt = false;
let isCheckingPinterest = false;
let isCheckingTTStreamer = false;
let isRenderingFlowAccounts = false;

// Helper untuk menampilkan notifikasi alert pada halaman settings
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
 * Otomatis menjadwalkan tes ulang koneksi Gemini jika ada kendala jaringan/server[cite: 19]
 */
function scheduleAutoRetry(delaySeconds = 8, keyToTest = null) {
  if (autoRetryTimer) clearTimeout(autoRetryTimer);

  let countdown = delaySeconds;
  const sidebarAiText = document.getElementById('sidebarAiText');
  const detail = document.getElementById('aiStatusDetail');

  const updateCountdownDisplay = () => {
    if (sidebarAiText) sidebarAiText.textContent = `Retry (${countdown}s)...`;
    if (detail) detail.textContent = `Server sibuk / bermasalah. Mencoba koneksi ulang otomatis dalam ${countdown} detik...`;
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
    await checkAiStatus(keyToTest, true);
  }, delaySeconds * 1000);
}

/**
 * 1. PEMERIKSAAN STATUS KONEKSI GEMINI (CAPTION & HASHTAG)[cite: 19]
 */
export async function checkAiStatus(keyToTest = null, isAutoRetry = false) {
  if (isCheckingGemini) return;
  isCheckingGemini = true;

  const badge = document.getElementById('aiConnectionStatusBadge');
  const detail = document.getElementById('aiStatusDetail');
  const sidebarAiDot = document.getElementById('sidebarAiDot');
  const sidebarAiText = document.getElementById('sidebarAiText');
  const settingsApiKeyInput = document.getElementById('settingsApiKeyInput');

  let activeKey = keyToTest || (settingsApiKeyInput ? settingsApiKeyInput.value.trim() : null);
  if (!activeKey && window.electronAPI && typeof window.electronAPI.getAiConfig === 'function') {
    try {
      const cfg = await window.electronAPI.getAiConfig();
      if (cfg && cfg.geminiApiKey) {
        activeKey = cfg.geminiApiKey;
        if (settingsApiKeyInput) settingsApiKeyInput.value = activeKey;
      }
    } catch (e) {
      console.warn('Gagal memuat API key Gemini tersimpan:', e);
    }
  }

  if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-checking';
  if (sidebarAiText) sidebarAiText.textContent = isAutoRetry ? 'Menghubungkan Ulang...' : 'AI Memeriksa...';

  if (badge) {
    badge.innerHTML = `
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #eab308; display: inline-block;"></span>
      Memeriksa...
    `;
    badge.style.color = '#eab308';
  }
  if (detail) detail.textContent = 'Menghubungkan ke Google Gemini...';

  try {
    const res = await window.electronAPI.testAiConnection(activeKey);

    if (res?.success) {
      if (autoRetryTimer) clearTimeout(autoRetryTimer);

      if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-connected';
      if (sidebarAiText) sidebarAiText.textContent = 'AI Terhubung';

      if (badge) {
        badge.innerHTML = `
          <span style="width: 10px; height: 10px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
          Terhubung
        `;
        badge.style.color = '#10b981';
      }
      if (detail) detail.textContent = res.message || 'Gemini siap & terhubung (Respon: OK)';
    } else {
      const errorMsg = res ? res.message : 'Koneksi gagal.';

      if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-disconnected';
      if (sidebarAiText) sidebarAiText.textContent = 'AI Offline';

      if (badge) {
        badge.innerHTML = `
          <span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
          Bermasalah
        `;
        badge.style.color = '#ef4444';
      }
      if (detail) detail.textContent = errorMsg;

      if (activeKey) {
        scheduleAutoRetry(8, activeKey);
      }
    }
  } catch (err) {
    const errorMsg = err.message || 'Kendala jaringan';
    if (sidebarAiDot) sidebarAiDot.className = 'ai-status-dot dot-disconnected';
    if (sidebarAiText) sidebarAiText.textContent = 'AI Offline';

    if (badge) {
      badge.innerHTML = `
        <span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
        Bermasalah
      `;
      badge.style.color = '#ef4444';
    }
    if (detail) detail.textContent = errorMsg;

    if (activeKey) {
      scheduleAutoRetry(10, activeKey);
    }
  } finally {
    isCheckingGemini = false;
  }
}

/**
 * 2. PEMERIKSAAN STATUS SESI AKUN CHATGPT (GAMBAR & VIDEO)[cite: 19]
 */
export async function checkChatGptAccount() {
  if (isCheckingChatGpt) return;
  isCheckingChatGpt = true;

  const statusBadge = document.getElementById('chatgptStatusBadge');
  const emailDetail = document.getElementById('chatgptAccountEmail');
  const chatgptVideoStatusBadge = document.getElementById('chatgptVideoStatusBadge');

  if (statusBadge) {
    statusBadge.style.color = '#10a37f';
    statusBadge.innerHTML = `
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #10a37f; display: inline-block;"></span>
      <span id="chatgptStatusText">ChatGPT Gambar</span>
    `;
  }
  if (emailDetail) {
    emailDetail.textContent = 'Sesi Banner DALL·E 3 siap';
  }

  if (chatgptVideoStatusBadge) {
    chatgptVideoStatusBadge.style.color = '#a78bfa';
    chatgptVideoStatusBadge.innerHTML = `
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #7c3aed; display: inline-block;"></span>
      <span>ChatGPT Video</span>
    `;
  }

  isCheckingChatGpt = false;
}

/**
 * 3. PEMERIKSAAN STATUS SESI AKUN PINTEREST[cite: 19]
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
        if (badge) badge.style.color = '#eab308';
        if (dot) dot.style.background = '#eab308';
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
 * 4. PEMERIKSAAN STATUS SESI AKUN TIKTOK SHOP STREAMER DESKTOP (Diperbaiki Komprehensif)[cite: 19]
 */
export async function checkTikTokStreamerStatus() {
  if (isCheckingTTStreamer) return;
  isCheckingTTStreamer = true;

  try {
    let res = null;

    // Evaluasi semua jalur komunikasi IPC[cite: 19]
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

    // Cari seluruh elemen target baik lewat ID maupun query DOM terdekat[cite: 19]
    const dot = document.getElementById('ttStreamerStatusDot');
    const text = document.getElementById('ttStreamerStatusText');
    const detail = document.getElementById('ttStreamerAccountDetail');
    const btn = document.getElementById('btnLoginTikTokStreamer');
    const statusBadge = document.getElementById('ttStreamerStatusBadge');

    // Selektor container kartu untuk pencarian cadangan jika ID tidak langsung ditemukan
    const allCards = Array.from(document.querySelectorAll('.studio-card, .setting-card, div'));
    const streamerCard = allCards.find(el => el.textContent && el.textContent.includes('TIKTOK SHOP STREAMER'));

    const targetDot = dot || streamerCard?.querySelector('span[style*="border-radius: 50%"], .status-dot, span:first-child');
    const targetText = text || streamerCard?.querySelector('strong, span[style*="color"], div:has(> span) > span:last-child');
    const targetBtn = btn || streamerCard?.querySelector('button');
    const targetDetail = detail || streamerCard?.querySelector('p, div[style*="font-size: 11px"], div[style*="color: #9ca3af"]');

    if (isLoggedIn) {
      if (targetDot) {
        targetDot.style.setProperty('background', '#10b981', 'important');
      }
      if (targetText) {
        targetText.textContent = 'Sesi Aktif';
        targetText.style.setProperty('color', '#10b981', 'important');
      }
      if (statusBadge) {
        statusBadge.style.setProperty('color', '#10b981', 'important');
      }
      if (targetDetail) {
        targetDetail.textContent = 'Streamer & Etalase terhubung.';
      }
      if (targetBtn) {
        targetBtn.textContent = 'Buka / Cek';
        targetBtn.style.setProperty('background', '#27272a', 'important');
        targetBtn.style.setProperty('border', '1px solid #3f3f46', 'important');
        targetBtn.style.setProperty('color', '#ffffff', 'important');
      }
    } else {
      if (targetDot) {
        targetDot.style.setProperty('background', '#f59e0b', 'important');
      }
      if (targetText) {
        targetText.textContent = 'Belum Login';
        targetText.style.setProperty('color', '#f59e0b', 'important');
      }
      if (statusBadge) {
        statusBadge.style.setProperty('color', '#f59e0b', 'important');
      }
      if (targetDetail) {
        targetDetail.textContent = 'Portal Streamer & Etalase';
      }
      if (targetBtn) {
        targetBtn.textContent = 'Login';
        targetBtn.style.setProperty('background', '#2563eb', 'important');
        targetBtn.style.setProperty('border', '1px solid transparent', 'important');
        targetBtn.style.setProperty('color', '#ffffff', 'important');
      }
    }
  } catch (e) {
    console.warn('[TikTok Streamer Check Error]:', e);
  } finally {
    isCheckingTTStreamer = false;
  }
}

/**
 * 5. MANAJEMEN PENAMPUNGAN MULTI-AKUN GOOGLE FLOW DENGAN AUTO-SYNC KREDIT SILENT[cite: 19]
 */
export async function renderFlowAccountsUI() {
  if (isRenderingFlowAccounts) return;
  const container = document.getElementById('flowAccountsList');
  if (!container || !window.electronAPI?.getFlowAccounts) return;

  isRenderingFlowAccounts = true;
  try {
    const cfg = await window.electronAPI.getFlowAccounts();
    if (!cfg || !Array.isArray(cfg.accounts)) return;

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
        border: 1px solid ${isCurrentActive ? '#2563eb' : '#27272a'};
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
              ${isCurrentActive ? '<span style="font-size: 9px; padding: 1px 6px; border-radius: 4px; background: rgba(37,99,235,0.25); color: #93c5fd; font-weight: 700;">AKTIF</span>' : ''}
            </div>
            ${acc.email ? `<div style="font-size: 11px; color: #9ca3af; margin-top: 2px; font-weight: 500;">✉️ ${acc.email}</div>` : ''}
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="btn-login-flow-item btn-ig-pill" data-id="${acc.id}" style="font-size: 11px; padding: 3px 10px; background: ${isReady ? '#27272a' : '#2563eb'}; color: #fff; border: 1px solid ${isReady ? '#3f3f46' : 'transparent'}; font-weight: 600; cursor: pointer;">
              ${isReady ? 'Buka / Cek' : 'Login'}
            </button>
            ${index > 0 ? `
              <button type="button" class="btn-delete-flow-item btn-ig-pill" data-id="${acc.id}" title="Hapus Akun Cadangan" style="font-size: 11px; padding: 3px 8px; background: #27272a; color: #ef4444; border: 1px solid #3f3f46; cursor: pointer;">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <div style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; color: ${isReady ? '#10b981' : '#eab308'};">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isReady ? '#10b981' : '#eab308'}; display: inline-block;"></span>
            <span>${isReady ? 'Sesi Aktif' : 'Belum Login'}</span>
          </div>
          <div class="flow-credit-badge-${acc.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${creditBg}; border: 1px solid ${creditBorder}; color: ${creditColor}; font-weight: 700; transition: all 0.3s ease;">
            <span>🪙</span>
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
        if (confirm(`Apakah Anda yakin ingin menghapus ${acc.name}?`)) {
          if (window.electronAPI && typeof window.electronAPI.deleteFlowAccount === 'function') {
            await window.electronAPI.deleteFlowAccount(acc.id);
            setSettingsAlert(`${acc.name} berhasil dihapus.`, 'success');
            await renderFlowAccountsUI();
          }
        }
      });

      container.appendChild(card);

      if (isReady && (!acc.credits || acc.credits === 'Tersedia' || acc.credits === 'Tidak Tersedia')) {
        const creditBadge = card.querySelector(`.flow-credit-badge-${acc.id}`);
        const creditSpan = card.querySelector(`.flow-credit-text-${acc.id}`);
        
        if (creditSpan) {
          creditSpan.textContent = 'Sinkron...';
        }

        window.electronAPI?.syncFlowAccountCredits?.(acc.id).then((res) => {
          if (res?.success && res.credits && creditSpan && creditBadge) {
            creditSpan.textContent = res.credits;
            creditBadge.style.background = 'rgba(34, 197, 94, 0.15)';
            creditBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
            creditBadge.style.color = '#22c55e';
          } else if (creditSpan) {
            creditSpan.textContent = acc.credits || 'Tersedia';
          }
        }).catch(() => {
          if (creditSpan) creditSpan.textContent = acc.credits || 'Tersedia';
        });
      }
    });
  } catch (err) {
    console.warn('Gagal render daftar akun Flow:', err);
  } finally {
    isRenderingFlowAccounts = false;
  }
}

/**
 * 6. INISIALISASI AWAL KONFIGURASI AI[cite: 19]
 */
export async function loadInitialAiConfig() {
  const settingsApiKeyInput = document.getElementById('settingsApiKeyInput');
  try {
    if (window.electronAPI && typeof window.electronAPI.getAiConfig === 'function') {
      const cfg = await window.electronAPI.getAiConfig();
      if (cfg && cfg.geminiApiKey) {
        if (settingsApiKeyInput) settingsApiKeyInput.value = cfg.geminiApiKey;
      }
    }
  } catch (err) {
    console.warn('Gagal load config awal AI:', err);
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
 * 7. EVENT LISTENERS & KONTROLLER PENGATURAN AI[cite: 19]
 */
export function initAiSettingsManager() {
  const settingsApiKeyInput = document.getElementById('settingsApiKeyInput');
  const btnToggleShowKey = document.getElementById('btnToggleShowKey');
  const btnTestAiConnection = document.getElementById('btnTestAiConnection');
  const btnSaveAiSettings = document.getElementById('btnSaveAiSettings');
  const btnRefreshChatGpt = document.getElementById('btnRefreshChatGpt');
  const btnLoginChatGptVideo = document.getElementById('btnLoginChatGptVideo');
  const btnLoginPinterest = document.getElementById('btnLoginPinterest');
  const btnLoginTTStreamer = document.getElementById('btnLoginTikTokStreamer');
  const sidebarAiBadge = document.getElementById('sidebarAiBadge');
  const tabAiSettings = document.getElementById('tabAiSettings');

  const btnAddFlowAccount = document.getElementById('btnAddFlowAccount');
  const btnTestFlowActive = document.getElementById('btnTestFlowActive');

  const btnGenerateAI = document.getElementById('btnGenerateAI');
  const aiPromptInput = document.getElementById('aiPromptInput');
  const aiToneSelect = document.getElementById('aiToneSelect');
  const captionInput = document.getElementById('captionInput');
  const captionCounter = document.getElementById('captionCounter');

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

  btnTestFlowActive?.addEventListener('click', async () => {
    if (window.electronAPI && typeof window.electronAPI.getFlowAccounts === 'function') {
      btnTestFlowActive.disabled = true;
      const orig = btnTestFlowActive.textContent;
      btnTestFlowActive.textContent = 'Membuka...';
      try {
        const cfg = await window.electronAPI.getFlowAccounts();
        const activeId = cfg?.activeAccountId || 'acc_1';
        await window.electronAPI.openFlowLogin(activeId);
        await renderFlowAccountsUI();
      } catch (err) {
        console.error('Gagal buka akun aktif Flow:', err);
      } finally {
        btnTestFlowActive.disabled = false;
        btnTestFlowActive.textContent = orig;
      }
    }
  });

  btnRefreshChatGpt?.addEventListener('click', async () => {
    if (window.electronAPI && typeof window.electronAPI.openChatGptLogin === 'function') {
      btnRefreshChatGpt.disabled = true;
      btnRefreshChatGpt.textContent = 'Membuka...';

      try {
        await window.electronAPI.openChatGptLogin();
      } catch (err) {
        console.error('Buka ChatGPT Gambar Login Error:', err);
      } finally {
        btnRefreshChatGpt.disabled = false;
        btnRefreshChatGpt.textContent = 'Login / Buka';
        await checkChatGptAccount();
      }
    } else {
      checkChatGptAccount();
    }
  });

  btnLoginChatGptVideo?.addEventListener('click', async () => {
    if (window.electronAPI && typeof window.electronAPI.openChatGptVideoLogin === 'function') {
      btnLoginChatGptVideo.disabled = true;
      btnLoginChatGptVideo.textContent = 'Membuka...';

      try {
        await window.electronAPI.openChatGptVideoLogin();
      } catch (err) {
        console.error('Buka ChatGPT Video Login Error:', err);
      } finally {
        btnLoginChatGptVideo.disabled = false;
        btnLoginChatGptVideo.textContent = 'Login / Buka';
        await checkChatGptAccount();
      }
    } else {
      checkChatGptAccount();
    }
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

  // Tombol Login / Buka Akun TikTok Shop Streamer Desktop[cite: 19]
  btnLoginTTStreamer?.addEventListener('click', async () => {
    const isApiAvailable = window.electronAPI && (
      typeof window.electronAPI.loginTikTokStreamer === 'function' || 
      typeof window.electronAPI.invoke === 'function'
    );

    if (!isApiAvailable) {
      alert('Fungsi loginTikTokStreamer belum terdaftar di preload.js!');
      return;
    }

    btnLoginTTStreamer.disabled = true;
    const originalText = btnLoginTTStreamer.textContent;
    btnLoginTTStreamer.textContent = 'Membuka...';

    try {
      let res = null;
      if (typeof window.electronAPI.loginTikTokStreamer === 'function') {
        res = await window.electronAPI.loginTikTokStreamer();
      } else {
        res = await window.electronAPI.invoke('login-tiktok-streamer');
      }

      if (res && res.success === false) {
        alert('Gagal membuka Chrome Streamer: ' + (res.error || 'Terjadi kesalahan sistem.'));
      }
    } catch (err) {
      console.error('Login TikTok Shop Streamer Error:', err);
      alert('Terjadi kesalahan: ' + err.message);
    } finally {
      setTimeout(async () => {
        btnLoginTTStreamer.disabled = false;
        btnLoginTTStreamer.textContent = originalText;
        await checkTikTokStreamerStatus();
      }, 1500);
    }
  });

  btnToggleShowKey?.addEventListener('click', () => {
    if (settingsApiKeyInput.type === 'password') {
      settingsApiKeyInput.type = 'text';
      btnToggleShowKey.textContent = '🔒 Sembunyikan';
    } else {
      settingsApiKeyInput.type = 'password';
      btnToggleShowKey.textContent = '👁 Lihat';
    }
  });

  btnTestAiConnection?.addEventListener('click', async () => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer);
    const key = settingsApiKeyInput.value.trim();
    btnTestAiConnection.disabled = true;
    btnTestAiConnection.textContent = 'Menguji...';

    await checkAiStatus(key);

    btnTestAiConnection.disabled = false;
    btnTestAiConnection.innerHTML = `
      <svg style="width: 16px; height: 16px; fill: currentColor;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
      Tes Koneksi Gemini
    `;
  });

  btnSaveAiSettings?.addEventListener('click', async () => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer);
    const key = settingsApiKeyInput.value.trim();
    btnSaveAiSettings.disabled = true;
    btnSaveAiSettings.textContent = 'Menyimpan...';

    const res = await window.electronAPI.saveAiConfig({ geminiApiKey: key });
    if (res?.success) {
      setSettingsAlert('Semua konfigurasi AI berhasil disimpan!', 'success');
      await Promise.all([
        checkAiStatus(key),
        checkChatGptAccount(),
        checkPinterestStatus(),
        checkTikTokStreamerStatus(),
        renderFlowAccountsUI()
      ]);
    } else {
      setSettingsAlert('Gagal menyimpan konfigurasi AI.', 'error');
    }

    btnSaveAiSettings.disabled = false;
    btnSaveAiSettings.textContent = '💾 Simpan Semua Konfigurasi';
  });

  btnGenerateAI?.addEventListener('click', async () => {
    const prompt = aiPromptInput?.value.trim() || '';
    const tone = aiToneSelect?.value || 'promo';

    btnGenerateAI.disabled = true;
    btnGenerateAI.innerHTML = `Sedang Menulis...`;

    try {
      const res = await window.electronAPI.generateCaption({
        prompt: prompt,
        tone: tone,
        mediaFiles: getSelectedMediaFiles()
      });

      if (res?.success && res.caption) {
        if (captionInput) {
          captionInput.value = res.caption;
          if (captionCounter) captionCounter.textContent = `${captionInput.value.length} / 2.200`;
        }
      } else {
        alert('Gagal membuat caption: ' + (res.error || 'Terjadi kendala.'));
        checkAiStatus();
      }
    } catch (err) {
      console.error('AI Caption Error:', err);
      checkAiStatus();
    } finally {
      btnGenerateAI.disabled = false;
      btnGenerateAI.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M7.5 5.6L10 0l2.5 5.6L18 8l-5.5 2.4L10 16 7.5 10.4 2 8l5.5-2.4zm10 8.4l1.5-3.4 1.5 3.4 3.5 1.6-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.6z"/></svg>
        Buat Caption AI
      `;
    }
  });

  window.addEventListener('check-ai-status', () => {
    checkAiStatus();
    checkChatGptAccount();
    checkPinterestStatus();
    checkTikTokStreamerStatus();
    renderFlowAccountsUI();
  });

  // Sinkronisasi otomatis setiap tab Pengaturan AI diklik[cite: 19]
  tabAiSettings?.addEventListener('click', () => {
    checkTikTokStreamerStatus();
  });

  const tabButtons = document.querySelectorAll('#tabAiSettings, [data-tab="settings"], [data-view="viewAiSettings"]');
  tabButtons.forEach((btnEl) => {
    btnEl.addEventListener('click', () => {
      checkTikTokStreamerStatus();
    });
  });

  if (!healthCheckInterval) {
    healthCheckInterval = setInterval(() => {
      checkAiStatus();
      checkChatGptAccount();
      checkPinterestStatus();
      checkTikTokStreamerStatus();
      renderFlowAccountsUI();
    }, 60000);
  }

  loadInitialAiConfig();
}