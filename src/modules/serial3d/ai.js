/**
 * AI (Gemini, gratis) untuk konsep Serial Animasi:
 *  - analisisKarakter(gambar): gambar referensi pelanggan → parameter karakter 3D low-poly
 *  - tulisNaskah(premis, karakter, hari, episode sebelumnya): naskah JSON sesuai skema naskah.js,
 *    dirapikan otomatis lalu divalidasi; bila masih salah, Gemini diminta memperbaiki (maks 3x per model).
 */
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { SHOT, GERAK, EKSPRESI, GESTUR, SFX, DUNIA, WAKTU, ADEGAN, BANGUNAN, BAHAYA, BENDA, validateNaskah, CONTOH, norm, tokens } = require('./naskah');
const { RAMBUT, ATASAN, BAWAHAN, AKSESORI, TELINGA, EKOR, POLA: POLA_BULU } = require('./karakter');

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const blokir = new Map();
const terblokir = (m) => (blokir.get(m) || 0) > Date.now();
function catatError(m, err) {
  const s = String(err?.message || err || '');
  if (/429|quota|Too Many Requests/i.test(s)) blokir.set(m, Date.now() + 60 * 60 * 1000);
  else if (/503|overloaded|high demand|timeout|aborted/i.test(s)) blokir.set(m, Date.now() + 3 * 60 * 1000);
}
const ambilJson = (raw) => { const t = String(raw || ''); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); };
const hex = (v, d) => (/^#?[0-9a-f]{6}$/i.test(String(v || '').trim()) ? '#' + String(v).trim().replace('#', '').toLowerCase() : d);
const pilih = (v, list, d) => (list.includes(v) ? v : d);

const SUARA_GENDER = {
  cewek: { nama: 'Leda', gaya: 'cewek muda yang ceria dan ekspresif, logat anak Jakarta, tempo agak cepat', k: 1.1 },
  cowok: { nama: 'Puck', gaya: 'cowok muda yang santai dan lucu, logat anak Jakarta, natural', k: 1.06 },
  anak: { nama: 'Fenrir', gaya: 'bocah yang cempreng, enerjik, dan sok jagoan, logat anak Jakarta', k: 1.17 },
};

/** gambar referensi → parameter karakter (dikunci ke pilihan yang dikenal engine) */
async function analisisKarakter({ apiKey, imagePath, nama }) {
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const prompt = `Kamu desainer karakter 3D low-poly. Lihat karakter di gambar (bisa foto orang, kartun, maskot, atau gambar AI) lalu terjemahkan ke parameter karakter 3D sederhana bergaya chibi low-poly.
Pilih yang PALING MIRIP dari daftar berikut (wajib salah satu persis):
- rambut.model: ${RAMBUT.join(' | ')}  (panjang = rambut lurus melewati bahu, kuncir = diikat ke belakang, bob = sebatas dagu/leher, cepak = pendek rapi, jabrik = berdiri/berantakan, sanggul = dicepol, botak)
- atasan.model: ${ATASAN.join(' | ')}  (kemeja = berkerah/berkancing/jaket, kaos = kaos/sweater/dress bagian atas, tanpa = tidak berbaju)
- bawahan.model: ${BAWAHAN.join(' | ')}  (rok juga untuk dress/gaun, rumput = rok rumput/daun)
- aksesori: ${AKSESORI.join(' | ')}  (pilih 1 yang paling menonjol; hijab/kerudung → bandana dengan warna kerudung)
- gender: cewek | cowok | anak
- badan: normal | gemuk | kurus  (gemuk = badan besar membulat seperti beruang/monster)
- jenis: manusia | hewan  (hewan = karakter binatang/makhluk berbulu, termasuk maskot hewan & kartun hewan)
Bila jenis = hewan, isi juga "hewan": { "telinga": ${TELINGA.join(' | ')}, "ekor": ${EKOR.join(' | ')} (panjang = ekor sangat panjang melingkar). Telinga: panjang HANYA untuk kelinci/telinga sangat panjang tegak; telinga kecil membulat → bulat; lancip seperti kucing/rubah → runcing, "pola": ${POLA_BULU.join(' | ')} (totol = bintik/tutul, belang = garis), "warnaPola": "#hex", "warnaPerut": "#hex atau kosong" (warna perut/dada & moncong bila beda dari bulu utama, mis. krem), "moncong": true/false }
  Untuk hewan: "kulit" = warna BULU utama; atasan.model = tanpa & bawahan.model = tanpa bila tidak memakai baju; rambut.model = botak atau jabrik (jambul).
Warna dalam hex #rrggbb yang cerah & jelas (warna kartun, bukan abu-abu kusam). "kulit" = warna kulit wajah (manusia) atau bulu (hewan).
"deskripsi": 1 kalimat bahasa Indonesia tentang PENAMPILAN & kesan karakter saja (rambut, pakaian, aura), maks 15 kata. JANGAN sebut latar/tempat/kegiatan di foto.
"nama_saran": nama panggilan pendek yang cocok bila tidak ada nama.
Balas HANYA JSON: {"gender":"...","jenis":"manusia|hewan","badan":"normal|gemuk|kurus","hewan":{"telinga":"...","ekor":"...","pola":"...","warnaPola":"#...","warnaPerut":"#...","moncong":true},"kulit":"#...","rambut":{"model":"...","warna":"#..."},"atasan":{"model":"...","warna":"#..."},"bawahan":{"model":"...","warna":"#..."},"aksesori":"...","aksesoriWarna":"#...","taring":false,"deskripsi":"...","nama_saran":"..."}`;
  const parts = [{ text: prompt }, { inlineData: { data: fs.readFileSync(imagePath).toString('base64'), mimeType } }];
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr = null;
  for (const m of MODELS) {
    if (terblokir(m)) continue;
    try {
      const model = genAI.getGenerativeModel({ model: m, generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' } }, { timeout: 40000 });
      const j = ambilJson((await model.generateContent(parts)).response.text());
      const gender = pilih(j.gender, Object.keys(SUARA_GENDER), 'cowok');
      const hewan = j.jenis === 'hewan';
      return {
        jenis: hewan ? 'hewan' : 'manusia',
        badan: pilih(j.badan, ['normal', 'gemuk', 'kurus'], 'normal'),
        ...(hewan ? { hewan: { telinga: pilih(j.hewan?.telinga, TELINGA, 'bulat'), ekor: pilih(j.hewan?.ekor, EKOR, 'pendek'), pola: pilih(j.hewan?.pola, POLA_BULU, 'polos'), warnaPola: hex(j.hewan?.warnaPola, '#1c1b19'), warnaPerut: hex(j.hewan?.warnaPerut, ''), moncong: j.hewan?.moncong !== false } } : {}),
        nama: String(nama || j.nama_saran || 'Karakter').trim().slice(0, 20),
        deskripsi: String(j.deskripsi || '').trim().slice(0, 140),
        gender,
        kulit: hex(j.kulit, '#e0a878'),
        rambut: { model: pilih(j.rambut?.model, RAMBUT, 'cepak'), warna: hex(j.rambut?.warna, '#2a211c') },
        atasan: { model: pilih(j.atasan?.model, ATASAN, 'kaos'), warna: hex(j.atasan?.warna, '#ff7a59') },
        bawahan: { model: pilih(j.bawahan?.model, BAWAHAN, hewan ? 'tanpa' : 'celana'), warna: hex(j.bawahan?.warna, '#2f6fb5') },
        aksesori: pilih(j.aksesori, AKSESORI, 'tanpa'), aksesoriWarna: hex(j.aksesoriWarna, '#ffd23f'),
        taring: !!j.taring,
        suara: { ...SUARA_GENDER[gender] },
      };
    } catch (err) { lastErr = err; catatError(m, err); }
  }
  throw new Error('Gemini gagal membaca gambar karakter: ' + (lastErr?.message || 'tidak ada model tersedia').slice(0, 200));
}

/** "Day 1: ..." per baris → [{hari, ide}] */
function parseRencana(teks) {
  const out = [];
  String(teks || '').split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*(?:day|hari)\s*-?\s*(\d+)\s*[:.\-–—)]\s*(.+)$/i); if (m && m[2].trim()) out.push({ hari: Number(m[1]), ide: m[2].trim() }); });
  return out;
}
const formatRencana = (arr) => arr.slice().sort((a, b) => a.hari - b.hari).map((r) => `Day ${r.hari}: ${r.ide}`).join('\n');

