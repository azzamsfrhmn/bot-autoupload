const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Folder data runtime (versi terinstal: userData, lihat process.chdir di main.js)
const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, 'sessions/config.json');
const ACCOUNTS_PATH = path.join(PROJECT_ROOT, 'sessions/accounts.json');

// Daftar model resmi dari AI Studio
// Kuota gratis dihitung per model, jadi beberapa model = beberapa jatah harian
const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash'
];
const REQUEST_OPTIONS = { timeout: 20000 };

// Model yang kuota hariannya habis / sedang penuh dilewati sementara agar tidak membuang waktu & request
const modelBlockedUntil = new Map();
function isModelBlocked(modelName) {
  return (modelBlockedUntil.get(modelName) || 0) > Date.now();
}
function noteModelError(modelName, err) {
  const raw = String(err?.message || err || '');
  if (/429|quota|Too Many Requests/i.test(raw)) {
    const m = raw.match(/retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
    const ms = m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 3600 * 1000;
    modelBlockedUntil.set(modelName, Date.now() + ms);
  } else if (/503|overloaded|high demand|timeout|aborted/i.test(raw)) {
    modelBlockedUntil.set(modelName, Date.now() + 5 * 60 * 1000);
  }
}

// API Key Gemini Permanen Pengembang untuk Seluruh Pengguna
let HARDCODED_GEMINI_API_KEY = ''; try { HARDCODED_GEMINI_API_KEY = require('./geminiKey.local'); } catch (e) {}

// Key di config.json (jika pernah disimpan) atau key permanen aplikasi
function getSavedApiKey() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (cfg && cfg.geminiApiKey) return cfg.geminiApiKey.trim();
    } catch (e) {}
  }
  return HARDCODED_GEMINI_API_KEY;
}

/**
 * Deteksi Platform Aktif yang Kuat & Multi-Sumber
 */
function resolveIsTikTok(explicitPlatform = '', promptText = '', mediaFiles = []) {
  // 1. Cek parameter eksplisit jika dikirim
  const rawPlatform = String(explicitPlatform || '').toLowerCase();
  if (rawPlatform === 'tiktok') return true;
  if (rawPlatform === 'instagram') return false;

  // 2. Cek berkas accounts.json
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
      const accList = Array.isArray(raw) ? raw : (raw.accounts || []);
      const activeId = raw.activeAccountId || raw.activeId;
      const activeAcc = accList.find((a) => a.id === activeId || a.accountId === activeId) || accList[0];
      
      const p = String(activeAcc?.platform || activeAcc?.type || '').toLowerCase();
      if (p.includes('tiktok')) return true;
      if (p.includes('instagram')) return false;
    }
  } catch (e) {}

  // 3. Cek berkas config.json
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const p = String(cfg.activePlatform || cfg.platform || '').toLowerCase();
      if (p.includes('tiktok')) return true;
      if (p.includes('instagram')) return false;
    }
  } catch (e) {}

  // 4. Cek keberadaan profil aktif TikTok di folder sessions
  try {
    const tiktokProfilesDir = path.join(PROJECT_ROOT, 'sessions/tiktok_profiles');
    if (fs.existsSync(tiktokProfilesDir)) {
      const dirs = fs.readdirSync(tiktokProfilesDir);
      if (dirs.length > 0) return true;
    }
  } catch (e) {}

  // 5. Cek dari karakteristik input prompt atau PID keranjang kuning
  if (/\b\d{15,22}\b/.test(promptText) || /keranjang\s*kuning|affiliate|showcase/i.test(promptText)) {
    return true;
  }

  return false;
}

/**
 * Tes Validitas & Koneksi API Key ke Server Google
 */
async function testGeminiConnection(keyToTest) {
  const apiKey = (keyToTest && keyToTest.trim()) ? keyToTest.trim() : getSavedApiKey();

  if (!apiKey) {
    return {
      success: false,
      message: 'API Key belum diisi. Tempel Gemini API Key lalu klik Simpan.'
    };
  }

  // Cek key lewat metadata model (GET), TIDAK memakai kuota generate harian
  const modelName = CANDIDATE_MODELS[0];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}?key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return { success: true, message: `Gemini siap & terhubung · model ${modelName}` };
    const raw = await res.text();
    if (/API key not valid|API_KEY_INVALID/i.test(raw)) {
      return { success: false, message: 'API key Gemini tidak valid. Pastikan key tidak terpotong.' };
    }
    if (res.status === 403) return { success: false, message: 'Project ditolak akses (403). Gunakan API key dari project yang aktif.' };
    return { success: false, message: `Gagal terhubung ke Gemini (HTTP ${res.status}).` };
  } catch (err) {
    console.error('[Gemini Connection Test Failed]:', err.message);
    return { success: false, message: 'Gagal terhubung ke Gemini. Periksa koneksi internet.' };
  }
}

