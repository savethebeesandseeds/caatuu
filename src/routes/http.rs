//! HTTP endpoint handlers. These are thin wrappers that forward to core logic.
//! Each handler is instrumented and log include parameters and basic result info.

use std::sync::Arc;
use axum::{extract::{State, Query}, Json, response::IntoResponse};
use tracing::{info, instrument};

use crate::protocol::*;
use crate::state::AppState;
use crate::logic::*;

#[instrument(level = "info")]
pub async fn http_health() -> impl IntoResponse { Json(HealthOut { ok: true }) }

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
  let (correct, score, expected, explanation) = evaluate_answer(&state, &body.challenge_id, &body.answer).await;
  info!(target: "challenge", id = %body.challenge_id, %correct, score = %format!("{:.1}", score), "HTTP submit_answer evaluated");
  Json(AnswerOut { correct, score, expected, explanation })
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
  let translation = do_translate(&state, &body.text).await;
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
  Json(NextCharOut { char: c, pinyin: p, reason })
}

#[instrument(level = "info", skip(state, body), fields(%body.challenge_id, text_len = body.text.len()))]
pub async fn http_post_agent_message(
  State(state): State<Arc<AppState>>,
  Json(body): Json<AgentIn>,
) -> impl IntoResponse {
  let reply = do_agent_reply(&state, &body.challenge_id, &body.text).await;
  Json(AgentOut { text: reply })
}
