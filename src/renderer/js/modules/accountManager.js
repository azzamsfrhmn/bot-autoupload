/**
 * src/renderer/js/modules/accountManager.js
 * Halaman Kelola Akun: dikelompokkan per platform (TikTok, Facebook, Instagram).
 * Facebook dipakai sebagai jalur login Instagram (Instagram menolak login dari browser baru,
 * tetapi menerima "Log in with Facebook" dari Chrome yang sudah login Facebook).
 */
import { updateSidebarProfile } from './profileManager.js';

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const ICONS = {
  tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.6 6.7a4.8 4.8 0 0 1-3.8-4.2V2h-3.4v13.4a2.9 2.9 0 1 1-2-2.7V9.2a6.3 6.3 0 1 0 5.4 6.2V8.6a8.2 8.2 0 0 0 3.8 1.2z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  shopee: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a4.5 4.5 0 0 0-4.47 4H4.2a1 1 0 0 0-1 1.07l.9 13.1A2 2 0 0 0 6.1 22h11.8a2 2 0 0 0 2-1.83l.9-13.1a1 1 0 0 0-1-1.07h-3.33A4.5 4.5 0 0 0 12 2zm0 1.8A2.7 2.7 0 0 1 14.65 6h-5.3A2.7 2.7 0 0 1 12 3.8zm.15 5.2c1.6 0 2.6.7 2.9 1.05l-.8 1.1c-.4-.33-1.15-.75-2.1-.75-.9 0-1.4.4-1.4.9 0 .6.7.85 1.75 1.2 1.5.5 2.85 1.1 2.85 2.8 0 1.6-1.35 2.8-3.4 2.8-1.6 0-2.85-.7-3.4-1.3l.85-1.15c.6.55 1.5 1.05 2.55 1.05 1.05 0 1.65-.5 1.65-1.15 0-.75-.75-1-1.85-1.4-1.4-.45-2.7-1.05-2.7-2.6 0-1.45 1.3-2.55 3.1-2.55z"/></svg>'
};
const COLORS = { tiktok: '#ff2d55', facebook: '#1877f2', instagram: '#d946ef', shopee: '#ee4d2d', youtube: '#ff0000' };
ICONS.youtube = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>';
const TRASH = '<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

function platformOf(acc) {
  const p = String(acc.platform || '').toLowerCase();
  const id = String(acc.id || '').toLowerCase();
  if (p === 'facebook' || id.startsWith('fbpage_')) return 'facebook';
  if (p === 'shopee' || id.startsWith('shopee_')) return 'shopee';
  if (p === 'youtube' || id.startsWith('yt_')) return 'youtube';
  return p === 'tiktok' || id.startsWith('tiktok_') || id.startsWith('tt_') ? 'tiktok' : 'instagram';
}

function avatarHtml(src, label) {
  return `<div class="acc-avatar">
      ${src ? `<img src="${esc(src)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span>${esc(String(label || '?').charAt(0).toUpperCase())}</span>
    </div>`;
}

function showNotice(message, kind = 'info') {
  let el = document.getElementById('igLoginNotice');
  const host = document.querySelector('#viewAccounts .accounts-page-head');
  if (!el && host) {
    el = document.createElement('div');
    el.id = 'igLoginNotice';
    host.appendChild(el);
  }
  if (!el) return;
  el.className = `acc-notice acc-notice-${kind}`;
  el.textContent = message;
}

// Pilih akun Facebook untuk login Instagram (bila lebih dari satu)
function chooseFacebook(fbList) {
  return new Promise((resolve) => {
    document.getElementById('fbChooseDialog')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'fbChooseDialog';
    wrap.className = 'acc-modal';
    wrap.innerHTML = `
      <div class="acc-modal-box">
        <div class="acc-modal-title">Login Instagram</div>
        <div class="acc-modal-note">Login langsung dengan username &amp; sandi Instagram, atau lewat akun Facebook yang terhubung.</div>
        <div class="acc-fb-choices">
            <button type="button" class="acc-fb-choice" data-id="direct">
              <span style="font-size:20px;width:32px;text-align:center">🔑</span><span>Login langsung (username &amp; sandi)</span>
            </button>
          ${fbList.map((fb) => `
            <button type="button" class="acc-fb-choice" data-id="${esc(fb.id)}">
              ${avatarHtml(fb.avatar, fb.name)}<span>${esc(fb.name)}</span>
            </button>`).join('')}
        </div>
        <div class="acc-modal-actions"><button type="button" class="acc-add" id="fbChooseCancel">Batal</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
    wrap.querySelector('#fbChooseCancel').addEventListener('click', () => done(null));
    wrap.querySelectorAll('.acc-fb-choice').forEach((b) => b.addEventListener('click', () => done(b.getAttribute('data-id'))));
  });
}

