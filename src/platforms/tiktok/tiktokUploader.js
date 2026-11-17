/**
 * src/platforms/tiktok/tiktokUploader.js
 * Pure Raw CDP TikTok Studio Web Uploader + Keranjang Kuning PID + Audio Editor + Auto Post
 * (Anti-Deteksi Bot: Menggunakan Browser Google Chrome Asli via CDP)
 * 
 * Update:
 * - Edit cover otomatis dengan memilih frame angle terbaik (55% - 85% timeline)
 * - Pemilihan lagu rekomendasi acak di panel Sounds melalui tombol bulat (+)
 * - Kondisional Volume: JJ musik -60 dB, Daster & Sensasi musik -25 dB (suara asli tetap), POV -30 dB
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// Electron opsional: di worker upload server (Node biasa) clipboard & notifikasi desktop tidak tersedia
let electronApi = null;
try {
  const loaded = require('electron');
  if (loaded && typeof loaded === 'object') electronApi = loaded;
} catch (e) {}
const clipboard = electronApi?.clipboard || null;
const Notification = electronApi?.Notification || null;
const { getChromePath, getTikTokProfileDir } = require('./tiktokSessionManager');
const { generateProductLinkTitle } = require('../../services/aiCaption');
// Jeda, batas tunggu & flag Chrome menyesuaikan spek perangkat (Mode Perangkat Ringan)
const { scaleMs, chromeLiteArgs } = require('../../core/perfProfile');

// Kata kunci pencarian musik di panel Sounds editor TikTok (lagu dipilih acak dari hasilnya)
const MUSIC_SEARCH_KEYWORD = 'JJ';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

class TikTokCDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const WS = global.WebSocket || require('ws');
      this.ws = new WS(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => {
        for (const [, p] of this.pending) p.reject(new Error('Koneksi CDP terputus'));
        this.pending.clear();
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (data.id && this.pending.has(data.id)) {
            const { resolve: res, reject: rej } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) rej(new Error(data.error.message));
            else res(data.result);
          }
        } catch (e) {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (e) {}
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }).catch(() => null);
    return res?.result?.value;
  }

  async clickSelector(selector, textMatch = null) {
    return await this.eval(`
      (() => {
        const els = Array.from(document.querySelectorAll('${selector}'));
        const target = els.find(el => {
          if (!${JSON.stringify(textMatch)}) return true;
          const txt = (el.innerText || el.textContent || '').trim();
          return new RegExp(${JSON.stringify(textMatch)}, 'i').test(txt);
        });
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'center' });
          target.click();
          return true;
        }
        return false;
      })()
    `);
  }

  async waitForSelector(selector, timeoutMs = 30000) {
    timeoutMs = scaleMs(timeoutMs);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.eval(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await sleep(500);
    }
    return false;
  }

  async setFileInput(filePath) {
    const doc = await this.send('DOM.getDocument', { depth: -1 });
    const query = await this.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
    if (query?.nodeId) {
      await this.send('DOM.setFileInputFiles', { nodeId: query.nodeId, files: [filePath] });
      return true;
    }
    return false;
  }

  async typeViaPaste(text) {
    if (!clipboard) {
      const lines = String(text).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await this.send('Input.insertText', { text: lines[i] });
        if (i < lines.length - 1) {
          await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        }
        await sleep(60);
      }
      return;
    }
    clipboard.writeText(text);
    await sleep(200);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await sleep(80);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  }
}

// ---------------------------------------------------------------------------
// Jadwal bawaan TikTok ("When to post" → Schedule): video diunggah lebih awal,
// TikTok yang memposting di jam jadwal (tidak bergantung PC / server tetap menyala).
// TikTok: minimal 15 menit dari sekarang, menit kelipatan 5, jam & tanggal mengikuti zona waktu browser.
// ---------------------------------------------------------------------------
const TIKTOK_SCHEDULE_MIN_LEAD_MS = 16 * 60 * 1000;

async function cdpClickFound(cdp, findExpr) {
  const pt = await cdp.eval(`
    (() => {
      const el = (${findExpr});
      if (!el) return null;
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `).catch(() => null);
  if (!pt) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(pt.x), y: Math.round(pt.y), button: 'left', clickCount: 1 });
    await sleep(80);
  }
  return true;
}

// ===== Penghalang klik (notif / tooltip / popup yang menutupi tombol) =====
// Cek elemen di titik tengah target. Bila tertutup elemen lain -> tutup penghalangnya (tombol tutup/OK/X atau Escape).
const BLOCKER_JS = (findExpr) => String.raw`(() => {
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = (${findExpr});
  if (!el) return { found: false };
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return { found: true, blocked: false };
  const SEL = '[role="dialog"], [role="alertdialog"], [role="tooltip"], .TUXModal, [class*="Modal"], [class*="modal"], [class*="Popover"], [class*="popover"], [class*="Tooltip"], [class*="tooltip"], [class*="Toast"], [class*="toast"], [class*="Notif"], [class*="notif"], [class*="Notice"], [class*="Banner"], [class*="guide" i], [class*="joyride" i], [class*="Mask"], [class*="mask"], [class*="Overlay"], [class*="overlay"]';
  let box = hit.closest(SEL);
  if (!box) { let a = hit; while (a && a !== document.body) { const cs = getComputedStyle(a); if (cs.position === 'fixed' || cs.position === 'sticky') box = a; a = a.parentElement; } }
  if (!box) box = hit;
  const label = (b) => (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
  const OKRE = /^(got it|ok|okay|close|tutup|not now|nanti saja|cancel|batal|dismiss|skip|lewati|mengerti|saya mengerti|oke|no thanks|tidak|later|maybe later|i understand|understood)$/i;
  const pickIn = (root) => {
    const btns = Array.from(root.querySelectorAll('button, [role="button"], [aria-label]')).filter(visible);
    return btns.find((b) => OKRE.test(label(b)))
      || btns.find((b) => /close|tutup|dismiss/i.test(b.getAttribute('aria-label') || ''))
      || btns.find((b) => !label(b) && b.querySelector('svg') && b.getBoundingClientRect().width < 48);
  };
  let btn = pickIn(box);
  // Penghalang berupa mask/latar modal -> tombol ada di dialog yang terlihat paling atas
  if (!btn) {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .TUXModal')).filter(visible).pop();
    if (dlg) { box = dlg; btn = pickIn(dlg); }
  }
  const text = (box.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (btn) { btn.click(); return { found: true, blocked: true, text, closed: label(btn) || btn.getAttribute('aria-label') || 'ikon X' }; }
  return { found: true, blocked: true, text, closed: '' };
})()`;

// Popup pertama kali pakai Schedule: "Allow your video to be saved for scheduled posting?" -> klik Allow
const ALLOW_SCHEDULE_JS = String.raw`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const RE = /saved for scheduled posting|scheduled posting\?|disimpan untuk (posting|postingan) (ter)?jadwal|izinkan video anda disimpan/i;
  const dlg = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .TUXModal, [class*="Modal"], [class*="modal"]')).filter(visible).find((d) => RE.test(d.innerText || ''));
  if (!dlg) return false;
  const btn = Array.from(dlg.querySelectorAll('button, [role="button"]')).filter(visible).find((b) => /^(allow|izinkan|izinkan)$/i.test((b.innerText || '').trim()));
  if (!btn) return false;
  btn.click();
  return true;
})()`;

async function allowSchedulePopup(cdp, onProgress = () => {}) {
  const ok = await cdp.eval(ALLOW_SCHEDULE_JS).catch(() => false);
  if (ok) { onProgress('Popup "Allow your video to be saved for scheduled posting" → klik Allow'); await sleep(1200); }
  return ok;
}

async function clearClickBlocker(cdp, findExpr, onProgress = () => {}, where = '') {
  for (let i = 0; i < 4; i++) {
    if (await allowSchedulePopup(cdp, onProgress)) continue;
    const st = await cdp.eval(BLOCKER_JS(findExpr)).catch(() => null);
    if (!st || !st.found || !st.blocked) return true;
    onProgress(`[Pemulihan] Ada notif/popup menutupi ${where || 'tombol'}: "${st.text || '(tanpa teks)'}" → ${st.closed ? `klik "${st.closed}"` : 'tekan Escape'}`);
    if (!st.closed) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    }
    await sleep(1000);
  }
  return false;
}

async function setTikTokSchedule(cdp, targetMs, onProgress = () => {}) {
  // Bulatkan ke atas ke kelipatan 5 menit (tidak pernah lebih awal dari jadwal)
  const ms = Math.ceil(targetMs / 300000) * 300000;
  const want = await cdp.eval(`
    (() => {
      const t = new Date(${ms});
      const p = (n) => String(n).padStart(2, '0');
      return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), hh: p(t.getHours()), mm: p(t.getMinutes()),
        date: t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()), time: p(t.getHours()) + ':' + p(t.getMinutes()) };
    })()
  `);
  // Dua varian UI TikTok Studio (A/B per akun):
  //   lama → 2 <input> di .scheduled-picker (jam, tanggal "2026-11-13") + kalender .calendar-wrapper
  //   baru → Picker__trigger (tanggal "Nov 13, 2026" / "13 Nov 2026", jam "10:00") + DatePicker__panel / TimePicker__column
  // Format tanggal mengikuti bahasa Chrome → dinormalkan ke YYYY-MM-DD sebelum dibandingkan.
  const readVals = () => cdp.eval(String.raw`(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, ags: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
    const norm = (v) => {
      v = String(v || '').trim();
      let m = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
      if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
      m = v.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
      if (m && MON[m[1].slice(0, 3).toLowerCase()]) return m[3] + '-' + pad(MON[m[1].slice(0, 3).toLowerCase()]) + '-' + pad(m[2]);
      m = v.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/);
      if (m && MON[m[2].slice(0, 3).toLowerCase()]) return m[3] + '-' + pad(MON[m[2].slice(0, 3).toLowerCase()]) + '-' + pad(m[1]);
      m = v.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
      if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
      return v;
    };
    const normTime = (v) => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : String(v || '').trim(); };
    const pv = Array.from(document.querySelectorAll('.scheduled-picker .Picker__trigger .Picker__value')).map((e) => (e.innerText || '').trim());
    if (pv.length >= 2) return { ui: 'new', date: norm(pv[0]), time: normTime(pv[1]), raw: pv.join(' | ') };
    const iv = Array.from(document.querySelectorAll('.scheduled-picker input')).map((i) => i.value);
    if (iv.length >= 2) return { ui: 'old', date: norm(iv[1]), time: normTime(iv[0]), raw: iv.join(' | ') };
    return { ui: null };
  })()`).catch(() => ({ ui: null }));

  // 1. Pilih "Schedule" (tutup dulu notif/popup yang menutupi; ulangi bila belum muncul)
  const RADIO = `(document.querySelector('input[name="postSchedule"][value="schedule"]')?.closest('label') || Array.from(document.querySelectorAll('[data-e2e="schedule_container"] label')).find((l) => /^(schedule|jadwalkan)$/i.test((l.innerText || '').trim())))`;
  for (let attempt = 1; attempt <= 4 && !(await readVals()).ui; attempt++) {
    await clearClickBlocker(cdp, RADIO, onProgress, 'pilihan Schedule');
    await cdpClickFound(cdp, RADIO);
    for (let i = 0; i < 10; i++) {
      await allowSchedulePopup(cdp, onProgress);
      if ((await readVals()).ui) break;
      await sleep(500);
    }
    if (!(await readVals()).ui && attempt < 4) onProgress(`Pilihan Schedule belum terbuka, mencoba lagi (${attempt}/4)...`);
  }
  let cur = await readVals();
  if (!cur.ui) return { ok: false, reason: 'pilihan Schedule tidak muncul' };
  const isNew = cur.ui === 'new';
  const DATE_TRIGGER = isNew ? `document.querySelectorAll('.scheduled-picker .Picker__trigger')[0]` : `document.querySelectorAll('.scheduled-picker input')[1]`;
  const TIME_TRIGGER = isNew ? `document.querySelectorAll('.scheduled-picker .Picker__trigger')[1]` : `document.querySelectorAll('.scheduled-picker input')[0]`;
  const closePicker = async () => {
    await cdpClickFound(cdp, `document.querySelector('[data-e2e="schedule_container"] .scheduled-title-container')`);
    await sleep(700);
  };

  // 2. Tanggal: buka kalender → geser bulan → klik hari
  if (cur.date !== want.date) {
    await clearClickBlocker(cdp, DATE_TRIGGER, onProgress, 'kolom tanggal');
    await cdpClickFound(cdp, DATE_TRIGGER);
    await sleep(900);
    for (let i = 0; i < 4; i++) {
      const cal = await cdp.eval(String.raw`(() => {
        const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, ags: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
        const nw = document.querySelector('.DatePicker__panel');
        if (nw) {
          let mon = MON[(nw.querySelector('.DatePicker__titleMonth')?.innerText || '').trim().slice(0, 3).toLowerCase()] || 0;
          let yr = parseInt(nw.querySelector('.DatePicker__titleYear')?.innerText || '0', 10);
          if (!mon) {
            const d = nw.querySelector('.DatePicker__day[data-outside="false"]');
            const t = d ? Date.parse((d.getAttribute('aria-label') || '').replace(/(\d+)(st|nd|rd|th)/, '$1')) : NaN;
            if (!Number.isNaN(t)) { mon = new Date(t).getMonth() + 1; yr = new Date(t).getFullYear(); }
          }
          return { mon, yr };
        }
        const w = document.querySelector('.calendar-wrapper');
        if (!w) return null;
        const mon = MON[(w.querySelector('.month-title')?.innerText || '').trim().slice(0, 3).toLowerCase()] || 0;
        const yr = parseInt(w.querySelector('.year-title')?.innerText || '0', 10);
        return { mon, yr };
      })()`).catch(() => null);
      if (!cal || !cal.mon) return { ok: false, reason: 'kalender tidak terbaca' };
      const diff = (want.y - cal.yr) * 12 + (want.m - cal.mon);
      if (diff === 0) break;
      await cdpClickFound(cdp, `(() => { const a = document.querySelectorAll('.DatePicker__panel .DatePicker__nav').length ? document.querySelectorAll('.DatePicker__panel .DatePicker__nav') : document.querySelectorAll('.calendar-wrapper .month-header-wrapper .arrow'); return a[${diff > 0 ? 'a.length - 1' : '0'}]; })()`);
      await sleep(600);
    }
    const clicked = await cdpClickFound(cdp, `(() => {
      const nw = document.querySelector('.DatePicker__panel');
      if (nw) {
        const el = Array.from(nw.querySelectorAll('.DatePicker__day')).find((e) => e.getAttribute('data-outside') !== 'true' && e.innerText.trim() === '${want.d}');
        return el && !el.disabled && el.getAttribute('data-disabled') !== 'true' ? el : null;
      }
      // UI lama: hari bulan berjalan = dari angka "1" pertama sampai sebelum angka "1" berikutnya
      const days = Array.from(document.querySelectorAll('.calendar-wrapper .day'));
      const start = days.findIndex((e) => e.innerText.trim() === '1');
      let end = days.findIndex((e, i) => i > start && e.innerText.trim() === '1');
      if (end < 0) end = days.length;
      const el = days.slice(start, end).find((e) => e.innerText.trim() === '${want.d}');
      return el && el.classList.contains('valid') ? el : null;
    })()`);
    if (!clicked) return { ok: false, reason: `tanggal ${want.date} tidak bisa dipilih di TikTok (di luar batas jadwal)` };
    await sleep(800);
  }
  if (isNew && (await cdp.eval(`Boolean(document.querySelector('.DatePicker__panel'))`).catch(() => false))) await closePicker();

  // 3. Jam & menit
  cur = await readVals();
  if (cur.time !== want.time) {
    await clearClickBlocker(cdp, TIME_TRIGGER, onProgress, 'kolom jam');
    await cdpClickFound(cdp, TIME_TRIGGER);
    await sleep(800);
    if (isNew) {
      await cdpClickFound(cdp, `Array.from(document.querySelectorAll('.TimePicker__column')[0]?.querySelectorAll('.TimePicker__item') || []).find((e) => e.innerText.trim() === '${want.hh}')`);
      await sleep(400);
      await cdpClickFound(cdp, `Array.from(document.querySelectorAll('.TimePicker__column')[1]?.querySelectorAll('.TimePicker__item') || []).find((e) => e.innerText.trim() === '${want.mm}')`);
    } else {
      await cdpClickFound(cdp, `Array.from(document.querySelectorAll('.tiktok-timepicker-left')).find((e) => e.innerText.trim() === '${want.hh}')`);
      await sleep(400);
      await cdpClickFound(cdp, `Array.from(document.querySelectorAll('.tiktok-timepicker-right')).find((e) => e.innerText.trim() === '${want.mm}')`);
    }
    await sleep(600);
    // Tutup pemilih jam (klik judul "When to post")
    await closePicker();
  }

  const vals = await readVals();
  if (vals.time !== want.time || vals.date !== want.date) {
    return { ok: false, reason: `jadwal terbaca "${vals.raw || '-'}", seharusnya ${want.date} ${want.time}` };
  }
  onProgress(`Jadwal TikTok diatur: ${want.date} ${want.time}`);
  return { ok: true, value: `${want.date} ${want.time}`, at: new Date(ms).toISOString() };
}

async function getWsUrl(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const tabs = await res.json();
        const target = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

// =========================================================================
// FITUR OTOMATIS: EDIT COVER & DRAG FRAME PICKER KE ANGLE TERBAIK (55% - 85%)
// =========================================================================
// ===== Deteksi modal "Edit cover" =====
// Kunci utama: elemen timeline FramePicker hanya ada di dalam modal Edit cover.
// Cadangan: dialog yang teksnya diawali "Edit cover" + punya tombol Save & Cancel.
const COVER_MODAL_FIND_JS = String.raw`() => {
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const picker = Array.from(document.querySelectorAll('.FramePicker__root, .FramePicker__canvasContainer, canvas.FramePicker__canvas')).find(visible);
  const hasSaveCancel = (el) => { const t = Array.from(el.querySelectorAll('button')).filter(visible).map((b) => (b.innerText || '').trim().toLowerCase()); return t.some((x) => /^(save|simpan)$/.test(x)) && t.some((x) => /^(cancel|batal)$/.test(x)); };
  if (picker) {
    let el = picker.parentElement;
    while (el && el !== document.body) { if (hasSaveCancel(el)) return el; el = el.parentElement; }
  }
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .TUXModal, [class*="Modal"], [class*="Dialog"]')).filter(visible);
  return dialogs.find((d) => /^\s*(edit cover|edit sampul|ubah sampul|pilih sampul|select cover)/i.test(d.innerText || '') && hasSaveCancel(d)) || (picker ? document.body : null);
}`;
const COVER_MODAL_STATE_JS = String.raw`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const box = (${COVER_MODAL_FIND_JS})();
  if (!box) return { open: false, btn: null };
  const btn = Array.from(box.querySelectorAll('button')).reverse().find((b) => visible(b) && /^(save|simpan|done|selesai)$/i.test((b.innerText || b.textContent || '').trim()));
  if (!btn) return { open: true, btn: null };
  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || /disabled|loading/i.test(String(btn.className || '')) || Boolean(btn.querySelector('[class*="loading" i], [class*="spinner" i]'));
  const r = btn.getBoundingClientRect();
  return { open: true, btn: { disabled, x: r.left + r.width / 2, y: r.top + r.height / 2 } };
})()`;
const COVER_MODAL_CLICK_SAVE_JS = String.raw`(() => {
  const box = (${COVER_MODAL_FIND_JS})();
  if (!box) return false;
  const btn = Array.from(box.querySelectorAll('button')).reverse().find((b) => /^(save|simpan)$/i.test((b.innerText || '').trim()));
  if (btn) { btn.click(); return true; }
  return false;
})()`;

async function editAndSelectCoverFrame(cdp, onProgress = () => {}, shot = async () => {}) {
  onProgress('Membuka modal Edit Cover video...');

  // 1. Klik tombol "Edit cover" di halaman form TikTok
  const opened = await cdp.eval(`
    (() => {
      const candidates = Array.from(document.querySelectorAll('button, div, span'));
      const editBtn = candidates.find(el => {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        return txt === 'edit cover' || txt === 'edit sampul';
      });

      if (editBtn) {
        editBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        editBtn.click();
        return true;
      }
      return false;
    })()
  `);

  if (!opened) {
    onProgress('Tombol Edit Cover tidak ditemukan, melewati tahap ini.');
    return;
  }

  await sleep(3500);

  // 2. Tunggu timeline FramePicker siap di modal
  onProgress('Menunggu timeline filmstrip frame cover siap...');
  const pickerReady = await cdp.eval(`
    new Promise((resolve) => {
      let timer = 0;
      const check = setInterval(() => {
        timer += 300;
        const picker = document.querySelector('.FramePicker__root, .FramePicker__canvasContainer, canvas.FramePicker__canvas');
        if (picker || timer >= 15000) {
          clearInterval(check);
          resolve(Boolean(picker));
        }
      }, 300);
    })
  `);

  if (!pickerReady) {
    onProgress('Timeline filmstrip tidak terdeteksi, melewati pemilihan cover.');
    return;
  }

  await sleep(1500);

  await clearClickBlocker(cdp, `document.querySelector('canvas.FramePicker__canvas, .FramePicker__canvasContainer')`, onProgress, 'timeline cover');
  // 3. Ambil data koordinat awal indikator dan koordinat tujuan geser (55% - 85%)
  onProgress('Menghitung titik koordinat drag cover (angle terbaik)...');
  const dragData = await cdp.eval(`
    (() => {
      const root = document.querySelector('.FramePicker__root') || document.querySelector('.FramePicker__canvasContainer')?.parentElement;
      const canvas = document.querySelector('canvas.FramePicker__canvas') || document.querySelector('.FramePicker__canvasContainer');
      const indicator = document.querySelector('.FramePicker__indicator') || document.querySelector('.FramePicker__indicatorInner');

      if (!root || !canvas) return null;

      root.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      // Posisi awal handle indikator (atau sisi paling kiri timeline)
      let startX = canvasRect.left + 5;
      let startY = canvasRect.top + (canvasRect.height / 2);

      if (indicator) {
        const indRect = indicator.getBoundingClientRect();
        if (indRect.width > 0 && indRect.height > 0) {
          startX = indRect.left + (indRect.width / 2);
          startY = indRect.top + (indRect.height / 2);
        }
      }

      // Rentang acak 55% sampai 85% untuk menampilkan model menoleh/menghadap depan
      const minRatio = 0.55;
      const maxRatio = 0.85;
      const randomRatio = minRatio + (Math.random() * (maxRatio - minRatio));

      const targetX = canvasRect.left + (canvasRect.width * randomRatio);
      const targetY = startY;

      return {
        startX: Math.round(startX),
        startY: Math.round(startY),
        targetX: Math.round(targetX),
        targetY: Math.round(targetY),
        percent: Math.round(randomRatio * 100)
      };
    })()
  `);

  if (dragData && dragData.startX && dragData.targetX) {
    onProgress(`Menggeser indicator frame picker ke posisi ~${dragData.percent}%...`);

    // A. Arahkan mouse ke posisi handle awal
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dragData.startX,
      y: dragData.startY
    });
    await sleep(80);

    // B. Tekan tombol mouse (drag start)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dragData.startX,
      y: dragData.startY,
      button: 'left',
      clickCount: 1
    });
    await sleep(120);

    // C. Geser mouse secara bertahap menuju targetX (smooth dragging)
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const currentX = Math.round(dragData.startX + ((dragData.targetX - dragData.startX) * (i / steps)));
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: currentX,
        y: dragData.targetY,
        button: 'left'
      });
      await sleep(25);
    }
    await sleep(150);

    // D. Lepaskan mouse (drag drop selesai)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dragData.targetX,
      y: dragData.targetY,
      button: 'left',
      clickCount: 1
    });

    // E. Klik langsung di posisi targetX sebagai trigger fallback
    await sleep(300);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dragData.targetX,
      y: dragData.targetY,
      button: 'left',
      clickCount: 1
    });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dragData.targetX,
      y: dragData.targetY,
      button: 'left',
      clickCount: 1
    });

    await sleep(2000);
  }

  // 4. Klik tombol "Save" di pojok kanan atas modal Edit Cover
  await shot('cover-sebelum-save');
  onProgress('Menyimpan cover video yang telah digeser...');
  // Tombol Save butuh waktu aktif setelah frame digeser (TikTok memproses frame cover).
  // Tunggu aktif → klik fisik → pastikan modal "Edit cover" tertutup; ulangi bila belum.
  const readCoverModal = () => cdp.eval(COVER_MODAL_STATE_JS).catch(() => ({ open: true, btn: null, err: true }));

  let coverSaved = false;
  let clicked = false;
  for (let attempt = 1; attempt <= 6 && !coverSaved; attempt++) {
    let state = await readCoverModal();
    const until = Date.now() + scaleMs(12000);
    while ((!state.btn || state.btn.disabled) && state.open && Date.now() < until) {
      await sleep(500);
      state = await readCoverModal();
    }
    if (!state.open) {
      if (clicked) { coverSaved = true; break; }
      // Modal sudah tidak ada padahal Save belum diklik → cover tidak tersimpan (jangan dianggap berhasil)
      onProgress('[Peringatan] Jendela Edit cover tertutup sebelum tombol Save diklik.');
      break;
    }
    if (!state.btn) { await sleep(1500); continue; }

    await sleep(800); // jeda kecil agar klik tidak terlalu cepat setelah tombol aktif
    await clearClickBlocker(cdp, `(() => { const box = (${COVER_MODAL_FIND_JS})(); return box ? Array.from(box.querySelectorAll('button')).reverse().find((b) => /^(save|simpan)$/i.test((b.innerText || '').trim())) : null; })()`, onProgress, 'tombol Save cover');
    state = await readCoverModal();
    if (!state.open) { if (clicked) { coverSaved = true; break; } }
    if (!state.btn) { continue; }
    onProgress(`Klik tombol Save cover (percobaan ${attempt})...`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(state.btn.x), y: Math.round(state.btn.y) });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(state.btn.x), y: Math.round(state.btn.y), button: 'left', clickCount: 1 });
    await sleep(150);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(state.btn.x), y: Math.round(state.btn.y), button: 'left', clickCount: 1 });
    clicked = true;

    // Tunggu modal tertutup
    const closeUntil = Date.now() + scaleMs(8000);
    while (Date.now() < closeUntil) {
      await sleep(600);
      const s = await readCoverModal();
      if (!s.open) { coverSaved = true; break; }
    }
    if (!coverSaved && attempt === 3) {
      // klik fisik tidak berefek → coba klik DOM langsung pada tombol Save di modal
      await cdp.eval(COVER_MODAL_CLICK_SAVE_JS).catch(() => {});
    }
    if (!coverSaved) onProgress(`Tombol Save cover belum berhasil, mencoba lagi (${attempt}/6)...`);
  }

  await sleep(1500);
  if (!coverSaved) {
    // Jangan lanjut dengan modal cover masih terbuka (langkah berikutnya akan salah layar) → tutup modal
    onProgress('[Peringatan] Cover gagal disimpan, menutup jendela Edit cover agar langkah berikutnya tidak salah layar...');
    await closeCoverModal(cdp, readCoverModal);
  }
  onProgress(coverSaved ? 'Cover video berhasil diubah & disimpan!' : '[Peringatan] Cover dibiarkan bawaan (jendela Edit cover ditutup).');
}

// Tutup modal Edit cover (Cancel / Batal / ikon X / Escape) dan pastikan benar-benar tertutup
async function closeCoverModal(cdp, readCoverModal) {
  for (let i = 0; i < 4; i++) {
    const st = await readCoverModal();
    if (!st.open) return true;
    await cdp.eval(`
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const box = (${COVER_MODAL_FIND_JS})() || document;
        const btn = Array.from(box.querySelectorAll('button, [role="button"]')).find((b) => visible(b) && /^(cancel|batal|tutup|close)$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
        if (btn) { btn.click(); return; }
        const x = Array.from(document.querySelectorAll('[aria-label*="close" i], [aria-label*="tutup" i]')).find(visible);
        if (x) x.click();
      })()
    `).catch(() => {});
    await sleep(800);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(1200);
  }
  return !(await readCoverModal()).open;
}

// Dipakai sebelum langkah berikutnya: pastikan tidak ada modal Edit cover yang masih terbuka
async function ensureCoverModalClosed(cdp, onProgress) {
  const read = () => cdp.eval(COVER_MODAL_STATE_JS).catch(() => ({ open: false }));
  for (let i = 0; i < 10; i++) {
    if (!(await read()).open) return true;
    await sleep(1000);
  }
  onProgress('[Pemulihan] Jendela Edit cover masih terbuka → ditutup dulu sebelum lanjut...');
  return closeCoverModal(cdp, read);
}

// Cookie format sesi aplikasi (Electron/Playwright) → format CDP Network.setCookies
function toCdpCookies(list) {
  return list
    .filter((c) => c && c.name && c.domain && /tiktok/i.test(c.domain))
    .map((c) => ({
      name: c.name,
      value: String(c.value),
      domain: c.domain,
      path: c.path || '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
      ...(['Strict', 'Lax', 'None'].includes(c.sameSite) ? { sameSite: c.sameSite } : {}),
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {})
    }));
}

/**
 * Jika profil Chrome tidak punya cookie login TikTok (sessionid), suntikkan cookie dari cadangan sesi akun
 * (sessions/<akun>.json dkk, disimpan saat login). Mengembalikan true jika cookie dipulihkan.
 */
