// Bangun mesin animasi 3D Kartun dari src/modules/kartun3d/engine/*.js (pengganti tools/build.py modul asli)
//  → remotion/kartun3d/kartun3d.js         (dipakai komposisi Remotion "Kartun3D")
//  → src/renderer/js/vendor/kartun3d.js     (pratinjau adegan di form 3D Kartun)
// Jalankan: node scripts/build-kartun3d.js  (otomatis lewat "npm run bundle:remotion")
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src/modules/kartun3d/engine');
const parts = ['engine.js', 'world.js', 'props2.js', 'street.js', 'models.js', 'captions.js', 'scenelib.js'];
const body = parts.map((p) => fs.readFileSync(path.join(SRC, p), 'utf8')).join('\n');
const head = '// Kartun3D - mesin animasi 3D low-poly Dodo & Bongo (canvas 2D, tanpa dependensi)\n'
  + '// AUTO-GENERATED dari src/modules/kartun3d/engine/ oleh scripts/build-kartun3d.js - edit di sana, lalu build ulang.\n';
const fn = "function createKartun3D(canvas){\n'use strict';\nconst ctx=canvas.getContext('2d');\n" + body
  + '\nreturn{layout,renderFrame,get total(){return TOTAL},W,H};\n}\n';
const out = head + 'export ' + fn + 'export default createKartun3D;\n';
for (const target of ['remotion/kartun3d/kartun3d.js', 'src/renderer/js/vendor/kartun3d.js']) {
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), out);
}
console.log('[Kartun3D] Mesin dibangun ke remotion/kartun3d/ & src/renderer/js/vendor/');