const deskripsiKarakter = (karakter) => `${karakter.nama} (${karakter.jenis === 'hewan' ? `hewan/makhluk berbulu, ${karakter.deskripsi || ''}` : `manusia${karakter.gender ? ', ' + karakter.gender : ''}, ${karakter.deskripsi || ''}`})`;

/**
 * Premis + rencana alur per DAY. Bila premis kosong → AI membuat premis juga.
 * @returns {Promise<{premis, judul, rencana:[{hari, ide}], model}>}
 */
async function buatRencana({ apiKey, premis = '', karakter, dunia = '', waktu = '', dari = 1, jumlah = 10, sebelumnya = [], onProgress }) {
  const premisBaru = String(premis).trim().length < 10;
  const sesuaikan = !premisBaru && dari === 1 && Boolean(DUNIA[dunia]);   // premis lama ditulis ulang supaya cocok latar
  const buatPremis = premisBaru || sesuaikan;
  const sampai = dari + jumlah - 1;
  const prompt = `Kamu showrunner serial animasi 3D TikTok bergaya "DAY 1 ... dari nol": satu karakter bernarasi sendiri, lucu, tiap episode ada kemajuan kecil + masalah baru, penonton ikut menentukan lewat komen.
KARAKTER: ${deskripsiKarakter(karakter)}. Nama WAJIB persis "${karakter.nama}".
${dunia && DUNIA[dunia] ? `LATAR WAJIB: ${DUNIA[dunia].nama}.` : `LATAR yang tersedia (pilih 1 yang cocok, jangan di luar ini): ${Object.values(DUNIA).map((d) => d.nama).join(' | ')}.`}
${waktu && WAKTU[waktu] ? `SUASANA UTAMA: ${WAKTU[waktu]}.` : ''}
${sesuaikan ? `PREMIS DARI PELANGGAN: ${premis}\nTUGAS 1: tulis ulang premis itu (2-3 kalimat) supaya terjadi di LATAR WAJIB di atas: pertahankan karakter, misi, dan ide lucunya, tapi ganti tempat, benda, dan bahaya agar cocok dengan latarnya. Juga JUDUL serial (KAPITAL, maks 3 kata).` : buatPremis ? 'TUGAS 1: buat PREMIS serial yang ORISINAL & lucu (2-3 kalimat): siapa, terjebak/memulai di mana, misi besar jangka panjang yang naik bertahap tiap hari, dan apa yang bikin lucu. Juga JUDUL serial (KAPITAL, maks 3 kata).' : `PREMIS (ikuti persis): ${premis}`}
${sebelumnya.length ? `EPISODE YANG SUDAH TAYANG:\n${sebelumnya.slice(-6).map((e) => `- DAY ${e.hari}: ${String(e.ringkas || e.ide || '').slice(0, 160)}`).join('\n')}` : ''}
TUGAS: buat RENCANA ALUR DAY ${dari} sampai DAY ${sampai}. Tiap DAY = 1 kalimat (maks 25 kata): target hari itu + kejadian lucu/masalah. Alur harus NYAMBUNG & NAIK bertahap (dari nol → makin maju), sesekali ada kemunduran lucu, dan cocok dengan latarnya. ${dari === 1 ? 'DAY 1 = perkenalan & kondisi nol.' : 'Lanjutkan dari episode yang sudah tayang.'}
Jangan sebut merek, politik, SARA.
Balas HANYA JSON: { ${buatPremis ? '"premis": "...", "judul": "...", ' : ''}"rencana": [ { "hari": ${dari}, "ide": "..." } ] }`;
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr = null;
  for (const m of MODELS) {
    if (terblokir(m)) continue;
    try {
      onProgress?.(`Gemini (${m}) menyusun ${buatPremis ? 'premis & ' : ''}rencana DAY ${dari}-${sampai}...`);
      const model = genAI.getGenerativeModel({ model: m, generationConfig: { temperature: 1, maxOutputTokens: 4096, responseMimeType: 'application/json' } }, { timeout: 60000 });
      const j = ambilJson((await model.generateContent([{ text: prompt }])).response.text());
      const rencana = (Array.isArray(j.rencana) ? j.rencana : []).map((r, i) => ({ hari: Number(r.hari) || dari + i, ide: String(r.ide || '').replace(/\s+/g, ' ').trim() })).filter((r) => r.ide && r.hari >= dari);
      if (!rencana.length) throw new Error('rencana kosong');
      return { premis: buatPremis ? (String(j.premis || '').trim() || premis) : premis, judul: buatPremis ? String(j.judul || '').trim().toUpperCase() : '', rencana, model: m };
    } catch (err) { lastErr = err; catatError(m, err); }
  }
  throw new Error('Gemini gagal menyusun rencana: ' + (lastErr?.message || 'tidak ada model tersedia').slice(0, 200));
}

