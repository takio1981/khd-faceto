-- ระดับ/ตำแหน่งทางการบริหารงานบุคคลของข้าราชการ (เช่น ปฏิบัติการ, ชำนาญการ)
CREATE TABLE IF NOT EXISTS civil_service_levels (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80) NOT NULL UNIQUE,
  category    VARCHAR(40) NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
