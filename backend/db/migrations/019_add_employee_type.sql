-- C3: classify staff the way Thai government agencies do — affects leave
-- entitlement and benefits even where it doesn't (yet) affect attendance
-- rules. Stored as an enum since the 3 categories are fixed by Thai civil
-- service convention, not something admins need to add to freely.
ALTER TABLE employees
  ADD COLUMN employee_type ENUM('civil_servant', 'government_employee', 'temp_employee')
    NOT NULL DEFAULT 'temp_employee' AFTER position;
