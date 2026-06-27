-- Links an employee to the structured `departments` table. The existing
-- free-text `department` column is KEPT (not dropped) — reports.service.ts
-- and attendance.routes.ts already filter on it, and rewriting those to
-- join departments is out of scope here. Instead employee.routes.ts keeps
-- the text column in sync with department_id's name on every write, so
-- both the old free-text filters and the new structured org chart agree.
ALTER TABLE employees
  ADD COLUMN department_id INT NULL AFTER department,
  ADD CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
