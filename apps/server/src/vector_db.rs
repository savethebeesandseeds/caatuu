#![allow(dead_code)]

use std::{
    cmp::Ordering,
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const SCHEMA_NAME: &str = "caatuu-cz-vector-db";
pub const SCHEMA_VERSION: i64 = 1;
pub const DEFAULT_EMBEDDING_MODEL_ID: &str = "all-minilm-l6-v2-qint8-v0.1";
pub const LEGACY_HASH_EMBEDDING_MODEL_ID: &str = "caatuu-local-hash-v0.1";
pub const FUTURE_BGE_EMBEDDING_MODEL_ID: &str = "bge-small-en-v1.5";
pub const EMBEDDING_DIMENSION: usize = 384;
pub const VECTOR_SCHEMA_SQL: &str = include_str!("../../../tools/czech-ml/vector-schema.sql");
pub const VECTOR_DB_FILE_NAME: &str = "caatuu-cz-curriculum.sqlite";

pub trait TextEmbedder {
    fn model_id(&self) -> &str;
    fn embed_text(&self, text: &str) -> Result<Vec<f32>, String>;
}

#[derive(Debug, Default, Clone)]
pub struct LocalHashEmbedder;

impl TextEmbedder for LocalHashEmbedder {
    fn model_id(&self) -> &str {
        LEGACY_HASH_EMBEDDING_MODEL_ID
    }

    fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        local_hash_embedding(text)
    }
}

#[derive(Debug, Serialize)]
pub struct VectorDbStatus {
    pub schema_name: String,
    pub schema_version: i64,
    pub default_embedding_model: String,
    pub document_count: i64,
    pub chunk_count: i64,
    pub embedding_count: i64,
}

#[derive(Debug, Serialize)]
pub struct VectorSearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub text: String,
    pub source_kind: String,
    pub source_id: String,
    pub locale: String,
    pub title: Option<String>,
    pub score: f32,
    pub chunk_metadata_json: String,
    pub document_metadata_json: String,
}

pub struct VectorDb {
    conn: Connection,
}

impl VectorDb {
    pub fn open_read_only(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let db = Self { conn };
        db.assert_compatible_schema()?;
        Ok(db)
    }

