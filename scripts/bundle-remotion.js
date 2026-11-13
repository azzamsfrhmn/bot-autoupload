// Bundel template Remotion (folder remotion/) ke remotion-bundle/ sebelum build installer
const path = require('path');
const fs = require('fs');
const { bundle } = require('@remotion/bundler');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'remotion-bundle');

fs.rmSync(outDir, { recursive: true, force: true });
bundle({ entryPoint: path.join(root, 'remotion/index.jsx'), outDir })
  .then(() => console.log('[Remotion] Template dibundel ke', outDir))
  .catch((err) => {
    console.error('[Remotion] Gagal membundel template:', err);
    process.exit(1);
  });
