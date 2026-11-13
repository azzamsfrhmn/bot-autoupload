// Injeksi skrip interceptor ke lingkup halaman web Kalodata
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(s);

// Dengarkan data yang dikirim dari injected script
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // Video GMV tertinggi per produk (dari /product/enrich, datang sesudah daftar produk)
  if (event.data.type === 'KALODATA_VIDEOS_CAPTURED') {
    Object.assign(topVideosByProduct, event.data.payload || {});
    if (latestProducts.length) updateFloatingWidget(latestProducts);
    return;
  }

  // Link putar video dari Kalodata (getVideoUrl)
  if (event.data.type === 'KALODATA_VIDEO_URL') {
    const { id, url } = event.data.payload || {};
    if (id && url) videoPlayUrls[id] = url;
    Object.values(detailBuffer).forEach((p) => {
      const v = (p.topVideos || []).find((x) => x.id === id);
      if (v && url && v.playUrl !== url) {
        v.playUrl = url;
        try { chrome.runtime.sendMessage({ action: 'saveKalodataProducts', products: [{ id: p.id, topVideos: p.topVideos }] }, () => void chrome.runtime.lastError); } catch (e) {}
      }
    });
    clearTimeout(videoUrlRefreshTimer);
    videoUrlRefreshTimer = setTimeout(() => latestProducts.length && updateFloatingWidget(latestProducts), 400);
    return;
  }

  if (event.data.type === 'KALODATA_VIDEO_URL_ERROR') {
    lastVideoUrlError = event.data.payload?.error || '';
    if (latestProducts.length) updateFloatingWidget(latestProducts);
    return;
  }

  if (event.data.type === 'KALODATA_DETAIL_CAPTURED') {
    const { id, kind, data, startDate, endDate } = event.data.payload || {};
    if (!id) return;
    const d = detailBuffer[id] || (detailBuffer[id] = { id });
    if (kind === 'info') {
      Object.assign(d, {
        product_title: data.product_title || data.name || d.product_title,
        unit_price: data.unit_price || d.unit_price,
        min_real_price: data.min_real_price,
        commission_rate: data.commission_rate || d.commission_rate,
        product_rating: data.product_rating,
        review_count: data.review_count,
        shop_name: data.brand_name || d.shop_name,
        seller_id: data.seller_id
      });
    } else if (kind === 'total') {
      const days = startDate && endDate ? Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1 : 0;
      Object.assign(d, {
        revenue: data.revenue, sale: data.sale, video_revenue: data.video_revenue, live_revenue: data.live_revenue,
        shopping_mall_revenue: data.shopping_mall_revenue, creator_num: data.related_creator_count,
        unit_price: data.unit_price || d.unit_price, range_days: days || d.range_days, range_label: startDate && endDate ? `${startDate} – ${endDate}` : d.range_label
      });
    } else if (kind === 'history' && Array.isArray(data) && data.length) {
      const days = data.filter((r) => r && r.partition_day).sort((a, b) => String(a.partition_day).localeCompare(String(b.partition_day)));
      d.revenue_trend = days.map((r) => Number(r.revenue) || 0);
      d.revenue_trend_dates = days.map((r) => String(r.partition_day));
      d.sale_trend = days.map((r) => Number(r.sale) || 0);
    } else if (kind === 'videos' && Array.isArray(data) && data.length) {
      d.topVideos = data.slice(0, 3).map((v, i) => ({
        rank: i + 1, id: v.id, revenue: v.revenue, views: v.views, handle: v.handle,
        tiktokUrl: v.handle ? `https://www.tiktok.com/@${v.handle}/video/${v.id}` : `https://www.tiktok.com/@/video/${v.id}`,
        playUrl: videoPlayUrls[v.id] || '',
        coverUrl: `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`
      }));
    } else if (kind === 'images' && Array.isArray(data) && data.length) {
      d.coverUrl = data[0];
      d.images = data.slice(0, 9);
    }
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => {
      Object.values(detailBuffer).forEach((p) => {
        const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));
        try { chrome.runtime.sendMessage({ action: 'saveKalodataProducts', products: [{ ...clean, source: 'kalodata_detail' }] }, () => void chrome.runtime.lastError); } catch (e) {}
      });
    }, 800);
    return;
  }

  if (event.data.type === 'KALODATA_SEARCH_SEEN') {
    try { chrome.runtime.sendMessage({ action: 'kaloSearchSeen', info: event.data.payload, url: location.href }, () => void chrome.runtime.lastError); } catch (e) {}
    return;
  }
  if (event.data.type === 'KALODATA_SEARCH_READY' || event.data.type === 'ETNIC_SEARCH_DONE') {
    try {
      chrome.runtime.sendMessage({ action: event.data.type === 'KALODATA_SEARCH_READY' ? 'kaloSearchReady' : 'kaloSearchDone', ...(event.data.payload || {}) }, () => void chrome.runtime.lastError);
    } catch (e) {}
    return;
  }

  if (event.data.type === 'KALODATA_QUOTA') {
    try { chrome.runtime.sendMessage({ action: 'kaloQuota', quota: event.data.payload }, () => void chrome.runtime.lastError); } catch (e) {}
    return;
  }
  if (event.data.type === 'KALODATA_AUTO_DONE') {
    // Tunggu simpanan data detail (debounce 800 ms) selesai dulu
    setTimeout(() => {
      try { chrome.runtime.sendMessage({ action: 'kaloAutoDone', ...(event.data.payload || {}) }, () => void chrome.runtime.lastError); } catch (e) {}
    }, 1500);
    return;
  }

  if (event.data.type === 'KALODATA_API_LOG') {
    try {
      chrome.storage.local.get('kaloApiLog', ({ kaloApiLog = [] }) => {
        const e = event.data.payload;
        const key = `${e.method} ${e.path}`;
        const next = [e, ...kaloApiLog.filter((x) => `${x.method} ${x.path}` !== key)].slice(0, 80);
        chrome.storage.local.set({ kaloApiLog: next });
      });
    } catch (err) {}
    return;
  }

  if (event.data.type !== 'KALODATA_PRODUCTS_CAPTURED') {
    return;
  }

  latestProducts = event.data.payload || [];
  updateFloatingWidget(latestProducts);
});

