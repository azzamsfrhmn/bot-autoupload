document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnWinMinimize')?.addEventListener('click', () => window.electronAPI?.minimizeWindow());
  document.getElementById('btnWinClose')?.addEventListener('click', () => window.electronAPI?.closeWindow());

  const stepChoosePlatform = document.getElementById('stepChoosePlatform');
  const stepChooseAccount = document.getElementById('stepChooseAccount');
  const btnSelectInstagram = document.getElementById('btnSelectInstagram');
  const btnSelectTiktok = document.getElementById('btnSelectTiktok');
  const btnBackToPlatform = document.getElementById('btnBackToPlatform');
  const selectedPlatformTitle = document.getElementById('selectedPlatformTitle');
  const selectedPlatformSub = document.getElementById('selectedPlatformSub');
  const listContainer = document.getElementById('selectAccountList');

  let currentPlatform = 'instagram';

  function openPlatformAccounts(platform) {
    currentPlatform = platform;
    stepChoosePlatform.style.display = 'none';
    stepChooseAccount.style.display = 'flex';

    if (platform === 'tiktok') {
      selectedPlatformTitle.textContent = 'Pilih Akun TikTok';
      selectedPlatformSub.textContent = 'Pilih sesi akun TikTok atau hubungkan akun baru';
    } else {
      selectedPlatformTitle.textContent = 'Pilih Akun Instagram';
      selectedPlatformSub.textContent = 'Pilih sesi akun Instagram atau hubungkan akun baru';
    }

    loadAccounts();
  }

  btnSelectInstagram?.addEventListener('click', () => openPlatformAccounts('instagram'));
  btnSelectTiktok?.addEventListener('click', () => openPlatformAccounts('tiktok'));

  btnBackToPlatform?.addEventListener('click', () => {
    stepChooseAccount.style.display = 'none';
    stepChoosePlatform.style.display = 'flex';
  });

  async function loadAccounts() {
    if (!listContainer || !window.electronAPI?.getAllAccounts) return;
    
    const rawData = await window.electronAPI.getAllAccounts();
    const accounts = Array.isArray(rawData) ? rawData : (rawData?.accounts || []);

    const filteredAccounts = accounts.filter((acc) => {
      const p = String(acc.platform || '').toLowerCase();
      const id = String(acc.id || '').toLowerCase();
      const u = String(acc.username || '').toLowerCase();
      
      if (currentPlatform === 'tiktok') {
        return p === 'tiktok' || id.startsWith('tt_') || id.startsWith('tiktok_') || u.includes('sherly');
      } else {
        return p === 'instagram' || id.startsWith('ig_') || (!p.includes('tiktok') && !id.startsWith('tt_') && !id.startsWith('tiktok_'));
      }
    });

    let html = '';

    if (filteredAccounts.length > 0) {
      filteredAccounts.forEach((acc) => {
        const username = String(acc.username || acc.name || acc.id || 'user').replace(/^@/, '');
        
        // Baca avatar dari berbagai kemungkinan key termasuk cache profil
        let avatarUrl = acc.avatar || acc.profilePicUrl || acc.avatarUrl || acc.profile_pic_url || acc.user?.avatar || '';

        // Fallback jika belum tersimpan di registry utama: baca format path cache file lokal
        if (!avatarUrl || avatarUrl.includes('undefined') || avatarUrl.includes('null')) {
          avatarUrl = `../../sessions/profile_avatar_${acc.id}.jpg`;
        }

        const avatarEl = `
          <div style="position: relative; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: #1e293b; display: flex; align-items: center; justify-content: center;">
            <img src="${avatarUrl}" alt="${username}" referrerpolicy="no-referrer"
                 style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <span style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; color: #fff;">
              ${username.charAt(0).toUpperCase()}
            </span>
          </div>
        `;

        html += `
          <div class="account-card-item" data-id="${acc.id}" style="position: relative;">
            <button type="button" class="btn-delete-single-account" data-id="${acc.id}" data-user="${username}" title="Hapus Akun & Sesi" style="position: absolute; top: 12px; right: 12px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; z-index: 10;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <div class="account-card-avatar" style="overflow: hidden; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1.5px solid rgba(255,255,255,0.12);">
              ${avatarEl}
            </div>
            <div class="account-card-name">@${username}</div>
            <div class="account-card-status">
              <span class="status-dot"></span> Sesi Tersedia
            </div>
            <button type="button" class="btn-action-pill">Pilih Akun Ini</button>
          </div>
        `;
      });
    }

    html += `
      <div class="account-card-item add-account-card" id="btnCardAddAccount">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; color: #fff; margin-bottom: 10px;">
          <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" d="M12 4v16m8-8H4"/></svg>
        </div>
        <div class="account-card-name" style="font-size: 14px;">Tambah Akun ${currentPlatform === 'tiktok' ? 'TikTok' : 'Instagram'}</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Login via browser ${currentPlatform === 'tiktok' ? 'TikTok' : 'Instagram'}</div>
      </div>
    `;

    listContainer.innerHTML = html;

    listContainer.querySelectorAll('.btn-delete-single-account').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const user = btn.getAttribute('data-user');

        if (confirm(`Hapus akun @${user} beserta seluruh berkas sesi (.json) dan cache?`)) {
          btn.style.opacity = '0.5';
          btn.style.pointerEvents = 'none';

          if (window.electronAPI?.deleteAccount) {
            await window.electronAPI.deleteAccount(id);
          }
          await loadAccounts();
        }
      });
    });

    listContainer.querySelectorAll('.account-card-item:not(.add-account-card)').forEach((card) => {
      card.addEventListener('click', async () => {
        const id = card.getAttribute('data-id');
        card.style.opacity = '0.6';

        try {
          await window.electronAPI?.switchActiveAccount?.(id);
        } catch (err) {
          console.warn('[SelectAccount] Gagal alihkan sesi akun:', err);
        }

        window.location.href = 'dashboard.html';
      });
    });

    document.getElementById('btnCardAddAccount')?.addEventListener('click', async () => {
      if (currentPlatform === 'tiktok') {
        const uniqueNewId = `tiktok_${Date.now()}`;
        if (typeof window.electronAPI?.loginTikTokAccount === 'function') {
          await window.electronAPI.loginTikTokAccount(uniqueNewId);
        } else if (typeof window.electronAPI?.addNewTiktokAccount === 'function') {
          await window.electronAPI.addNewTiktokAccount(uniqueNewId);
        }
        await loadAccounts();
      } else {
        if (window.electronAPI?.addNewAccount) {
          await window.electronAPI.addNewAccount();
          await loadAccounts();
        }
      }
    });
  }

  window.electronAPI?.onAccountsUpdated?.(() => loadAccounts());
  window.electronAPI?.onProfileUpdated?.(() => loadAccounts());
});