// Cari naskah.json proyek 3D Edukasi dari nama video (video_edu3d_<ts>.mp4 ↔ storage/bahan_video/proyek_edu3d_<ts>)
function readEdu3DScriptForVideo(mediaFiles = []) {
  for (const f of mediaFiles || []) {
    const base = path.basename(String(f || ''));
    // 3D Kartun: spec.json (judul + dialog per adegan) → bentuk yang sama dengan naskah 3D Edukasi
    const k = base.match(/^video_(kartun3d|carakerja3d)_(\d+)(?:_hd)?\.mp4$/i);
    if (k) {
      for (const c of [
        path.resolve(path.dirname(f), '..', 'bahan_video', `proyek_${k[1].toLowerCase()}_${k[2]}`, 'spec.json'),
        path.resolve(process.cwd(), 'storage', 'bahan_video', `proyek_${k[1].toLowerCase()}_${k[2]}`, 'spec.json')
      ]) {
        try {
          const spec = JSON.parse(fs.readFileSync(c, 'utf8'));
          return { topic: spec.judul || '', scenes: (spec.scenes || []).map((sc) => ({ narration: sc.say || '' })) };
        } catch (e) {}
      }
      continue;
    }
    // Serial Animasi: naskah.json (kalimat[].text) → bentuk yang sama dengan naskah 3D Edukasi
    const s = base.match(/^video_serial3d_(\d+)(?:_hd)?\.mp4$/i);
    if (s) {
      for (const c of [
        path.resolve(path.dirname(f), '..', 'bahan_video', `proyek_serial3d_${s[1]}`, 'naskah.json'),
        path.resolve(process.cwd(), 'storage', 'bahan_video', `proyek_serial3d_${s[1]}`, 'naskah.json')
      ]) {
        try {
          const n = JSON.parse(fs.readFileSync(c, 'utf8'));
          return { topic: `${n.seri?.judul || ''} ${n.seri?.label || 'DAY'} ${n.seri?.hari || ''}`.trim(), scenes: (n.kalimat || []).map((k) => ({ narration: k.text || '' })) };
        } catch (e) {}
      }
      continue;
    }
    const m = base.match(/^video_edu3d_(\d+)(?:_hd)?\.mp4$/i);
    if (!m) continue;
    const candidates = [
      path.resolve(path.dirname(f), '..', 'bahan_video', `proyek_edu3d_${m[1]}`, 'naskah.json'),
      path.resolve(process.cwd(), 'storage', 'bahan_video', `proyek_edu3d_${m[1]}`, 'naskah.json')
    ];
    for (const c of candidates) {
      try { return JSON.parse(fs.readFileSync(c, 'utf8')); } catch (e) {}
    }
  }
  return null;
}

/**
 * Generator Caption Otomatis (Mendukung parameter fleksibel objek / argumen terpisah)
 */
