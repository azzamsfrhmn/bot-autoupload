// Etnic Showcase — service worker
// - Menyimpan produk Kalodata hasil tangkapan (chrome.storage.local, hanya di browser pengguna)
// - Menjalankan aksi etalase di tab TikTok Shop pengguna (tampilan resmi, tanpa API rahasia)

const SHOWCASE_URL = 'https://shop.tiktok.com/streamer/showcase/product/list';
const BATCH_SIZE = 20;

// ---------------------------------------------------------------- penyimpanan
async function getStore(keys) { return chrome.storage.local.get(keys); }
async function setStore(obj) { return chrome.storage.local.set(obj); }

async function getInstallId() {
  const { installId } = await getStore('installId');
  if (installId) return installId;
  const id = crypto.randomUUID();
  await setStore({ installId: id });
  return id;
}

async function saveKalodataProducts(products = []) {
  const { products: saved = {} } = await getStore('products');
  const now = Date.now();
  for (const p of products) {
    if (!p || !p.id) continue;
    const prev = saved[p.id] || {};
    // Pertahankan video yang sudah punya link putar bila data baru belum punya
    const topVideos = (p.topVideos || []).map((v) => {
      const old = (prev.topVideos || []).find((o) => o.id === v.id);
      return { ...v, playUrl: v.playUrl || old?.playUrl || '' };
    });
    saved[p.id] = { ...prev, ...p, topVideos: topVideos.length ? topVideos : (prev.topVideos || []), capturedAt: now };
  }
  await setStore({ products: saved });
  return { success: true, total: Object.keys(saved).length };
}

// ---------------------------------------------------------------- tab TikTok Shop
function waitTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return resolve(tab);
      } catch (e) { return resolve(null); }
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(check, 500);
    };
    check();
  });
}

async function getShowcaseTab() {
  const tabs = await chrome.tabs.query({ url: 'https://shop.tiktok.com/streamer/showcase/*' });
  let tab = tabs[0];
  if (tab) {
    await chrome.tabs.update(tab.id, { url: SHOWCASE_URL });
  } else {
    tab = await chrome.tabs.create({ url: SHOWCASE_URL, active: false });
  }
  await waitTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 2500));
  return chrome.tabs.get(tab.id);
}

async function runInTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'MAIN' });
  return res?.result;
}

function progress(senderTabId, text) {
  if (senderTabId != null) chrome.tabs.sendMessage(senderTabId, { type: 'progress', text }).catch(() => {});
}

// ================================================================ fungsi di halaman TikTok Shop
// (dijalankan di dalam tab; harus berdiri sendiri, tanpa variabel luar)

