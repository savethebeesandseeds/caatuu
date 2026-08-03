//! Narrow, privacy-limited storage for Czech dictionary lookup gaps.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::{Error, ErrorKind},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};
use tracing::{error, info, instrument};
use uuid::Uuid;

const REPORT_SCHEMA: &str = "caatuu.dictionary-gap-report.v1";
const STORE_SCHEMA: &str = "caatuu.dictionary-gap-store.v1";
const DICTIONARY_KEY: &str = "kaikki-cs-en-2026-07-09";
const DICTIONARY_DIRECTION: &str = "cs-en";
const MAX_WORD_CHARACTERS: usize = 120;
const MAX_GAPS: usize = 4096;
const MAX_STORE_BYTES: usize = 2 * 1024 * 1024;
static DICTIONARY_GAP_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DictionaryGapSubmission {
    schema: String,
    target_word: String,
    normalized_word: String,
    dictionary_key: String,
    dictionary_direction: String,
    lookup_outcome: String,
    lookup_returned: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DictionaryGapRecord {
    target_word: String,
    normalized_word: String,
    dictionary_key: String,
    dictionary_direction: String,
    lookup_outcome: String,
    lookup_returned: u32,
    first_seen_at_unix_ms: u64,
    last_seen_at_unix_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DictionaryGapStore {
    schema: String,
    updated_at_unix_ms: u64,
    gaps: Vec<DictionaryGapRecord>,
}

impl Default for DictionaryGapStore {
    fn default() -> Self {
        Self {
            schema: STORE_SCHEMA.to_string(),
            updated_at_unix_ms: 0,
            gaps: Vec::new(),
        }
    }
}

fn compact_text(value: &str, max_characters: usize) -> Option<String> {
    if value
        .chars()
        .any(|character| character.is_control() || ('\u{0300}'..='\u{036f}').contains(&character))
    {
        return None;
    }
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() || compact.chars().count() > max_characters {
        return None;
    }
    Some(compact)
}

fn normalized_word(value: &str) -> Option<String> {
    compact_text(value, MAX_WORD_CHARACTERS).map(|word| word.to_lowercase())
}

fn valid_stored_gap(record: &DictionaryGapRecord) -> bool {
    compact_text(&record.target_word, MAX_WORD_CHARACTERS).as_deref()
        == Some(record.target_word.as_str())
        && normalized_word(&record.target_word).as_deref() == Some(record.normalized_word.as_str())
        && normalized_word(&record.normalized_word).as_deref()
            == Some(record.normalized_word.as_str())
        && record.dictionary_key == DICTIONARY_KEY
        && record.dictionary_direction == DICTIONARY_DIRECTION
        && record.lookup_returned <= 60
        && ((record.lookup_outcome == "no_results" && record.lookup_returned == 0)
            || (record.lookup_outcome == "no_exact_usable_entry" && record.lookup_returned > 0))
        && record.first_seen_at_unix_ms > 0
        && record.first_seen_at_unix_ms <= record.last_seen_at_unix_ms
}

fn validate_submission(body: DictionaryGapSubmission) -> Result<DictionaryGapRecord, String> {
    if body.schema != REPORT_SCHEMA {
        return Err(format!("schema must be {REPORT_SCHEMA}."));
    }
    if body.dictionary_key != DICTIONARY_KEY || body.dictionary_direction != DICTIONARY_DIRECTION {
        return Err("dictionaryKey or dictionaryDirection is not supported.".into());
    }
    if !matches!(
        body.lookup_outcome.as_str(),
        "no_results" | "no_exact_usable_entry"
    ) {
        return Err("lookupOutcome is not supported.".into());
    }
    if body.lookup_returned > 60 {
        return Err("lookupReturned must be between 0 and 60.".into());
    }
    if (body.lookup_outcome == "no_results" && body.lookup_returned != 0)
        || (body.lookup_outcome == "no_exact_usable_entry" && body.lookup_returned == 0)
    {
        return Err("lookupOutcome and lookupReturned are inconsistent.".into());
    }

    let target_word = compact_text(&body.target_word, MAX_WORD_CHARACTERS)
        .ok_or_else(|| "targetWord is empty or too long.".to_string())?;
    let normalized = normalized_word(&body.normalized_word)
        .ok_or_else(|| "normalizedWord is empty or too long.".to_string())?;
    if normalized_word(&target_word).as_deref() != Some(normalized.as_str()) {
        return Err("normalizedWord does not match targetWord.".into());
    }

    Ok(DictionaryGapRecord {
        target_word,
        normalized_word: normalized,
        dictionary_key: body.dictionary_key,
        dictionary_direction: body.dictionary_direction,
        lookup_outcome: body.lookup_outcome,
        lookup_returned: body.lookup_returned,
        first_seen_at_unix_ms: 0,
        last_seen_at_unix_ms: 0,
    })
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn store_path() -> PathBuf {
    std::env::var_os("DICTIONARY_GAP_STORE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            super::workspace_root().join("artifacts/dictionary-gaps/czech-missing-words.v1.json")
        })
}

async fn read_store(path: &Path) -> std::io::Result<DictionaryGapStore> {
    let bytes = match fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(DictionaryGapStore::default())
        }
        Err(error) => return Err(error),
    };
    if bytes.len() > MAX_STORE_BYTES {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "dictionary gap store is too large",
        ));
    }
    let store = serde_json::from_slice::<DictionaryGapStore>(&bytes)
        .map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
    if store.schema != STORE_SCHEMA
        || store.gaps.len() > MAX_GAPS
        || store.gaps.iter().any(|gap| !valid_stored_gap(gap))
        || store
            .gaps
            .iter()
            .map(|gap| gap.last_seen_at_unix_ms)
            .max()
            .is_some_and(|last_seen| store.updated_at_unix_ms < last_seen)
    {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "dictionary gap store has an invalid schema",
        ));
    }
    Ok(store)
}

