/**
 * src/renderer/js/modules/tabNavigation.js
 * Manajemen Navigasi Antar Tab View Aplikasi
 */

export function initTabNavigation() {
  // Tombol Tab Sidebar
  const tabAutoPilot = document.getElementById('tabAutoPilot');
  const tabSchedule = document.getElementById('tabSchedule');
  const tabAiImage = document.getElementById('tabAiImage');
  const tabGallery = document.getElementById('tabGallery');
  const tabAiVideo = document.getElementById('tabAiVideo');
  const tabVideoGallery = document.getElementById('tabVideoGallery');
  const tabShowcase = document.getElementById('tabShowcase');
  const tabProfile = document.getElementById('tabProfile');
  const tabAiSettings = document.getElementById('tabAiSettings');
  const sidebarAiBadge = document.getElementById('sidebarAiBadge');
  const btnSidebarProfile = document.getElementById('btnSidebarProfile');

  // Kontainer Halaman View
  const viewAutoPilot = document.getElementById('viewAutoPilot');
  const viewSchedule = document.getElementById('viewSchedule');
  const viewAiImage = document.getElementById('viewAiImage');
  const viewGallery = document.getElementById('viewGallery');
  const viewAiVideo = document.getElementById('viewAiVideo');
  const viewVideoGallery = document.getElementById('viewVideoGallery');
  const viewShowcase = document.getElementById('viewShowcase');
  const viewProfile = document.getElementById('viewProfile');
  const viewAiSettings = document.getElementById('viewAiSettings');
  const viewAccounts = document.getElementById('viewAccounts');

  const tabs = [
    tabAutoPilot,
    tabSchedule,
    tabAiImage,
    tabGallery,
    tabAiVideo,
    tabVideoGallery,
    tabShowcase,
    tabProfile,
    tabAiSettings
  ];

  const views = [
    viewAutoPilot,
    viewSchedule,
    viewAiImage,
    viewGallery,
    viewAiVideo,
    viewVideoGallery,
    viewShowcase,
    viewProfile,
    viewAiSettings,
    viewAccounts
  ];

  // ===== Kunci halaman per akun saat BELUM ada akun login =====
  // Isi halaman asli tidak disentuh — hanya disembunyikan & diganti halaman gembok bersama.
  // Pengaturan AI & Kelola Akun tetap bisa dibuka.
  const lockedViews = [viewSchedule, viewAiImage, viewGallery, viewAiVideo, viewVideoGallery, viewShowcase, viewProfile].filter(Boolean);
  const viewLocked = document.createElement('div');
  viewLocked.id = 'viewLocked';
  viewLocked.className = 'view-container';
  viewLocked.style.display = 'none';
  viewLocked.innerHTML = `
    <div style="max-width:520px;margin:90px auto;text-align:center;padding:40px 32px;border:1px solid var(--border-subtle, rgba(255,255,255,0.08));border-radius:16px;background:rgba(255,255,255,0.02)">
      <div style="width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Halaman terkunci</div>
      <div style="font-size:13px;opacity:.75;line-height:1.6;margin-bottom:22px">Belum ada akun yang login. Jadwal, gambar, video & galeri tersimpan per akun — silakan login / tambah akun dulu.</div>
      <button type="button" id="btnLockedLogin" class="btn-execute" style="width:auto;padding:0 22px;height:40px;font-size:13px;font-weight:700">Login / Tambah Akun</button>
    </div>`;
  (viewSchedule?.parentElement || document.body).appendChild(viewLocked);
  viewLocked.querySelector('#btnLockedLogin')?.addEventListener('click', () => {
    window.dispatchEvent(new Event('open-accounts-view'));
  });
  views.push(viewLocked);

  let hasAccount = null;      // null = belum diketahui (jangan kunci dulu)
  let lastReq = null;         // tab/view yang terakhir diminta pengguna
  async function refreshAccountLock() {
    const data = await window.electronAPI?.getAllAccounts?.().catch(() => null);
    const list = Array.isArray(data) ? data : (data?.accounts || []);
    const prev = hasAccount;
    hasAccount = list.length > 0;
    if (prev !== hasAccount && lastReq) switchTab(lastReq[0], lastReq[1], true);
  }

  function switchTab(activeTab, activeView, _fromRefresh = false) {
    if (!activeView) return;
    lastReq = [activeTab, activeView];
    if (!_fromRefresh) refreshAccountLock();   // cek ulang status akun (mis. baru tambah akun)
    const locked = hasAccount === false && lockedViews.includes(activeView);

    // 1. Nonaktifkan semua status active pada tab sidebar
    tabs.forEach((tab) => {
      tab?.classList.remove('active');
    });

    // 2. Sembunyikan semua kontainer view
    views.forEach((view) => {
      if (view) {
        view.classList.remove('active-view');
        view.style.display = 'none';
      }
    });

    // 3. Aktifkan tab dan view terpilih
    if (activeTab) {
      activeTab.classList.add('active');
    }
    if (locked) {                       // belum login → tampilkan halaman gembok, jangan muat data
      viewLocked.classList.add('active-view');
      viewLocked.style.display = 'block';
      return;
    }
    activeView.classList.add('active-view');
    activeView.style.display = 'block';

    // 4. Picu event pembaruan data spesifik per tab
    if (activeView === viewSchedule) {
      window.dispatchEvent(new CustomEvent('refresh-schedules'));
    } else if (activeView === viewGallery) {
      window.dispatchEvent(new CustomEvent('refresh-image-storage'));
    } else if (activeView === viewAiVideo || activeView === viewVideoGallery) {
      // Sinkronkan form Reels sesuai platform aktif (Instagram vs TikTok Showcase)
      window.electronAPI?.getSessionInfo?.().then((session) => {
        const isTikTok = true; // Semua platform memakai alur Pilih Konsep video (dulu Instagram punya form sendiri)

        const containerIg = document.getElementById('containerInstagramVideoForm');
        const containerTt = document.getElementById('containerTikTokVideoForm');
        const badgeIg = document.getElementById('flowBadgeInstagram');
        const badgeTt = document.getElementById('flowBadgeTikTok');

        if (containerIg) containerIg.style.display = isTikTok ? 'none' : 'block';
        if (containerTt) containerTt.style.display = isTikTok ? 'block' : 'none';
        if (badgeIg) badgeIg.style.display = isTikTok ? 'none' : 'flex';
        if (badgeTt) badgeTt.style.display = isTikTok ? 'flex' : 'none';
      }).catch(() => {});

      window.dispatchEvent(new CustomEvent('refresh-video-storage'));
    } else if (activeView === viewShowcase) {
      window.dispatchEvent(new CustomEvent('load-showcase'));
    } else if (activeView === viewProfile) {
      window.dispatchEvent(new CustomEvent('load-feed'));
    } else if (activeView === viewAiSettings) {
      window.dispatchEvent(new CustomEvent('check-ai-status'));
    } else if (activeView === viewAccounts) {
      window.dispatchEvent(new CustomEvent('load-accounts-list'));
    }
  }

  // Ekspos fungsi ke lingkup global agar dapat dipanggil dari modul lain
  window.switchAppTab = switchTab;

  // Event listener klik tombol navigasi sidebar
  tabAutoPilot?.addEventListener('click', () => switchTab(tabAutoPilot, viewAutoPilot));
  tabSchedule?.addEventListener('click', () => switchTab(tabSchedule, viewSchedule));
  tabAiImage?.addEventListener('click', () => switchTab(tabAiImage, viewAiImage));
  tabGallery?.addEventListener('click', () => switchTab(tabGallery, viewGallery));
  tabAiVideo?.addEventListener('click', () => switchTab(tabAiVideo, viewAiVideo));
  tabVideoGallery?.addEventListener('click', () => switchTab(tabVideoGallery, viewVideoGallery));
  tabShowcase?.addEventListener('click', () => switchTab(tabShowcase, viewShowcase));
  tabProfile?.addEventListener('click', () => switchTab(tabProfile, viewProfile));
  tabAiSettings?.addEventListener('click', () => switchTab(tabAiSettings, viewAiSettings));

  // Klik badge status AI di sidebar bawah mengarahkan ke tab Pengaturan AI
  sidebarAiBadge?.addEventListener('click', () => switchTab(tabAiSettings, viewAiSettings));

  // Klik badge profil di sidebar bawah membuka halaman kelola multi-akun
  // Badge profil kini membuka pemilih akun (accountSwitcher.js); menu "Kelola Akun" memicu event ini
  window.addEventListener('open-accounts-view', () => switchTab(null, viewAccounts));

  // Tampilan awal saat aplikasi pertama kali dimuat
  switchTab(tabSchedule, viewSchedule);
}