/**
 * Menutup dialog sambutan / onboarding Google Flow pada akun yang baru login
 * ("Gunakan dan kembangkan alat AI untuk kreativitas" → centang semua → Berikutnya, dst).
 * Tombol Logout / Batal tidak pernah diklik.
 */

const FLOW_ONBOARDING_SCRIPT = `
(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const NEXT = /^(berikutnya|next|lanjutkan|continue|setuju|saya setuju|i agree|agree|accept|terima|mulai|get started|let's go|ayo mulai|oke|ok|got it|mengerti|selesai|done|tutup|close)$/i;
  const BLOCK = /log ?out|keluar|batal|cancel|sign out|sebelumnya|back|previous|kembali/i;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-overlay-pane, dialog[open]'))
    .filter(visible)
    .filter((d) => !d.querySelector('flow-prompt-box-settings, flow-toggles, .flow-model-picker-panel'));
  const done = [];
  // Banner promosi aplikasi Flow ("Take Google Flow on the road ... new Flow App") bisa menutupi tombol Project baru
  document.querySelectorAll('flow-smart-app-banner').forEach((b) => {
    if (!visible(b)) return;
    const close = Array.from(b.querySelectorAll('button, [role="button"]'))
      .find((x) => /close|tutup|dismiss|tidak sekarang|not now/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')));
    if (close) close.click();
    b.remove();
    done.push('banner aplikasi Flow');
  });
  // Banner biru "Masa berlaku kreasi terlama Anda akan segera berakhir… Terapkan kebijakan saat ini" muncul belakangan
  // & menggeser seluruh halaman ke bawah → tutup lewat ✕ saja (menerapkan kebijakan = keputusan pemilik akun)
  document.querySelectorAll('flow-retention-optin-banner, flow-banner').forEach((b) => {
    if (!visible(b) || !/masa berlaku kreasi|kebijakan|retention|expire/i.test(b.innerText || '')) return;
    const close = Array.from(b.querySelectorAll('button, [role="button"]'))
      .find((x) => /close|tutup|dismiss|tutup banner/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')) && !/terapkan|apply/i.test(x.innerText || ''));
    if (close) close.click(); else b.style.display = 'none';
    done.push('banner masa berlaku kreasi');
  });
  for (const d of dialogs) {
    d.querySelectorAll('input[type="checkbox"]').forEach((c) => {
      if (!c.checked && !c.disabled) { (c.closest('label') || c).click(); if (!c.checked) c.click(); done.push('centang'); }
    });
    d.querySelectorAll('[role="checkbox"][aria-checked="false"]').forEach((c) => { c.click(); done.push('centang'); });
    // Teks panjang (mis. "Tinjau kebijakan privasi"): gulir sampai bawah agar tombol Lanjutkan aktif
    [d, ...d.querySelectorAll('*')].forEach((el) => {
      if (el.scrollHeight - el.clientHeight < 4 || el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && el !== d) return;
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      done.push('gulir ke bawah');
    });
    const candidates = Array.from(d.querySelectorAll('button, [role="button"], a')).filter((b) => {
      const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
      return visible(b) && t && NEXT.test(t) && !BLOCK.test(t);
    });
    const isDisabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';
    const btn = candidates.find((b) => !isDisabled(b));
    if (btn) { btn.click(); done.push((btn.innerText || '').trim()); }
    else if (candidates.length) done.push('menunggu tombol ' + (candidates[0].innerText || '').trim() + ' aktif');
  }
  return done;
})()
`;

/**
 * @param {(expression: string) => Promise<any>} evaluate - menjalankan ekspresi di halaman Flow, mengembalikan nilai
 */
async function dismissFlowOnboarding(evaluate, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let total = 0;
  for (let round = 0; round < 12; round++) {
    const done = await Promise.resolve(evaluate(FLOW_ONBOARDING_SCRIPT)).catch(() => []);
    if (!Array.isArray(done) || !done.length) break;
    total += done.length;
    onProgress(`Menutup popup sambutan Google Flow: ${done.join(', ')}`);
    await sleep(1500);
  }
  return total;
}

/**
 * Di project baru: tutup panel Agen di kanan, lalu matikan chip "Agen" pada kotak prompt
 * agar prompt diproses sebagai render biasa.
 */
async function disableFlowAgent(evaluate, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const run = (expression) => Promise.resolve(evaluate(expression)).catch(() => null);
  for (let round = 0; round < 5; round++) {
    const state = await run(`
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const closeBtn = Array.from(document.querySelectorAll('.agent-panel-header button[aria-label="Tutup"], .agent-panel-header button[aria-label="Close"]')).find(visible);
        if (closeBtn) { closeBtn.click(); return 'panel'; }
        const chip = document.querySelector('flow-agent-mode-toggle-chip button[aria-pressed="true"], button.agent-mode-chip-checked');
        if (chip && visible(chip)) { chip.click(); return 'chip'; }
        return '';
      })()
    `);
    if (state === 'panel') onProgress('Menutup panel Agen Google Flow...');
    else if (state === 'chip') onProgress('Mematikan mode Agen pada kotak prompt...');
    else return;
    await sleep(1200);
  }
}

