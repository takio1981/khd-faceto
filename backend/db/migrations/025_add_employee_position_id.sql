-- Structured link to the positions master list. The existing free-text
-- `position` column is kept for backward compatibility with existing
-- filters/exports and is kept in sync from position_id on every write
-- (see employee.routes.ts), the same pattern used for department_id.
ALTER TABLE employees
  ADD COLUMN position_id INT UNSIGNED NULL AFTER position,
  ADD CONSTRAINT fk_employees_position
    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
