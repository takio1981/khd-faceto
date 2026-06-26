-- Attendance scan records
CREATE TABLE IF NOT EXISTS attendance_records (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT UNSIGNED NOT NULL,
  scan_time          DATETIME NOT NULL,
  scan_type          ENUM('check_in','check_out','ot') NOT NULL,
  status             ENUM('on_time','late','absent','ot') NOT NULL,
  matched_confidence DECIMAL(5,4) NULL,             -- 1 - euclidean distance (audit)
  face_image_path    VARCHAR(255) NULL,             -- relative path to saved JPEG snapshot
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ar_emp FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_ar_employee (employee_id),
  INDEX idx_ar_scan_time (scan_time),
  INDEX idx_ar_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