    pub fn open_or_create(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent).map_err(|_| rusqlite::Error::InvalidPath(parent.into()))?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(VECTOR_SCHEMA_SQL)?;
        let db = Self { conn };
        db.assert_compatible_schema()?;
        Ok(db)
    }

    pub fn status(&self) -> rusqlite::Result<VectorDbStatus> {
        Ok(VectorDbStatus {
            schema_name: self.meta_value("schema_name")?.unwrap_or_default(),
            schema_version: self
                .meta_value("schema_version")?
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or_default(),
            default_embedding_model: self
                .meta_value("default_embedding_model")?
                .unwrap_or_default(),
            document_count: self.count("documents")?,
            chunk_count: self.count("chunks")?,
            embedding_count: self.count("embeddings")?,
        })
    }

    pub fn embed_text<E: TextEmbedder>(
        &self,
        embedder: &E,
        text: &str,
    ) -> Result<Vec<f32>, String> {
        normalize_vector(&embedder.embed_text(text)?)
    }

    pub fn search_text<E: TextEmbedder>(
        &self,
        embedder: &E,
        text: &str,
        limit: usize,
        model_id: Option<&str>,
    ) -> Result<Vec<VectorSearchResult>, String> {
        let requested_model = model_id.unwrap_or(DEFAULT_EMBEDDING_MODEL_ID);
        if requested_model != embedder.model_id() {
            return Err(format!(
                "Embedder {} cannot query vectors from {requested_model}.",
                embedder.model_id()
            ));
        }
        let query = self.embed_text(embedder, text)?;
        self.search_vector(&query, limit, model_id)
            .map_err(|error| error.to_string())
    }

    pub fn rebuild_curriculum_from_jsonl<E: TextEmbedder>(
        &mut self,
        corpus_path: impl AsRef<Path>,
        embedder: &E,
    ) -> Result<VectorRebuildSummary, String> {
        let corpus_path = corpus_path.as_ref();
        let rows = read_curriculum_rows(corpus_path)?;
        let tx = self.conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM documents WHERE source_kind = ?1 AND locale = ?2",
            params!["curriculum", "en"],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('default_embedding_model', ?1)",
            params![embedder.model_id()],
        )
        .map_err(|error| error.to_string())?;

        for row in &rows {
            let document_id = format!("curriculum-en-{}", row.id);
            let chunk_id = format!("{document_id}:0");
            let metadata = serde_json::to_string(&json!({
                "difficulty": row.difficulty,
                "czech_text": row.czech_text.as_deref().unwrap_or(""),
                "cefr": row.cefr,
                "age_band": row.age_band,
                "topic": row.topic,
                "target_words": row.target_words,
                "grammar_tags": row.grammar_tags,
                "child_safe": row.child_safe,
                "modern_english": row.modern_english,
                "concrete": row.concrete,
                "context_independent": row.context_independent,
                "naturalness_score": row.naturalness_score,
                "simplicity_score": row.simplicity_score
            }))
            .map_err(|error| error.to_string())?;
            let indexed_text = row.indexed_text();
            let vector = normalize_vector(&embedder.embed_text(&indexed_text)?)?;
            let vector_blob = encode_float32le_vector(&vector);
            let content_hash = stable_hex_hash(&format!("{}|{}", row.english_text, metadata));

            tx.execute(
                r#"
                INSERT INTO documents(
                  id, source_kind, source_id, locale, title, body, content_hash, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    document_id,
                    "curriculum",
                    row.id,
                    "en",
                    row.topic,
                    row.english_text,
                    content_hash,
                    metadata
                ],
            )
            .map_err(|error| error.to_string())?;

            tx.execute(
                r#"
                INSERT INTO chunks(
                  id, document_id, ordinal, text, token_count, content_hash, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    chunk_id,
                    document_id,
                    0_i64,
                    row.english_text,
                    token_count(&indexed_text) as i64,
                    stable_hex_hash(&row.english_text),
                    "{}"
                ],
            )
            .map_err(|error| error.to_string())?;

            tx.execute(
                r#"
                INSERT INTO embeddings(
                  chunk_id, model_id, dimension, vector, norm
                ) VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    chunk_id,
                    embedder.model_id(),
                    EMBEDDING_DIMENSION as i64,
                    vector_blob,
                    1.0_f64
                ],
            )
            .map_err(|error| error.to_string())?;
        }

        tx.commit().map_err(|error| error.to_string())?;
        let status = self.status().map_err(|error| error.to_string())?;
        Ok(VectorRebuildSummary {
            model_id: embedder.model_id().to_string(),
            imported_rows: rows.len(),
            status,
        })
    }

    pub fn search_vector(
        &self,
        query_vector: &[f32],
        limit: usize,
        model_id: Option<&str>,
    ) -> rusqlite::Result<Vec<VectorSearchResult>> {
        let query = normalize_vector(query_vector).map_err(|_| rusqlite::Error::InvalidQuery)?;
        let model = model_id.unwrap_or(DEFAULT_EMBEDDING_MODEL_ID);
        let mut stmt = self.conn.prepare(
            r#"
            SELECT
              chunks.id AS chunk_id,
              chunks.document_id,
              chunks.text,
              chunks.metadata_json AS chunk_metadata_json,
              documents.source_kind,
              documents.source_id,
              documents.locale,
              documents.title,
              documents.metadata_json AS document_metadata_json,
              embeddings.vector
            FROM embeddings
            JOIN chunks ON chunks.id = embeddings.chunk_id
            JOIN documents ON documents.id = chunks.document_id
            WHERE embeddings.model_id = ?1
              AND embeddings.dimension = ?2
            "#,
        )?;

        let rows = stmt.query_map(params![model, EMBEDDING_DIMENSION as i64], |row| {
            let vector: Vec<u8> = row.get(9)?;
            let candidate = decode_float32le_vector(&vector)?;
            Ok(VectorSearchResult {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                text: row.get(2)?,
                chunk_metadata_json: row.get(3)?,
                source_kind: row.get(4)?,
                source_id: row.get(5)?,
                locale: row.get(6)?,
                title: row.get(7)?,
                document_metadata_json: row.get(8)?,
                score: dot_product(&query, &candidate)?,
            })
        })?;

        let mut results = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        results.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        });
        results.truncate(limit.clamp(1, 100));
        Ok(results)
    }

    fn assert_compatible_schema(&self) -> rusqlite::Result<()> {
        let schema_name = self.meta_value("schema_name")?;
        let schema_version = self
            .meta_value("schema_version")?
            .and_then(|value| value.parse::<i64>().ok());
        let default_model = self.meta_value("default_embedding_model")?;
        if schema_name.as_deref() != Some(SCHEMA_NAME)
            || schema_version != Some(SCHEMA_VERSION)
            || default_model.as_deref() != Some(DEFAULT_EMBEDDING_MODEL_ID)
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }

    fn meta_value(&self, key: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM schema_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
    }

    fn count(&self, table: &str) -> rusqlite::Result<i64> {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        self.conn.query_row(&sql, [], |row| row.get(0))
    }
}

