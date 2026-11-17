/**
 * Skema naskah "Serial Animasi Day-N" (konsep SA) + validasi + naskah contoh.
 * Satu file naskah JSON menentukan semuanya: kalimat, shot, ekspresi, gestur, kartu, event dunia.
 * Dipakai di main process (validasi sebelum render) dan dimuat engine three.js lewat /proyek/naskah.json.
 */
const SHOT = ['udara', 'badan', 'dekat', 'sangatDekat', 'teriak', 'penutup'];
const GERAK = ['dorong', 'diam', 'dolly', 'pan'];
const EKSPRESI = ['netral', 'senang', 'datar', 'kaget', 'sedih', 'bangga', 'panik', 'marah', 'mikir'];
const GESTUR = ['diam', 'lambai', 'tunjukPenonton', 'tunjukDiri', 'tanganPinggang', 'pegangPerut', 'memohon', 'pegangHp',
  'duaTanganAtas', 'hitungJari', 'geleng', 'lompat', 'jalan', 'tidur', 'kejar', 'tunjukSamping', 'angkatTangan'];
const KARTU = ['tabel', 'aturan', 'bubble', 'ktp'];
const GAYA_PILL = ['ok', 'bad', 'q'];
const SFX = ['pop', 'tick', 'thud', 'whoosh', 'hit', 'bubble', 'bonk', 'sad', 'growl'];
// Dunia (latar) & event yang tersedia. kelapaJatuh/kepitingLewat = nama lama (alias bendaJatuh/hewanLewat).
const UMUM = ['bendaJatuh', 'hewanLewat', 'papanAngka'];
const DUNIA = {
  pulau: { nama: 'pulau tropis (pantai, hutan kelapa, laut, kapal)', event: ['kapalTenggelam', 'kelapaJatuh', 'kepitingLewat', ...UMUM], benda: 'kelapa', hewan: 'kepiting' },
  zamanBatu: { nama: 'zaman batu / prasejarah (gunung berapi berasap, pakis raksasa, batu besar, tenda kulit, api unggun, papan batu)', event: [...UMUM, 'gunungMeletus'], benda: 'batu', hewan: 'dino kecil' },
  hutan: { nama: 'hutan pinus di tepi danau (tenda kemah, api unggun)', event: UMUM, benda: 'apel', hewan: 'kepiting' },
  gurun: { nama: 'gurun pasir di tepi pantai (kaktus, batu cadas, tenda)', event: UMUM, benda: 'kelapa', hewan: 'kepiting' },
  salju: { nama: 'daerah bersalju (pinus bersalju, tanah putih, tenda)', event: UMUM, benda: 'bola salju', hewan: 'kepiting' },
};
// Waktu / suasana (seri.waktu). siang = bawaan.
const WAKTU = { pagi: 'pagi (matahari terbit, hangat)', siang: 'siang (cerah)', sore: 'sore (senja oranye)', malam: 'malam (bulan & bintang, api unggun)', hujan: 'hujan (mendung, gerimis)' };
// Adegan: visual mengikuti narasi (engine/adegan.js + engine/objek.js)
const BANGUNAN = ['tenda', 'gubuk', 'rakit', 'apiUnggun', 'pagar', 'menara'];
const BAHAYA = ['kaktus', 'semak', 'batuBesar'];
const BENDA = ['kelapa', 'apel', 'ikan', 'kayu', 'batu', 'tombak', 'daun', 'jamur', 'telur', 'hp'];
const ADEGAN = { bangun: BANGUNAN, kena: BAHAYA, pegang: BENDA, makan: BENDA, cari: BENDA, masak: BENDA, lihat: [...BANGUNAN, ...BAHAYA, ...BENDA] };
const MAKS_KALIMAT = 25;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (text) => String(text || '').split(/\s+/).filter(Boolean);
const adaKata = (text, kata) => tokens(text).some((w) => norm(w) === norm(kata));

