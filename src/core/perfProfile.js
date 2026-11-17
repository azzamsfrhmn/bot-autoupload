/**
 * src/core/perfProfile.js
 * Profil performa perangkat: di perangkat spek rendah (RAM < 8 GB atau CPU ≤ 4 core) semua jeda & batas tunggu
 * bot diperpanjang, Chrome dijalankan lebih ringan, dan upload terjadwal tidak berjalan bersamaan dengan render.
 * Mode bisa dipaksa dari Pengaturan AI: 'auto' (default) | 'normal' | 'ringan'. Disimpan di sessions/performance.json.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const LITE_TIME_FACTOR = 2;
const MODES = ['auto', 'normal', 'ringan'];

let configPath = path.resolve(process.cwd(), 'sessions/performance.json');
let cached = null;
const activeTasks = new Set();

// Dipanggil main.js agar file konfigurasi mengikuti folder data aplikasi (dev / terpasang)
function initPerfProfile(sessionsDir) {
  if (sessionsDir) configPath = path.join(sessionsDir, 'performance.json');
  cached = null;
  return getPerfProfile();
}

function readMode() {
  try {
    const mode = JSON.parse(fs.readFileSync(configPath, 'utf-8')).mode;
    return MODES.includes(mode) ? mode : 'auto';
  } catch (e) {
    return 'auto';
  }
}

function getPerfProfile() {
  if (cached) return cached;
  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const cores = os.cpus().length;
  // Windows melaporkan RAM 8 GB sebagai ±7,8 GB
  const lowSpec = ramGb < 7.5 || cores <= 4;
  const mode = readMode();
  const lite = mode === 'ringan' || (mode === 'auto' && lowSpec);
  cached = { mode, lite, lowSpec, ramGb, cores, factor: lite ? LITE_TIME_FACTOR : 1 };
  return cached;
}

function setPerfMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Mode performa tidak dikenal: ${mode}`);
  fs.writeFileSync(configPath, JSON.stringify({ mode }, null, 2), 'utf-8');
  cached = null;
  return getPerfProfile();
}

// Jeda & batas tunggu bot disesuaikan kecepatan perangkat
function scaleMs(ms) {
  return Math.round(Number(ms || 0) * getPerfProfile().factor);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

// Flag Chrome tambahan untuk perangkat ringan (tanpa --disable-features agar tidak menimpa flag runner)
function chromeLiteArgs() {
  if (!getPerfProfile().lite) return [];
  return [
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--no-pings',
    '--disk-cache-size=104857600'
  ];
}

function describePerfProfile() {
  const p = getPerfProfile();
  const spec = `RAM ${p.ramGb} GB · ${p.cores} core`;
  if (!p.lite) return `Mode perangkat: Normal (${spec})`;
  return `Mode Perangkat Ringan aktif (${spec}${p.mode === 'ringan' ? ' · dipaksa dari Pengaturan' : ''}) — jeda & batas tunggu bot diperpanjang ${p.factor}x`;
}

// Penanda tugas berat (render video) agar upload terjadwal menunggu di perangkat ringan
function setTaskActive(name, active) {
  if (active) activeTasks.add(name);
  else activeTasks.delete(name);
}

function isTaskActive(name) {
  return activeTasks.has(name);
}

module.exports = {
  initPerfProfile,
  getPerfProfile,
  setPerfMode,
  scaleMs,
  sleep,
  chromeLiteArgs,
  describePerfProfile,
  setTaskActive,
  isTaskActive
};
