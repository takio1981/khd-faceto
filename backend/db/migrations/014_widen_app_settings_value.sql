-- app_settings.setting_value was VARCHAR(255), sized for short config values
-- like 'login_max_attempts'. The new notification_settings blob (SMTP/LINE/
-- Telegram/admin contacts/event matrix as JSON) is far larger — widen the
-- column so it isn't silently truncated/rejected.
ALTER TABLE app_settings MODIFY COLUMN setting_value TEXT NOT NULL;
