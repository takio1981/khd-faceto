-- Add thumbnail column to store face JPEG images (base64) alongside descriptors
ALTER TABLE face_descriptors
  ADD COLUMN thumbnail LONGTEXT NULL AFTER descriptor;