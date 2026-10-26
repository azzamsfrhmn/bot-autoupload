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

  function switchTab(activeTab, activeView) {
    if (!activeView) return;

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
        const isTikTok = session?.platform === 'tiktok';

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
  btnSidebarProfile?.addEventListener('click', (event) => {
    if (event.target.closest('#btnLogout')) return;
    switchTab(null, viewAccounts);
  });

  // Tampilan awal saat aplikasi pertama kali dimuat
  switchTab(tabSchedule, viewSchedule);
}