async function generateInstagramCaption(arg1 = '', arg2 = 'promo', arg3 = [], arg4 = '') {
  const apiKey = getSavedApiKey();

  if (!apiKey) {
    return '❌ API Key belum disetel. Buka tab Pengaturan AI dan simpan API Key Gemini Anda.';
  }

  // Normalisasi argumen jika pemanggil mengirim satu objek payload
  let promptText = '';
  let tone = 'promo';
  let mediaFiles = [];
  let platform = '';

  if (typeof arg1 === 'object' && arg1 !== null) {
    promptText = arg1.prompt || arg1.promptText || arg1.topic || '';
    tone = arg1.tone || 'promo';
    mediaFiles = arg1.mediaFiles || arg1.files || [];
    platform = arg1.platform || '';
  } else {
    promptText = String(arg1 || '');
    tone = String(arg2 || 'promo');
    mediaFiles = Array.isArray(arg3) ? arg3 : [];
    platform = String(arg4 || '');
  }

  // Video 3D Edukasi buatan bot: baca naskahnya (topik + narasi) agar caption sesuai isi video
  const eduScript = readEdu3DScriptForVideo(mediaFiles);

  let detectedProduct = promptText.trim();
  if (!detectedProduct && eduScript) detectedProduct = eduScript.topic || '';
  if (!detectedProduct && mediaFiles && mediaFiles.length > 0) {
    const rawName = path.basename(mediaFiles[0]);
    detectedProduct = rawName.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '');
  }
  if (!detectedProduct) detectedProduct = 'Atasan Wanita Trendy';

  const isTikTok = resolveIsTikTok(platform, detectedProduct, mediaFiles);

  let promptMessage = '';

  if (isTikTok && eduScript) {
    const narration = (eduScript.scenes || []).map((sc) => sc.narration).filter(Boolean).join(' ');
    promptMessage = `Kamu adalah kreator TikTok edukasi yang captionnya selalu bikin orang berhenti scroll.
Buat caption untuk video edukasi 3D berikut.
Topik: "${eduScript.topic || detectedProduct}"
Isi narasi video: "${narration.slice(0, 900)}"
${promptText.trim() && promptText.trim() !== eduScript.topic ? `Catatan tambahan dari pengguna: "${promptText.trim()}"
` : ''}
ATURAN WAJIB:
1. HANYA 1 BARIS (12-20 kata), bahasa gaul santai anak muda Indonesia (bukan bahasa baku), berupa hook penasaran yang SESUAI isi video (contoh gaya: "Ternyata selama ini kita salah kaprah soal ini, pantes aja...", "Baru tau alasan sebenarnya kenapa..."). Boleh ajak nonton sampai habis / save / share. JANGAN bocorkan semua jawabannya.
2. DILARANG menyebut keranjang kuning, checkout, beli, harga, atau nama brand/toko.
3. Tanpa baris baru, tanpa bullet, tanpa tanda kutip.
4. Akhiri dengan TEPAT 6 hashtag: #fyp #fypシ゚viral #tahugaksih #edukasi + 2 hashtag pendek sesuai topik.
5. Output HANYA caption-nya saja.`;
  } else if (isTikTok) {
    // =========================================================================
    // PROMPT KHUSUS TIKTOK (HANYA 1 BARIS HOOK PENASARAN + HASHTAG FYP VIRAL)
    // =========================================================================
    promptMessage = `Kamu adalah copywriter spesialis TikTok Affiliate yang ahli membuat konten viral masuk FYP jutaan penonton.
Tugasmu membuat teks caption untuk produk: "${detectedProduct}".

ATURAN WAJIB (SANGAT KETAT):
1. HANYA 1 BARIS LURUS (maksimal 14-18 kata) berupa kalimat rasa penasaran / heran / FOMO yang langsung menarik perhatian orang yang scroll (contoh konsep: "Nyesel banget baru tau ada yang secakep ini pas dicoba langsung...", "Beneran nggak nyangka harga segini dapet kualitas se-mewah ini...").
2. Di ujung kalimat, selipkan ajakan santai ke keranjang kuning (contoh: "...langsung checkout di keranjang kuning ya!", "...cek keranjang kuning sebelum kehabisan!").
3. DILARANG KERAS menggunakan baris baru (enter), tanda bullet points (- atau •), sapaan formal (seperti "Halo Kak", "Kakak", "Mama"), ajakan "Ketik MAU", "link di bio", atau gaya bahasa promosi katalog jadul.
4. DILARANG KERAS menyertakan nama brand / toko apa pun, termasuk ETNIC, ETNIC STORE, @etnicpremium, atau hashtag merek seperti #EtnicStore.
5. Sambungkan langsung kalimat tersebut dengan TEPAT 6 hashtag: 4 hashtag FYP umum (#fyp #fypシ゚viral #racuntiktok #tiktokshop) + 2 hashtag pendek yang sesuai jenis produk (contoh: #racuntas #tasviral untuk tas, #dasterviral #dasterrayon untuk daster).
6. Output HANYA satu baris kalimat utuh beserta hashtag tanpa tanda kutip dan tanpa penjelasan apa pun.`;
  } else {
    // =========================================================================
    // PROMPT ASLI INSTAGRAM (TETAP FORMAT LENGKAP & AMAN DARI FILTER)
    // =========================================================================
    let toneInstruction = '';
    if (tone === 'casual') {
      toneInstruction = 'Gaya santai, mengalir natural, akrab, tidak kaku, bahasa sehari-hari.';
    } else if (tone === 'formal') {
      toneInstruction = 'Gaya rapi, elegan, terstruktur, fokus pada produktivitas dan solusi hiburan.';
    } else {
      toneInstruction = 'Gaya persuasif santun, edukatif, menonjolkan kenyamanan tanpa kesan memaksa jualan.';
    }

    promptMessage = `Anda adalah copywriter konten media sosial profesional untuk brand "ETNIC STORE" (@etnicpremium).
Buatlah 1 caption yang RINGKAS, RAPI, BERSIH, dan AMAN DARI FILTER/SHADOWBAN Instagram untuk topik: "${detectedProduct}".

ATURAN KETAT PENYAMARAN & ANTI-SENSOR:
1. SAMARKAN NAMA BRAND/APLIKASI:
   - DILARANG menulis nama platform secara terang-terangan.
   - Ganti dengan nama tersamar atau panggilan komunitas.
2. HINDARI KATA HARD-SELLING & KOMERSIAL TERLARANG:
   - DILARANG menggunakan kata: "jual", "beli", "murah", "promo", "slot", "garansi", "rp".
   - Gunakan perumpamaan halus: "lebih hemat dari segelas kopi", "sangat terjangkau", "bebas gangguan".
3. CTA AMAN:
   - Gunakan ajakan halus: "Cek link di bio profil kita" atau "Ketik 'MAU' di kolom komentar/DM".
4. FORMAT & STRUKTUR RINGKAS:
   - Baris 1-2: Hook masalah/relatable.
   - 3 Poin Manfaat singkat (gunakan bullet point icon seperti * atau •).
   - Solusi penutup & Call to Action singkat.
   - Hashtag: Cukup 5-6 hashtag bertema solusi/lifestyle (#BebasIklan #StreamingHemat #EtnicStore #TipsDigital).
5. Gaya Bahasa: ${toneInstruction}
6. HANYA tampilkan teks caption hasil akhir tanpa kalimat pembuka basa-basi.`;
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: isTikTok ? 0.85 : 0.7,
          topP: 0.85,
          maxOutputTokens: isTikTok ? 1024 : 1500
        }
      }, REQUEST_OPTIONS);

      const result = await model.generateContent(promptMessage);
      let text = (result.response.text() || '').trim();

      if (text) {
        if (isTikTok) {
          text = text.replace(/[\r\n]+/g, ' ')
                     .replace(/\*\*?|__|`/g, '')
                     .replace(/^\s*(caption\s*:\s*)?["'“”]+|["'“”]+\s*$/gi, '')
                     .replace(/etnic\s*store/gi, '')
                     .replace(/#etnic\w*/gi, '')
                     .replace(/\s{2,}/g, ' ')
                     .trim();
          // Kunci format: 1 kalimat + maksimal 6 hashtag unik di akhir
          const tags = [...new Set((text.match(/#[^\s#]+/g) || []).map((t) => t.toLowerCase()))].slice(0, 6);
          const sentence = text.replace(/#[^\s#]+/g, '').replace(/\s{2,}/g, ' ').trim();
          text = [sentence, tags.join(' ')].filter(Boolean).join(' ');
          // Kalimat terlalu pendek = jawaban terpotong → coba model berikutnya
          if (sentence.split(/\s+/).filter(Boolean).length < 7) {
            console.error(`[Gemini Caption] ${modelName}: caption terpotong ("${sentence}"), coba model lain.`);
            continue;
          }
        }
        return text;
      }
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Caption Error with ${modelName}]:`, err.message);
    }
  }

  if (isTikTok) {
    const hooks = [
      'Beneran nggak nyangka kualitasnya sebagus ini pas dicoba langsung, cek keranjang kuning sebelum kehabisan!',
      'Nyesel banget baru tau ada yang secakep ini, langsung checkout di keranjang kuning ya!',
      'Harga segini dapet kualitas se-mewah ini bikin khilaf, cek keranjang kuning sekarang!'
    ];
    return `${hooks[Math.floor(Math.random() * hooks.length)]} #fyp #fypシ゚viral #racuntiktok #tiktokshop #tiktokviral #viral`;
  }
  return '❌ Gagal menghasilkan caption. Periksa kembali API Key Anda di menu Pengaturan AI.';
}

