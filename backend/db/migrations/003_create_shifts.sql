-- Work shift definitions (check-in / check-out / OT windows)
CREATE TABLE IF NOT EXISTS shifts (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(80) NOT NULL,
  checkin_start  TIME NOT NULL,   -- earliest valid check-in   (e.g. 07:30)
  checkin_end    TIME NOT NULL,   -- on-time deadline          (e.g. 08:00)
  late_cutoff    TIME NOT NULL,   -- present-but-late ceiling  (e.g. 10:00)
  checkout_start TIME NOT NULL,   -- earliest valid checkout   (e.g. 16:00)
  checkout_end   TIME NOT NULL,   -- end of normal checkout    (e.g. 18:00)
  ot_start       TIME NOT NULL,   -- OT begins after this      (e.g. 18:00)
  ot_end         TIME NOT NULL,   -- OT ceiling                (e.g. 22:00)
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link employees.shift_id -> shifts.id (added after shifts exists)
ALTER TABLE employees
  ADD CONSTRAINT fk_emp_shift
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

-- A sensible default shift so the system is usable out of the box
INSERT INTO shifts
  (name, checkin_start, checkin_end, late_cutoff, checkout_start, checkout_end, ot_start, ot_end)
VALUES
  ('กะปกติ (General)', '07:30:00', '08:00:00', '10:00:00', '16:00:00', '18:00:00', '18:00:00', '22:00:00');