async function pageAddProducts(urls) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => e && e.offsetParent !== null;
  const findText = (re, root = document) => Array.from(root.querySelectorAll('button, [role="button"], a'))
    .find((e) => visible(e) && re.test((e.innerText || '').trim()));
  if (/login|signin|passport/.test(location.href)) return { success: false, needLogin: true, error: 'Belum login TikTok Shop. Login di tab TikTok Shop lalu coba lagi.' };

  let openBtn = null;
  for (let i = 0; i < 40 && !openBtn; i++) { openBtn = findText(/^(add new products|tambah produk baru)$/i); if (!openBtn) await sleep(500); }
  if (!openBtn) return { success: false, error: 'Tombol "Add new products" tidak ditemukan di halaman etalase.' };
  openBtn.click();

  let box = null;
  for (let i = 0; i < 30 && !box; i++) {
    box = Array.from(document.querySelectorAll('textarea, input')).find((e) => visible(e) && /product url|url produk|productURL/i.test(e.placeholder || ''));
    if (!box) await sleep(400);
  }
  if (!box) return { success: false, error: 'Kolom URL produk tidak ditemukan.' };
  const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, urls.join('\n'));
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(600);

  const parseBtn = findText(/^(product urls|url produk)$/i);
  if (!parseBtn) return { success: false, error: 'Tombol "Product URLs" tidak ditemukan.' };
  parseBtn.click();

  // Tunggu pratinjau: "Select X/Y Products"
  let sel = null;
  for (let i = 0; i < 50 && !sel; i++) {
    await sleep(500);
    const m = (document.body.innerText || '').match(/select\s+(\d+)\s*\/\s*(\d+)\s+products?|pilih\s+(\d+)\s*\/\s*(\d+)\s+produk/i);
    if (m && Number(m[2] || m[4]) > 0) sel = { selected: Number(m[1] || m[3]), total: Number(m[2] || m[4]) };
  }
  if (!sel || !sel.selected) {
    const msg = Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [class*="message"]')).map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 3).join(' | ');
    const cancel = findText(/^(cancel|batal)$/i);
    if (cancel) cancel.click();
    return { success: false, error: msg || 'Produk tidak bisa ditambahkan (link tidak valid / sudah ada di etalase / tidak ikut affiliate).' };
  }

  const addBtn = Array.from(document.querySelectorAll('button')).filter((e) => visible(e) && /^(add products|tambah produk)$/i.test((e.innerText || '').trim())).pop();
  if (!addBtn) return { success: false, error: 'Tombol "Add products" tidak ditemukan.' };
  addBtn.click();

  // Selesai bila panel tertutup / muncul notifikasi
  let toast = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const t = Array.from(document.querySelectorAll('[class*="message"], [class*="toast"], [class*="Toast"], [class*="notification"]'))
      .map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | ');
    if (t) toast = t;
    const stillOpen = Array.from(document.querySelectorAll('textarea, input')).some((e) => visible(e) && /product url|url produk|productURL/i.test(e.placeholder || ''));
    if (!stillOpen) break;
  }
  return { success: true, added: sel.selected, total: sel.total, message: toast };
}

async function pageReadShowcase() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (/login|signin|passport/.test(location.href)) return { success: false, needLogin: true, error: 'Belum login TikTok Shop.' };
  for (let i = 0; i < 40 && !document.querySelector('tbody tr'); i++) await sleep(500);
  const head = (document.body.innerText || '').match(/([\d.,]+)\s+products? in showcase|([\d.,]+)\s+produk di etalase/i);
  const items = new Map();
  for (let page = 0; page < 120; page++) {
    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => (th.innerText || '').trim().toLowerCase());
    const col = (re) => headers.findIndex((h) => re.test(h));
    const iProduct = col(/^product|^produk/);
    const iPrice = col(/price|harga/);
    const iComm = col(/commission|komisi/);
    const iStock = col(/stock|stok/);
    const iStatus = col(/status/);
    document.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      const text = tr.innerText || '';
      const idm = text.replace(/\s+/g, '').match(/ID:(\d{10,})/);
      if (!idm) return;
      const cell = (i) => (i >= 0 && tds[i] ? (tds[i].innerText || '').trim().replace(/\s+/g, ' ') : '');
      const prodCell = iProduct >= 0 ? tds[iProduct] : tr;
      const lines = (prodCell?.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      items.set(idm[1], {
        id: idm[1],
        title: lines[0] || '',
        shop: lines.filter((l) => !/^ID:|^\d+$/.test(l)).slice(-1)[0] || '',
        image: prodCell?.querySelector('img')?.src || '',
        price: cell(iPrice),
        commission: cell(iComm),
        stock: cell(iStock),
        status: cell(iStatus)
      });
    });
    const next = document.querySelector('.arco-pagination-item-next:not(.arco-pagination-item-disabled), li[aria-label="Next page"]:not([aria-disabled="true"]), button[aria-label="Next"]:not([disabled])');
    if (!next) break;
    const before = document.querySelector('tbody tr')?.innerText || '';
    next.click();
    for (let i = 0; i < 20; i++) { await sleep(400); if ((document.querySelector('tbody tr')?.innerText || '') !== before) break; }
  }
  return { success: true, count: head ? Number(String(head[1] || head[2]).replace(/[.,]/g, '')) : items.size, items: Array.from(items.values()) };
}

