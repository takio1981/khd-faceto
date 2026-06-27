-- Holiday calendar so absence calculations (dashboard + absent-notification
-- scheduler) can skip days nobody is expected to check in: weekends are
-- handled in code (day-of-week), this table covers public holidays /
-- agency-declared days off, which change year to year and aren't worth
-- hardcoding.
CREATE TABLE IF NOT EXISTS holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  holiday_date DATE NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_holiday_date (holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