async function restoreTikTokLoginCookies(cdp, profileDir, accountId, onProgress = () => {}, providedCookies = null) {
  await cdp.send('Network.enable').catch(() => {});
  const current = await cdp.send('Network.getCookies', { urls: ['https://www.tiktok.com'] }).catch(() => null);
  if ((current?.cookies || []).some((c) => c.name === 'sessionid' && c.value)) return false;

  if (Array.isArray(providedCookies) && providedCookies.some((c) => c.name === 'sessionid' && c.value)) {
    await cdp.send('Network.setCookies', { cookies: toCdpCookies(providedCookies) });
    onProgress('Cookie login TikTok dipasang dari sesi akun yang dikirim aplikasi.');
    return true;
  }

  // profileDir = <root>/sessions/tiktok_profiles/acc_<id>
  const sessionsDir = path.dirname(path.dirname(profileDir));
  const cleanId = String(accountId || '').replace(/^@/, '').toLowerCase();
  // folder akun (sessions/akun/...) dulu bila modulnya ada; worker server tetap pakai path lama
  let af = null;
  try { af = require('../../core/accountFiles'); } catch (e) {}
  const candidates = [`${cleanId}.json`, `tiktok_streamer_cookies_${cleanId}.json`, `tiktokshop_cookies_${cleanId}.json`]
    .map((f) => path.join(sessionsDir, f))
    .map((f) => (af ? af.readPath(f) : f));

  for (const file of candidates) {
    let list = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      list = Array.isArray(raw) ? raw : (raw.cookies || []);
    } catch (e) {
      continue;
    }
    if (!list.some((c) => c.name === 'sessionid' && c.value)) continue;

    await cdp.send('Network.setCookies', { cookies: toCdpCookies(list) });
    onProgress(`Cookie login TikTok di profil Chrome hilang → dipulihkan dari cadangan sesi (${path.basename(file)}).`);
    return true;
  }

  onProgress('[Peringatan] Cookie login TikTok tidak ada di profil maupun cadangan sesi. Silakan login ulang akun ini.');
  return false;
}