/**
 * Generator Judul Keranjang Kuning TikTok (Maksimal 30 Karakter, Bebas Emoji/Simbol)
 */
async function generateProductLinkTitle(productName = '') {
  const apiKey = getSavedApiKey();
  const fallbackList = [
    'PROMO DISKON HARI INI CEK',
    'CEK DISINI SEBELUM HABIS',
    'DISKON SPESIAL HARI INI',
    'PROMO MURAH CEK SEKARANG',
    'KLIK KERANJANG KUNING YA'
  ];
  const getRandomFallback = () => fallbackList[Math.floor(Math.random() * fallbackList.length)];

  if (!apiKey) return getRandomFallback();

  const promptMessage = `Kamu adalah copywriter TikTok Affiliate.
Buat 1 frasa ajakan/judul singkat keranjang kuning untuk produk: "${productName || 'Atasan Wanita'}".

ATURAN SANGAT KETAT:
1. PANJANG TEKS: Maksimal 26 karakter (wajib di bawah 30 karakter).
2. DILARANG menggunakan EMOJI apa pun (contoh: dilarang api, bintang, ledakan, dsb).
3. HANYA gunakan huruf alfabet, angka, dan spasi (TIDAK BOLEH simbol, tanda baca seru, koma, kutip).
4. Gunakan huruf KAPITAL SEMUA.
5. Menarik, memicu rasa ingin klik/FOMO (Contoh: "LAGI DISKON CEK SEKARANG", "PROMO TERBATAS CEK DISINI", "RACUN OOTD CEK KERANJANG").
6. Output HANYA teks frasa tersebut tanpa tanda kutip, tanpa titik, dan tanpa penjelasan apa pun.`;

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.95, // Variasi tinggi agar selalu berbeda
          maxOutputTokens: 25
        }
      }, REQUEST_OPTIONS);

      const result = await model.generateContent(promptMessage);
      let text = (result.response.text() || '').trim();

      if (text) {
        // Bersihkan dari emoji, tanda baca, simbol, dan potong maksimal 30 karakter
        text = text.replace(/[\r\n]+/g, ' ')
                   .replace(/[^a-zA-Z0-9\s]/g, '')
                   .replace(/\s{2,}/g, ' ')
                   .trim()
                   .toUpperCase()
                   .slice(0, 30);

        if (text.length >= 5) {
          return text;
        }
      }
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Link Title Error with ${modelName}]:`, err.message);
    }
  }

  return getRandomFallback();
}

/**
 * Teks video konsep Remotion: hook 3 detik, 3 keunggulan singkat, CTA.
 * Foto produk (maks. 2) ikut dikirim agar keunggulan sesuai barangnya.
 */
async function generateRemotionScript({ productName = '', price = '', imagePaths = [] } = {}) {
  const apiKey = getSavedApiKey();
  const fallback = {
    hook: 'Nyesel baru tau ada yang sebagus ini!',
    points: ['Kualitasnya bikin kaget', 'Nyaman dipakai seharian', 'Harganya ramah di kantong'],
    cta: 'Cek keranjang kuning'
  };
  if (!apiKey) return { success: false, ...fallback, error: 'API Key Gemini belum disetel.' };

  const promptMessage = `Kamu copywriter video TikTok Affiliate. Buat teks yang tampil DI DALAM video promosi pendek (9:16) untuk produk: "${productName || 'lihat foto'}"${price ? ` seharga ${price}` : ''}.

