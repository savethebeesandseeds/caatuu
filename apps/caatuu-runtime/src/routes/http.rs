//! HTTP endpoint handlers. These are thin wrappers that forward to core logic.
//! Each handler is instrumented and log include parameters and basic result info.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::SystemTime};
use tokio::{io::AsyncWriteExt, sync::Mutex};
use tracing::{error, info, instrument};
use uuid::Uuid;

use crate::logic::*;
use crate::protocol::*;
use crate::state::AppState;

const MAX_REPORT_BYTES: usize = 16 * 1024;
const MAX_STORED_REPORTS: usize = 100;
const MAX_STORED_REPORT_BYTES: u64 = 2 * 1024 * 1024;
static BUG_REPORT_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

#[instrument(level = "info")]
pub async fn http_health() -> impl IntoResponse {
    Json(HealthOut { ok: true })
}

#[instrument(level = "info", skip(body))]
pub async fn http_post_bug_report(Json(body): Json<Value>) -> impl IntoResponse {
    let body_bytes = match serde_json::to_vec(&body) {
        Ok(bytes) => bytes,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "ok": false,
                    "message": format!("Bug report is not valid JSON: {error}")
                })),
            );
        }
    };

    if body_bytes.len() > MAX_REPORT_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "ok": false,
                "message": "Bug report is too large."
            })),
        );
    }

    let client_report_id = feedback_client_report_id(&body);
    let report_id = client_report_id
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let report = json!({
        "report_id": report_id,
        "received_at": chrono_like_timestamp(),
        "payload": body
    });
    let report_bytes = match serde_json::to_vec_pretty(&report) {
        Ok(bytes) => bytes,
        Err(error) => {
            error!(target: "diagnostics", error = %error, "Could not serialize bug report envelope");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "ok": false,
                    "message": "Could not save bug report."
                })),
            );
        }
    };

    let reports_dir = super::workspace_root().join("artifacts/bug-reports");
    let _write_guard = BUG_REPORT_WRITE_LOCK.lock().await;
    if let Err(error) = tokio::fs::create_dir_all(&reports_dir).await {
        error!(target: "diagnostics", error = %error, "Could not prepare bug report directory");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "message": "Could not save bug report."
            })),
        );
    }

    let filename = if client_report_id.is_some() {
        format!("feedback-{report_id}.json")
    } else {
        format!(
            "{}-{}.json",
            chrono_like_timestamp().replace([':', '.'], "-"),
            report_id.split('-').next().unwrap_or("report")
        )
    };
    let path = reports_dir.join(filename);
    if client_report_id.is_some() && tokio::fs::try_exists(&path).await.unwrap_or(false) {
        if completed_bug_report_matches(&path, &report_id).await {
            return (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "report_id": report_id,
                    "stored": true,
                    "deduplicated": true
                })),
            );
        }
        if let Err(error) = tokio::fs::remove_file(&path).await {
            error!(target: "diagnostics", error = %error, "Could not replace an incomplete bug report");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "ok": false,
                    "message": "Could not save bug report."
                })),
            );
        }
    }
    if let Err(error) = reserve_bug_report_space(&reports_dir, report_bytes.len() as u64).await {
        error!(target: "diagnostics", error = %error, "Could not enforce bug report storage limits");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "message": "Could not save bug report."
            })),
        );
    }
    let temporary_path = reports_dir.join(format!(".{report_id}-{}.tmp", Uuid::new_v4()));
    let mut temporary_file = match tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .await
    {
        Ok(file) => file,
        Err(error) => {
            error!(target: "diagnostics", error = %error, "Could not create temporary bug report");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "ok": false,
                    "message": "Could not save bug report."
                })),
            );
        }
    };
    let write_result = async {
        temporary_file.write_all(&report_bytes).await?;
        temporary_file.sync_all().await
    }
    .await;
    drop(temporary_file);
    if let Err(error) = write_result {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        error!(target: "diagnostics", error = %error, "Could not write bug report");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "message": "Could not save bug report."
            })),
        );
    }
    if let Err(error) = tokio::fs::rename(&temporary_path, &path).await {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        if client_report_id.is_some() && completed_bug_report_matches(&path, &report_id).await {
            return (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "report_id": report_id,
                    "stored": true,
                    "deduplicated": true
                })),
            );
        }
        error!(target: "diagnostics", error = %error, "Could not publish bug report");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "message": "Could not save bug report."
            })),
        );
    }

    info!(target: "diagnostics", %report_id, "Bug report saved");
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "report_id": report_id,
            "stored": true
        })),
    )
}

