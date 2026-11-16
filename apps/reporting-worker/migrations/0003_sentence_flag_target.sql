-- Optional flag routing for sentence reports. Existing v2 rows keep the defaults.
ALTER TABLE sentence_reports_v2 ADD COLUMN semantic_bank_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sentence_reports_v2 ADD COLUMN content_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sentence_reports_v2 ADD COLUMN flag_target TEXT NOT NULL DEFAULT '';
ALTER TABLE sentence_reports_v2 ADD COLUMN english_at_flag TEXT NOT NULL DEFAULT '';
ALTER TABLE sentence_reports_v2 ADD COLUMN translation_at_flag TEXT NOT NULL DEFAULT '';
