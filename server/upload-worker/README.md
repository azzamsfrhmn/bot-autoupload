# Worker Upload 24 Jam (license.etnicstore.com)

Worker ini menjalankan upload TikTok terjadwal untuk semua pembeli aplikasi, di server Ubuntu 22 (aaPanel).
Aplikasi pelanggan mengirim jadwal + video ke `https://license.etnicstore.com/upload-worker/`.

## 1. Siapkan folder di PC (Windows)

Dari root proyek:

```
node server/upload-worker/pack.js
```

Hasilnya folder `dist-worker/`. Upload isinya ke server, misalnya ke `/www/wwwroot/upload-worker/`
(aaPanel → Files → Upload, atau zip lalu Extract).

## 2. Pasang kebutuhan di server (aaPanel → Terminal)

```bash
# Google Chrome + layar virtual (Xvfb) + font Indonesia/emoji
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get update
apt-get install -y /tmp/chrome.deb xvfb fonts-noto fonts-noto-color-emoji

# Node.js 20 (lewati jika sudah ada: node -v)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

cd /www/wwwroot/upload-worker
npm install --omit=dev

# Kunci rahasia worker (simpan, JANGAN dibagikan)
openssl rand -hex 32
```

## 3. Jalankan otomatis dengan Supervisor (aaPanel → App Store → Supervisor → Add Daemon)

| Isian | Nilai |
|---|---|
| Name | `upload-worker` |
| Run user | `root` |
| Run dir | `/www/wwwroot/upload-worker` |
| Start command | `/usr/bin/env WORKER_SECRET=ISI_HASIL_OPENSSL xvfb-run -a --server-args="-screen 0 1366x900x24" node worker.js` |
| Processes | `1` (wajib 1, antrean tidak boleh ganda) |

Cek log di Supervisor: harus muncul `Upload worker aktif di http://127.0.0.1:3100/upload-worker`.

## 4. Sambungkan ke license.etnicstore.com (HTTPS lewat aaPanel)

aaPanel → Website → `license.etnicstore.com` → Conf (Config file). Di dalam blok `server { ... }` yang memakai
port 443, tambahkan **sebelum** blok `location ~ \.php$`:

```nginx
location ^~ /upload-worker/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 300m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

Save → aaPanel otomatis reload Nginx. Tes dari browser:
`https://license.etnicstore.com/upload-worker/health` → `{"ok":true,...}`

## Pengaturan (opsional, environment variable)

| Variabel | Default | Arti |
|---|---|---|
| `WORKER_PORT` | `3100` | Port lokal worker |
| `MAX_PENDING_PER_LICENSE` | `30` | Maks jadwal aktif per lisensi |
| `MAX_DAILY_PER_LICENSE` | `30` | Maks upload per hari per lisensi |
| `MAX_MEDIA_MB` | `300` | Ukuran video maks |
| `DATA_DIR` | `./data` | Antrean, video sementara, profil Chrome pelanggan |

## Catatan keamanan

- Port 3100 hanya mendengarkan `127.0.0.1`, jadi hanya bisa diakses lewat Nginx (HTTPS).
- Setiap permintaan wajib membawa license key + machine id yang lolos `verify.php`.
- Cookie login TikTok pelanggan disimpan terenkripsi AES-256-GCM dengan `WORKER_SECRET` dan dihapus
  setelah upload selesai/gagal. Video dihapus setelah diposting.
- Kapasitas: satu upload dalam satu waktu (±3–5 menit per video).