async function pageRemoveProduct(pid) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => e && e.offsetParent !== null;
  // Cari lewat kolom pencarian etalase
  const search = Array.from(document.querySelectorAll('input')).find((e) => visible(e) && /search products|cari produk/i.test(e.placeholder || ''));
  if (search) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, pid);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(2500);
  }
  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    row = Array.from(document.querySelectorAll('tbody tr')).find((tr) => (tr.innerText || '').replace(/\s+/g, '').includes(`ID:${pid}`));
    if (!row) await sleep(500);
  }
  if (!row) return { success: false, error: 'Produk tidak ditemukan di etalase.' };
  const rm = Array.from(row.querySelectorAll('a, button, span, [role="button"]')).find((e) => visible(e) && /^(remove|hapus)$/i.test((e.innerText || '').trim()));
  if (!rm) return { success: false, error: 'Tombol Remove tidak ditemukan.' };
  rm.click();
  // Konfirmasi
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const dlg = document.querySelector('.arco-modal, [role="dialog"], .arco-popconfirm, [class*="popconfirm"]');
    const ok = dlg && Array.from(dlg.querySelectorAll('button')).find((b) => visible(b) && /^(remove|confirm|ok|hapus|konfirmasi|yes|ya)$/i.test((b.innerText || '').trim()));
    if (ok) { ok.click(); break; }
  }
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const still = Array.from(document.querySelectorAll('tbody tr')).some((tr) => (tr.innerText || '').replace(/\s+/g, '').includes(`ID:${pid}`));
    if (!still) return { success: true };
  }
  return { success: false, error: 'Produk masih ada setelah klik Remove.' };
}

// ================================================================ akun TikTok Shop
async function pageAccountInfo() {
  try {
    const r = await fetch('/api/v1/streamer_desktop/account_info/get', { credentials: 'include' });
    return await r.json();
  } catch (e) { return null; }
}

function parseAccount(j) {
  const d = j && j.code === 0 ? j.data : null;
  if (!d || !d.user_name) return null;
  return { username: d.user_name, userId: d.user_id || '', avatar: (d.avatar && d.avatar.url_list && d.avatar.url_list[0]) || '' };
}

// Cek login TikTok Shop: langsung dari ekstensi; bila gagal (cookie dibatasi), lewat tab etalase
async function getTikTokAccount({ viaTab = false } = {}) {
  try {
    const r = await fetch('https://shop.tiktok.com/api/v1/streamer_desktop/account_info/get', { credentials: 'include' });
    const acc = parseAccount(await r.json());
    if (acc) return { success: true, loggedIn: true, account: acc };
  } catch (e) {}
  if (viaTab) {
    const tabs = await chrome.tabs.query({ url: 'https://shop.tiktok.com/*' });
    const tab = tabs.find((t) => t.status === 'complete');
    if (tab) {
      const acc = parseAccount(await runInTab(tab.id, pageAccountInfo).catch(() => null));
      if (acc) return { success: true, loggedIn: true, account: acc };
    }
  }
  return { success: true, loggedIn: false };
}

async function openTikTokLogin() {
  const tabs = await chrome.tabs.query({ url: 'https://shop.tiktok.com/*' });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true, url: SHOWCASE_URL });
    await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
  } else {
    await chrome.tabs.create({ url: SHOWCASE_URL, active: true });
  }
  return { success: true };
}

