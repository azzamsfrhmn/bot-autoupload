/**
 * src/renderer/js/modules/profileManager.js
 * Manajemen Halaman Profil & Feed Grid Multi-Platform (Instagram & TikTok)
 */

// Ikon siluet putih solid untuk fallback avatar
const WHITE_AVATAR_SVG = `
  <svg viewBox="0 0 24 24" width="56%" height="56%" fill="#ffffff" style="display: block; opacity: 0.95;">
    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
  </svg>
`;

function renderFallbackAvatar(container) {
  if (!container) return;
  container.innerHTML = WHITE_AVATAR_SVG;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.background = '#27354a';
}

function setAvatar(container, url) {
  if (!container) return;

  if (!url || typeof url !== 'string' || url.trim().length === 0 || url.includes('undefined') || url.includes('null')) {
    renderFallbackAvatar(container);
    return;
  }

  const cleanUrl = url.trim();
  const img = document.createElement('img');
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '50%';
  img.style.display = 'block';

  if (cleanUrl.startsWith('http')) {
    img.referrerPolicy = 'no-referrer';
    img.crossOrigin = 'anonymous';
  }

  img.onload = () => {
    container.innerHTML = '';
    container.appendChild(img);
  };

  img.onerror = () => {
    console.warn('[ProfileManager] Gagal memuat gambar avatar:', cleanUrl.substring(0, 40));
    renderFallbackAvatar(container);
  };

  img.src = cleanUrl;
}

/**
 * Sinkronisasi kartu sesi di pojok kiri bawah sidebar
 */
