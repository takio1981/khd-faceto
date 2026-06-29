-- เก็บภาพที่สแกนได้แนบไปกับการแจ้งเตือน (late/absent/success ใช้ภาพเดียวกับ
-- attendance_records.face_image_path; ใบหน้าที่ไม่รู้จัก (unknown_face) ไม่มี
-- attendance_records แถวคู่กัน จึงเก็บ path ของตัวเองไว้ตรงนี้)
ALTER TABLE notification_inbox
  ADD COLUMN image_path VARCHAR(255) NULL AFTER body;
