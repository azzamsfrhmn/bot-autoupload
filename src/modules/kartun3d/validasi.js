// Sumber: update_carakerja (2026-11-07, model rakitan & ruangan) + perbaikan aplikasi: markdown, potongPill, crucible→furnace, close-center.
// Membersihkan & menormalkan JSON naskah dari AI supaya aman dirender.
const POSES = ['idle','wave','laugh','shrug','point','point-up','present','cheer','think','facepalm','surprised','lookup','lookdown','headshake','wipe','handsonhead','shield','yawn','nod'];
const ACTIONS = ['pour','dig','pump','blow','blowpipe','dip'];
const SHOTS = ['wide','medium','close-left','close-right','close-center','low','side-left','side-right','high','street','up','section','road'];
const ENVS = ['beach-day','beach-dusk','street-day','street-dusk','room-day','room-dusk'];
const PROPS = ['campfire','slab','sandpile','furnace','crucible','bellows','bucket','table','pedestal','vase','oven','thermometer','pyramids','bag','palm','rock','bush','shape','item','pole','cables','drop','house','odp','trafo','motorbike','excavator','duct','trench','wire','model'];
const EFFECTS = ['question','sweat','haha','sparkles','glow','bubbles','cracks','dip','temp'];
const ITEMS = ['window','glass','phone','bottle','vase','jar','box','bowl','sandpile','soap','soaps','pot','mold','oil','powder','water','coconut','salt','flame','leaf','gloves','knife','bucket'];
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function fixPos(p) { return Array.isArray(p) && p.length === 3 ? [clampN(num(p[0],0),-3.2,3.4), 0, clampN(num(p[2],0),-2,3.0)] : undefined; }
function fixChar(c) {
  if (!c || typeof c !== 'object') return { pose: 'idle' };
  if (c.hide) return { hide: true };
  const o = { ...c };
  if (!POSES.includes(o.pose)) o.pose = 'idle';
  if (o.action && !ACTIONS.includes(o.action)) delete o.action;
  if (o.pos) o.pos = fixPos(o.pos); if (!o.pos) delete o.pos;
  if (o.ry != null) o.ry = clampN(num(o.ry, 0), -3.2, 3.2);
  return o;
}
function fixSub(s) {
  const o = { ...s };
  if (o.env && !ENVS.includes(o.env)) o.env = 'beach-day';
  if (o.shot && !SHOTS.includes(o.shot)) o.shot = 'wide';
  if (o.zoom != null) o.zoom = clampN(num(o.zoom, 1), .4, 1.8);
  if (o.bongo) o.bongo = fixChar(o.bongo);
  if (o.dodo) o.dodo = fixChar(o.dodo);
  o.props = (Array.isArray(o.props) ? o.props : []).filter(p => p && PROPS.includes(p.type)).map(p => ({ ...p, pos: fixPos(p.pos) || undefined }));
  o.effects = (Array.isArray(o.effects) ? o.effects : []).filter(e => e && EFFECTS.includes(e.type));
  o.props.forEach(p => { if (p.type === 'shape' && p.pos && p.y == null) { const al = o.props.find(q => ['pedestal','table'].includes(q.type) && q.pos && Math.abs(q.pos[0]-p.pos[0]) < .15 && Math.abs(q.pos[2]-p.pos[2]) < .15); if (al) p.y = al.type === 'table' ? .84 : .7; } });
  o.callouts = (Array.isArray(o.callouts) ? o.callouts : []).filter(c => c && typeof c.text === 'string').slice(0, 3).map(c => ({ ...c, text: c.text.slice(0, 26) }));
  o.badges = (Array.isArray(o.badges) ? o.badges : []).filter(b => b && typeof b.text === 'string').slice(0, 2).map(b => ({ ...b, text: b.text.slice(0, 18) }));
  o.pills = (Array.isArray(o.pills) ? o.pills : []).filter(p => p && typeof p.text === 'string').slice(0, 3).map(p => ({ ...p, text: potongPill(p.text) }));
  if (o.type && !['lens','showcase','explain'].includes(o.type)) delete o.type;
  o.props = o.props.map(p => p.type === 'item' && !ITEMS.includes(p.item) ? { ...p, item: 'box' } : p);
  if (o.type === 'explain') { o.items = (o.items || []).slice(0, 3).map(it => ({ ...it, item: typeof it.item === 'string' ? it.item : 'box' })); if (o.result) o.result = { ...o.result, item: typeof o.result.item === 'string' ? o.result.item : 'box' }; }
  if (o.type === 'showcase') { o.items = (o.items || []).slice(0, 3).map(it => ({ ...it, item: typeof it.item === 'string' ? it.item : 'box' })); o.withChars = o.withChars ?? true; }
  perbaikiTata(o);
  return o;
}

// ---------- Perbaikan otomatis tata letak (posisi harus sama dengan SLOT di engine/scenelib.js) ----------
const SLOT = { left: [-1.25, 0, .5], center: [.55, 0, .3], right: [1.85, 0, .65], backleft: [-1.8, 0, -.7], backright: [2.2, 0, -.5], back: [.6, 0, -1.1], front: [.4, 0, 1.1] };
const CHAR_SLOT = { bongo: 'left', dodo: 'right' };
const slotPos = (a) => (Array.isArray(a) ? a : (SLOT[a] || SLOT.center));
const posProp = (p) => (p.pos ? p.pos : slotPos(p.at || 'center'));
const sama = (a, b) => Math.abs(a[0] - b[0]) < 0.15 && Math.abs(a[2] - b[2]) < 0.15;