/**
 * Dialog "Hak untuk menggunakan gambar ini" (muncul setelah gambar ditempel ke prompt Flow).
 * Klik "Saya setuju" dengan gerakan mouse ala manusia (klik DOM biasa ditolak), lalu pastikan dialog tertutup.
 * @param {{ send: Function }} cdp - klien CDP mentah (Input.dispatchMouseEvent)
 */
async function agreeFlowImageRights(cdp, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const findAgree = async () => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
            .find((b) => visible(b) && /^(saya setuju|setuju|i agree|agree)$/i.test((b.innerText || '').trim())
              && /hak untuk menggunakan|right to use|hak yang diperlukan|necessary rights/i.test((b.closest('[role="dialog"], mat-dialog-container, .cdk-overlay-pane') || document.body).innerText || ''));
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
        })()
      `,
      returnByValue: true
    }).catch(() => null);
    return r?.result?.value || null;
  };

  let btn = await findAgree();
  if (!btn) return false;
  onProgress('Dialog "Hak untuk menggunakan gambar ini" muncul → klik "Saya setuju" (mode manusia)...');

  for (let attempt = 1; attempt <= 4 && btn; attempt++) {
    // Titik acak di dalam tombol (bukan tepat di tengah) + kursor bergerak bertahap dari samping
    const tx = btn.x + (Math.random() - 0.5) * Math.min(20, btn.w * 0.4);
    const ty = btn.y + (Math.random() - 0.5) * Math.min(8, btn.h * 0.4);
    const sx = tx - 160 - Math.random() * 120;
    const sy = ty + 80 + Math.random() * 60;
    const steps = 14 + Math.floor(Math.random() * 8);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + (tx - sx) * ease, y: sy + (ty - sy) * ease });
      await sleep(12 + Math.random() * 18);
    }
    await sleep(250 + Math.random() * 350);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(70 + Math.random() * 90);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(1500);

    btn = await findAgree();
    if (!btn) {
      onProgress('Persetujuan hak gambar diterima ✓');
      return true;
    }
    onProgress(`"Saya setuju" belum tertutup, mencoba lagi (${attempt}/4)...`);
  }
  return !btn;
}

/**
 * Nyalakan "Tampilkan video senyap" (menu Setelan / gear di header project) sebelum render.
 * Video Daster memakai suara dari TikTok, jadi hasil tanpa suara harus langsung ditampilkan.
 * @param {{ send: Function }} cdp - klien CDP mentah
 */
async function setSilentVideosShown(cdp, wantOn, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const evaluate = (expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value).catch(() => null);
  const click = async (pos) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(70);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const center = (sel) => evaluate(`
    (() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, checked: el.getAttribute('aria-checked') };
    })()
  `);
  const TOGGLE = 'button[name="return-silent-videos"]';

  for (let attempt = 1; attempt <= 3; attempt++) {
    let toggle = await center(TOGGLE);
    if (!toggle) {
      const gear = await center('button[aria-label="Setelan"], button[aria-label="Settings"]');
      if (!gear) { onProgress('[Peringatan] Tombol Setelan Flow tidak ditemukan, saklar video senyap dilewati.'); return false; }
      await click(gear);
      for (let i = 0; i < 10 && !toggle; i++) { await sleep(400); toggle = await center(TOGGLE); }
    }
    if (!toggle) continue;

    const want = wantOn ? 'true' : 'false';
    if (toggle.checked !== want) {
      onProgress(`${wantOn ? 'Menyalakan' : 'Mematikan'} "Tampilkan video senyap" di Setelan Flow...`);
      await click(toggle);
      await sleep(900);
      toggle = await center(TOGGLE);
    }
    const done = toggle && toggle.checked === want;
    // Tutup menu Setelan
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(600);
    if (done) { onProgress(`"Tampilkan video senyap" ${wantOn ? 'aktif' : 'mati'} ✓`); return true; }
  }
  onProgress(`[Peringatan] Saklar "Tampilkan video senyap" belum bisa ${wantOn ? 'dinyalakan' : 'dimatikan'}.`);
  return false;
}

// Konsep yang memakai musik TikTok (JJ/Daster): hasil boleh tanpa suara
const ensureSilentVideosShown = (cdp, onProgress, sleep) => setSilentVideosShown(cdp, true, onProgress, sleep);
// Konsep bersuara (Sensasi: suara karakter, POV: voice over): saklar wajib mati
const ensureSilentVideosHidden = (cdp, onProgress, sleep) => setSilentVideosShown(cdp, false, onProgress, sleep);

module.exports = { dismissFlowOnboarding, disableFlowAgent, agreeFlowImageRights, ensureSilentVideosShown, ensureSilentVideosHidden, FLOW_ONBOARDING_SCRIPT };