/** Validasi + normalisasi. Mengembalikan { ok, errors, naskah }. naskah sudah diberi nilai bawaan. */
function validateNaskah(input) {
  const errors = [];
  const E = (m) => errors.push(m);
  let n;
  try { n = typeof input === 'string' ? JSON.parse(input) : JSON.parse(JSON.stringify(input || {})); } catch (e) { return { ok: false, errors: ['JSON tidak valid: ' + e.message], naskah: null }; }
  if (!n || typeof n !== 'object') return { ok: false, errors: ['Naskah harus berupa objek JSON'], naskah: null };

  n.versi = Number(n.versi) || 1;
  const seri = (n.seri = Object.assign({ judul: 'SERIAL', hari: 1, label: 'DAY', dunia: 'pulau', karakter: 'rere' }, n.seri || {}));
  seri.hari = Number(seri.hari);
  if (!Number.isInteger(seri.hari) || seri.hari < 1) E('seri.hari harus bilangan bulat ≥ 1');
  if (!DUNIA[seri.dunia]) E(`seri.dunia "${seri.dunia}" tidak dikenal (tersedia: ${Object.keys(DUNIA).join(', ')})`);
  if (!seri.waktu) seri.waktu = 'siang';
  if (!WAKTU[seri.waktu]) E(`seri.waktu "${seri.waktu}" tidak dikenal (tersedia: ${Object.keys(WAKTU).join(', ')})`);
  if (seri.papan && (typeof seri.papan !== 'object' || !seri.papan.judul)) E('seri.papan harus { judul, angka }');
  if (seri.papan) seri.papan.angka = Number(seri.papan.angka) || 1;

  n.cover = Object.assign({ judul: seri.judul, sub: '' }, n.cover || {});
  n.penutup = Object.assign({ label: 'BESOK', baris: [], sorot: '' }, n.penutup || {});
  if (!Array.isArray(n.penutup.baris)) E('penutup.baris harus array teks');
  if (n.suara && typeof n.suara !== 'object') E('suara harus objek { nama, gaya, k }');

  const ev = (DUNIA[seri.dunia] || DUNIA.pulau).event;
  const kal = n.kalimat;
  if (!Array.isArray(kal) || !kal.length) E('kalimat harus array berisi minimal 1 kalimat');
  else if (kal.length > MAKS_KALIMAT) E(`kalimat terlalu banyak (${kal.length}), maksimum ${MAKS_KALIMAT}`);
  const ids = new Set();
  let adaShot = false;
  (Array.isArray(kal) ? kal : []).forEach((k, i) => {
    const p = `kalimat[${i}]`;
    if (!k || typeof k !== 'object') { E(`${p} harus objek`); return; }
    if (!k.id) k.id = `k${i + 1}`;
    k.id = String(k.id);
    if (ids.has(k.id)) E(`${p}.id "${k.id}" dobel`); ids.add(k.id);
    if (!k.text || !String(k.text).trim()) E(`${p}.text kosong`);
    k.text = String(k.text || '').trim();
    if (i === 0 && !k.shot) k.shot = 'udara';
    if (k.shot) { if (!SHOT.includes(k.shot)) E(`${p}.shot "${k.shot}" tidak dikenal (${SHOT.join(', ')})`); adaShot = true; }
    if (k.gerak && !GERAK.includes(k.gerak)) E(`${p}.gerak "${k.gerak}" tidak dikenal (${GERAK.join(', ')})`);
    if (k.ekspresi && !EKSPRESI.includes(k.ekspresi)) E(`${p}.ekspresi "${k.ekspresi}" tidak dikenal (${EKSPRESI.join(', ')})`);
    if (k.gestur && !GESTUR.includes(k.gestur)) E(`${p}.gestur "${k.gestur}" tidak dikenal (${GESTUR.join(', ')})`);
    k.jeda = k.jeda == null ? 0.18 : Number(k.jeda);
    if (!(k.jeda >= 0 && k.jeda <= 5)) E(`${p}.jeda harus 0–5 detik`);
    if (k.sorot && !Array.isArray(k.sorot)) E(`${p}.sorot harus array kata`);
    (k.sorot || []).forEach((w) => { if (!adaKata(k.text, w)) E(`${p}.sorot "${w}" tidak ada di teks`); });
    if (k.beat) {
      if (!Array.isArray(k.beat)) E(`${p}.beat harus array`);
      else k.beat.forEach((b, j) => {
        const q = `${p}.beat[${j}]`;
        if (!b || !b.pada) E(`${q}.pada (kata jangkar) wajib`); else if (!adaKata(k.text, b.pada)) E(`${q}.pada "${b.pada}" tidak ada di teks`);
        if (b.ekspresi && !EKSPRESI.includes(b.ekspresi)) E(`${q}.ekspresi "${b.ekspresi}" tidak dikenal`);
        if (b.gestur && !GESTUR.includes(b.gestur)) E(`${q}.gestur "${b.gestur}" tidak dikenal`);
        if (!b.ekspresi && !b.gestur) E(`${q} harus punya ekspresi atau gestur`);
      });
    }
    if (k.kartu) {
      const arr = Array.isArray(k.kartu) ? k.kartu : [k.kartu];
      arr.forEach((c, j) => {
        const q = `${p}.kartu[${j}]`;
        if (!c || !KARTU.includes(c.tipe)) { E(`${q}.tipe harus salah satu: ${KARTU.join(', ')}`); return; }
        if (c.pada && !adaKata(k.text, c.pada)) E(`${q}.pada "${c.pada}" tidak ada di teks`);
        if (c.tipe === 'tabel') {
          if (!Array.isArray(c.baris) || !c.baris.length) E(`${q}.baris wajib (array {label, nilai, gaya, ikon, pada})`);
          else c.baris.forEach((r, m) => {
            if (!r || r.label == null || r.nilai == null) E(`${q}.baris[${m}] butuh label & nilai`);
            if (r.gaya && !GAYA_PILL.includes(r.gaya)) E(`${q}.baris[${m}].gaya harus ok | bad | q`);
            if (r.pada && !adaKata(k.text, r.pada)) E(`${q}.baris[${m}].pada "${r.pada}" tidak ada di teks`);
          });
        }
        if (c.tipe === 'aturan' && (!c.kecil || !c.besar)) E(`${q} tipe aturan butuh ikon, kecil, besar`);
        if (c.tipe === 'bubble' && !c.teks) E(`${q} tipe bubble butuh teks`);
        if (c.tipe === 'ktp' && !c.judul) E(`${q} tipe ktp butuh judul`);
      });
      k.kartu = arr;
    }
    if (k.adegan) {
      const a = k.adegan;
      if (typeof a !== 'object' || !ADEGAN[a.jenis]) E(`${p}.adegan.jenis harus salah satu: ${Object.keys(ADEGAN).join(', ')}`);
      else {
        if (!ADEGAN[a.jenis].includes(a.objek)) E(`${p}.adegan.objek "${a.objek}" tidak cocok untuk ${a.jenis} (pilih: ${ADEGAN[a.jenis].join(', ')})`);
        if (a.pada && !adaKata(k.text, a.pada)) E(`${p}.adegan.pada "${a.pada}" tidak ada di teks`);
        if (a.bagian && !['kaki', 'tangan'].includes(a.bagian)) E(`${p}.adegan.bagian harus kaki | tangan`);
      }
    }
    if (k.event) {
      if (typeof k.event === 'string') k.event = { jenis: k.event };
      if (!ev.includes(k.event.jenis)) E(`${p}.event "${k.event.jenis}" tidak ada di dunia ${seri.dunia} (${ev.join(', ')})`);
      if (k.event.pada && !adaKata(k.text, k.event.pada)) E(`${p}.event.pada "${k.event.pada}" tidak ada di teks`);
    }
    if (k.sfx) {
      if (!Array.isArray(k.sfx)) E(`${p}.sfx harus array`);
      else k.sfx.forEach((s, j) => { if (!s || !SFX.includes(s.jenis)) E(`${p}.sfx[${j}].jenis tidak dikenal (${SFX.join(', ')})`); if (s.pada && !adaKata(k.text, s.pada)) E(`${p}.sfx[${j}].pada tidak ada di teks`); });
    }
    if (k.shot === 'teriak') k.stiker = Object.assign({ teks: 'AAAAAA!!', sub: '' }, k.stiker || {});
  });
  if (Array.isArray(kal) && kal.length && !adaShot) E('minimal satu kalimat harus punya shot');
  return { ok: !errors.length, errors, naskah: errors.length ? null : n };
}

