/**
 * src/renderer/js/modules/accountManager.js
 * Manajemen Antarmuka Multi-Akun (Instagram & TikTok Terisolasi)
 */
import { updateSidebarProfile, loadFullProfile } from './profileManager.js';

export function initAccountManager() {
  const container = document.getElementById('accountsListContainer') 
                 || document.querySelector('.accounts-cards-grid')
                 || document.querySelector('#viewAccounts .studio-card-grid');

  const btnAdd = document.getElementById('btnAddNewAccount')
              || document.getElementById('btnAddTikTokAccount')
              || document.querySelector('#viewAccounts button.btn-execute');

  const pageTitle = document.querySelector('#viewAccounts .card-header-left h2, #tab-accounts h2, #tab-accounts .page-title, .page-header h2');
  const pageSub = document.querySelector('#viewAccounts .card-header-left p');

  async function renderAccounts() {
    if (!container) return;

    if (!window.electronAPI?.getAllAccounts) {
      console.warn('[AccountManager] API getAllAccounts belum tersedia di preload.');
      return;
    }

    try {
      const sessionInfo = await window.electronAPI.getSessionInfo?.();
      const sidebarUser = document.getElementById('sidebarUsername')?.textContent || '';
      
      const currentPlatform = sessionInfo?.platform || (
        sidebarUser.includes('tiktok') || sidebarUser.includes('sherly') ? 'tiktok' : 'tiktok'
      );
      const isTikTok = currentPlatform === 'tiktok';

      if (pageTitle) {
        pageTitle.textContent = isTikTok
          ? 'Kelola Akun TikTok Terhubung'
          : 'Kelola Akun Instagram Terhubung';
      }

      if (pageSub) {
        pageSub.textContent = isTikTok
          ? 'Pilih akun aktif untuk posting otomatis, atau hubungkan akun TikTok baru via Chrome resmi.'
          : 'Pilih akun aktif untuk posting otomatis, atau tambahkan akun Instagram baru.';
      }

      if (btnAdd) {
        btnAdd.textContent = isTikTok ? '+ Tambah Akun TikTok' : '+ Tambah Akun Baru';
      }

      const regData = await window.electronAPI.getAllAccounts();
      const allAccounts = Array.isArray(regData) ? regData : (regData?.accounts || []);
      const activeAccountId = regData?.activeAccountId || sessionInfo?.activeAccountId || '';

      const accounts = allAccounts.filter((acc) => {
        const p = String(acc.platform || '').toLowerCase();
        const id = String(acc.id || '').toLowerCase();
        const user = String(acc.username || '').toLowerCase();

        const isAccTikTok = p === 'tiktok' || id.startsWith('tiktok_') || id.startsWith('tt_') || user.includes('sherly');
        return isTikTok ? isAccTikTok : (!isAccTikTok || p === 'instagram');
      });

      if (!accounts || accounts.length === 0) {
        container.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 48px 0; background: var(--bg-app); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md);">
            Belum ada akun ${isTikTok ? 'TikTok' : 'Instagram'} yang tersimpan. Klik tombol di atas untuk menghubungkan akun.
          </div>
        `;
        return;
      }

      // Ambil elemen gambar avatar yang sudah sukses tampil di sidebar pojok kiri bawah
      const sidebarImgEl = document.querySelector('.sidebar-user-avatar img, #sidebarAvatar img, .user-profile-avatar img, img[alt*="Avatar"], .sidebar img');
      const resolvedSidebarSrc = sidebarImgEl ? sidebarImgEl.src : '';

      container.innerHTML = accounts.map((acc) => {
        const isActive = acc.id === activeAccountId || (accounts.length === 1 && !activeAccountId);
        const rawUsername = acc.username || acc.name || acc.id || '';
        const username = rawUsername.replace(/^@/, '');

        // Cari URL gambar dari akun, fallback langsung ke gambar sidebar yang aktif
        let avatarSrc = acc.avatar || acc.profilePicUrl || acc.avatarUrl || acc.profile_pic_url || '';
        if (!avatarSrc || avatarSrc.includes('undefined') || avatarSrc.includes('null')) {
          if (isActive && resolvedSidebarSrc) {
            avatarSrc = resolvedSidebarSrc;
          }
        }

        return `
          <div class="studio-card" style="margin-bottom: 0; background: #11141d; border: 1px solid ${isActive ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'}; display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 12px; box-shadow: ${isActive ? '0 0 16px rgba(59, 130, 246, 0.2)' : 'none'};">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                <div class="avatar" style="width: 44px; height: 44px; min-width: 44px; border-radius: 50%; overflow: hidden; background: #1e293b; display: flex; align-items: center; justify-content: center; border: 1.5px solid rgba(255, 255, 255, 0.15); position: relative;">
                  ${avatarSrc 
                    ? `<img src="${avatarSrc}" alt="${username}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" onerror="this.style.opacity='0'; this.nextElementSibling.style.display='flex';">
                       <span style="display: none; position: absolute; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: #fff;">${username.charAt(0).toUpperCase()}</span>` 
                    : `<span style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: #fff;">${username.charAt(0).toUpperCase()}</span>`
                  }
                </div>
                <div style="overflow: hidden;">
                  <div style="font-weight: 700; color: #fff; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">@${username}</div>
                  <div style="font-size: 11.5px; color: ${isActive ? '#10b981' : '#94a3b8'}; margin-top: 3px; display: flex; align-items: center; gap: 5px;">
                    <span class="status-dot" style="background: ${isActive ? '#10b981' : '#64748b'}; width: 6px; height: 6px; border-radius: 50%;"></span>
                    <span>${isActive ? 'Sesi Aktif Saat Ini' : 'Sesi Tersimpan'}</span>
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${isActive ? '<span class="model-tag" style="font-size: 10.5px; padding: 2px 8px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; font-weight: 700;">Aktif</span>' : ''}
                <button type="button" class="btn-delete-account" data-id="${acc.id}" title="Hapus Akun Ini" style="background: transparent; border: none; color: #ef4444; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; border-radius: 4px;">
                  <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>

            <button type="button" class="btn-execute btn-switch-account" data-id="${acc.id}" style="${isActive ? 'opacity: 0.7; cursor: default; background: #1e2433; color: rgba(255,255,255,0.7); box-shadow: none; border: 1px solid rgba(255,255,255,0.1);' : 'background: #2563eb; color: #fff; cursor: pointer;'}">
              <span>${isActive ? '✓ Sedang Digunakan' : 'Gunakan Akun Ini'}</span>
            </button>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.btn-switch-account').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (id === activeAccountId) return;

          btn.innerHTML = '<span>Mengalihkan Sesi...</span>';
          btn.style.opacity = '0.7';

          const res = await window.electronAPI.switchActiveAccount(id);
          if (res && res.success) {
            await updateSidebarProfile();
            await loadFullProfile();
            await renderAccounts();
          }
        });
      });

      container.querySelectorAll('.btn-delete-account').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          if (confirm('Apakah Anda yakin ingin menghapus akun ini dari aplikasi?')) {
            const res = await window.electronAPI.deleteAccount(id);
            if (res && res.success) {
              await renderAccounts();
              await updateSidebarProfile();
            }
          }
        });
      });
    } catch (err) {
      console.error('[AccountManager] Gagal merender akun:', err);
    }
  }

  btnAdd?.addEventListener('click', async () => {
    const sessionInfo = await window.electronAPI?.getSessionInfo?.();
    const isTikTok = sessionInfo?.platform === 'tiktok' || true;

    if (isTikTok) {
      const newAccId = `tiktok_${Date.now()}`;
      if (typeof window.electronAPI?.loginTikTokAccount === 'function') {
        const res = await window.electronAPI.loginTikTokAccount(newAccId);
        if (res && !res.success) {
          alert('Gagal membuka Chrome: ' + res.error);
        }
      } else {
        window.electronAPI?.addNewTiktokAccount?.(newAccId);
      }
    } else {
      window.electronAPI?.addNewAccount?.();
    }
  });

  window.addEventListener('load-accounts-list', renderAccounts);

  if (window.electronAPI?.onAccountsUpdated) {
    window.electronAPI.onAccountsUpdated(() => {
      renderAccounts();
      updateSidebarProfile();
    });
  }

  if (window.electronAPI?.onProfileUpdated) {
    window.electronAPI.onProfileUpdated(() => {
      renderAccounts();
      updateSidebarProfile();
    });
  }

  renderAccounts();
}