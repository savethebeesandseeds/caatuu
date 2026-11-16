-- Additive v2 protocol. Legacy rows and uniqueness remain unchanged.
CREATE TABLE IF NOT EXISTS dictionary_gaps_v2 (
  course_id TEXT NOT NULL CHECK (length(course_id) BETWEEN 1 AND 80),
  source_language TEXT NOT NULL CHECK (length(source_language) BETWEEN 2 AND 80),
  target_language TEXT NOT NULL CHECK (length(target_language) BETWEEN 2 AND 80),
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 120),
  dictionary_key TEXT NOT NULL CHECK (length(dictionary_key) BETWEEN 1 AND 120),
  dictionary_direction TEXT NOT NULL CHECK (length(dictionary_direction) BETWEEN 1 AND 80),
  normalized_word TEXT NOT NULL CHECK (length(normalized_word) BETWEEN 1 AND 120),
  target_word TEXT NOT NULL CHECK (length(target_word) BETWEEN 1 AND 120),
  lookup_outcome TEXT NOT NULL CHECK (lookup_outcome IN ('no_results', 'no_exact_usable_entry')),
  lookup_returned INTEGER NOT NULL CHECK (lookup_returned BETWEEN 0 AND 60),
  first_seen_at_unix_ms INTEGER NOT NULL CHECK (first_seen_at_unix_ms > 0),
  last_seen_at_unix_ms INTEGER NOT NULL CHECK (last_seen_at_unix_ms >= first_seen_at_unix_ms),
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  PRIMARY KEY (course_id, source_language, target_language, provider_id, dictionary_key, dictionary_direction, normalized_word),
  CHECK ((lookup_outcome = 'no_results' AND lookup_returned = 0)
    OR (lookup_outcome = 'no_exact_usable_entry' AND lookup_returned > 0))
) STRICT;
CREATE INDEX IF NOT EXISTS dictionary_gaps_v2_last_seen ON dictionary_gaps_v2(last_seen_at_unix_ms);

CREATE TABLE IF NOT EXISTS sentence_reports_v2 (
  course_id TEXT NOT NULL CHECK (length(course_id) BETWEEN 1 AND 80),
  source_language TEXT NOT NULL CHECK (length(source_language) BETWEEN 2 AND 80),
  target_language TEXT NOT NULL CHECK (length(target_language) BETWEEN 2 AND 80),
  client_report_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  sentence TEXT NOT NULL CHECK (length(sentence) BETWEEN 1 AND 360),
  translation TEXT NOT NULL CHECK (length(translation) <= 360),
  reason TEXT NOT NULL CHECK (reason IN ('nonsense_or_incorrect', 'unnatural_target_language', 'wrong_translation', 'repeated_too_soon', 'other')),
  comment TEXT NOT NULL CHECK (length(comment) <= 400),
  entry_id TEXT NOT NULL CHECK (length(entry_id) <= 120),
  content_mode TEXT NOT NULL CHECK (content_mode IN ('', 'standard', 'generative', 'authored')),
  corpus_version TEXT NOT NULL CHECK (length(corpus_version) <= 80),
  received_at_unix_ms INTEGER NOT NULL CHECK (received_at_unix_ms > 0),
  PRIMARY KEY (course_id, source_language, target_language, client_report_id)
) STRICT;
CREATE INDEX IF NOT EXISTS sentence_reports_v2_received_at ON sentence_reports_v2(received_at_unix_ms);
