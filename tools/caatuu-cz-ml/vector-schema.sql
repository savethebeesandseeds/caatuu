PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  revision TEXT,
  license TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  max_tokens INTEGER NOT NULL CHECK (max_tokens > 0),
  pooling TEXT NOT NULL,
  normalized INTEGER NOT NULL CHECK (normalized IN (0, 1)),
  vector_encoding TEXT NOT NULL,
  distance_metric TEXT NOT NULL,
  source_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_kind, source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (document_id, ordinal)
);

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  vector BLOB NOT NULL,
  norm REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chunk_id, model_id),
  CHECK (length(vector) = dimension * 4)
);

CREATE TABLE IF NOT EXISTS asset_embedding_refs (
  asset_path TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('character', 'ship', 'house')),
  description TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chunk_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model_id);
CREATE INDEX IF NOT EXISTS idx_asset_embedding_refs_category ON asset_embedding_refs(category);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES
  ('schema_name', 'caatuu-cz-vector-db'),
  ('schema_version', '1'),
  ('default_embedding_model', 'caatuu-local-hash-v0.1'),
  ('embedding_text_field', 'english_text'),
  ('embedding_input_policy', 'english_text_only'),
  ('asset_embedding_table', 'asset_embedding_refs'),
  ('asset_embedding_text_field', 'manual_english_description'),
  ('asset_embedding_input_policy', 'manual_english_description_only');

INSERT OR IGNORE INTO embedding_models(
  id,
  provider,
  model_name,
  revision,
  license,
  dimension,
  max_tokens,
  pooling,
  normalized,
  vector_encoding,
  distance_metric,
  source_url,
  metadata_json
) VALUES (
  'caatuu-local-hash-v0.1',
  'Caatuu',
  'Caatuu local lexical hash embedder',
  NULL,
  'MIT',
  384,
  512,
  'signed_hashing',
  1,
  'float32le',
  'cosine',
  NULL,
  '{"purpose":"local deterministic baseline","embedding_text_field":"english_text","embedding_input_policy":"english_text_only","notes":"Useful for lexical English-text retrieval. Metadata is stored for filtering but is never embedded."}'
);

INSERT OR IGNORE INTO embedding_models(
  id,
  provider,
  model_name,
  revision,
  license,
  dimension,
  max_tokens,
  pooling,
  normalized,
  vector_encoding,
  distance_metric,
  source_url,
  metadata_json
) VALUES (
  'bge-small-en-v1.5',
  'BAAI',
  'BAAI/bge-small-en-v1.5',
  NULL,
  'MIT',
  384,
  512,
  'cls',
  1,
  'float32le',
  'cosine',
  'https://huggingface.co/BAAI/bge-small-en-v1.5',
  '{"query_instruction":"Represent this sentence for searching relevant passages:"}'
);
