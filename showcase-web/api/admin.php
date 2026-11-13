<?php
/**
 * Etnic Showcase — admin lisensi (tampilan sama dengan Admin Console Bot Auto Upload)
 * Letak: /www/wwwroot/license.etnicstore.com/showcase/admin.php
 * Login admin portal (/login), daftar email admin di portal_common.php
 */
session_start();
date_default_timezone_set('Asia/Jakarta');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../portal_common.php';

if (!isset($_SESSION['user_id'])) { header('Location: /login'); exit; }
if (!portal_is_admin()) { http_response_code(403); echo 'Khusus admin.'; exit; }

if (empty($_SESSION['sc_csrf'])) $_SESSION['sc_csrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['sc_csrf'];

function sc_key() {
    $c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $part = function () use ($c) { $s = ''; for ($i = 0; $i < 4; $i++) $s .= $c[random_int(0, strlen($c) - 1)]; return $s; };
    return 'ESHW-' . $part() . '-' . $part() . '-' . $part();
}

// ---------------------------------------------------------------- data live (JSON)
if (($_GET['ajax'] ?? '') === 'live_data') {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    $rows = $pdo->query('SELECT *, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seconds_ago FROM showcase_licenses ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    $online = 0; $used = 0; $revoked = 0;
    foreach ($rows as $r) {
        $isOnline = $r['status'] === 'active' && $r['seconds_ago'] !== null && (int)$r['seconds_ago'] >= 0 && (int)$r['seconds_ago'] <= 90;
        if ($isOnline) $online++;
        if ($r['install_id']) $used++;
        if ($r['status'] !== 'active') $revoked++;
        $out[] = [
            'id' => (int)$r['id'],
            'license_key' => $r['license_key'],
            'buyer' => $r['buyer'] ?: '-',
            'status' => $r['status'],
            'used' => (bool)$r['install_id'],
            'is_online' => $isOnline,
            'last_seen' => $r['last_seen'] ? date('H:i, j M', strtotime($r['last_seen'])) : 'Belum pernah',
            'activated_at' => $r['activated_at'] ? date('j M Y', strtotime($r['activated_at'])) : '-',
            'device_name' => $r['device_name'] ?? '',
            'ip_address' => $r['ip_address'] ?? '',
            'ext_version' => $r['ext_version'] ?? '',
            'tiktok_account' => $r['tiktok_account'] ?? '',
            'install_id' => $r['install_id'] ? substr($r['install_id'], 0, 8) : ''
        ];
    }
    echo json_encode(['total' => count($rows), 'online' => $online, 'used' => $used, 'revoked' => $revoked, 'licenses' => $out]);
    exit;
}

// ---------------------------------------------------------------- aksi
$flash = $_SESSION['sc_flash'] ?? '';
$newKeys = $_SESSION['sc_new_keys'] ?? [];
unset($_SESSION['sc_flash'], $_SESSION['sc_new_keys']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, $_POST['csrf'] ?? '')) { http_response_code(400); exit('CSRF tidak valid.'); }
    $act = $_POST['act'] ?? '';
    $id = (int)($_POST['id'] ?? 0);
    if ($act === 'create') {
        $qty = max(1, min(50, (int)($_POST['qty'] ?? 1)));
        $buyer = trim(mb_substr($_POST['buyer'] ?? '', 0, 120));
        $ins = $pdo->prepare('INSERT INTO showcase_licenses (license_key, buyer, price) VALUES (?, ?, 300000)');
        $keys = [];
        for ($i = 0; $i < $qty; $i++) {
            for ($try = 0; $try < 5; $try++) {
                $k = sc_key();
                try { $ins->execute([$k, $buyer ?: null]); $keys[] = $k; break; } catch (PDOException $e) {}
            }
        }
        $_SESSION['sc_new_keys'] = $keys;
        $_SESSION['sc_flash'] = count($keys) . ' kode lisensi showcase diterbitkan' . ($buyer ? " untuk '{$buyer}'" : '') . '.';
    } elseif ($act === 'toggle') {
        $pdo->prepare("UPDATE showcase_licenses SET status = IF(status = 'active', 'revoked', 'active') WHERE id = ?")->execute([$id]);
        $_SESSION['sc_flash'] = 'Status lisensi diperbarui.';
    } elseif ($act === 'reset') {
        $pdo->prepare('UPDATE showcase_licenses SET install_id = NULL, activated_at = NULL, device_name = NULL, ip_address = NULL, last_seen = NULL WHERE id = ?')->execute([$id]);
        $_SESSION['sc_flash'] = 'Perangkat dilepas — lisensi bisa diaktifkan di browser lain.';
    } elseif ($act === 'delete') {
        $pdo->prepare('DELETE FROM showcase_licenses WHERE id = ?')->execute([$id]);
        $_SESSION['sc_flash'] = 'Lisensi dihapus permanen.';
    }
    header('Location: /showcase/admin.php');
    exit;
}