// Teks pill maks 26 karakter, dipotong di batas kata + "…"
function potongPill(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= 26) return t;
  const cut = t.slice(0, 25);
  const sp = cut.lastIndexOf(' ');
  return (sp >= 8 ? cut.slice(0, sp) : cut).replace(/[\s,.;:-]+$/, '') + '…';
}

function perbaikiTata(o) {
  const props = o.props || [];
  // 1) "shape" di atas pedestal/table (posisi x/z sama) → angkat ke permukaan alas agar tidak tenggelam
  for (const p of props) {
    if (p.type !== 'shape' || p.on) continue;
    const alas = props.find((q) => (q.type === 'pedestal' || q.type === 'table') && sama(posProp(q), posProp(p)));
    if (alas && !(Number(p.y) > 0)) p.y = alas.type === 'pedestal' ? 0.7 : 0.84;
  }
  // 2) "crucible" tanpa "furnace" di posisi yang sama → tambahkan furnace di bawahnya
  for (const c of props.filter((p) => p.type === 'crucible')) {
    const cp = posProp(c);
    if (!props.some((q) => q.type === 'furnace' && sama(posProp(q), cp))) {
      const furnace = { type: 'furnace' };
      if (c.pos) furnace.pos = c.pos.slice(); else furnace.at = c.at || 'center';
      props.splice(props.indexOf(c), 0, furnace);
    }
  }
  // 3) "close-center" butuh properti di tengah & tidak boleh ada karakter (tidak disembunyikan) dekat tengah → medium
  if (o.shot === 'close-center' && !o.type) {
    const cx = SLOT.center[0];
    const adaPropTengah = props.some((p) => { const q = posProp(p); return Math.abs(q[0] - cx) < 0.6 && Math.abs(q[2] - SLOT.center[2]) < 0.8; });
    const karakterDekat = ['bongo', 'dodo'].some((k) => {
      const c = o[k] || {};
      if (c.hide) return false;
      const q = c.pos ? slotPos(c.pos) : slotPos(c.at || CHAR_SLOT[k]);
      return Math.abs(q[0] - cx) < 1.2;
    });
    if (!adaPropTengah || karakterDekat) o.shot = 'medium';
  }
}
function validasiSpec(spec) {
  if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error('Naskah tidak valid: scenes kosong');
  const scenes = spec.scenes.slice(0, 30).map((s, i) => {
    // Tanda markdown (*kata*, _kata_, `kata`) dari AI dibuang agar tidak ikut dibaca suara / tampil di caption
    const say = String(s.say || s.cap || '').replace(/[*_`#]+/g, '').replace(/\.\.\.|…/g, ',').replace(/\s+/g, ' ').trim();
    if (!say) throw new Error('Adegan ' + (i + 1) + ' tidak punya teks');
    let o = fixSub({ ...s, say, cap: String(s.cap || say).replace(/[*_`#]+/g, '').replace(/\.\.\.|…/g, ',').replace(/\s+/g, ' ').trim() });
    o.who = ['B','D','BD','N'].includes(s.who) ? s.who : 'B';
    if (!o.env) o.env = 'beach-day';
    if (Array.isArray(s.parts)) o.parts = s.parts.slice(0, 3).map(fixSub);
    if (o.pad != null) o.pad = clampN(num(o.pad, .18), 0, 3);
    return o;
  });
  const out = { judul: String(spec.judul || 'Bikin dari Nol'), names: spec.names || { B: 'BONGO', D: 'DODO' }, scenes };
  // Model rakitan khusus topik (dirakit AI dari bentuk dasar)
  if (spec.models && typeof spec.models === 'object') {
    out.models = {};
    Object.entries(spec.models).slice(0, 8).forEach(([nama, def]) => {
      if (!def || !Array.isArray(def.parts)) return;
      out.models[nama] = { parts: def.parts.slice(0, 60).filter(p => p && typeof p === 'object').map(p => ({
        shape: ['box','cyl','sphere','cone','disc'].includes(p.shape) ? p.shape : 'box',
        pos: Array.isArray(p.pos) ? p.pos.slice(0, 3).map(v => clampN(num(v, 0), -3, 3)) : [0, 0, 0],
        size: Array.isArray(p.size) ? p.size.slice(0, 3).map(v => clampN(num(v, .2), .005, 4)) : [.2, .2, .2],
        rot: Array.isArray(p.rot) ? p.rot.slice(0, 3).map(v => num(v, 0)) : undefined,
        color: typeof p.color === 'string' ? p.color : '#C9C9C9', glow: !!p.glow, blink: !!p.blink,
        alpha: p.alpha != null ? clampN(num(p.alpha, 1), .2, 1) : undefined, taper: p.taper != null ? clampN(num(p.taper, 1), 0, 2) : undefined,
        text: p.text ? (typeof p.text === 'string' ? p.text.slice(0, 24) : { ...p.text, value: String(p.text.value || '').slice(0, 24) }) : undefined })) };
    });
  }
  // Mode narator (3D Cara Kerja): tanpa header judul karakter
  if (spec.header === false || scenes.every(s => s.who === 'N')) out.header = false;
  return out;
}
function hitungKarakter(spec) { return spec.scenes.reduce((a, s) => a + s.say.length * s.who.length, 0); }

module.exports = { validasiSpec, hitungKarakter };
