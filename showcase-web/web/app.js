/* Etnic Showcase — web (sama seperti menu Showcase Produk di aplikasi Bot Auto Upload).
   Data Kalodata & etalase hanya disimpan di ekstensi (browser pengguna). */
(() => {
  const API_URL = 'api.php';
  const EXT_DOWNLOAD = 'kalodata-exporter-v2.zip';
  const LS_KEY = 'etnicShowcaseLicense';
  const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const PAGE_SIZE = 60;
  const MIN_EXT_VERSION = '2.8.0'; // 2.2.0: perekam API Kalodata (opsional)
  const verLt = (a, b) => { const pa = String(a || '0').split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); } return false; };

  const $ = (id) => document.getElementById(id);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  // ------------------------------------------------------------ jembatan ekstensi
  let extReady = false;
  let extVersion = '';
  let reqSeq = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== 'etnic-showcase-ext') return;
    if (m.type === 'ready') { extReady = true; extVersion = m.version || extVersion; return; }
    if (m.type === 'progress') { toast(m.text); return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  function ext(action, payload = {}, timeoutMs = 30 * 60 * 1000) {
    return new Promise((resolve) => {
      const id = `r${++reqSeq}`;
      pending.set(id, resolve);
      window.postMessage({ source: 'etnic-showcase-web', id, action, payload }, location.origin);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ success: false, error: 'Ekstensi tidak merespons.' }); } }, timeoutMs);
    });
  }
  async function detectExtension() {
    for (let i = 0; i < 15 && !extReady; i++) {
      const r = await ext('ping', {}, 300);
      if (r?.success) { extReady = true; extVersion = r.version || extVersion; }
    }
    return extReady;
  }

  // ------------------------------------------------------------ util
  let toastTimer = null;
  function toast(text, isErr = false, ms = 4500) {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast${isErr ? ' err' : ''}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  // "Rp59,51RB" → 59510 · "Rp1,48M" → 1480000000 · "12.345" → 12345
  // Angka Kalodata: format Indonesia "Rp59,51RB" / "Rp1,48M" (M = miliar) dan Inggris "Rp26.14k" / "Rp9.92m" (m = juta)
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/rp|idr|\s/gi, '');
    const sm = s.match(/(rb|jt|k|m|b)$/i);
    const suf = sm ? sm[1] : '';
    s = suf ? s.slice(0, -suf.length) : s;
    if (suf) {
      // "26.14" (desimal titik) atau "59,51" (desimal koma); "1.234,5" → ribuan titik + desimal koma
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    }
    const n = parseFloat(s) || 0;
    // "m" kecil = million (Kalodata Inggris), "M" besar = miliar (Kalodata Indonesia)
    const mult = suf === 'm' ? 1e6 : suf === 'M' ? 1e9 : ({ rb: 1e3, k: 1e3, jt: 1e6, b: 1e9 })[suf.toLowerCase()] || 1;
    return n * mult;
  }
  const rp = (n) => (n ? `Rp${Math.round(n).toLocaleString('id-ID')}` : '-');
  const coverOf = (pid, img) => img || `https://img.kalocdn.com/tiktok.product/${pid}/cover.png`;
  const imgFallback = (pid) => `onerror="if(!this.dataset.b){this.dataset.b=1;this.src='https://img.kalocdn.com/tiktok.product/${pid}/cover.png'}else{this.onerror=null;this.style.visibility='hidden'}"`;
  const tiktokProductUrl = (pid) => `https://www.tiktok.com/view/product/${pid}`;

  // Normalisasi produk Kalodata (nama kolom bisa berbeda-beda)
  function norm(p) {
    const price = num(p.unit_price ?? p.itemPrice ?? p.price ?? p.min_real_price ?? p.avg_price);
    let rate = p.commission_rate ?? p.commissionRate ?? p.commission;
    if (typeof rate === 'string') rate = rate.replace(/^komisi\s*/i, '');
    rate = typeof rate === 'string' && rate.includes('%') ? parseFloat(rate) : (Number(rate) <= 1 ? Number(rate) * 100 : Number(rate));
    rate = Number.isFinite(rate) ? rate : 0;
    return {
      raw: p,
      id: String(p.id || p.productId),
      title: p.product_title || p.title || p.name || `Produk ${p.id}`,
      shop: p.shop_name || p.seller_name || p.shopName || '',
      image: p.coverUrl || p.product_img || p.image || '',
      priceText: p.unit_price || p.itemPrice || p.price || (price ? rp(price) : '-'),
      price,
      rate,
      commRp: price && rate ? (price * rate) / 100 : num(p.commission_amount),
      sale: num(p.sale ?? p.sales ?? p.sold_count),
      revenue: num(p.revenue ?? p.gmv),
      videos: (p.topVideos || []).filter((v) => v && v.id).slice(0, 3),
      capturedAt: p.capturedAt || 0
    };
  }

  // ------------------------------------------------------------ state
  let mode = 'showcase';
  let products = [];
  let showcaseItems = [];
  let showcaseIds = new Set();
  const selected = new Set();
  let page = 1;
  let tiktokAccount = null;

  // ------------------------------------------------------------ gate: ekstensi → lisensi → login TikTok
  function gate(html) { $('gateBody').innerHTML = html; $('gate').hidden = false; $('app').hidden = true; }

  function showInstall() {
    gate(`
      <h2>Pasang ekstensi Kalodata Exporter v2</h2>
      <p>Web ini bekerja bersama ekstensi Chrome untuk mengambil produk dari akun Kalodata Anda dan mengelola etalase TikTok Shop.</p>
      <ol>
        <li>Unduh & ekstrak <a href="${EXT_DOWNLOAD}">ekstensi Kalodata Exporter v2</a>.</li>
        <li>Buka <b>chrome://extensions</b> → aktifkan <b>Developer mode</b>.</li>
        <li>Klik <b>Load unpacked</b> → pilih folder hasil ekstrak.</li>
        <li>Muat ulang halaman ini.</li>
      </ol>
      <button class="btn primary block" onclick="location.reload()">Saya sudah memasang ekstensi</button>`);
  }

  // Info perangkat untuk admin (OS · browser), tanpa data pribadi
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Perangkat';
    const b = ua.match(/Edg\/(\d+)/) ? `Edge ${ua.match(/Edg\/(\d+)/)[1]}` : ua.match(/OPR\/(\d+)/) ? `Opera ${ua.match(/OPR\/(\d+)/)[1]}` : ua.match(/Chrome\/(\d+)/) ? `Chrome ${ua.match(/Chrome\/(\d+)/)[1]}` : 'Browser';
    return `${os} · ${b}`;
  }

  async function checkLicense(key, action) {
    const { installId } = await ext('getInstallId', {}, 8000);
    if (!installId) return { valid: false, message: 'Ekstensi tidak merespons. Buka chrome://extensions lalu klik Reload pada Kalodata Product Exporter, kemudian muat ulang halaman ini.' };
    if (DEV && key === 'DEV-TEST-KEY') return { valid: true, buyer: 'Mode pengembangan' };
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, license_key: key, install_id: installId, device: deviceName(), ext_version: extVersion, tiktok: tiktokAccount?.username || '' })
    }).then((r) => r.json()).catch(() => ({ valid: false, message: 'Tidak bisa menghubungi server lisensi.' }));
  }

  function showLogin(err = '') {
    gate(`
      <h2>Masukkan kode lisensi</h2>
      <p>Lisensi sekali bayar untuk 1 browser. Belum punya? Hubungi admin Etnic Store.</p>
      <input id="licInput" placeholder="ESHW-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
      <div class="gate-err" id="licErr">${esc(err)}</div>
      <button class="btn primary block" id="licBtn">Aktifkan</button>`);
    const go = async () => {
      const key = $('licInput').value.trim().toUpperCase();
      if (!key) return;
      $('licBtn').disabled = true; $('licBtn').textContent = 'Memeriksa...';
      const r = await checkLicense(key, 'activate');
      if (r.valid) { try { localStorage.setItem(LS_KEY, key); } catch (e) {} startApp(); }
      else { $('licErr').textContent = r.message || 'Lisensi tidak valid.'; $('licBtn').disabled = false; $('licBtn').textContent = 'Aktifkan'; }
    };
    $('licBtn').onclick = go;
    $('licInput').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('licInput').focus();
  }

  async function startApp() {
    gate('<div class="muted">Memeriksa akun TikTok Shop...</div>');
    const r = await ext('getTikTokAccount', { viaTab: true }, 30000);
    if (!r?.loggedIn) return showTikTokLogin();
    tiktokAccount = r.account;
    openDashboard();
  }

  function showTikTokLogin(note = '') {
    gate(`
      <h2>Hubungkan akun TikTok Shop</h2>
      <p>Login ke TikTok Shop (LIVE Manager / Streamer) dengan akun TikTok yang etalasenya ingin Anda kelola.</p>
      <ol>
        <li>Klik <b>Login TikTok Shop</b> — tab TikTok Shop akan terbuka.</li>
        <li>Login dengan akun TikTok Anda sampai halaman <b>Showcase Products</b> tampil.</li>
        <li>Kembali ke tab ini — dashboard terbuka otomatis.</li>
      </ol>
      <div class="gate-err" id="ttNote">${esc(note)}</div>
      <button class="btn primary block" id="ttLogin">Login TikTok Shop</button>
      <button class="btn ghost block" id="ttCheck">Saya sudah login, periksa lagi</button>`);
    let polling = null;
    const check = async (manual) => {
      const r = await ext('getTikTokAccount', { viaTab: true }, 30000);
      if (r?.loggedIn) { clearInterval(polling); tiktokAccount = r.account; openDashboard(); }
      else if (manual) $('ttNote').textContent = 'Belum terdeteksi login TikTok Shop. Pastikan halaman Showcase Products sudah tampil di tab TikTok Shop.';
    };
    $('ttLogin').onclick = async () => {
      await ext('openTikTokLogin');
      clearInterval(polling);
      polling = setInterval(() => check(false), 4000);
    };
    $('ttCheck').onclick = () => check(true);
  }

  async function boot() {
    if (!(await detectExtension())) return showInstall();
    if (verLt(extVersion, MIN_EXT_VERSION)) {
      return gate(`
        <h2>Perbarui ekstensi Kalodata Exporter</h2>
        <p>Ekstensi di browser ini versi <b>${esc(extVersion || 'lama')}</b>. Web showcase butuh versi <b>${MIN_EXT_VERSION}</b> atau lebih baru.</p>
        <ol>
          <li>Unduh <a href="${EXT_DOWNLOAD}">ekstensi terbaru</a> lalu ekstrak, timpa folder ekstensi yang lama.</li>
          <li>Buka <b>chrome://extensions</b> → klik <b>⟳ Reload</b> pada Kalodata Product Exporter.</li>
          <li>Muat ulang halaman ini.</li>
        </ol>
        <button class="btn primary block" onclick="location.reload()">Sudah diperbarui, muat ulang</button>`);
    }
    let key = '';
    try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
    if (!key) return showLogin();
    const r = await checkLicense(key, 'verify');
    if (!r.valid) { try { localStorage.removeItem(LS_KEY); } catch (e) {} return showLogin(r.message); }
    startApp();
  }

  // ------------------------------------------------------------ dashboard
  async function openDashboard() {
    $('gate').hidden = true;
    $('app').hidden = false;
    const name = tiktokAccount ? `@${tiktokAccount.username}` : '@-';
    $('tabAccountName').textContent = name;
    const chip = $('ttAccount');
    if (tiktokAccount) {
      chip.hidden = false;
      chip.innerHTML = `${tiktokAccount.avatar ? `<img src="${esc(tiktokAccount.avatar)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${esc(name)}</span>`;
      chip.title = 'Akun TikTok Shop terhubung — klik untuk ganti akun';
      chip.onclick = () => { if (confirm('Ganti akun TikTok Shop? Logout dulu di tab TikTok Shop, lalu login dengan akun lain.')) { ext('openTikTokLogin'); showTikTokLogin(); } };
    }
    // Heartbeat → status Online di admin selama web dibuka
    if (!window.__scHeartbeat) {
      const beat = () => { let k = ''; try { k = localStorage.getItem(LS_KEY) || ''; } catch (e) {} if (k) checkLicense(k, 'ping').then((r) => { if (r && r.valid === false && /ditangguhkan|tidak ditemukan|perangkat/.test(r.message || '')) location.reload(); }); };
      beat();
      window.__scHeartbeat = setInterval(beat, 60000);
    }
    await Promise.all([loadProducts(), loadShowcaseCache()]);
    setMode('showcase');
    updateAutoKaloButton();
    if (!showcaseItems.length) syncShowcase();
    else if (!autoKaloDoneOnce) { autoKaloDoneOnce = true; runAutoKalo(false); }
  }

  // Jumlah katalog = produk Kalodata yang belum ada di etalase
  function updateCatalogCount() { $('countCatalog').textContent = products.filter((p) => !showcaseIds.has(p.id)).length; }

  async function loadProducts() {
    const r = await ext('getProducts');
    products = (r?.products || []).map(norm);
    updateCatalogCount();
  }

  async function loadShowcaseCache() {
    const r = await ext('getShowcaseCache');
    showcaseItems = r?.items || [];
    showcaseIds = new Set(showcaseItems.map((x) => String(x.id)));
    updateCatalogCount();
    if (r?.at) $('showcaseInfo').textContent = `${showcaseItems.length} produk di etalase · disinkronkan ${new Date(r.at).toLocaleString('id-ID')}`;
  }

  // ------------------------------------------------------------ data Kalodata otomatis untuk produk etalase
  let autoKaloRunning = false;
  let autoKaloDoneOnce = false;
  const hasTrend = (p) => p && trendOf(p.raw).length > 1;
  function missingKaloIds() { return showcaseItems.map((x) => String(x.id)).filter((id) => !hasTrend(kaloOf(id))); }
  // Petunjuk akun Kalodata (bisa ditutup; muncul lagi bila pencarian terhenti)
  function showKaloTip(force = false) {
    let hidden = false;
    try { hidden = localStorage.getItem('kaloTipHidden') === '1'; } catch (e) {}
    if (force) { try { localStorage.removeItem('kaloTipHidden'); } catch (e) {} hidden = false; }
    $('kaloTip').hidden = hidden || mode !== 'showcase';
  }
  function updateAutoKaloButton() {
    const b = $('btnAutoKalo');
    if (!b) return;
    const n = missingKaloIds().length;
    b.hidden = !showcaseItems.length;
    b.disabled = autoKaloRunning || !n;
    b.textContent = autoKaloRunning ? 'Mengambil data Kalodata...' : n ? `⇣ Ambil data Kalodata (${n})` : '✓ Data Kalodata lengkap';
  }
  async function runAutoKalo(manual = false) {
    if (autoKaloRunning) return;
    const ids = missingKaloIds();
    if (!ids.length) { if (manual) toast('Semua produk etalase sudah punya data Kalodata.'); updateAutoKaloButton(); return; }
    autoKaloRunning = true;
    updateAutoKaloButton();
    toast(`Mencari ${ids.length} produk di halaman Produk Kalodata (latar belakang)...`, false, 12000);
    const items = showcaseItems.filter((x) => ids.includes(String(x.id))).map((x) => ({ id: String(x.id), title: x.title }));
    const r = await ext('autoFetchKalodata', { ids, items });
    autoKaloRunning = false;
    await loadProducts();
    render();
    updateAutoKaloButton();
    if (r?.running) return;
    if (r?.stopReason === 'login') toast('Belum login Kalodata. Login di kalodata.com lalu klik "Ambil data Kalodata".', true, 10000);
    else if (r?.stopReason === 'notready') toast(`${r.error || 'Halaman Product Kalodata tidak termuat.'} — pastikan sudah login Kalodata, lalu coba lagi.`, true, 15000);
    else if (r?.stopReason === 'error') toast(`Pencarian Kalodata gagal: ${(r.errors || [])[0] || 'tidak diketahui'}`, true, 10000);
    else if (r?.stopReason === 'quota') { toast(`✓ ${r.done} produk diperbarui. Kalodata berhenti menampilkan hasil pencarian — kemungkinan akun Kalodata ini masih trial (maks 10 pencarian/hari). Gunakan akun Kalodata yang masa trial-nya sudah selesai.`, true, 15000); showKaloTip(true); }
    else if (r?.total) toast(`✓ ${r.done}/${r.total} produk dapat grafik & video GMV dari Kalodata${r.notFound?.length ? ` · ${r.notFound.length} tidak muncul di baris pertama pencarian` : ''}`, false, 10000);
    else if (manual) toast('Produk yang belum punya data sudah dicoba dalam 24 jam terakhir. Coba lagi besok.', false, 8000);
  }

  async function syncShowcase() {
    $('btnSync').disabled = true;
    $('showcaseInfo').textContent = 'Menyinkronkan etalase dari TikTok Shop...';
    toast('Membaca etalase TikTok Shop...', false, 15000);
    const r = await ext('getShowcase');
    $('btnSync').disabled = false;
    if (!r?.success) {
      $('showcaseInfo').textContent = r?.error || 'Gagal membaca etalase.';
      toast(r?.needLogin ? 'Belum login TikTok Shop.' : (r?.error || 'Gagal membaca etalase.'), true);
      if (r?.needLogin) showTikTokLogin('Sesi TikTok Shop berakhir. Silakan login lagi.');
      return;
    }
    await loadShowcaseCache();
    $('showcaseInfo').textContent = `${showcaseItems.length} produk di etalase · disinkronkan ${new Date().toLocaleString('id-ID')}`;
    toast(`✓ Etalase tersinkron: ${showcaseItems.length} produk`);
    render();
    updateAutoKaloButton();
    if (!autoKaloDoneOnce) { autoKaloDoneOnce = true; runAutoKalo(false); }
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.mode-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
    $('jsonBar').hidden = m !== 'kalodata';
    $('filterBar').hidden = m !== 'kalodata';
    $('showcaseBar').hidden = m !== 'showcase';
    showKaloTip();
    $('headSub').textContent = m === 'kalodata'
      ? 'Katalog riset Kalodata dari akun Kalodata Anda. Klik kartu untuk detail, "Add Produk" untuk memasukkan ke etalase.'
      : 'Sinkronisasi etalase produk aktif dari toko TikTok Shop Streamer resmi dan riset Kalodata.';
    page = 1;
    render();
  }

  // ------------------------------------------------------------ render kartu
  const kaloOf = (id) => products.find((p) => p.id === String(id)) || null;
  function showcaseAsProduct(x) {
    const k = kaloOf(x.id);
    if (k) return { ...k, image: k.image || x.image, inShowcase: true, hasKalo: true, stockText: x.stock, statusText: x.status };
    return {
      raw: {}, id: String(x.id), title: x.title, shop: x.shop, image: x.image, priceText: x.price || '-', price: num(x.price),
      rate: 0, commRp: num(x.commission), sale: 0, revenue: 0, videos: [], capturedAt: 0,
      inShowcase: true, hasKalo: false, stockText: x.stock, statusText: x.status
    };
  }

  function showcaseCard(x) {
    const pid = esc(x.id);
    const k = kaloOf(x.id);
    const vids = (k?.videos || []).map((v, i) => `
      <button class="vthumb act-video" data-v="${i}" title="Video GMV #${v.rank || i + 1}">
        <img src="${esc(v.coverUrl || `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <span>▶ #${v.rank || i + 1}</span>
      </button>`).join('');
    const trend = k ? trendOf(k.raw) : [];
    return `
      <div class="card clickable" data-id="${pid}">
        <div class="thumb">
          <img src="${esc(coverOf(x.id, x.image))}" alt="" loading="lazy" referrerpolicy="no-referrer" ${imgFallback(pid)}>
          <span class="badge comm">Komisi ${esc(x.commission || '-')}</span>
        </div>
        <div class="card-body">
          <div class="card-title" title="${esc(x.title)}">${esc(x.title)}</div>
          <div class="pid">PID: <code>${pid}</code></div>
          <div class="price-row"><span>Harga: <b>${esc(x.price || '-')}</b></span><span>${esc(x.stock || '')}</span></div>
          ${trend.length > 1 ? `<div class="spark-row" title="Tren omzet harian 30 hari">${sparkline(trend)}<span class="${String(k.raw.revenue_grouping_rate || '').startsWith('-') ? 'down' : 'up'}">${esc(k.raw.revenue_grouping_rate || '')}</span></div>` : ''}
          ${vids ? `<div class="vrow">${vids}</div>` : `<div class="vrow-empty muted">${k ? 'Belum ada video GMV' : 'Data Kalodata belum ada · klik untuk detail'}</div>`}
          <button class="btn remove act-remove">Remove dari Etalase</button>
        </div>
      </div>`;
  }

  function kalodataCard(p) {
    const pid = esc(p.id);
    const inShowcase = showcaseIds.has(p.id);
    const vids = p.videos.map((v, i) => `
      <button class="vthumb act-video" data-v="${i}" title="Video GMV #${v.rank || i + 1}">
        <img src="${esc(v.coverUrl || `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <span>▶ #${v.rank || i + 1}</span>
      </button>`).join('');
    return `
      <div class="card clickable${selected.has(p.id) ? ' selected' : ''}" data-id="${pid}">
        <input type="checkbox" class="sel" ${selected.has(p.id) ? 'checked' : ''} aria-label="Pilih produk">
        <div class="thumb">
          <img src="${esc(coverOf(p.id, p.image))}" alt="" loading="lazy" referrerpolicy="no-referrer" ${imgFallback(pid)}>
          <span class="badge comm">Komisi ${p.rate ? `${p.rate.toFixed(p.rate % 1 ? 1 : 0)}%` : '-'}</span>
          ${inShowcase ? '<span class="badge in">✓ Di etalase</span>' : ''}
        </div>
        <div class="card-body">
          <div class="card-title" title="${esc(p.title)}">${esc(p.title)}</div>
          <div class="pid">PID: <code>${pid}</code></div>
          <div class="price-row"><span>Harga: <b>${esc(p.priceText)}</b></span><span>Terjual ${esc(p.raw.sale ?? '-')}</span></div>
          ${trendOf(p.raw).length > 1 ? `<div class="spark-row" title="Tren omzet harian 30 hari">${sparkline(trendOf(p.raw))}<span class="${String(p.raw.revenue_grouping_rate || '').startsWith('-') ? 'down' : 'up'}">${esc(p.raw.revenue_grouping_rate || '')}</span></div>` : ''}
          ${vids ? `<div class="vrow">${vids}</div>` : '<div class="vrow-empty muted">Belum ada video GMV</div>'}
          <button class="btn primary act-add" ${inShowcase ? 'disabled' : ''}>${inShowcase ? '✓ Sudah di Etalase' : 'Add Produk'}</button>
          <button class="btn grad act-copy">Salin URL Produk TikTok</button>
        </div>
      </div>`;
  }

  function currentList() {
    if (mode === 'showcase') {
      const q = $('sSearch').value.trim().toLowerCase();
      return showcaseItems.filter((x) => !q || `${x.title} ${x.shop} ${x.id}`.toLowerCase().includes(q));
    }
    const q = $('fSearch').value.trim().toLowerCase();
    const minComm = Number($('fComm').value) || 0;
    const pMin = Number($('fPriceMin').value) || 0;
    const pMax = Number($('fPriceMax').value) || 0;
    const list = products.filter((p) => (!q || `${p.title} ${p.shop} ${p.id}`.toLowerCase().includes(q))
      && p.rate >= minComm && p.price >= pMin && (!pMax || p.price <= pMax) && !showcaseIds.has(p.id)); // produk yang sudah di etalase tidak tampil di katalog
    const by = {
      sale: (a, b) => b.sale - a.sale,
      revenue: (a, b) => b.revenue - a.revenue,
      commission: (a, b) => b.rate - a.rate,
      commissionRp: (a, b) => b.commRp - a.commRp,
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      newest: (a, b) => b.capturedAt - a.capturedAt
    }[$('fSort').value];
    return list.sort(by);
  }

  function render() {
    const list = currentList();
    const empty = $('empty');
    const total = mode === 'showcase' ? showcaseItems.length : products.length;
    if (!total) {
      empty.hidden = false;
      empty.innerHTML = mode === 'showcase'
        ? '<h3>Etalase belum dimuat</h3>Klik <b>Sinkronkan Etalase</b> untuk membaca produk di etalase TikTok Shop Anda.'
        : '<h3>Katalog Kalodata masih kosong</h3>Buka <a href="https://www.kalodata.com/product" target="_blank" rel="noopener">halaman produk Kalodata</a> dengan akun Anda (produk otomatis tersimpan lewat ekstensi), atau klik <b>Salin JSON</b> di ekstensi lalu tempel di kolom atas / <b>Import File</b>.';
    } else {
      empty.hidden = list.length > 0;
      empty.innerHTML = '<h3>Tidak ada produk yang cocok</h3>Ubah kata kunci / filter.';
    }
    page = Math.min(page, Math.max(1, Math.ceil(list.length / PAGE_SIZE)));
    const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    $('grid').innerHTML = pageItems.map(mode === 'showcase' ? showcaseCard : kalodataCard).join('');
    renderPager(list.length);
    if (mode === 'kalodata') {
      $('selInfo').textContent = selected.size ? `${selected.size} dipilih` : `${list.length} produk`;
      $('btnAddSel').hidden = !selected.size;
      $('btnAddSel').textContent = `Add ${selected.size} yang dipilih`;
    }
  }

  function renderPager(n) {
    const pages = Math.ceil(n / PAGE_SIZE);
    if (pages <= 1) { $('pager').innerHTML = ''; return; }
    const list = [];
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 2) list.push(i);
    $('pager').innerHTML = list.map((i, idx) => `${idx && i - list[idx - 1] > 1 ? '<span class="muted">…</span>' : ''}<button class="${i === page ? 'cur' : ''}" data-page="${i}">${i}</button>`).join('');
  }

  // ------------------------------------------------------------ aksi
  async function addProducts(ids) {
    ids = ids.filter((id) => !showcaseIds.has(id));
    if (!ids.length) return;
    toast(`Menambahkan ${ids.length} produk ke etalase...`, false, 60000);
    const r = await ext('addToShowcase', { ids });
    if (r?.needLogin) { toast('Sesi TikTok Shop berakhir. Silakan login lagi.', true, 9000); return showTikTokLogin(); }
    if (r?.success) {
      ids.forEach((id) => selected.delete(id));
      toast(`✓ ${r.added} produk ditambahkan ke etalase${r.already ? ` · ${r.already} sudah ada sebelumnya` : ''}${r.errors?.length ? ` · gagal: ${r.errors[0]}` : ''}`, false, 9000);
      await syncShowcase();
    } else {
      toast(`Gagal menambah ke etalase: ${r?.errors?.[0] || r?.error || 'tidak diketahui'}`, true, 9000);
    }
    render();
  }

  async function removeProduct(pid, btn) {
    if (!confirm('Hapus produk ini dari etalase TikTok Shop?')) return;
    btn.disabled = true; btn.textContent = 'Menghapus...';
    const r = await ext('removeFromShowcase', { ids: [pid] });
    if (r?.success) {
      showcaseItems = showcaseItems.filter((x) => String(x.id) !== String(pid));
      showcaseIds.delete(String(pid));
      $('showcaseInfo').textContent = `${showcaseItems.length} produk di etalase`;
      toast('✓ Produk dihapus dari etalase');
      render();
    } else {
      btn.disabled = false; btn.textContent = 'Remove dari Etalase';
      toast(`Gagal menghapus: ${r?.errors?.[0] || r?.error || 'tidak diketahui'}`, true, 8000);
    }
  }

  // Tempel / impor JSON Kalodata ({ success, data: [...] } atau array)
  async function importJsonText(text) {
    let parsed;
    try { parsed = JSON.parse(String(text || '').trim()); } catch (e) { return toast('Format JSON tidak valid. Gunakan "Salin JSON" dari ekstensi Kalodata Exporter.', true); }
    const list = Array.isArray(parsed) ? parsed : (parsed.data || parsed.products || parsed.list || []);
    const items = list.filter((x) => x && (x.id || x.productId)).map((x) => ({ ...x, id: String(x.id || x.productId) }));
    if (!items.length) return toast('Tidak ada produk di JSON tersebut.', true);
    const r = await ext('importKalodataProducts', { products: items });
    if (!r?.success) return toast(r?.error || 'Gagal menyimpan produk.', true);
    $('jsonInput').value = '';
    await loadProducts();
    toast(`✓ ${items.length} produk Kalodata dimuat (total ${r.total})`);
    setMode('kalodata');
  }

  // ------------------------------------------------------------ grafik tren omzet (seperti aplikasi)
  const shortRp = (n) => (n >= 1e9 ? `Rp${(n / 1e9).toFixed(2).replace('.', ',')}M` : n >= 1e6 ? `Rp${(n / 1e6).toFixed(1).replace('.', ',')}JT` : n >= 1e3 ? `Rp${(n / 1e3).toFixed(1).replace('.', ',')}RB` : `Rp${Math.round(n || 0)}`);
  const trendOf = (raw) => (Array.isArray(raw?.revenue_trend) ? raw.revenue_trend.map(Number).filter((v) => Number.isFinite(v)) : []);
  // Tanggal tiap titik: titik terakhir = kemarin
  const trendDate = (len, i) => { const d = new Date(); d.setDate(d.getDate() - (len - i)); return d; };
  const fmtDay = (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

  // Grafik mini di kartu katalog
  function sparkline(values) {
    if (values.length < 2) return '';
    const w = 100, h = 26, max = Math.max(...values, 1), min = Math.min(...values, 0);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(2)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(2)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // Grafik area besar + garis bantu & tooltip saat kursor diarahkan
  function trendChart(el, values, fullLen, dates = null) {
    // Tanggal tiap titik: dari Kalodata bila ada, kalau tidak dihitung mundur (titik terakhir = kemarin)
    const dayAt = (idx) => (dates && dates[idx] ? new Date(`${dates[idx]}T00:00:00`) : trendDate(fullLen, idx));
    if (!values.length) { el.innerHTML = '<div class="muted chart-empty">Data tren omzet belum tersedia.</div>'; return; }
    const W = 640, H = 220, P = { l: 58, r: 14, t: 14, b: 26 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = Math.max(...values) * 1.1 || 1;
    const x = (i) => P.l + (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
    const y = (v) => P.t + ih - (v / max) * ih;
    const offset = fullLen - values.length;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
    const grid = ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${shortRp(t).replace('Rp', '')}</text>`).join('');
    const step = Math.max(1, Math.ceil(values.length / 6));
    const xl = values.map((_, i) => (i % step === 0 || i === values.length - 1) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === values.length - 1 && values.length > 1 ? 'end' : i === 0 && values.length > 1 ? 'start' : 'middle'}" class="axis">${fmtDay(dayAt(i + offset))}</text>` : '').join('');
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
    el.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Grafik tren omzet harian">
          <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
          ${grid}${xl}
          <path d="${area}" fill="url(#trendFill)"/>
          <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <line class="cross" x1="0" x2="0" y1="${P.t}" y2="${P.t + ih}" visibility="hidden"/>
          <circle class="dot" r="5" visibility="hidden"/>
          <rect class="hit" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), cross = el.querySelector('.cross'), dot = el.querySelector('.dot');
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(((sx - P.l) / iw) * (values.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<div class="muted">${fmtDay(dayAt(i + offset))}</div><b>${shortRp(values[i])}</b>`;
      const px = (x(i) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(px, 60), r.width - 60)}px`;
      tip.style.top = `${(y(values[i]) / H) * r.height}px`;
    });
  }

  function openDetail(p) {
    const x = p.raw;
    const trend = trendOf(x);
    $('modalTitle').textContent = p.title;
    $('modalBody').className = 'modal-body detail';
    $('modalBody').innerHTML = `
      <div class="dleft">
        <img class="dimg" src="${esc(coverOf(p.id, p.image))}" alt="" referrerpolicy="no-referrer" ${imgFallback(esc(p.id))}>
        <div class="dmeta">
          <div><span class="muted">PID</span> <code>${esc(p.id)}</code></div>
          ${p.shop ? `<div><span class="muted">Toko</span> ${esc(p.shop)}</div>` : ''}
          <div><span class="muted">Komisi</span> <b>${p.rate ? `${p.rate}% (${rp(p.commRp)})` : (p.commRp ? rp(p.commRp) : '-')}</b></div>
          ${p.stockText ? `<div><span class="muted">Stok</span> ${esc(p.stockText)} · ${esc(p.statusText || '')}</div>` : ''}
          ${x.product_rating ? `<div><span class="muted">Rating</span> ★ ${esc(x.product_rating)}</div>` : ''}
          ${x.launch_date ? `<div><span class="muted">Rilis</span> ${esc(x.launch_date)}</div>` : ''}
        </div>
        <div class="dact">
          ${p.inShowcase
            ? '<button class="btn remove" id="dRemove">Remove dari Etalase</button>'
            : `<button class="btn primary" id="dAdd" ${showcaseIds.has(p.id) ? 'disabled' : ''}>${showcaseIds.has(p.id) ? '✓ Sudah di Etalase' : 'Add Produk'}</button>`}
          <a class="btn ghost" href="${esc(tiktokProductUrl(p.id))}" target="_blank" rel="noopener">Buka di TikTok ↗</a>
        </div>
        ${p.inShowcase && !p.hasKalo ? `<div class="kalo-note">Data penjualan & video GMV produk ini belum ada. Buka produk ini di Kalodata (akun Anda) — datanya otomatis masuk.<a class="btn grad" href="https://www.kalodata.com/product/detail?id=${esc(p.id)}" target="_blank" rel="noopener">Lihat di Kalodata ↗</a></div>` : ''}
      </div>
      <div class="dright">
        <div class="drange-row">
          <div class="dsec-title" id="dMetricTitle">METRIK INTI PENJUALAN</div>
          <div class="seg" id="dRange">
            <button data-r="1">Kemarin</button><button data-r="7">7 Hari</button><button data-r="30" class="on">30 Hari</button>
          </div>
        </div>
        <div class="tiles" id="dTiles"></div>
        <div class="dsec-title" id="dChartTitle">Grafik Tren Omzet Harian</div>
        <div id="dChart"></div>
      </div>`;
    $('modal').hidden = false;
    if ($('dAdd')) $('dAdd').onclick = () => { $('modal').hidden = true; addProducts([p.id]); };
    if ($('dRemove')) $('dRemove').onclick = (e) => { $('modal').hidden = true; removeProduct(p.id, e.currentTarget); };

    const total = trend.reduce((a, b) => a + b, 0) || 1;
    const tile = (k, v, sub = '') => `<div class="tile"><div class="tk">${k}</div><div class="tv">${esc(v)}</div>${sub ? `<div class="ts">${sub}</div>` : ''}</div>`;
    // Produk etalase tanpa data Kalodata: tampilkan data TikTok Shop saja (tanpa angka 0 yang menyesatkan)
    if (p.inShowcase && !p.hasKalo) {
      $('dRange').hidden = true;
      $('dMetricTitle').textContent = 'DATA ETALASE TIKTOK SHOP';
      $('dTiles').innerHTML = [tile('Harga', p.priceText), tile('Komisi / produk', p.commRp ? rp(p.commRp) : '-'), tile('Stok', p.stockText || '-'), tile('Status', p.statusText || '-')].join('');
      $('dChartTitle').textContent = 'Grafik Tren Omzet Harian';
      $('dChart').innerHTML = '<div class="chart-wrap"><div class="muted chart-empty">Grafik omzet & video GMV muncul setelah produk ini dibuka di Kalodata (akun Anda).</div></div>';
      return;
    }
    // Data dari halaman detail Kalodata tanpa tren harian: tampilkan apa adanya sesuai rentang Kalodata
    if (!trend.length && x.range_days) {
      $('dRange').hidden = true;
      $('dMetricTitle').textContent = `METRIK INTI PENJUALAN (${x.range_days} HARI · ${x.range_label || 'Kalodata'})`;
      $('dTiles').innerHTML = [
        tile('Omzet', x.revenue || '-'), tile('Terjual', x.sale || '-'), tile('Harga satuan', x.unit_price || p.priceText),
        tile('Kreator', x.creator_num != null ? `${Number(x.creator_num).toLocaleString('id-ID')} orang` : '-'),
        tile('Omzet video', x.video_revenue || '-'), tile('Omzet live', x.live_revenue || '-'),
        tile('Omzet mall', x.shopping_mall_revenue || '-'), tile('Komisi / produk', p.commRp ? rp(p.commRp) : '-')
      ].join('');
      $('dChartTitle').textContent = 'Grafik Tren Omzet Harian';
      $('dChart').innerHTML = '<div class="chart-wrap"><div class="muted chart-empty">Grafik harian muncul bila produk ini juga tampil di daftar produk Kalodata (halaman Product).</div></div>';
      return;
    }
    const show = (range) => {
      $('dRange').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === range));
      const label = range === '1' ? 'Kemarin' : range === '7' ? '7 Hari Terakhir' : '30 Hari Terakhir';
      $('dMetricTitle').textContent = `METRIK INTI PENJUALAN (${label.toUpperCase()})`;
      $('dChartTitle').textContent = `Grafik Tren Omzet Harian (${label})`;
      const view = range === '1' ? trend.slice(-2) : range === '7' ? trend.slice(-7) : trend;
      const sum = range === '1' ? (trend[trend.length - 1] || 0) : view.reduce((a, b) => a + b, 0);
      const ratio = range === '30' || !trend.length ? 1 : Math.min(1, sum / total);
      let growth = x.revenue_grouping_rate || '-';
      if (range === '1' && trend.length >= 2) {
        const a = trend[trend.length - 1], b = trend[trend.length - 2] || a;
        const d = ((a - b) / (b || 1)) * 100;
        growth = `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
      }
      const dates = Array.isArray(x.revenue_trend_dates) && x.revenue_trend_dates.length === trend.length ? x.revenue_trend_dates : null;
      // Produk dari halaman detail Kalodata: semua angka dihitung dari data harian (rentang total-nya bisa beda, mis. 7 hari)
      if (Array.isArray(x.sale_trend) && x.sale_trend.length) {
        const n = range === '1' ? 1 : range === '7' ? 7 : trend.length;
        const rev = trend.slice(-n).reduce((a, b) => a + b, 0);
        const prev = trend.slice(-2 * n, -n).reduce((a, b) => a + b, 0);
        const sold = x.sale_trend.slice(-n).reduce((a, b) => a + b, 0);
        const g = prev ? ((rev - prev) / prev) * 100 : null;
        const base = trend.slice(-(x.range_days || 7)).reduce((a, b) => a + b, 0) || 1;
        const k = rev / base;
        const up = g == null || g >= 0;
        $('dTiles').innerHTML = [
          tile('Omzet', shortRp(rev)),
          tile('Terjual', sold.toLocaleString('id-ID')),
          tile('Harga satuan', x.unit_price || p.priceText),
          tile('Pertumbuhan', g == null ? '-' : `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`, g == null ? '' : `<span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} vs ${range === '1' ? 'hari sebelumnya' : `${n} hari sebelumnya`}</span>`),
          tile('Omzet video', x.video_revenue ? shortRp(num(x.video_revenue) * k) : '-'),
          tile('Omzet live', x.live_revenue ? shortRp(num(x.live_revenue) * k) : '-'),
          tile('Kreator', x.creator_num != null ? `${Number(x.creator_num).toLocaleString('id-ID')} orang` : '-', x.range_days ? `${x.range_days} hari terakhir` : ''),
          tile('Komisi / produk', rp(p.commRp))
        ].join('');
        trendChart($('dChart'), view, trend.length, dates);
        return;
      }
      const isUp = !String(growth).trim().startsWith('-');
      $('dTiles').innerHTML = [
        tile('Omzet', range === '30' ? (x.revenue || shortRp(sum)) : shortRp(sum)),
        tile('Terjual', `${Math.round(p.sale * ratio).toLocaleString('id-ID')}`),
        tile('Harga satuan', p.priceText),
        tile('Pertumbuhan', growth, `<span class="${isUp ? 'up' : 'down'}">${isUp ? '▲ naik' : '▼ turun'}</span>`),
        tile('Omzet video', range === '30' ? (x.video_revenue || '-') : shortRp(num(x.video_revenue) * ratio)),
        tile('Omzet live', range === '30' ? (x.live_revenue || '-') : shortRp(num(x.live_revenue) * ratio)),
        tile('Kreator', `${Math.max(range === '30' ? 0 : 1, Math.round(Number(x.creator_num || 0) * (range === '1' ? 0.35 : range === '7' ? 0.75 : 1))).toLocaleString('id-ID')} orang`),
        tile('Komisi / produk', rp(p.commRp))
      ].join('');
      trendChart($('dChart'), view, trend.length, dates);
    };
    $('dRange').addEventListener('click', (e) => { const b = e.target.closest('button[data-r]'); if (b) show(b.dataset.r); });
    show('30');
  }

  function openVideo(p, idx) {
    const vids = p.videos;
    const show = (i) => {
      const v = vids[i];
      $('modalTitle').textContent = `Video GMV #${v.rank || i + 1} · ${p.title}`;
      $('modalBody').className = 'modal-body player';
      $('modalBody').innerHTML = `
        ${v.playUrl
          ? `<video src="${esc(v.playUrl)}" controls autoplay playsinline poster="${esc(v.coverUrl || '')}"></video>`
          : `<div class="nov"><img src="${esc(v.coverUrl || `https://img.kalocdn.com/tiktok.video/${v.id}/cover.png`)}" alt="" referrerpolicy="no-referrer"><p class="muted">Link putar belum tersedia — putar videonya sekali di Kalodata, lalu ambil ulang.</p></div>`}
        <div class="pact">
          <button class="btn ghost" id="vPrev" ${i === 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
          <a class="btn ghost" href="${esc(v.tiktokUrl || `https://www.tiktok.com/@/video/${v.id}`)}" target="_blank" rel="noopener">Buka di TikTok ↗</a>
          <button class="btn ghost" id="vNext" ${i >= vids.length - 1 ? 'disabled' : ''}>Berikutnya ›</button>
        </div>`;
      $('vPrev').onclick = () => show(i - 1);
      $('vNext').onclick = () => show(i + 1);
    };
    show(idx);
    $('modal').hidden = false;
  }

  // ------------------------------------------------------------ event
  document.querySelectorAll('.mode-tab').forEach((t) => t.addEventListener('click', async () => {
    if (t.dataset.mode === 'kalodata') await loadProducts();
    setMode(t.dataset.mode);
  }));
  ['fSearch', 'fSort', 'fComm', 'fPriceMin', 'fPriceMax', 'sSearch'].forEach((id) => $(id).addEventListener('input', () => { page = 1; render(); }));
  $('btnSync').addEventListener('click', syncShowcase);
  $('btnAutoKalo').addEventListener('click', () => runAutoKalo(true));
  $('kaloTipClose').addEventListener('click', () => { $('kaloTip').hidden = true; try { localStorage.setItem('kaloTipHidden', '1'); } catch (e) {} });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) importJsonText(await f.text());
    e.target.value = '';
  });
  $('btnProcessJson').addEventListener('click', () => importJsonText($('jsonInput').value));
  $('jsonInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') importJsonText($('jsonInput').value); });
  $('btnReset').addEventListener('click', async () => {
    if (!confirm('Reset data katalog Kalodata di browser ini? (etalase TikTok tidak berubah)')) return;
    await ext('clearProducts');
    selected.clear();
    await loadProducts();
    toast('Data katalog Kalodata dihapus.');
    render();
  });
  $('btnAddSel').addEventListener('click', () => addProducts([...selected]));

  $('grid').addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    if (mode === 'showcase') {
      const b = e.target.closest('.act-remove');
      if (b) return removeProduct(id, b);
      const item = showcaseItems.find((x) => String(x.id) === id);
      if (!item) return;
      const sp = showcaseAsProduct(item);
      const vb = e.target.closest('.act-video');
      if (vb && sp.videos.length) return openVideo(sp, Number(vb.dataset.v) || 0);
      return openDetail(sp);
    }
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (e.target.classList.contains('sel')) {
      if (e.target.checked) selected.add(id); else selected.delete(id);
      card.classList.toggle('selected', e.target.checked);
      $('selInfo').textContent = selected.size ? `${selected.size} dipilih` : '';
      $('btnAddSel').hidden = !selected.size;
      $('btnAddSel').textContent = `Add ${selected.size} yang dipilih`;
      return;
    }
    if (e.target.closest('.act-add')) return addProducts([id]);
    if (e.target.closest('.act-copy')) {
      const b = e.target.closest('.act-copy');
      try { await navigator.clipboard.writeText(tiktokProductUrl(id)); b.textContent = 'Tersalin ✓'; } catch (err) { b.textContent = 'Gagal menyalin'; }
      setTimeout(() => { b.textContent = 'Salin URL Produk TikTok'; }, 1500);
      return;
    }
    const vb = e.target.closest('.act-video');
    if (vb) return openVideo(p, Number(vb.dataset.v) || 0);
    openDetail(p);
  });
  $('pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b) return;
    page = Number(b.dataset.page);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('modalClose').addEventListener('click', () => { $('modal').hidden = true; $('modalBody').innerHTML = ''; });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modalClose').click(); });
  $('btnLogout').addEventListener('click', () => {
    if (!confirm('Keluar dari lisensi di browser ini?')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    location.reload();
  });

  // Jangan pernah diam: tampilkan error bila ada yang gagal
  window.addEventListener('error', (e) => { if (!$('app').hidden) return; gate(`<h2>Terjadi kesalahan</h2><p>${esc(e.message || 'Error')}</p><button class="btn primary block" onclick="location.reload(true)">Muat ulang</button>`); });
  boot().catch((e) => gate(`<h2>Terjadi kesalahan</h2><p>${esc(e.message || e)}</p><button class="btn primary block" onclick="location.reload(true)">Muat ulang</button>`));
})();