async fn publish_store(path: &Path, store: &DictionaryGapStore) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "dictionary gap path has no parent"))?;
    fs::create_dir_all(parent).await?;
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
    if bytes.len() > MAX_STORE_BYTES {
        return Err(Error::new(
            ErrorKind::OutOfMemory,
            "dictionary gap store is full",
        ));
    }

    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("dictionary-gaps.json");
    let temporary_path = parent.join(format!(".{filename}-{}.tmp", Uuid::new_v4()));
    let mut temporary_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .await?;
    let write_result = async {
        temporary_file.write_all(&bytes).await?;
        temporary_file.write_all(b"\n").await?;
        temporary_file.sync_all().await
    }
    .await;
    drop(temporary_file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary_path, path).await {
        let _ = fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    fs::File::open(parent).await?.sync_all().await
}

async fn store_gap(path: &Path, mut gap: DictionaryGapRecord) -> std::io::Result<bool> {
    let _write_guard = DICTIONARY_GAP_WRITE_LOCK.lock().await;
    let mut store = read_store(path).await?;
    let observed_at = now_unix_ms();
    let existing = store.gaps.iter_mut().find(|candidate| {
        candidate.dictionary_key == gap.dictionary_key
            && candidate.dictionary_direction == gap.dictionary_direction
            && candidate.normalized_word == gap.normalized_word
    });
    let deduplicated = if let Some(existing) = existing {
        existing.target_word = gap.target_word;
        existing.lookup_outcome = gap.lookup_outcome;
        existing.lookup_returned = gap.lookup_returned;
        existing.last_seen_at_unix_ms = observed_at;
        true
    } else {
        if store.gaps.len() >= MAX_GAPS {
            return Err(Error::new(
                ErrorKind::OutOfMemory,
                "dictionary gap store is full",
            ));
        }
        gap.first_seen_at_unix_ms = observed_at;
        gap.last_seen_at_unix_ms = observed_at;
        store.gaps.push(gap);
        false
    };
    store.updated_at_unix_ms = observed_at;
    store.gaps.sort_by(|left, right| {
        left.normalized_word
            .cmp(&right.normalized_word)
            .then_with(|| left.dictionary_key.cmp(&right.dictionary_key))
            .then_with(|| left.dictionary_direction.cmp(&right.dictionary_direction))
    });
    publish_store(path, &store).await?;
    Ok(deduplicated)
}

