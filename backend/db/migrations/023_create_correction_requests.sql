-- C4: employee disputes a wrong/missing attendance record (correction) or
-- appeals an absent/late mark (appeal) — routed to their department head
-- first, then admin gives the final confirmation that actually applies the
-- change to attendance_records. attendance_record_id is nullable because an
-- absence appeal has no existing record to point at.
CREATE TABLE IF NOT EXISTS attendance_correction_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  attendance_record_id INT UNSIGNED NULL,
  request_type ENUM('correction', 'appeal_absent', 'appeal_late') NOT NULL,
  target_date DATE NOT NULL,
  original_scan_time DATETIME NULL,
  original_status ENUM('on_time', 'late', 'absent', 'ot') NULL,
  requested_scan_time DATETIME NULL,
  requested_status ENUM('on_time', 'late', 'absent', 'ot') NULL,
  reason TEXT NOT NULL,
  status ENUM('pending_supervisor', 'pending_admin', 'approved', 'rejected') NOT NULL DEFAULT 'pending_supervisor',
  supervisor_id INT UNSIGNED NULL,
  supervisor_decision ENUM('approved', 'rejected') NULL,
  supervisor_comment VARCHAR(255) NULL,
  supervisor_decided_at TIMESTAMP NULL,
  admin_decision ENUM('approved', 'rejected') NULL,
  admin_comment VARCHAR(255) NULL,
  admin_decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (attendance_record_id) REFERENCES attendance_records(id) ON DELETE SET NULL,
  FOREIGN KEY (supervisor_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_correction_status (status),
  INDEX idx_correction_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
