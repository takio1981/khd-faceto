-- Add full-frame environment snapshot path to attendance records.
-- Captured at the same moment as the face crop so admin can review
-- the surrounding scene (background, environment) for each scan.
ALTER TABLE attendance_records
  ADD COLUMN full_frame_path VARCHAR(500) NULL DEFAULT NULL AFTER face_image_path;
