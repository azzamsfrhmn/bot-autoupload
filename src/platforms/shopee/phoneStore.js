/**
 * Daftar HP Shopee yang pernah dihubungkan: sessions/shopee_hp.json
 *   { phones: { "<serialNo|deviceId>": { serialNo, ip, port, model, method, token?, username?, savedAt } } }
 * method: 'tcpip' (ADB port 5555) | 'wireless' (Debugging nirkabel) | 'tap' (Tap Server via WiFi, tanpa ADB)
 * Dipakai bersama oleh engine ADB & jalur Tap Server (satu sumber data).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HP_CONFIG = () => path.join(process.cwd(), 'sessions', 'shopee_hp.json');

function loadPhones() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(HP_CONFIG(), 'utf8')) || {}; } catch (e) {}
  if (raw.phones) return raw.phones;
  if (raw.serialNo) return { [raw.serialNo]: raw };          // migrasi format lama (1 HP)
  return {};
}
function writePhones(phones) {
  try {
    fs.mkdirSync(path.dirname(HP_CONFIG()), { recursive: true });
    fs.writeFileSync(HP_CONFIG(), JSON.stringify({ phones }, null, 2));
  } catch (e) {}
}
function savePhone(serialNo, patch) {
  if (!serialNo) return;
  const phones = loadPhones();
  phones[serialNo] = { ...(phones[serialNo] || {}), ...patch, serialNo, savedAt: new Date().toISOString() };
  writePhones(phones);
}
function removePhone(serialNo) {
  const phones = loadPhones();
  delete phones[serialNo];
  writePhones(phones);
}
// HP tertentu (by serialNo) atau yang terakhir disimpan
function loadHpConfig(serialNo = '') {
  const phones = loadPhones();
  if (serialNo) return phones[serialNo] || {};
  return Object.values(phones).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))[0] || {};
}

module.exports = { loadPhones, savePhone, removePhone, loadHpConfig, HP_CONFIG };
