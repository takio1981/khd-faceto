-- เพิ่มการระบุผู้รับ (employee_id) และสถานะอ่าน/ยังไม่อ่าน ให้ notification_inbox
-- เพื่อให้พนักงานแต่ละคนดูประวัติการแจ้งเตือนของตัวเองได้ (เดิมเป็น log
-- กลางสำหรับ admin อย่างเดียว ไม่ทราบว่าเป็นของใคร)
ALTER TABLE notification_inbox
  ADD COLUMN employee_id INT UNSIGNED NULL AFTER id,
  ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0 AFTER body,
  ADD CONSTRAINT fk_notification_inbox_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  ADD INDEX idx_notification_inbox_employee (employee_id, is_read);
