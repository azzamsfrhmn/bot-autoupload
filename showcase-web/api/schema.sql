-- Etnic Showcase: lisensi terpisah dari Bot Auto Upload (tabel licenses tidak disentuh)
CREATE TABLE IF NOT EXISTS showcase_licenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  license_key VARCHAR(64) NOT NULL UNIQUE,
  buyer VARCHAR(120) NULL,
  install_id VARCHAR(64) NULL,
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  price INT NOT NULL DEFAULT 300000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at DATETIME NULL,
  last_seen DATETIME NULL,
  INDEX (install_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- v2: deteksi perangkat & status online (heartbeat)
ALTER TABLE showcase_licenses
  ADD COLUMN device_name VARCHAR(120) NULL,
  ADD COLUMN ip_address VARCHAR(64) NULL,
  ADD COLUMN ext_version VARCHAR(20) NULL,
  ADD COLUMN tiktok_account VARCHAR(80) NULL;
