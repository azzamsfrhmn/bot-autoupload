/**
 * src/core/flowWorkerPool.js
 * Peminjaman akun Google Flow untuk banyak worker sekaligus.
 * Akun dipilih ACAK tiap render (rotasi) agar satu akun tidak dipakai beruntun — Flow menandai pembuatan video
 * yang terlalu sering dari satu akun sebagai spam. Worker berbeda diusahakan memakai akun berbeda; bila akun
 * yang layak lebih sedikit dari worker, akun dipakai bersama dan worker lain membuka salinan profilnya
 * (lihat src/core/profileClone.js).
 */
const { AsyncLocalStorage } = require('async_hooks');

const leaseContext = new AsyncLocalStorage();
// accountId → jumlah worker yang sedang memakai akun itu
const busyCounts = new Map();

class AllAccountsBusyError extends Error {
  constructor() {
    super('Semua akun Google Flow sedang dipakai worker lain.');
    this.code = 'ALL_FLOW_ACCOUNTS_BUSY';
  }
}

/** Jalankan satu render Flow dengan konteks peminjaman sendiri; akun dilepas otomatis di akhir. */
function runWithFlowLease(fn) {
  return leaseContext.run({ accountId: null }, async () => {
    try {
      return await fn();
    } finally {
      releaseFlowLease();
    }
  });
}

/**
 * Pilih akun acak dari akun yang kreditnya cukup. Prioritas: akun bebas selain akun terakhir dipakai →
 * akun bebas mana saja → akun yang sedang dipakai worker lain (dipakai bersama). null bila tidak ada yang layak.
 */
function pickRandomFlowAccount(accounts, hasCredit, busyIds, lastUsedId) {
  const eligible = (accounts || []).filter(hasCredit);
  if (!eligible.length) return null;
  const free = eligible.filter((a) => !busyIds.has(a.id));
  const fresh = free.filter((a) => a.id !== lastUsedId);
  const pool = fresh.length ? fresh : free.length ? free : eligible;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * pickAccount(busyIds) → { targetAcc, cfg }. busyIds = akun yang sedang dipakai worker lain.
 * Kesalahan (kredit habis, belum login) diteruskan apa adanya.
 */
async function leaseFlowAccount(pickAccount) {
  const resolved = pickAccount(new Set(busyCounts.keys()));
  const id = resolved.targetAcc.id;
  busyCounts.set(id, (busyCounts.get(id) || 0) + 1);
  const store = leaseContext.getStore();
  if (store) store.accountId = id;
  return resolved;
}

/** true bila akun ini juga sedang dipakai worker lain (profil aslinya sudah dibuka Chrome lain). */
function isFlowAccountShared(accountId) {
  return (busyCounts.get(accountId) || 0) > 1;
}

function releaseFlowLease() {
  const store = leaseContext.getStore();
  if (!store || !store.accountId) return;
  const left = (busyCounts.get(store.accountId) || 1) - 1;
  if (left > 0) busyCounts.set(store.accountId, left);
  else busyCounts.delete(store.accountId);
  store.accountId = null;
}

// Akun yang ditandai Flow (aktivitas tidak biasa / limit / spam) diistirahatkan selama ini sebelum dipilih lagi
const FLOW_BLOCK_MS = 3 * 60 * 60 * 1000;

/**
 * Kegagalan render yang disebabkan AKUN (bukan prompt/jaringan): 'credits' = kredit habis/kurang,
 * 'blocked' = ditandai Flow (aktivitas tidak biasa, terlalu sering, limit). null = bukan masalah akun.
 */
function classifyFlowAccountFailure(message) {
  // Spasi khusus (nbsp) dari teks Flow disamakan dulu agar pola di bawah tetap cocok
  const msg = String(message || '').replace(/\s+/g, ' ').toLowerCase();
  // Kartu video tetap gagal setelah 5x "Coba lagi" → ganti akun (akun tidak ditandai / diistirahatkan)
  if (msg.includes('[ganti akun]')) return 'render';
  if (/aktivitas (yang )?tidak biasa|unusual activity|too many|terlalu (banyak|sering)|rate.?limit|daily limit|batas harian|limit harian|quota|kuota|spam/.test(msg)) return 'blocked';
  if (/kredit|credit/.test(msg)) return 'credits';
  return null;
}

/** Google Flow menolak dengan PUBLIC_ERROR_UNUSUAL_ACTIVITY (aktivitas tidak biasa)? → jangan coba ulang otomatis */
function isUnusualActivityError(message) {
  return /unusual.?activity|aktivitas (yang )?tidak biasa|terindikasi pembatasan aktivitas/i.test(String(message || '').replace(/\s+/g, ' '));
}

function flowUnusualActivityMessage(accountName, { rested = true } = {}) {
  return `Google Flow menolak permintaan${accountName ? ` di ${accountName}` : ''}: terdeteksi aktivitas tidak biasa (PUBLIC_ERROR_UNUSUAL_ACTIVITY). `
    + 'Ini bukan karena kredit habis. Cek saldo kredit di Flow bila perlu (belum diverifikasi aplikasi). '
    + 'Proses dihentikan tanpa coba ulang otomatis'
    + (rested ? `. Sesuai kebijakan aplikasi ini (bukan aturan Google), akun tidak dipakai selama ${FLOW_BLOCK_MS / 3600000} jam` : '')
    + '. Coba lagi nanti secara manual.';
}

/** Pesan bila tidak ada akun terpilih karena akun yang masih punya kredit sedang diistirahatkan (ditandai Flow). null bila tidak ada. */
function describeRestingFlowAccounts(accounts = []) {
  const resting = accounts.filter((a) => a && a.status === 'Sesi Aktif' && !isFlowAccountRested(a));
  if (!resting.length) return null;
  const list = resting.map((a) => {
    const until = new Date(Number(a.blockedUntil));
    return `${a.name} (sampai ${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')})`;
  }).join(', ');
  return `Tidak ada akun Google Flow yang siap: ${list} sedang diistirahatkan karena sebelumnya ditandai Google Flow (mis. aktivitas tidak biasa / batas pemakaian). `
    + `Jeda ${FLOW_BLOCK_MS / 3600000} jam ini kebijakan aplikasi, bukan aturan Google. Ini bukan kredit habis. `
    + 'Coba lagi setelah jam tersebut atau tambahkan akun Flow lain.';
}

/** Akun boleh dipilih lagi? (tidak sedang diistirahatkan karena ditandai Flow) */
function isFlowAccountRested(acc) {
  return !(Number(acc?.blockedUntil) > Date.now());
}

module.exports = {
  runWithFlowLease,
  leaseFlowAccount,
  releaseFlowLease,
  pickRandomFlowAccount,
  isFlowAccountShared,
  classifyFlowAccountFailure,
  isFlowAccountRested,
  isUnusualActivityError,
  flowUnusualActivityMessage,
  describeRestingFlowAccounts,
  FLOW_BLOCK_MS,
  AllAccountsBusyError
};