let latestProducts = [];
const detailBuffer = {};
let detailTimer = null;
let lastExportJson = '';
const topVideosByProduct = {};
const videoPlayUrls = {};
let videoUrlRefreshTimer = null;
let lastVideoUrlError = '';

// Cadangan: link MP4 dari elemen <video> yang sedang diputar Kalodata (live.kalocdn.com/video/<id>.mp4?key=...)
function captureVideoElementUrl(el) {
  const src = el?.currentSrc || el?.src || '';
  const match = src.match(/kalocdn\.com\/video\/(\d+)\.mp4/i);
  if (match && src.includes('key=') && videoPlayUrls[match[1]] !== src) {
    videoPlayUrls[match[1]] = src;
    clearTimeout(videoUrlRefreshTimer);
    videoUrlRefreshTimer = setTimeout(() => latestProducts.length && updateFloatingWidget(latestProducts), 400);
  }
}
new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes' && m.target.tagName === 'VIDEO') captureVideoElementUrl(m.target);
    m.addedNodes?.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') captureVideoElementUrl(n);
      else n.querySelectorAll?.('video').forEach(captureVideoElementUrl);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

// Permintaan dari popup ekstensi (status & ekspor)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Perintah pencarian dari ekstensi (mode pencarian otomatis)
  if (msg?.type === 'etnicSearch') {
    window.postMessage({ type: 'ETNIC_SEARCH', payload: { id: msg.id, title: msg.title } }, '*');
    sendResponse({ ok: true });
    return;
  }
  if (msg?.action === 'getStatus') {
    const withVideos = latestProducts.filter((p) => (topVideosByProduct[String(p.id || p.productId)] || []).length).length;
    sendResponse({
      products: latestProducts.length,
      withVideos,
      videosLoaded: Object.keys(topVideosByProduct).length > 0,
      videos: Object.values(topVideosByProduct).reduce((n, list) => n + list.length, 0),
      playable: Object.keys(videoPlayUrls).length,
      lastError: lastVideoUrlError
    });
  } else if (msg?.action === 'getExportJson') {
    if (latestProducts.length) updateFloatingWidget(latestProducts);
    sendResponse({ json: lastExportJson });
  }
});

