-- ผู้บริหารระดับสูง (ผอ./รอง) ใช้ระดับบริหาร
INSERT IGNORE INTO position_levels (position_id, level_id)
SELECT p.id, l.id FROM positions p
JOIN civil_service_levels l ON l.name IN ('บริหารต้น', 'บริหารสูง')
WHERE p.name IN ('นายแพทย์สาธารณสุขจังหวัด', 'รองนายแพทย์สาธารณสุขจังหวัด');

-- หัวหน้ากลุ่มงาน/ฝ่าย ใช้ระดับอำนวยการ
INSERT IGNORE INTO position_levels (position_id, level_id)
SELECT p.id, l.id FROM positions p
JOIN civil_service_levels l ON l.name IN ('อำนวยการต้น', 'อำนวยการสูง')
WHERE p.name IN ('หัวหน้ากลุ่มงาน', 'หัวหน้าฝ่าย');

-- สายวิชาชีพ ใช้ระดับสายงานวิชาการ
INSERT IGNORE INTO position_levels (position_id, level_id)
SELECT p.id, l.id FROM positions p
JOIN civil_service_levels l ON l.name IN ('ปฏิบัติการ', 'ชำนาญการ', 'ชำนาญการพิเศษ', 'เชี่ยวชาญ', 'ทรงคุณวุฒิ')
WHERE p.category = 'สายวิชาชีพ';

-- เจ้าพนักงาน ใช้ระดับสายงานทั่วไป
INSERT IGNORE INTO position_levels (position_id, level_id)
SELECT p.id, l.id FROM positions p
JOIN civil_service_levels l ON l.name IN ('ปฏิบัติงาน', 'ชำนาญงาน', 'อาวุโส', 'ทักษะพิเศษ')
WHERE p.category = 'เจ้าพนักงาน';