// Panduan "Hubungkan HP Shopee": akun dibaca langsung dari app Shopee di HP (bukan login Chrome).
const SHOPEE_STEPS = [
  ['usb', 'HP terhubung'],
  ['shopee', 'App Shopee terpasang & login'],
  ['tapper-install', 'Tap Server terpasang'],
  ['tapper-enable', 'Tap Server aktif'],
  ['done', 'Akun Shopee terbaca']
];

// Gaya popup (disisipkan sekali)
function ensureShopeeWizardStyle() {
  if (document.getElementById('shpwStyle')) return;
  const st = document.createElement('style');
  st.id = 'shpwStyle';
  st.textContent = `
  .shpw-box{width:540px;max-width:calc(100vw - 32px);max-height:88vh;display:flex;flex-direction:column;padding:0!important;overflow:hidden}
  .shpw-head{display:flex;gap:12px;align-items:flex-start;padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07)}
  .shpw-head-icon{width:38px;height:38px;border-radius:10px;background:#ee4d2d;display:flex;align-items:center;justify-content:center;flex:0 0 38px;font-size:19px}
  .shpw-title{font-size:16px;font-weight:700;color:#fff}
  .shpw-sub{font-size:12px;opacity:.65;margin-top:3px;line-height:1.5}
  .shpw-x{margin-left:auto;background:none;border:0;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;padding:4px 7px;border-radius:6px}
  .shpw-x:hover{background:rgba(255,255,255,.06);color:#fff}
  .shpw-body{overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px}
  .shpw-tabs{display:flex;gap:4px;padding:4px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
  .shpw-tab{flex:1;border:0;background:none;color:#cbd5e1;padding:9px 10px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer}
  .shpw-tab.on{background:rgba(53,178,159,.16);color:#5eead4;box-shadow:inset 0 0 0 1px rgba(53,178,159,.45)}
  .shpw-step{display:flex;gap:12px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
  .shpw-num{width:24px;height:24px;border-radius:50%;background:rgba(53,178,159,.18);color:#5eead4;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 24px;margin-top:1px}
  .shpw-step-t{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
  .shpw-step-d{font-size:12px;line-height:1.55;color:#cbd5e1}
  .shpw-qrrow{display:flex;gap:14px;align-items:center;margin-top:8px}
  .shpw-qr{width:118px;height:118px;flex:0 0 118px;background:#fff;border-radius:8px;padding:5px;display:flex;align-items:center;justify-content:center;color:#111;font-size:11px;box-sizing:border-box}
  .shpw-qr svg{width:100%;height:100%}
  .shpw-url{font-size:11px;opacity:.6;word-break:break-all;margin-top:6px}
  .shpw-btn{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer}
  .shpw-btn:hover{border-color:rgba(53,178,159,.6)}
  .shpw-btn:disabled{opacity:.55;cursor:default}
  .shpw-phone{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);margin-top:8px}
  .shpw-phone input{width:96px;height:32px;font-size:13px;text-align:center;letter-spacing:2px}
  .shpw-note{font-size:11.5px;opacity:.65;line-height:1.5}
  .shpw-status{display:flex;flex-wrap:wrap;gap:6px}
  .shpw-chip{font-size:11px;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#94a3b8}
  .shpw-chip.ok{color:#6ee7b7;border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
  .shpw-chip.now{color:#fdba74;border-color:rgba(251,146,60,.45);background:rgba(251,146,60,.08);font-weight:700}
  .shpw-foot{display:flex;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.12)}
  .shpw-msg{flex:1;font-size:12px;line-height:1.45;color:#cbd5e1;min-height:17px}
  `;
  document.head.appendChild(st);
}

