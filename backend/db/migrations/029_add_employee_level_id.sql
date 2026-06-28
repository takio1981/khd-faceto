ALTER TABLE employees
  ADD COLUMN level_id INT UNSIGNED NULL AFTER position_id,
  ADD CONSTRAINT fk_employees_level
    FOREIGN KEY (level_id) REFERENCES civil_service_levels(id) ON DELETE SET NULL;