ATURAN:
1. "hook": 1 kalimat pembuka rasa penasaran/FOMO, maksimal 7 kata, bahasa sehari-hari, tanpa emoji.
2. "points": TEPAT 3 keunggulan produk yang nyata terlihat/masuk akal dari foto & nama produk, masing-masing maksimal 6 kata, tanpa emoji, tanpa titik di akhir.
3. "cta": ajakan ke keranjang kuning, maksimal 4 kata (contoh: "Cek keranjang kuning", "Checkout sebelum kehabisan").
4. DILARANG menyebut nama brand/toko, harga, klaim medis, atau kata "termurah".
Balas HANYA JSON: {"hook":"...","points":["...","...","..."],"cta":"..."}`;

  const parts = [{ text: promptMessage }];
  for (const p of (imagePaths || []).slice(0, 2)) {
    try {
      const ext = path.extname(p).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      parts.push({ inlineData: { data: fs.readFileSync(p).toString('base64'), mimeType } });
    } catch (e) {}
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const clean = (s, maxWords) => String(s || '').replace(/[\r\n"“”*_`#]+/g, ' ').replace(/\s{2,}/g, ' ').trim().split(' ').slice(0, maxWords).join(' ');

  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.9, maxOutputTokens: 300, responseMimeType: 'application/json' }
      }, REQUEST_OPTIONS);
      const result = await model.generateContent(parts);
      const raw = (result.response.text() || '').trim();
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const points = (Array.isArray(json.points) ? json.points : []).map((t) => clean(t, 8)).filter(Boolean).slice(0, 3);
      if (json.hook && points.length) {
        return { success: true, hook: clean(json.hook, 9), points, cta: clean(json.cta, 5) || fallback.cta };
      }
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Remotion Script Error with ${modelName}]:`, err.message);
    }
  }
  return { success: false, ...fallback, error: 'Gemini sedang tidak tersedia, teks contoh dipakai.' };
}

/**
 * Kotak kepala (wajah + rambut, tanpa bahu/pakaian) di foto karakter, skala 0-1000:
 * { ymin, xmin, ymax, xmax } atau null bila Gemini tidak tersedia / wajah tidak ditemukan.
 */
/**
 * Naskah konsep 3D Edukasi ("tahu gak sih"), gaya video penjelasan 3D: masalah → solusi bertahap.
 * topic kosong → Gemini memilih topik sendiri. Hasil: { success, topic, label, world, scenes:[{narration, visual}] x3 }
 */
async function generateEdu3DScript({ topic = '', sceneSeconds = 10, avoidTopics = [], withCharacter = false, sceneCount = 3 } = {}) {
  const n = Math.min(6, Math.max(3, Number(sceneCount) || 3));
  const apiKey = getSavedApiKey();
  if (!apiKey) return { success: false, error: 'API Key Gemini belum disetel.' };
  // Narasi diucapkan Veo dengan tempo rapat (gaya ngobrol cepat) ±3 kata per detik → mengisi penuh durasi klip tanpa celah
  const maxWords = Math.max(16, Math.round(sceneSeconds * 3.1));
  const minWords = maxWords - 4;

  const promptMessage = `Kamu penulis naskah video edukasi 3D TikTok bergaya "tahu gak sih" dengan alur MASALAH → SOLUSI → CTA: angkat 1 masalah sehari-hari yang relate, jelaskan penyebab ilmiahnya, lalu kasih solusi/tips praktis yang bisa langsung dicoba.
