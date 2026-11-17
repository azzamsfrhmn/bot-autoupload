// Lapisan UI 2D (DOM): badge DAY N, cover, kartu, caption kata-per-kata, stiker teriak, penutup, kilau.
// Semua dibangun dari naskah + timeline, lalu digambar per frame oleh draw(t, st).
import { clamp, lerp, smooth, easeOutBack, pop, norm } from './lib.js';

const W = 1080;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/<(?!\/?b>)/g, '&lt;');   // izinkan <b> saja

/**
 * @param {object} o { naskah, TL, L, ORDER, Wt, shotStart(lineIdx)->t, COVER_END, OUTRO_T, CUT, sfx(t,type) }
 */
export function buildUI(o) {
  const { naskah, TL, L, ORDER, Wt, COVER_END, OUTRO_T, CUT, sfx } = o;
  const ui = document.getElementById('ui');
  const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); const n = d.firstChild; ui.appendChild(n); return n; };
  const seri = naskah.seri, label = seri.label || 'DAY';

  el('<div class="vig"></div>');
  const badge = el(`<div id="badge">${esc(label)} ${seri.hari}</div>`);
  const cover = el(`<div id="cover"><div class="t1">${esc(label)} ${seri.hari}</div><div class="t2">${esc(naskah.cover.judul).replace(/\\n|\n/g, '<br>')}</div></div>`);
  const coverSub = el(`<div id="coversub">${esc(naskah.cover.sub)}</div>`);

  // ---- kartu dari naskah ----
  const row = (r, t) => `<div class="row" data-t="${t}"><span class="lb">${r.ikon ? `<span>${esc(r.ikon)}</span>` : ''}${esc(r.label)}</span><span class="pill ${r.gaya || 'ok'}">${esc(r.nilai)}</span></div>`;
  const CARDS = [];
  const card = (h, top, a, b, extra = {}) => { const n = el(h); n.style.top = top + 'px'; CARDS.push({ n, a, b, ...extra }); sfx(a, 'pop'); n.querySelectorAll('[data-t]').forEach((r) => { if (+r.dataset.t > a + 0.05) sfx(+r.dataset.t, 'tick'); }); return n; };
  const nextShotStart = (i) => { for (let j = i + 1; j < ORDER.length; j++) if (naskah.kalimat[j].shot) return o.shotStart(j); return OUTRO_T; };
  naskah.kalimat.forEach((k, i) => {
    if (!k.kartu) return;
    for (const c of k.kartu) {
      const a = (c.pada ? Wt(k.id, c.pada) : L[k.id].t) + (Number(c.mulai) || 0);
      let b;
      if (typeof c.sampai === 'number') b = a + c.sampai;
      else if (c.sampai === 'akhirKalimat') b = L[k.id].t + L[k.id].d + 0.3;
      else if (c.sampai && L[c.sampai]) b = L[c.sampai].t - CUT;
      else b = nextShotStart(i);
      b = Math.max(b, a + 0.5);
      const top = Number(c.atas) || 268;
      if (c.tipe === 'tabel') {
        const rows = c.baris.map((r) => row(r, r.pada ? Wt(k.id, r.pada) + (Number(r.mulai) || 0) : a));
        card(`<div class="card table"><div class="hd">${esc(c.judul || '')}</div>${rows.join('')}</div>`, top, a, b);
      } else if (c.tipe === 'aturan') {
        card(`<div class="card rule"><div class="ic" style="background:${esc(c.warna || '#ffd23f')}">${esc(c.ikon || '')}</div><div><div class="sm">${esc(c.kecil)}</div><div class="bg">${html(c.besar)}</div></div></div>`, top, a, b);
      } else if (c.tipe === 'ktp') {
        const baris = (c.baris || []).map(esc).join('<br>');
        card(`<div class="card ktp"><div class="hd">${esc(c.kepala || '')}</div><div class="ttl">${esc(c.judul)}</div><div class="body"><div class="ph">?</div><div class="ln">${baris}${c.kecil ? `<br><small>${esc(c.kecil)}</small>` : ''}</div></div></div>`, top, a, b);
      } else if (c.tipe === 'bubble') {
        card(`<div class="bubble"${c.warna ? ` style="background:${esc(c.warna)}"` : ''}>${esc(c.teks)}</div>`, top, a, b, { left: Number(c.kiri) || 520 });
      }
    }
  });

  // ---- stiker teriak ----
  const teriakLine = naskah.kalimat.find((k) => k.shot === 'teriak');
  const scream = el(`<div id="scream"><div class="rays"></div><div class="glow"></div><canvas width="700" height="830"></canvas><div class="txt">${esc(teriakLine?.stiker?.teks || 'AAAAAA!!')}</div><div class="sub">${esc(teriakLine?.stiker?.sub || '')}</div></div>`);
  const flash = el('<div id="flash"></div>');
  const cut = scream.querySelector('canvas');
  /** salin potongan kepala karakter (dari canvas WebGL) ke stiker */
  const setStiker = (glCanvas, sx, sy, sw, sh) => { const g = cut.getContext('2d'); g.clearRect(0, 0, cut.width, cut.height); g.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, cut.width, cut.height); };

  // ---- penutup ----
  const pen = naskah.penutup;
  const outro = el(`<div id="day2"><div class="a">${esc(pen.label || 'BESOK')}</div><div class="b">${esc(label)} ${seri.hari + 1}</div>${(pen.baris || []).map((b) => `<div class="c">${esc(b)}</div>`).join('')}${pen.sorot ? `<div class="c" style="color:#ffd23f">${esc(pen.sorot)}</div>` : ''}</div>`);
  const sparks = [...Array(6)].map(() => el('<div class="spark">✦</div>'));

  // ---- caption kata-per-kata ----
  const cap = el('<div id="cap"></div>');
  const GROUPS = [];
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i], k = naskah.kalimat[i];
    if (k.shot === 'teriak' || k.suara?.teriak) continue;
    const HL = new Set((k.sorot || []).map(norm));
    const toks = L[id].text.split(/\s+/), ws = L[id].words; let cur = null;
    toks.forEach((tok, j) => {
      const wt = (ws[j] || ws[ws.length - 1] || { t: L[id].t }).t;
      if (!cur) { cur = { n: document.createElement('div'), a: wt, words: [] }; cur.n.className = 'g'; cap.appendChild(cur.n); GROUPS.push(cur); }
      const sp = document.createElement('span'); sp.className = 'w' + (HL.has(norm(tok)) ? ' hl' : ''); sp.textContent = tok; cur.n.appendChild(sp); cur.words.push({ sp, t: wt });
      if (/[,.?!]$/.test(tok) || cur.words.length >= 3) cur = null;
    });
    if (GROUPS.length) GROUPS[GROUPS.length - 1].lineEnd = L[id].t + L[id].d + 0.35;
  }
  GROUPS.forEach((g, i) => { const nx = GROUPS[i + 1]?.a ?? 1e9; g.b = Math.min(g.lineEnd ?? nx, nx - 0.03); });

  function draw(t, st) {
    const { shot, s } = st;
    // badge
    const big = shot === 'udara' && st.shotIdx === 1 ? 1 - smooth(1.15, 1.5, s) : 0;
    const bs = lerp(1, 3.0, big) * (shot === 'udara' && st.shotIdx === 1 ? pop(s, 0, 0.28) : 1);
    const bw = badge.offsetWidth;
    const bx = lerp(84, W / 2 - (bw * bs) / 2, big), by = lerp(150, 640, big);
    badge.style.transform = `translate(${bx}px,${by}px) scale(${bs})`;
    badge.style.opacity = shot === 'cover' || shot === 'teriak' ? 0 : t > OUTRO_T - 0.1 ? 0 : 1;
    cover.style.opacity = coverSub.style.opacity = shot === 'cover' ? 1 : 0;
    if (shot === 'cover') cover.style.transform = `scale(${0.9 + 0.1 * easeOutBack(s / 0.2)})`;
    // caption
    for (const g of GROUPS) {
      const on = t >= g.a - 0.03 && t < g.b && shot !== 'teriak'; g.n.style.display = on ? '' : 'none'; if (!on) continue;
      for (const w of g.words) { const k = pop(t, w.t - 0.03, 0.16); w.sp.style.opacity = k > 0 ? 1 : 0; w.sp.style.transform = `scale(${0.6 + 0.4 * k}) translateY(${(1 - Math.min(1, k)) * 14}px)`; }
    }
    // kartu
    for (const c of CARDS) {
      const on = t >= c.a && t < c.b && shot !== 'teriak'; c.n.style.display = on ? '' : 'none'; if (!on) continue;
      const k = pop(t, c.a, 0.26); const out = smooth(c.b - 0.12, c.b, t);
      if (c.left) c.n.style.left = c.left + 'px';
      c.n.style.transform = `translateY(${(1 - Math.min(k, 1)) * -30}px) scale(${0.7 + 0.3 * k})`; c.n.style.opacity = Math.min(1, k * 2) * (1 - out);
      c.n.querySelectorAll('[data-t]').forEach((r) => { const rk = pop(t, +r.dataset.t, 0.22); r.style.opacity = rk > 0 ? 1 : 0.0; const p = r.querySelector('.pill'); if (p) p.style.transform = `scale(${0.5 + 0.5 * rk})`; r.firstElementChild.style.transform = `translateX(${(1 - Math.min(1, rk)) * -20}px)`; });
    }
    // teriak
    scream.style.display = shot === 'teriak' ? '' : 'none';
    flash.style.opacity = shot === 'teriak' ? clamp(1 - s / 0.1) : st.afterTeriak ? clamp(1 - s / 0.08) * 0.7 : 0;
    if (shot === 'teriak') {
      scream.querySelector('.rays').style.transform = `rotate(${s * 70}deg)`;
      const z = 0.82 + 0.3 * easeOutBack(s / 0.22) + s * 0.1; const jx = Math.sin(s * 71) * 16, jy = Math.cos(s * 83) * 16;
      cut.style.transform = `translate(${jx}px,${jy}px) rotate(${Math.sin(s * 40) * 3.5}deg) scale(${z})`;
      const tx = scream.querySelector('.txt'); tx.style.transform = `translate(${Math.sin(s * 90) * 10}px,${Math.cos(s * 70) * 8}px) rotate(${-4 + Math.sin(s * 33) * 2}deg) scale(${pop(s, 0.03, 0.2)})`;
      scream.querySelector('.sub').style.opacity = s > 0.7 ? 1 : 0;
    }
    // penutup
    const d2 = t >= OUTRO_T; outro.style.opacity = d2 ? 1 : 0;
    if (d2) {
      const q = t - OUTRO_T; outro.querySelector('.a').style.opacity = pop(q, 0) > 0 ? 1 : 0; outro.querySelector('.b').style.transform = `scale(${pop(q, 0.08, 0.3)})`;
      outro.querySelectorAll('.c').forEach((c, i) => { const q0 = 0.45 + i * 0.12; c.style.opacity = q > q0 ? 1 : 0; c.style.transform = `translateY(${(1 - Math.min(1, pop(q, q0))) * 20}px)`; });
    }
    // kilau
    const SP = [[170, 760], [900, 700], [230, 1150], [880, 1120], [520, 560], [820, 900]];
    sparks.forEach((n, i) => { const ph = (t * 1.6 + i * 0.37) % 1; n.style.opacity = st.sparks ? 1 : 0; n.style.transform = `translate(${SP[i][0]}px,${SP[i][1] - ph * 40}px) scale(${Math.sin(ph * Math.PI) * 1.2}) rotate(${ph * 90}deg)`; });
  }

  return { draw, setStiker, hide: () => { ui.style.display = 'none'; }, show: () => { ui.style.display = ''; } };
}