// Thumbnail video dari tabel Kalodata (elemen <img> / background yang memuat ID video)
function findVideoThumbnail(videoId) {
  const img = Array.from(document.querySelectorAll('img')).find((el) => (el.currentSrc || el.src || '').includes(videoId));
  if (img) return img.currentSrc || img.src;
  const bg = document.querySelector(`[style*="${videoId}"]`);
  const match = bg?.style?.backgroundImage?.match(/url\(["']?([^"']+)["']?\)/);
  return match ? match[1] : '';
}

function buildTopVideos(pid) {
  return (topVideosByProduct[pid] || []).map((video, index) => ({
    rank: index + 1,
    id: video.id,
    contentType: video.contentType,
    // Link ke video TikTok asli (TikTok mengarahkan ke akun pemiliknya)
    tiktokUrl: `https://www.tiktok.com/@/video/${video.id}`,
    // Link MP4 dari Kalodata untuk diputar di aplikasi (berlaku terbatas waktu)
    playUrl: videoPlayUrls[video.id] || '',
    playUrlFetchedAt: videoPlayUrls[video.id] ? new Date().toISOString() : null,
    // Thumbnail dari tabel, cadangan: CDN cover video Kalodata
    coverUrl: findVideoThumbnail(video.id) || `https://img.kalocdn.com/tiktok.video/${video.id}/cover.png`
  }));
}

// UI Tombol Melayang (Floating Widget)
const WIDGET_STYLE_ID = 'kalo-exporter-style';

