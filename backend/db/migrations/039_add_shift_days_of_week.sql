-- Which day(s) of the week this shift is active on. Defaults every column to
-- 1 (every day) at the column level so the ALTER itself can't fail/skip a
-- row, then immediately narrows existing "regular" shifts below.
ALTER TABLE shifts
  ADD COLUMN mon TINYINT(1) NOT NULL DEFAULT 1 AFTER name,
  ADD COLUMN tue TINYINT(1) NOT NULL DEFAULT 1 AFTER mon,
  ADD COLUMN wed TINYINT(1) NOT NULL DEFAULT 1 AFTER tue,
  ADD COLUMN thu TINYINT(1) NOT NULL DEFAULT 1 AFTER wed,
  ADD COLUMN fri TINYINT(1) NOT NULL DEFAULT 1 AFTER thu,
  ADD COLUMN sat TINYINT(1) NOT NULL DEFAULT 1 AFTER fri,
  ADD COLUMN sun TINYINT(1) NOT NULL DEFAULT 1 AFTER sat;

-- Before this migration, "is an employee expected to work today" for
-- absence-counting purposes (dashboard, absent notifications) was a single
-- GLOBAL weekend/holiday flag that exempted EVERYONE except via the separate
-- holiday_shift_id override — a plain shift_id's own hours were never
-- day-gated at all. Leaving every shift's new day columns at the all-1
-- default would silently break that: a shift referenced by shift_id would
-- now read as "active every day including weekends" for employees who have
-- no holiday_shift_id, making them wrongly show as expected-to-work (and
-- thus absent) on Sat/Sun. Narrow any shift used ONLY as a regular
-- (shift_id) assignment — never anyone's holiday_shift_id — to weekdays,
-- restoring the exact previous behavior. Shifts used as a holiday_shift_id
-- (or not referenced at all yet) keep every day enabled, since a declared
-- holiday can fall on any weekday.
UPDATE shifts s
   SET s.sat = 0, s.sun = 0
 WHERE EXISTS (SELECT 1 FROM employees e WHERE e.shift_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.holiday_shift_id = s.id);
