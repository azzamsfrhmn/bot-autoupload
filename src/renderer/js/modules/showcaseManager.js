/**
 * src/renderer/js/modules/showcaseManager.js
 * Manajemen Showcase Produk TikTok Streamer Resmi & Kalodata + Filter Rentang Waktu Metrik + Lightbox Slider + Cache Metrik Permanen
 * (Perbaikan: Deteksi Akun Otomatis & Auto-Reload saat Pergantian Akun)
 */

export function initShowcaseManager() {
  const container = document.getElementById('showcaseGridContainer');
  const btnRefresh = document.getElementById('btnRefreshShowcase');
  const btnClear = document.getElementById('btnClearShowcase');
  const btnImport = document.getElementById('btnLoadKalodataJson');
  const btnProcessRaw = document.getElementById('btnProcessKalodataRawJson');
  const rawJsonInput = document.getElementById('rawKalodataJsonInput');
  const wrapperKalodataInput = document.getElementById('wrapperKalodataInputBar');
  const txtAccountName = document.getElementById('txtActiveAccountName');

  const tabModeTiktok = document.getElementById('tabModeTiktokShop');
  const tabModeKalodata = document.getElementById('tabModeKalodata');

  let currentViewMode = 'tiktok'; // 'tiktok' | 'kalodata'
  let currentProductsList = [];
  let activeDetailItem = null;
  let activeTimeRange = '30'; // '1' | '7' | '30'
  let isAutoSyncingShowcase = false;

  // Variabel state untuk navigasi slider lightbox
  let currentLightboxImages = [];
  let currentLightboxIndex = 0;

  ensureDetailModalExists();
  ensureImagePreviewModalExists();

  // Helper untuk membaca username akun TikTok yang sedang aktif
  function getActiveAccountIdentifier() {
    if (window._activeTiktokAccount) {
      return String(window._activeTiktokAccount).replace('@', '').trim();
    }

    const sidebarAccountText = document.querySelector('#displayUsername, #sidebarUsername, .account-profile-name, .profile-badge')?.textContent || '';
    const match = sidebarAccountText.match(/@([\w.-]+)/);
    if (match) return match[1];

    const txtAcc = txtAccountName?.textContent?.replace('@', '').trim();
    if (txtAcc && txtAcc !== 'Semua' && txtAcc !== '-') return txtAcc;

    return '';
  }

  tabModeTiktok?.addEventListener('click', () => {
    currentViewMode = 'tiktok';
    tabModeTiktok.style.background = '#35b29f';
    tabModeTiktok.style.color = '#fff';
    tabModeTiktok.style.borderColor = '#35b29f';
    tabModeKalodata.style.background = 'transparent';
    tabModeKalodata.style.color = 'var(--text-muted)';
    tabModeKalodata.style.borderColor = 'var(--border-subtle)';
    if (wrapperKalodataInput) wrapperKalodataInput.style.display = 'none';
    loadActiveAccountShowcase();
  });

  tabModeKalodata?.addEventListener('click', () => {
    currentViewMode = 'kalodata';
    tabModeKalodata.style.background = '#e8a25c';
    tabModeKalodata.style.color = '#fff';
    tabModeKalodata.style.borderColor = '#e8a25c';
    tabModeTiktok.style.background = 'transparent';
    tabModeTiktok.style.color = 'var(--text-muted)';
    tabModeTiktok.style.borderColor = 'var(--border-subtle)';
    if (wrapperKalodataInput) wrapperKalodataInput.style.display = 'block';
    loadKalodataData();
  });

  function isValidProductImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (lower.includes('captcha') || lower.includes('verify') || lower.includes('puzzle') || lower.includes('wmc')) {
      return false;
    }
    return true;
  }

  function getProductCoverUrl(item) {
    if (item.coverUrl && !item.coverUrl.includes('placehold.co') && isValidProductImageUrl(item.coverUrl)) return item.coverUrl;
    if (item.product_img && isValidProductImageUrl(item.product_img)) return item.product_img;
    const pid = String(item.id || item.productId || '').trim();
    if (pid && pid.length >= 10) {
      return `https://img.kalocdn.com/tiktok.product/${pid}/cover.png`;
    }
    return '';
  }

  function formatRupiahShort(num) {
    if (!num || isNaN(num) || num <= 0) return 'Rp0';
    if (num >= 1000000000) return `Rp${(num / 1000000000).toFixed(2).replace('.', ',')}M`;
    if (num >= 1000000) return `Rp${(num / 1000000).toFixed(2).replace('.', ',')}JT`;
    if (num >= 1000) return `Rp${(num / 1000).toFixed(2).replace('.', ',')}RB`;
    return `Rp${Math.round(num)}`;
  }

  function parseFlexibleJson(rawText) {
    if (!rawText || !rawText.trim()) {
      throw new Error('Kolom teks masih kosong.');
    }

    let text = rawText.trim();

    try {
      return JSON.parse(text);
    } catch (e) {}

    if (!text.startsWith('{') && !text.startsWith('[')) {
      const firstBrace = text.indexOf('{');
      const firstBracket = text.indexOf('[');

      if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        text = text.substring(firstBracket);
      } else if (firstBrace !== -1) {
        text = text.substring(firstBrace);
      } else {
        if (text.endsWith('}]') || text.endsWith('} ]')) {
          text = `[{ ${text}`;
        } else if (text.endsWith('}')) {
          text = `{ ${text}`;
        }
      }
    }

    try {
      return JSON.parse(text);
    } catch (e) {}

    const matches = text.match(/\{[\s\S]*?\}/g);
    if (matches && matches.length > 0) {
      const recovered = [];
      for (const m of matches) {
        try {
          recovered.push(JSON.parse(m));
        } catch (err) {}
      }
      if (recovered.length > 0) return recovered;
    }

    throw new Error('Teks bukan format JSON yang valid. Pastikan menyalin data dari tanda pembuka { atau [ hingga penutup.');
  }

  // preloaded: hasil sinkron yang sudah ada, dirender tanpa memanggil TikTok lagi
  async function loadActiveAccountShowcase(forceRefresh = false, preloaded = null) {
    if (!container) return;
    container.innerHTML = '<div class="app-loader">Memuat data etalase akun...</div>';

    const activeUser = getActiveAccountIdentifier();

    try {
      const [resShowcase, resKalo, savedMetrics] = await Promise.all([
        preloaded || window.electronAPI?.getTiktokShowcaseProducts?.(forceRefresh, activeUser),
        window.electronAPI?.getKalodataProducts?.(),
        window.electronAPI?.getShowcaseMetricsStore?.(activeUser) || {}
      ]);

      if (resShowcase?.account && txtAccountName) {
        txtAccountName.textContent = `@${resShowcase.account}`;
      } else if (activeUser && txtAccountName) {
        txtAccountName.textContent = `@${activeUser}`;
      }

      if (!resShowcase?.success || !resShowcase?.data || resShowcase.data.length === 0) {
        // Data belum ada (mis. baru login): tarik otomatis dari TikTok Shop, tampilkan loading sampai selesai
        if (!forceRefresh && !preloaded) {
          container.innerHTML = '<div class="app-loader" style="grid-column: 1 / -1;">Mengambil produk etalase dari TikTok Shop...</div>';
          if (!isAutoSyncingShowcase) {
            isAutoSyncingShowcase = true;
            window.electronAPI?.getTiktokShowcaseProducts?.(true, activeUser)
              .catch((err) => ({ success: false, data: [], error: err.message }))
              .then((freshRes) => {
                isAutoSyncingShowcase = false;
                if (currentViewMode === 'tiktok') loadActiveAccountShowcase(false, freshRes || { success: false, data: [] });
              });
          }
          return;
        }

        currentProductsList = [];
        container.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; background: var(--bg-app); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); color: var(--text-dim);">
            Belum ada produk tersimpan di etalase akun ini (@${activeUser || 'TikTok'}).<br>
            ${resShowcase?.error ? `<span style="font-size: 12px; color: #fca5a5; margin-top: 8px; display: inline-block;">❌ ${String(resShowcase.error).replace(/[<>&]/g, '')}</span><br>` : ''}
            <span style="font-size: 11.5px; color: var(--text-muted); margin-top: 6px; display: inline-block;">
              Gunakan tombol <strong>Sinkronkan Etalase</strong> di atas jika produk belum termuat otomatis.
            </span>
          </div>
        `;
        return;
      }

      const kaloMap = new Map();
      if (Array.isArray(resKalo?.data)) {
        resKalo.data.forEach((item) => {
          const kId = String(item.id || item.productId || '').trim();
          if (kId) kaloMap.set(kId, item);
        });
      }

      const metricsToSave = {};

      const mergedProducts = resShowcase.data.map((item) => {
        const pid = String(item.id || item.productId || '').trim();
        const kaloDetail = kaloMap.get(pid);
        const stored = savedMetrics ? savedMetrics[pid] : null;

        const metricSource = kaloDetail || stored;

        if (metricSource) {
          const mergedItem = {
            ...item,
            ...metricSource,
            itemPrice: item.price || metricSource.min_real_price,
            revenue: metricSource.revenue,
            video_revenue: metricSource.video_revenue,
            live_revenue: metricSource.live_revenue,
            sale: metricSource.sale,
            creator_num: metricSource.creator_num,
            unit_price: metricSource.unit_price,
            revenue_grouping_rate: metricSource.revenue_grouping_rate,
            revenue_trend: metricSource.revenue_trend,
            launch_date: metricSource.launch_date,
            product_rating: metricSource.product_rating,
            images: Array.isArray(metricSource.images) && metricSource.images.length > 0 ? metricSource.images : (item.images || []),
            isStreamerShowcase: true
          };

          if (kaloDetail) {
            metricsToSave[pid] = {
              revenue: kaloDetail.revenue,
              video_revenue: kaloDetail.video_revenue,
              live_revenue: kaloDetail.live_revenue,
              sale: kaloDetail.sale,
              creator_num: kaloDetail.creator_num,
              unit_price: kaloDetail.unit_price,
              revenue_grouping_rate: kaloDetail.revenue_grouping_rate,
              revenue_trend: kaloDetail.revenue_trend,
              launch_date: kaloDetail.launch_date,
              product_rating: kaloDetail.product_rating,
              images: kaloDetail.images || []
            };
          }

          return mergedItem;
        }

        return {
          ...item,
          isStreamerShowcase: true
        };
      });

      if (Object.keys(metricsToSave).length > 0) {
        window.electronAPI?.saveShowcaseMetricsStore?.(metricsToSave, activeUser).catch(() => {});
      }

      currentProductsList = mergedProducts;
      renderProductsGrid(mergedProducts, true);
    } catch (err) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px 0; font-size: 13px;">Gagal memuat showcase akun: ${err.message}</div>`;
    }
  }

  async function loadKalodataData() {
    if (!container) return;
    container.innerHTML = '<div class="app-loader">Mengambil data produk...</div>';

    try {
      const res = await window.electronAPI?.getKalodataProducts?.();
      const rawPayload = res?.data || [];
      if (!rawPayload || rawPayload.length === 0) {
        currentProductsList = [];
        container.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; background: var(--bg-app); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); color: var(--text-dim);">
            Belum ada data produk Kalodata. Salin JSON dari ekstensi Kalodata lalu tempel pada kolom di atas.
          </div>
        `;
        return;
      }
      currentProductsList = rawPayload;
      renderProductsGrid(rawPayload, false);
    } catch (err) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px 0; font-size: 13px;">Gagal memuat produk: ${err.message}</div>`;
    }
  }

  // Jumlah video yang sudah berhasil diposting per PID (dari riwayat jadwal berstatus Selesai)
  let productVideoCounts = {};

  function videoCountHtml(pid) {
    const count = Number(productVideoCounts[pid] || 0);
    const color = count > 0 ? 'var(--accent-text)' : 'var(--text-dim)';
    return `<strong class="product-video-count" data-pid="${pid}" style="color: ${color};">${count}</strong>`;
  }

  async function refreshProductVideoCounts() {
    try {
      productVideoCounts = (await window.electronAPI?.getProductVideoCounts?.()) || {};
    } catch (e) {
      return;
    }
    container.querySelectorAll('.product-video-count').forEach((el) => {
      const count = Number(productVideoCounts[el.dataset.pid] || 0);
      el.textContent = count;
      el.style.color = count > 0 ? 'var(--accent-text)' : 'var(--text-dim)';
    });
  }

  // Video GMV tertinggi dari Kalodata (ekstensi exporter): referensi ide konten, dibuka di TikTok
  function topVideosHtml(item, productIdx) {
    const videos = Array.isArray(item.topVideos) ? item.topVideos.filter((v) => v && v.id) : [];
    if (videos.length === 0) return '';
    const tiles = videos.slice(0, 3).map((v, i) => {
      const url = String(v.tiktokUrl || `https://www.tiktok.com/@/video/${v.id}`).replace(/"/g, '&quot;');
      const coverSrc = v.coverUrl || `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`;
      const cover = coverSrc
        ? `<img src="${String(coverSrc).replace(/"/g, '&quot;')}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.remove()">`
        : '';
      return `
        <button type="button" class="btn-open-top-video" data-url="${url}" data-product-idx="${productIdx}" data-video-idx="${i}" title="Putar video GMV #${i + 1}" style="position: relative; flex: 1; aspect-ratio: 9 / 16; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: #0f1012; cursor: pointer; padding: 0;">
          ${cover}
          <span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(to top, rgba(0,0,0,0.65), transparent 55%);">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
          </span>
          <span style="position: absolute; left: 5px; bottom: 4px; font-size: 10px; font-weight: 700; color: #fff;">#${i + 1}</span>
        </button>`;
    }).join('');
    return `
      <div style="margin-top: 10px;" onclick="event.stopPropagation();">
        <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 6px;">Video GMV tertinggi</div>
        <div style="display: flex; gap: 6px;">${tiles}</div>
      </div>`;
  }

  /**
   * Popup pemutar video GMV tertinggi. Video diputar dari link Kalodata (playUrl, diambil ekstensi lewat
   * sesi Kalodata pengguna). Link itu berlaku terbatas waktu: bila gagal/kedaluwarsa tampil thumbnail + Buka di TikTok.
   */
  function openGmvVideoPlayer(product, videos, startIndex) {
    document.getElementById('gmvVideoPlayerModal')?.remove();
    let index = startIndex;
    const title = product.product_title || product.title || 'Produk';
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const modal = document.createElement('div');
    modal.id = 'gmvVideoPlayerModal';
    modal.style.cssText = 'position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 24px;';
    document.body.appendChild(modal);

    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
    };
    function close() {
      modal.remove();
      document.removeEventListener('keydown', onKey);
    }
    function go(step) {
      const next = index + step;
      if (next >= 0 && next < videos.length) {
        index = next;
        render();
      }
    }
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    function render() {
      const v = videos[index];
      const cover = v.coverUrl || `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`;
      const tiktokUrl = v.tiktokUrl || `https://www.tiktok.com/@/video/${v.id}`;
      const fallback = `
        <div style="position: relative; height: 100%; aspect-ratio: 9 / 16; max-width: 100%;">
          <img src="${esc(cover)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.45;">
          <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; color: #fff; font-size: 13px; line-height: 1.5;">
            Link putar dari Kalodata belum ada atau sudah kedaluwarsa.<br>Ambil ulang JSON dari Kalodata, atau buka di TikTok.
          </div>
        </div>`;
      const media = v.playUrl
        ? `<video id="gmvVideoEl" src="${esc(v.playUrl)}" poster="${esc(cover)}" autoplay controls playsinline style="height: 100%; max-height: 100% !important; aspect-ratio: 9 / 16; max-width: 100%; background: #000;"></video>`
        : fallback;
      const navBtn = (step, disabled) => `<button type="button" data-nav="${step}" ${disabled ? 'disabled' : ''} style="width: 38px; height: 38px; border-radius: 50%; border: none; background: rgba(255,255,255,0.14); color: #fff; cursor: pointer; font-size: 17px; opacity: ${disabled ? 0.3 : 1};">${step < 0 ? '&#8592;' : '&#8594;'}</button>`;

      modal.innerHTML = `
        <div style="display: flex; height: min(86vh, 820px); max-width: 860px; width: 100%; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden;">
          <div id="gmvMediaBox" style="flex: 1; min-width: 0; background: #000; display: flex; align-items: center; justify-content: center;">${media}</div>
          <div style="width: 300px; flex-shrink: 0; display: flex; flex-direction: column; padding: 18px 20px; color: var(--text-main);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
              <span style="font-size: 12px; font-weight: 700; color: var(--accent-2-text);">Video GMV #${index + 1} dari ${videos.length}</span>
              <button type="button" data-close style="width: 30px; height: 30px; border-radius: 50%; border: none; background: rgba(255,255,255,0.08); color: var(--text-main); cursor: pointer;">&#10005;</button>
            </div>
            <div style="font-size: 14px; font-weight: 600; line-height: 1.4;">${esc(title)}</div>
            <div style="font-size: 11.5px; color: var(--text-dim); margin-top: 6px;">ID video: ${esc(v.id)}</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 14px;">Referensi konten dengan GMV tertinggi untuk produk ini. Gunakan sebagai inspirasi alur, bukan untuk diunggah ulang.</div>
            <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 8px; justify-content: center;">${navBtn(-1, index === 0)}${navBtn(1, index === videos.length - 1)}</div>
              <button type="button" data-tiktok style="height: 38px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg-card-hover); color: var(--text-main); font-weight: 600; cursor: pointer;">Buka di TikTok</button>
            </div>
          </div>
        </div>`;

      modal.querySelector('[data-close]')?.addEventListener('click', close);
      modal.querySelector('[data-tiktok]')?.addEventListener('click', () => window.electronAPI?.openExternalUrl?.(tiktokUrl));
      modal.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.nav))));
      // Link kedaluwarsa / ditolak server → tampilkan cadangan
      modal.querySelector('#gmvVideoEl')?.addEventListener('error', () => {
        const box = modal.querySelector('#gmvMediaBox');
        if (box) box.innerHTML = fallback;
      });
    }

    render();
  }

  function renderProductsGrid(products, isAccountShowcase) {
    refreshProductVideoCounts();
    container.innerHTML = products.map((item, idx) => {
      const title = item.product_title || item.title || `Produk #${idx + 1}`;
      const pid = String(item.id || item.productId || '-');
      // Harga = harga jual produk (sama seperti popup detail), BUKAN omzet/revenue Kalodata
      const price = item.min_real_price
        ? `Rp${String(item.min_real_price).replace(/^Rp/i, '')}`
        : (item.itemPrice || item.price || '-');
      
      let commission = item.commission || item.commission_rate || '-';
      if (String(commission).toLowerCase().startsWith('komisi')) {
        commission = String(commission).replace(/^komisi\s*/i, '');
      }

      const cover = getProductCoverUrl(item);
      const tiktokProductUrl = `https://www.tiktok.com/view/product/${pid}`;

      if (isAccountShowcase) {
        return `
          <div class="studio-card product-card-clickable" data-idx="${idx}" style="cursor: pointer; margin-bottom: 0; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
            <div>
              <div style="width: 100%; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: #17191c; margin-bottom: 10px; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.06);">
                <img src="${cover}" alt="${title}" referrerpolicy="no-referrer" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover; display: block;" 
                     onerror="if (!this.dataset.triedBackup) { this.dataset.triedBackup = '1'; this.src='https://p16-oec-va.ibyteimg.com/tos-maliva-i-o3syd03w52-us/${pid}.jpeg~tplv-oec-720:720.jpeg'; } else { this.onerror=null; this.src='https://placehold.co/400x400/181920/a78bfa?text=PID+${pid.slice(-6)}'; }">
                <span style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.85); backdrop-filter: blur(4px); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #10b981; border: 1px solid rgba(16,185,129,0.3);">
                  Komisi ${commission}
                </span>
              </div>
              <h4 style="font-size: 13.5px; font-weight: 600; color: #fff; line-height: 1.4; margin: 0 0 6px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${title}">${title}</h4>
              <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 6px;">PID: <code style="color: #f0bb85; font-weight: 600;">${pid}</code></div>
              
              <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-dim); padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
                <span>Harga: <strong style="color: #fff;">${price}</strong></span>
                <span title="Video yang sudah berhasil diposting dengan produk ini">Video: ${videoCountHtml(pid)}</span>
              </div>
            </div>

            <div style="margin-top: 6px;" onclick="event.stopPropagation();">
              <button type="button" class="btn-execute btn-remove-showcase-product" data-pid="${pid}" style="width: 100%; height: 34px; font-size: 12px; font-weight: 600; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); border: none; border-radius: 6px; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span>Remove dari Etalase</span>
              </button>
            </div>
          </div>
        `;
      }

      return `
        <div class="studio-card product-card-clickable" data-idx="${idx}" style="cursor: pointer; margin-bottom: 0; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
          <div>
            <div style="width: 100%; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: #17191c; margin-bottom: 10px; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.06);">
              <img src="${cover}" alt="${title}" referrerpolicy="no-referrer" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover; display: block;" 
                   onerror="if (!this.dataset.triedBackup) { this.dataset.triedBackup = '1'; this.src='https://p16-oec-va.ibyteimg.com/tos-maliva-i-o3syd03w52-us/${pid}.jpeg~tplv-oec-720:720.jpeg'; } else { this.onerror=null; this.src='https://placehold.co/400x400/181920/a78bfa?text=PID+${pid.slice(-6)}'; }">
              <span style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.85); backdrop-filter: blur(4px); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #10b981; border: 1px solid rgba(16,185,129,0.3);">
                Komisi ${commission}
              </span>
            </div>
            <h4 style="font-size: 13.5px; font-weight: 600; color: #fff; line-height: 1.4; margin: 0 0 6px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${title}">${title}</h4>
            <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 6px;">PID: <code style="color: #f0bb85; font-weight: 600;">${pid}</code></div>
            
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-dim); padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
              <span>Harga: <strong style="color: #fff;">${price}</strong></span>
              <span title="Video yang sudah berhasil diposting dengan produk ini">Video: ${videoCountHtml(pid)}</span>
            </div>
            ${topVideosHtml(item, idx)}
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;" onclick="event.stopPropagation();">
            <button type="button" class="btn-execute btn-add-new-product" data-url="${tiktokProductUrl}" data-pid="${pid}" style="height: 34px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #35b29f 0%, #10b981 100%); border: none; border-radius: 6px; color: #fff; cursor: pointer;">
              <span>Add Produk</span>
            </button>
            <button type="button" class="btn-execute btn-copy-product-url" data-url="${tiktokProductUrl}" data-pid="${pid}" style="height: 34px; font-size: 12px; background: linear-gradient(135deg, #35b29f 0%, #e8a25c 100%); border: none; border-radius: 6px; color: #fff; cursor: pointer;">
              <span>Salin URL Produk TikTok</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.product-card-clickable').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx, 10);
        if (!isNaN(idx) && currentProductsList[idx]) {
          openProductDetailModal(currentProductsList[idx]);
        }
      });
    });

    container.querySelectorAll('.btn-open-top-video').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const product = currentProductsList[parseInt(btn.dataset.productIdx, 10)];
        const videos = (product?.topVideos || []).filter((v) => v && v.id).slice(0, 3);
        if (videos.length) openGmvVideoPlayer(product, videos, parseInt(btn.dataset.videoIdx, 10) || 0);
        else window.electronAPI?.openExternalUrl?.(btn.dataset.url);
      });
    });

    container.querySelectorAll('.btn-copy-product-url').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const productUrl = btn.dataset.url;
        try {
          await navigator.clipboard.writeText(productUrl);
          const oriHtml = btn.innerHTML;
          const oriBg = btn.style.background;
          btn.style.background = '#10b981';
          btn.innerHTML = '<span>✓ URL Berhasil Disalin!</span>';
          setTimeout(() => {
            btn.style.background = oriBg;
            btn.innerHTML = oriHtml;
          }, 2000);
        } catch (err) {
          prompt('Salin URL produk berikut:', productUrl);
        }
      });
    });

    container.querySelectorAll('.btn-add-new-product').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        if (!url) return;

        btn.disabled = true;
        const origHtml = btn.innerHTML;
        const origBg = btn.style.background;
        btn.innerHTML = '<span>Menambahkan...</span>';

        try {
          const res = await window.electronAPI?.previewTikTokProductUrl?.(url);
          if (res?.success) {
            btn.style.background = '#10b981';
            btn.innerHTML = '<span>✓ Berhasil Ditambahkan!</span>';
            const activeUser = getActiveAccountIdentifier();
            window.electronAPI?.getTiktokShowcaseProducts?.(true, activeUser).catch(() => {});
            setTimeout(() => {
              btn.disabled = false;
              btn.style.background = origBg;
              btn.innerHTML = origHtml;
            }, 2500);
          } else {
            alert('Gagal menambahkan produk: ' + (res?.error || 'Terjadi kesalahan.'));
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
        } catch (e) {
          alert('Error: ' + e.message);
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      });
    });

    container.querySelectorAll('.btn-remove-showcase-product').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.pid;
        if (!pid) return;

        if (!confirm(`Apakah Anda yakin ingin menghapus produk (PID: ${pid}) dari etalase TikTok?`)) {
          return;
        }

        btn.disabled = true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<span>Menghapus...</span>';

        try {
          const res = await window.electronAPI?.removeTikTokShowcaseProduct?.(pid);
          if (res?.success) {
            btn.innerHTML = '<span>✓ Terhapus!</span>';
            const cardEl = btn.closest('.product-card-clickable') || btn.closest('.studio-card');
            if (cardEl) {
              cardEl.style.transition = 'opacity 0.3s ease';
              cardEl.style.opacity = '0';
              setTimeout(() => cardEl.remove(), 300);
            }
            // Tampilkan langsung produk yang masih ada di etalase
            setTimeout(() => {
              loadActiveAccountShowcase(false, { success: true, data: res.data || currentProductsList.filter((p) => String(p.productId || p.id) !== String(pid)), account: res.account });
            }, 350);
          } else {
            alert('Gagal menghapus produk: ' + (res?.error || 'Terjadi kesalahan.'));
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
        } catch (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      });
    });
  }

  function generateTrendSvg(pointsArray) {
    if (!Array.isArray(pointsArray) || pointsArray.length < 2) return '';
    const width = 500;
    const height = 120;
    const max = Math.max(...pointsArray, 1);
    const min = Math.min(...pointsArray, 0);

    const stepX = width / (pointsArray.length - 1);
    const coords = pointsArray.map((val, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (height - ((val - min) / (max - min || 1)) * (height - 20) - 10).toFixed(1);
      return `${x},${y}`;
    });

    const pathD = `M ${coords.join(' L ')}`;
    const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;

    return `
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 110px; overflow: visible;">
        <defs>
          <linearGradient id="trendGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#35b29f" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#35b29f" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <path d="${areaD}" fill="url(#trendGrad)" />
        <path d="${pathD}" fill="none" stroke="#35b29f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  function ensureImagePreviewModalExists() {
    if (document.getElementById('productImageLightboxModal')) return;

    const lightboxHtml = `
      <div id="productImageLightboxModal" style="display: none; position: fixed; inset: 0; z-index: 100000; background: rgba(13, 14, 16, 0.45); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); align-items: center; justify-content: center; padding: 20px; user-select: none;">
        
        <button id="btnCloseLightboxModal" type="button" style="position: absolute; top: 24px; right: 28px; background: rgba(239,68,68,0.85); border: 2px solid rgba(255,255,255,0.8); color: #fff; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 100002; transition: all 0.2s ease;">✕</button>

        <button id="btnLightboxPrev" type="button" style="position: absolute; left: 28px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #fff; width: 52px; height: 52px; border-radius: 50%; font-size: 26px; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 100002; transition: all 0.2s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.4);">❮</button>

        <button id="btnLightboxNext" type="button" style="position: absolute; right: 28px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #fff; width: 52px; height: 52px; border-radius: 50%; font-size: 26px; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 100002; transition: all 0.2s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.4);">❯</button>

        <div style="position: relative; max-width: 86vw; max-height: 84vh; display: flex; flex-direction: column; align-items: center; justify-content: center;" onclick="event.stopPropagation();">
          <img id="lightboxBigImage" src="" alt="Detail Gambar Produk" referrerpolicy="no-referrer" style="max-width: 84vw; max-height: 80vh; object-fit: contain; border-radius: 12px; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 20px 50px rgba(0,0,0,0.6); background: transparent; display: block;" />
          
          <div id="lightboxCounterBadge" style="margin-top: 14px; background: rgba(20, 22, 25, 0.65); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.2); color: #e7e5e0; font-size: 13px; font-weight: 600; padding: 5px 16px; border-radius: 20px; letter-spacing: 0.5px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">1 / 1</div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', lightboxHtml);

    const lightbox = document.getElementById('productImageLightboxModal');
    const btnClose = document.getElementById('btnCloseLightboxModal');
    const btnPrev = document.getElementById('btnLightboxPrev');
    const btnNext = document.getElementById('btnLightboxNext');

    btnClose?.addEventListener('click', () => {
      lightbox.style.display = 'none';
    });

    lightbox?.addEventListener('click', (e) => {
      if (e.target.id === 'productImageLightboxModal') {
        lightbox.style.display = 'none';
      }
    });

    btnPrev?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(-1);
    });

    btnNext?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(1);
    });

    window.addEventListener('keydown', (e) => {
      if (lightbox && lightbox.style.display === 'flex') {
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
        if (e.key === 'Escape') lightbox.style.display = 'none';
      }
    });
  }

  function updateLightboxDisplay() {
    if (!currentLightboxImages || currentLightboxImages.length === 0) return;
    const bigImg = document.getElementById('lightboxBigImage');
    const badge = document.getElementById('lightboxCounterBadge');
    const btnPrev = document.getElementById('btnLightboxPrev');
    const btnNext = document.getElementById('btnLightboxNext');

    if (currentLightboxIndex < 0) currentLightboxIndex = currentLightboxImages.length - 1;
    if (currentLightboxIndex >= currentLightboxImages.length) currentLightboxIndex = 0;

    const currentUrl = currentLightboxImages[currentLightboxIndex];
    if (bigImg && currentUrl) {
      bigImg.src = currentUrl;
    }

    if (badge) {
      badge.textContent = `${currentLightboxIndex + 1} / ${currentLightboxImages.length}`;
    }

    const multi = currentLightboxImages.length > 1;
    if (btnPrev) btnPrev.style.display = multi ? 'flex' : 'none';
    if (btnNext) btnNext.style.display = multi ? 'flex' : 'none';
  }

  function navigateLightbox(step) {
    if (!currentLightboxImages || currentLightboxImages.length <= 1) return;
    currentLightboxIndex += step;
    updateLightboxDisplay();
  }

  function showBigImagePopup(imagesArray, startIndex = 0) {
    ensureImagePreviewModalExists();
    const lightbox = document.getElementById('productImageLightboxModal');
    
    const validList = (Array.isArray(imagesArray) ? imagesArray : [imagesArray]).filter(url => isValidProductImageUrl(url));
    if (validList.length === 0) return;

    currentLightboxImages = validList;
    currentLightboxIndex = startIndex >= 0 && startIndex < validList.length ? startIndex : 0;

    updateLightboxDisplay();
    if (lightbox) {
      lightbox.style.display = 'flex';
    }
  }

  function ensureDetailModalExists() {
    if (document.getElementById('kalodataDetailModal')) return;

    const modalHtml = `
      <div id="kalodataDetailModal" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
        <div style="background: #181924; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; width: 100%; max-width: 740px; max-height: 90vh; overflow-y: auto; padding: 22px; position: relative; box-shadow: 0 20px 40px rgba(0,0,0,0.6); color: #fff;">
          
          <button id="btnCloseDetailModal" type="button" style="position: absolute; top: 14px; right: 14px; background: rgba(255,255,255,0.06); border: none; color: #bbb; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>

          <div style="display: flex; gap: 18px; margin-bottom: 18px;">
            <div style="position: relative; width: 110px; height: 110px; flex-shrink: 0; cursor: pointer;" title="Klik untuk memperbesar foto">
              <img id="modalCoverImg" src="" alt="Cover" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #111;" />
              <span style="position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.75); padding: 2px 4px; border-radius: 4px; font-size: 10px; color: #9d9c97;">Zoom</span>
            </div>
            <div style="flex: 1;">
              <h3 id="modalProductTitle" style="font-size: 15px; font-weight: 600; line-height: 1.4; margin: 0 0 8px 0; color: #fff;"></h3>
              <div style="font-size: 12px; color: #9d9c97; display: flex; flex-wrap: wrap; gap: 12px;">
                <span>PID: <code id="modalProductId" style="color: #f0bb85; font-weight: 600;"></code></span>
                <span>Rating: <strong id="modalProductRating" style="color: #f59e0b;">-</strong></span>
                <span>Rilis: <span id="modalLaunchDate">-</span></span>
              </div>
              <div style="margin-top: 10px; display: flex; gap: 10px; font-size: 12.5px;">
                <span style="background: rgba(16,185,129,0.15); color: #10b981; padding: 3px 8px; border-radius: 4px; font-weight: 600; border: 1px solid rgba(16,185,129,0.3);">
                  <span id="modalCommissionRate">-</span>
                </span>
                <span style="background: rgba(53, 178, 159,0.15); color: #6fcdbd; padding: 3px 8px; border-radius: 4px; font-weight: 600; border: 1px solid rgba(53, 178, 159,0.3);">
                  Harga: <span id="modalPriceRange">-</span>
                </span>
              </div>
            </div>
          </div>

          <div id="modalGalleryWrapper" style="display: none; margin-bottom: 20px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9d9c97; margin: 0;">Product Images (Klik Foto untuk Memperbesar)</h4>
              <span id="modalGalleryStatus" style="font-size: 11px; color: #73726d;">Memuat gambar...</span>
            </div>
            <div id="modalGalleryContainer" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 10px; max-height: 180px; overflow-y: auto; padding: 2px;">
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
            <h4 id="modalMetricsTitle" style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9d9c97; margin: 0;">Metrik Inti Penjualan (30 Hari)</h4>
            
            <div style="display: inline-flex; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; overflow: hidden; background: #16181b;">
              <button type="button" id="btnFilterYesterday" class="btn-range-filter" data-range="1" style="border: none; padding: 5px 12px; font-size: 11.5px; font-weight: 600; color: #9d9c97; background: transparent; cursor: pointer; border-right: 1px solid rgba(255,255,255,0.1);">Kemarin</button>
              <button type="button" id="btnFilter7Days" class="btn-range-filter" data-range="7" style="border: none; padding: 5px 12px; font-size: 11.5px; font-weight: 600; color: #9d9c97; background: transparent; cursor: pointer; border-right: 1px solid rgba(255,255,255,0.1);">7 hari terakhir</button>
              <button type="button" id="btnFilter30Days" class="btn-range-filter" data-range="30" style="border: none; padding: 5px 12px; font-size: 11.5px; font-weight: 600; color: #35b29f; background: rgba(53, 178, 159,0.15); cursor: pointer;">30 hari terakhir</button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Total Pendapatan</span>
              <strong id="modalRevenue" style="font-size: 15px; color: #35b29f;">-</strong>
            </div>
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Total Penjualan</span>
              <strong id="modalSales" style="font-size: 15px; color: #10b981;">-</strong>
            </div>
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Harga Satuan Rata-rata</span>
              <strong id="modalUnitPrice" style="font-size: 15px; color: #fff;">-</strong>
            </div>
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Pertumbuhan Omzet</span>
              <strong id="modalGrowthRate" style="font-size: 15px; color: #f59e0b;">-</strong>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Pendapatan Video</span>
              <strong id="modalVideoRevenue" style="font-size: 14px; color: #f0bb85;">-</strong>
            </div>
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Pendapatan Live</span>
              <strong id="modalLiveRevenue" style="font-size: 14px; color: #e8a25c;">-</strong>
            </div>
            <div style="background: #16181b; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size: 11px; color: #9d9c97; display: block;">Jumlah Kreator Aktif</span>
              <strong id="modalCreatorNum" style="font-size: 14px; color: #6fcdbd;">-</strong>
            </div>
          </div>

          <div id="modalTrendContainer" style="background: #16181b; padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span id="modalTrendLabel" style="font-size: 12px; font-weight: 600; color: #9d9c97;">Grafik Tren Omzet Harian (30 Hari Terakhir)</span>
              <span style="font-size: 11px; color: #35b29f;">● Omzet</span>
            </div>
            <div id="modalTrendChartSvg"></div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="btnModalAddProduct" type="button" style="height: 38px; padding: 0 16px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #35b29f 0%, #10b981 100%); border: none; border-radius: 6px; color: #fff; cursor: pointer;">
              Add ke Etalase TikTok
            </button>
            <button id="btnModalCopyUrl" type="button" style="height: 38px; padding: 0 16px; font-size: 13px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; cursor: pointer;">
              Salin URL Produk
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btnCloseDetailModal')?.addEventListener('click', () => {
      document.getElementById('kalodataDetailModal').style.display = 'none';
    });

    document.getElementById('kalodataDetailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'kalodataDetailModal') {
        document.getElementById('kalodataDetailModal').style.display = 'none';
      }
    });

    document.getElementById('modalCoverImg')?.addEventListener('click', () => {
      const src = document.getElementById('modalCoverImg').src;
      if (src && isValidProductImageUrl(src)) {
        const currentList = Array.isArray(activeDetailItem?.images) && activeDetailItem.images.length > 0 
          ? activeDetailItem.images 
          : [src];
        const activeIdx = currentList.indexOf(src);
        showBigImagePopup(currentList, activeIdx >= 0 ? activeIdx : 0);
      }
    });

    document.querySelectorAll('.btn-range-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        if (range) {
          setTimeRange(range);
        }
      });
    });
  }

  function setTimeRange(range) {
    activeTimeRange = range;

    const btn1 = document.getElementById('btnFilterYesterday');
    const btn7 = document.getElementById('btnFilter7Days');
    const btn30 = document.getElementById('btnFilter30Days');

    [btn1, btn7, btn30].forEach((b) => {
      if (!b) return;
      b.style.color = '#9d9c97';
      b.style.background = 'transparent';
    });

    const activeBtn = range === '1' ? btn1 : (range === '7' ? btn7 : btn30);
    if (activeBtn) {
      activeBtn.style.color = '#35b29f';
      activeBtn.style.background = 'rgba(53, 178, 159,0.15)';
    }

    if (activeDetailItem) {
      renderMetricsByTimeRange(activeDetailItem, range);
    }
  }

  function renderMetricsByTimeRange(item, range) {
    const titleEl = document.getElementById('modalMetricsTitle');
    const trendLabel = document.getElementById('modalTrendLabel');
    const rawTrend = Array.isArray(item.revenue_trend) ? item.revenue_trend : [];

    let displayTrend = rawTrend;
    let label = '30 Hari';

    if (range === '1') {
      label = 'Kemarin';
      displayTrend = rawTrend.slice(-2);
    } else if (range === '7') {
      label = '7 Hari Terakhir';
      displayTrend = rawTrend.slice(-7);
    } else {
      label = '30 Hari Terakhir';
      displayTrend = rawTrend;
    }

    if (titleEl) titleEl.textContent = `METRIK INTI PENJUALAN (${label.toUpperCase()})`;
    if (trendLabel) trendLabel.textContent = `Grafik Tren Omzet Harian (${label})`;

    const total30TrendSum = rawTrend.reduce((a, b) => a + b, 0) || 1;
    let selectedRevenueSum = 0;

    if (range === '1') {
      selectedRevenueSum = rawTrend[rawTrend.length - 1] || 0;
    } else if (range === '7') {
      selectedRevenueSum = rawTrend.slice(-7).reduce((a, b) => a + b, 0);
    } else {
      selectedRevenueSum = total30TrendSum;
    }

    const ratio = Math.min(1, Math.max(0, selectedRevenueSum / total30TrendSum));
    const baseSale = Number(item.sale || 0);

    const parseRupiahText = (txt) => {
      if (!txt || typeof txt !== 'string') return 0;
      const clean = txt.replace('Rp', '').trim();
      if (clean.includes('M')) return parseFloat(clean.replace(',', '.')) * 1000000000;
      if (clean.includes('JT')) return parseFloat(clean.replace(',', '.')) * 1000000;
      if (clean.includes('RB')) return parseFloat(clean.replace(',', '.')) * 1000;
      return parseFloat(clean.replace(/[^0-9.]/g, '')) || 0;
    };

    const baseVideoRev = parseRupiahText(item.video_revenue);
    const baseLiveRev = parseRupiahText(item.live_revenue);
    const baseCreator = Number(item.creator_num || 0);

    if (range === '30') {
      document.getElementById('modalRevenue').textContent = item.revenue || formatRupiahShort(selectedRevenueSum);
      document.getElementById('modalSales').textContent = `${baseSale.toLocaleString('id-ID')} terjual`;
      document.getElementById('modalVideoRevenue').textContent = item.video_revenue || '-';
      document.getElementById('modalLiveRevenue').textContent = item.live_revenue || '-';
      document.getElementById('modalCreatorNum').textContent = `${baseCreator.toLocaleString('id-ID')} orang`;
      document.getElementById('modalGrowthRate').textContent = item.revenue_grouping_rate || '-';
    } else {
      document.getElementById('modalRevenue').textContent = formatRupiahShort(selectedRevenueSum);
      document.getElementById('modalSales').textContent = `${Math.round(baseSale * ratio).toLocaleString('id-ID')} terjual`;
      document.getElementById('modalVideoRevenue').textContent = formatRupiahShort(baseVideoRev * ratio);
      document.getElementById('modalLiveRevenue').textContent = formatRupiahShort(baseLiveRev * ratio);
      document.getElementById('modalCreatorNum').textContent = `${Math.max(1, Math.round(baseCreator * (range === '1' ? 0.35 : 0.75))).toLocaleString('id-ID')} orang`;
      
      if (range === '1' && rawTrend.length >= 2) {
        const last1 = rawTrend[rawTrend.length - 1];
        const last2 = rawTrend[rawTrend.length - 2] || last1;
        const diff = (((last1 - last2) / (last2 || 1)) * 100).toFixed(1);
        document.getElementById('modalGrowthRate').textContent = `${diff >= 0 ? '+' : ''}${diff}%`;
      } else {
        document.getElementById('modalGrowthRate').textContent = item.revenue_grouping_rate || '-';
      }
    }

    if (item.unit_price) {
      const cleanUnitPrice = String(item.unit_price).replace(/^Rp/i, '').trim();
      document.getElementById('modalUnitPrice').textContent = `Rp${cleanUnitPrice}`;
    } else {
      document.getElementById('modalUnitPrice').textContent = '-';
    }

    const chartContainer = document.getElementById('modalTrendChartSvg');
    if (displayTrend.length > 0) {
      document.getElementById('modalTrendContainer').style.display = 'block';
      chartContainer.innerHTML = generateTrendSvg(displayTrend);
    } else {
      document.getElementById('modalTrendContainer').style.display = 'none';
      chartContainer.innerHTML = '';
    }
  }

  function renderGalleryElements(containerEl, statusEl, imagesList, defaultCover) {
    if (!containerEl) return;
    const cleanList = imagesList.filter(url => isValidProductImageUrl(url));
    const allImages = Array.from(new Set([defaultCover, ...cleanList])).filter(Boolean);

    containerEl.innerHTML = allImages.map((imgUrl, i) => `
      <div class="gallery-thumb-item" data-index="${i}" style="position: relative; aspect-ratio: 1/1; border-radius: 6px; overflow: hidden; border: 1px solid ${i === 0 ? '#35b29f' : 'rgba(255,255,255,0.1)'}; background: #111; cursor: pointer;">
        <img src="${imgUrl}" alt="Photo ${i + 1}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
        ${i === 0 ? '<span style="position: absolute; bottom: 0; left: 0; right: 0; background: #35b29f; font-size: 9.5px; text-align: center; font-weight: 700; color: #fff; padding: 2px 0;">Cover</span>' : ''}
      </div>
    `).join('');

    containerEl.querySelectorAll('.gallery-thumb-item').forEach((box) => {
      box.addEventListener('click', () => {
        const idx = parseInt(box.dataset.index, 10) || 0;
        const img = box.querySelector('img');
        if (img && isValidProductImageUrl(img.src)) {
          document.getElementById('modalCoverImg').src = img.src;
        }
        showBigImagePopup(allImages, idx);
      });
    });

    if (statusEl) {
      statusEl.textContent = `${allImages.length} foto tersedia`;
    }
  }

  function openProductDetailModal(item) {
    ensureDetailModalExists();
    const modal = document.getElementById('kalodataDetailModal');
    if (!modal) return;

    const pid = String(item.id || item.productId || '').trim();

    let fullData = item;
    if (pid && item.isStreamerShowcase) {
      const matchedKalo = currentProductsList.find((p) => String(p.id || p.productId) === pid && !p.isStreamerShowcase);
      if (matchedKalo) {
        fullData = {
          ...matchedKalo,
          ...item,
          revenue: matchedKalo.revenue,
          isStreamerShowcase: true
        };
      }
    }

    activeDetailItem = fullData;

    const cover = getProductCoverUrl(fullData);
    const title = fullData.product_title || fullData.title || 'Produk TikTok';
    const tiktokUrl = `https://www.tiktok.com/view/product/${pid}`;

    document.getElementById('modalCoverImg').src = cover;
    document.getElementById('modalProductTitle').textContent = title;
    document.getElementById('modalProductId').textContent = pid || '-';
    document.getElementById('modalProductRating').textContent = `${fullData.product_rating || '4.8'}/5`;
    document.getElementById('modalLaunchDate').textContent = fullData.launch_date || '-';

    let komisiVal = String(fullData.commission_rate || fullData.commission || '-').trim();
    if (komisiVal.toLowerCase().startsWith('komisi')) {
      komisiVal = komisiVal.replace(/^komisi\s*/i, '');
    }
    document.getElementById('modalCommissionRate').textContent = komisiVal !== '-' ? `Komisi ${komisiVal}` : '-';

    const cleanMin = fullData.min_real_price ? `Rp${String(fullData.min_real_price).replace(/^Rp/i, '')}` : (fullData.itemPrice || fullData.price || '-');
    const cleanMax = fullData.max_real_price ? `Rp${String(fullData.max_real_price).replace(/^Rp/i, '')}` : '';
    document.getElementById('modalPriceRange').textContent = (cleanMax && cleanMax !== cleanMin) ? `${cleanMin} - ${cleanMax}` : cleanMin;

    const galleryWrapper = document.getElementById('modalGalleryWrapper');
    const galleryContainer = document.getElementById('modalGalleryContainer');
    const galleryStatus = document.getElementById('modalGalleryStatus');

    if (galleryWrapper && galleryContainer) {
      if (fullData.isStreamerShowcase) {
        galleryWrapper.style.display = 'block';

        const existingImages = Array.isArray(fullData.images) && fullData.images.length > 1
          ? fullData.images
          : (Array.isArray(item.images) && item.images.length > 1 ? item.images : []);

        if (existingImages.length > 1) {
          renderGalleryElements(galleryContainer, galleryStatus, existingImages, cover);
        } else {
          renderGalleryElements(galleryContainer, galleryStatus, [], cover);
          if (galleryStatus) galleryStatus.textContent = 'Memuat galeri foto...';

          if (pid && pid !== '-') {
            window.electronAPI?.getTikTokProductImages?.(pid).then((res) => {
              if (res?.success && Array.isArray(res.images) && res.images.length > 0) {
                fullData.images = res.images;
                item.images = res.images;
                renderGalleryElements(galleryContainer, galleryStatus, res.images, cover);
              } else {
                if (galleryStatus) galleryStatus.textContent = '1 foto tersedia';
              }
            }).catch(() => {
              if (galleryStatus) galleryStatus.textContent = '1 foto tersedia';
            });
          }
        }
      } else {
        galleryWrapper.style.display = 'none';
        galleryContainer.innerHTML = '';
      }
    }

    setTimeRange('30');

    const btnAction = document.getElementById('btnModalAddProduct');
    const btnCopy = document.getElementById('btnModalCopyUrl');

    if (btnAction) {
      if (item.isStreamerShowcase) {
        btnAction.style.background = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)';
        btnAction.innerHTML = '<span>Remove dari Etalase</span>';
        btnAction.onclick = async () => {
          if (!confirm(`Hapus produk ini (PID: ${pid}) dari etalase TikTok?`)) return;
          btnAction.disabled = true;
          btnAction.innerHTML = '<span>Menghapus...</span>';
          try {
            const res = await window.electronAPI?.removeTikTokShowcaseProduct?.(pid);
            if (res?.success) {
              btnAction.innerHTML = '<span>✓ Terhapus!</span>';
              setTimeout(() => {
                modal.style.display = 'none';
                loadActiveAccountShowcase(true);
              }, 1000);
            } else {
              alert('Gagal: ' + (res?.error || 'Kesalahan sistem'));
              btnAction.disabled = false;
              btnAction.innerHTML = '<span>Remove dari Etalase</span>';
            }
          } catch (e) {
            alert('Error: ' + e.message);
            btnAction.disabled = false;
            btnAction.innerHTML = '<span>Remove dari Etalase</span>';
          }
        };
      } else {
        btnAction.style.background = 'linear-gradient(135deg, #35b29f 0%, #10b981 100%)';
        btnAction.innerHTML = '<span>Add ke Etalase TikTok</span>';
        btnAction.onclick = async () => {
          btnAction.disabled = true;
          const prevHtml = btnAction.innerHTML;
          btnAction.innerHTML = '<span>Memproses...</span>';
          try {
            const res = await window.electronAPI?.previewTikTokProductUrl?.(tiktokUrl);
            if (res?.success) {
              btnAction.style.background = '#10b981';
              btnAction.innerHTML = '<span>✓ Berhasil Ditambahkan!</span>';
              const activeUser = getActiveAccountIdentifier();
              window.electronAPI?.getTiktokShowcaseProducts?.(true, activeUser).catch(() => {});
              setTimeout(() => {
                btnAction.disabled = false;
                btnAction.style.background = 'linear-gradient(135deg, #35b29f 0%, #10b981 100%)';
                btnAction.innerHTML = prevHtml;
              }, 2500);
            } else {
              alert('Gagal menambahkan produk: ' + (res?.error || 'Kesalahan sistem'));
              btnAction.disabled = false;
              btnAction.innerHTML = prevHtml;
            }
          } catch (e) {
            alert('Error: ' + e.message);
            btnAction.disabled = false;
            btnAction.innerHTML = prevHtml;
          }
        };
      }
    }

    if (btnCopy) {
      btnCopy.onclick = async () => {
        await navigator.clipboard.writeText(tiktokUrl);
        const ori = btnCopy.textContent;
        btnCopy.textContent = '✓ URL Disalin!';
        setTimeout(() => { btnCopy.textContent = ori; }, 2000);
      };
    }

    modal.style.display = 'flex';
  }

  btnRefresh?.addEventListener('click', () => {
    if (currentViewMode === 'tiktok') loadActiveAccountShowcase(true);
    else loadKalodataData();
  });

  btnClear?.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin mengosongkan antrean produk showcase ini?')) return;
    try {
      const res = await window.electronAPI?.clearKalodataProducts?.();
      if (res?.success) {
        if (rawJsonInput) rawJsonInput.value = '';
        if (currentViewMode === 'tiktok') loadActiveAccountShowcase(true);
        else loadKalodataData();
      }
    } catch (err) {
      alert('Terjadi kesalahan: ' + err.message);
    }
  });

  btnProcessRaw?.addEventListener('click', async () => {
    const rawVal = rawJsonInput?.value?.trim();
    if (!rawVal) return alert('Silakan tempel teks JSON produk terlebih dahulu.');
    try {
      const parsed = parseFlexibleJson(rawVal);
      const res = await window.electronAPI?.saveKalodataRawJson?.(parsed);
      if (res?.success) {
        if (rawJsonInput) rawJsonInput.value = '';
        loadKalodataData();
      } else {
        alert('Gagal menyimpan data: ' + (res?.error || 'Terjadi kesalahan sistem.'));
      }
    } catch (e) {
      alert(e.message || 'Teks bukan format JSON yang valid.');
    }
  });

  btnImport?.addEventListener('click', async () => {
    const res = await window.electronAPI?.importKalodataFile?.();
    if (res?.success) {
      if (currentViewMode === 'kalodata') loadKalodataData();
      else loadActiveAccountShowcase(true);
    }
  });

  // Listener Otomatis: Saat menu tab Showcase dibuka di antarmuka
  const tabShowcaseMenu = document.querySelectorAll('#tabShowcase, [data-tab="showcase"], [data-view="viewShowcase"]');
  tabShowcaseMenu.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (currentViewMode === 'tiktok') {
        loadActiveAccountShowcase(false);
      }
    });
  });

  // Listener Otomatis: Saat berpindah akun TikTok di aplikasi
  window.addEventListener('load-showcase', () => {
    if (currentViewMode === 'tiktok') {
      loadActiveAccountShowcase(false);
    }
  });

  // Dari main process: etalase selesai disinkronkan di latar belakang (login / ganti akun / hapus produk)
  window.electronAPI?.onLoadShowcase?.(() => {
    if (currentViewMode === 'tiktok') loadActiveAccountShowcase(false);
  });

  window.addEventListener('account-switched', (e) => {
    if (e?.detail?.username && txtAccountName) {
      txtAccountName.textContent = `@${e.detail.username}`;
    }
    if (currentViewMode === 'tiktok') {
      loadActiveAccountShowcase(false);
    }
  });

  if (window.electronAPI?.onAccountSwitched) {
    window.electronAPI.onAccountSwitched((acc) => {
      const username = acc?.username || acc?.name || '';
      if (username && txtAccountName) {
        txtAccountName.textContent = `@${username.replace('@', '')}`;
      }
      if (currentViewMode === 'tiktok') {
        loadActiveAccountShowcase(false);
      }
    });
  }

  // Muat pertama kali secara otomatis
  loadActiveAccountShowcase(false);
}