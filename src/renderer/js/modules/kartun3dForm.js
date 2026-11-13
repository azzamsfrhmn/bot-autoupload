/**
 * src/renderer/js/modules/kartun3dForm.js
 * Form konsep 3D (mesin animasi lokal yang sama):
 *   - 3D Kartun (kartun3d)       : sumber naskah Otomatis / Tempel JSON / Antrian Naskah
 *   - 3D Cara Kerja (carakerja3d): Tempel JSON / Antrian Naskah + mesin suara Gemini (gratis) / ElevenLabs
 * JSON divalidasi di main SEBELUM memakai kredit suara; pratinjau adegan dirender langsung di renderer.
 * Antrian disimpan per konsep (terpisah). State dibaca dashboard.js lewat getKartun3DState(concept).
 */
import createKartun3D from '../vendor/kartun3d.js';

const CONFIGS = {
  kartun3d: { container: 'containerTikTokKartun3DForm', promptKind: 'kartun', defaultSource: 'auto', autoTopicHint: 'Kosong = AI pilih topik sendiri (tidak dobel)' },
  carakerja3d: { container: 'containerTikTokCaraKerja3DForm', promptKind: 'narator', defaultSource: 'json', voice: true }
};
const states = {};
const $ = (id) => document.getElementById(id);

// ---------- Antrian naskah (per konsep, tersimpan di komputer ini) ----------
const queueKey = (concept) => `reelsQueue:${concept}`;
function readQueue(concept) {
  try { return JSON.parse(localStorage.getItem(queueKey(concept)) || '[]') || []; } catch (e) { return []; }
}
function writeQueue(concept, list) {
  try { localStorage.setItem(queueKey(concept), JSON.stringify(list)); } catch (e) {}
  renderQueue(concept);
}
export function removeKartunQueueItem(concept, id) {
  writeQueue(concept, readQueue(concept).filter((q) => q.id !== id));
}

