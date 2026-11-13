// Membuat naskah + rancangan adegan (JSON) dari topik, via Claude API atau Gemini API.
const fs = require('fs');
const path = require('path');
const { validasiSpec } = require('./validasi');
const HERE = __dirname;
const SYSTEM_PROMPT = fs.readFileSync(path.join(HERE, 'prompt', 'sistem_naskah.md'), 'utf8');
// Konsep 3D Cara Kerja: 1 narator, tanpa karakter
const SYSTEM_PROMPT_NARATOR = fs.readFileSync(path.join(HERE, 'prompt', 'sistem_naskah_narator.md'), 'utf8');
const CONTOH = fs.readFileSync(path.join(HERE, 'contoh', 'spec_kaca.json'), 'utf8');

function ambilJSON(teks) {
  const t = teks.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('AI tidak mengembalikan JSON');
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * @param {object} o
 * @param {string} o.topik        contoh "bikin garam dari air laut" (kosongkan + o.otomatis=true untuk topik acak)
 * @param {'claude'|'gemini'} o.provider
 * @param {string} o.apiKey
 * @param {string} [o.model]      default: claude-sonnet-5-5 / gemini (isi sesuai model yang dipakai aplikasi)
 * @param {number} [o.durasi]     target detik (60–95)
 * @param {AbortSignal} [o.signal]
 */
async function buatNaskah({ topik, otomatis = false, provider = 'claude', apiKey, model, durasi = 80, signal, sudahDibuat = [] }) {
  if (!apiKey) throw new Error('API key ' + provider + ' belum diisi');
  const permintaan = (otomatis || !topik
    ? `Pilih sendiri SATU topik "bikin X dari nol" yang jarang diketahui orang dan bikin penasaran (benda sehari-hari). Jangan pakai topik ini: ${sudahDibuat.join(', ') || '-'}.`
    : `Topik: ${topik}.`) +
    ` Target durasi sekitar ${durasi} detik. Ikuti semua aturan. Ini contoh naskah lengkap yang bagus untuk topik kaca (JANGAN disalin, hanya acuan format dan gaya):\n${CONTOH}`;
  let teks;
  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 12000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: permintaan }] }),
    });
    if (!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    teks = d.content.filter(c => c.type === 'text').map(c => c.text).join('');
  } else {
    const m = model || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: [{ role: 'user', parts: [{ text: permintaan }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } }),
    });
    if (!r.ok) throw new Error('Gemini API ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    teks = d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  }
  return validasiSpec(ambilJSON(teks));
}

module.exports = { SYSTEM_PROMPT, SYSTEM_PROMPT_NARATOR, buatNaskah };