/** rapikan kesalahan kecil dari AI (kata jangkar salah, enum salah) supaya tidak perlu minta ulang */
function rapikan(n, karakterId) {
  if (!n || typeof n !== 'object') return n;
  n.versi = 1;
  const dunia = DUNIA[n.seri?.dunia] ? n.seri.dunia : (Object.keys(DUNIA).find((d) => norm(d) === norm(n.seri?.dunia)) || 'pulau');
  const waktu = WAKTU[n.seri?.waktu] ? n.seri.waktu : (Object.keys(WAKTU).find((w) => norm(w) === norm(n.seri?.waktu)) || 'siang');
  n.seri = Object.assign({}, n.seri || {}, { dunia, waktu, karakter: karakterId, label: n.seri?.label || 'DAY' });
  const ada = (text, w) => tokens(text).some((t) => norm(t) === norm(w));
  const ev = DUNIA[dunia].event;
  const kal = Array.isArray(n.kalimat) ? n.kalimat : [];
  const ids = new Set();
  kal.forEach((k, i) => {
    if (!k || typeof k !== 'object') return;
    k.text = String(k.text || '').replace(/\s+/g, ' ').trim();
    let id = String(k.id || `k${i + 1}`).replace(/[^a-zA-Z0-9_]/g, '') || `k${i + 1}`; while (ids.has(id)) id += '_'; ids.add(id); k.id = id;
    if (k.shot && !SHOT.includes(k.shot)) k.shot = 'badan';
    if (i === 0) k.shot = 'udara';
    if (k.gerak && !GERAK.includes(k.gerak)) delete k.gerak;
    if (k.ekspresi && !EKSPRESI.includes(k.ekspresi)) delete k.ekspresi;
    if (k.gestur && !GESTUR.includes(k.gestur)) delete k.gestur;
    if (Array.isArray(k.sorot)) k.sorot = k.sorot.filter((w) => ada(k.text, w)); else delete k.sorot;
    if (Array.isArray(k.beat)) k.beat = k.beat.filter((b) => b && ada(k.text, b.pada)).map((b) => { if (b.ekspresi && !EKSPRESI.includes(b.ekspresi)) delete b.ekspresi; if (b.gestur && !GESTUR.includes(b.gestur)) delete b.gestur; return b; }).filter((b) => b.ekspresi || b.gestur);
    else delete k.beat;
    if (k.kartu) {
      const arr = (Array.isArray(k.kartu) ? k.kartu : [k.kartu]).filter((c) => c && ['tabel', 'aturan', 'bubble', 'ktp'].includes(c.tipe));
      arr.forEach((c) => {
        if (c.pada && !ada(k.text, c.pada)) delete c.pada;
        if (Array.isArray(c.baris) && c.tipe === 'tabel') c.baris.forEach((r) => { if (r && r.pada && !ada(k.text, r.pada)) delete r.pada; if (r && r.gaya && !['ok', 'bad', 'q'].includes(r.gaya)) r.gaya = 'ok'; });
      });
      k.kartu = arr.filter((c) => (c.tipe !== 'tabel' || (Array.isArray(c.baris) && c.baris.length)) && (c.tipe !== 'bubble' || c.teks) && (c.tipe !== 'aturan' || (c.kecil && c.besar)) && (c.tipe !== 'ktp' || c.judul));
      if (!k.kartu.length) delete k.kartu;
    }
    if (k.adegan && k.adegan.objek === 'kaktus' && dunia !== 'gurun') k.adegan.objek = 'semak';   // kaktus hanya di gurun
    if (k.adegan) {
      const a = k.adegan;
      if (!a || typeof a !== 'object' || !ADEGAN[a.jenis]) delete k.adegan;
      else {
        if (!ADEGAN[a.jenis].includes(a.objek)) { const cocok = ADEGAN[a.jenis].find((o) => norm(o) === norm(a.objek)); if (cocok) a.objek = cocok; else delete k.adegan; }
        if (k.adegan && a.pada && !ada(k.text, a.pada)) delete a.pada;
        if (k.adegan && a.bagian && !['kaki', 'tangan'].includes(a.bagian)) a.bagian = 'kaki';
      }
    }
    if (k.event) { if (typeof k.event === 'string') k.event = { jenis: k.event }; if (!ev.includes(k.event.jenis)) delete k.event; else if (k.event.pada && !ada(k.text, k.event.pada)) delete k.event.pada; }
    if (Array.isArray(k.sfx)) k.sfx = k.sfx.filter((s) => s && SFX.includes(s.jenis)).map((s) => { if (s.pada && !ada(k.text, s.pada)) delete s.pada; return s; }); else delete k.sfx;
    if (k.shot === 'teriak') k.suara = Object.assign({}, k.suara || {}, { teriak: true });
  });
  n.kalimat = kal.filter((k) => k && k.text);
  if (n.kalimat.length) n.kalimat[n.kalimat.length - 1].shot = 'penutup';
  return n;
}

