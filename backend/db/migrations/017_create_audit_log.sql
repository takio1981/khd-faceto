-- Records every admin action that changes data or accesses sensitive data
-- (face images), since neither PDPA nor investigating an incident under the
-- Computer Crime Act is possible without knowing who did what, when.
-- username is denormalized (copied at the time of the action) so the trail
-- stays readable even if the user account is later deleted.
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  username VARCHAR(60) NULL,
  action VARCHAR(60) NOT NULL,
  target_table VARCHAR(60) NULL,
  target_id INT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_target (target_table, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
