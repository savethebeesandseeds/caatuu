//! HTTP endpoint handlers. These are thin wrappers that forward to core logic.
//! Each handler is instrumented and log include parameters and basic result info.

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use tracing::{info, instrument};

use crate::logic::*;
use crate::protocol::*;
use crate::state::AppState;

#[instrument(level = "info")]
pub async fn http_health() -> impl IntoResponse {
    Json(HealthOut { ok: true })
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