// ---------------------------------------------------------------------------------------------
// Naskah contoh (karakter & cerita orisinal milik aplikasi; pelanggan nanti menulis naskahnya sendiri)
// ---------------------------------------------------------------------------------------------
const CONTOH = {
  pulau_day1: {
    versi: 1,
    seri: { judul: 'TERDAMPAR SENDIRIAN', hari: 1, label: 'DAY', dunia: 'pulau', karakter: 'rere', papan: { judul: 'PENGHUNI', angka: 1 } },
    cover: { judul: 'TERDAMPAR\nSENDIRIAN', sub: 'penghuni: 1 (gue doang)' },
    penutup: { label: 'BESOK', baris: ['bangunan pertama = komen teratas'], sorot: 'misi tambahan: rebut kelapa dari kepiting 🦀' },
    kalimat: [
      { id: 'buka', text: 'Hari pertama, terdampar di pulau.', shot: 'udara', ekspresi: 'datar', gestur: 'tidur', sorot: ['pertama', 'pulau.'], jeda: 0.14 },
      { id: 'sendiri', text: 'Penghuninya? Gue doang.', shot: 'badan', gerak: 'dolly', ekspresi: 'sedih', gestur: 'diam', sorot: ['doang.'], jeda: 0.2,
        beat: [{ pada: 'doang', ekspresi: 'datar' }] },
      { id: 'kenal', text: 'Kenalin, gue Rere. Bukan Tarzan. Tarzan punya teman.', shot: 'badan', gerak: 'pan', ekspresi: 'senang', gestur: 'jalan', sorot: ['Rere.', 'teman.'], jeda: 0.22,
        beat: [{ pada: 'Rere', gestur: 'lambai', ekspresi: 'senang' }, { pada: 'Bukan', gestur: 'geleng', ekspresi: 'netral' }, { pada: 'punya', gestur: 'diam', ekspresi: 'sedih' }],
        kartu: [{ tipe: 'bubble', teks: '👥 teman: 0', atas: 560, kiri: 600, pada: 'teman' }] },
      { id: 'status', text: 'Rambut toska, rok biru, perut kosong.', shot: 'dekat', ekspresi: 'bangga', gestur: 'tanganPinggang', sorot: ['toska,', 'biru,', 'kosong.'], jeda: 0.18,
        beat: [{ pada: 'perut', ekspresi: 'datar', gestur: 'pegangPerut' }],
        kartu: [{ tipe: 'tabel', judul: 'STATUS RERE', atas: 268, baris: [
          { label: 'Rambut', nilai: 'TOSKA', gaya: 'ok', pada: 'toska' }, { label: 'Rok', nilai: 'BIRU', gaya: 'ok', pada: 'rok' }, { label: 'Perut', nilai: 'KOSONG', gaya: 'bad', pada: 'kosong' }] }],
        sfx: [{ pada: 'kosong', jenis: 'growl' }] },
      { id: 'kapal', text: 'Kapal gue? Tenggelam.', shot: 'badan', ekspresi: 'netral', gestur: 'tunjukSamping', sorot: ['Tenggelam.'], jeda: 0.14,
        event: { jenis: 'kapalTenggelam', pada: 'Tenggelam' } },
      { id: 'hp', text: 'HP gue? Ikut tenggelam. Sinyal? Nol. Cicilan? Tetap jalan.', shot: 'badan', ekspresi: 'sedih', gestur: 'pegangHp', sorot: ['tenggelam.', 'Nol.', 'jalan.'], jeda: 0.12,
        beat: [{ pada: 'Ikut', gestur: 'diam', ekspresi: 'sedih' }, { pada: 'Sinyal', gestur: 'angkatTangan', ekspresi: 'netral' }, { pada: 'Nol', ekspresi: 'kaget', gestur: 'diam' }, { pada: 'Cicilan', ekspresi: 'datar' }],
        kartu: [{ tipe: 'tabel', judul: 'INVENTARIS', atas: 268, baris: [
          { label: 'Kapal', nilai: '0', gaya: 'bad' }, { label: 'HP', nilai: '0', gaya: 'bad', pada: 'tenggelam' }, { label: 'Sinyal', nilai: '0', gaya: 'bad', pada: 'Nol' }, { label: 'Cicilan', nilai: 'JALAN', gaya: 'bad', pada: 'jalan' }] }],
        sfx: [{ pada: 'jalan', jenis: 'sad' }] },
      { id: 'teriak', text: 'Aaaaaaaaaaaaaa!', shot: 'teriak', ekspresi: 'panik', gestur: 'duaTanganAtas', jeda: 0.28, suara: { teriak: true },
        stiker: { teks: 'AAAAAA!!', sub: '*panik dulu bentar*' } },
      { id: 'tenang', text: 'Oke. Paniknya udah.', shot: 'sangatDekat', ekspresi: 'datar', gestur: 'diam', sorot: ['udah.'], jeda: 0.45, suara: { k: 1.1 } },
      { id: 'aduh', text: 'Aduh.', ekspresi: 'datar', gestur: 'diam', sorot: ['Aduh.'], jeda: 0.35,
        event: { jenis: 'kelapaJatuh' },
        kartu: [{ tipe: 'bubble', teks: '🥥 +1 kelapa', atas: 420, kiri: 620, warna: '#c9efc8', pada: 'Aduh', mulai: 0.12 }] },
      { id: 'butuh', text: 'Biar selamat, gue butuh tiga hal. Air, api, sama tempat tidur. Sama wifi, kalau boleh.', shot: 'badan', ekspresi: 'senang', gestur: 'hitungJari', sorot: ['tiga', 'Air,', 'api,', 'tidur.', 'wifi,'], jeda: 0.16,
        beat: [{ pada: 'wifi', gestur: 'memohon', ekspresi: 'senang' }],
        kartu: [{ tipe: 'tabel', judul: 'MISI BERTAHAN HIDUP', atas: 268, pada: 'Air', mulai: -0.3, baris: [
          { label: 'Air', nilai: '?', gaya: 'q', ikon: '💧', pada: 'Air' }, { label: 'Api', nilai: '?', gaya: 'q', ikon: '🔥', pada: 'api' },
          { label: 'Tempat tidur', nilai: '?', gaya: 'q', ikon: '🛖', pada: 'tempat' }, { label: 'WiFi', nilai: 'NGAREP', gaya: 'bad', ikon: '📶', pada: 'wifi' }] }] },
      { id: 'aturan', text: 'Aturannya gampang. Lo komen, gue bangun.', shot: 'dekat', ekspresi: 'senang', gestur: 'diam', sorot: ['komen,', 'bangun.'], jeda: 0.14,
        beat: [{ pada: 'Lo', gestur: 'tunjukPenonton' }, { pada: 'gue', gestur: 'tunjukDiri' }],
        kartu: [{ tipe: 'aturan', ikon: '💬', warna: '#ffd23f', kecil: 'LO KOMEN', besar: '= gue <b>BANGUN</b>', atas: 268, pada: 'Lo' }] },
      { id: 'teratas', text: 'Komen paling banyak like, itu yang gue kerjain duluan.', shot: 'dekat', ekspresi: 'netral', gestur: 'angkatTangan', sorot: ['like,', 'duluan.'], jeda: 0.16,
        beat: [{ pada: 'kerjain', ekspresi: 'bangga' }],
        kartu: [{ tipe: 'aturan', ikon: '👑', warna: '#8fd3ff', kecil: 'KOMEN TERATAS', besar: '= dikerjain <b>DULUAN</b>', atas: 414 }] },
      { id: 'follow', text: 'Follow sekarang, biar gue nggak sendirian di pulau ini.', shot: 'badan', ekspresi: 'senang', gestur: 'lambai', sorot: ['Follow', 'sendirian'], jeda: 0.3,
        beat: [{ pada: 'sendirian', ekspresi: 'sedih', gestur: 'diam' }],
        kartu: [{ tipe: 'ktp', judul: 'PENGHUNI NO. 2', kepala: 'PULAU TANPA NAMA · KARTU PENGHUNI', baris: ['Nama: ???', 'Jabatan: tetangga Rere'], kecil: 'Status: nunggu lo follow', atas: 268 },
          { tipe: 'bubble', teks: '💬 bangun apa duluan?', atas: 630, kiri: 520, pada: 'biar' }] },
      { id: 'kepiting', text: 'Eh, kepiting. Woi! Itu kelapa gue!', shot: 'badan', gerak: 'diam', ekspresi: 'netral', gestur: 'diam', sorot: ['kepiting.', 'Woi!', 'kelapa'], jeda: 0.2,
        beat: [{ pada: 'Woi', ekspresi: 'kaget', gestur: 'duaTanganAtas' }, { pada: 'Itu', gestur: 'tunjukSamping', ekspresi: 'marah' }],
        event: { jenis: 'kepitingLewat' },
        kartu: [{ tipe: 'bubble', teks: '🦀 penghuni baru!', atas: 520, kiri: 520, warna: '#ffc9c0', mulai: 0.15 }] },
      { id: 'tutup', text: 'Soalnya pulaunya, luas banget.', shot: 'penutup', ekspresi: 'panik', gestur: 'kejar', sorot: ['luas', 'banget.'], jeda: 1.6,
        event: { jenis: 'papanAngka', angka: 2 } }
    ]
  },
  pulau_day2: {
    versi: 1,
    seri: { judul: 'TERDAMPAR SENDIRIAN', hari: 2, label: 'DAY', dunia: 'pulau', karakter: 'bimo', papan: { judul: 'PENGHUNI', angka: 2 } },
    cover: { judul: 'BANGUN\nRUMAH', sub: 'komen teratas: "rumah pohon"' },
    penutup: { label: 'BESOK', baris: ['komen teratas = dikerjain duluan'], sorot: 'misi: cari air bersih 💧' },
    kalimat: [
      { id: 'buka', text: 'Hari kedua. Masih di pulau yang sama.', shot: 'udara', ekspresi: 'datar', gestur: 'tidur', sorot: ['kedua.'], jeda: 0.14 },
      { id: 'bangun', text: 'Kalian minta rumah pohon. Oke, gue kerjain.', shot: 'badan', gerak: 'dolly', ekspresi: 'senang', gestur: 'tunjukPenonton', sorot: ['rumah', 'pohon.'], jeda: 0.2,
        beat: [{ pada: 'Oke', gestur: 'tanganPinggang', ekspresi: 'bangga' }],
        kartu: [{ tipe: 'aturan', ikon: '🏠', warna: '#ffd23f', kecil: 'KOMEN TERATAS', besar: 'rumah <b>POHON</b>', atas: 268, pada: 'rumah' }] },
      { id: 'alat', text: 'Alatnya? Tangan. Sama semangat.', shot: 'dekat', ekspresi: 'netral', gestur: 'angkatTangan', sorot: ['Tangan.', 'semangat.'], jeda: 0.18,
        beat: [{ pada: 'semangat', ekspresi: 'senang', gestur: 'duaTanganAtas' }],
        kartu: [{ tipe: 'tabel', judul: 'PERALATAN', atas: 268, baris: [{ label: 'Palu', nilai: '0', gaya: 'bad' }, { label: 'Paku', nilai: '0', gaya: 'bad', pada: 'Tangan' }, { label: 'Semangat', nilai: 'PENUH', gaya: 'ok', pada: 'semangat' }] }] },
      { id: 'jatuh', text: 'Aduh.', shot: 'sangatDekat', ekspresi: 'datar', gestur: 'diam', sorot: ['Aduh.'], jeda: 0.4, event: { jenis: 'kelapaJatuh' },
        kartu: [{ tipe: 'bubble', teks: '🥥 +1 kelapa (lagi)', atas: 420, kiri: 560, warna: '#c9efc8', mulai: 0.12 }] },
      { id: 'komen', text: 'Komen paling banyak like, besok gue kerjain duluan.', shot: 'dekat', ekspresi: 'senang', gestur: 'tunjukPenonton', sorot: ['like,', 'duluan.'], jeda: 0.16,
        kartu: [{ tipe: 'aturan', ikon: '👑', warna: '#8fd3ff', kecil: 'KOMEN TERATAS', besar: '= dikerjain <b>DULUAN</b>', atas: 268 }] },
      { id: 'tutup', text: 'Follow dulu, biar rumahnya jadi.', shot: 'penutup', ekspresi: 'senang', gestur: 'lambai', sorot: ['Follow'], jeda: 1.4 }
    ]
  }
};

module.exports = { SHOT, GERAK, EKSPRESI, GESTUR, KARTU, SFX, DUNIA, WAKTU, ADEGAN, BANGUNAN, BAHAYA, BENDA, MAKS_KALIMAT, validateNaskah, CONTOH, tokens, norm };
