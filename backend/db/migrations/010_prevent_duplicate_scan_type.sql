-- Guard against duplicate attendance records of the same scan_type for the
-- same employee on the same day (e.g. two simultaneous scans both reading
-- "no check-in yet" before either INSERT commits, race-creating two
-- check_in rows). The app already filters this in normal flow, but a DB
-- constraint is the only way to make it safe under concurrency.
ALTER TABLE attendance_records
  ADD COLUMN scan_date DATE GENERATED ALWAYS AS (DATE(scan_time)) STORED AFTER scan_time;

ALTER TABLE attendance_records
  ADD UNIQUE KEY uq_ar_employee_date_type (employee_id, scan_date, scan_type);