export function getKartun3DState(concept) {
  const st = states[concept];
  if (!st) return { source: 'auto', spec: null, queue: [] };
  return {
    source: st.source,
    spec: st.source === 'json' ? st.spec : null,
    queue: st.source === 'queue' ? readQueue(concept) : [],
    voiceEngine: st.voiceEngine || 'gemini',
    geminiVoice: $(`${concept}VoiceSelect`)?.value || 'Charon'
  };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderQueue(concept) {
  const list = readQueue(concept);
  const countEl = $(`${concept}QueueCount`);
  if (countEl) countEl.textContent = String(list.length);
  const box = $(`${concept}QueueList`);
  if (box) {
    box.innerHTML = list.length ? '' : '<div style="font-size: 12px; color: var(--text-muted); padding: 10px 12px; border: 1px dashed var(--border-subtle); border-radius: 8px;">Antrian kosong. Pilih "Tempel JSON", tempel naskah yang valid, lalu klik "Tambah ke Antrian".</div>';
    list.forEach((q, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 12px;';
      row.innerHTML = `<span style="font-weight: 700; color: var(--accent-text);">${i + 1}.</span><span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(q.judul)}</span><span style="color: var(--text-muted); white-space: nowrap;">${q.adegan} adegan · ±${q.durasi} dtk</span>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-btn';
      del.textContent = '✕';
      del.title = 'Hapus dari antrian';
      del.style.cssText = 'height: 26px; padding: 0 9px; font-size: 11px; color: #f87171;';
      del.onclick = () => removeKartunQueueItem(concept, q.id);
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  syncRunControls();
}

// ---------- Tombol utama & loop mengikuti mode sumber naskah ----------
function activeConcept() {
  return Object.keys(CONFIGS).find((c) => $(CONFIGS[c].container)?.style.display !== 'none' && $(CONFIGS[c].container)) || null;
}

function syncRunControls() {
  const runBtn = $('btnRunFullReelsPipeline');
  const loopSel = $('reelsLoopCount');
  const concept = activeConcept();
  const st = concept ? states[concept] : null;
  const lockLoop = Boolean(st && st.source !== 'auto');
  if (loopSel) {
    if (lockLoop) {
      if (loopSel.dataset.kartunPrev === undefined) loopSel.dataset.kartunPrev = loopSel.value;
      loopSel.value = '1';
      loopSel.disabled = true;
      loopSel.title = st.source === 'queue' ? 'Mode Antrian: jumlah video = isi antrian' : 'Mode Tempel JSON: 1 JSON = 1 video';
    } else if (loopSel.dataset.kartunPrev !== undefined) {
      loopSel.value = loopSel.dataset.kartunPrev;
      delete loopSel.dataset.kartunPrev;
      loopSel.disabled = false;
      loopSel.title = '';
    }
  }
  if (!runBtn || runBtn.dataset.busy === '1') return;
  const label = runBtn.querySelector('span');
  if (label && runBtn.dataset.defaultLabel === undefined) runBtn.dataset.defaultLabel = label.textContent;
  let ready = true;
  let text = runBtn.dataset.defaultLabel;
  if (st && st.source === 'json') {
    ready = Boolean(st.spec);
    text = ready ? 'Buat Video' : 'Tempel JSON yang valid dulu';
  } else if (st && st.source === 'queue') {
    const n = readQueue(concept).length;
    ready = n > 0;
    text = ready ? `Buat ${n} Video dari Antrian` : 'Antrian naskah masih kosong';
  }
  runBtn.disabled = !ready;
  runBtn.style.opacity = ready ? '' : '0.5';
  if (label && text !== undefined) label.textContent = text;
}

function setSource(concept, source) {
  const cfg = CONFIGS[concept];
  const st = states[concept];
  st.source = source;
  document.querySelectorAll(`.${concept}-source-btn`).forEach((b) => b.classList.toggle('active', b.dataset.source === source));
  const auto = $(`${concept}AutoFields`);
  if (auto) auto.style.display = source === 'auto' ? 'block' : 'none';
  $(`${concept}JsonFields`).style.display = source === 'json' ? 'block' : 'none';
  $(`${concept}QueueFields`).style.display = source === 'queue' ? 'block' : 'none';
  if (concept === 'kartun3d') {
    $('kartun3dCopyPromptBtn').style.display = source === 'auto' ? 'none' : 'inline-flex';
    $('kartun3dTopicHint').textContent = source === 'auto' ? cfg.autoTopicHint : 'Dipakai tombol Salin Prompt untuk claude.ai';
  }
  renderQueue(concept);
}

async function copyPrompt(concept) {
  const btn = $(`${concept}CopyPromptBtn`);
  const fallback = concept === 'carakerja3d' ? 'pilih sendiri satu topik "cara kerja" infrastruktur jalan yang bikin penasaran' : 'pilih sendiri satu topik "bikin X dari nol" yang bikin penasaran';
  const topik = $(`${concept}TopicInput`)?.value.trim() || fallback;
  const target = concept === 'carakerja3d' ? 70 : 80;
  try {
    const prompt = await window.electronAPI.getKartunPrompt(CONFIGS[concept].promptKind);
    await navigator.clipboard.writeText(`${prompt}\n\nTopik: ${topik}. Target ${target} detik. Balas HANYA JSON dalam satu blok kode.`);
    const ori = btn.textContent;
    btn.textContent = '✓ Prompt tersalin';
    setTimeout(() => { btn.textContent = ori; }, 2000);
  } catch (err) {
    alert('Gagal menyalin prompt: ' + err.message);
  }
}

async function validateJson(concept) {
  const st = states[concept];
  const text = $(`${concept}JsonInput`).value;
  const statusEl = $(`${concept}JsonStatus`);
  const previewBtn = $(`${concept}PreviewBtn`);
  const queueBtn = $(`${concept}QueueAddBtn`);
  const grid = $(`${concept}PreviewGrid`);
  st.spec = null;
  st.summary = null;
  previewBtn.disabled = true;
  queueBtn.disabled = true;
  grid.style.display = 'none';
  grid.innerHTML = '';
  if (!text.trim()) {
    statusEl.textContent = 'Belum ada JSON.';
    statusEl.style.color = 'var(--text-muted)';
    statusEl.style.borderColor = 'var(--border-subtle)';
    syncRunControls();
    return;
  }
  const seq = (st.validateSeq = (st.validateSeq || 0) + 1);
  statusEl.textContent = 'Memeriksa JSON...';
  const res = await window.electronAPI.validateKartunJson(text).catch((e) => ({ success: false, error: e.message }));
  if (seq !== st.validateSeq) return;
  if (!res?.success) {
    statusEl.textContent = `✗ ${res?.error || 'JSON tidak valid'}`;
    statusEl.style.color = '#f87171';
    statusEl.style.borderColor = 'rgba(239, 68, 68, 0.35)';
  } else {
    st.spec = res.spec;
    st.summary = { judul: res.judul, adegan: res.adegan, durasi: res.durasi };
    const unit = concept === 'carakerja3d' ? 'karakter suara' : 'karakter ElevenLabs';
    statusEl.innerHTML = `✓ <b>${escapeHtml(res.judul)}</b> · ${res.adegan} adegan · ±${res.karakter.toLocaleString('id-ID')} ${unit} · perkiraan durasi ±${res.durasi} detik`;
    statusEl.style.color = '#34d399';
    statusEl.style.borderColor = 'rgba(16, 185, 129, 0.35)';
    previewBtn.disabled = false;
    queueBtn.disabled = false;
  }
  syncRunControls();
}

function addToQueue(concept) {
  const st = states[concept];
  if (!st.spec) return;
  const list = readQueue(concept);
  list.push({ id: `q_${Date.now()}`, judul: st.summary?.judul || st.spec.judul, adegan: st.summary?.adegan || st.spec.scenes.length, durasi: st.summary?.durasi || 0, spec: st.spec });
  writeQueue(concept, list);
  const btn = $(`${concept}QueueAddBtn`);
  btn.textContent = `✓ Masuk antrian (${list.length})`;
  setTimeout(() => { btn.textContent = '＋ Tambah ke Antrian'; }, 2000);
  $(`${concept}JsonInput`).value = '';
  validateJson(concept);
}

// Timing palsu (tanpa suara): ±0.065 dtk per huruf + 0.12 dtk per kata
function fakeTiming(spec) {
  return spec.scenes.map((s) => {
    let t = 0;
    const words = s.say.split(/\s+/).filter(Boolean).map((w) => {
      const at = t;
      t += w.length * 0.065 + 0.12;
      return [w, +at.toFixed(3)];
    });
    return { end: +Math.max(0.3, t).toFixed(3), words, files: [], trim: 0 };
  });
}

let fontReady = null;
function loadPreviewFont() {
  if (!fontReady) {
    const face = new FontFace('Inter', `url(${new URL('../vendor/Inter-latin.woff2', import.meta.url).href}) format('woff2')`, { weight: '100 900' });
    fontReady = face.load().then((f) => document.fonts.add(f)).catch(() => null);
  }
  return fontReady;
}

async function renderPreview(concept) {
  const st = states[concept];
  if (!st.spec) return;
  const btn = $(`${concept}PreviewBtn`);
  const grid = $(`${concept}PreviewGrid`);
  btn.disabled = true;
  btn.textContent = 'Membuat pratinjau...';
  try {
    await loadPreviewFont();
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const engine = createKartun3D(canvas);
    const info = engine.layout(st.spec, fakeTiming(st.spec));
    grid.innerHTML = '';
    grid.style.display = 'grid';
    const thumb = document.createElement('canvas');
    thumb.width = 216;
    thumb.height = 384;
    const tctx = thumb.getContext('2d');
    for (const [i, [start, dur]] of info.scenes.entries()) {
      // 92% durasi: elemen yang muncul saat kata tertentu diucapkan (mis. hasil rumus) sudah tampil
      engine.renderFrame(start + dur * 0.92);
      tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const cell = document.createElement('div');
      cell.style.cssText = 'position: relative; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle); background: #000;';
      cell.title = st.spec.scenes[i].say;
      cell.innerHTML = `<img src="${thumb.toDataURL('image/jpeg', 0.82)}" style="width: 100%; display: block;"><span style="position: absolute; top: 4px; left: 4px; font-size: 10px; font-weight: 700; background: rgba(0,0,0,0.7); color: #fff; padding: 1px 6px; border-radius: 4px;">${i + 1}</span>`;
      grid.appendChild(cell);
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err) {
    grid.style.display = 'block';
    grid.innerHTML = `<div style="color: #f87171; font-size: 12px;">Pratinjau gagal: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = !st.spec;
    btn.textContent = '🎬 Pratinjau Adegan (tanpa suara)';
  }
}

// ---------- 3D Cara Kerja: mesin suara & tes suara ----------
function setVoiceEngine(concept, engine) {
  const st = states[concept];
  st.voiceEngine = engine === 'elevenlabs' ? 'elevenlabs' : 'gemini';
  document.querySelectorAll(`.${concept}-engine-btn`).forEach((b) => b.classList.toggle('active', b.dataset.engine === st.voiceEngine));
  $(`${concept}GeminiVoiceRow`).style.display = st.voiceEngine === 'gemini' ? 'flex' : 'none';
  $(`${concept}VoiceHint`).textContent = st.voiceEngine === 'gemini'
    ? 'Gratis memakai key Gemini bawaan · ada batas per menit/hari'
    : 'Memakai key ElevenLabs di Pengaturan AI → 3D Kartun (suara narator Liam)';
  try { localStorage.setItem(`${concept}VoiceEngine`, st.voiceEngine); } catch (e) {}
}

async function testVoice(concept) {
  const btn = $(`${concept}TestVoiceBtn`);
  const audio = $(`${concept}VoiceAudio`);
  const voice = $(`${concept}VoiceSelect`).value;
  btn.disabled = true;
  btn.textContent = 'Membuat suara...';
  try {
    const res = await window.electronAPI.testKartunVoice(voice);
    if (!res?.success) throw new Error(res?.error || 'Tes suara gagal');
    audio.src = res.audio;
    await audio.play();
    btn.textContent = '🔊 Memutar...';
    audio.onended = () => { btn.textContent = '🔊 Tes suara'; };
  } catch (err) {
    alert(err.message);
    btn.textContent = '🔊 Tes suara';
  } finally {
    btn.disabled = false;
  }
}

function initConcept(concept) {
  const cfg = CONFIGS[concept];
  const container = $(cfg.container);
  if (!container) return;
  states[concept] = { source: cfg.defaultSource, spec: null };
  document.querySelectorAll(`.${concept}-source-btn`).forEach((b) => b.addEventListener('click', () => setSource(concept, b.dataset.source)));
  $(`${concept}CopyPromptBtn`)?.addEventListener('click', () => copyPrompt(concept));
  let timer = null;
  $(`${concept}JsonInput`)?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => validateJson(concept), 500);
  });
  $(`${concept}PreviewBtn`)?.addEventListener('click', () => renderPreview(concept));
  $(`${concept}QueueAddBtn`)?.addEventListener('click', () => addToQueue(concept));
  if (cfg.voice) {
    document.querySelectorAll(`.${concept}-engine-btn`).forEach((b) => b.addEventListener('click', () => setVoiceEngine(concept, b.dataset.engine)));
    $(`${concept}TestVoiceBtn`)?.addEventListener('click', () => testVoice(concept));
    let saved = 'gemini';
    try { saved = localStorage.getItem(`${concept}VoiceEngine`) || 'gemini'; } catch (e) {}
    setVoiceEngine(concept, saved);
  }
  // Ganti konsep (form tampil / sembunyi) → tombol utama & loop disesuaikan
  new MutationObserver(syncRunControls).observe(container, { attributes: true, attributeFilter: ['style'] });
  setSource(concept, cfg.defaultSource);
}

export function initKartun3DForm() {
  Object.keys(CONFIGS).forEach(initConcept);
}
