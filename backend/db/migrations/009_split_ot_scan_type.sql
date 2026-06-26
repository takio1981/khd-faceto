-- Split the single 'ot' scan type into 'ot_in' (clock-in to OT) and
-- 'ot_out' (clock-out from OT). Two-phase enum change so existing rows
-- with the old 'ot' value migrate cleanly instead of being truncated.
ALTER TABLE attendance_records
  MODIFY scan_type ENUM('check_in','check_out','ot','ot_in','ot_out') NOT NULL;

UPDATE attendance_records SET scan_type = 'ot_in' WHERE scan_type = 'ot';

ALTER TABLE attendance_records
  MODIFY scan_type ENUM('check_in','check_out','ot_in','ot_out') NOT NULL;