${topic ? `TOPIK: "${topic}".` : `Pilih SENDIRI 1 topik menarik yang dekat dengan kehidupan sehari-hari di Indonesia (benda rumah, jalan, bangunan, makanan, alat, kendaraan, listrik, air). Hindari topik medis, politik, agama.${avoidTopics.length ? ` JANGAN memilih topik yang sama atau mirip dengan yang sudah pernah dibuat: ${avoidTopics.map((t) => `"${t}"`).join(', ')}.` : ''}`}

ATURAN:
1. TEPAT ${n} adegan dengan alur MASALAH → PENYEBAB → SOLUSI → CTA:
   - Adegan 1 = MASALAH: hook "Tahu gak sih ..." yang menyebut masalah sehari-hari yang relate (bikin penonton mikir "eh iya, gue juga ngalamin").
   - Adegan tengah = PENYEBAB ilmiahnya dijelaskan bertahap (tiap adegan 1 poin baru yang bikin "ooh gitu", jangan diulang), lalu masuk ke SOLUSI.
   - Adegan ${n} (terakhir) = SOLUSI/TIPS praktis yang bisa langsung dicoba, lalu DITUTUP CTA.
2. "narration": BAHASA GAUL anak muda Indonesia terbaru seperti kreator TikTok ngobrol ke temen, BUKAN bahasa baku.
   - Pakai: "lo/kalian", "gak", "udah", "banget", "ternyata", "jadi gini", "nah", "makanya", "literally", "auto", "relate", "pantesan", "gokil", "kok bisa", "fix".
   - DILARANG kata baku/kaku: "tidak", "sangat", "adalah", "merupakan", "dapat", "oleh karena itu", "sehingga", "yaitu", "kamu sekalian".
   - Kalimat pendek & ngalir, ${minWords}-${maxWords} kata per adegan, WAJIB minimal ${minWords} kata (narasi mengisi PENUH ±${sceneSeconds} detik tanpa jeda), tanpa emoji, tanpa angka romawi, tanda baca wajar.
   - Adegan terakhir WAJIB diakhiri CTA penutup yang catchy (maks 8 kata), variasikan, mis. "Follow biar gak ketinggalan fakta gokil lainnya!", "Save dulu, siapa tau ditanya temen!", "Komen topik apa lagi yang mau dibahas!", "Share ke temen yang belum tau!".
   AKURASI (WAJIB): jelaskan mekanisme yang SEBENARNYA secara teknis/ilmiah, bukan dugaan yang terdengar masuk akal (contoh: jalan aspal tidak becek karena permukaannya kedap air & dibuat cembung agar air mengalir ke selokan, BUKAN karena aspal menyerap air). Jangan mengarang tahun, nama penemu, atau angka bila tidak yakin; lebih baik tanpa angka.
3. "visual": prompt video BAHASA INGGRIS untuk animasi 3D adegan itu (objek, aksi, gerakan kamera), 1-2 kalimat, tanpa teks/tulisan di layar, tanpa orang berbicara, TANPA CTA.${withCharacter
    ? ' WAJIB: di SETIAP adegan, tokoh tetap "the host character" (pria muda Indonesia 3D, ciri khas akun) ikut beraksi memperagakan isi narasi (mis. memegang, menunjuk, mencoba, terkejut), sebut "the host character" di prompt, jangan deskripsikan wajah/pakaiannya (diambil dari gambar referensi), mulut tertutup tanpa dialog. Objek penjelasan tetap jadi fokus utama.'
    : ' Boleh karakter 3D sederhana tanpa dialog.'}