#[instrument(level = "info", skip(body))]
pub async fn submit(Json(body): Json<DictionaryGapSubmission>) -> impl IntoResponse {
    let gap = match validate_submission(body) {
        Ok(gap) => gap,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "ok": false, "message": message })),
            );
        }
    };
    let word = gap.normalized_word.clone();
    match store_gap(&store_path(), gap).await {
        Ok(deduplicated) => {
            info!(target: "dictionary_gaps", normalized_word = %word, deduplicated, "Dictionary gap stored");
            (
                StatusCode::OK,
                Json(json!({ "ok": true, "stored": true, "deduplicated": deduplicated })),
            )
        }
        Err(error) => {
            error!(target: "dictionary_gaps", %error, "Could not store dictionary gap");
            let status = if error.kind() == ErrorKind::OutOfMemory {
                StatusCode::INSUFFICIENT_STORAGE
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (
                status,
                Json(json!({ "ok": false, "message": "Could not save the dictionary gap." })),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submission(word: &str) -> DictionaryGapSubmission {
        DictionaryGapSubmission {
            schema: REPORT_SCHEMA.into(),
            target_word: word.into(),
            normalized_word: word.to_lowercase(),
            dictionary_key: DICTIONARY_KEY.into(),
            dictionary_direction: DICTIONARY_DIRECTION.into(),
            lookup_outcome: "no_results".into(),
            lookup_returned: 0,
        }
    }

    fn temporary_store_path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("caatuu-dictionary-gap-test-{}", Uuid::new_v4()))
            .join("pending.json")
    }

    #[test]
    fn rejects_noncanonical_or_expansive_submissions() {
        let mut wrong_normalization = submission("Řekněme");
        wrong_normalization.normalized_word = "něco jiného".into();
        assert!(validate_submission(wrong_normalization).is_err());

        let mut wrong_dictionary = submission("Řekněme");
        wrong_dictionary.dictionary_key = "unreviewed-dictionary".into();
        assert!(validate_submission(wrong_dictionary).is_err());

        let mut wrong_outcome = submission("Řekněme");
        wrong_outcome.lookup_outcome = "sentence_context".into();
        assert!(validate_submission(wrong_outcome).is_err());

        let mut inconsistent_count = submission("Řekněme");
        inconsistent_count.lookup_returned = 1;
        assert!(validate_submission(inconsistent_count).is_err());

        let mut decomposed_word = submission("R\u{030c}ekne\u{030c}me");
        decomposed_word.normalized_word = "r\u{030c}ekne\u{030c}me".into();
        assert!(validate_submission(decomposed_word).is_err());

        assert!(validate_submission(submission("Řekně\nme")).is_err());
    }

    #[tokio::test]
    async fn stores_one_atomic_record_and_deduplicates_retries() {
        let path = temporary_store_path();
        let first = validate_submission(submission("Řekněme")).unwrap();
        assert!(!store_gap(&path, first).await.unwrap());

        let mut retry = submission("Řekněme");
        retry.lookup_outcome = "no_exact_usable_entry".into();
        retry.lookup_returned = 2;
        assert!(store_gap(&path, validate_submission(retry).unwrap())
            .await
            .unwrap());

        let store = read_store(&path).await.unwrap();
        assert_eq!(store.schema, STORE_SCHEMA);
        assert_eq!(store.gaps.len(), 1);
        assert_eq!(store.gaps[0].normalized_word, "řekněme");
        assert_eq!(store.gaps[0].lookup_outcome, "no_exact_usable_entry");
        assert_eq!(store.gaps[0].lookup_returned, 2);
        assert!(store.gaps[0].first_seen_at_unix_ms <= store.gaps[0].last_seen_at_unix_ms);

        let _ = fs::remove_dir_all(path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn refuses_to_replace_a_corrupt_existing_ledger() {
        let path = temporary_store_path();
        fs::create_dir_all(path.parent().unwrap()).await.unwrap();
        fs::write(&path, b"{not-json").await.unwrap();
        let before = fs::read(&path).await.unwrap();

        let error = store_gap(&path, validate_submission(submission("Řekněme")).unwrap())
            .await
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert_eq!(fs::read(&path).await.unwrap(), before);

        let _ = fs::remove_dir_all(path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn refuses_to_acknowledge_a_semantically_tampered_ledger() {
        let path = temporary_store_path();
        store_gap(&path, validate_submission(submission("Řekněme")).unwrap())
            .await
            .unwrap();
        let mut document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).await.unwrap()).unwrap();
        document["gaps"][0]["dictionaryKey"] = "unreviewed-dictionary".into();
        fs::write(&path, serde_json::to_vec_pretty(&document).unwrap())
            .await
            .unwrap();
        let before = fs::read(&path).await.unwrap();

        let error = store_gap(&path, validate_submission(submission("Jiné")).unwrap())
            .await
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert_eq!(fs::read(&path).await.unwrap(), before);

        let _ = fs::remove_dir_all(path.parent().unwrap()).await;
    }
}
