ALTER TABLE shifts
  ADD COLUMN flexible_time TINYINT(1) NOT NULL DEFAULT 0 AFTER sun;

-- Dedup table for the "checked in but never checked out" admin alert on a
-- flexible-time shift, same shape/purpose as notification_absent_log (one
-- row per employee per day so the per-minute scheduler only fires once).
CREATE TABLE IF NOT EXISTS notification_missing_checkout_log (
  employee_id INT UNSIGNED NOT NULL,
  notify_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, notify_date),
  CONSTRAINT fk_mcl_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