// ================================================================ jalur langsung (tanpa membuka tab)
// Permintaan yang sama dengan halaman Showcase Products, dikirim dari ekstensi memakai sesi login TikTok Shop pengguna.
const API_QS = 'aid=253642&app_name=i18n_ecom_alliance&locale=en&user_language=en&device_platform=web&page_scene=0';
async function shopPost(path, body) {
  const r = await fetch(`https://shop.tiktok.com/api/v1/streamer_desktop/${path}?${API_QS}`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

// Dijalankan di dalam tab TikTok Shop (cookie halaman) — permintaan sama, tanpa mengisi form
async function pagePost(path, body, qs) {
  try {
    const r = await fetch(`/api/v1/streamer_desktop/${path}?${qs}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { code: -1, message: e.message }; }
}

// Tab TikTok Shop sementara (latar belakang) → poster; tab ditutup lagi bila dibuat oleh ekstensi
async function withTabPoster(fn) {
  const existing = (await chrome.tabs.query({ url: 'https://shop.tiktok.com/*' })).find((t) => t.status === 'complete');
  let tab = existing;
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: SHOWCASE_URL, active: false });
    created = true;
    await waitTabComplete(tab.id);
    await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    if (/login|passport/.test((await chrome.tabs.get(tab.id)).url || '')) return { success: false, needLogin: true, error: 'Belum login TikTok Shop.' };
    return await fn((path, body) => runInTab(tab.id, pagePost, [path, body, API_QS]));
  } finally {
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function addDirect(ids, senderTabId, post = shopPost) {
  let added = 0;
  const already = [];
  const errors = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    progress(senderTabId, `Menambahkan ${i + 1}–${i + batch.length} dari ${ids.length} produk ke etalase...`);
    // 1. Cek link produk (sama seperti tombol "Product URLs")
    const chk = await post('product_link/check', { origin: 2, urls: batch.map((id) => `https://shop.tiktok.com/view/product/${id}`) });
    if (chk?.code !== 0) return { fatal: true, code: chk?.code, error: chk?.message || 'Gagal memeriksa link produk.' };
    const toAdd = [];
    for (const r of chk.data?.results || []) {
      const pi = r.product_info || {};
      const cl = pi.closed_loop_product;
      const pid = cl?.product_id || (r.original_url || '').match(/(\d{10,})/)?.[1];
      if (!cl) { errors.push(`${pid || r.original_url}: produk tidak bisa ditambahkan (bukan produk affiliate / link tidak valid)`); continue; }
      if (cl.add_status === 2) { already.push(pid); continue; }
      toAdd.push({ product_id: String(cl.product_id), source_from: pi.source_from ?? 2, main_plan_id: '', isv_id: '' });
    }
    if (!toAdd.length) continue;
    // 2. Tambahkan (sama seperti tombol "Add products")
    const res = await post('showcase_product/add', { product_info: toAdd });
    const statuses = res?.data?.product_add_status || [];
    if (res?.code === 0 && !statuses.length) { added += toAdd.length; continue; }
    for (const it of toAdd) {
      const st = statuses.find((s) => String(s.product_id) === it.product_id);
      if (res?.code === 0 && (!st || st.add_status === 1 || st.add_status === 0)) added++;
      else errors.push(`${it.product_id}: ditolak TikTok Shop (status ${st?.add_status ?? res?.code})`);
    }
  }
  return { success: added > 0 || already.length > 0, added, already: already.length, requested: ids.length, errors };
}

// ================================================================ aksi
async function addToShowcase(pids, senderTabId) {
  const ids = [...new Set((pids || []).map(String).filter((p) => /^\d{10,}$/.test(p)))];
  if (!ids.length) return { success: false, error: 'Tidak ada produk dipilih.' };
  let direct = null;
  try { direct = await addDirect(ids, senderTabId); } catch (e) { direct = null; }
  if (direct && !direct.fatal) return direct;
  // Cadangan: permintaan yang sama dari dalam tab TikTok Shop (latar belakang, ditutup lagi)
  const viaTab = await withTabPoster((post) => addDirect(ids, senderTabId, post)).catch((e) => ({ success: false, error: e.message }));
  if (viaTab?.fatal) return { success: false, needLogin: viaTab.code !== undefined && viaTab.code !== 0 && /login|auth/i.test(viaTab.error || ''), error: viaTab.error };
  return viaTab;
}

// Baca etalase langsung dari ekstensi (tanpa membuka tab) memakai data yang sama dengan halaman Showcase Products
async function readShowcaseDirect() {
  const items = [];
  let total = 0;
  for (let offset = 0, guard = 0; guard < 60; guard++) {
    const url = `https://shop.tiktok.com/api/v1/streamer_desktop/search_product/list?size=50&offset=${offset}&origin=2&aid=253642&app_name=i18n_ecom_alliance&locale=en-US&user_language=en-US&page_scene=0`;
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    if (j?.code !== 0 || !j.data) return { success: false, code: j?.code, error: j?.message || 'Gagal membaca etalase.' };
    const list = j.data.products || [];
    total = j.data.total || total;
    for (const p of list) {
      const cover = p.cover?.url_list?.[0] || p.cover?.thumb_url_list?.[0] || '';
      items.push({
        id: String(p.product_id),
        title: p.title || '',
        shop: p.seller_info?.shop_name || '',
        image: cover,
        price: p.format_available_price || p.format_origin_price || '',
        commission: p.affiliate_info?.est_commission_expense || '',
        stock: p.stock_status === 1 ? `In Stock (${Number(p.stock_num || 0).toLocaleString('id-ID')})` : 'Habis',
        status: p.is_hide ? 'Hidden' : 'Live',
        sourceFrom: p.source_from ?? 0
      });
    }
    if (!j.data.has_more || !list.length) break;
    offset += list.length;
  }
  return { success: true, count: total || items.length, items };
}

async function readShowcase() {
  let direct = null;
  try { direct = await readShowcaseDirect(); } catch (e) { direct = null; }
  if (direct?.success) {
    await setStore({ showcaseCache: { at: Date.now(), items: direct.items } });
    return direct;
  }
  // Belum login → minta login (bukan membuka tab diam-diam)
  const acc = await getTikTokAccount().catch(() => null);
  if (acc && !acc.loggedIn) return { success: false, needLogin: true, error: 'Belum login TikTok Shop.' };
  // Cadangan: baca lewat tab etalase (latar belakang, ditutup lagi)
  const existing = (await chrome.tabs.query({ url: 'https://shop.tiktok.com/*' })).find((t) => t.status === 'complete');
  let tab = existing;
  let created = false;
  if (!tab) { tab = await chrome.tabs.create({ url: SHOWCASE_URL, active: false }); created = true; await waitTabComplete(tab.id); await new Promise((r) => setTimeout(r, 2500)); }
  try {
    const res = await runInTab(tab.id, pageReadShowcase).catch((e) => ({ success: false, error: e.message }));
    if (res?.success) await setStore({ showcaseCache: { at: Date.now(), items: res.items } });
    return res;
  } finally {
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function removeCore(pids, senderTabId, post) {
  const { showcaseCache = null } = await getStore('showcaseCache');
  const src = new Map((showcaseCache?.items || []).map((x) => [String(x.id), x.sourceFrom ?? 0]));
  progress(senderTabId, `Menghapus ${pids.length} produk dari etalase...`);
  const res = await post('showcase_product/delete', { product_info: pids.map((id) => ({ product_id: String(id), source_from: src.get(String(id)) ?? 0 })) });
  if (res?.code !== 0) return { fatal: true, error: res?.message || 'Gagal menghapus dari etalase.' };
  return { success: true };
}

async function removeFromShowcase(pids, senderTabId) {
  pids = (pids || []).map(String);
  let r = null;
  try { r = await removeCore(pids, senderTabId, shopPost); } catch (e) { r = null; }
  if (!r || r.fatal) {
    r = await withTabPoster((post) => removeCore(pids, senderTabId, post)).catch((e) => ({ fatal: true, error: e.message }));
    if (!r || r.fatal || r.needLogin) return { success: false, needLogin: r?.needLogin, removed: 0, errors: [r?.error || 'Gagal menghapus dari etalase.'] };
  }
  // Pastikan benar-benar hilang (baca ulang etalase)
  const after = await readShowcase().catch(() => null);
  let removed = 0;
  const errors = [];
  if (after?.success) {
    const still = new Set((after.items || []).map((x) => String(x.id)));
    for (const id of pids) { if (still.has(id)) errors.push(`${id}: masih ada di etalase`); else removed++; }
  } else removed = pids.length;
  return { success: removed > 0, removed, errors };
}

// ================================================================ ambil data Kalodata otomatis
// Membuka halaman detail produk Kalodata satu per satu di tab latar belakang (kunjungan dihitung Kalodata
// seperti biasa — jatah tidak diakali). Berhenti bila jatah kunjungan habis / belum login Kalodata.
let kaloAutoWait = null;
let kaloAutoRunning = false;

const hasKaloData = (p) => p && Array.isArray(p.revenue_trend) && p.revenue_trend.length > 1;

// Mode pencarian: buka halaman daftar produk Kalodata (latar belakang), cari tiap produk berdasarkan nama,
// ambil data dari hasil pencarian (PID harus cocok). Tidak membuka halaman detail → tidak memakai jatah kunjungan detail.
let kaloSearchReadyWait = null;
let kaloSearchSeen = null;
let kaloSearchWait = null;

// Jalur halaman detail (terbukti berhasil): 1 produk = 1 kunjungan detail akun Kalodata (jatah TIDAK diakali).
// Berhenti bila jatah habis / belum login. Jalur pencarian dimatikan: Trial juga dibatasi 10 pencarian/hari
// dan tebakan kolom kata kunci bisa menghabiskan beberapa pencarian per produk.
async function autoFetchKalodata(ids, senderTabId) {
  if (kaloAutoRunning) return { success: false, running: true, error: 'Pengambilan data Kalodata sedang berjalan.' };
  const { products = {}, kaloAutoTried = {} } = await getStore(['products', 'kaloAutoTried']);
  const DAY = 24 * 3600 * 1000;
  const todo = [...new Set((ids || []).map(String))].filter((id) => !hasKaloData(products[id]) && !(kaloAutoTried[id] && Date.now() - kaloAutoTried[id] < DAY));
  if (!todo.length) return { success: true, done: 0, total: 0 };
  const { kaloQuota: q0 = null } = await getStore('kaloQuota');
  if (q0 && q0.remain <= 0 && Date.now() - q0.at < 12 * 3600 * 1000) return { success: true, done: 0, total: todo.length, stopReason: 'quota', quota: q0 };
  kaloAutoRunning = true;
  let tab = null;
  let done = 0;
  const errors = [];
  let stopReason = '';
  try {
    tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    for (const [i, id] of todo.entries()) {
      const { kaloQuota = null } = await getStore('kaloQuota');
      if (kaloQuota && kaloQuota.remain <= 0 && Date.now() - kaloQuota.at < 12 * 3600 * 1000) { stopReason = 'quota'; break; }
      progress(senderTabId, `Mengambil data Kalodata ${i + 1}/${todo.length}${kaloQuota ? ` · sisa jatah detail ${kaloQuota.remain}` : ''}...`);
      const res = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timeout: true }), 45000);
        const poll = setInterval(async () => {
          try {
            const t = await chrome.tabs.get(tab.id);
            if (/kalodata\.com\/(login|signin|register)/i.test(t.url || '')) { clearInterval(poll); clearTimeout(timer); resolve({ login: true }); }
          } catch (e) { clearInterval(poll); clearTimeout(timer); resolve({ closed: true }); }
        }, 1500);
        kaloAutoWait = { id, resolve: (r) => { clearInterval(poll); clearTimeout(timer); resolve(r); } };
        chrome.tabs.update(tab.id, { url: `https://www.kalodata.com/product/detail?id=${id}&etnic_auto=1` });
      });
      kaloAutoWait = null;
      kaloAutoTried[id] = Date.now();
      await setStore({ kaloAutoTried });
      if (res.login) { stopReason = 'login'; break; }
      if (res.closed) { stopReason = 'closed'; break; }
      if (res.error) {
        errors.push(`${id}: ${res.error}`);
        if (/limit|quota|times|upgrade|visit|habis/i.test(res.error)) { stopReason = 'quota'; break; }
        continue;
      }
      const { products: now = {} } = await getStore('products');
      if (hasKaloData(now[id])) done++;
      else errors.push(`${id}: data tidak ditemukan di Kalodata`);
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 2500));
    }
  } finally {
    if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    kaloAutoRunning = false;
  }
  const { kaloQuota = null } = await getStore('kaloQuota');
  return { success: true, done, total: todo.length, errors, stopReason, quota: kaloQuota };
}

