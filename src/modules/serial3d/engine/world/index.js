// Daftar dunia (dipilih naskah lewat seri.dunia). Semua memakai bentang alam yang sama dengan TEMA berbeda.
// Waktu (seri.waktu: pagi/siang/sore/malam/hujan) diteruskan lewat opts.waktu.
// Tambah dunia baru = tambah tema di alam.js (+ daftar event di naskah.js DUNIA).
import { buildAlam } from './alam.js';

const tema = (nama) => (scene, opts) => buildAlam(scene, { ...opts, tema: nama });
export const WORLDS = {
  pulau: tema('pulau'),
  zamanBatu: tema('zamanBatu'),
  hutan: tema('hutan'),
  gurun: tema('gurun'),
  salju: tema('salju'),
};
