/**
 * Simpanan per pelanggan untuk Serial Animasi:
 *   storage/serial3d/karakter/<id>/ref.<ext>      gambar referensi upload
 *                                  karakter.json  parameter hasil analisis AI (bisa diedit)
 *                                  potret.jpg     render 3D karakter
 *                                  seri.json      { premis, judul, episodes:[{hari, judul, ringkas, janji, video, waktu}] }
 */
const fs = require('fs');
const path = require('path');
const { KARAKTER, resolveKarakter } = require('./karakter');

const ROOT = () => path.resolve(process.cwd(), 'storage/serial3d/karakter');
const dirOf = (id) => path.join(ROOT(), String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
const baca = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

function daftarKarakter() {
  const out = [];
  try {
    for (const id of fs.readdirSync(ROOT())) {
      const k = baca(path.join(dirOf(id), 'karakter.json'), null); if (!k) continue;
      const ref = fs.readdirSync(dirOf(id)).find((f) => /^ref\./i.test(f));
      const potret = path.join(dirOf(id), 'potret.jpg');
      const seri = bacaSeri(id);
      out.push({ ...k, id, milik: true, ref: ref ? path.join(dirOf(id), ref) : '', potret: fs.existsSync(potret) ? potret : '', premis: seri.premis || '', judulSeri: seri.judul || '', hariBerikut: hariBerikut(id), dibuat: k.dibuat || 0 });
    }
  } catch (e) {}
  return out.sort((a, b) => (b.dibuat || 0) - (a.dibuat || 0));
}

function simpanKarakter(k, imagePath) {
  const id = k.id || `k${Date.now()}`;
  const dir = dirOf(id); fs.mkdirSync(dir, { recursive: true });
  if (imagePath) {
    fs.readdirSync(dir).filter((f) => /^ref\./i.test(f)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    fs.copyFileSync(imagePath, path.join(dir, `ref${path.extname(imagePath).toLowerCase() || '.png'}`));
  }
  const data = { ...k, id, dibuat: k.dibuat || Date.now() };
  delete data.milik; delete data.ref; delete data.potret; delete data.premis; delete data.judulSeri; delete data.hariBerikut;
  resolveKarakter(data); // validasi parameter
  fs.writeFileSync(path.join(dir, 'karakter.json'), JSON.stringify(data, null, 2));
  return { ...data, dir };
}

function hapusKarakter(id) { fs.rmSync(dirOf(id), { recursive: true, force: true }); }

/** karakter milik pelanggan (id) atau preset contoh */
function muatKarakter(idOrObj) {
  if (idOrObj && typeof idOrObj === 'object') return resolveKarakter(idOrObj);
  const id = String(idOrObj || '');
  const own = baca(path.join(dirOf(id), 'karakter.json'), null);
  if (own) return resolveKarakter({ ...own, id });
  if (KARAKTER[id]) return resolveKarakter(id);
  throw new Error('Karakter belum dipilih. Upload gambar karakter dulu (langkah 1).');
}

function bacaSeri(id) { return baca(path.join(dirOf(id), 'seri.json'), { premis: '', judul: '', episodes: [] }); }
function simpanSeri(id, patch) {
  if (!fs.existsSync(dirOf(id))) return null;
  const s = { ...bacaSeri(id), ...patch };
  fs.writeFileSync(path.join(dirOf(id), 'seri.json'), JSON.stringify(s, null, 2));
  return s;
}
function hariBerikut(id) { const e = bacaSeri(id).episodes || []; return e.length ? Math.max(...e.map((x) => x.hari || 0)) + 1 : 1; }
function catatEpisode(id, naskah, video) {
  if (!fs.existsSync(dirOf(id))) return;
  const s = bacaSeri(id);
  const ringkas = naskah.kalimat.filter((k) => k.shot !== 'teriak').map((k) => k.text).join(' ').slice(0, 400);
  const janji = [...(naskah.penutup?.baris || []), naskah.penutup?.sorot].filter(Boolean).join('; ');
  const eps = (s.episodes || []).filter((e) => e.hari !== naskah.seri.hari);
  eps.push({ hari: naskah.seri.hari, judul: naskah.cover?.judul || '', ringkas, janji, latar: naskah.seri.dunia, suasana: naskah.seri.waktu, video: video || '', waktu: Date.now() });
  eps.sort((a, b) => a.hari - b.hari);
  simpanSeri(id, { judul: s.judul || naskah.seri.judul, episodes: eps });
}

module.exports = { daftarKarakter, simpanKarakter, hapusKarakter, muatKarakter, bacaSeri, simpanSeri, hariBerikut, catatEpisode, dirOf };
