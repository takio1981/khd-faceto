-- Face descriptors (128-float vectors from face-api.js), one or more per employee
CREATE TABLE IF NOT EXISTS face_descriptors (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  descriptor  JSON NOT NULL,            -- serialised Float32Array (array of 128 numbers)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fd_emp FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_fd_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
