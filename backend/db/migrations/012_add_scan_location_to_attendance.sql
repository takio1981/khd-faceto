-- Record which installed scan-camera location each attendance scan came from
ALTER TABLE attendance_records
  ADD COLUMN scan_location_id INT UNSIGNED NULL AFTER employee_id,
  ADD CONSTRAINT fk_ar_location FOREIGN KEY (scan_location_id) REFERENCES scan_locations(id) ON DELETE SET NULL,
  ADD INDEX idx_ar_location (scan_location_id);
