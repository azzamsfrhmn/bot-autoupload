/**
 * src/renderer/js/componentLoader.js
 * Pemuat komponen parsial HTML agar dashboard.html tetap ringkas
 */
export async function loadDashboardComponents() {
  const views = [
    { id: 'viewAutoPilot', file: 'views/autoPilot.html' },
    { id: 'viewSchedule', file: 'views/schedule.html' },
    { id: 'viewAiImage', file: 'views/aiImage.html' },
    { id: 'viewGallery', file: 'views/gallery.html' },
    { id: 'viewAiVideo', file: 'views/aiVideo.html' },
    { id: 'viewVideoGallery', file: 'views/videoGallery.html' },
    { id: 'viewShowcase', file: 'views/showcase.html' },
    { id: 'viewProfile', file: 'views/profile.html' },
    { id: 'viewAiSettings', file: 'views/aiSettings.html' },
    { id: 'viewAccounts', file: 'views/accounts.html' }
  ];

  await Promise.all([
    ...views.map(async (v) => {
      const el = document.getElementById(v.id);
      if (el) {
        const res = await fetch(v.file);
        el.innerHTML = await res.text();
      }
    }),
    (async () => {
      const modalBox = document.getElementById('modalsContainer');
      if (modalBox) {
        const res = await fetch('views/modals.html');
        modalBox.innerHTML = await res.text();
      }
    })()
  ]);
}