$user_pic = $_SESSION['user_pic'] ?? '';
$h = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES);
?><!DOCTYPE html>
<html lang="id">
<head>
<?php portal_head('Admin Console — Etnic Showcase'); ?>
</head>
<body class="bg-ink-900 text-slate-100 font-sans min-h-screen">

  <!-- NAVBAR (sama dengan Admin Console) -->
  <header class="sticky top-0 z-30 bg-ink-950/95 border-b border-white/5">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-2.5">
        <img src="/assets/icon-192.png" alt="Logo Etnic" class="w-8 h-8">
        <span class="font-semibold tracking-tight hidden sm:inline">Bot Auto Upload</span>
        <span class="text-xs font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-md">Admin</span>
      </a>
      <div class="flex items-center gap-2 sm:gap-3">
        <a href="/" class="text-sm muted hover:text-white px-2 py-2 hidden md:inline-flex">Beranda</a>
        <a href="/dashboard?view=user" class="text-sm muted hover:text-white px-2 py-2">Panel Pengguna</a>
        <?php if (!empty($user_pic)): ?><img src="<?= $h($user_pic) ?>" referrerpolicy="no-referrer" class="w-9 h-9 rounded-full border border-white/10 hidden sm:block"><?php endif; ?>
        <a href="/logout" class="text-xs border border-white/10 hover:border-rose-400/50 hover:text-rose-300 px-3 py-2 rounded-lg transition">Keluar</a>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Admin Console</h1>
      <p class="text-sm muted mt-1">Lisensi Etnic Showcase — web showcase produk, sekali bayar Rp300.000 (1 lisensi = 1 browser, tanpa garansi).</p>
    </div>

    <!-- TAB PRODUK -->
    <nav class="flex gap-2 border-b border-white/5">
      <a href="/admin" class="px-4 py-2.5 text-sm font-semibold muted hover:text-white border-b-2 border-transparent">Lisensi Aplikasi</a>
      <a href="/showcase/admin.php" class="px-4 py-2.5 text-sm font-semibold text-teal-300 border-b-2 border-teal-400">Lisensi Showcase</a>
    </nav>

    <?php if ($flash): ?>
      <div class="card p-4 flex items-center justify-between gap-3 border-teal-500/30">
        <span class="text-sm text-teal-200"><?= $h($flash) ?></span>
        <button onclick="this.parentElement.remove()" class="text-teal-300 text-lg leading-none">&times;</button>
      </div>
    <?php endif; ?>
    <?php if ($newKeys): ?>
      <div class="card p-5 border-teal-500/30">
        <div class="text-sm muted mb-2">Kode baru — salin & kirim ke pembeli:</div>
        <textarea readonly onclick="this.select()" class="w-full bg-ink-950 border border-white/10 rounded-lg p-3 font-mono text-sm text-teal-300" rows="<?= min(10, count($newKeys)) ?>"><?= $h(implode("\n", $newKeys)) ?></textarea>
      </div>
    <?php endif; ?>

    <!-- RINGKASAN -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="card p-5"><div class="text-xs dim">Total lisensi</div><div class="mt-2 text-3xl font-bold" id="st-total">-</div><div class="mt-1 text-xs muted">Showcase</div></div>
      <div class="card p-5"><div class="text-xs dim">Pengguna online sekarang</div><div class="mt-2 text-3xl font-bold text-teal-400" id="st-online">-</div><div class="mt-1 text-xs muted">Heartbeat 90 detik terakhir</div></div>
      <div class="card p-5"><div class="text-xs dim">Sudah dipakai</div><div class="mt-2 text-3xl font-bold" id="st-used">-</div><div class="mt-1 text-xs muted">Terikat ke 1 browser</div></div>
      <div class="card p-5"><div class="text-xs dim">Ditangguhkan</div><div class="mt-2 text-3xl font-bold text-rose-300" id="st-revoked">-</div><div class="mt-1 text-xs muted">Tidak bisa dipakai</div></div>
    </section>

    <!-- TERBITKAN -->
    <section class="card p-5 sm:p-6">
      <h2 class="font-semibold">Terbitkan lisensi showcase</h2>
      <p class="text-sm muted mt-1">Kode format <span class="font-mono text-teal-300">ESHW-XXXX-XXXX-XXXX</span>, berlaku selamanya. Pembeli memasang ekstensi Kalodata Exporter v2 lalu memasukkan kode di <a href="/showcase/" target="_blank" class="text-teal-300 hover:underline">license.etnicstore.com/showcase</a>.</p>
      <form method="POST" class="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input type="hidden" name="csrf" value="<?= $h($csrf) ?>"><input type="hidden" name="act" value="create">
        <div class="md:col-span-2">
          <label class="text-xs dim">Nama / catatan pembeli</label>
          <input name="buyer" maxlength="120" placeholder="Contoh: Budi - WA 0812..." class="mt-1 w-full bg-ink-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500">
        </div>
        <div>
          <label class="text-xs dim">Jumlah kode</label>
          <input name="qty" type="number" min="1" max="50" value="1" class="mt-1 w-full bg-ink-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500">
        </div>
        <div class="flex items-end">
          <button type="submit" class="w-full bg-teal-500 hover:bg-teal-600 text-ink-950 font-semibold py-2.5 rounded-xl text-sm transition">Terbitkan lisensi</button>
        </div>
      </form>
    </section>

    <!-- TABEL -->
    <section class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2"><h2 class="font-semibold">Semua pengguna showcase</h2><span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span></div>
        <input id="search" type="search" placeholder="Cari kode, pembeli, akun TikTok, IP..." class="w-full sm:w-72 bg-ink-950 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500">
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="text-xs dim uppercase tracking-wider">
            <tr class="border-b border-white/5">
              <th class="px-5 py-3 font-medium">Kode lisensi</th>
              <th class="px-5 py-3 font-medium">Pembeli</th>
              <th class="px-5 py-3 font-medium">Aktivitas</th>
              <th class="px-5 py-3 font-medium">Perangkat</th>
              <th class="px-5 py-3 font-medium">Masa berlaku</th>
              <th class="px-5 py-3 font-medium">Status</th>
              <th class="px-5 py-3 font-medium text-right">Tindakan</th>
            </tr>
          </thead>
          <tbody id="tbody" class="divide-y divide-white/5">
            <tr><td colspan="7" class="px-5 py-8 text-center dim">Menyinkronkan data...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <form id="actForm" method="POST" hidden>
    <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
    <input type="hidden" name="act"><input type="hidden" name="id">
  </form>

  <script>
    let data = null;
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function act(name, id, msg) {
      if (msg && !confirm(msg)) return;
      const f = document.getElementById('actForm');
      f.act.value = name; f.id.value = id; f.submit();
    }

    function render() {
      if (!data) return;
      const q = document.getElementById('search').value.trim().toLowerCase();
      const rows = data.licenses.filter((r) => !q || [r.license_key, r.buyer, r.tiktok_account, r.ip_address, r.device_name].join(' ').toLowerCase().includes(q));
      const tb = document.getElementById('tbody');
      if (!rows.length) { tb.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center dim">${q ? 'Tidak ada yang cocok.' : 'Belum ada lisensi showcase.'}</td></tr>`; return; }
      tb.innerHTML = rows.map((r) => {
        const activity = r.is_online
          ? '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300"><span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>Online</span>'
          : `<span class="inline-flex items-center gap-1.5 text-xs dim"><span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span>${esc(r.last_seen)}</span>`;
        const device = r.used
          ? `<div class="text-sm">${esc(r.device_name || 'Browser')}</div>
             <div class="text-xs dim font-mono">${esc(r.ip_address || '-')}${r.ext_version ? ' · ext v' + esc(r.ext_version) : ''}</div>
             ${r.tiktok_account ? `<div class="text-xs text-teal-300/80">TikTok @${esc(r.tiktok_account)}</div>` : ''}`
          : '<span class="text-xs text-amber-300">Belum dipakai</span>';
        const status = r.status === 'active'
          ? '<span class="px-2 py-0.5 rounded-md text-xs font-medium bg-teal-500/10 text-teal-300 border border-teal-500/20">Aktif</span>'
          : '<span class="px-2 py-0.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20">Ditangguhkan</span>';
        return `
          <tr class="hover:bg-white/[0.02]">
            <td class="px-5 py-4 font-mono text-teal-300 select-all whitespace-nowrap">${esc(r.license_key)}</td>
            <td class="px-5 py-4"><div class="font-medium">${esc(r.buyer)}</div><div class="text-xs dim">Aktivasi: ${esc(r.activated_at)}</div></td>
            <td class="px-5 py-4 whitespace-nowrap">${activity}</td>
            <td class="px-5 py-4">${device}</td>
            <td class="px-5 py-4 text-xs muted whitespace-nowrap">Lifetime</td>
            <td class="px-5 py-4">${status}</td>
            <td class="px-5 py-4 text-right whitespace-nowrap text-xs font-medium space-x-3">
              <a href="#" onclick="act('toggle', ${r.id}); return false;" class="text-teal-300 hover:text-teal-200">${r.status === 'active' ? 'Tangguhkan' : 'Aktifkan'}</a>
              ${r.used ? `<a href="#" onclick="act('reset', ${r.id}, 'Lepas perangkat lisensi ini? Pembeli bisa aktivasi ulang di browser lain.'); return false;" class="text-amber-300 hover:text-amber-200">Reset perangkat</a>` : ''}
              <a href="#" onclick="act('delete', ${r.id}, 'Hapus permanen lisensi ${esc(r.license_key)}?'); return false;" class="text-rose-300 hover:text-rose-200">Hapus</a>
            </td>
          </tr>`;
      }).join('');
    }

    async function refresh() {
      try {
        const res = await fetch('/showcase/admin.php?ajax=live_data', { cache: 'no-store' });
        if (!res.ok) return;
        data = await res.json();
        document.getElementById('st-total').textContent = data.total;
        document.getElementById('st-online').textContent = data.online;
        document.getElementById('st-used').textContent = data.used;
        document.getElementById('st-revoked').textContent = data.revoked;
        render();
      } catch (e) {}
    }
    document.getElementById('search').addEventListener('input', render);
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>
