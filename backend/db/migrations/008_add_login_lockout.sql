-- Account lockout after repeated failed login attempts
ALTER TABLE users
  ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL;

-- Key/value app settings, editable from the admin Settings page
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(60)  NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('login_max_attempts', '5'),
  ('login_lockout_minutes', '15')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