const POLA = `SKEMA NASKAH (JSON):
{
 "seri": { "judul": "JUDUL SERIAL (KAPITAL, maks 3 kata)", "hari": <nomor hari>, "label": "DAY", "dunia": "<kunci dunia>", "waktu": "<kunci waktu>", "papan": { "judul": "1 kata KAPITAL, mis. PENGHUNI/BANGUNAN/HUTANG", "angka": <angka awal> } },
 "cover": { "judul": "JUDUL\\nCOVER (KAPITAL, 2 baris, maks 14 huruf/baris)", "sub": "teks kecil lucu maks 30 huruf" },
 "penutup": { "label": "BESOK", "baris": ["1 baris janji episode besok, maks 40 huruf"], "sorot": "misi tambahan lucu maks 45 huruf + 1 emoji" },
 "kalimat": [ { "id": "kata_unik", "text": "kalimat yang DIUCAPKAN karakter", "shot": "...", "gerak": "...", "ekspresi": "...", "gestur": "...", "sorot": ["kata-persis-dari-text"], "jeda": 0.15,
   "beat": [ { "pada": "kata-persis-dari-text", "ekspresi": "...", "gestur": "..." } ],
   "kartu": [ ... ], "adegan": { "jenis": "...", "objek": "...", "pada": "kata", "bagian": "kaki" }, "event": { "jenis": "...", "pada": "kata" }, "sfx": [ { "pada": "kata", "jenis": "..." } ] } ]
}
PILIHAN (WAJIB persis salah satu):
- seri.dunia (LATAR, pilih yang paling cocok dengan premis):
${Object.entries(DUNIA).map(([k, d]) => `   ${k} = ${d.nama}; event: ${d.event.filter((e) => !['kelapaJatuh', 'kepitingLewat'].includes(e)).join(', ')}; benda jatuh = ${d.benda}; hewan pengganggu = ${d.hewan}`).join('\n')}
- seri.waktu (suasana episode): ${Object.entries(WAKTU).map(([k, d]) => `${k} = ${d}`).join('; ')}
- shot: ${SHOT.join(', ')}  (udara = kamera dari langit melihat seluruh daratan, HANYA kalimat pertama; badan = seluruh badan; dekat = kepala+bahu; sangatDekat = wajah; teriak = stiker teriak layar penuh, MAKS 1x, text berupa teriakan "Aaaaaaaa!"; penutup = kamera naik menjauh, HANYA kalimat terakhir)
- gerak: ${GERAK.join(', ')}  (dolly = kamera mendekat dari jauh, pan = mengikuti karakter yang jalan masuk, pakai bersama gestur "jalan")
- ekspresi: ${EKSPRESI.join(', ')}
- gestur: ${GESTUR.join(', ')}  (tidur = rebahan, hanya kalimat pertama; jalan = jalan masuk ke panggung; kejar = lari berputar, hanya kalimat terakhir; hitungJari = menghitung daftar)
- kartu.tipe:
   "tabel": { "tipe":"tabel", "judul":"JUDUL KAPITAL", "atas":268, "baris":[ {"label":"Air","nilai":"?","gaya":"ok|bad|q","ikon":"💧","pada":"kata"} ] } (2-4 baris, nilai singkat KAPITAL/angka)
   "aturan": { "tipe":"aturan", "ikon":"💬", "warna":"#ffd23f", "kecil":"TEKS KECIL KAPITAL", "besar":"= teks <b>BESAR</b>", "atas":268 }
   "bubble": { "tipe":"bubble", "teks":"emoji + teks pendek", "atas":420-640, "kiri":500-640, "warna":"#c9efc8 (opsional)" }
   "ktp": { "tipe":"ktp", "kepala":"TEKS KECIL", "judul":"JUDUL", "baris":["Nama: ...","..."], "kecil":"status lucu", "atas":268 }
  (kartu kedua di kalimat yang sama pakai "atas": 414; "pada" = kata saat kartu muncul)
- event (HANYA yang tersedia di dunia terpilih): kapalTenggelam (pulau saja, pakai dengan gestur tunjukSamping), bendaJatuh (benda dunia itu jatuh ke kepala karakter, kalimatnya mis. "Aduh."), hewanLewat (hewan pengganggu lewat & mencuri benda yang jatuh), papanAngka (angka di papan berubah, pakai "angka"), gunungMeletus (zamanBatu saja: gunung berapi menyembur & bumi bergetar)
- adegan (VISUAL = ISI KALIMAT): bila kalimat menyebut AKSI fisik atau BENDA, kalimat itu WAJIB punya "adegan" supaya gambarnya sesuai omongan:
   bangun = karakter memalu & objek berdiri bertahap lalu tetap ada (objek: ${BANGUNAN.join(', ')})
   kena = karakter melangkah lalu kena/tertusuk objek (objek: ${BAHAYA.join(', ')}; "bagian": kaki | tangan; "pada" = kata saat kena, mis. "Aw!")
   pegang = memamerkan benda di tangan · makan = menggigit benda · cari = mengorek tanah lalu menemukan benda ("pada" = kata saat ketemu) · masak = memanggang benda di api unggun (objek: ${BENDA.join(', ')})
   lihat = kamera menyorot objek lalu karakter menunjuk (objek apa saja di atas)
  ATURAN KERAS: jangan menceritakan aksi/benda fisik yang TIDAK bisa digambar dengan adegan di atas. Kalau bilang "bikin tenda" → adegan bangun tenda di kalimat itu. Kalau "kakinya kena kaktus" → adegan kena kaktus bagian kaki di kalimat itu. Satu kalimat maks 1 adegan; jangan pakai adegan di kalimat pertama & terakhir. Target 4-7 adegan per episode.
- sfx.jenis: ${SFX.join(', ')}  (growl = perut lapar, sad = trombon sedih)
ATURAN "pada", "sorot", "beat": kata HARUS persis ada di "text" kalimat itu (boleh beda huruf besar/tanda baca).`;