4. "world": 1 kalimat bahasa Inggris tentang latar dunia 3D yang SAMA untuk semua adegan (agar konsisten), mis. "a small village road diorama with red-roof houses and olive trees".
5. "label": label kecil di atas video, maks 4 kata. Bila ada tahun/era yang PASTI benar: "Nama · keterangan waktu" (mis. "Makadam · awal 1800-an"). Bila tidak: cukup nama benda/fenomenanya saja (mis. "Minyak & Air"). DILARANG kata waktu kosong seperti "Hari ini", "Sekarang", "Masa kini".
6. "topic": judul topik singkat (maks 6 kata).
Balas HANYA JSON: {"topic":"...","label":"...","world":"...","scenes":[{"narration":"...","visual":"..."}, ... TEPAT ${n} item]}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  let best = null; // hasil dengan narasi terpanjang bila semua percobaan masih kurang
  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.9, maxOutputTokens: 1200, responseMimeType: 'application/json' }
      }, { timeout: 40000 });
      // Narasi pendek = celah kosong di klip → minta ulang (maks 3x) dengan teguran jumlah kata; simpan hasil terbaik
      let feedback = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = ((await model.generateContent([{ text: promptMessage + feedback }])).response.text() || '').trim();
        const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        const scenes = (Array.isArray(json.scenes) ? json.scenes : [])
          .map((s) => ({ narration: String(s?.narration || '').replace(/\s+/g, ' ').trim(), visual: String(s?.visual || '').replace(/\s+/g, ' ').trim() }))
          .filter((s) => s.narration && s.visual)
          .slice(0, n);
        if (scenes.length !== n) continue;
        const result = {
          success: true,
          topic: String(json.topic || topic || '').trim(),
          label: String(json.label || '').trim().slice(0, 40),
          world: String(json.world || '').trim(),
          scenes
        };
        const counts = scenes.map((s) => s.narration.split(/\s+/).length);
        const shortest = Math.min(...counts);
        if (!best || shortest > best.shortest) best = { result, shortest };
        if (shortest >= minWords - 2) return result;
        feedback = `\n\nPERINGATAN: naskah sebelumnya TERLALU PENDEK (jumlah kata narasi: ${counts.join(', ')}). Setiap "narration" WAJIB ${minWords}-${maxWords} kata. Tambahkan penjelasan/detail menarik (bukan kata pengisi) agar narasi rapat mengisi penuh ${sceneSeconds} detik.`;
      }
      if (best) return best.result;
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Edu3D Script Error with ${modelName}]:`, err.message);
    }
  }
  return { success: false, error: 'Gemini gagal membuat naskah 3D Edukasi. Coba lagi sebentar.' };
}

// Ide topik 3D Edukasi untuk mengisi kolom topik: kalimat "Tahu gak sih ...?" yang belum pernah dibuat
async function suggestEdu3DTopic({ avoidTopics = [] } = {}) {
  const apiKey = getSavedApiKey();
  if (!apiKey) return { success: false, error: 'API Key Gemini belum disetel.' };
  // Tema diundi tiap permintaan agar ide beragam; 5 kandidat + alasan fakta memaksa model memeriksa premis, satu dipilih acak
  const THEMES = [
    'dapur & memasak', 'kamar mandi & toilet', 'kamar tidur & tidur nyenyak', 'mencuci & merawat pakaian', 'bersih-bersih rumah',
    'listrik, lampu & colokan', 'AC, kipas & suhu ruangan', 'air keran, pompa & tandon', 'atap, dinding & rumah bocor', 'tanaman & kebun rumah',
    'motor & bengkel', 'mobil & perjalanan jauh', 'sepeda & ban', 'jalan raya & macet', 'kereta, pesawat & bandara',
    'HP & baterai', 'charger & kabel', 'internet, WiFi & sinyal', 'laptop & komputer', 'kamera & foto',
    'makanan basi & penyimpanan', 'minuman, es & kopi', 'jajanan pasar & gorengan', 'nasi & rice cooker', 'buah & sayur',
    'hujan, petir & banjir', 'panas terik & matahari', 'angin, debu & polusi', 'laut, pantai & ombak', 'gunung & dataran tinggi',
    'serangga di rumah (nyamuk, semut, kecoa)', 'kucing & hewan peliharaan', 'burung & hewan di sekitar', 'ikan & akuarium',
    'tubuh saat olahraga', 'tubuh saat kepanasan / kedinginan', 'kebiasaan sehari-hari yang bikin capek', 'sekolah & alat tulis',
    'kantor & kerja di meja', 'belanja, plastik & kemasan', 'uang, ATM & kartu', 'olahraga & bola', 'mainan & permainan anak',
    'pakaian, sepatu & bau', 'kosmetik & kebersihan diri sehari-hari', 'bangunan tinggi & lift', 'jembatan & konstruksi', 'langit, bulan & bintang'
  ];
  const themes = [...THEMES].sort(() => Math.random() - 0.5).slice(0, 3);
  const promptMessage = `Berikan 5 ide topik video edukasi 3D TikTok bergaya "tahu gak sih" dengan pola MASALAH → SOLUSI: tiap topik membahas 1 MASALAH sehari-hari di Indonesia yang sering dialami orang, yang penyebabnya bisa dijelaskan secara ilmiah DAN ada solusi/tips praktisnya. TEMA kali ini (pilih dari sini): ${themes.join(', ')}. Hindari topik medis/penyakit, politik, agama, dan MITOS / istilah tidak ilmiah (mis. "masuk angin", "angin duduk"). Kelima topik harus berbeda tema & berbeda masalah.
