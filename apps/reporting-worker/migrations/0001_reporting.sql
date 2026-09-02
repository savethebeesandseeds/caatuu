PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dictionary_gaps (
  dictionary_key TEXT NOT NULL,
  dictionary_direction TEXT NOT NULL,
  normalized_word TEXT NOT NULL,
  target_word TEXT NOT NULL,
  lookup_outcome TEXT NOT NULL CHECK (lookup_outcome IN ('no_results', 'no_exact_usable_entry')),
  lookup_returned INTEGER NOT NULL CHECK (lookup_returned BETWEEN 0 AND 60),
  first_seen_at_unix_ms INTEGER NOT NULL CHECK (first_seen_at_unix_ms > 0),
  last_seen_at_unix_ms INTEGER NOT NULL CHECK (last_seen_at_unix_ms >= first_seen_at_unix_ms),
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  PRIMARY KEY (dictionary_key, dictionary_direction, normalized_word),
  CHECK (dictionary_key = 'kaikki-cs-en-2026-07-09'),
  CHECK (dictionary_direction = 'cs-en'),
  CHECK (
    (lookup_outcome = 'no_results' AND lookup_returned = 0)
    OR (lookup_outcome = 'no_exact_usable_entry' AND lookup_returned > 0)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS dictionary_gaps_last_seen
  ON dictionary_gaps (last_seen_at_unix_ms);

CREATE TABLE IF NOT EXISTS sentence_reports (
  client_report_id TEXT PRIMARY KEY,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  sentence TEXT NOT NULL CHECK (length(sentence) BETWEEN 1 AND 360),
  translation TEXT NOT NULL CHECK (length(translation) <= 360),
  reason TEXT NOT NULL CHECK (reason IN (
    'nonsense_or_incorrect',
    'unnatural_czech',
    'wrong_translation',
    'repeated_too_soon',
    'other'
  )),
  comment TEXT NOT NULL CHECK (length(comment) <= 400),
  entry_id TEXT NOT NULL CHECK (length(entry_id) <= 120),
  content_mode TEXT NOT NULL CHECK (content_mode IN ('', 'standard', 'generative', 'authored')),
  corpus_version TEXT NOT NULL CHECK (length(corpus_version) <= 80),
  received_at_unix_ms INTEGER NOT NULL CHECK (received_at_unix_ms > 0)
) STRICT;

CREATE INDEX IF NOT EXISTS sentence_reports_received_at
  ON sentence_reports (received_at_unix_ms);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_schema TEXT NOT NULL,
  source_sha256 TEXT PRIMARY KEY,
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  source_updated_at_unix_ms INTEGER NOT NULL CHECK (source_updated_at_unix_ms >= 0),
  imported_at_unix_ms INTEGER NOT NULL CHECK (imported_at_unix_ms > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS service_state (
  state_key TEXT PRIMARY KEY,
  integer_value INTEGER,
  text_value TEXT,
  updated_at_unix_ms INTEGER NOT NULL CHECK (updated_at_unix_ms > 0)
) STRICT;