#[derive(Debug, Serialize)]
pub struct VectorRebuildSummary {
    pub model_id: String,
    pub imported_rows: usize,
    pub status: VectorDbStatus,
}

#[derive(Debug, Deserialize)]
struct CurriculumRow {
    id: String,
    english_text: String,
    czech_text: Option<String>,
    difficulty: i64,
    cefr: String,
    age_band: String,
    topic: String,
    target_words: Vec<String>,
    grammar_tags: Vec<String>,
    child_safe: bool,
    modern_english: bool,
    concrete: bool,
    context_independent: bool,
    naturalness_score: i64,
    simplicity_score: i64,
}

impl CurriculumRow {
    fn indexed_text(&self) -> String {
        format!(
            "{} topic: {} target words: {} grammar: {}",
            self.english_text,
            self.topic,
            self.target_words.join(" "),
            self.grammar_tags.join(" ")
        )
    }
}

pub fn default_curriculum_corpus_path() -> PathBuf {
    std::env::var("CAATUU_CURRICULUM_EN_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            workspace_root().join(
                "tools/czech-ml/data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl",
            )
        })
}

pub fn default_vector_db_path() -> PathBuf {
    std::env::var("CAATUU_VECTOR_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            workspace_root()
                .join("apps/languages/czech/static/data/embeddings")
                .join(DEFAULT_EMBEDDING_MODEL_ID)
                .join(VECTOR_DB_FILE_NAME)
        })
}

fn workspace_root() -> PathBuf {
    std::env::var_os("CAATUU_WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest_dir
            .parent()
            .and_then(|apps| apps.parent())
            .map(PathBuf::from)
                .unwrap_or(manifest_dir)
        })
}

fn read_curriculum_rows(path: &Path) -> Result<Vec<CurriculumRow>, String> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str::<CurriculumRow>(line)
                .map_err(|error| format!("{}:{}: {error}", path.display(), index + 1))
        })
        .collect()
}

fn local_hash_embedding(text: &str) -> Result<Vec<f32>, String> {
    let tokens = tokenize(text);
    let features = if tokens.is_empty() {
        vec!["__blank__".to_string()]
    } else {
        tokens
    };
    let mut vector = vec![0.0_f32; EMBEDDING_DIMENSION];
    for token in &features {
        add_hash_feature(&mut vector, token, 1.0);
        add_char_ngrams(&mut vector, token, 3, 0.35);
    }
    normalize_vector(&vector)
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for lower in ch.to_lowercase() {
                current.push(lower);
            }
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn token_count(text: &str) -> usize {
    tokenize(text).len()
}

fn add_char_ngrams(vector: &mut [f32], token: &str, n: usize, weight: f32) {
    let chars = token.chars().collect::<Vec<_>>();
    if chars.len() < n {
        return;
    }
    for window in chars.windows(n) {
        let feature = window.iter().collect::<String>();
        add_hash_feature(vector, &format!("ngram:{feature}"), weight);
    }
}

fn add_hash_feature(vector: &mut [f32], feature: &str, weight: f32) {
    let hash = stable_hash(feature);
    let index = (hash as usize) % vector.len();
    let sign = if (hash >> 63) == 0 { 1.0 } else { -1.0 };
    vector[index] += sign * weight;
}

fn encode_float32le_vector(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn stable_hex_hash(value: &str) -> String {
    format!("{:016x}", stable_hash(value))
}

pub fn normalize_vector(vector: &[f32]) -> Result<Vec<f32>, String> {
    if vector.len() != EMBEDDING_DIMENSION {
        return Err(format!(
            "Expected {EMBEDDING_DIMENSION} dimensions, got {}.",
            vector.len()
        ));
    }
    let norm = vector
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= 0.0 {
        return Err("Embedding vector has zero or invalid norm.".to_string());
    }
    Ok(vector.iter().map(|value| *value / norm as f32).collect())
}

fn decode_float32le_vector(bytes: &[u8]) -> rusqlite::Result<Vec<f32>> {
    if bytes.len() != EMBEDDING_DIMENSION * 4 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    bytes
        .chunks_exact(4)
        .map(|chunk| {
            let raw: [u8; 4] = chunk
                .try_into()
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(f32::from_le_bytes(raw))
        })
        .collect()
}

fn dot_product(left: &[f32], right: &[f32]) -> rusqlite::Result<f32> {
    if left.len() != right.len() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(left.iter().zip(right).map(|(l, r)| l * r).sum())
}