fn feedback_client_report_id(body: &Value) -> Option<Uuid> {
    [
        body.pointer("/feedback/clientReportId"),
        body.pointer("/payload/feedback/clientReportId"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
    .find_map(|value| Uuid::parse_str(value).ok())
}

async fn completed_bug_report_matches(path: &Path, report_id: &str) -> bool {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return false;
    };
    let Ok(report) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    report.get("report_id").and_then(Value::as_str) == Some(report_id)
        && report.get("payload").is_some()
}

async fn reserve_bug_report_space(directory: &Path, incoming_bytes: u64) -> std::io::Result<()> {
    let mut reader = tokio::fs::read_dir(directory).await?;
    let mut reports = Vec::new();

    while let Some(entry) = reader.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => continue,
            Err(error) => return Err(error),
        };
        reports.push((
            path,
            metadata.len(),
            metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        ));
    }

    reports.sort_by_key(|(_, _, modified)| *modified);
    let mut stored_bytes = reports.iter().map(|(_, bytes, _)| *bytes).sum::<u64>();
    let mut stored_count = reports.len();

    for (path, bytes, _) in reports {
        if stored_count < MAX_STORED_REPORTS
            && stored_bytes.saturating_add(incoming_bytes) <= MAX_STORED_REPORT_BYTES
        {
            break;
        }
        tokio::fs::remove_file(path).await?;
        stored_count = stored_count.saturating_sub(1);
        stored_bytes = stored_bytes.saturating_sub(bytes);
    }

    Ok(())
}

fn chrono_like_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", now.as_secs(), now.subsec_millis())
}

#[instrument(level = "info", skip(state), fields(difficulty = %q.difficulty.clone().unwrap_or_else(|| "hsk3".into())))]
pub async fn http_get_challenge(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ChallengeQuery>,
) -> impl IntoResponse {
    let difficulty = q.difficulty.unwrap_or_else(|| "hsk3".into());
    let (ch, origin) = state.choose_challenge(&difficulty).await;
    info!(target: "challenge", %difficulty, id = %ch.id, %origin, "HTTP challenge served");
    Json(crate::protocol::to_out(&ch))
}

#[instrument(level = "info", skip(state, body), fields(%body.challenge_id, answer_len = body.answer.len()))]
pub async fn http_post_answer(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AnswerIn>,
) -> impl IntoResponse {
    let (correct, score, expected, explanation) =
        evaluate_answer(&state, &body.challenge_id, &body.answer).await;
    info!(target: "challenge", id = %body.challenge_id, %correct, score = %format!("{:.1}", score), "HTTP submit_answer evaluated");
    Json(AnswerOut {
        correct,
        score,
        expected,
        explanation,
    })
}

#[instrument(level = "info", skip(state), fields(%q.challenge_id))]
pub async fn http_get_hint(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HintQuery>,
) -> impl IntoResponse {
    let text = get_hint_text(&state, &q.challenge_id).await;
    info!(target: "challenge", id = %q.challenge_id, "HTTP hint served");
    Json(HintOut { text })
}

#[instrument(level = "info", skip(state, body), fields(text_len = body.text.len()))]
pub async fn http_post_translate(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TranslateIn>,
) -> impl IntoResponse {
    let translation = do_translate_with_mode(&state, &body.text, body.fast_only).await;
    Json(TranslateOut { translation })
}

#[instrument(level = "info", skip(state, body), fields(text_len = body.text.len()))]
pub async fn http_post_pinyin(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PinyinIn>,
) -> impl IntoResponse {
    let pinyin = do_pinyin(&state, &body.text).await;
    Json(PinyinOut { pinyin })
}