function shopeeConnectWizard() {
  return new Promise((resolve) => {
    ensureShopeeWizardStyle();
    document.getElementById('shopeeConnectDialog')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'shopeeConnectDialog';
    wrap.className = 'acc-modal';
    wrap.innerHTML = `
      <div class="acc-modal-box shpw-box">
        <div class="shpw-head">
          <div class="shpw-head-icon">🛒</div>
          <div>
            <div class="shpw-title">Hubungkan HP Shopee</div>
            <div class="shpw-sub">Posting Shopee Video berjalan lewat app Shopee di HP Android. Akun dibaca langsung dari HP — 1 HP = 1 akun.</div>
          </div>
          <button type="button" class="shpw-x" id="shpX" title="Tutup">✕</button>
        </div>
        <div class="shpw-body">
          <div class="shpw-tabs">
            <button type="button" class="shpw-tab shp-mode" data-mode="wifi">📶 Lewat WiFi (tanpa kabel)</button>
            <button type="button" class="shpw-tab shp-mode" data-mode="usb">🔌 Lewat kabel USB</button>
          </div>
          <div id="shpConnBody" style="display:flex;flex-direction:column;gap:10px"></div>
          <div>
            <div class="shpw-note" style="margin-bottom:6px">Status pemeriksaan</div>
            <div id="shpSteps" class="shpw-status"></div>
          </div>
        </div>
        <div class="shpw-foot">
          <div id="shpMsg" class="shpw-msg">Ikuti langkah di atas, lalu klik <b>Mulai</b>.</div>
          <button type="button" class="acc-add" id="shpCancel" style="margin:0">Tutup</button>
          <button type="button" class="acc-login" id="shpGo" style="margin:0">Mulai</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const stepsEl = wrap.querySelector('#shpSteps');
    const msgEl = wrap.querySelector('#shpMsg');
    const go = wrap.querySelector('#shpGo');
    const paint = (failKey, done) => {
      const failIdx = done ? SHOPEE_STEPS.length : SHOPEE_STEPS.findIndex(([k]) => k === failKey);
      stepsEl.innerHTML = SHOPEE_STEPS.map(([, label], i) => {
        const cls = done || i < failIdx ? 'ok' : i === failIdx ? 'now' : '';
        const icon = cls === 'ok' ? '✓ ' : cls === 'now' ? '● ' : '';
        return `<span class="shpw-chip ${cls}">${icon}${esc(label)}</span>`;
      }).join('');
    };
    paint('usb', false);
    let connected = false;
    let pairingActive = false;
    const api = window.electronAPI || {};
    const close = () => {
      if (pairingActive) api.shopeeWifiPairCancel?.();
      wrap.remove(); resolve(connected);
    };
    wrap.querySelector('#shpCancel').addEventListener('click', close);
    wrap.querySelector('#shpX').addEventListener('click', close);

    // ---- Pilihan cara menghubungkan HP ----
    const body = wrap.querySelector('#shpConnBody');
    const step = (n, title, html) => `
      <div class="shpw-step"><div class="shpw-num">${n}</div>
        <div style="flex:1;min-width:0"><div class="shpw-step-t">${title}</div><div class="shpw-step-d">${html}</div></div>
      </div>`;
    const setMode = async (mode) => {
      wrap.querySelectorAll('.shp-mode').forEach((b) => b.classList.toggle('on', b.getAttribute('data-mode') === mode));
      if (pairingActive) { api.shopeeWifiPairCancel?.(); pairingActive = false; }
      if (mode === 'usb') {
        body.innerHTML = step(1, 'Colok HP lewat kabel USB',
          'Aktifkan <b>USB debugging</b> di Opsi pengembang, colok kabel, lalu ketuk <b>Izinkan</b> di HP.')
          + step(2, 'Klik Mulai', 'Setelah tersambung, aplikasi otomatis beralih ke WiFi — kabel boleh dicabut.');
        return;
      }
      // ---- Lewat WiFi: Tap Server (TANPA kabel, TANPA Opsi pengembang) ----
      body.innerHTML =
        step(1, 'Pasang Tap Server di HP', `
          <div class="shpw-qrrow">
            <div id="shpApkQr" class="shpw-qr">Membuat QR...</div>
            <div>Scan QR pakai <b>kamera HP</b> → unduh → pasang.<br><span style="opacity:.7">Sudah terpasang versi 2.0.4? Lewati langkah ini.</span>
              <div id="shpApkUrl" class="shpw-url"></div></div>
          </div>`)
        + step(2, 'Aktifkan Tap Server',
          `Buka app <b>Tap Server</b> lalu:
          <ol style="margin:6px 0 0;padding-left:18px;line-height:1.7">
            <li>Ketuk <b>Buka Aksesibilitas</b> → aktifkan Tap Server.</li>
            <li>Ketuk <b>Izinkan SEMUA izin</b> → <b>Izin lainnya</b> → aktifkan <b>semuanya</b>: Pintasan Layar utama, Tampil di Layar kunci, Menampilkan jendela pop-up saat berjalan di latar belakang, Notifikasi permanen.</li>
            <li>Ketuk <b>Buka Setelan Aplikasi</b> → <b>Mulai otomatis</b>: ON, <b>Penghemat baterai</b>: Tidak ada batasan.</li>
          </ol>
          <div style="margin-top:6px">Layar Tap Server akan menampilkan <b>kode pasangan 6 digit</b>.</div>`)
        + step(3, 'Masukkan kode dari Tap Server', `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px">
            <input class="input-box" id="shpCode" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="off"
              style="width:150px;height:42px;font-size:22px;font-weight:700;text-align:center;letter-spacing:6px">
            <button type="button" class="shpw-btn" id="shpPairBtn" style="height:42px;padding:0 18px">Hubungkan</button>
          </div>
          <div class="shpw-note" style="margin-top:6px">Biarkan layar Tap Server tetap terbuka. HP & PC harus di WiFi yang sama.</div>
          <div id="shpAddrRow" style="display:none;margin-top:8px">
            <div class="shpw-note" style="margin-bottom:4px">Alamat HP (tertulis di layar Tap Server, contoh 192.168.1.5):</div>
            <input class="input-box" id="shpAddr" placeholder="192.168.x.x" style="width:200px;height:34px;font-size:13px">
          </div>
          <div id="shpFound"></div>`);
      // QR unduh APK
      api.shopeeTapApkLink?.().then((r) => {
        const q = body.querySelector('#shpApkQr');
        if (!q) return;
        if (r && r.success) {
          q.innerHTML = r.svg;
          body.querySelector('#shpApkUrl').innerHTML = esc(r.url);
        } else q.textContent = r?.error || 'QR gagal dibuat';
      }).catch(() => {});

      // Cukup kode 6 digit: PC mencari sendiri HP mana yang cocok dengan kode itu.
      const foundEl = body.querySelector('#shpFound');
      const codeEl = body.querySelector('#shpCode');
      const addrRow = body.querySelector('#shpAddrRow');
      const addrEl = body.querySelector('#shpAddr');
      const pairBtn = body.querySelector('#shpPairBtn');
      codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6); });
      const doPair = async () => {
        const code = codeEl.value.trim();
        if (code.length !== 6) { msgEl.textContent = '❌ Masukkan 6 angka kode dari layar Tap Server.'; codeEl.focus(); return; }
        pairBtn.disabled = true; codeEl.disabled = true; pairBtn.textContent = 'Mencari HP...';
        foundEl.innerHTML = '';
        msgEl.textContent = 'Mencari HP di WiFi & mencocokkan kode (±10 detik)...';
        const addr = addrRow.style.display === 'none' ? '' : addrEl.value.trim();
        const r = await api.shopeeTapPairCode?.(code, addr).catch((e) => ({ success: false, error: e.message }));
        pairBtn.disabled = false; codeEl.disabled = false; pairBtn.textContent = 'Hubungkan';
        if (r && r.success) {
          foundEl.innerHTML = `<div class="shpw-phone" style="border-color:rgba(52,211,153,.4)">✅ HP <b>${esc(r.model || '')}</b> terhubung tanpa kabel.</div>`;
          go.click();                                   // lanjut otomatis: Shopee, Tap Server, baca akun
          return;
        }
        msgEl.textContent = `❌ ${r?.error || 'Gagal memasangkan.'}`;
        if (/tidak ditemukan|tidak menjawab/i.test(r?.error || '')) addrRow.style.display = '';   // cadangan: isi alamat HP
      };
      pairBtn.addEventListener('click', doPair);
      codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair(); });
      addrEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair(); });
    };
    wrap.querySelectorAll('.shp-mode').forEach((b) => b.addEventListener('click', () => setMode(b.getAttribute('data-mode'))));
    setMode('wifi');

    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Memeriksa...';
      msgEl.textContent = 'Memeriksa HP... membaca akun ±30 detik (HP akan membuka Shopee sendiri).';
      let r;
      try { r = await window.electronAPI.shopeeHpConnect(); }
      catch (e) { r = { ok: false, step: 'error', message: e.message }; }
      if (r && r.ok) {
        connected = true;
        paint('', true);
        msgEl.innerHTML = `✅ ${esc(r.message)}`;
        go.textContent = 'Selesai';
        go.disabled = false;
        go.onclick = close;
        return;
      }
      paint(r?.step === 'error' ? 'done' : (r?.step || 'usb'), false);
      msgEl.textContent = r?.message || 'Gagal memeriksa HP.';
      go.textContent = 'Cek Lagi';
      go.disabled = false;
    });
  });
}

async function addAccount(platform, fbList = [], viaFb = '') {
  const api = window.electronAPI || {};
  let res = null;
  if (platform === 'tiktok') {
    const newAccId = `tiktok_${Date.now()}`;
    if (typeof api.loginTikTokAccount === 'function') res = await api.loginTikTokAccount(newAccId);
    else api.addNewTiktokAccount?.(newAccId);
    if (res && !res.success && res.error) alert('Gagal membuka Chrome: ' + res.error);
    return;
  }
  if (platform === 'youtube') {
    res = await api.loginYoutubeAccount?.();
    if (res && !res.success && res.error) showNotice(res.error, 'error');
    return;
  }
  if (platform === 'shopee') {
    if (await shopeeConnectWizard()) document.dispatchEvent(new CustomEvent('accounts-changed'));
    return;
  } else if (platform === 'facebook') {
    res = await api.loginFacebookAccount?.();
  } else {
    const fbId = viaFb || (fbList.length === 0 ? 'direct' : await chooseFacebook(fbList));
    if (!fbId) return;
    res = await api.loginInstagramAccount?.(fbId);
  }
  if (res && !res.success && res.error) showNotice(res.error, 'error');
}

export function initAccountManager() {
  const container = document.getElementById('accountsListContainer');

  async function renderAccounts() {
    if (!container || !window.electronAPI?.getAllAccounts) return;

    try {
      const regData = await window.electronAPI.getAllAccounts();
      const allAccounts = Array.isArray(regData) ? regData : (regData?.accounts || []);
      const activeAccountId = regData?.activeAccountId || allAccounts[0]?.id || '';
      const fbList = (await window.electronAPI.getFacebookAccounts?.().catch(() => [])) || [];

      const postingCard = (acc) => {
        const isActive = acc.id === activeAccountId;
        const username = String(acc.username || acc.name || acc.id || '').replace(/^@/, '');
        const avatarSrc = acc.avatar || acc.profilePicUrl || acc.avatarUrl || acc.profile_pic_url || '';
        const viaFb = acc.facebookId ? fbList.find((f) => f.id === acc.facebookId) : null;
        return `
          <div class="acc-card${isActive ? ' is-active' : ''}">
            <div class="acc-card-top">
              ${avatarHtml(avatarSrc, username)}
              <div class="acc-meta">
                <div class="acc-name">${platformOf(acc) === 'facebook' ? '' : platformOf(acc) === 'youtube' ? esc(acc.name || username) : '@' + esc(username)}</div>
                <div class="acc-status"><span class="acc-dot"></span>${platformOf(acc) === 'youtube'
                  ? `${acc.subscribersText ? esc(acc.subscribersText) : 'Channel YouTube'}${isActive ? ' · Aktif' : ''}`
                  : platformOf(acc) === 'shopee'
                  ? (acc.shopeeSerialNo
                      ? `📱 ${esc(String(acc.phoneModel || 'HP').replace(/_/g, ' '))}${acc.followers ? ` · ${esc(acc.followers)} pengikut` : ''}${isActive ? ' · Aktif' : ''}`
                      : '⚠️ Belum terhubung ke HP — klik "+ Hubungkan HP Shopee"')
                  : (isActive ? 'Sesi Aktif Saat Ini' : (platformOf(acc) === 'facebook' ? 'Facebook Page · Reels' : 'Sesi Tersimpan'))}${viaFb ? ` · via ${esc(viaFb.name)}` : ''}</div>
              </div>
              ${isActive ? '<span class="acc-badge">Aktif</span>' : ''}
              <button type="button" class="acc-delete btn-delete-account" data-id="${esc(acc.id)}" data-username="${esc(username)}" title="Hapus Akun Ini">${TRASH}</button>
            </div>
            <button type="button" class="acc-use btn-switch-account" data-id="${esc(acc.id)}" ${isActive ? 'disabled' : ''}>
              ${isActive ? '✓ Sedang Digunakan' : 'Gunakan Akun Ini'}
            </button>
          </div>`;
      };

      // Kartu kecil Page Facebook (di bawah akun Facebook pengelolanya)
      const pageMiniCard = (pg) => {
        const isActive = pg.id === activeAccountId;
        return `
          <div class="fb-page-card${isActive ? ' is-active' : ''}">
            ${avatarHtml(pg.avatar || pg.profilePicUrl, pg.username)}
            <div class="acc-meta">
              <div class="acc-name">${esc(pg.username)}</div>
              <div class="acc-status"><span class="acc-dot"></span>${isActive ? 'Aktif' : 'Page · Reels'}</div>
            </div>
            <button type="button" class="fb-page-use btn-switch-account" data-id="${esc(pg.id)}" ${isActive ? 'disabled' : ''}>${isActive ? '✓ Aktif' : 'Gunakan'}</button>
            <button type="button" class="acc-delete btn-delete-account" data-id="${esc(pg.id)}" data-username="${esc(pg.username)}" title="Hapus Page dari aplikasi">${TRASH}</button>
          </div>`;
      };

      // Satu blok per akun Facebook utama: kartu akun di atas, Page-nya di bawah
      const fbCluster = (fb) => {
        const linked = instagram.filter((a) => a.facebookId === fb.id);
        const pages = fbPages.filter((p) => p.facebookId === fb.id);
        const ig = linked.find((a) => a.id === activeAccountId) || linked[0];
        const igName = ig ? String(ig.username || '').replace(/^@/, '') : '';
        const igBtn = ig
          ? `<button type="button" class="fb-head-btn btn-switch-account" data-id="${esc(ig.id)}" ${ig.id === activeAccountId ? 'disabled' : ''}>
               ${ICONS.instagram} ${ig.id === activeAccountId ? `✓ @${esc(igName)}` : `Gunakan @${esc(igName)}`}
             </button>`
          : `<button type="button" class="fb-head-btn btn-add-platform" data-platform="instagram" data-fb="${esc(fb.id)}">${ICONS.instagram} Login Instagram</button>`;
        return `
          <div class="fb-cluster">
            <div class="fb-head">
              ${avatarHtml(fb.avatar, fb.name)}
              <div class="acc-meta">
                <div class="acc-name">${esc(fb.name)}</div>
                <div class="acc-status"><span class="acc-dot acc-dot-fb"></span>Akun utama Facebook${linked.length ? ` · Instagram: ${linked.map((a) => '@' + esc(String(a.username || '').replace(/^@/, ''))).join(', ')}` : ''}</div>
              </div>
              <div class="fb-head-actions">
                ${igBtn}
                <button type="button" class="fb-icon-btn btn-sync-pages" data-id="${esc(fb.id)}" title="Sinkron daftar Page">⟳</button>
                <button type="button" class="acc-delete btn-delete-fb" data-id="${esc(fb.id)}" data-name="${esc(fb.name)}" title="Hapus Akun Facebook">${TRASH}</button>
              </div>
            </div>
            <div class="fb-pages">
              <div class="fb-pages-label">Page dikelola (${pages.length})${ig ? ` · <button type="button" class="acc-link-inline btn-add-platform" data-platform="instagram" data-fb="${esc(fb.id)}">+ Instagram lain</button>` : ''}</div>
              ${pages.length
                ? `<div class="fb-page-grid">${pages.map(pageMiniCard).join('')}</div>`
                : '<div class="fb-pages-empty">Belum ada Page. Klik ⟳ untuk sinkron daftar Page akun ini.</div>'}
            </div>
          </div>`;
      };

      const group = (key, name, items, cardFn, empty, addLabel) => `
        <section class="acc-group">
          <div class="acc-group-head">
            <div class="acc-group-title">
              <span class="acc-group-icon" style="color:${COLORS[key]}">${ICONS[key]}</span>
              <span>${name}</span>
              <span class="acc-count">${items.length} akun</span>
            </div>
            ${items.length > 0 && addLabel ? `<div class="acc-head-actions"><button type="button" class="acc-add btn-add-platform" data-platform="${key}">${addLabel}</button></div>` : ''}
          </div>
          ${items.length > 0 ? `<div class="acc-grid">${items.map(cardFn).join('')}</div>` : `
            <div class="acc-empty">
              <div class="acc-empty-icon" style="color:${COLORS[key]}">${ICONS[key]}</div>
              <div class="acc-empty-title">${empty.title}</div>
              <div class="acc-empty-sub">${empty.sub}</div>
              <button type="button" class="acc-login btn-add-platform" data-platform="${key}" ${empty.disabled ? 'disabled' : ''}>${empty.button}</button>
            </div>`}
        </section>`;

      const tiktok = allAccounts.filter((a) => platformOf(a) === 'tiktok');
      const instagram = allAccounts.filter((a) => platformOf(a) === 'instagram');
      const fbPages = allAccounts.filter((a) => platformOf(a) === 'facebook');
      const shopee = allAccounts.filter((a) => platformOf(a) === 'shopee');
      const youtube = allAccounts.filter((a) => platformOf(a) === 'youtube');

      container.innerHTML = [
        group('tiktok', 'TikTok', tiktok, postingCard, {
          title: 'Belum ada akun TikTok', sub: 'Silakan login untuk mulai menjadwalkan postingan ke TikTok. Login lewat Chrome resmi TikTok.', button: 'Login TikTok'
        }, '+ Tambah Akun TikTok'),
        fbList.length === 0
          ? group('facebook', 'Facebook', fbList, fbCluster, {
              title: 'Belum ada akun Facebook', sub: 'Login Facebook untuk posting Reels ke Facebook Page. (Opsional untuk Instagram — Instagram bisa login langsung.)', button: 'Login Facebook'
            }, '')
          : `<section class="acc-group">
              <div class="acc-group-head">
                <div class="acc-group-title">
                  <span class="acc-group-icon" style="color:${COLORS.facebook}">${ICONS.facebook}</span>
                  <span>Facebook</span>
                  <span class="acc-count">${fbList.length} akun · ${fbPages.length} Page</span>
                </div>
                <div class="acc-head-actions"><button type="button" class="acc-add btn-add-platform" data-platform="facebook">+ Tambah Akun Facebook</button></div>
              </div>
              <div class="fb-clusters">${fbList.map(fbCluster).join('')}</div>
            </section>`,
        group('instagram', 'Instagram', instagram, postingCard, {
          title: 'Belum ada akun Instagram',
          sub: 'Login langsung dengan username & sandi Instagram di Chrome' + (fbList.length ? ', atau lewat akun Facebook yang sudah tersimpan.' : '.'),
          button: 'Login Instagram'
        }, '+ Tambah Akun Instagram'),
        group('shopee', 'Shopee', shopee, postingCard, {
          title: 'Belum ada akun Shopee', sub: 'Hubungkan HP Android yang sudah login app Shopee. Akun dibaca langsung dari HP — 1 HP = 1 akun Shopee Video.', button: 'Hubungkan HP Shopee'
        }, '+ Hubungkan HP Shopee'),
        group('youtube', 'YouTube', youtube, postingCard, {
          title: 'Belum ada channel YouTube', sub: 'Login akun Google pemilik channel lewat Chrome. Upload Shorts & video biasa lewat YouTube Studio, bisa dijadwalkan.', button: 'Login YouTube'
        }, '+ Tambah Channel YouTube')
      ].join('');

      container.querySelectorAll('.btn-switch-account').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (id === activeAccountId) return;
          btn.textContent = 'Mengalihkan Sesi...';
          btn.disabled = true;
          const res = await window.electronAPI.switchActiveAccount(id).catch(() => null);
          if (res && res.success) {
            window.location.reload();
          } else {
            btn.disabled = false;
            btn.textContent = 'Gunakan Akun Ini';
            alert('Gagal mengganti akun: ' + (res?.error || 'tidak diketahui'));
          }
        });
      });

      container.querySelectorAll('.btn-delete-account').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const user = btn.getAttribute('data-username');
          if (!confirm(`Hapus akun @${user} dari aplikasi beserta sesinya?`)) return;
          const res = await window.electronAPI.deleteAccount(id);
          if (res && res.success) {
            if (id === activeAccountId) { window.location.reload(); return; }
            await renderAccounts();
            await updateSidebarProfile();
          }
        });
      });

      container.querySelectorAll('.btn-delete-fb').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Hapus akun Facebook ${btn.getAttribute('data-name')} beserta profil Chrome-nya? Akun Instagram yang sudah tersimpan tetap ada.`)) return;
          await window.electronAPI.deleteFacebookAccount?.(btn.getAttribute('data-id'));
          await renderAccounts();
        });
      });

      container.querySelectorAll('.btn-sync-pages').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Menyinkronkan Page...';
          const res = await window.electronAPI.syncFacebookPages?.(btn.getAttribute('data-id')).catch((e) => ({ success: false, error: e.message }));
          showNotice(res?.success ? `${res.count} Page Facebook tersinkron.` : `Gagal sinkron Page: ${res?.error || 'tidak diketahui'}`, res?.success ? 'success' : 'error');
          await renderAccounts();
        });
      });

      container.querySelectorAll('.btn-add-platform').forEach((btn) => {
        btn.addEventListener('click', () => {
          const platform = btn.getAttribute('data-platform');
          const fbId = btn.getAttribute('data-fb');
          addAccount(platform, fbId ? fbList.filter((f) => f.id === fbId) : fbList, fbId || '');
        });
      });
    } catch (err) {
      console.error('[AccountManager] Gagal merender akun:', err);
    }
  }

  window.electronAPI?.onInstagramLoginStatus?.((s) => {
    if (!s) return;
    showNotice(s.message || '', s.status === 'success' ? 'success' : s.status === 'error' ? 'error' : 'info');
    if (s.status === 'success') renderAccounts();
  });

  window.addEventListener('load-accounts-list', renderAccounts);
  window.addEventListener('open-accounts-view', renderAccounts);
  window.electronAPI?.onAccountsUpdated?.(() => { renderAccounts(); updateSidebarProfile(); });
  window.electronAPI?.onProfileUpdated?.(() => { renderAccounts(); updateSidebarProfile(); });

  renderAccounts();
}
