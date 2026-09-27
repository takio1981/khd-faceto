ALTER TABLE attendance_records
  ADD COLUMN shift_id INT UNSIGNED NULL AFTER scan_location_id,
  ADD CONSTRAINT fk_ar_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  ADD INDEX idx_ar_shift (shift_id);
