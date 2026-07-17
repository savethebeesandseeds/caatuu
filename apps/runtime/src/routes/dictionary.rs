use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
};

use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CATALOG_RELATIVE_PATH: &str = "apps/languages/czech/static/data/dictionaries/catalog.json";
const DEFAULT_LIMIT: usize = 30;
const MAX_LIMIT: usize = 60;

#[derive(Debug, Deserialize)]
pub struct DictionarySearchQuery {
    q: String,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryStatus {
    available: bool,
    key: String,
    label: String,
    direction: String,
    status: String,
    entry_count: usize,
    sense_count: usize,
    form_count: usize,
    example_count: usize,
    excluded_quotation_count: usize,
    source_label: String,
    source_url: String,
    wiktionary_dump_date: String,
    kaikki_extracted_date: String,
    license: String,
    license_url: String,
    usage_scope: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionarySearchResponse {
    query: String,
    normalized_query: String,
    direction: &'static str,
    returned: usize,
    limit: usize,
    results: Vec<DictionaryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryEntry {
    id: i64,
    lemma: String,
    pos: String,
    source_url: String,
    matched_by: String,
    matched_term: String,
    forms: Vec<DictionaryForm>,
    senses: Vec<DictionarySense>,
}

#[derive(Debug, Serialize)]
struct DictionaryForm {
    form: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionarySense {
    source_sense_id: String,
    position: i64,
    gloss: String,
    raw_gloss: String,
    tags: Vec<String>,
    topics: Vec<String>,
    synonyms: Vec<String>,
    antonyms: Vec<String>,
    examples: Vec<DictionaryExample>,
}

#[derive(Debug, Serialize)]
struct DictionaryExample {
    text: String,
    english: String,
    tags: Vec<String>,
}

#[derive(Debug)]
struct CandidateEntry {
    id: i64,
    lemma: String,
    pos: String,
    source_url: String,
    matched_by: String,
    matched_term: String,
}

pub async fn status() -> Response {
    match tokio::task::spawn_blocking(status_sync).await {
        Ok(Ok(status)) => Json(status).into_response(),
        Ok(Err(error)) => dictionary_error(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(error) => dictionary_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Dictionary status task failed: {error}"),
        ),
    }
}

pub async fn search(Query(query): Query<DictionarySearchQuery>) -> Response {
    let raw_query = query.q.trim().to_string();
    let normalized_query = normalize_czech(&raw_query);
    if normalized_query.is_empty() {
        return dictionary_error(StatusCode::BAD_REQUEST, "A Czech search term is required.");
    }
    if normalized_query.chars().count() > 80 {
        return dictionary_error(StatusCode::BAD_REQUEST, "The search term is too long.");
    }
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let task_query = raw_query.clone();
    match tokio::task::spawn_blocking(move || search_sync(&task_query, limit)).await {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(error)) => dictionary_error(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(error) => dictionary_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Dictionary search task failed: {error}"),
        ),
    }
}

fn status_sync() -> Result<DictionaryStatus, String> {
    let path = dictionary_db_path()?;
    let connection = open_dictionary(&path)?;
    let metadata = read_metadata(&connection)?;
    Ok(DictionaryStatus {
        available: true,
        key: metadata_value(&metadata, "dictionary_key"),
        label: "Full Czech to English Dictionary".to_string(),
        direction: metadata_value(&metadata, "direction"),
        status: "developer-preview".to_string(),
        entry_count: metadata_usize(&metadata, "entry_count"),
        sense_count: metadata_usize(&metadata, "sense_count"),
        form_count: metadata_usize(&metadata, "form_count"),
        example_count: metadata_usize(&metadata, "example_count"),
        excluded_quotation_count: metadata_usize(&metadata, "excluded_quotation_count"),
        source_label: metadata_value(&metadata, "source_name"),
        source_url: metadata_value(&metadata, "source_page"),
        wiktionary_dump_date: metadata_value(&metadata, "wiktionary_dump_date"),
        kaikki_extracted_date: metadata_value(&metadata, "kaikki_extracted_date"),
        license: metadata_value(&metadata, "license"),
        license_url: metadata_value(&metadata, "license_url"),
        usage_scope: metadata_value(&metadata, "usage_scope"),
    })
}

fn search_sync(raw_query: &str, limit: usize) -> Result<DictionarySearchResponse, String> {
    let normalized_query = normalize_czech(raw_query);
    let path = dictionary_db_path()?;
    let connection = open_dictionary(&path)?;
    let prefix_upper_bound = format!("{normalized_query}\u{10ffff}");
    let candidate_limit = (limit * 12).min(MAX_LIMIT * 12) as i64;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              entries.id,
              entries.lemma,
              entries.pos,
              entries.source_url,
              search_terms.kind,
              search_terms.term,
              CASE
                WHEN search_terms.kind = 'lemma' AND search_terms.normalized = ?1 THEN 0
                WHEN search_terms.kind = 'form' AND search_terms.normalized = ?1 THEN 1
                WHEN search_terms.kind = 'lemma' THEN 2
                WHEN search_terms.kind = 'form' THEN 3
                ELSE 4
              END AS lexical_rank,
              CASE WHEN NOT EXISTS (
                SELECT 1
                FROM senses
                WHERE senses.entry_id = entries.id
                  AND senses.tags_json NOT LIKE '%"form-of"%'
              ) THEN 1 ELSE 0 END AS form_only
            FROM search_terms
            JOIN entries ON entries.id = search_terms.entry_id
            WHERE search_terms.normalized >= ?1
              AND search_terms.normalized < ?2
            ORDER BY lexical_rank + form_only * 2,
                     lexical_rank,
                     length(search_terms.normalized),
                     entries.lemma,
                     entries.pos,
                     entries.id
            LIMIT ?3
            "#,
        )
        .map_err(|error| format!("Could not prepare dictionary search: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params![normalized_query, prefix_upper_bound, candidate_limit],
            |row| {
                Ok(CandidateEntry {
                    id: row.get(0)?,
                    lemma: row.get(1)?,
                    pos: row.get(2)?,
                    source_url: row.get(3)?,
                    matched_by: row.get(4)?,
                    matched_term: row.get(5)?,
                })
            },
        )
        .map_err(|error| format!("Could not execute dictionary search: {error}"))?;

    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        let candidate =
            row.map_err(|error| format!("Could not read dictionary result: {error}"))?;
        if seen.insert(candidate.id) {
            candidates.push(candidate);
            if candidates.len() >= limit {
                break;
            }
        }
    }

    let mut results = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        results.push(load_entry(&connection, candidate)?);
    }

    Ok(DictionarySearchResponse {
        query: raw_query.to_string(),
        normalized_query,
        direction: "cs-en",
        returned: results.len(),
        limit,
        results,
    })
}

fn load_entry(
    connection: &Connection,
    candidate: CandidateEntry,
) -> Result<DictionaryEntry, String> {
    let mut form_statement = connection
        .prepare(
            "SELECT form, tags_json FROM forms WHERE entry_id = ?1 ORDER BY form_normalized, form LIMIT 24",
        )
        .map_err(|error| format!("Could not prepare dictionary forms: {error}"))?;
    let forms = form_statement
        .query_map([candidate.id], |row| {
            Ok(DictionaryForm {
                form: row.get(0)?,
                tags: parse_string_array(row.get::<_, String>(1)?),
            })
        })
        .map_err(|error| format!("Could not query dictionary forms: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("Could not read dictionary forms: {error}"))?;

    let mut sense_statement = connection
        .prepare(
            r#"
            SELECT id, source_sense_id, position, gloss, raw_gloss,
                   tags_json, topics_json, synonyms_json, antonyms_json
            FROM senses
            WHERE entry_id = ?1
            ORDER BY position, id
            LIMIT 12
            "#,
        )
        .map_err(|error| format!("Could not prepare dictionary senses: {error}"))?;
    let sense_rows = sense_statement
        .query_map([candidate.id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                DictionarySense {
                    source_sense_id: row.get(1)?,
                    position: row.get(2)?,
                    gloss: row.get(3)?,
                    raw_gloss: row.get(4)?,
                    tags: parse_string_array(row.get::<_, String>(5)?),
                    topics: parse_string_array(row.get::<_, String>(6)?),
                    synonyms: parse_string_array(row.get::<_, String>(7)?),
                    antonyms: parse_string_array(row.get::<_, String>(8)?),
                    examples: Vec::new(),
                },
            ))
        })
        .map_err(|error| format!("Could not query dictionary senses: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("Could not read dictionary senses: {error}"))?;

    let mut senses = Vec::with_capacity(sense_rows.len());
    let mut example_statement = connection
        .prepare(
            "SELECT text, english, tags_json FROM examples WHERE sense_id = ?1 ORDER BY id LIMIT 3",
        )
        .map_err(|error| format!("Could not prepare dictionary examples: {error}"))?;
    for (sense_id, mut sense) in sense_rows {
        sense.examples = example_statement
            .query_map([sense_id], |row| {
                Ok(DictionaryExample {
                    text: row.get(0)?,
                    english: row.get(1)?,
                    tags: parse_string_array(row.get::<_, String>(2)?),
                })
            })
            .map_err(|error| format!("Could not query dictionary examples: {error}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Could not read dictionary examples: {error}"))?;
        senses.push(sense);
    }

    Ok(DictionaryEntry {
        id: candidate.id,
        lemma: candidate.lemma,
        pos: candidate.pos,
        source_url: candidate.source_url,
        matched_by: candidate.matched_by,
        matched_term: candidate.matched_term,
        forms,
        senses,
    })
}

fn open_dictionary(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err(format!(
            "Full dictionary is not built at {}. Run npm run build:full-dictionary in caatuu-dev.",
            path.display()
        ));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        format!(
            "Could not open full dictionary at {}: {error}",
            path.display()
        )
    })?;
    connection
        .execute_batch("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;")
        .map_err(|error| format!("Could not secure dictionary connection: {error}"))?;
    Ok(connection)
}

fn dictionary_db_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("CAATUU_DICTIONARY_DB_PATH") {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            return Ok(path);
        }
        return Ok(workspace_root().join(path));
    }

    let catalog_path = workspace_root().join(CATALOG_RELATIVE_PATH);
    let catalog_text = fs::read_to_string(&catalog_path).map_err(|error| {
        format!(
            "Could not read dictionary catalog at {}: {error}",
            catalog_path.display()
        )
    })?;
    let catalog: Value = serde_json::from_str(&catalog_text)
        .map_err(|error| format!("Dictionary catalog is invalid JSON: {error}"))?;
    let default_key = catalog
        .get("default_dictionary")
        .and_then(Value::as_str)
        .ok_or_else(|| "Dictionary catalog has no default_dictionary.".to_string())?;
    let item = catalog
        .get("dictionaries")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("key").and_then(Value::as_str) == Some(default_key))
        })
        .ok_or_else(|| format!("Dictionary catalog has no item for {default_key}."))?;
    let database_file = item
        .get("database_file")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Dictionary catalog item {default_key} has no database_file."))?;
    Ok(catalog_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(database_file))
}

