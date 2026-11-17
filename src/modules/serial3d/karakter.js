/**
 * Preset karakter contoh untuk konsep Serial Animasi (SA). Semua karakter dibangun dari PARAMETER
 * (warna kulit, model+warna rambut, pakaian, aksesori), bukan dari gambar. Pelanggan nanti bisa
 * membuat karakternya sendiri dengan skema yang sama.
 */
const RAMBUT = ['jabrik', 'bob', 'cepak', 'sanggul', 'panjang', 'kuncir', 'botak'];
const ATASAN = ['tanpa', 'kaos', 'kemeja'];
const BAWAHAN = ['rumput', 'celana', 'rok', 'tanpa'];
// karakter hewan (jenis: 'hewan'): kulit = warna bulu
const TELINGA = ['tanpa', 'bulat', 'runcing', 'panjang'];
const EKOR = ['tanpa', 'pendek', 'panjang', 'lebat'];
const POLA = ['polos', 'totol', 'belang'];
const AKSESORI = ['tanpa', 'kacamata', 'topi', 'bandana', 'kalung'];
// Nama suara bawaan Gemini TTS (gratis): Puck ceria, Fenrir bersemangat, Leda muda, Kore tegas, Aoede lembut, Zephyr cerah
const SUARA_GEMINI = ['Puck', 'Fenrir', 'Leda', 'Kore', 'Aoede', 'Zephyr', 'Charon', 'Orus'];

const KARAKTER = {
  rere: {
    id: 'rere', nama: 'Rere', deskripsi: 'Cewek ceria rambut bob toska, bandana kuning, rok biru.',
    kulit: '#e9b78c', rambut: { model: 'bob', warna: '#2bb5a0' }, atasan: { model: 'kaos', warna: '#ff7a59' },
    bawahan: { model: 'rok', warna: '#3b4a8f' }, aksesori: 'bandana', aksesoriWarna: '#ffd23f', taring: false,
    suara: { nama: 'Leda', gaya: 'cewek muda yang ceria dan ekspresif, logat anak Jakarta, tempo agak cepat', k: 1.1 }
  },
  bimo: {
    id: 'bimo', nama: 'Bimo', deskripsi: 'Cowok kalem rambut cepak hitam, kaos oranye, kacamata.',
    kulit: '#c98a5a', rambut: { model: 'cepak', warna: '#2a211c' }, atasan: { model: 'kaos', warna: '#ff9414' },
    bawahan: { model: 'celana', warna: '#2f6fb5' }, aksesori: 'kacamata', aksesoriWarna: '#1c1b19', taring: false,
    suara: { nama: 'Puck', gaya: 'cowok muda yang santai dan lucu, logat anak Jakarta, natural', k: 1.06 }
  },
  kiko: {
    id: 'kiko', nama: 'Kiko', deskripsi: 'Bocah liar rambut sanggul ungu, kemeja hijau, topi merah, bertaring.',
    kulit: '#dc9650', rambut: { model: 'sanggul', warna: '#8a4fd1' }, atasan: { model: 'kemeja', warna: '#4cab2f' },
    bawahan: { model: 'rumput', warna: '#4cab2f' }, aksesori: 'topi', aksesoriWarna: '#d9483b', taring: true,
    suara: { nama: 'Fenrir', gaya: 'bocah liar yang cempreng, enerjik, dan sok jagoan, logat anak Jakarta', k: 1.17 }
  }
};

/** Normalisasi parameter karakter (preset id, atau objek kustom). Mengembalikan objek lengkap dengan nilai bawaan. */
function resolveKarakter(input) {
  const base = typeof input === 'string' ? KARAKTER[input] : (input && typeof input === 'object' ? input : null);
  if (!base) throw new Error(`Karakter "${typeof input === 'string' ? input : '?'}" tidak dikenal (tersedia: ${Object.keys(KARAKTER).join(', ')})`);
  const k = JSON.parse(JSON.stringify(base));
  k.id = k.id || 'kustom'; k.nama = k.nama || 'Karakter';
  k.kulit = k.kulit || '#dc9650';
  k.rambut = Object.assign({ model: 'cepak', warna: '#2a211c' }, k.rambut || {});
  k.atasan = Object.assign({ model: 'kaos', warna: '#ff7a59' }, k.atasan || {});
  k.bawahan = Object.assign({ model: 'celana', warna: '#2f6fb5' }, k.bawahan || {});
  k.aksesori = k.aksesori || 'tanpa'; k.aksesoriWarna = k.aksesoriWarna || '#1c1b19'; k.taring = !!k.taring;
  k.suara = Object.assign({ nama: 'Puck', gaya: 'anak muda yang ceria, logat Jakarta', k: 1.1 }, k.suara || {});
  k.jenis = k.jenis === 'hewan' ? 'hewan' : 'manusia';
  k.badan = ['gemuk', 'kurus'].includes(k.badan) ? k.badan : 'normal';
  const bad = [];
  if (k.jenis === 'hewan') {
    k.hewan = Object.assign({ telinga: 'bulat', ekor: 'pendek', pola: 'polos', warnaPola: '#1c1b19', moncong: true }, k.hewan || {});
    if (!TELINGA.includes(k.hewan.telinga)) bad.push(`hewan.telinga "${k.hewan.telinga}"`);
    if (!EKOR.includes(k.hewan.ekor)) bad.push(`hewan.ekor "${k.hewan.ekor}"`);
    if (!POLA.includes(k.hewan.pola)) bad.push(`hewan.pola "${k.hewan.pola}"`);
  }
  if (!RAMBUT.includes(k.rambut.model)) bad.push(`rambut.model "${k.rambut.model}"`);
  if (!ATASAN.includes(k.atasan.model)) bad.push(`atasan.model "${k.atasan.model}"`);
  if (!BAWAHAN.includes(k.bawahan.model)) bad.push(`bawahan.model "${k.bawahan.model}"`);
  if (!AKSESORI.includes(k.aksesori)) bad.push(`aksesori "${k.aksesori}"`);
  if (!SUARA_GEMINI.includes(k.suara.nama)) bad.push(`suara.nama "${k.suara.nama}"`);
  if (bad.length) throw new Error('Parameter karakter tidak valid: ' + bad.join(', '));
  return k;
}

module.exports = { KARAKTER, RAMBUT, ATASAN, BAWAHAN, AKSESORI, TELINGA, EKOR, POLA, SUARA_GEMINI, resolveKarakter };