// (Jalur pencarian lama — tidak dipakai)
async function autoFetchKalodataSearch(ids, senderTabId, items = []) {
  if (kaloAutoRunning) return { success: false, running: true, error: 'Pengambilan data Kalodata sedang berjalan.' };
  const titles = new Map((items || []).map((x) => [String(x.id), x.title || '']));
  const { products = {}, kaloAutoTried = {} } = await getStore(['products', 'kaloAutoTried']);
  const RETRY_MS = 12 * 3600 * 1000;
  const todo = [...new Set((ids || []).map(String))]
    .filter((id) => titles.get(id) && !hasKaloData(products[id]) && !(kaloAutoTried[id] && Date.now() - kaloAutoTried[id] < RETRY_MS));
  if (!todo.length) return { success: true, done: 0, total: 0 };
  kaloAutoRunning = true;
  let tab = null;
  let done = 0;
  const notFound = [];
  let stopReason = '';
  try {
    kaloSearchSeen = null;
    tab = await chrome.tabs.create({ url: 'https://www.kalodata.com/product?etnic_search=1', active: false });
    // Tunggu halaman daftar produk memuat tabelnya sendiri (format pencarian & sesi terbaca)
    const ready = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 45000);
      const poll = setInterval(async () => {
        try {
          const t = await chrome.tabs.get(tab.id);
          if (/kalodata\.com\/(login|signin|register)/i.test(t.url || '')) { clearInterval(poll); clearTimeout(timer); resolve({ login: true }); }
        } catch (e) { clearInterval(poll); clearTimeout(timer); resolve({ closed: true }); }
      }, 1500);
      kaloSearchReadyWait = () => { clearInterval(poll); clearTimeout(timer); resolve({ ok: true }); };
    });
    kaloSearchReadyWait = null;
    if (ready.login) { stopReason = 'login'; return { success: false, done, total: todo.length, stopReason }; }
    if (!ready.ok) {
      let finalUrl = '';
      try { finalUrl = (await chrome.tabs.get(tab.id)).url || ''; } catch (e) {}
      const seen = kaloSearchSeen ? `pencarian terlihat: ${kaloSearchSeen.info.method} ${kaloSearchSeen.info.path}${kaloSearchSeen.info.hasBody ? '' : ' (tanpa body)'}` : 'tidak ada permintaan pencarian terlihat';
      stopReason = 'notready';
      return { success: false, done, total: todo.length, stopReason, error: `Halaman Product Kalodata tidak termuat · ${seen} · alamat: ${finalUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)}` };
    }

    for (const [i, id] of todo.entries()) {
      progress(senderTabId, `Mencari "${(titles.get(id) || '').slice(0, 40)}" di Kalodata (${i + 1}/${todo.length})...`);
      const res = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timeout: true }), 30000);
        kaloSearchWait = { id, resolve: (r) => { clearTimeout(timer); resolve(r); } };
        chrome.tabs.sendMessage(tab.id, { type: 'etnicSearch', id, title: titles.get(id) }).catch(() => { clearTimeout(timer); resolve({ error: 'tab Kalodata tidak merespons' }); });
      });
      kaloSearchWait = null;
      kaloAutoTried[id] = Date.now();
      await setStore({ kaloAutoTried });
      if (res.error && /jatah pencarian/i.test(res.error)) { stopReason = 'quota'; break; }
      if (res.error && /dikenali|terdeteksi|merespons|tidak ditemukan\./i.test(res.error)) { stopReason = 'error'; notFound.push(`${id}: ${res.error}`); break; }
      const { products: now = {} } = await getStore('products');
      if (res.found && hasKaloData(now[id])) done++;
      else notFound.push(id);
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1500)); // jeda wajar antar pencarian
    }
  } finally {
    if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    kaloAutoRunning = false;
  }
  return { success: true, done, total: todo.length, notFound, errors: notFound, stopReason };
}

