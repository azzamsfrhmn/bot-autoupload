/**
 * src/core/kartunKeys.js
 * API key milik pelanggan untuk konsep 3D Kartun: Claude (naskah, opsional) & ElevenLabs (suara, wajib).
 * Disimpan terenkripsi (Electron safeStorage / DPAPI Windows) di sessions/kartun3d_keys.json.
 */
const fs = require('fs');
const path = require('path');

let keysFile = path.resolve(process.cwd(), 'sessions', 'kartun3d_keys.json');

function initKartunKeys(sessionsDir) {
  if (sessionsDir) keysFile = path.join(sessionsDir, 'kartun3d_keys.json');
}

function getSafeStorage() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch (e) {
    return null;
  }
}

function encode(value) {
  if (!value) return '';
  const ss = getSafeStorage();
  return ss ? 'enc:' + ss.encryptString(value).toString('base64') : 'raw:' + Buffer.from(value).toString('base64');
}

function decode(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) {
      const ss = getSafeStorage();
      return ss ? ss.decryptString(Buffer.from(stored.slice(4), 'base64')) : '';
    }
    if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch (e) {}
  return '';
}

function readRaw() {
  try { return JSON.parse(fs.readFileSync(keysFile, 'utf-8')) || {}; } catch (e) { return {}; }
}

function getKartunKeys() {
  const raw = readRaw();
  return { anthropicKey: decode(raw.anthropicKey), elevenlabsKey: decode(raw.elevenlabsKey), geminiKey: decode(raw.geminiKey) };
}

// patch: { anthropicKey?, elevenlabsKey? } — string kosong = hapus key itu; undefined = tidak diubah
function saveKartunKeys(patch = {}) {
  const raw = readRaw();
  for (const k of ['anthropicKey', 'elevenlabsKey', 'geminiKey']) {
    if (typeof patch[k] === 'string') raw[k] = encode(patch[k].trim());
  }
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, JSON.stringify(raw, null, 2), 'utf-8');
  return describeKartunKeys();
}

const mask = (k) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '');

function describeKartunKeys() {
  const { anthropicKey, elevenlabsKey } = getKartunKeys();
  const { geminiKey } = getKartunKeys();
  return { hasAnthropic: Boolean(anthropicKey), hasElevenlabs: Boolean(elevenlabsKey), anthropicMasked: mask(anthropicKey), elevenlabsMasked: mask(elevenlabsKey), hasGemini: Boolean(geminiKey), geminiMasked: mask(geminiKey) };
}

module.exports = { initKartunKeys, getKartunKeys, saveKartunKeys, describeKartunKeys };
