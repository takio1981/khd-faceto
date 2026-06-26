-- Default admin account.
-- Username: admin
-- Password: admin1234   <-- CHANGE THIS AFTER FIRST LOGIN
-- The hash below is a bcrypt hash of 'admin1234' (cost 10).
INSERT INTO users (username, password_hash, role)
VALUES (
  'admin',
  '$2a$10$2.qvIV4uF6BSfOzyUndWZ.w0QiUVSD6Z.aa148H9TsG2TN0XbUj6K',
  'admin'
);
