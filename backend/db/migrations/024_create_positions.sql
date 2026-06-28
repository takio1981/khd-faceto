-- Standard job-title master data (สายงานข้าราชการ/บุคลากรกระทรวงสาธารณสุข)
CREATE TABLE IF NOT EXISTS positions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  category    VARCHAR(80)  NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
