-- Spoofing / liveness-failure audit log.
-- Created when the checkin kiosk detects that a face matches a known
-- employee but the liveness check (blink detection) fails — indicating
-- a static photo may have been held in front of the camera.
-- employee_id / employee_code / full_name = whose identity was being spoofed.
-- face_image_path = photo of whoever was holding up the image (the potential spoofer).
CREATE TABLE IF NOT EXISTS spoofing_alerts (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id      INT UNSIGNED NULL,
  employee_code    VARCHAR(50)  NULL,
  full_name        VARCHAR(200) NULL,
  scan_location_id INT UNSIGNED NULL,
  detected_at      DATETIME     NOT NULL,
  face_image_path  VARCHAR(500) NULL,
  alert_type       VARCHAR(50)  NOT NULL DEFAULT 'liveness_fail',
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_detected_at  (detected_at),
  INDEX idx_employee_id  (employee_id),
  CONSTRAINT fk_spoofing_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
