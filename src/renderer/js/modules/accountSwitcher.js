/**
 * Pemilih akun di sidebar: klik badge profil → daftar semua akun (TikTok & Instagram).
 * Pilih akun → sesi dialihkan & dashboard dimuat ulang untuk akun tersebut.
 */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

function platformOf(acc) {
  const p = String(acc.platform || '').toLowerCase();
  const id = String(acc.id || '').toLowerCase();
  if (p === 'facebook' || id.startsWith('fbpage_')) return 'facebook';
  if (p === 'shopee' || id.startsWith('shopee_')) return 'shopee';
  if (p === 'youtube' || id.startsWith('yt_')) return 'youtube';
  return p === 'tiktok' || id.startsWith('tiktok_') || id.startsWith('tt_') ? 'tiktok' : 'instagram';
}

export function initAccountSwitcher() {
  const badge = document.getElementById('btnSidebarProfile');
  if (!badge) return;
  const footer = badge.closest('.sidebar-footer') || badge.parentElement;

  const menu = document.createElement('div');
  menu.id = 'accountSwitcherMenu';
  menu.className = 'account-switcher-menu';
  menu.hidden = true;
  footer.appendChild(menu);

  const close = () => { menu.hidden = true; badge.classList.remove('is-open'); };

  async function render() {
    menu.innerHTML = '<div class="as-empty">Memuat akun...</div>';
    const data = await window.electronAPI?.getAllAccounts?.().catch(() => null);
    const accounts = Array.isArray(data) ? data : (data?.accounts || []);
    const activeId = data?.activeAccountId || accounts[0]?.id;

    const rows = accounts.map((acc) => {
      const user = String(acc.username || acc.name || acc.id || 'akun').replace(/^@/, '');
      const avatar = acc.avatar || acc.profilePicUrl || acc.avatarUrl || '';
      const isActive = acc.id === activeId;
      const plat = platformOf(acc);
      return `
        <button type="button" class="as-item${isActive ? ' is-active' : ''}" data-id="${esc(acc.id)}">
          <span class="as-avatar">${avatar ? `<img src="${esc(avatar)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc(user.charAt(0).toUpperCase())}</span></span>
          <span class="as-info"><span class="as-name">@${esc(user)}</span><span class="as-plat as-${plat}">${plat === 'tiktok' ? 'TikTok' : plat === 'facebook' ? 'Facebook Page' : plat === 'shopee' ? 'Shopee' : plat === 'youtube' ? 'YouTube' : 'Instagram'}</span></span>
          ${isActive ? '<span class="as-check">✓</span>' : ''}
        </button>`;
    }).join('');

    menu.innerHTML = `
      <div class="as-title">Ganti Akun</div>
      <div class="as-list">${rows || '<div class="as-empty">Belum ada akun.</div>'}</div>
      <div class="as-sep"></div>
      <button type="button" class="as-action" data-act="add">＋ Tambah Akun</button>
      <button type="button" class="as-action" data-act="manage">⚙ Kelola Akun</button>`;

    menu.querySelectorAll('.as-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (id === activeId) { close(); return; }
        btn.classList.add('is-loading');
        btn.querySelector('.as-plat').textContent = 'Mengalihkan...';
        const res = await window.electronAPI?.switchActiveAccount?.(id).catch(() => null);
        if (res && res.success) {
          window.location.reload();
        } else {
          btn.classList.remove('is-loading');
          alert('Gagal mengganti akun: ' + (res?.error || 'tidak diketahui'));
        }
      });
    });
    menu.querySelector('[data-act="add"]')?.addEventListener('click', () => {
      close();
      window.dispatchEvent(new Event('open-accounts-view'));
    });
    menu.querySelector('[data-act="manage"]')?.addEventListener('click', () => {
      close();
      window.dispatchEvent(new Event('open-accounts-view'));
    });
  }

  badge.addEventListener('click', (event) => {
    if (event.target.closest('#btnLogout')) return;
    event.stopPropagation();
    if (!menu.hidden) { close(); return; }
    menu.hidden = false;
    badge.classList.add('is-open');
    render();
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
