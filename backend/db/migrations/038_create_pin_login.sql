-- PIN login: an alternative to password login, bound to specific browser
-- devices (max 2 per user, enforced in backend/src/services/device.service.ts
-- via a transaction — this table's UNIQUE constraint only prevents duplicate
-- devices, not the count cap). pin_hash is a bcryptjs hash only — the
-- plaintext PIN is never persisted anywhere.
CREATE TABLE IF NOT EXISTS user_pin (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             INT UNSIGNED NOT NULL,
  pin_hash            VARCHAR(255) NOT NULL,
  failed_pin_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_pin_user (user_id),
  CONSTRAINT fk_user_pin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Devices bound to a user's PIN. device_id is a client-generated UUID
-- (crypto.randomUUID(), stored in the browser's localStorage) — a binding
-- identifier only, never treated as a secret/credential on its own.
CREATE TABLE IF NOT EXISTS user_pin_devices (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_pin_id   INT UNSIGNED NOT NULL,
  device_id     VARCHAR(64)  NOT NULL,
  device_label  VARCHAR(150) NULL,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pin_device (user_pin_id, device_id),
  KEY idx_pin_devices_device_id (device_id),
  CONSTRAINT fk_pin_devices_pin FOREIGN KEY (user_pin_id) REFERENCES user_pin(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('pin_login_enabled', 'false'),
  ('pin_max_attempts', '5'),
  ('pin_lockout_minutes', '5')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