function ensureWidgetStyle() {
  if (document.getElementById(WIDGET_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = WIDGET_STYLE_ID;
  style.textContent = `
    @keyframes kaloSpin { to { transform: rotate(360deg); } }
    #kalo-exporter-widget button { border: 1px solid transparent; padding: 8px 14px; border-radius: 8px; font: 600 12px "Segoe UI", -apple-system, sans-serif; cursor: pointer; transition: background 0.15s ease, opacity 0.15s ease; }
    #kalo-exporter-widget button:disabled { opacity: 0.4; cursor: not-allowed; }
    #kalo-exporter-widget .kalo-primary { background: #35b29f; color: #0b1f1b; }
    #kalo-exporter-widget .kalo-primary:hover:not(:disabled) { background: #2c9a89; }
    #kalo-exporter-widget .kalo-secondary { background: #202226; color: #eeece8; border-color: rgba(255,255,255,0.12); }
    #kalo-exporter-widget .kalo-secondary:hover:not(:disabled) { border-color: rgba(53,178,159,0.5); color: #6fcdbd; }
    #kalo-exporter-widget .kalo-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.12); border-top-color: #35b29f; animation: kaloSpin 0.8s linear infinite; flex-shrink: 0; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// Status persiapan video: berapa video GMV produk ini yang sudah punya link putar
function getVideoProgress(products) {
  const ids = products.flatMap((p) => (topVideosByProduct[String(p.id || p.productId)] || []).map((v) => v.id));
  const ready = ids.filter((id) => videoPlayUrls[id]).length;
  const videosLoaded = Object.keys(topVideosByProduct).length > 0;
  const loading = !videosLoaded || (ready < ids.length && !lastVideoUrlError);
  return { total: ids.length, ready, videosLoaded, loading };
}

function updateFloatingWidget(products) {
  ensureWidgetStyle();
  let widget = document.getElementById('kalo-exporter-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'kalo-exporter-widget';
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      width: 340px;
      background: #1a1b1e;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.45);
      padding: 14px 16px;
      color: #eeece8;
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    `;
    document.body.appendChild(widget);
  }

  const count = products.length;
  const progress = getVideoProgress(products);
  const percent = progress.total ? Math.round((progress.ready / progress.total) * 100) : 0;
  const logoUrl = chrome.runtime.getURL('icons/icon-32.png');

  let statusLine;
  if (!progress.videosLoaded) {
    statusLine = '<span class="kalo-spinner"></span><span style="color:#f0bb85;">Menunggu data video GMV...</span>';
  } else if (progress.loading) {
    statusLine = `<span class="kalo-spinner"></span><span style="color:#f0bb85;">Menyiapkan video ${progress.ready}/${progress.total}...</span>`;
  } else if (progress.ready < progress.total) {
    statusLine = `<span style="color:#f0bb85;">${progress.ready}/${progress.total} video siap · sisanya gagal, putar 1 video lalu F5</span>`;
  } else {
    statusLine = `<span style="color:#6fcdbd;">✓ ${progress.ready}/${progress.total} video siap diputar</span>`;
  }

  widget.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <img src="${logoUrl}" alt="" style="width: 28px; height: 28px; border-radius: 6px;">
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 13px; font-weight: 700;">${count} Produk Terdeteksi</div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; margin-top: 2px;">${statusLine}</div>
      </div>
    </div>
    <div style="height: 4px; border-radius: 4px; background: rgba(255,255,255,0.06); margin: 10px 0 12px; overflow: hidden;">
      <div style="height: 100%; width: ${progress.videosLoaded ? percent : 8}%; background: ${progress.loading ? '#e8a25c' : '#35b29f'}; transition: width 0.3s ease;"></div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="btnKaloCopyJson" class="kalo-primary" style="flex: 1;" ${progress.loading ? 'disabled' : ''}>Salin JSON</button>
      <button id="btnKaloDownloadJson" class="kalo-secondary" style="flex: 1;" ${progress.loading ? 'disabled' : ''}>Unduh File</button>
    </div>
  `;

  // Pemetaan URL gambar Kalocdn & background-image DOM
  const enrichedProducts = products.map((item) => {
    const pid = String(item.id || item.productId || '').trim();
    let imgUrl = item.coverUrl || item.product_img || item.image || '';

    // Cek elemen DOM Kalodata (.Component-Image) dengan style background-image
    if (!imgUrl && pid) {
      const bgDiv = document.querySelector(`.Component-Image[style*="${pid}"]`) || 
                    document.querySelector(`[style*="tiktok.product/${pid}"]`) ||
                    document.querySelector(`tr:has(a[href*="${pid}"]) .Component-Image`) ||
                    document.querySelector(`div:has(a[href*="${pid}"]) .Component-Image`);
      if (bgDiv && bgDiv.style && bgDiv.style.backgroundImage) {
        const match = bgDiv.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          imgUrl = match[1];
        }
      }
    }

    // Default ke CDN resmi Kalodata Cover jika belum ditemukan
    if (!imgUrl && pid && pid.length >= 10) {
      imgUrl = `https://img.kalocdn.com/tiktok.product/${pid}/cover.png`;
    }

    return {
      ...item,
      coverUrl: imgUrl,
      product_img: imgUrl,
      // 3 video GMV tertinggi (referensi konten)
      topVideos: buildTopVideos(pid)
    };
  });

  const jsonData = JSON.stringify({ success: true, data: enrichedProducts }, null, 2);
  lastExportJson = jsonData;

  // Simpan juga ke penyimpanan ekstensi → tampil di web Etnic Showcase (hanya di browser ini)
  try {
    chrome.runtime.sendMessage({
      action: 'saveKalodataProducts',
      products: enrichedProducts.map((p) => ({ ...p, id: String(p.id || p.productId || '').trim() })).filter((p) => p.id)
    }, () => void chrome.runtime.lastError);
  } catch (e) {}

  // Aksi tombol Salin
  const btnCopy = document.getElementById('btnKaloCopyJson');
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(jsonData).then(() => {
      btnCopy.innerText = 'Tersalin ✓';
      setTimeout(() => { btnCopy.innerText = 'Salin JSON'; }, 2000);
    }).catch(() => {
      prompt('Salin manual JSON:', jsonData);
    });
  };

  // Aksi tombol Unduh File kalodata_products.json
  const btnDownload = document.getElementById('btnKaloDownloadJson');
  btnDownload.onclick = () => {
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kalodata_products.json';
    a.click();
    URL.revokeObjectURL(url);
  };
}