<?php
/**
 * Etnic Showcase — API lisensi (sekali bayar, 1 lisensi = 1 browser / ekstensi)
 * Letak di server: /www/wwwroot/license.etnicstore.com/showcase/api.php
 * Memakai koneksi PDO dari ../db.php (variabel $pdo), tabel: showcase_licenses (lihat schema.sql)
 *
 * POST JSON { action: "activate" | "verify" | "ping", license_key, install_id, device, ext_version, tiktok }
 * "ping" = heartbeat selama web dibuka (status Online di admin bila < 90 detik)
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['valid' => false, 'message' => 'Metode tidak diizinkan.']);
    exit;
}

require __DIR__ . '/../db.php';

$input       = json_decode(file_get_contents('php://input'), true) ?: [];
$action      = $input['action'] ?? 'verify';
$license_key = strtoupper(trim($input['license_key'] ?? ''));
$install_id  = trim($input['install_id'] ?? '');
$device      = mb_substr(trim(strip_tags($input['device'] ?? '')), 0, 120);
$ext_version = mb_substr(preg_replace('/[^0-9A-Za-z.\-]/', '', $input['ext_version'] ?? ''), 0, 20);
$tiktok      = mb_substr(preg_replace('/[^0-9A-Za-z._@\-]/', '', $input['tiktok'] ?? ''), 0, 80);
$ip          = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? ''));
$ip          = mb_substr(trim(explode(',', $ip)[0]), 0, 64);

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

if ($license_key === '' || !preg_match('/^[A-Z0-9-]{8,64}$/', $license_key)) {
    out(['valid' => false, 'message' => 'Format kode lisensi tidak valid.']);
}
if ($install_id === '' || !preg_match('/^[a-f0-9-]{20,64}$/i', $install_id)) {
    out(['valid' => false, 'message' => 'Ekstensi Kalodata Exporter v2 belum terpasang / tidak terdeteksi.']);
}

try {
    $stmt = $pdo->prepare('SELECT * FROM showcase_licenses WHERE license_key = ? LIMIT 1');
    $stmt->execute([$license_key]);
    $lic = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$lic) out(['valid' => false, 'message' => 'Kode lisensi tidak ditemukan.']);
    if ($lic['status'] !== 'active') out(['valid' => false, 'message' => 'Lisensi ini sedang ditangguhkan. Hubungi admin Etnic Store.']);

    if (!empty($lic['install_id']) && $lic['install_id'] !== $install_id) {
        out(['valid' => false, 'message' => 'Lisensi ini sudah aktif di perangkat / browser lain.']);
    }

    if (empty($lic['install_id'])) {
        if ($action !== 'activate') out(['valid' => false, 'message' => 'Lisensi belum diaktifkan.']);
        $bind = $pdo->prepare('UPDATE showcase_licenses SET install_id = ?, activated_at = NOW() WHERE id = ? AND install_id IS NULL');
        $bind->execute([$install_id, $lic['id']]);
        if ($bind->rowCount() === 0) out(['valid' => false, 'message' => 'Lisensi baru saja diaktifkan di perangkat lain.']);
    }

    // Catat perangkat & heartbeat (kolom kosong tidak menimpa data lama)
    $pdo->prepare('UPDATE showcase_licenses SET last_seen = NOW(), ip_address = ?,
        device_name = COALESCE(NULLIF(?, \'\'), device_name),
        ext_version = COALESCE(NULLIF(?, \'\'), ext_version),
        tiktok_account = COALESCE(NULLIF(?, \'\'), tiktok_account)
        WHERE id = ?')->execute([$ip, $device, $ext_version, $tiktok, $lic['id']]);

    out([
        'valid'   => true,
        'message' => 'Lisensi aktif.',
        'buyer'   => $lic['buyer'] ?: '',
        'type'    => 'Lifetime'
    ]);
} catch (Throwable $e) {
    out(['valid' => false, 'message' => 'Server lisensi sedang bermasalah. Coba lagi nanti.'], 500);
}