export async function updateSidebarProfile(customAvatar = null) {
  const displayUsernameSidebar = document.getElementById('displayUsername');
  const avatarContainer = document.getElementById('avatarContainer');

  try {
    const accountsData = await window.electronAPI?.getAllAccounts?.();
    const activeAcc = accountsData?.accounts?.find((a) => a.id === accountsData.activeAccountId) 
                   || accountsData?.accounts?.[0];

    const profile = await window.electronAPI?.getSessionInfo?.();
    const isTikTok = profile?.platform === 'tiktok' || activeAcc?.platform === 'tiktok';

    const rawUsername = activeAcc?.username || profile?.username || activeAcc?.name || (isTikTok ? 'tiktok_creator' : 'etnicpremium');
    const cleanUsername = rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`;

    if (displayUsernameSidebar) {
      displayUsernameSidebar.textContent = cleanUsername;
    }

    const picUrl = customAvatar || 
                   activeAcc?.avatar || 
                   activeAcc?.profilePicUrl || 
                   profile?.avatar || 
                   profile?.profilePicUrl || 
                   profile?.profile_pic_url || 
                   profile?.avatarUrl || 
                   '';

    if (avatarContainer) {
      setAvatar(avatarContainer, picUrl);
    }
  } catch (err) {
    console.error('[ProfileManager] Gagal update sidebar profile:', err);
  }
}

/**
 * Render Feed khusus format kartu video vertikal TikTok (9:16 + Views Counter)
 */
function renderTikTokFeedGrid(posts) {
  const postsContainer = document.getElementById('tiktokPostsContainer');
  if (!postsContainer) return;

  if (!posts || posts.length === 0) {
    postsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: rgba(255,255,255,0.4); font-size: 14px;">Belum ada video yang diunggah di akun ini.</div>';
    return;
  }

  postsContainer.innerHTML = '';
  posts.forEach((post) => {
    const item = document.createElement('div');
    item.style.cssText = `
      position: relative;
      width: 100%;
      aspect-ratio: 9 / 16;
      border-radius: 8px;
      overflow: hidden;
      background: #181920;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: transform 0.18s ease;
    `;

    const imgSrc = post.imageUrl || post.thumbnailUrl || post.displayUrl || post.thumbnail || post.coverUrl || '';
    const views = post.viewsCount || post.playCount || post.views || '0';

    item.innerHTML = `
      <img src="${imgSrc}" alt="${post.caption || 'Video TikTok'}" loading="lazy" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.opacity='0.2'">
      <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 45%, transparent 100%); pointer-events: none;"></div>
      <div style="position: absolute; bottom: 8px; left: 8px; display: flex; align-items: center; gap: 5px; color: #fff; font-size: 13px; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <span>${views}</span>
      </div>
    `;

    item.onmouseenter = () => { item.style.transform = 'translateY(-3px)'; };
    item.onmouseleave = () => { item.style.transform = 'translateY(0)'; };

    item.onclick = () => {
      if (post.url || post.permalink) {
        window.electronAPI?.openExternalUrl?.(post.url || post.permalink);
      }
    };

    item.title = post.caption || '';
    postsContainer.appendChild(item);
  });
}

/**
 * Render tata letak lengkap TikTok Web (Header + Tab + Grid Postingan)
 */
function renderTikTokProfileLayout(container, profile, activeAcc, initialPosts = null) {
  const displayTitle = activeAcc?.name || activeAcc?.fullName || profile?.fullName || activeAcc?.username || profile?.username || 'TikTok Creator';
  const handle = (activeAcc?.username || activeAcc?.uniqueId || profile?.uniqueId || profile?.username || 'creator').replace(/^@/, '');
  const followingCount = profile?.followingCount ?? activeAcc?.followingCount ?? 1;
  const followersCount = profile?.followersCount ?? activeAcc?.followersCount ?? 0;
  const likesCount = profile?.likesCount ?? activeAcc?.likesCount ?? profile?.likeCount ?? 0;
  const bio = activeAcc?.biography || profile?.biography || 'Outfit Wanita Pilihan ✨\nBudget minimal, gaya maksimal 💵\nCek di showcase 👇';
  
  const picUrl = activeAcc?.avatar || activeAcc?.profilePicUrl || profile?.avatar || profile?.profilePicUrl || '';

  container.innerHTML = `
    <div style="background: #000; color: #fff; min-height: 80vh; padding: 28px 36px; border-radius: var(--radius-lg); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <!-- HEADER TIKTOK -->
      <div style="display: flex; gap: 32px; align-items: flex-start; margin-bottom: 24px;">
        <div id="tiktokAvatarWrapper" style="width: 130px; height: 130px; min-width: 130px; border-radius: 50%; overflow: hidden; background: #27354a; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.6);"></div>

        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
            <h1 style="font-size: 26px; font-weight: 700; color: #fff; margin: 0; letter-spacing: -0.3px;">${displayTitle}</h1>
            <span style="font-size: 15px; color: rgba(255, 255, 255, 0.55); font-weight: 400;">| ${handle}</span>
          </div>

          <div style="display: flex; gap: 24px; align-items: center; font-size: 15px; margin-bottom: 16px;">
            <div><strong style="color: #fff; font-weight: 700;">${followingCount}</strong> <span style="color: rgba(255,255,255,0.7);">Mengikuti</span></div>
            <div><strong style="color: #fff; font-weight: 700;">${followersCount}</strong> <span style="color: rgba(255,255,255,0.7);">Pengikut</span></div>
            <div><strong style="color: #fff; font-weight: 700;">${likesCount}</strong> <span style="color: rgba(255,255,255,0.7);">Suka</span></div>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap;">
            <button type="button" style="height: 38px; padding: 0 18px; border-radius: 6px; background: rgba(255, 255, 255, 0.14); color: #fff; border: none; font-size: 13.5px; font-weight: 600; cursor: pointer;">Edit profil</button>
            <button type="button" style="height: 38px; padding: 0 18px; border-radius: 6px; background: rgba(255, 255, 255, 0.14); color: #fff; border: none; font-size: 13.5px; font-weight: 600; cursor: pointer;">Promosikan postingan</button>
            <button id="btnRefreshTikTokProfile" type="button" style="height: 38px; padding: 0 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); color: #fff; border: none; font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              Refresh Profil
            </button>
          </div>

          <div style="font-size: 14px; color: rgba(255, 255, 255, 0.92); line-height: 1.55; white-space: pre-line;">${bio}</div>
        </div>
      </div>

      <!-- TAB NAVIGASI TIKTOK -->
      <div style="display: flex; gap: 32px; border-bottom: 1px solid rgba(255,255,255,0.12); margin-bottom: 20px; font-size: 15px; font-weight: 600;">
        <div style="padding-bottom: 10px; border-bottom: 2px solid #fff; color: #fff; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm-11 11h7v7H3v-7zm11 0h7v7h-7v-7z"/></svg>
          Videos
        </div>
        <div style="padding-bottom: 10px; color: rgba(255,255,255,0.5); cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          Reposts
        </div>
        <div style="padding-bottom: 10px; color: rgba(255,255,255,0.5); cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
          Favorites
        </div>
        <div style="padding-bottom: 10px; color: rgba(255,255,255,0.5); cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          Liked
        </div>
      </div>

      <!-- GRID POSTINGAN VIDEO TIKTOK -->
      <div id="tiktokPostsContainer" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;">
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: rgba(255,255,255,0.4); font-size: 14px;">Memuat video TikTok...</div>
      </div>
    </div>
  `;

  const ttAvatar = document.getElementById('tiktokAvatarWrapper');
  if (ttAvatar) {
    if (picUrl && picUrl.trim().length > 0) {
      setAvatar(ttAvatar, picUrl);
    } else {
      renderFallbackAvatar(ttAvatar);
    }
  }

  // Tombol Refresh Profil TikTok: Panggil sinkronisasi CDP langsung
  const btnRefreshTT = document.getElementById('btnRefreshTikTokProfile');
  btnRefreshTT?.addEventListener('click', async () => {
    btnRefreshTT.disabled = true;
    btnRefreshTT.textContent = 'Memperbarui...';
    try {
      const syncRes = await (window.electronAPI?.invoke 
        ? window.electronAPI.invoke('tiktok:sync-profile', activeAcc?.id || activeAcc?.username)
        : window.electronAPI?.syncTikTokProfile?.(activeAcc?.id || activeAcc?.username));

      if (syncRes && syncRes.success && syncRes.account) {
        await updateSidebarProfile(syncRes.account.avatar);
        await loadFullProfile(syncRes.account, syncRes.posts);
      } else {
        const res = await window.electronAPI?.refreshProfile();
        await loadFullProfile(res?.profile, res?.posts);
      }
    } catch (e) {
      console.error('[ProfileManager] Gagal refresh TikTok profile:', e);
    } finally {
      btnRefreshTT.disabled = false;
      btnRefreshTT.textContent = 'Refresh Profil';
    }
  });

  const postsToRender = initialPosts || activeAcc?.posts || profile?.posts;
  if (Array.isArray(postsToRender) && postsToRender.length > 0) {
    renderTikTokFeedGrid(postsToRender);
  } else {
    window.electronAPI?.getUserFeed?.().then((res) => {
      if (res && res.success && Array.isArray(res.posts) && res.posts.length > 0) {
        renderTikTokFeedGrid(res.posts);
      } else {
        const postsContainer = document.getElementById('tiktokPostsContainer');
        if (postsContainer) {
          postsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: rgba(255,255,255,0.4); font-size: 14px;">Belum ada video yang diunggah.</div>';
        }
      }
    });
  }
}

export function renderFeedGrid(posts) {
  const postsContainer = document.getElementById('postsContainer');
  if (!postsContainer) return;

  if (!posts || posts.length === 0) {
    postsContainer.innerHTML = '<div style="grid-column: span 3; text-align: center; padding: 50px 0; color: var(--text-dim);">Belum ada postingan di akun ini.</div>';
    return;
  }

  postsContainer.innerHTML = '';
  posts.forEach((post) => {
    const item = document.createElement('div');
    item.className = 'grid-post-item';

    const imgSrc = post.imageUrl || post.thumbnailUrl || post.displayUrl || '';
    const likes = post.likeCount ?? post.likesCount ?? 0;
    const comments = post.commentCount ?? post.commentsCount ?? 0;

    item.innerHTML = `
      <img src="${imgSrc}" alt="Thumbnail" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='0.2'">
      <div class="post-overlay">
        <div class="overlay-stat">
          <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          <span>${likes}</span>
        </div>
        <div class="overlay-stat">
          <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
          <span>${comments}</span>
        </div>
      </div>
    `;
    item.title = post.caption || '';
    postsContainer.appendChild(item);
  });
}

export async function loadFullProfile(overrideProfile = null, overridePosts = null) {
  const viewProfileContainer = document.getElementById('viewProfile');
  if (!viewProfileContainer) return;

  try {
    const accountsData = await window.electronAPI?.getAllAccounts?.();
    const activeAcc = accountsData?.accounts?.find((a) => a.id === accountsData.activeAccountId) 
                   || accountsData?.accounts?.[0];

    const profile = overrideProfile || await window.electronAPI?.getSessionInfo?.();
    const isTikTok = profile?.platform === 'tiktok' || activeAcc?.platform === 'tiktok';

    const resolvedAvatar = profile?.avatar || 
                           profile?.profilePicUrl || 
                           activeAcc?.avatar || 
                           activeAcc?.profilePicUrl || 
                           profile?.profile_pic_url || 
                           profile?.avatarUrl || 
                           '';

    await updateSidebarProfile(resolvedAvatar);

    if (isTikTok) {
      renderTikTokProfileLayout(viewProfileContainer, profile, activeAcc, overridePosts);

      // Auto-sync profil TikTok di latar belakang jika dipanggil pertama kali tanpa override
      if (!overrideProfile && activeAcc && !window._isTikTokProfileSyncing) {
        window._isTikTokProfileSyncing = true;
        setTimeout(async () => {
          try {
            const syncRes = await (window.electronAPI?.invoke 
              ? window.electronAPI.invoke('tiktok:sync-profile', activeAcc.id || activeAcc.username)
              : window.electronAPI?.syncTikTokProfile?.(activeAcc.id || activeAcc.username));

            if (syncRes && syncRes.success && syncRes.account) {
              await updateSidebarProfile(syncRes.account.avatar);
              renderTikTokProfileLayout(viewProfileContainer, syncRes.account, syncRes.account, syncRes.posts);
            }
          } catch (syncErr) {
            console.warn('[ProfileManager] Auto-sync profil TikTok latar belakang gagal:', syncErr.message);
          } finally {
            window._isTikTokProfileSyncing = false;
          }
        }, 200);
      }
      return;
    }

    // TATA LETAK INSTAGRAM
    const username = activeAcc?.username || profile?.username || 'etnicpremium';
    const cleanUsername = username.replace(/^@/, '');

    const pCount = profile?.postsCount ?? 0;
    const fCount = Number(profile?.followersCount ?? 0).toLocaleString('id-ID');
    const folCount = Number(profile?.followingCount ?? 0).toLocaleString('id-ID');
    const bioText = profile?.biography || 'Belum ada bio.';
    const category = profile?.category || profile?.categoryName || 'AKUN BISNIS / KREATOR';
    const extUrl = profile?.externalUrl || '';

    viewProfileContainer.innerHTML = `
      <div class="studio-card">
        <div class="ig-profile-header">
          <div class="ig-profile-avatar-col">
            <div class="avatar-large-wrapper" id="profilePageAvatarWrapper" style="width: 140px; height: 140px; border-radius: 50%; overflow: hidden; background: #27354a; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.4);">
              <span class="note-bubble">Note...</span>
            </div>
          </div>

          <div class="ig-profile-info-col">
            <div class="username-actions-row">
              <h2 class="profile-title-username" id="profilePageUsername">${cleanUsername}</h2>
              <button id="btnRefreshProfile" class="chip-btn" style="display: flex; align-items: center; gap: 6px;">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                Refresh Profil
              </button>
            </div>

            <ul class="profile-stats-row">
              <li><strong id="statPostsCount">${pCount}</strong> posts</li>
              <li><strong id="statFollowersCount">${fCount}</strong> followers</li>
              <li><strong id="statFollowingCount">${folCount}</strong> following</li>
            </ul>

            <div class="profile-bio-details">
              <div class="bio-category" id="bioCategoryText">${category}</div>
              <div class="bio-text" id="bioBodyText" style="white-space: pre-line; line-height: 1.5; font-size: 13px; color: var(--text-main); margin-top: 4px;">${bioText}</div>
              <a class="bio-link" id="bioLinkAnchor" href="${extUrl || '#'}" target="_blank" style="${extUrl ? 'display: inline-flex; margin-top: 6px;' : 'display: none;'}">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                <span id="bioLinkText">${extUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              </a>
            </div>
          </div>
        </div>

        <div class="profile-tabs-nav">
          <button class="profile-tab active" data-tab="posts">
            <svg viewBox="0 0 24 24"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm-11 11h7v7H3v-7zm11 0h7v7h-7v-7z"/></svg>
            <span>POSTS</span>
          </button>
          <button class="profile-tab" data-tab="reels">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
            <span>REELS</span>
          </button>
          <button class="profile-tab" data-tab="saved">
            <svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            <span>SAVED</span>
          </button>
        </div>

        <div class="posts-grid-ig" id="postsContainer">
          <div style="grid-column: span 3; text-align: center; padding: 40px 0; color: var(--text-dim);">Memuat postingan...</div>
        </div>
      </div>
    `;

    const avatarWrapper = document.getElementById('profilePageAvatarWrapper');
    if (avatarWrapper) {
      if (resolvedAvatar && resolvedAvatar.trim().length > 0) {
        setAvatar(avatarWrapper, resolvedAvatar);
      } else {
        renderFallbackAvatar(avatarWrapper);
      }
    }

    viewProfileContainer.querySelectorAll('.profile-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        viewProfileContainer.querySelectorAll('.profile-tab').forEach((b) => b.classList.remove('active'));
        tabBtn.classList.add('active');
      });
    });

    const btnRefresh = document.getElementById('btnRefreshProfile');
    btnRefresh?.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Memperbarui...';
      try {
        const refreshedData = await window.electronAPI?.refreshProfile();
        if (refreshedData && refreshedData.profile) {
          await loadFullProfile(refreshedData.profile, refreshedData.posts);
        } else {
          await loadFullProfile();
        }
      } catch (e) {
        console.error('[ProfileManager] Refresh error:', e);
      } finally {
        btnRefresh.disabled = false;
        btnRefresh.textContent = 'Refresh Profil';
      }
    });

    if (overridePosts && overridePosts.length > 0) {
      renderFeedGrid(overridePosts);
    } else {
      const res = await window.electronAPI?.getUserFeed();
      const postsContainer = document.getElementById('postsContainer');
      if (postsContainer) {
        if (res && res.success && res.posts?.length > 0) {
          if (!pCount) {
            const statPosts = document.getElementById('statPostsCount');
            if (statPosts) statPosts.textContent = res.posts.length;
          }
          renderFeedGrid(res.posts);
        } else {
          postsContainer.innerHTML = '<div style="grid-column: span 3; text-align: center; padding: 50px 0; color: var(--text-dim);">Belum ada postingan.</div>';
        }
      }
    }
  } catch (err) {
    console.warn('[ProfileManager] Gagal memuat profil:', err);
  }
}

export function initProfileManager() {
  window.addEventListener('load-feed', () => loadFullProfile());

  if (window.electronAPI && typeof window.electronAPI.onProfileUpdated === 'function') {
    window.electronAPI.onProfileUpdated((newProfile) => {
      loadFullProfile(newProfile);
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onAccountsUpdated === 'function') {
    window.electronAPI.onAccountsUpdated(() => {
      loadFullProfile();
    });
  }

  loadFullProfile();
}