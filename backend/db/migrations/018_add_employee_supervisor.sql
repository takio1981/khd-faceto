-- C2: direct supervisor link per employee — the foundation for the
-- correction-request approval chain planned in C4 (employee disputes a
-- late/absent mark → supervisor reviews → admin confirms). Self-referencing
-- FK since a supervisor is just another row in the same table.
ALTER TABLE employees
  ADD COLUMN supervisor_id INT UNSIGNED NULL AFTER position,
  ADD CONSTRAINT fk_employees_supervisor FOREIGN KEY (supervisor_id) REFERENCES employees(id) ON DELETE SET NULL;