/**
 * @param {object} o { apiKey, premis, karakter, hari, sebelumnya:[{hari, judul, ringkas, janji}], target (detik) }
 * @returns {Promise<{naskah, model, percobaan}>}
 */
async function tulisNaskah({ apiKey, premis, karakter, hari = 1, sebelumnya = [], judulSeri = '', dunia = '', waktu = '', alur = '', alurBesok = '', onProgress }) {
  const contoh = JSON.stringify(CONTOH.pulau_day1);
  const riwayat = sebelumnya.length
    ? `RIWAYAT EPISODE SEBELUMNYA (lanjutkan ceritanya, JANGAN ulang lelucon yang sama; tepati janji episode sebelumnya):\n${sebelumnya.slice(-4).map((e) => `- DAY ${e.hari}${e.suasana ? ` (${e.suasana})` : ''}: ${e.ringkas}${e.janji ? ` | janji untuk besok: ${e.janji}` : ''}`).join('\n')}`
    : 'Ini EPISODE PERTAMA: perkenalkan karakter, situasinya, dan aturan "komen = gue kerjain".';
  const prompt = `Kamu penulis naskah serial animasi 3D TikTok bergaya "DAY ${hari} ... dari nol": satu karakter bernarasi sendiri (orang pertama, "gue"), lucu, cepat, banyak punchline, mengajak penonton komen & follow agar ikut menentukan cerita besok.
KARAKTER: ${karakter.nama} (${karakter.jenis === 'hewan' ? `HEWAN/makhluk berbulu ${karakter.hewan?.pola !== 'polos' ? karakter.hewan?.pola : ''}, ekor ${karakter.hewan?.ekor}, telinga ${karakter.hewan?.telinga}; boleh bercanda soal ekor/bulunya` : `manusia, gender ${karakter.gender || '-'}, rambut ${karakter.rambut.model}, atasan ${karakter.atasan.model}, bawahan ${karakter.bawahan.model}, aksesori ${karakter.aksesori}`}).
NAMA KARAKTER: "${karakter.nama}" — WAJIB dipakai PERSIS (huruf sama), jangan diganti, dipendekkan, atau diplesetkan. Sebut di kalimat perkenalan: "Kenalin, gue ${karakter.nama}...".
PREMIS SERIAL (PALING PENTING, seluruh cerita harus mengikuti ini): ${premis}
${judulSeri ? `JUDUL SERIAL (pakai persis): ${judulSeri}` : ''}
EPISODE: DAY ${hari}
${alur ? `ALUR DAY ${hari} (WAJIB jadi inti cerita episode ini): ${alur}` : ''}
${alurBesok ? `RENCANA DAY ${hari + 1} (pakai untuk "penutup" sebagai janji/teaser besok): ${alurBesok}` : ''}
${riwayat}
${dunia && DUNIA[dunia] ? `LATAR SUDAH DITENTUKAN PELANGGAN: "seri.dunia" WAJIB "${dunia}" (${DUNIA[dunia].nama}). Kalau premis/rencana menyebut tempat lain (mis. gurun, pantai, hutan), PINDAHKAN ceritanya ke latar ini: semua kalimat, kartu, dan adegan harus cocok dengan ${DUNIA[dunia].nama} (jangan sebut kaktus/pasir di salju, salju di gurun, dst).` : 'LATAR: pilih "seri.dunia" yang PALING sesuai premis (mis. premis zaman batu/purba/dinosaurus → zamanBatu; kemah/hutan → hutan; padang pasir → gurun; salju/kutub → salju; pulau/pantai → pulau). Ceritakan premis di latar itu dan sebut benda/hewan khas latar tersebut.'}
${waktu && WAKTU[waktu] ? `WAKTU SUDAH DITENTUKAN: "seri.waktu" WAJIB "${waktu}" — sesuaikan cerita dengan suasana ${WAKTU[waktu]}.` : 'WAKTU: pilih "seri.waktu" yang cocok dengan cerita episode ini (pagi/siang/sore/malam/hujan); usahakan BEDA dari episode sebelumnya supaya tiap DAY terasa baru, dan sebut suasananya di naskah (mis. "Malam ini...", "Hujan deras...").'}

ATURAN NASKAH:
1. 11-15 kalimat, total ±45-55 detik. Bahasa gaul Jakarta (gue/lo, nggak, udah, banget), kalimat pendek & punchy, tiap kalimat maks 14 kata.
2. Kalimat 1: shot "udara", gestur "tidur", ekspresi "datar", membuka "Hari ke-${hari}..." / "Day ${hari}...". Kalimat terakhir: shot "penutup", ekspresi panik/senang, gestur "kejar" atau "lambai".
3. Variasikan shot (badan/dekat/sangatDekat) & ganti ekspresi/gestur lewat "beat" di kata kunci (punchline!). Minimal 4 kartu (tabel status/inventaris/misi, aturan komen, bubble), 1 shot "teriak" opsional di tengah, 1-2 event dunia.
4. Wajib ada ajakan: "Lo komen, gue ..." dan "Follow ..." sebelum penutup.
5. "penutup.baris" & "penutup.sorot" = janji episode DAY ${hari + 1}.
6. "sorot" = 1-3 kata penting per kalimat untuk caption kuning.
7. Jangan sebut merek, politik, SARA. Karakter & cerita ORISINAL.
8. ORISINAL: DILARANG menyalin kalimat/lelucon dari contoh (mis. "Penghuninya? Gue doang", "Bukan Tarzan", "HP gue? Ikut tenggelam", "Cicilan tetap jalan", "butuh tiga hal", "wifi kalau boleh", "Oke. Paniknya udah", "pulaunya luas banget"). Tulis lelucon & daftar BARU yang khas premis ini. Kartu (tabel/aturan/ktp/bubble) isinya juga harus baru & sesuai premis. Event dunia hanya dipakai bila cocok dengan cerita.

${POLA}

CONTOH NASKAH LENGKAP (karakter & cerita lain, tiru STRUKTUR & GAYA-nya, BUKAN isinya):
${contoh}

Balas HANYA JSON naskah.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr = null, terbaik = null;
  for (const m of MODELS) {
    if (terblokir(m)) continue;
    try {
      const model = genAI.getGenerativeModel({ model: m, generationConfig: { temperature: 0.95, maxOutputTokens: 8192, responseMimeType: 'application/json' } }, { timeout: 90000 });
      let feedback = '';
      for (let coba = 1; coba <= 3; coba++) {
        onProgress?.(`Gemini (${m}) menulis naskah DAY ${hari}${coba > 1 ? ` — perbaikan ke-${coba - 1}` : ''}...`);
        const raw = (await model.generateContent([{ text: prompt + feedback }])).response.text();
        let j; try { j = ambilJson(raw); } catch (e) { feedback = '\n\nPERINGATAN: balasan sebelumnya bukan JSON yang valid / terpotong. Balas JSON lengkap saja.'; continue; }
        if (j && typeof j === 'object') { j.seri = Object.assign({}, j.seri || {}); if (dunia && DUNIA[dunia]) j.seri.dunia = dunia; if (waktu && WAKTU[waktu]) j.seri.waktu = waktu; }
        const n = rapikan(j, karakter.id);
        n.seri.hari = hari; if (judulSeri) n.seri.judul = judulSeri;
        const v = validateNaskah(n);
        // nama karakter wajib disebut persis (AI kadang memplesetkan, mis. "marsupilami" → "Marsudi")
        const namaOk = !v.ok || v.naskah.kalimat.some((k) => norm(k.text).includes(norm(karakter.nama)));
        if (v.ok && v.naskah.kalimat.length >= 8 && namaOk) return { naskah: v.naskah, model: m, percobaan: coba };
        const errs = !v.ok ? v.errors : !namaOk ? [`nama karakter WAJIB ditulis persis "${karakter.nama}" (minimal di kalimat perkenalan), jangan diganti/diplesetkan`] : [`hanya ${v.naskah.kalimat.length} kalimat, minimal 11`];
        if (!terbaik || errs.length < terbaik.errs.length) terbaik = { errs };
        feedback = `\n\nNASKAH SEBELUMNYA SALAH, perbaiki kesalahan ini lalu kirim ULANG naskah lengkap:\n- ${errs.slice(0, 15).join('\n- ')}`;
      }
    } catch (err) { lastErr = err; catatError(m, err); }
  }
  throw new Error(terbaik ? `Naskah AI belum valid: ${terbaik.errs.slice(0, 3).join('; ')}` : `Gemini gagal menulis naskah: ${(lastErr?.message || 'tidak ada model tersedia').slice(0, 200)}`);
}

module.exports = { analisisKarakter, tulisNaskah, buatRencana, parseRencana, formatRencana, rapikan, SUARA_GENDER };