// ---------------------------------------------------------------- pesan
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const senderTabId = sender?.tab?.id;
  const p = msg?.payload || {};
  const run = async () => {
    switch (msg?.action) {
      case 'ping': return { success: true, version: chrome.runtime.getManifest().version };
      case 'getInstallId': return { success: true, installId: await getInstallId() };
      case 'saveKalodataProducts': return saveKalodataProducts(msg.products);
      case 'getProducts': {
        const { products = {}, showcaseCache = null } = await getStore(['products', 'showcaseCache']);
        return { success: true, products: Object.values(products), showcaseIds: (showcaseCache?.items || []).map((x) => x.id), showcaseAt: showcaseCache?.at || 0 };
      }
      case 'deleteProducts': {
        const { products = {} } = await getStore('products');
        (p.ids || []).forEach((id) => delete products[id]);
        await setStore({ products });
        return { success: true, total: Object.keys(products).length };
      }
      case 'clearProducts': await setStore({ products: {} }); return { success: true };
      case 'getShowcaseCache': {
        const { showcaseCache = null } = await getStore('showcaseCache');
        return { success: true, items: showcaseCache?.items || [], at: showcaseCache?.at || 0 };
      }
      case 'importKalodataProducts': return saveKalodataProducts(p.products || []);
      case 'autoFetchKalodata': return autoFetchKalodataSearch(p.ids, senderTabId, p.items);
      case 'kaloSearchReady': if (kaloSearchReadyWait) kaloSearchReadyWait(); return { success: true };
      case 'kaloSearchSeen': kaloSearchSeen = { info: msg.info || {}, url: msg.url, at: Date.now() }; return { success: true };
      case 'kaloSearchDone': if (kaloSearchWait && String(kaloSearchWait.id) === String(msg.id)) kaloSearchWait.resolve(msg); return { success: true };
      case 'kaloAutoDone': if (kaloAutoWait && String(kaloAutoWait.id) === String(msg.id)) kaloAutoWait.resolve({ ok: !msg.error, error: msg.error }); return { success: true };
      case 'kaloQuota': await setStore({ kaloQuota: { ...msg.quota, at: Date.now() } }); return { success: true };
      case 'getKaloQuota': { const { kaloQuota = null } = await getStore('kaloQuota'); return { success: true, quota: kaloQuota }; }
      case 'getTikTokAccount': return getTikTokAccount(p);
      case 'openTikTokLogin': return openTikTokLogin();
      case 'getShowcase': return readShowcase();
      case 'addToShowcase': return addToShowcase(p.ids, senderTabId);
      case 'removeFromShowcase': return removeFromShowcase(p.ids, senderTabId);
      default: return { success: false, error: 'Aksi tidak dikenal' };
    }
  };
  run().then(sendResponse).catch((e) => sendResponse({ success: false, error: e.message }));
  return true;
});

// Saat ekstensi dipasang / diperbarui: hapus penanda "sudah dicoba" (agar produk dicoba ulang dengan versi baru)
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.set({ kaloAutoTried: {} }); });
