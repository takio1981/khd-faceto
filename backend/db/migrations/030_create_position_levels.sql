-- Which ระดับ are valid for a given ตำแหน่ง (e.g. นักวิชาการสาธารณสุข can be
-- ปฏิบัติการ/ชำนาญการ/ชำนาญการพิเศษ/เชี่ยวชาญ, but not ปฏิบัติงาน). A position
-- with no rows here has no defined level restriction (e.g. support staff
-- positions outside the ก.พ. ระดับ system).
CREATE TABLE IF NOT EXISTS position_levels (
  position_id INT UNSIGNED NOT NULL,
  level_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (position_id, level_id),
  CONSTRAINT fk_position_levels_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
  CONSTRAINT fk_position_levels_level FOREIGN KEY (level_id) REFERENCES civil_service_levels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
