-- Allow each employee to have a separate "holiday shift" assigned.
-- When today is a declared holiday (holidays table), the scanner uses this
-- shift's time windows instead of the regular shift_id shift — so employees
-- who work on holidays with different hours (e.g. shorter day) can still
-- check-in and check-out within the correct windows.
ALTER TABLE employees
  ADD COLUMN holiday_shift_id INT UNSIGNED NULL AFTER shift_id,
  ADD CONSTRAINT fk_emp_holiday_shift
    FOREIGN KEY (holiday_shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