Tiap topik: 1 kalimat tanya santai, maks 13 kata, diawali "Tahu gak sih", menyebut masalahnya, diakhiri "?". Contoh pola: "Tahu gak sih kenapa kaca kamar mandi selalu berembun habis mandi?", "Tahu gak sih kenapa baterai HP cepet drop pas dipakai main game?".
PREMIS WAJIB BENAR: masalahnya harus sesuatu yang semua orang pernah alami sendiri. DILARANG topik tentang aturan, standar, regulasi, spesifikasi produk, atau warna/ukuran/jumlah tertentu (rawan salah). Tulis "fakta": 1 kalimat penyebab ilmiah + solusinya yang benar. Bila tidak yakin, ganti topiknya.
${avoidTopics.length ? `JANGAN sama/mirip dengan: ${avoidTopics.map((t) => `"${t}"`).join(', ')}.` : ''}
Balas HANYA JSON: {"candidates":[{"topic":"...","fakta":"..."}, ...5 item]}`;
  const genAI = new GoogleGenerativeAI(apiKey);
  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 1.0, maxOutputTokens: 900, responseMimeType: 'application/json' }
      }, { timeout: 30000 });
      const raw = ((await model.generateContent([{ text: promptMessage }])).response.text() || '').trim();
      // JSON kadang terpotong / diikuti teks lain → ambil semua pasangan "topic" + "fakta" yang utuh langsung dari teks
      const topics = [];
      const pairRe = /"topic"\s*:\s*"([^"]+)"\s*,\s*"fakta"\s*:\s*"([^"]+)"/g;
      for (let m = pairRe.exec(raw); m; m = pairRe.exec(raw)) {
        const t = m[1].replace(/\s+/g, ' ').trim();
        if (/^tahu gak sih/i.test(t)) topics.push(t);
      }
      if (topics.length) return { success: true, topic: topics[Math.floor(Math.random() * topics.length)].slice(0, 100) };
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Edu3D Topic Error with ${modelName}]:`, err.message);
    }
  }
  return { success: false, error: 'Gemini gagal membuat ide topik. Coba lagi.' };
}

// Suara narator Gemini TTS → berkas WAV (PCM 16-bit mono 24 kHz). Mengembalikan durasi audio (detik).
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
async function synthesizeNarration({ text, voiceName = 'Puck', outPath }) {
  const apiKey = getSavedApiKey();
  if (!apiKey) throw new Error('API Key Gemini belum disetel.');
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Bacakan sebagai narator video edukasi yang santai, jelas, dan antusias, tempo sedang: ${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }
        }),
        signal: AbortSignal.timeout(120000)
      });
      const json = await res.json().catch(() => ({}));
      const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!res.ok || !part) {
        lastError = json?.error?.message || `HTTP ${res.status}`;
        continue;
      }
      const pcm = Buffer.from(part.inlineData.data, 'base64');
      const rate = parseInt((String(part.inlineData.mimeType).match(/rate=(\d+)/) || [])[1], 10) || 24000;
      const header = Buffer.alloc(44);
      header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
      header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
      header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
      header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
      return { durationSec: pcm.length / (rate * 2) };
    } catch (err) {
      lastError = err.message;
    }
  }
  throw new Error(`Gemini TTS gagal membuat suara narasi: ${lastError}`);
}

// Foto karakter yang sama dipakai berulang → hasil deteksi disimpan per berkas (path + ukuran + waktu ubah)
const headBoxCache = new Map();

async function detectHeadBox(imagePath) {
  const apiKey = getSavedApiKey();
  if (!apiKey || !imagePath || !fs.existsSync(imagePath)) return null;
  const st = fs.statSync(imagePath);
  const cacheKey = `${imagePath}|${st.size}|${st.mtimeMs}`;
  if (headBoxCache.has(cacheKey)) return headBoxCache.get(cacheKey);
  const box = await detectHeadBoxUncached(apiKey, imagePath);
  if (box) headBoxCache.set(cacheKey, box);
  return box;
}

async function detectHeadBoxUncached(apiKey, imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const parts = [
    { text: 'Detect the main person\'s HEAD in this photo: face plus all visible hair, from the top of the hair to the chin. Exclude neck, shoulders and clothing. Reply ONLY JSON: {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000. If there is no person, reply {"box_2d":null}.' },
    { inlineData: { data: fs.readFileSync(imagePath).toString('base64'), mimeType } }
  ];
  const genAI = new GoogleGenerativeAI(apiKey);
  for (const modelName of CANDIDATE_MODELS) {
    if (isModelBlocked(modelName)) continue;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0, maxOutputTokens: 100, responseMimeType: 'application/json' }
      }, REQUEST_OPTIONS);
      const raw = ((await model.generateContent(parts)).response.text() || '').trim();
      const box = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).box_2d;
      if (!Array.isArray(box) || box.length !== 4) return null;
      const [ymin, xmin, ymax, xmax] = box.map(Number);
      if (![ymin, xmin, ymax, xmax].every((n) => n >= 0 && n <= 1000) || ymax - ymin < 20 || xmax - xmin < 20) return null;
      return { ymin, xmin, ymax, xmax };
    } catch (err) {
      noteModelError(modelName, err);
      console.error(`[Gemini Head Box Error with ${modelName}]:`, err.message);
    }
  }
  return null;
}

module.exports = {
  generateInstagramCaption,
  generateProductLinkTitle,
  generateRemotionScript,
  detectHeadBox,
  generateEdu3DScript,
  suggestEdu3DTopic,
  synthesizeNarration,
  testGeminiConnection,
  getSavedApiKey,
  HARDCODED_GEMINI_API_KEY
};