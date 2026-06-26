-- Employees / staff master data
CREATE TABLE IF NOT EXISTS employees (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(20)  NOT NULL UNIQUE,
  full_name     VARCHAR(120) NOT NULL,
  department    VARCHAR(80)  NULL,
  position      VARCHAR(80)  NULL,
  shift_id      INT UNSIGNED NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
