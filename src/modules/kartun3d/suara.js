// Membuat suara tiap adegan via ElevenLabs (dengan konteks kalimat sebelum/sesudah agar mengalir)
// Output: <outDir>/NN_B.mp3 / NN_D.mp3 + <outDir>/timing.json
const fs = require('fs');
const path = require('path');
const SUARA_DEFAULT = { B: 'pNInz6obpgDQGcFmaJgB' /* Adam */, D: 'TX3LPaxmHKxFdv7VOQHJ' /* Liam */, N: 'TX3LPaxmHKxFdv7VOQHJ' /* narator: Liam */ };
const SETELAN = { B: { stability: .38, style: .5, speed: 1.08 }, D: { stability: .38, style: .5, speed: 1.12 }, N: { stability: .42, style: .45, speed: 1.08 } };
const tidur = ms => new Promise(r => setTimeout(r, ms));

async function tts({ apiKey, voice, text, prev, next, set, model, signal }) {
  const body = { text, model_id: model, language_code: 'id', voice_settings: { stability: set.stability, similarity_boost: .8, style: set.style, use_speaker_boost: true, speed: set.speed } };
  if (prev) body.previous_text = prev; if (next) body.next_text = next;
  for (let coba = 0; coba < 4; coba++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST', signal, headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await tidur(1500 * (coba + 1)); continue; }
    if (!r.ok) throw new Error('ElevenLabs ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.json();
  }
  throw new Error('ElevenLabs sibuk, coba lagi nanti');
}
function kata(al) {
  const ch = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds; const words = []; let cur = '', t0 = 0, end = 0;
  ch.forEach((c, i) => { if (/\s/.test(c)) { if (cur) words.push([cur, t0]); cur = ''; } else { if (!cur) t0 = st[i]; cur += c; end = Math.max(end, en[i]); } });
  if (cur) words.push([cur, t0]);
  // Suara lebih rapat: hening sebelum kata pertama dipotong (audio diputar mulai dari trim, lihat Kartun3D.jsx)
  const trim = Math.max(0, words.length ? words[0][1] : 0);
  return { words: words.map(([w, t]) => [w, Math.max(0, +(t - trim).toFixed(3))]), end: Math.max(0.1, +(end - trim).toFixed(3)), trim: +trim.toFixed(3) };
}
/**
 * @param {object} o
 * @param {object} o.spec      hasil buatNaskah/validasiSpec
 * @param {string} o.apiKey    ElevenLabs
 * @param {string} o.outDir
 * @param {{B:string,D:string}} [o.voices]
 * @param {string} [o.model]   'eleven_multilingual_v2' (bagus) / 'eleven_flash_v2_5' (lebih hemat)
 * @param {(i:number,n:number)=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 */
async function buatSuara({ spec, apiKey, outDir, voices = SUARA_DEFAULT, model = 'eleven_multilingual_v2', onProgress, signal }) {
  if (!apiKey) throw new Error('API key ElevenLabs belum diisi');
  fs.mkdirSync(outDir, { recursive: true });
  const S = spec.scenes, timing = [];
  for (let i = 0; i < S.length; i++) {
    if (signal?.aborted) throw new Error('Dibatalkan');
    const s = S[i], files = []; let info = null;
    for (const w of s.who.split('')) {
      const d = await tts({ apiKey, voice: voices[w], text: s.say, prev: S[i - 1]?.say, next: S[i + 1]?.say, set: SETELAN[w], model, signal });
      const f = `${String(i).padStart(2, '0')}_${w}.mp3`;
      fs.writeFileSync(path.join(outDir, f), Buffer.from(d.audio_base64, 'base64'));
      files.push(f); info = kata(d.alignment || d.normalized_alignment);
    }
    timing.push({ end: info.end, words: info.words, files, trim: info.trim });
    onProgress?.(i + 1, S.length);
  }
  fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing));
  return timing;
}

module.exports = { SUARA_DEFAULT, SETELAN, buatSuara };