fn workspace_root() -> PathBuf {
    env::var_os("CAATUU_WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        })
}

fn read_metadata(connection: &Connection) -> Result<HashMap<String, String>, String> {
    let mut statement = connection
        .prepare("SELECT key, value FROM metadata")
        .map_err(|error| format!("Could not prepare dictionary metadata: {error}"))?;
    let metadata = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| format!("Could not query dictionary metadata: {error}"))?
        .collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(|error| format!("Could not read dictionary metadata: {error}"))?;
    Ok(metadata)
}

fn metadata_value(metadata: &HashMap<String, String>, key: &str) -> String {
    metadata.get(key).cloned().unwrap_or_default()
}

fn metadata_usize(metadata: &HashMap<String, String>, key: &str) -> usize {
    metadata
        .get(key)
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn parse_string_array(value: String) -> Vec<String> {
    serde_json::from_str(&value).unwrap_or_default()
}

fn normalize_czech(value: &str) -> String {
    let folded: String = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'č' => 'c',
            'ď' => 'd',
            'é' | 'ě' => 'e',
            'í' => 'i',
            'ň' => 'n',
            'ó' => 'o',
            'ř' => 'r',
            'š' => 's',
            'ť' => 't',
            'ú' | 'ů' => 'u',
            'ý' => 'y',
            'ž' => 'z',
            other => other,
        })
        .collect();
    folded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn dictionary_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::normalize_czech;

    #[test]
    fn normalizes_czech_diacritics_and_spacing() {
        assert_eq!(
            normalize_czech("  PŘÍLIŠ   ŽLUŤOUČKÝ  "),
            "prilis zlutoucky"
        );
    }
}
