/**
 * src/renderer/js/modules/serial3dForm.js
 * Form konsep Serial Animasi Day-N (SA):
 *   1. Karakter: upload gambar → Gemini membaca ciri → karakter 3D (disimpan per pelanggan, ada potret)
 *   2. Premis serial (disimpan per karakter)
 *   3. Naskah: dibuat Gemini dari premis (DAY otomatis lanjut) · bisa diedit · kosong = dibuat saat Render
 *   4. Suara Gemini · 5. Render
 * State dibaca dashboard.js lewat getSerial3DState().
 */
const $ = (id) => document.getElementById(id);
const st = { presets: null, character: '', voice: '', script: null, scriptText: '', imagePath: '', validating: 0, busy: false };

// Pesan di dalam form. JANGAN pakai alert/confirm: di Electron, setelah dialog itu kolom teks tidak bisa diketik.
function pesan(teks, el = 'serial3dGenStatus', warna = '#f87171') {
  const n = document.getElementById(el) || document.getElementById('serial3dGenStatus');
  if (!n) return; n.textContent = teks; n.style.color = warna;
  try { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => `file:///${encodeURI(String(p).replace(/\\/g, '/'))}?t=${Date.now()}`;
const allChars = () => [...(st.presets?.milik || []), ...(st.presets?.contoh || [])];
const curChar = () => allChars().find((k) => k.id === st.character) || null;
const premis = () => ($('serial3dPremiseInput')?.value || '').trim();
const latar = () => $('serial3dWorldSelect')?.value || '';
const rencana = () => $('serial3dPlanInput')?.value || '';
const suasana = () => $('serial3dTimeSelect')?.value || '';

export function getSerial3DState() {
  const hasText = Boolean(($('serial3dJsonInput')?.value || '').trim());
  return {
    serialCharacter: st.character,
    serialVoice: st.voice || '',
    serialScriptId: '',
    serialScript: hasText ? st.script : null,
    serialPremise: premis(),
    serialWorld: latar(),
    serialPlan: rencana(),
    serialTime: suasana(),
    // siap = karakter dipilih & (naskah valid, atau editor kosong + premis terisi → AI menulis saat render)
    ready: Boolean(st.character) && (hasText ? Boolean(st.script) : true),
    reason: !st.character ? (st.imagePath ? 'Klik "Buat Karakter 3D" dulu (langkah 1)' : 'Paste gambar karakter dulu (langkah 1)') : hasText && !st.script ? 'Naskah di editor belum valid' : ''
  };
}

function syncRunButton() {
  const runBtn = $('btnRunFullReelsPipeline');
  const container = $('containerTikTokSerial3DForm');
  if (!runBtn || !container || container.style.display === 'none' || runBtn.dataset.busy === '1') return;
  const label = runBtn.querySelector('span');
  if (label && runBtn.dataset.defaultLabel === undefined) runBtn.dataset.defaultLabel = label.textContent;
  const s = getSerial3DState();
  runBtn.disabled = !s.ready; runBtn.style.opacity = s.ready ? '' : '0.5';
  if (label) label.textContent = s.ready ? '🎬 Render Video Serial (GPU, gratis)' : s.reason;
}

function dot(c, title) { return `<span title="${esc(title)}" style="width:12px;height:12px;border-radius:50%;background:${esc(c)};border:1px solid rgba(0,0,0,.4);display:inline-block;"></span>`; }

function renderCharacters() {
  const boxOwn = $('serial3dCharacterList'); if (!boxOwn || !st.presets) return;
  const boxContoh = $('serial3dContohList') || boxOwn;
  boxOwn.innerHTML = ''; if (boxContoh !== boxOwn) boxContoh.innerHTML = '';
  // contoh terbuka hanya bila sedang dipakai / pelanggan belum punya karakter sendiri
  const det = $('serial3dContohBox'); if (det && (st.presets.contoh || []).some((k) => k.id === st.character)) det.open = true;
  const add = (k, own) => {
    const box = own ? boxOwn : boxContoh;
    const on = k.id === st.character;
    const card = document.createElement('div');
    card.style.cssText = `cursor:pointer;padding:10px;border-radius:10px;border:1px solid ${on ? 'rgba(53,178,159,.7)' : 'var(--border-subtle)'};background:${on ? 'rgba(53,178,159,.12)' : 'rgba(255,255,255,.03)'};color:#e7e5e0;display:flex;gap:10px;align-items:center;position:relative;`;
    const img = own && (k.potret || k.ref) ? `<div style="width:54px;height:72px;flex:none;border-radius:6px;background:#1b1f27 url('${fileUrl(k.potret || k.ref)}') center/cover;"></div>` + (k.ref && k.potret ? `<div title="gambar referensi" style="width:30px;height:40px;flex:none;border-radius:4px;background:url('${fileUrl(k.ref)}') center/cover;opacity:.85;margin-left:-6px;"></div>` : '')
      : `<div style="display:flex;flex-direction:column;gap:3px;flex:none;">${dot(k.kulit, 'kulit')}${dot(k.rambut.warna, 'rambut')}${dot(k.atasan.warna, 'atasan')}${dot(k.bawahan.warna, 'bawahan')}</div>`;
    card.innerHTML = `${img}<div style="flex:1;min-width:0;">
      <div style="font-weight:700;font-size:12.5px;">${esc(k.nama)} ${on ? '<span style="color:var(--accent-text);font-size:11px;">✓ dipakai</span>' : ''} ${own ? '' : '<span style="font-size:10px;color:#9d9c97;border:1px solid var(--border-subtle);border-radius:4px;padding:0 4px;">contoh</span>'}</div>
      <div style="font-size:11px;color:#9d9c97;line-height:1.35;">${esc(k.deskripsi || '')}</div>
      <div style="font-size:10.5px;color:#9d9c97;">${k.jenis === 'hewan' ? `🐾 hewan · telinga ${esc(k.hewan?.telinga)} · ekor ${esc(k.hewan?.ekor)} · ${esc(k.hewan?.pola)} · ` : ''}${esc(k.rambut.model)} · ${esc(k.atasan.model)} · ${esc(k.bawahan.model)} · ${esc(k.aksesori)} · suara ${esc(k.suara?.nama)}${own && k.hariBerikut > 1 ? ` · <b style="color:var(--accent-text)">berikutnya DAY ${k.hariBerikut}</b>` : ''}</div></div>`;
    if (own) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'chip-btn'; del.textContent = '✕'; del.title = 'Hapus karakter';
      del.style.cssText = 'position:absolute;top:6px;right:6px;height:22px;padding:0 7px;font-size:10px;color:#f87171;';
      del.onclick = async (e) => { e.stopPropagation(); if (del.dataset.yakin !== '1') { del.dataset.yakin = '1'; del.textContent = 'Hapus?'; del.style.padding = '0 8px'; setTimeout(() => { del.dataset.yakin = ''; del.textContent = '✕'; }, 3000); return; } await window.electronAPI.serial3dDeleteCharacter(k.id); if (st.character === k.id) st.character = ''; await reload(); };
      card.appendChild(del);
    }
    card.onclick = () => selectCharacter(k.id);
    box.appendChild(card);
  };
  (st.presets.milik || []).forEach((k) => add(k, true));
  (st.presets.contoh || []).forEach((k) => add(k, false));
}

async function selectCharacter(id) {
  st.character = id; renderCharacters(); updateVoiceHint();
  const k = curChar();
  const info = $('serial3dSeriesInfo'), pi = $('serial3dPremiseInput'), day = $('serial3dDayInput');
  if (k?.milik) {
    const r = await window.electronAPI.serial3dSeriesInfo(id).catch(() => null);
    if (r?.success) {
      if (pi && (r.premis || !pi.value.trim())) pi.value = r.premis || '';
      if ($('serial3dWorldSelect')) $('serial3dWorldSelect').value = r.latar || '';
      if ($('serial3dPlanInput')) $('serial3dPlanInput').value = r.rencana || '';
      if ($('serial3dTimeSelect')) $('serial3dTimeSelect').value = r.suasana || '';
      if (day) day.value = r.hariBerikut;
      if ($('serial3dResetBtn')) { $('serial3dResetBtn').style.display = r.episodes.length ? '' : 'none'; $('serial3dResetBtn').textContent = '↺ Ulang ke DAY 1'; }
      if (info) info.textContent = r.episodes.length ? `${r.judul || 'Serial'} · sudah ${r.episodes.length} episode · berikutnya DAY ${r.hariBerikut}` : 'Belum ada episode · mulai dari DAY 1';
    }
  } else { if (info) info.textContent = 'Karakter contoh: riwayat serial tidak disimpan'; if ($('serial3dResetBtn')) $('serial3dResetBtn').style.display = 'none'; }
  syncRunButton();
}

function updateVoiceHint() {
  const k = curChar(); const hint = $('serial3dVoiceHint');
  if (hint) hint.textContent = k ? `Bawaan ${k.nama}: ${k.suara?.nama} (${k.suara?.gaya || ''})` : '';
}

async function reload() {
  st.presets = await window.electronAPI?.serial3dPresets?.().catch(() => null);
  if (!st.presets) return;
  if (!st.character) st.character = st.presets.milik?.[0]?.id || '';
  renderCharacters(); updateVoiceHint();
  if (st.character) selectCharacter(st.character);
  syncRunButton();
}

async function validateJson() {
  const ta = $('serial3dJsonInput'), status = $('serial3dJsonStatus');
  if (!ta || !status) return;
  const text = ta.value.trim();
  if (!text) { st.script = null; status.innerHTML = 'Belum ada naskah. Klik <b>Buat Naskah dengan AI</b>, atau biarkan kosong: AI menulis otomatis saat Render.'; status.style.color = 'var(--text-muted)'; syncRunButton(); return; }
  const seq = ++st.validating;
  const r = await window.electronAPI?.serial3dValidate?.(text);
  if (seq !== st.validating) return;
  if (r?.success) {
    st.script = r.naskah;
    status.innerHTML = `✓ Naskah siap: <b>${esc(r.judul)}</b> · ${r.kalimat} kalimat`;
    status.style.color = '#34d399';
  } else {
    st.script = null;
    status.innerHTML = `✗ Naskah belum valid:<br>${(r?.errors || ['gagal memeriksa']).slice(0, 8).map((x) => `• ${esc(x)}`).join('<br>')}`;
    status.style.color = '#f87171';
  }
  syncRunButton();
}

const busyBtn = async (btn, text, fn) => {
  if (!btn || btn.disabled) return; const ori = btn.textContent; btn.disabled = true; btn.textContent = text;
  try { await fn(); } finally { btn.disabled = false; btn.textContent = ori; }
};

export async function initSerial3DForm() {
  if (!$('containerTikTokSerial3DForm')) return;
  const api = window.electronAPI;
  await reload();
  if (!st.presets) return;

  // ----- 1. karakter dari gambar -----
  const createBtn = $('serial3dCreateCharBtn'), charStatus = $('serial3dCharStatus');
  const pakaiGambar = (p) => {
    st.imagePath = p;
    const pv = $('serial3dRefPreview'); if (pv) { pv.style.backgroundImage = p ? `url("${fileUrl(p)}")` : 'none'; pv.innerHTML = p ? '' : 'Belum ada<br>gambar'; }
    if (createBtn) createBtn.disabled = !p;
    if (charStatus && p) { charStatus.textContent = 'Gambar diterima, membuat karakter 3D otomatis...'; charStatus.style.color = 'var(--text-muted)'; }
    renderGallery(); syncRunButton();
  };
  // galeri gambar yang pernah di-paste (tersimpan permanen)
  async function renderGallery() {
    const box = $('serial3dImageGallery'); if (!box) return;
    const r = await api.serial3dListImages().catch(() => null);
    box.innerHTML = '';
    (r?.files || []).slice(0, 16).forEach((f) => {
      const on = f === st.imagePath;
      const t = document.createElement('div');
      t.title = 'Klik untuk pakai gambar ini';
      t.style.cssText = `position:relative;width:46px;height:60px;border-radius:6px;cursor:pointer;background:#1b1f27 url('${fileUrl(f)}') center/cover;border:2px solid ${on ? 'var(--accent-text)' : 'transparent'};`;
      t.onclick = () => { if (createBtn?.disabled && st.imagePath) return; pakaiGambar(f); otomatis(f); };
      const x = document.createElement('span'); x.textContent = '✕'; x.title = 'Hapus dari galeri';
      x.style.cssText = 'position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:#2a2d33;color:#f87171;font-size:9px;display:grid;place-items:center;border:1px solid var(--border-subtle);';
      x.onclick = async (e) => { e.stopPropagation(); await api.serial3dDeleteImage(f); if (st.imagePath === f) pakaiGambar(''); else renderGallery(); };
      t.appendChild(x); box.appendChild(t);
    });
  }
  // gambar dipilih → otomatis jadi karakter 3D (atau pilih karakter yang dulu dibuat dari gambar ini)
  const otomatis = async (p) => {
    const lama = (st.presets?.milik || []).find((k) => k.sumber && k.sumber === p);
    if (lama) { st.imageDipakai = p; if (charStatus) { charStatus.textContent = `✓ Gambar ini sudah jadi karakter ${lama.nama}, langsung dipakai.`; charStatus.style.color = '#34d399'; } selectCharacter(lama.id); return; }
    if (createBtn && !createBtn.disabled) await busyBtn(createBtn, 'AI membaca gambar & membuat 3D...', buatKarakterDariGambar);
  };
  const paste = async () => {
    const r = await api.serial3dPasteImage();
    if (!r?.success) { if (charStatus) { charStatus.textContent = '✗ ' + (r?.error || 'gagal paste'); charStatus.style.color = '#f87171'; } return; }
    pakaiGambar(r.path);
    otomatis(r.path);
  };
  $('serial3dPasteImageBtn')?.addEventListener('click', paste);
  // Ctrl+V di mana saja pada form SA (kecuali saat mengetik di kolom teks)
  document.addEventListener('paste', (e) => {
    const c = $('containerTikTokSerial3DForm');
    if (!c || c.style.display === 'none' || c.offsetParent === null) return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    if (![...(e.clipboardData?.items || [])].some((i) => i.type.startsWith('image/'))) return;
    e.preventDefault(); paste();
  });
  renderGallery();
  // gambar sudah di-paste tapi belum diproses → buat karakternya (dipakai tombol Buat Karakter & Buat Naskah)
  async function buatKarakterDariGambar() {
    if (charStatus) { charStatus.textContent = 'Gemini membaca ciri karakter, lalu merender versi 3D-nya...'; charStatus.style.color = 'var(--text-muted)'; }
    const r = await api.serial3dCreateCharacter({ imagePath: st.imagePath, nama: ($('serial3dNameInput')?.value || '').trim() });
    if (!r?.success) { if (charStatus) { charStatus.textContent = '✗ ' + (r?.error || 'gagal'); charStatus.style.color = '#f87171'; } return false; }
    if (charStatus) { charStatus.textContent = `✓ Karakter ${r.karakter.nama} siap: ${r.karakter.deskripsi || ''}`; charStatus.style.color = '#34d399'; }
    st.character = r.karakter.id; st.imageDipakai = st.imagePath; await reload();
    return true;
  }
  st.ensureCharacter = async () => {
    if (st.imagePath && st.imageDipakai !== st.imagePath && !curChar()?.milik) return buatKarakterDariGambar();
    return Boolean(st.character);
  };
  createBtn?.addEventListener('click', () => busyBtn(createBtn, 'AI membaca gambar & membuat 3D...', buatKarakterDariGambar));

  // ----- 2. premis -----
  const pi = $('serial3dPremiseInput'); let ptmr = null;
  pi?.addEventListener('input', () => { syncRunButton(); clearTimeout(ptmr); ptmr = setTimeout(() => { if (curChar()?.milik) api.serial3dSavePremise({ id: st.character, premis: premis() }); }, 600); });
  // ulang ke DAY 1 (klik dua kali, tanpa dialog bawaan supaya kolom teks tidak macet)
  const resetBtn = $('serial3dResetBtn'); let resetTmr = null;
  resetBtn?.addEventListener('click', async () => {
    if (!resetBtn.dataset.yakin) { resetBtn.dataset.yakin = '1'; resetBtn.textContent = 'Yakin? klik lagi'; clearTimeout(resetTmr); resetTmr = setTimeout(() => { delete resetBtn.dataset.yakin; resetBtn.textContent = '↺ Ulang ke DAY 1'; }, 3000); return; }
    delete resetBtn.dataset.yakin; clearTimeout(resetTmr);
    await api.serial3dResetSeries(st.character);
    const ed = $('serial3dJsonInput'); if (ed) { ed.value = ''; await validateJson(); }
    await selectCharacter(st.character);
    pesan('✓ Serial diulang: episode berikutnya DAY 1 (premis & rencana tetap).', 'serial3dGenStatus', '#34d399');
  });
  const plan = $('serial3dPlanInput'); let rtmr = null;
  plan?.addEventListener('input', () => { clearTimeout(rtmr); rtmr = setTimeout(() => { if (curChar()?.milik) api.serial3dSavePremise({ id: st.character, premis: premis(), rencana: rencana() }); }, 600); });
  const planBtn = $('serial3dPlanBtn'), planStatus = $('serial3dPlanStatus');
  planBtn?.addEventListener('click', () => busyBtn(planBtn, 'AI menyusun premis & rencana...', async () => {
    if (st.imagePath && st.imageDipakai !== st.imagePath && !curChar()?.milik) {
      if (planStatus) planStatus.textContent = 'Membuat karakter 3D dari gambar dulu...';
      if (!(await st.ensureCharacter())) { if (planStatus) planStatus.textContent = ''; return; }
    }
    if (!st.character) { pesan('👆 Paste gambar karakter dulu (langkah 1), atau buka "karakter contoh".', 'serial3dPlanStatus'); return; }
    if (planStatus) { planStatus.textContent = premis().length >= 10 ? 'Menyusun rencana DAY 1–10 dari premis kamu...' : 'Membuat premis + rencana DAY 1–10...'; planStatus.style.color = 'var(--text-muted)'; }
    const r = await api.serial3dGeneratePlan({ karakterId: st.character, premis: premis(), latar: latar(), suasana: suasana() });
    if (!r?.success) { pesan('✗ ' + (r?.error || 'gagal'), 'serial3dPlanStatus'); return; }
    if (pi) pi.value = r.premis; if (plan) plan.value = r.rencana;
    const lh = $('serial3dLatarHint'); if (lh) lh.style.display = 'none';
    if (planStatus) { planStatus.textContent = `✓ ${r.judul ? r.judul + ' · ' : ''}rencana DAY 1–10 siap, silakan edit`; planStatus.style.color = '#34d399'; }
    syncRunButton();
  }));
  ['serial3dWorldSelect', 'serial3dTimeSelect'].forEach((id) => $(id)?.addEventListener('change', () => {
    const lh = $('serial3dLatarHint');
    if (lh && premis().length >= 10) { lh.innerHTML = '👉 Latar/waktu diganti. Klik <b>✨ Buat Premis &amp; Rencana Otomatis</b> (langkah 3) supaya premis &amp; rencana ikut menyesuaikan.'; lh.style.display = ''; } if (curChar()?.milik) api.serial3dSavePremise({ id: st.character, premis: premis(), latar: latar(), suasana: suasana() }); }));

  // ----- 3. naskah AI -----
  const ta = $('serial3dJsonInput'); let tmr = null;
  ta?.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(validateJson, 400); });
  const genBtn = $('serial3dGenerateBtn'), genStatus = $('serial3dGenStatus');
  genBtn?.addEventListener('click', () => busyBtn(genBtn, 'AI sedang menulis naskah...', async () => {
    if (st.imagePath && st.imageDipakai !== st.imagePath && !curChar()?.milik) {
      if (genStatus) { genStatus.textContent = 'Membuat karakter 3D dari gambar dulu...'; genStatus.style.color = 'var(--text-muted)'; }
      if (!(await st.ensureCharacter())) { if (genStatus) genStatus.textContent = ''; return; }
    }
    if (!st.character) { pesan('👆 Paste gambar karakter dulu (langkah 1), atau buka "karakter contoh".'); return; }
    if (genStatus) { genStatus.textContent = 'Gemini menulis & memeriksa naskah, ±20–60 detik...'; genStatus.style.color = 'var(--text-muted)'; }
    const r = await api.serial3dGenerateScript({ karakterId: st.character, premis: premis(), rencana: rencana(), latar: latar(), suasana: suasana(), hari: Number($('serial3dDayInput')?.value) || undefined });
    if (!r?.success) { if (genStatus) { genStatus.textContent = '✗ ' + (r?.error || 'gagal'); genStatus.style.color = '#f87171'; } return; }
    if (ta) ta.value = r.json;
    if (r.premis && pi && !premis()) pi.value = r.premis;
    if (r.rencana && $('serial3dPlanInput')) $('serial3dPlanInput').value = r.rencana;
    if (genStatus) { genStatus.textContent = `✓ ${r.judul} (${r.kalimat} kalimat, ${r.model})`; genStatus.style.color = '#34d399'; }
    await validateJson();
  }));

  // lanjutan: naskah contoh
  const sel = $('serial3dExampleSelect');
  if (sel) sel.innerHTML = st.presets.naskah.map((n) => `<option value="${esc(n.id)}">${esc(n.judul)} (${n.kalimat} kalimat)</option>`).join('');
  $('serial3dCopyExampleBtn')?.addEventListener('click', async () => {
    const json = await api.serial3dExample(sel?.value || 'pulau_day1');
    if (ta) { ta.value = json; validateJson(); }
  });
  const lib = $('serial3dLibrary');
  if (lib) { const p = st.presets.pustaka; lib.innerHTML = `<b>shot:</b> ${p.shot.join(', ')}<br><b>ekspresi:</b> ${p.ekspresi.join(', ')}<br><b>gestur:</b> ${p.gestur.join(', ')}<br><b>kartu:</b> ${p.kartu.join(', ')}`; }

  // pratinjau
  const pvBtn = $('serial3dPreviewBtn'), grid = $('serial3dPreviewGrid');
  pvBtn?.addEventListener('click', () => busyBtn(pvBtn, 'Merender pratinjau di GPU...', async () => {
    if (!st.character) { pesan('👆 Buat / pilih karakter dulu (langkah 1).', 'serial3dCharStatus'); return; }
    if (!st.script) { pesan('👆 Buat naskah dulu (klik Buat Naskah dengan AI).', 'serial3dPreviewInfo'); return; }
    const r = await api.serial3dPreview({ serialScript: st.script, serialCharacter: st.character, serialWorld: latar(), serialTime: suasana() });
    if (!r?.success) { pesan('✗ Pratinjau gagal: ' + (r?.error || '?'), 'serial3dPreviewInfo'); return; }
    if (grid) {
      grid.style.display = 'grid';
      grid.innerHTML = r.files.map((f) => `<img src="${fileUrl(f)}" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;border:1px solid var(--border-subtle);" loading="lazy">`).join('');
      const info = $('serial3dPreviewInfo'); if (info) info.textContent = `${r.files.length} adegan · ±${Math.round(r.duration)} dtk`;
    }
  }));

  // ----- 4. suara -----
  const vs = $('serial3dVoiceSelect');
  if (vs) { vs.innerHTML = '<option value="">Bawaan karakter</option>' + st.presets.suara.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); vs.onchange = () => { st.voice = vs.value; }; }
  const tvBtn = $('serial3dTestVoiceBtn'), audio = $('serial3dVoiceAudio');
  tvBtn?.addEventListener('click', () => busyBtn(tvBtn, 'Membuat suara...', async () => {
    if (!st.character) { pesan('👆 Buat / pilih karakter dulu (langkah 1).', 'serial3dCharStatus'); return; }
    const r = await api.serial3dTestVoice({ serialCharacter: st.character, serialVoice: st.voice || '' });
    if (!r?.success) { pesan('✗ Tes suara gagal: ' + (r?.error || '?'), 'serial3dVoiceHint'); return; }
    if (audio) { audio.src = r.audio; audio.style.display = 'block'; audio.play().catch(() => {}); }
  }));

  // key Gemini pribadi
  const keyState = $('serial3dKeyState'), keyInput = $('serial3dKeyInput'), keyBtn = $('serial3dKeySaveBtn');
  const showKey = (r) => { if (keyState) { keyState.textContent = r?.ada ? `· aktif (${r.masked})` : '· belum diisi'; keyState.style.color = r?.ada ? '#34d399' : 'var(--text-muted)'; } };
  api.serial3dGetKey?.().then(showKey).catch(() => {});
  keyBtn?.addEventListener('click', () => busyBtn(keyBtn, 'Mengecek...', async () => {
    const r = await api.serial3dSaveKey(keyInput?.value || '');
    if (!r?.success) { if (keyState) { keyState.textContent = '· ✗ ' + (r?.error || 'gagal menyimpan'); keyState.style.color = '#f87171'; } return; }
    if (keyInput) keyInput.value = ''; showKey(r);
  }));

  validateJson();
  document.querySelectorAll('.reels-concept-card').forEach((c) => c.addEventListener('click', () => setTimeout(syncRunButton, 0)));
  // setelah render selesai: DAY berikutnya & riwayat diperbarui, editor dikosongkan agar episode berikutnya ditulis baru
  window.electronAPI?.onRefreshVideoGallery?.((res) => { if (res?.concept === 'serial3d') { if (ta) ta.value = ''; st.script = null; reload(); validateJson(); } });
}
