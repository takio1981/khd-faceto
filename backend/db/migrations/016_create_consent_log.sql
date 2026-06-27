-- PDPA: face descriptors are sensitive/biometric personal data (มาตรา 26)
-- requiring explicit consent. Each row is one consent event (grant or
-- withdrawal); the most recent row per employee determines current status.
-- recorded_by = the admin user who captured the consent on the employee's
-- behalf (employees here don't operate the system themselves in most
-- offices — consent is given in person, then recorded by HR/admin).
CREATE TABLE IF NOT EXISTS consent_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  consent_version VARCHAR(20) NOT NULL,
  consented_at TIMESTAMP NULL DEFAULT NULL,
  withdrawn_at TIMESTAMP NULL DEFAULT NULL,
  recorded_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_consent_employee (employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
