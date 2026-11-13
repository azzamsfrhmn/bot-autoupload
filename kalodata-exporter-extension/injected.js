(function () {
  function getImagesMapFromDOM() {
    const map = new Map();
    const rows = document.querySelectorAll('tr, [role="row"], .ant-table-row');
    rows.forEach((row) => {
      const img = row.querySelector('img');
      const imgSrc = img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
      if (!imgSrc || imgSrc.includes('avatar') || imgSrc.includes('logo') || imgSrc.startsWith('data:image/svg')) return;

      const link = row.querySelector('a[href*="/product/"], a[href*="id="]') || row.closest('a');
      const href = link ? link.href : '';
      const text = row.innerText || '';
      const match = href.match(/(\d{15,22})/) || text.match(/(\d{15,22})/);

      if (match) {
        map.set(match[1], imgSrc);
      }
    });
    return map;
  }

  // ===================== Link putar video (getVideoUrl) =====================
  // Sama seperti saat pengguna mengklik video di Kalodata: minta link MP4 lewat sesi yang sedang login.
  // Alamat endpoint dipelajari dari panggilan Kalodata sendiri lalu disimpan; sebelum itu dicoba beberapa alamat umum.
  const VIDEO_URL_PATH_KEY = 'kaloExporterVideoUrlPath';
  const VIDEO_URL_CANDIDATES = ['/video/getVideoUrl', '/api/video/getVideoUrl', '/product/getVideoUrl', '/creator/getVideoUrl'];
  const VIDEO_URL_HEADERS_KEY = 'kaloExporterVideoUrlHeaders';
  let lastApiHeaders = {};
  const resolvedVideoUrls = new Set();
  const knownVideoIds = new Set();
  const videoUrlQueue = [];
  let videoUrlWorking = false;

  function rememberVideoUrlRequest(url, headers) {
    try {
      const path = new URL(url, location.href).pathname;
      if (!/getVideoUrl$/i.test(path)) return;
      const isNew = localStorage.getItem(VIDEO_URL_PATH_KEY) !== path;
      localStorage.setItem(VIDEO_URL_PATH_KEY, path);
      if (headers && Object.keys(headers).length) localStorage.setItem(VIDEO_URL_HEADERS_KEY, JSON.stringify(headers));
      // Alamat asli baru diketahui → ulangi permintaan untuk video yang belum dapat link
      if (isNew || headers) {
        knownVideoIds.forEach((id) => { if (!resolvedVideoUrls.has(id)) videoUrlQueue.push(id); });
        setTimeout(processVideoUrlQueue, 500);
      }
    } catch (e) {}
  }

  function reportVideoUrlError(detail) {
    window.postMessage({ type: 'KALODATA_VIDEO_URL_ERROR', payload: detail }, '*');
  }

  function postVideoUrl(videoId, playUrl) {
    if (!videoId || !playUrl) return;
    resolvedVideoUrls.add(videoId);
    window.postMessage({ type: 'KALODATA_VIDEO_URL', payload: { id: videoId, url: playUrl } }, '*');
  }

  async function requestVideoUrl(videoId) {
    const saved = localStorage.getItem(VIDEO_URL_PATH_KEY);
    const paths = saved ? [saved] : VIDEO_URL_CANDIDATES;
    let savedHeaders = null;
    try { savedHeaders = JSON.parse(localStorage.getItem(VIDEO_URL_HEADERS_KEY) || 'null'); } catch (e) {}
    const headers = savedHeaders || lastApiHeaders;
    let lastError = '';
    for (const path of paths) {
      try {
        const res = await originalFetch(`${path}?videoId=${encodeURIComponent(videoId)}`, { credentials: 'include', headers });
        if (!res.ok) { lastError = `${path} → HTTP ${res.status}`; continue; }
        const json = await res.json();
        if (json?.success && json.data?.url) {
          if (!saved) localStorage.setItem(VIDEO_URL_PATH_KEY, path);
          return json.data.url;
        }
        lastError = `${path} → ${json?.message || json?.code || 'tanpa link'}`;
      } catch (e) {
        lastError = `${path} → ${e.message}`;
      }
    }
    reportVideoUrlError({ videoId, error: lastError, learned: Boolean(saved) });
    return '';
  }

  async function processVideoUrlQueue() {
    if (videoUrlWorking) return;
    videoUrlWorking = true;
    while (videoUrlQueue.length) {
      const videoId = videoUrlQueue.shift();
      if (resolvedVideoUrls.has(videoId)) continue;
      const playUrl = await requestVideoUrl(videoId);
      postVideoUrl(videoId, playUrl);
      // Jeda antar permintaan agar tidak membebani server Kalodata
      await new Promise((r) => setTimeout(r, 350));
    }
    videoUrlWorking = false;
  }

  // Kalodata sendiri memanggil getVideoUrl saat video diklik → simpan alamat & hasilnya
  function processVideoUrlResponse(url, rawText, requestHeaders) {
    if (typeof url !== 'string' || !/getVideoUrl/i.test(url)) return;
    rememberVideoUrlRequest(url, requestHeaders);
    try {
      const videoId = new URL(url, location.href).searchParams.get('videoId');
      const playUrl = JSON.parse(rawText)?.data?.url;
      postVideoUrl(videoId, playUrl);
    } catch (e) {}
  }

  // /product/enrich → 3 video GMV tertinggi per produk: { "<pid>": ["<videoId>", ...] }
  function processEnrichResponse(url, rawText) {
    if (typeof url !== 'string' || !url.includes('/product/enrich')) return;
    try {
      const parsed = JSON.parse(rawText);
      const videosByProduct = {};
      (parsed.data || []).forEach((row) => {
        if (!row || !row.id) return;
        videosByProduct[String(row.id)] = (row.videos || [])
          .filter((v) => v && v.id)
          .map((v) => ({ id: String(v.id), contentType: v.contentType || '' }));
      });
      window.postMessage({ type: 'KALODATA_VIDEOS_CAPTURED', payload: videosByProduct }, '*');
      Object.values(videosByProduct).forEach((list) => list.forEach((v) => { knownVideoIds.add(v.id); videoUrlQueue.push(v.id); }));
      processVideoUrlQueue();
    } catch (e) {}
  }

  // Perekam struktur API Kalodata (untuk pengembang): alamat, metode, body permintaan & NAMA kolom jawaban saja
  function shapeOf(v, depth = 0) {
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : [];
    if (v && typeof v === 'object') {
      if (depth > 3) return '{…}';
      const o = {};
      Object.keys(v).slice(0, 40).forEach((k) => { o[k] = shapeOf(v[k], depth + 1); });
      return o;
    }
    return typeof v;
  }
  function recordApi(url, rawText, method, requestBody) {
    try {
      const u = new URL(url, location.href);
      if (!/kalodata\.com$/.test(u.hostname)) return;
      if (/\.(js|css|png|jpe?g|svg|woff2?)$/i.test(u.pathname)) return;
      ['token', 'key', 'sign', 'signature', 'auth'].forEach((k) => u.searchParams.delete(k));
      let shape = null;
      try { shape = shapeOf(JSON.parse(rawText)); } catch (e) {}
      if (!shape) return;
      window.postMessage({ type: 'KALODATA_API_LOG', payload: { method, path: u.pathname, query: u.search.slice(0, 300), body: (requestBody || '').slice(0, 800), shape, page: location.pathname } }, '*');
    } catch (e) {}
  }

  // ---------------- Mode pencarian (tab daftar produk dibuka ekstensi: /product?etnic_search=1) ----------------
  // Memakai permintaan pencarian halaman daftar produk itu sendiri (tanpa membuka halaman detail → tidak memakai
  // jatah kunjungan detail). Halaman daftar produk sendiri tidak disimpan ke katalog dalam mode ini.
  let SEARCH_MODE = /[?&]etnic_search=1/.test(location.search);
  try {
    if (SEARCH_MODE) sessionStorage.setItem('etnic_search', '1');
    else SEARCH_MODE = sessionStorage.getItem('etnic_search') === '1';
  } catch (e) {}
  let lastSearchReq = null;
  let lastEnrichReq = null;
  let searchReadySent = false;
  function rememberReq(url, method, body, headers) {
    if (typeof url !== 'string') return;
    const req = { url, method: (method || 'POST').toUpperCase(), body, headers: headers || {} };
    let path = '';
    try { path = new URL(url, location.href).pathname; } catch (e) {}
    if (/searchList|\/product\/(query|search)(List)?$/i.test(path)) {
      window.postMessage({ type: 'KALODATA_SEARCH_SEEN', payload: { path, method: req.method, hasBody: Boolean(body), mode: SEARCH_MODE } }, '*');
    }
    if (/searchList|\/product\/queryList$/i.test(path) && (body || req.method === 'GET')) {
      lastSearchReq = req;
      if (SEARCH_MODE && !searchReadySent) {
        searchReadySent = true;
        setTimeout(() => window.postMessage({ type: 'KALODATA_SEARCH_READY', payload: {} }, '*'), 2500);
      }
    }
    if (url.includes('/product/enrich')) lastEnrichReq = req;
  }
  // Nama kolom kata kunci pencarian Kalodata belum pasti → dicoba bergantian; yang berhasil diingat
  const KW_FIELDS = ['keyword', 'keywords', 'searchKey', 'search_key', 'searchWord', 'productName', 'product_name', 'title', 'name', 'query', 'search'];
  let kwField = null;
  try { kwField = localStorage.getItem('etnicKwField'); } catch (e) {}
  let defaultIds = '';
  function withKeyword(bodyStr, kw, field) {
    let b;
    try { b = JSON.parse(bodyStr); } catch (e) { return null; }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    KW_FIELDS.forEach((f) => { if (f !== field) delete b[f]; });
    const k = field || Object.keys(b).find((x) => /^(keyword|keywords|key_?word|search_?key|searchWord|search|query|q)$/i.test(x)) || 'keyword';
    b[k] = kw;
    ['pageNo', 'page', 'pageNum', 'current'].forEach((pk) => { if (pk in b) b[pk] = 1; });
    if ('pageSize' in b) b.pageSize = 20;
    return JSON.stringify(b);
  }
  function replaceIds(bodyStr, ids) {
    let b;
    try { b = JSON.parse(bodyStr); } catch (e) { return null; }
    const walk = (o) => {
      Object.keys(o).forEach((k) => {
        const v = o[k];
        if (Array.isArray(v) && v.length && v.every((x) => /^\d{12,22}$/.test(String(x)))) o[k] = ids;
        else if (v && typeof v === 'object') walk(v);
      });
    };
    if (Array.isArray(b) && b.every((x) => /^\d{12,22}$/.test(String(x)))) return JSON.stringify(ids);
    if (b && typeof b === 'object') walk(b);
    return JSON.stringify(b);
  }
  function withKeywordUrl(url, kw) {
    const u = new URL(url, location.href);
    const k = [...u.searchParams.keys()].find((x) => /^(keyword|keywords|key_?word|search_?key|searchWord|search|query|q)$/i.test(x)) || 'keyword';
    u.searchParams.set(k, kw);
    ['pageNo', 'page', 'pageNum', 'current'].forEach((pk) => { if (u.searchParams.has(pk)) u.searchParams.set(pk, '1'); });
    return u.toString();
  }
  async function replay(req, body) {
    if (req.method === 'GET') {
      const r = await originalFetch(body, { method: 'GET', credentials: 'include', headers: req.headers || {} });
      return r.text();
    }
    const headers = { ...(req.headers || {}) };
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    const r = await originalFetch(req.url, { method: req.method || 'POST', credentials: 'include', headers, body });
    return r.text();
  }
  // Pencarian lewat KOTAK PENCARIAN halaman Produk (sama seperti mengetik manual) → tunggu jawaban daftar produk
  let pendingSearch = null;
  function onSearchListResponse(url, rawText) {
    if (!pendingSearch || typeof url !== 'string' || !/\/product\/queryList|searchList/.test(url)) return;
    try {
      const j = JSON.parse(rawText);
      const items = Array.isArray(j.data) ? j.data : (j.data?.data || j.data?.list || []);
      const ids = items.slice(0, 5).map((it) => String(it.id || it.productId)).join(',');
      if (ids === pendingSearch.beforeIds) return; // masih daftar lama
      const done = pendingSearch.resolve;
      pendingSearch = null;
      done({ items, success: j.success !== false, message: j.message || '' });
    } catch (e) {}
  }
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  function findSearchBox() {
    return Array.from(document.querySelectorAll('input')).find((el) => el.offsetParent !== null
      && /search product|cari nama produk|nama produk|product name/i.test(el.placeholder || ''));
  }
  async function uiSearch(kw) {
    const box = findSearchBox();
    if (!box) throw new Error('Kotak pencarian halaman Produk Kalodata tidak ditemukan.');
    const result = new Promise((resolve) => {
      pendingSearch = { resolve, beforeIds: defaultIds };
      setTimeout(() => { if (pendingSearch && pendingSearch.resolve === resolve) { pendingSearch = null; resolve({ timeout: true, items: [] }); } }, 20000);
    });
    box.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(box, kw);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await sleepMs(400);
    ['keydown', 'keypress', 'keyup'].forEach((t) => box.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
    // Cadangan: klik ikon kaca pembesar di sebelah kotak pencarian
    await sleepMs(600);
    if (pendingSearch) {
      const wrap = box.closest('div[class*="search"], form, div') || box.parentElement;
      const btn = wrap && Array.from(wrap.parentElement ? wrap.parentElement.querySelectorAll('button, [role="button"], svg, span') : []).reverse()
        .find((el) => el !== box && el.offsetParent !== null && /search|cari/i.test((el.getAttribute('aria-label') || el.className?.baseVal || el.className || '') + ''));
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    const r = await result;
    defaultIds = (r.items || []).slice(0, 5).map((it) => String(it.id || it.productId)).join(',');
    return r;
  }
  // Nilai yang disensor Kalodata (mis. "Rp****") tidak disimpan
  function stripMasked(o) {
    const out = {};
    Object.keys(o || {}).forEach((k) => { const v = o[k]; if (!(typeof v === 'string' && v.includes('**'))) out[k] = v; });
    return out;
  }
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'ETNIC_SEARCH') return;
    const { id, title } = e.data.payload || {};
    let found = false;
    let error = '';
    try {
      const clean = String(title || '').replace(/[\[\]【】|#]/g, ' ').replace(/\s+/g, ' ').trim();
      const words = clean.split(' ');
      const tries = [...new Set([words.slice(0, 8).join(' '), words.slice(0, 4).join(' ')])].filter((x) => x.length >= 3);
      for (const kw of tries) {
        const r = await uiSearch(kw);
        if (r.timeout) { error = 'Kalodata tidak menampilkan hasil pencarian (jatah pencarian habis?)'; break; }
        // Hanya BARIS PERTAMA (yang memang ditampilkan Kalodata ke akun ini); baris yang diburamkan tidak diambil
        const first = (r.items || [])[0];
        if (first && String(first.id || first.productId) === String(id)) {
          found = true;
          const hit = stripMasked(first);
          window.postMessage({ type: 'KALODATA_PRODUCTS_CAPTURED', payload: [{ ...hit, coverUrl: hit.coverUrl || hit.product_img || hit.image || `https://img.kalocdn.com/tiktok.product/${id}/cover.png` }] }, '*');
          break;
        }
        await sleepMs(1500);
      }
    } catch (err) { error = err.message || String(err); }
    // Beri waktu video GMV baris itu dimuat halaman (enrich) & link putarnya diminta
    setTimeout(() => window.postMessage({ type: 'ETNIC_SEARCH_DONE', payload: { id, found, error } }, '*'), found ? 6000 : 300);
  });

  // ---------------- Mode otomatis (tab dibuka ekstensi: ?etnic_auto=1) ----------------
  // Halaman detail sudah dibuka (kunjungan dihitung Kalodata seperti biasa) → ambil bagian tren harian & daftar video
  // halaman yang sama memakai sesi & header halaman itu sendiri.
  const AUTO_MODE = /[?&]etnic_auto=1/.test(location.search);
  let lastDetailHeaders = null;
  let autoStarted = false;
  const isoDay = (d) => d.toISOString().slice(0, 10);
  async function autoFetchExtras(id, endDate) {
    if (autoStarted) return;
    autoStarted = true;
    const end = endDate || isoDay(new Date(Date.now() - 86400000));
    const start30 = isoDay(new Date(new Date(`${end}T00:00:00Z`).getTime() - 29 * 86400000));
    const start7 = isoDay(new Date(new Date(`${end}T00:00:00Z`).getTime() - 6 * 86400000));
    const headers = { ...(lastDetailHeaders || {}), 'content-type': 'application/json' };
    const call = async (path, body) => {
      try {
        const r = await originalFetch(path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
        const t = await r.text();
        processDetailResponse(path, t, JSON.stringify(body));
      } catch (e) {}
    };
    await call('/product/detail/history', { id, startDate: start30, endDate: end, authority: true });
    await call('/product/detail/video/queryList', { id, startDate: start7, endDate: end, authority: true, pageNo: 1, pageSize: 10, sort: [{ field: 'revenue', type: 'DESC' }] });
    // Beri waktu link putar video diminta & data tersimpan
    setTimeout(() => window.postMessage({ type: 'KALODATA_AUTO_DONE', payload: { id } }, '*'), 6000);
  }

  // Halaman Product Detail: /product/detail (info produk), /product/detail/total (metrik), /product/detail/getImages
  function processDetailResponse(url, rawText, requestBody) {
    let path = '';
    try { path = new URL(url, location.href).pathname; } catch (e) { return; }
    if (!/^\/product\/detail(\/total|\/getImages|\/history|\/video\/.+)?$/.test(path)) return;
    let json = null;
    try { json = JSON.parse(rawText); } catch (e) { return; }
    if (AUTO_MODE && path === '/product/detail' && json && json.success === false) {
      window.postMessage({ type: 'KALODATA_AUTO_DONE', payload: { id: new URLSearchParams(location.search).get('id'), error: json.message || 'Kalodata menolak membuka detail produk (jatah kunjungan habis?)' } }, '*');
      return;
    }
    if (!json || !json.success || json.data == null) return;
    let req = {};
    try { req = requestBody ? JSON.parse(requestBody) : {}; } catch (e) {}
    const qid = (() => { try { return new URL(url, location.href).searchParams.get('productId') || new URL(url, location.href).searchParams.get('id'); } catch (e) { return ''; } })();
    const id = String(req.id || qid || (json.data && json.data.id) || new URLSearchParams(location.search).get('id') || '');
    if (!id) return;
    let kind = path.endsWith('/total') ? 'total' : path.endsWith('/getImages') ? 'images' : path.endsWith('/history') ? 'history' : 'info';
    if (/\/video\//.test(path)) {
      // Daftar video (abaikan endpoint jumlah / angka saja)
      if (!Array.isArray(json.data) && !Array.isArray(json.data?.list)) return;
      const list = (Array.isArray(json.data) ? json.data : json.data.list).filter((v) => v && (v.id || v.video_id));
      if (!list.length) return;
      kind = 'videos';
      json.data = list.slice(0, 10).map((v) => ({ id: String(v.id || v.video_id), revenue: v.revenue, views: v.views || v.play_count, handle: v.handle || v.creator_handle, nickname: v.nickname || v.creator_nickname, publish: v.create_time || v.publish_time }));
      // Minta link putar otomatis (seperti di daftar produk)
      json.data.slice(0, 3).forEach((v) => { if (!knownVideoIds.has(v.id)) { knownVideoIds.add(v.id); videoUrlQueue.push(v.id); } });
      setTimeout(processVideoUrlQueue, 300);
    }
    window.postMessage({ type: 'KALODATA_DETAIL_CAPTURED', payload: { id, kind, data: json.data, startDate: req.startDate || '', endDate: req.endDate || '' } }, '*');
    if (AUTO_MODE && kind === 'total') setTimeout(() => autoFetchExtras(id, req.endDate), 1500);
  }

  // Sisa jatah kunjungan halaman detail (DETAIL.ACCESS_TIMES)
  function processQuotaResponse(url, rawText) {
    if (typeof url !== 'string' || !url.includes('/user/features')) return;
    try {
      const j = JSON.parse(rawText);
      const f = j && j.data && j.data['DETAIL.ACCESS_TIMES'];
      const pr = f && f.progress;
      if (pr && typeof pr.remain === 'number') window.postMessage({ type: 'KALODATA_QUOTA', payload: { remain: pr.remain, total: pr.total, used: pr.used } }, '*');
    } catch (e) {}
  }

  function processKalodataResponse(url, rawText, method, requestBody, requestHeaders) {
    recordApi(url, rawText, method, requestBody);
    rememberReq(url, method, requestBody, requestHeaders);
    if (SEARCH_MODE) onSearchListResponse(url, rawText);
    try {
      if (SEARCH_MODE && typeof url === 'string' && /\/product\/queryList|searchList/.test(url) && !defaultIds) {
        const j = JSON.parse(rawText);
        const items = Array.isArray(j.data) ? j.data : (j.data?.data || j.data?.list || []);
        defaultIds = items.slice(0, 5).map((it) => String(it.id || it.productId)).join(',');
      }
    } catch (e) {}
    try { if (typeof url === 'string' && /\/product\/detail/.test(url) && requestHeaders && Object.keys(requestHeaders).length) lastDetailHeaders = requestHeaders; } catch (e) {}
    processDetailResponse(url, rawText, requestBody);
    processQuotaResponse(url, rawText);
    processVideoUrlResponse(url, rawText, requestHeaders);
    processEnrichResponse(url, rawText);
    if (typeof url === 'string' && /searchList|\/product\/queryList(\?|$)/.test(url) && !SEARCH_MODE) {
      try {
        const parsed = JSON.parse(rawText);
        const items = Array.isArray(parsed.data) 
          ? parsed.data 
          : (parsed.data?.data || parsed.data?.list || []);

        if (items && items.length > 0) {
          // Beri jeda 400ms agar tabel DOM selesai merender gambar asli
          setTimeout(() => {
            const domImages = getImagesMapFromDOM();
            const enrichedItems = items.map((item) => {
              const pid = String(item.id || item.productId || '');
              const matchedImg = domImages.get(pid) || item.coverUrl || item.product_img || item.image || '';
              return {
                ...item,
                coverUrl: matchedImg,
                product_img: matchedImg
              };
            });

            window.postMessage({
              type: 'KALODATA_PRODUCTS_CAPTURED',
              payload: enrichedItems
            }, '*');
          }, 400);
        }
      } catch (e) {}
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      const url = args[0]?.url || args[0] || '';
      // Header yang dipakai Kalodata untuk API-nya (dipakai ulang saat meminta link video)
      if (typeof url === 'string' && url.includes('/product/enrich') && args[1]?.headers) {
        try { lastApiHeaders = Object.fromEntries(new Headers(args[1].headers).entries()); } catch (e) {}
      }
      const method = args[1]?.method || args[0]?.method || 'GET';
      const body = typeof args[1]?.body === 'string' ? args[1].body : null;
      let reqHeaders = null;
      try { if (args[1]?.headers) reqHeaders = Object.fromEntries(new Headers(args[1].headers).entries()); } catch (e) {}
      clone.text().then((text) => processKalodataResponse(url, text, method, body, reqHeaders));
    } catch (e) {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._reqUrl = url;
    this._reqMethod = method;
    this._reqHeaders = {};
    return originalOpen.apply(this, arguments);
  };

  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._reqHeaders) this._reqHeaders[name] = value;
    return originalSetHeader.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const requestBody = typeof body === 'string' ? body : null;
    this.addEventListener('load', function () {
      if (typeof this._reqUrl === 'string' && this._reqUrl.includes('/product/enrich') && this._reqHeaders) {
        lastApiHeaders = { ...this._reqHeaders };
      }
      let text = '';
      try { text = this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response); } catch (e) {}
      processKalodataResponse(this._reqUrl, text, this._reqMethod, requestBody, this._reqHeaders);
    });
    return originalSend.apply(this, arguments);
  };
})();