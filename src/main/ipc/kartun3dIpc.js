/**
 * src/main/ipc/kartun3dIpc.js
 * Konsep 3D Kartun: simpan / cek API key milik pelanggan (Claude untuk naskah, ElevenLabs untuk suara).
 */
const { initKartunKeys, getKartunKeys, saveKartunKeys, describeKartunKeys } = require('../../core/kartunKeys');
const { SYSTEM_PROMPT, SYSTEM_PROMPT_NARATOR } = require('../../modules/kartun3d/naskah');
const { testGeminiVoice } = require('../../services/aiVideoKartun3D');
const { validasiSpec, hitungKarakter } = require('../../modules/kartun3d/validasi');

// JSON tempelan dari claude.ai: buang pembungkus ``` / ```json lalu parse
function parseTempelan(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  else t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('kosong');
  return JSON.parse(t.slice(a, b + 1));
}

module.exports = function registerKartun3DIpc(ipcMain, ctx) {
  initKartunKeys(ctx.SESSIONS_DIR);

  function safeHandle(channel, handler) {
    try { ipcMain.removeHandler(channel); } catch (e) {}
    ipcMain.handle(channel, handler);
  }

  safeHandle('kartun3d-get-keys', async () => describeKartunKeys());

  // Prompt sistem untuk ditempel ke claude.ai (mode "Tempel JSON")
  // kind 'narator' = konsep 3D Cara Kerja
  safeHandle('kartun3d-get-prompt', async (e, kind) => (kind === 'narator' ? SYSTEM_PROMPT_NARATOR : SYSTEM_PROMPT));

  // Tombol "Tes suara" (Gemini TTS gratis)
  safeHandle('kartun3d-test-voice', async (e, voice) => {
    try {
      return await testGeminiVoice(String(voice || 'Charon'));
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Validasi JSON tempelan SEBELUM memanggil ElevenLabs (kredit tidak terbuang untuk JSON rusak)
  safeHandle('kartun3d-validate-json', async (e, text) => {
    let raw;
    try {
      raw = parseTempelan(text);
    } catch (err) {
      return { success: false, error: "JSON tidak valid / terpotong — minta Claude 'lanjutkan', gabungkan, lalu tempel ulang." };
    }
    try {
      const spec = validasiSpec(raw);
      const karakter = hitungKarakter(spec);
      return { success: true, spec, judul: spec.judul, adegan: spec.scenes.length, karakter, durasi: Math.round(karakter / 13) };
    } catch (err) {
      return { success: false, error: `Isi JSON belum sesuai format naskah: ${err.message}` };
    }
  });

  safeHandle('kartun3d-save-keys', async (e, patch = {}) => {
    try {
      return { success: true, ...saveKartunKeys(patch) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Tes key: ElevenLabs = cek akun (sisa karakter bila izin tersedia) · Claude = 1 pesan sangat pendek
  safeHandle('kartun3d-test-keys', async () => {
    const { anthropicKey, elevenlabsKey } = getKartunKeys();
    const out = { elevenlabs: 'Belum diisi', claude: 'Belum diisi (naskah memakai Gemini)' };
    if (elevenlabsKey) {
      try {
        const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': elevenlabsKey } });
        if (r.ok) {
          const d = await r.json();
          const left = Math.max(0, (d.character_limit || 0) - (d.character_count || 0));
          out.elevenlabs = `✓ Terhubung · sisa ±${left.toLocaleString('id-ID')} karakter (±${Math.floor(left / 1300)} video)`;
        } else if (r.status === 401) {
          const body = await r.text();
          out.elevenlabs = /missing_permissions|permission/i.test(body)
            ? '✓ Key diterima (izin baca langganan tidak aktif, sisa kuota tidak bisa ditampilkan)'
            : '✗ Key ElevenLabs tidak valid';
        } else {
          out.elevenlabs = `✗ ElevenLabs membalas ${r.status}`;
        }
      } catch (err) {
        out.elevenlabs = `✗ Tidak bisa menghubungi ElevenLabs: ${err.message}`;
      }
    }
    if (anthropicKey) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] })
        });
        out.claude = r.ok ? '✓ Terhubung' : `✗ Claude membalas ${r.status}: ${(await r.text()).slice(0, 120)}`;
      } catch (err) {
        out.claude = `✗ Tidak bisa menghubungi Claude: ${err.message}`;
      }
    }
    return { success: true, ...out };
  });
};
