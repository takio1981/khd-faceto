ALTER TABLE shifts
  ADD COLUMN flexible_min_hours DECIMAL(4,2) NOT NULL DEFAULT 0 AFTER flexible_time;