async function uploadToTikTok({
  accountId = 'karuna_id',
  mediaPaths = [],
  caption = '',
  productId = '',
  productLinkTitle = '',
  concept = '',
  scheduleAt = '', // ISO: diisi bila diunggah lebih awal → pakai jadwal bawaan TikTok
  profileDir: profileDirOverride = '',
  cookies = null,
  debugDir = '',
  onProgress = () => {}
}) {
  const targetFiles = Array.isArray(mediaPaths) ? mediaPaths.filter((f) => f && fs.existsSync(f)) : [mediaPaths].filter((f) => f && fs.existsSync(f));
  if (targetFiles.length === 0) throw new Error('File video fisik tidak ditemukan.');

  // Pengaturan audio per konsep (dipilih saat membuat jadwal; cadangan: nama file video):
  //   JJ      → musik -60 dB (praktis tanpa suara musik), suara asli dibiarkan
  //   Daster  → sama seperti Sensasi: suara asli dibiarkan, musik -25 dB
  //   Sensasi → suara asli dibiarkan (ada suara karakter), musik -25 dB
  //   Remotion dari foto (video tanpa suara) → suara asli dimatikan, musik default
  //   POV     → suara asli dibiarkan (voice over), musik -30 dB
  // Video Remotion dari foto tidak punya suara asli → musik dibiarkan default (bukan -25 dB)
  const isRemotionFotoFile = targetFiles.some((f) => /remotion_foto/i.test(path.basename(f)));
  const conceptKey = (() => {
    const c = String(concept || '').toLowerCase();
    if (c === 'daster' && isRemotionFotoFile) return 'foto';
    if (c === 'pov2') return 'pov';
    if (['jj', 'daster', 'sensasi', 'pov'].includes(c)) return c;
    // Remotion: dari foto (tanpa suara) = 'foto', overlay video (suara asli) = seperti POV
    const REMOTION_AS = { remotionfoto: 'foto', remotionvideo: 'pov', edu3d: 'pov' };
    const byFile = targetFiles.map((f) => (path.basename(f).match(/daster|sensasi|_pov_|remotion_foto|remotion_video|edu3d/i) || [''])[0].toLowerCase().replace(/_/g, '')).map((k) => REMOTION_AS[k] || k).find(Boolean);
    return byFile || 'jj';
  })();
  // Mode "suara asli dimatikan, musik default" kini hanya untuk video Remotion dari foto
  const isDasterConcept = conceptKey === 'foto';
  const CONCEPT_AUDIO_LABEL = {
    jj: 'JJ → musik -60 dB',
    daster: 'Daster → suara asli tetap, musik -25 dB',
    foto: 'Remotion foto → suara asli dimatikan, musik default',
    sensasi: 'Sensasi → suara asli tetap, musik -25 dB',
    pov: 'POV Tangan → suara asli tetap, musik -30 dB'
  };
  // Konsep dengan suara asli dipertahankan & volume musik diturunkan ke nilai tertentu (dB)
  const MUSIC_DB_BY_CONCEPT = { daster: -25, sensasi: -25, pov: -30 };

  const chromePath = getChromePath();
  if (!chromePath) throw new Error('Google Chrome tidak terpasang di sistem.');

  const profileDir = profileDirOverride || getTikTokProfileDir(accountId);
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  // Linux server (worker): Chrome sebagai root wajib --no-sandbox; /dev/shm kecil; tanpa GPU (layar virtual Xvfb macet saat start)
  const linuxArgs = process.platform === 'linux'
    ? ['--disable-dev-shm-usage', '--disable-gpu', ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : [])]
    : [];
  // Windows: Chrome dijalankan tersembunyi di luar layar (bukan --headless: TikTok bisa mendeteksi HeadlessChrome).
  // Flag occlusion/backgrounding wajib agar halaman tetap dirender walau jendela tidak terlihat.
  // Set TIKTOK_SHOW_BROWSER=1 untuk menampilkan jendela saat debug.
  const hiddenArgs = process.platform === 'win32' && process.env.TIKTOK_SHOW_BROWSER !== '1'
    ? ['--window-position=-32000,-32000',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling']
    : [];
  const cdpPort = 53000 + Math.floor(Math.random() * 8000);

  const isVideo = targetFiles.some((f) => /\.(mp4|mov|webm)$/i.test(f));
  const uploadUrl = isVideo
    ? 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video'
    : 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo';

  onProgress(`Membuka Chrome asli TikTok Studio (Port CDP: ${cdpPort})...`);
  const chromeProcess = spawn(chromePath, [...chromeLiteArgs(), ...linuxArgs, ...hiddenArgs, 
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--hide-crash-restore-bubble', // jangan munculkan "Restore pages?" (Chrome bot ditutup paksa)
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    uploadUrl
  ], { detached: false, stdio: 'ignore' });

  let cdp = null;

  try {
    const wsUrl = await getWsUrl(cdpPort);
    if (!wsUrl) throw new Error('Gagal menghubungkan remote debugging CDP ke Chrome.');

    cdp = new TikTokCDPClient(wsUrl);
    await cdp.connect();

    // Screenshot diagnosa (worker server): simpan layar di titik penting bila debugDir diisi
    // Di aplikasi (tanpa debugDir): simpan ke <userData>/tiktok_debug, maksimal 40 file terbaru
    const shotDir = debugDir || (electronApi?.app?.getPath ? path.join(electronApi.app.getPath('userData'), 'tiktok_debug') : '');
    const debugShot = async (name) => {
      if (!shotDir) return;
      try {
        fs.mkdirSync(shotDir, { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
        fs.writeFileSync(path.join(shotDir, `${Date.now()}_${name}.jpg`), Buffer.from(shot.data, 'base64'));
        const old = fs.readdirSync(shotDir).filter((f) => f.endsWith('.jpg')).sort().reverse().slice(40);
        old.forEach((f) => { try { fs.unlinkSync(path.join(shotDir, f)); } catch (e) {} });
      } catch (e) {}
    };
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    // Cookie login di profil Chrome bisa hilang padahal sesi masih valid → pulihkan dari cadangan sesi akun
    if (await restoreTikTokLoginCookies(cdp, profileDir, accountId, onProgress, cookies)) {
      await cdp.send('Page.navigate', { url: uploadUrl });
      await sleep(3000);
    }

    // Tutup popup tur / onboarding / cookie yang muncul pada akun yang baru login.
    // Tombol di dalam modal produk (ada input "Search products" / Product name) tidak disentuh.
    const dismissPopups = async (stage) => {
      let total = 0;
      for (let round = 0; round < 4; round++) {
        const clicked = await cdp.eval(`
          (() => {
            const SAFE = ['got it', 'ok', 'okay', 'skip', 'skip tour', 'done', 'dismiss', 'not now', 'maybe later', 'later',
              'no thanks', 'i understand', 'understood', 'allow all', 'accept all', 'decline optional cookies',
              'mengerti', 'saya mengerti', 'oke', 'lewati', 'selesai', 'nanti saja', 'tidak sekarang', 'izinkan semua', 'terima semua'];
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const inProductModal = (el) => {
              const box = el.closest('[role="dialog"], .TUXModal, [class*="Modal"]');
              return Boolean(box && box.querySelector('input[placeholder*="Search products" i], .TUXTextInputCore-input, [class*="product" i]'));
            };
            const done = [];
            const tour = document.querySelectorAll('.react-joyride__tooltip button[data-action="skip"], .react-joyride__tooltip button[data-action="close"], button[data-test-id="button-skip"], [class*="guide" i] button[aria-label*="close" i], [class*="tooltip" i] button[aria-label*="close" i]');
            tour.forEach((b) => { if (visible(b)) { b.click(); done.push('tour'); } });
            Array.from(document.querySelectorAll('button, [role="button"]')).forEach((b) => {
              const txt = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
              if (!txt || !SAFE.includes(txt) || !visible(b) || inProductModal(b)) return;
              b.click();
              done.push(txt);
            });
            // Modal "automatic content checks": aktifkan saja agar tidak menghalangi
            Array.from(document.querySelectorAll('[role="dialog"], .TUXModal')).forEach((d) => {
              if (!/content check|pemeriksaan konten/i.test(d.innerText || '')) return;
              const b = Array.from(d.querySelectorAll('button')).find((x) => /^(turn on|aktifkan)$/i.test((x.innerText || '').trim()));
              if (b && visible(b)) { b.click(); done.push('content-check'); }
            });
            // Popup pengganggu yang dikenali dari teksnya (mis. tawaran musik bebas hak cipta) → Cancel / tutup.
            // Hanya popup yang cocok pola ini; modal cover / produk / discard tidak disentuh.
            const NUISANCE = /copyright|hak cipta|royalty|bebas royalti/i;
            Array.from(document.querySelectorAll('[role="dialog"], .TUXModal, [class*="Modal" i], [class*="popover" i]')).forEach((d) => {
              const txt = d.innerText || '';
              if (!NUISANCE.test(txt) || !visible(d)) return;
              if (/edit cover|select cover|add product links|search products|discard/i.test(txt)) return;
              const btns = Array.from(d.querySelectorAll('button, [role="button"]')).filter(visible);
              const b = btns.find((x) => /^(cancel|batal|not now|nanti saja|no thanks|tidak)$/i.test((x.innerText || '').trim()))
                || btns.find((x) => /close|tutup/i.test(x.getAttribute('aria-label') || '') || /^(close|tutup|got it|ok)$/i.test((x.innerText || '').trim()));
              if (b) { b.click(); done.push('popup musik/hak cipta'); }
            });
            return done;
          })()
        `).catch(() => []);
        if (!clicked || !clicked.length) break;
        total += clicked.length;
        onProgress(`Menutup popup (${stage}): ${clicked.join(', ')}`);
        await sleep(800);
      }
      return total;
    };

    onProgress('Menunggu halaman TikTok Studio siap...');
    await sleep(4000);
    await dismissPopups('halaman siap');

    // =========================================================================
    // 1. UNGGAH FILE MEDIA
    // =========================================================================
    onProgress('Menyerahkan berkas media ke input unggah...');
    await cdp.waitForSelector('input[type="file"]', 25000);
    await cdp.setFileInput(targetFiles[0]);

    // =========================================================================
    // 2. TULIS CAPTION TERLEBIH DAHULU (PADA ELEMEN DRAFTEDITOR-CONTENT)
    // =========================================================================
    onProgress('Menunggu editor caption Draft.js siap...');
    const editorSelector = '.public-DraftEditor-content[contenteditable="true"], .caption-editor [contenteditable="true"], .notranslate[contenteditable="true"]';
    await cdp.waitForSelector(editorSelector, 90000);
    await sleep(3500);
    await dismissPopups('editor siap');

    // TikTok Studio mengisi caption dengan nama file → SELALU dihapus, juga saat caption dikosongkan pengguna
    {
      onProgress(caption && caption.trim() ? 'Membersihkan nama file default & mengisi caption postingan...' : 'Caption kosong → menghapus nama file default dari caption...');

      await cdp.eval(`
        (() => {
          const el = document.querySelector('${editorSelector}');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('selectAll', false, null);
          }
        })()
      `);
      await sleep(300);

      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(400);

      if (caption && caption.trim()) {
        await cdp.typeViaPaste(caption.trim());
        await sleep(1000);
      } else {
        // Pastikan benar-benar kosong (sisa nama file bisa tertinggal bila Backspace pertama hanya menghapus seleksi sebagian)
        for (let i = 0; i < 3; i++) {
          const left = await cdp.eval(`(document.querySelector('${editorSelector}')?.innerText || '').trim().length`);
          if (!left) break;
          await cdp.eval(`(() => { const el = document.querySelector('${editorSelector}'); if (el) { el.focus(); document.execCommand('selectAll', false, null); } })()`);
          await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
          await sleep(400);
        }
      }

      await cdp.eval(`
        (() => {
          const el = document.querySelector('${editorSelector}');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      onProgress(caption && caption.trim() ? 'Caption postingan berhasil ditulis!' : 'Caption dikosongkan (nama file dihapus) ✓');
      await sleep(2500);
    }

    // =========================================================================
    // 2.5 EDIT COVER SEBELUM TAMBAH KERANJANG KUNING
    // =========================================================================
    try {
      await dismissPopups('sebelum cover');
      await editAndSelectCoverFrame(cdp, onProgress, debugShot);
      await sleep(2000);
      // Popup yang muncul di tengah proses cover (mis. musik hak cipta) bisa membatalkan pilihan cover → ulangi sekali
      if (await dismissPopups('setelah cover')) {
        onProgress('Popup menghalangi pemilihan cover, mengulang atur cover...');
        await editAndSelectCoverFrame(cdp, onProgress, debugShot);
        await sleep(2000);
      }
    } catch (coverErr) {
      console.warn('[TIKTOK COVER]', coverErr.message);
      onProgress(`Gagal atur cover (${coverErr.message}), melanjutkan ke langkah berikutnya...`);
    }

    await debugShot('setelah-cover');
    await ensureCoverModalClosed(cdp, onProgress);

    // =========================================================================
    // 3. TAUTKAN PRODUK SHOWCASE (SEARCH -> RADIO -> NEXT -> RENAME -> ADD)
    // =========================================================================
    const cleanPid = String(productId || '').trim();
    let linkedProductTitle = '';
    // Produk dianggap tertaut bila modal produk sudah tertutup & judul keranjang tampil di formulir
    const checkProductLinked = () => cdp.eval(`
      (() => {
        const modalOpen = Boolean(document.querySelector('input[placeholder*="Search products" i]'))
          || /Add product links/i.test((document.querySelector('[role="dialog"], .TUXModal') || {}).innerText || '');
        const body = (document.body.innerText || '').toUpperCase();
        const title = ${JSON.stringify(String(linkedProductTitle || '').toUpperCase())};
        return { modalOpen, titleVisible: Boolean(title) && body.includes(title) };
      })()
    `).catch(() => ({ modalOpen: false, titleVisible: false }));
    if (cleanPid) {
      await dismissPopups('sebelum keranjang kuning');
      onProgress(`Membuka Add link keranjang kuning (PID: ${cleanPid})...`);
      
      const clickedAdd = await cdp.eval(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const btn = buttons.find(b => {
            const txt = (b.innerText || b.textContent || '').trim();
            return /^\\+?\\s*Add(\\s+product\\s+links)?$/i.test(txt) || txt === 'Add' || txt === '+ Add';
          });
          if (btn) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            return true;
          }
          return false;
        })()
      `);

      if (!clickedAdd) {
        await cdp.clickSelector('button', '^\\s*\\+?\\s*Add\\s*$');
      }

      await sleep(2500);

      await cdp.clickSelector('button', '^\\s*Next\\s*$');
      await sleep(3000);

      // 3.0 Pastikan tab "Showcase products" yang aktif (akun yang punya toko terbuka di tab "My shop")
      const ensureShowcaseTab = async () => {
        for (let i = 0; i < 4; i++) {
          const tab = await cdp.eval(`
            (() => {
              const RE = /^(showcase products?|produk etalase|etalase|showcase)$/i;
              const els = Array.from(document.querySelectorAll('[role="tab"], button, div, span, a'))
                .filter((el) => RE.test((el.innerText || '').trim()) && el.getBoundingClientRect().width > 0);
              if (!els.length) return null;
              const el = els.find((e) => !Array.from(e.children).some((c) => RE.test((c.innerText || '').trim()))) || els[0];
              const tabEl = el.closest('[role="tab"]') || el;
              const active = tabEl.getAttribute('aria-selected') === 'true' || /active|selected/i.test(String(tabEl.className || ''));
              const r = el.getBoundingClientRect();
              return { active, hasSearch: Boolean(document.querySelector('input[placeholder*="Search products" i]')), x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })()
          `).catch(() => null);
          if (!tab) return; // tidak ada tab (akun tanpa toko) → modal langsung berisi etalase
          if (tab.active && tab.hasSearch) return;
          if (tab.hasSearch && i > 0) return;
          onProgress('Tab "My shop" terbuka → pindah ke tab "Showcase products"...');
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(tab.x), y: Math.round(tab.y), button: 'left', clickCount: 1 });
          await sleep(120);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(tab.x), y: Math.round(tab.y), button: 'left', clickCount: 1 });
          await sleep(2000);
        }
      };
      await ensureShowcaseTab();

      // 3.1 Tunggu input Search products siap
      await cdp.waitForSelector('input[placeholder*="Search products" i]', 15000);
      await ensureShowcaseTab();
      await sleep(1000 + Math.random() * 500);

      // 3.2 Klik pada kolom input pencarian produk
      await cdp.eval(`
        (() => {
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            input.click();
          }
        })()
      `);
      await sleep(500);

      // 3.3 Bersihkan input jika ada teks tersisa
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await sleep(100);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(400);

      // 3.4 Ketik PID karakter demi karakter secara natural
      onProgress(`Mengetik PID ${cleanPid} secara natural...`);
      for (const char of cleanPid) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
          unmodifiedText: char
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char,
          unmodifiedText: char
        });
        await sleep(50 + Math.floor(Math.random() * 50));
      }

      await cdp.eval(`
        (() => {
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(800);

      // 3.5 Deteksi koordinat fisik ikon kaca pembesar dan kirim klik
      onProgress('Menemukan posisi tombol kaca pembesar...');
      const searchCoords = await cdp.eval(`
        (() => {
          const pathEl = document.querySelector('path[d*="M21.83 7.5"]');
          if (pathEl) {
            const rect = pathEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            const parent = input.closest('span, div')?.parentElement;
            const icon = parent ? parent.querySelector('svg, span[role="img"]') : null;
            if (icon) {
              const rect = icon.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
              }
            }
          }
          return null;
        })()
      `);

      if (searchCoords && searchCoords.x && searchCoords.y) {
        onProgress('Mengeklik ikon kaca pembesar secara presisi...');
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(searchCoords.x),
          y: Math.round(searchCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(120);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(searchCoords.x),
          y: Math.round(searchCoords.y),
          button: 'left',
          clickCount: 1
        });
      }

      await sleep(300);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

      // 3.6 Tunggu baris produk muncul di tabel
      onProgress('Menunggu hasil pencarian produk muncul...');
      await cdp.eval(`
        new Promise((resolve) => {
          let elapsed = 0;
          const timer = setInterval(() => {
            elapsed += 400;
            const rows = document.querySelectorAll('table tbody tr, [role="row"]');
            const hasMatch = Array.from(rows).some(r => r.innerText.includes('${cleanPid}'));
            if (hasMatch || elapsed >= 12000) {
              clearInterval(timer);
              resolve(true);
            }
          }, 400);
        })
      `);
      await sleep(2000);

      // Ringkasan isi modal untuk diagnosa (teks dipotong)
      const readModalSnippet = () => cdp.eval(`
        (() => {
          const m = document.querySelector('[role="dialog"], .TUXModal, [class*="Modal"]');
          return ((m || document.body).innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
        })()
      `).catch(() => '');
      const searchState = await cdp.eval(`
        (() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr, [role="row"]'))
            .filter((r) => r.querySelector('.TUXRadioStandalone, input[type="radio"]'));
          return { rows: rows.length, match: rows.some((r) => r.innerText.includes('${cleanPid}')) };
        })()
      `).catch(() => ({ rows: -1, match: false }));
      onProgress(`Hasil pencarian produk: ${searchState.rows} baris, PID cocok: ${searchState.match ? 'ya' : 'tidak'}`);
      if (searchState.rows === 0) {
        await debugShot('produk-tidak-ditemukan');
        const snippet = await readModalSnippet();
        throw new Error(`Produk PID ${cleanPid} tidak ditemukan di etalase akun @${accountId}. Isi modal: ${snippet}`);
      }

      await dismissPopups('hasil pencarian produk');

      // 3.7 Memilih Radio Button secara fisik
      onProgress('Mendeteksi posisi koordinat tombol radio produk...');
      const radioCoords = await cdp.eval(`
        (() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr, [role="row"]'));
          const matchedRow = rows.find(r => r.innerText.includes('${cleanPid}')) || rows[0];

          let targetEl = null;
          if (matchedRow) {
            targetEl = matchedRow.querySelector('.TUXRadioStandalone, label:has(.TUXRadioStandalone-input), input.TUXRadioStandalone-input, input[type="radio"]');
          }

          if (!targetEl) {
            targetEl = document.querySelector('.TUXRadioStandalone, label:has(.TUXRadioStandalone-input), input.TUXRadioStandalone-input, input[type="radio"]');
          }

          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = targetEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return {
                x: rect.left + (rect.width / 2),
                y: rect.top + (rect.height / 2)
              };
            }
          }
          return null;
        })()
      `);

      if (radioCoords && radioCoords.x && radioCoords.y) {
        onProgress('Mengeklik tombol radio secara fisik...');
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(radioCoords.x),
          y: Math.round(radioCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(150);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(radioCoords.x),
          y: Math.round(radioCoords.y),
          button: 'left',
          clickCount: 1
        });
      } else {
        await cdp.eval(`
          (() => {
            const radio = document.querySelector('input.TUXRadioStandalone-input, input[type="radio"]');
            if (radio) {
              const parent = radio.closest('label') || radio.parentElement || radio;
              parent.click();
            }
          })()
        `);
      }

      await sleep(2200);

      // 3.8 KLIK TOMBOL NEXT DENGAN LOOP VERIFIKASI PERPINDAHAN FORM
      onProgress('Menunggu tombol Next aktif pada modal produk...');
      await sleep(1000);

      let formShifted = false;
      for (let attempt = 1; attempt <= 12; attempt++) {
        formShifted = await cdp.eval(`
          (() => {
            const bodyTxt = document.body.innerText || '';
            const hasProductName = bodyTxt.includes('Product name') || bodyTxt.includes('Product name will appear');
            const hasSearch = Boolean(document.querySelector('input[placeholder*="Search products" i]'));
            return hasProductName && !hasSearch;
          })()
        `);

        if (formShifted) {
          onProgress('Halaman modal berhasil beralih ke pengaturan nama produk!');
          break;
        }

        if (attempt > 1) await dismissPopups('modal produk');
        onProgress(`Menekan tombol Next (Percobaan ${attempt})...`);

        const nextCoords = await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const btn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label, .TUXButton-content') || b;
              const txt = (label.innerText || label.textContent || '').trim();
              return txt.toLowerCase() === 'next';
            });

            if (btn) {
              const isDisabled = btn.hasAttribute('disabled') || 
                                 btn.getAttribute('aria-disabled') === 'true' ||
                                 btn.classList.contains('TUXButton--disabled');
              if (!isDisabled) {
                btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          })()
        `);

        if (nextCoords && nextCoords.x && nextCoords.y) {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: Math.round(nextCoords.x),
            y: Math.round(nextCoords.y),
            button: 'left',
            clickCount: 1
          });
          await sleep(150);
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: Math.round(nextCoords.x),
            y: Math.round(nextCoords.y),
            button: 'left',
            clickCount: 1
          });
        }

        await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const btn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label') || b;
              return (label.innerText || label.textContent || '').trim().toLowerCase() === 'next';
            });
            if (btn && btn.getAttribute('aria-disabled') !== 'true') btn.click();
          })()
        `);

        await sleep(1800);
      }

      if (!formShifted) {
        await debugShot('gagal-next-produk');
        const snippet = await readModalSnippet();
        throw new Error(`Gagal berpindah ke halaman Product name setelah klik Next. Isi modal: ${snippet}`);
      }

      await sleep(1200);

      // =========================================================================
      // 3.9 HAPUS JUDUL BAWAAN & ISI DENGAN JUDUL DINAMIS GEMINI (BEBAS EMOJI)
      // =========================================================================
      onProgress('Menunggu kolom Product name (.TUXTextInputCore-input)...');
      await cdp.waitForSelector('.TUXInputBox input, input.TUXTextInputCore-input', 10000);
      await sleep(1200);

      // Judul diisi manual di halaman Jadwal → dipakai apa adanya; kosong → dibuat Gemini
      const manualTitle = String(productLinkTitle || '').trim();
      let rawTitle;
      if (manualTitle) {
        onProgress('Memakai judul keranjang kuning yang diisi manual...');
        rawTitle = manualTitle;
      } else {
        onProgress('Membuat judul keranjang kuning otomatis via Gemini...');
        rawTitle = await generateProductLinkTitle(caption || 'Atasan Wanita');
      }

      let selectedTitle = String(rawTitle || '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 30);

      if (!selectedTitle || selectedTitle.length < 5) {
        selectedTitle = 'PROMO SPESIAL CEK SEKARANG';
      }

      onProgress(`Judul keranjang kuning bersih: "${selectedTitle}"`);

      onProgress('Menghapus judul produk bawaan TikTok Studio...');
      await cdp.eval(`
        (() => {
          const input = document.querySelector('.TUXInputBox input, input.TUXTextInputCore-input');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            input.select();
            document.execCommand('selectAll', false, null);
          }
        })()
      `);
      await sleep(200);

      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(100);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', windowsVirtualKeyCode: 46 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', windowsVirtualKeyCode: 46 });
      await sleep(300);

      onProgress(`Mengisi judul keranjang kuning: "${selectedTitle}"...`);
      await cdp.eval(`
        (() => {
          const input = document.querySelector('.TUXInputBox input, input.TUXTextInputCore-input');
          if (input) {
            input.value = '';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) {
              setter.call(input, ${JSON.stringify(selectedTitle)});
            } else {
              input.value = ${JSON.stringify(selectedTitle)};
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        })()
      `);

      await sleep(2000);

      // =========================================================================
      // 3.10 KLIK TOMBOL KONFIRMASI MERAH 'ADD'
      // =========================================================================
      onProgress('Menunggu tombol konfirmasi Add aktif...');
      const addBtnCoords = await cdp.eval(`
        new Promise((resolve) => {
          let elapsed = 0;
          const timer = setInterval(() => {
            elapsed += 300;
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const addBtn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label, .TUXButton-content') || b;
              const txt = (label.innerText || label.textContent || '').trim();
              return txt.toLowerCase() === 'add';
            });

            const isEnabled = addBtn && 
                              !addBtn.hasAttribute('disabled') && 
                              addBtn.getAttribute('aria-disabled') !== 'true' &&
                              !addBtn.classList.contains('TUXButton--disabled');

            if (isEnabled) {
              clearInterval(timer);
              addBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
              const rect = addBtn.getBoundingClientRect();
              resolve({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            } else if (elapsed >= 10000) {
              clearInterval(timer);
              if (addBtn) {
                const rect = addBtn.getBoundingClientRect();
                resolve({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              } else {
                resolve(null);
              }
            }
          }, 300);
        })
      `);

      if (addBtnCoords && addBtnCoords.x && addBtnCoords.y) {
        onProgress('Menekan tombol konfirmasi Add...');
        await sleep(500);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(addBtnCoords.x),
          y: Math.round(addBtnCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(150);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(addBtnCoords.x),
          y: Math.round(addBtnCoords.y),
          button: 'left',
          clickCount: 1
        });
      } else {
        await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const target = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label') || b;
              return (label.innerText || label.textContent || '').trim().toLowerCase() === 'add';
            });
            if (target) target.click();
          })()
        `);
      }

      await sleep(3500);
      linkedProductTitle = selectedTitle;
      const linkState = await checkProductLinked();
      if (linkState.titleVisible && !linkState.modalOpen) {
        onProgress('Produk keranjang kuning berhasil ditautkan ✓ (judul tampil di formulir)');
      } else {
        await debugShot('produk-belum-tertaut');
        onProgress(`[Peringatan] Keranjang kuning belum terlihat di formulir (modal terbuka: ${linkState.modalOpen ? 'ya' : 'tidak'}, judul tampil: ${linkState.titleVisible ? 'ya' : 'tidak'}).`);
      }
    }

    // =========================================================================
    // 4. BUKA PANEL SOUNDS & PILIH MUSIK REKOMENDASI SECARA ACAK
    // =========================================================================
    await ensureCoverModalClosed(cdp, onProgress);
    onProgress(`Membuka editor Sounds musik TikTok (konsep: ${CONCEPT_AUDIO_LABEL[conceptKey]})...`);
    
    const soundsPanelAlreadyOpen = await cdp.eval(`
      Boolean(document.querySelector('input[placeholder*="Search sounds" i]'))
    `);

    if (!soundsPanelAlreadyOpen) {
      await cdp.eval(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button, div[role="tab"]'));
          const btnSounds = buttons.find(b => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt === 'sounds' || b.getAttribute('data-button-name') === 'sounds';
          });
          if (btnSounds) {
            btnSounds.scrollIntoView({ behavior: 'instant', block: 'center' });
            btnSounds.click();
          }
        })()
      `);
      await sleep(3500);
    }

    onProgress('Menunggu panel Sounds dimuat...');
    await cdp.waitForSelector('input[placeholder*="Search sounds" i]', 15000);
    await sleep(1500);

    // Cari lagu dengan kata kunci JJ (ketik seperti pengguna, lalu Enter)
    onProgress(`Mencari musik "${MUSIC_SEARCH_KEYWORD}" di TikTok Sounds...`);
    await cdp.eval(`
      (() => {
        const input = document.querySelector('input[placeholder*="Search sounds" i]');
        if (!input) return false;
        input.focus();
        input.select();
        return true;
      })()
    `);
    await cdp.send('Input.insertText', { text: MUSIC_SEARCH_KEYWORD });
    await sleep(400);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

    // Tunggu hasil pencarian berisi tombol (+) lagu
    const PLUS_BUTTON_SELECTOR = 'button[data-icon-only="true"]:has([data-icon="PlusBold"])';
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const count = await cdp.eval(`document.querySelectorAll('${PLUS_BUTTON_SELECTOR}').length`);
      if (count > 0) break;
    }
    await sleep(1500);

    onProgress('Memilih lagu hasil pencarian secara acak...');
    const chosenTrack = await cdp.eval(`
      (() => {
        // Hanya tombol (+) bulat di baris lagu (ikon PlusBold) — bukan tombol sidebar Text/Sounds/Templates
        const addButtons = Array.from(document.querySelectorAll('${PLUS_BUTTON_SELECTOR}')).filter((btn) => {
          const r = btn.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && btn.getAttribute('aria-disabled') !== 'true';
        });
        if (addButtons.length === 0) return { found: false };

        const randomIndex = Math.floor(Math.random() * addButtons.length);
        const targetBtn = addButtons[randomIndex];

        // Judul lagu: naik ke baris yang berisi teks
        let row = targetBtn.parentElement;
        while (row && !(row.innerText || '').trim()) row = row.parentElement;
        const trackTitle = ((row && row.innerText) || 'Lagu #' + (randomIndex + 1)).split('\\n')[0].trim();

        document.querySelectorAll('[data-bot-sound]').forEach((el) => el.removeAttribute('data-bot-sound'));
        targetBtn.setAttribute('data-bot-sound', '1');
        targetBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = targetBtn.getBoundingClientRect();
        return {
          found: true,
          total: addButtons.length,
          title: trackTitle,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `);

    if (chosenTrack && chosenTrack.found && chosenTrack.x && chosenTrack.y) {
      onProgress(`Memilih lagu secara acak: "${chosenTrack.title}" (dari ${chosenTrack.total} hasil)...`);
      await sleep(600);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(chosenTrack.x),
        y: Math.round(chosenTrack.y),
        button: 'left',
        clickCount: 1
      });
      await sleep(150);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(chosenTrack.x),
        y: Math.round(chosenTrack.y),
        button: 'left',
        clickCount: 1
      });
      onProgress('Tombol (+) musik diklik, memastikan lagu masuk ke timeline...');

      // Lagu masuk = panel pengaturan audio (volume) tampil, atau tombol (+) berubah (loading/hilang)
      const isSoundAdded = () => cdp.eval(`
        (() => {
          if (document.querySelector('.PropSettingAudioVolume__wrap')) return 'panel-audio';
          const btn = document.querySelector('[data-bot-sound]');
          if (!btn) return 'tombol-berubah';
          if (btn.querySelector('.Button__spinnerBox--loading-true')) return 'memuat';
          if (!btn.querySelector('[data-icon="PlusBold"]')) return 'tombol-berubah';
          return '';
        })()
      `);
      const waitSoundAdded = async (ms) => {
        const until = Date.now() + scaleMs(ms);
        let state = '';
        while (Date.now() < until) {
          state = await isSoundAdded().catch(() => '');
          if (state && state !== 'memuat') return state;
          await sleep(500);
        }
        return state;
      };

      let added = await waitSoundAdded(12000);
      if (!added || added === 'memuat') {
        onProgress('Lagu belum terdeteksi masuk, klik ulang tombol (+) via DOM...');
        await cdp.eval(`(() => { const b = document.querySelector('[data-bot-sound]'); if (b) b.click(); return Boolean(b); })()`);
        added = await waitSoundAdded(12000);
      }
      await debugShot('setelah-pilih-lagu');
      if (added && added !== 'memuat') {
        onProgress(`Lagu masuk ke timeline ✓ (${added})`);
      } else {
        onProgress('[Peringatan] Lagu tidak terdeteksi masuk ke timeline; video mungkin terposting tanpa musik.');
      }
    } else {
      onProgress(`[Peringatan] Tidak ada lagu hasil pencarian "${MUSIC_SEARCH_KEYWORD}", video diunggah tanpa musik tambahan.`);
    }

    await sleep(4000);

    // =========================================================================
    // 5. ATUR AUDIO SESUAI KONSEP (JJ: musik -60 dB · DASTER: suara asli mati · SENSASI: musik -25 dB)
    // =========================================================================
    if (MUSIC_DB_BY_CONCEPT[conceptKey] !== undefined) {
      const targetDb = MUSIC_DB_BY_CONCEPT[conceptKey];
      const conceptName = { pov: 'POV Tangan', daster: 'Daster', sensasi: 'Sensasi' }[conceptKey] || conceptKey;
      onProgress(`[Konsep ${conceptName}] Mengatur volume musik ke ${targetDb} dB (suara asli video dibiarkan)...`);
      let appliedDb = null;
      for (let attempt = 1; attempt <= 3 && appliedDb !== targetDb; attempt++) {
        appliedDb = await cdp.eval(`
          (() => {
            const setValue = (el, v) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(el, v); else el.value = v;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const volumeInput = document.querySelector('.PropSettingAudioVolume__wrap input.PropSettingInput__input, .PropSettingGroup__wrap input.PropSettingInput__input');
            if (volumeInput) {
              volumeInput.focus();
              setValue(volumeInput, '${targetDb}');
              volumeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              volumeInput.blur();
            }
            const rangeInput = document.querySelector('.PropSettingAudioVolume__wrap input[type="range"], .PropSettingSliderInput__wrap input[type="range"]');
            if (rangeInput) setValue(rangeInput, '${targetDb}');
            const shown = volumeInput ? parseFloat(volumeInput.value) : (rangeInput ? parseFloat(rangeInput.value) : NaN);
            return Number.isFinite(shown) ? Math.round(shown) : null;
          })()
        `);
        await sleep(1200);
      }
      await debugShot(`${conceptKey}-volume-musik`);
      onProgress(appliedDb === targetDb
        ? `[Konsep ${conceptName}] Volume musik ${targetDb} dB ✓, suara asli video tetap.`
        : `[Peringatan] Volume musik belum terbaca ${targetDb} dB (terbaca: ${appliedDb ?? 'kolom volume tidak ditemukan'}).`);
    } else if (!isDasterConcept) {
      onProgress('[Konsep JJ] Menurunkan volume musik menjadi -∞ dB (-60 dB)...');
      await cdp.eval(`
        (() => {
          const volumeInput = document.querySelector('.PropSettingAudioVolume__wrap input.PropSettingInput__input, .PropSettingGroup__wrap input.PropSettingInput__input');
          if (volumeInput) {
            volumeInput.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(volumeInput, '-60');
            } else {
              volumeInput.value = '-60';
            }
            volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
            volumeInput.dispatchEvent(new Event('change', { bubbles: true }));
            volumeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }

          const rangeInput = document.querySelector('.PropSettingAudioVolume__wrap input[type="range"], .PropSettingSliderInput__wrap input[type="range"]');
          if (rangeInput) {
            const nativeRangeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeRangeSetter) {
              nativeRangeSetter.call(rangeInput, '-60');
            } else {
              rangeInput.value = '-60';
            }
            rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
            rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const sliderTrack = document.querySelector('.PropSettingSliderInput__sliderInput, .Slider__root');
          if (sliderTrack) {
            const rect = sliderTrack.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 2,
              clientY: rect.top + (rect.height / 2)
            });
            sliderTrack.dispatchEvent(clickEvent);
          }
          return true;
        })()
      `);
      await sleep(2000);
      onProgress('Volume musik telah diatur ke -∞ dB!');
    } else {
      // Daster: matikan suara asli video (tombol speaker di baris video = paling atas di timeline),
      // volume musik dibiarkan default, lalu Save → Post
      onProgress('[Remotion Foto] Mematikan suara asli video di timeline...');
      const readVideoSpeaker = () => cdp.eval(`
        (() => {
          const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const btns = Array.from(document.querySelectorAll('button[data-icon-only="true"]'))
            .filter((b) => visible(b) && b.querySelector('[data-icon^="Volume" i], [data-icon*="Mute" i], [data-icon*="Sound" i]'))
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          // Speaker track timeline berjajar satu kolom (posisi x sama): ambil kolom berisi >= 2 tombol
          const cols = {};
          btns.forEach((x) => { const k = Math.round(x.getBoundingClientRect().left / 8); (cols[k] = cols[k] || []).push(x); });
          const track = Object.values(cols).sort((a, b) => b.length - a.length)[0] || [];
          const b = track[0];
          if (!b) return null;
          const icon = b.querySelector('[data-icon^="Volume" i], [data-icon*="Mute" i], [data-icon*="Sound" i]').getAttribute('data-icon');
          const r = b.getBoundingClientRect();
          return { icon, total: track.length, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `).catch(() => null);

      let speaker = await readVideoSpeaker();
      // Hanya klik bila ada 2 baris (video + musik) dan speaker video masih menyala
      if (speaker && speaker.total >= 2 && /VolumeUp/i.test(speaker.icon)) {
        for (let attempt = 1; attempt <= 3 && speaker && /VolumeUp/i.test(speaker.icon); attempt++) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(speaker.x), y: Math.round(speaker.y), button: 'left', clickCount: 1 });
          await sleep(120);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(speaker.x), y: Math.round(speaker.y), button: 'left', clickCount: 1 });
          await sleep(1200);
          speaker = await readVideoSpeaker();
        }
        onProgress(speaker && !/VolumeUp/i.test(speaker.icon)
          ? `[Remotion Foto] Suara asli video dimatikan ✓ (${speaker.icon})`
          : '[Peringatan] Suara asli video belum terdeteksi mati.');
      } else {
        onProgress(`[Remotion Foto] Tombol speaker video tidak ditemukan / sudah mati (${speaker ? speaker.icon + ', ' + speaker.total + ' baris' : 'tidak ada'}).`);
      }
      await debugShot('daster-suara-video');
      onProgress('[Remotion Foto] Volume musik dibiarkan default, langsung simpan...');
    }

    // =========================================================================
    // 6. SIMPAN PENGATURAN AUDIO (KLIK SAVE)
    // =========================================================================
    await debugShot('sebelum-save-audio');
    onProgress('Menyimpan perubahan audio editor...');
    const saveAudioClicked = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const saveBtn = buttons.find(b => {
          const txt = (b.innerText || b.textContent || '').trim();
          return txt === 'Save' || txt === 'Simpan';
        });

        if (saveBtn) {
          saveBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          saveBtn.click();
          return true;
        }
        return false;
      })()
    `);

    if (!saveAudioClicked) {
      await cdp.clickSelector('button', '^\\s*(Save|Simpan)\\s*$');
    }

    await sleep(3500);
    onProgress('Kembali ke formulir utama TikTok Studio.');
    await debugShot('setelah-save-audio');

    // =========================================================================
    // 7. PUBLIKASIKAN KONTEN (KLIK TOMBOL POST DI BAWAH HALAMAN)
    // =========================================================================
    await dismissPopups('sebelum post');
    if (cleanPid && linkedProductTitle) {
      const finalLink = await checkProductLinked();
      if (finalLink.titleVisible) onProgress('Cek akhir: keranjang kuning masih terpasang ✓');
      else {
        await debugShot('produk-hilang-sebelum-post');
        onProgress('[Peringatan] Cek akhir: keranjang kuning TIDAK terlihat di formulir sebelum Post (kemungkinan terlepas setelah editor Sounds).');
      }
    }
    // 6.9 Jadwal bawaan TikTok (diunggah lebih awal): atur jam & tanggal posting di TikTok
    let tiktokScheduled = null;
    if (scheduleAt) {
      const targetMs = new Date(scheduleAt).getTime();
      if (!Number.isNaN(targetMs) && targetMs > Date.now()) {
        // TikTok menolak jadwal < 15 menit → mundur seperlunya (jangan pernah posting lebih awal)
        const effMs = Math.max(targetMs, Date.now() + TIKTOK_SCHEDULE_MIN_LEAD_MS);
        onProgress('Mengatur jadwal posting di TikTok (Schedule)...');
        const sched = await setTikTokSchedule(cdp, effMs, onProgress);
        if (!sched.ok) {
          await debugShot('jadwal-tiktok-gagal');
          const e = new Error(`Gagal mengatur jadwal di TikTok: ${sched.reason}`);
          e.code = 'TIKTOK_SCHEDULE_FAILED';
          throw e;
        }
        tiktokScheduled = sched;
        if (new Date(sched.at).getTime() - targetMs >= 60000) {
          onProgress(`[Info] Jam jadwal dimundurkan ke ${sched.value} (TikTok minimal 15 menit ke depan, kelipatan 5 menit).`);
        }
        await allowSchedulePopup(cdp, onProgress);
      } else {
        onProgress('Waktu jadwal sudah lewat → posting sekarang.');
      }
    }

    onProgress(tiktokScheduled ? 'Jadwal terisi → langsung klik tombol Schedule...' : 'Menyiapkan publikasi postingan (Scroll ke bawah)...');
    await sleep(tiktokScheduled ? 300 : 2000);

    // 7.1 Scroll total ke dasar halaman TikTok Studio
    await cdp.eval(`window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });`);
    await sleep(1500);

    // 7.2 Tunggu tombol Post aktif dan terbebas dari status loading
    onProgress('Menunggu tombol Post siap...');
    await cdp.eval(`
      new Promise((resolve) => {
        let elapsed = 0;
        const timer = setInterval(() => {
          elapsed += 400;
          const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
          const isReady = postBtn && 
                          !postBtn.hasAttribute('disabled') && 
                          postBtn.getAttribute('aria-disabled') !== 'true' &&
                          postBtn.getAttribute('data-loading') !== 'true';

          if (isReady || elapsed >= 30000) {
            clearInterval(timer);
            resolve(Boolean(isReady));
          }
        }, 400);
      })
    `);

    // 7.3 Ambil koordinat tombol merah Post spesifik (berdasarkan data-e2e="post_video_button")
    onProgress('Mendeteksi posisi koordinat tombol Post...');
    const postCoords = await cdp.eval(`
      (() => {
        const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
        if (postBtn) {
          postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = postBtn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      })()
    `);

    if (postCoords && postCoords.x && postCoords.y) {
      onProgress('Menekan tombol Post secara presisi via CDP...');
      await sleep(1000);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(postCoords.x),
        y: Math.round(postCoords.y),
        button: 'left',
        clickCount: 1
      });
      await sleep(150);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(postCoords.x),
        y: Math.round(postCoords.y),
        button: 'left',
        clickCount: 1
      });
    }

    // Backup klik langsung ke elemen DOM
    await cdp.eval(`
      (() => {
        const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
        if (postBtn && postBtn.getAttribute('aria-disabled') !== 'true') {
          postBtn.click();
        }
      })()
    `);

    await sleep(2500);

    // =========================================================================
    // 8. TUNGGU KONFIRMASI SUKSES, TUTUP BROWSER, & MUNCULKAN NOTIFIKASI
    // =========================================================================
    // Dulu: setelah 60 dtk tanpa konfirmasi tetap dianggap berhasil → status "selesai" padahal tidak terposting.
    // Sekarang: tangani dialog konfirmasi TikTok, klik Post sekali lagi bila perlu, dan gagalkan bila jelas belum terkirim.
    onProgress('Menunggu konfirmasi penerbitan postingan...');
    const readPostState = () => cdp.eval(`
      (() => {
        const text = document.body.innerText || '';
        const href = location.href;
        const success = /Your video has been uploaded|Video Anda telah diunggah|Manage your posts|Kelola postingan|Video published|Video dipublikasikan|has been scheduled|telah dijadwalkan|Video scheduled|Video dijadwalkan/i.test(text)
          || /\\/manage|\\/tiktokstudio\\/content/.test(href);
        const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
        const btnVisible = Boolean(postBtn) && postBtn.getBoundingClientRect().width > 0;
        return { success, btnVisible, href, snippet: text.replace(/\\s+/g, ' ').slice(0, 160) };
      })()
    `).catch(() => ({}));
    // Dialog konfirmasi (mis. pemeriksaan konten belum selesai → "Post now" / "Posting sekarang")
    const clickPostConfirm = () => cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('[role="dialog"] button, .TUXModal button, div[class*="modal" i] button'))
          .find((b) => b.getBoundingClientRect().width > 0 && /^(post now|posting sekarang|posting saja|continue|lanjutkan|post|posting|schedule|jadwalkan)$/i.test((b.innerText || '').trim()));
        if (btn) { btn.click(); return (btn.innerText || '').trim(); }
        return '';
      })()
    `).catch(() => '');

    let postState = {};
    let repostTried = false;
    for (let waited = 0; waited < 90; waited += 2) {
      await allowSchedulePopup(cdp, onProgress);
      postState = await readPostState();
      if (postState.success) break;
      const confirmed = await clickPostConfirm();
      if (confirmed) onProgress(`Dialog konfirmasi TikTok → klik "${confirmed}"...`);
      // 20 dtk tanpa tanda terkirim & tombol Post masih ada → klik Post sekali lagi
      if (!confirmed && waited >= 20 && !repostTried && postState.btnVisible) {
        repostTried = true;
        onProgress('Postingan belum terkirim → menekan tombol Post sekali lagi...');
        await cdp.eval(`document.querySelector('button[data-e2e="post_video_button"]')?.click()`).catch(() => {});
      }
      await sleep(2000);
    }

    if (!postState.success) {
      if (postState.btnVisible) {
        await debugShot('post-tidak-terkirim');
        throw new Error(`Postingan belum terkirim: tombol Post masih ada setelah 90 detik. Halaman: ${postState.snippet || postState.href || '-'}`);
      }
      // Form upload sudah hilang tapi teks konfirmasi tidak terbaca → kemungkinan besar terkirim (jangan diulang agar tidak dobel)
      onProgress('[Peringatan] Konfirmasi posting tidak terbaca, tetapi form upload sudah tertutup (kemungkinan besar terkirim).');
    }

    await sleep(3000);
    onProgress(tiktokScheduled ? `Video terjadwal di TikTok untuk ${tiktokScheduled.value}` : 'Postingan TikTok Studio berhasil dipublikasikan!');

    try { await cdp.send('Browser.close'); } catch (e) {}
    cdp.close();
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();

    try {
      if (Notification && Notification.isSupported()) {
        new Notification({
          title: 'AutoUpload TikTok',
          body: tiktokScheduled ? `Video @${accountId} terjadwal di TikTok (${tiktokScheduled.value}).` : `Video TikTok berhasil dipublikasikan untuk akun @${accountId}!`,
          silent: false
        }).show();
      }
    } catch (notifErr) {
      console.warn('Gagal memicu notifikasi desktop:', notifErr.message);
    }

    return { success: true, tiktokScheduled: Boolean(tiktokScheduled), scheduledFor: tiktokScheduled?.at || '' };
  } catch (err) {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      cdp.close();
    }
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    throw err;
  }
}

module.exports = {
  uploadToTikTok,
  setTikTokSchedule
};