// NEW: grammar correction
#[instrument(level = "info", skip(state, body), fields(text_len = body.text.len()))]
pub async fn http_post_grammar(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GrammarIn>,
) -> impl IntoResponse {
    let corrected = do_grammar(&state, &body.text).await;
    Json(GrammarOut { corrected })
}

#[instrument(level = "info", skip(state, body), fields(%body.challenge_id, prefix_len = body.current.len()))]
pub async fn http_post_next_char(
    State(state): State<Arc<AppState>>,
    Json(body): Json<NextCharIn>,
) -> impl IntoResponse {
    let (c, p, reason) = next_char_logic(&state, &body.challenge_id, &body.current).await;
    Json(NextCharOut {
        char: c,
        pinyin: p,
        reason,
    })
}

#[instrument(level = "info", skip(state, body), fields(%body.challenge_id, text_len = body.text.len()))]
pub async fn http_post_agent_message(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AgentIn>,
) -> impl IntoResponse {
    let reply = do_agent_reply(&state, &body.challenge_id, &body.text).await;
    Json(AgentOut { text: reply })
}

#[instrument(level = "info", skip(state, body), fields(difficulty = %body.difficulty, target_count = body.target_count.unwrap_or(42), seed_len = body.seed_zh.len()))]
pub async fn http_post_secuence_words(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SecuenceWordsIn>,
) -> impl IntoResponse {
    let target = body.target_count.unwrap_or(42).clamp(18, 80);
    let (words, context_hint) =
        build_secuence_word_bank(&state, &body.difficulty, &body.seed_zh, target).await;
    Json(SecuenceWordsOut {
        words,
        context_hint,
    })
}

#[instrument(level = "info", skip(state, body), fields(seed_len = body.seed_zh.len(), answer_len = body.answer.len()))]
pub async fn http_post_secuence_evaluate(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SecuenceEvalIn>,
) -> impl IntoResponse {
    let (correct, score, explanation) =
        evaluate_secuence_answer(&state, &body.seed_zh, &body.answer).await;
    Json(SecuenceEvalOut {
        correct,
        score,
        explanation,
    })
}

#[cfg(test)]
mod bug_report_tests {
    use super::*;

    #[tokio::test]
    async fn report_quota_removes_old_files_before_a_write() {
        let directory = std::env::temp_dir().join(format!("caatuu-report-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        for index in 0..MAX_STORED_REPORTS {
            tokio::fs::write(directory.join(format!("{index:03}.json")), b"report")
                .await
                .unwrap();
        }

        reserve_bug_report_space(&directory, 128).await.unwrap();

        let mut reader = tokio::fs::read_dir(&directory).await.unwrap();
        let mut count = 0;
        while reader.next_entry().await.unwrap().is_some() {
            count += 1;
        }
        assert_eq!(count, MAX_STORED_REPORTS - 1);
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[test]
    fn extracts_only_valid_stable_feedback_ids() {
        let id = Uuid::new_v4();
        assert_eq!(
            feedback_client_report_id(&json!({ "feedback": { "clientReportId": id.to_string() } })),
            Some(id)
        );
        assert_eq!(
            feedback_client_report_id(
                &json!({ "payload": { "feedback": { "clientReportId": id.to_string() } } })
            ),
            Some(id)
        );
        assert_eq!(
            feedback_client_report_id(&json!({ "feedback": { "clientReportId": "../../bad" } })),
            None
        );
    }

    #[tokio::test]
    async fn completed_report_validation_rejects_partial_files() {
        let directory =
            std::env::temp_dir().join(format!("caatuu-report-validation-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let path = directory.join("feedback.json");
        let id = Uuid::new_v4().to_string();

        tokio::fs::write(&path, b"{\"report_id\":").await.unwrap();
        assert!(!completed_bug_report_matches(&path, &id).await);

        tokio::fs::write(
            &path,
            serde_json::to_vec(&json!({ "report_id": id, "payload": {} })).unwrap(),
        )
        .await
        .unwrap();
        assert!(completed_bug_report_matches(&path, &id).await);
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
