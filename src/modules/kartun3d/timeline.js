// Perhitungan timeline murni (tanpa canvas) — dipakai Remotion (durasi & posisi audio).
// HARUS sama dengan layout() di src/scenelib.js.
const LEAD = 0.02, DEF_PAD = 0.06; // harus sama dengan src/modules/kartun3d/engine/scenelib.js
function hitungTimeline(spec, timing) {
  let acc = 0;
  const scenes = spec.scenes.map((s, i) => {
    const tm = timing[i];
    const dur = LEAD + tm.end + (s.pad ?? DEF_PAD);
    const out = { start: acc, dur, audioAt: acc + LEAD, trim: tm.trim || 0, files: tm.files || [] };
    acc += dur;
    return out;
  });
  return { total: acc, scenes };
}

module.exports = { LEAD, hitungTimeline };
