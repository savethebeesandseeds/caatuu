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
pub const ENGLISH_EMBEDDING_TEXT_FIELD: &str = "english_text";
pub const ENGLISH_EMBEDDING_INPUT_POLICY: &str = "english_text_only";

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
        self.rebuild_curriculum_rows(&rows, embedder)
    }

    fn rebuild_curriculum_rows<E: TextEmbedder>(
        &mut self,
        rows: &[CurriculumRow],
        embedder: &E,
    ) -> Result<VectorRebuildSummary, String> {
        for row in rows {
            row.validate_embedding_boundary()?;
        }

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

        for row in rows {
            let document_id = format!("curriculum-en-{}", row.id);
            let chunk_id = format!("{document_id}:0");
            let metadata = serde_json::to_string(&json!({
                "difficulty": row.difficulty,
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
            let vector = normalize_vector(&embedder.embed_text(&row.english_text)?)?;
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
                INSERT INTO target_realizations(
                  id, concept_id, semantic_document_id, course_id, locale, target_text,
                  pronunciation_json, linguistic_metadata_json, review_metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    format!("czech:cs:{}", row.id),
                    row.id,
                    document_id,
                    "czech",
                    "cs",
                    row.czech_text,
                    "null",
                    "{}",
                    "{}"
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
                    token_count(&row.english_text) as i64,
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
        let embedding_text_field = self.meta_value("embedding_text_field")?;
        let embedding_input_policy = self.meta_value("embedding_input_policy")?;
        if schema_name.as_deref() != Some(SCHEMA_NAME)
            || schema_version != Some(SCHEMA_VERSION)
            || default_model.as_deref() != Some(DEFAULT_EMBEDDING_MODEL_ID)
            || embedding_text_field.as_deref() != Some(ENGLISH_EMBEDDING_TEXT_FIELD)
            || embedding_input_policy.as_deref() != Some(ENGLISH_EMBEDDING_INPUT_POLICY)
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
    czech_text: String,
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
    fn validate_embedding_boundary(&self) -> Result<(), String> {
        validate_authored_english_embedding_text(&self.english_text, "english_text")?;
        if self.czech_text.trim().is_empty() {
            return Err(format!("czech_text must not be blank for {}.", self.id));
        }
        if normalized_text_identity(&self.english_text)
            == normalized_text_identity(&self.czech_text)
        {
            return Err(format!(
                "Refusing to embed english_text for {}; it matches czech_text.",
                self.id
            ));
        }
        Ok(())
    }
}

pub fn default_curriculum_corpus_path() -> PathBuf {
    std::env::var("CAATUU_CURRICULUM_EN_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            workspace_root()
                .join("tools/czech-ml/data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl")
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

fn validate_authored_english_embedding_text(text: &str, label: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(format!("{label} must be a non-empty string."));
    }

    let mut has_ascii_latin_letter = false;
    for character in text.chars() {
        if character.is_control() {
            return Err(format!("{label} must not contain control characters."));
        }
        if is_unicode_combining_mark(character) {
            return Err(format!(
                "{label} contains diacritics or combining marks and cannot be embedded as English."
            ));
        }
        if character.is_alphabetic() {
            if !character.is_ascii_alphabetic() {
                return Err(format!(
                    "{label} contains non-ASCII/non-Latin script and cannot be embedded as English."
                ));
            }
            has_ascii_latin_letter = true;
        } else if character.is_numeric() && !character.is_ascii_digit() {
            return Err(format!(
                "{label} contains non-ASCII numerals and cannot be embedded as English."
            ));
        }
        if !character.is_ascii() {
            return Err(format!(
                "{label} contains non-ASCII characters and cannot be embedded as English."
            ));
        }
    }

    if !has_ascii_latin_letter {
        return Err(format!("{label} must contain authored English Latin text."));
    }
    Ok(())
}

fn is_unicode_combining_mark(character: char) -> bool {
    matches!(
        character as u32,
        0x0300..=0x036f
            | 0x1ab0..=0x1aff
            | 0x1dc0..=0x1dff
            | 0x20d0..=0x20ff
            | 0xfe20..=0xfe2f
    )
}

fn normalized_text_identity(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    struct RecordingEmbedder {
        inputs: RefCell<Vec<String>>,
    }

    impl RecordingEmbedder {
        fn new() -> Self {
            Self {
                inputs: RefCell::new(Vec::new()),
            }
        }
    }

    impl TextEmbedder for RecordingEmbedder {
        fn model_id(&self) -> &str {
            LEGACY_HASH_EMBEDDING_MODEL_ID
        }

        fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
            self.inputs.borrow_mut().push(text.to_string());
            let mut vector = vec![0.0_f32; EMBEDDING_DIMENSION];
            vector[0] = 1.0;
            Ok(vector)
        }
    }

    #[test]
    fn english_embedding_boundary_rejects_mislabeled_non_english_script() {
        for text in [
            "一个孩子读一本书。",
            "Příliš žluťoučký kůň.",
            "Ребенок читает книгу.",
            "Cafe\u{0301} is nearby.",
            "１２３ apples.",
            "Hello 👋",
            "hello\u{064e}",
        ] {
            assert!(
                validate_authored_english_embedding_text(text, "english_text").is_err(),
                "unexpectedly accepted {text:?}"
            );
        }
        assert!(validate_authored_english_embedding_text("1234?!", "english_text").is_err());
        assert!(
            validate_authored_english_embedding_text("A child reads a book.", "english_text")
                .is_ok()
        );
    }

    #[test]
    fn curriculum_rebuild_embeds_only_english_and_separates_czech_realization() {
        let mut db = in_memory_vector_db();
        let embedder = RecordingEmbedder::new();
        let row = fixture_row();

        let summary = db
            .rebuild_curriculum_rows(&[row], &embedder)
            .expect("fixture rebuild should succeed");
        assert_eq!(summary.imported_rows, 1);
        assert_eq!(
            embedder.inputs.into_inner(),
            vec!["A child reads a book.".to_string()]
        );

        let (body, metadata): (String, String) = db
            .conn
            .query_row(
                "SELECT body, metadata_json FROM documents WHERE id = 'curriculum-en-cc-test-0001'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("English semantic document should exist");
        assert_eq!(body, "A child reads a book.");
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata).expect("metadata should be JSON");
        assert_eq!(metadata.get("czech_text"), None);

        let (concept_id, course_id, locale, target_text): (String, String, String, String) = db
            .conn
            .query_row(
                "SELECT concept_id, course_id, locale, target_text FROM target_realizations",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("Czech target realization should exist");
        assert_eq!(concept_id, "cc-test-0001");
        assert_eq!(course_id, "czech");
        assert_eq!(locale, "cs");
        assert_eq!(target_text, "Dítě čte knihu.");
    }

    #[test]
    fn curriculum_rebuild_rejects_target_text_mislabeled_as_english() {
        let mut db = in_memory_vector_db();
        let embedder = RecordingEmbedder::new();
        let mut row = fixture_row();
        row.english_text = "Pes je tady.".to_string();
        row.czech_text = "  PES   JE TADY. ".to_string();

        let error = db
            .rebuild_curriculum_rows(&[row], &embedder)
            .expect_err("identical target text must be rejected");
        assert!(error.contains("matches czech_text"), "{error}");
        assert!(embedder.inputs.borrow().is_empty());
        assert_eq!(db.count("documents").expect("count should work"), 0);
    }

    #[test]
    fn vector_schema_must_declare_the_english_only_embedding_policy() {
        let db = in_memory_vector_db();
        db.conn
            .execute(
                "UPDATE schema_meta SET value = 'target_text' WHERE key = 'embedding_input_policy'",
                [],
            )
            .expect("fixture policy should update");
        assert!(db.assert_compatible_schema().is_err());
    }

    fn in_memory_vector_db() -> VectorDb {
        let conn = Connection::open_in_memory().expect("in-memory SQLite should open");
        conn.execute_batch(VECTOR_SCHEMA_SQL)
            .expect("vector schema should load");
        let db = VectorDb { conn };
        db.assert_compatible_schema()
            .expect("fixture schema should be compatible");
        db
    }

    fn fixture_row() -> CurriculumRow {
        CurriculumRow {
            id: "cc-test-0001".to_string(),
            english_text: "A child reads a book.".to_string(),
            czech_text: "Dítě čte knihu.".to_string(),
            difficulty: 1,
            cefr: "Pre-A1/A1".to_string(),
            age_band: "6-8".to_string(),
            topic: "school".to_string(),
            target_words: vec!["child".to_string(), "book".to_string()],
            grammar_tags: vec!["present_simple".to_string()],
            child_safe: true,
            modern_english: true,
            concrete: true,
            context_independent: true,
            naturalness_score: 5,
            simplicity_score: 5,
        }
    }
}
