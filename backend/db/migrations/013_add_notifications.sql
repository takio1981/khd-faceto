-- Per-employee notification contact info + opt-out flag
ALTER TABLE employees
  ADD COLUMN notify_email VARCHAR(160) NULL AFTER position,
  ADD COLUMN notify_line_user_id VARCHAR(80) NULL AFTER notify_email,
  ADD COLUMN notify_telegram_chat_id VARCHAR(40) NULL AFTER notify_line_user_id,
  ADD COLUMN notify_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER notify_telegram_chat_id;

-- Guards against sending the "ขาดงาน" (absent) alert more than once per
-- employee per day (the absent check runs every minute).
CREATE TABLE IF NOT EXISTS notification_absent_log (
  employee_id INT UNSIGNED NOT NULL,
  notify_date DATE NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, notify_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inbox for the "local notify" channel — the admin browser polls this
-- instead of receiving a server push.
CREATE TABLE IF NOT EXISTS notification_inbox (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type  VARCHAR(20) NOT NULL,
  title       VARCHAR(160) NOT NULL,
  body        VARCHAR(400) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_inbox_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
