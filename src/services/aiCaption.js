const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'sessions/config.json');
const ACCOUNTS_PATH = path.join(PROJECT_ROOT, 'sessions/accounts.json');

// Daftar model resmi dari AI Studio
const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash'
];

function getSavedApiKey() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (cfg && cfg.geminiApiKey) return cfg.geminiApiKey.trim();
    } catch (e) {}
  }
  return '';
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

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = '';

  for (const modelName of CANDIDATE_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 20
        }
      });

      const result = await model.generateContent('Koneksi tes. Balas hanya dengan kata: OK');
      const text = (result.response.text() || '').trim();

      if (text) {
        return {
          success: true,
          message: `Gemini siap & terhubung · model ${modelName} (Respon: ${text})`
        };
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error(`[Gemini Connection Test Failed for ${modelName}]:`, raw);

      if (/API key not valid|API_KEY_INVALID/i.test(raw)) {
        return {
          success: false,
          message: 'API key Gemini tidak valid. Pastikan key tidak terpotong.'
        };
      }
      if (/denied access|PERMISSION_DENIED|403/i.test(raw)) {
        lastError = 'Project ditolak akses (403). Gunakan API key dari project yang aktif.';
        continue;
      }
      lastError = raw.replace(/[GoogleGenerativeAI Error]:\s*/i, '').trim();
    }
  }

  return {
    success: false,
    message: lastError || 'Gagal terhubung ke model Gemini.'
  };
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

  let detectedProduct = promptText.trim();
  if (!detectedProduct && mediaFiles && mediaFiles.length > 0) {
    const rawName = path.basename(mediaFiles[0]);
    detectedProduct = rawName.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '');
  }
  if (!detectedProduct) detectedProduct = 'Atasan Wanita Trendy';

  const isTikTok = resolveIsTikTok(platform, detectedProduct, mediaFiles);

  let promptMessage = '';

  if (isTikTok) {
    // =========================================================================
    // PROMPT KHUSUS TIKTOK (HANYA 1 BARIS HOOK PENASARAN + HASHTAG FYP VIRAL)
    // =========================================================================
    promptMessage = `Kamu adalah copywriter spesialis TikTok Affiliate fashion & OOTD wanita yang ahli membuat konten viral masuk FYP jutaan penonton.
Tugasmu membuat teks caption untuk produk: "${detectedProduct}".

ATURAN WAJIB (SANGAT KETAT):
1. HANYA 1 BARIS LURUS (maksimal 14-18 kata) berupa kalimat rasa penasaran / heran / FOMO yang langsung menarik perhatian orang yang scroll (contoh konsep: "Nyesel banget baru tau atasan secakep dan se-adem ini pas dicoba langsung...", "Beneran nggak nyangka harga segini dapet atasan se-mewah ini...").
2. Di ujung kalimat, selipkan ajakan santai ke keranjang kuning (contoh: "...langsung checkout di keranjang kuning ya!", "...cek keranjang kuning sebelum kehabisan!").
3. DILARANG KERAS menggunakan baris baru (enter), tanda bullet points (- atau •), sapaan formal (seperti "Halo Kak", "Kakak"), atau gaya bahasa promosi katalog jadul.
4. DILARANG KERAS menyertakan nama brand: ETNIC, ETNIC STORE, @etnicpremium, atau hashtag merek seperti #EtnicStore / #Etnic.
5. Sambungkan langsung kalimat tersebut dengan 5-6 hashtag TikTok algoritma FYP terbaik saat ini:
   #racuntiktok #outfitideas #ootdindo #spillbaju #racunoutfit #fyp #fypシ゚viral
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
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: isTikTok ? 0.85 : 0.7,
          topP: 0.85,
          maxOutputTokens: isTikTok ? 120 : 500
        }
      });

      const result = await model.generateContent(promptMessage);
      let text = (result.response.text() || '').trim();

      if (text) {
        if (isTikTok) {
          text = text.replace(/[\r\n]+/g, ' ')
                     .replace(/etnic\s*store/gi, '')
                     .replace(/#etnic\w*/gi, '')
                     .replace(/\s{2,}/g, ' ')
                     .trim();
        }
        return text;
      }
    } catch (err) {
      console.error(`[Gemini Caption Error with ${modelName}]:`, err);
    }
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
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.95, // Variasi tinggi agar selalu berbeda
          maxOutputTokens: 25
        }
      });

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
      console.error(`[Gemini Link Title Error with ${modelName}]:`, err.message);
    }
  }

  return getRandomFallback();
}

module.exports = {
  generateInstagramCaption,
  generateProductLinkTitle,
  testGeminiConnection,
  getSavedApiKey
};