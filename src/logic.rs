//! Core behaviors shared by both HTTP and WebSocket handlers.
//!
//! This includes:
//!   - Evaluating answers (exact & freeform)
//!   - Generating hints
//!   - Calling translation/pinyin/agent helpers
//!   - Next-character logic for progressive typing
//!   - Local fallbacks when OpenAI is unavailable or errors

use tracing::{error, debug, instrument};

use crate::domain::{Challenge, ChallengeKind};
use crate::protocol::ChallengeOut;
use crate::state::AppState;
use crate::util::{normalize, pinyin_concat_no_space};

pub fn _to_out(c: &Challenge) -> ChallengeOut {
  crate::protocol::to_out(c)
}

#[instrument(level = "info", skip(state, answer), fields(%challenge_id, answer_len = answer.len()))]
pub async fn evaluate_answer(state: &AppState, challenge_id: &str, answer: &str) -> (bool, String, String) {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    match ch.kind {
      ChallengeKind::ExactZh => {
        if let Some(oa) = &state.openai {
          match oa.validate_glue(&state.prompts, &ch.zh, &ch.en, answer).await {
            Ok((ok, exp)) => (ok, ch.zh, exp),
            Err(e) => {
              error!(target: "challenge", id = %ch.id, error = %e, "OpenAI validate_glue failed; falling back to local check.");
              check_answer_local(state, challenge_id, answer).await
            }
          }
        } else {
          check_answer_local(state, challenge_id, answer).await
        }
      }
      ChallengeKind::FreeformZh => {
        let rubric_json = ch.rubric.as_ref().and_then(|r| serde_json::to_string(r).ok()).unwrap_or("{}".into());
        if let Some(oa) = &state.openai {
          match oa.freeform_eval(&state.prompts, &ch.instructions, &rubric_json, answer).await {
            Ok((ok, score, exp)) => (ok, String::new(), format!("score={:.0}: {}", score, exp)),
            Err(e) => {
              error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_eval failed; using local rubric.");
              let (ok, score, exp) = freeform_eval_local(&ch, answer);
              (ok, String::new(), format!("(local) score={:.0}: {}", score, exp))
            }
          }
        } else {
          let (ok, score, exp) = freeform_eval_local(&ch, answer);
          (ok, String::new(), format!("(local) score={:.0}: {}", score, exp))
        }
      }
    }
  } else {
    (false, "".into(), format!("Unknown challengeId: {}", challenge_id))
  }
}

#[instrument(level = "info", skip(state), fields(%challenge_id))]
pub async fn get_hint_text(state: &AppState, challenge_id: &str) -> String {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    match ch.kind {
      ChallengeKind::ExactZh => {
        if let Some(oa) = &state.openai {
          match oa.hint_exact(&state.prompts, &ch.zh, &ch.en).await {
            Ok(t) => t,
            Err(e) => {
              error!(target: "challenge", id = %ch.id, error = %e, "OpenAI hint failed; using local hint.");
              hint_text_local(state, challenge_id).await
            }
          }
        } else {
          hint_text_local(state, challenge_id).await
        }
      }
      ChallengeKind::FreeformZh => {
        if let Some(oa) = &state.openai {
          match oa.freeform_hint(&state.prompts, &ch.instructions).await {
            Ok(t) => t,
            Err(e) => {
              error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_hint failed; using local hint.");
              freeform_hint_local(&ch)
            }
          }
        } else {
          freeform_hint_local(&ch)
        }
      }
    }
  } else {
    "No hint: unknown challenge.".into()
  }
}

#[instrument(level = "info", skip(state, text), fields(text_len = text.len()))]
pub async fn do_translate(state: &AppState, text: &str) -> String {
  if let Some(oa) = &state.openai {
    match oa.translate_to_en(&state.prompts, text).await {
      Ok(t) => return t,
      Err(e) => tracing::error!(target: "caatuu_backend", error = %e, "OpenAI translate failed; using stub fallback."),
    }
  }
  translate_stub(text)
}

#[instrument(level = "info", skip(state, text), fields(text_len = text.len()))]
pub async fn do_pinyin(state: &AppState, text: &str) -> String {
  if let Some(oa) = &state.openai {
    match oa.pinyin_for_text(&state.prompts, text).await {
      Ok(p) => return p,
      Err(e) => tracing::error!(target: "caatuu_backend", error = %e, "OpenAI pinyin failed; using local fallback."),
    }
  }
  state.pinyin_for_text_local(text)
}

#[instrument(level = "info", skip(state, question), fields(%challenge_id, question_len = question.len()))]
pub async fn do_agent_reply(state: &AppState, challenge_id: &str, question: &str) -> String {
  // Provide context only for exact_zh challenges.
  let ctx = state
    .get_challenge(challenge_id)
    .await
    .and_then(|c| match c.kind { ChallengeKind::ExactZh => Some(c.zh), _ => None });

  if let Some(oa) = &state.openai {
    match oa.agent_reply(&state.prompts, question, ctx.as_deref()).await {
      Ok(t) => {
        debug!(target: "caatuu_backend", %challenge_id, has_context = ctx.is_some(), "Agent reply via OpenAI.");
        t
      }
      Err(e) => {
        tracing::error!(target: "caatuu_backend", %challenge_id, error = %e, "Agent reply failed; using stub.");
        agent_reply_stub(question)
      }
    }
  } else {
    debug!(target: "caatuu_backend", %challenge_id, "Agent reply via stub.");
    agent_reply_stub(question)
  }
}

#[instrument(level = "info", skip(state, current), fields(%challenge_id, prefix_len = current.len()))]
pub async fn next_char_logic(state: &AppState, challenge_id: &str, current: &str) -> (String, String, String) {
  if let Some(chal) = state.get_challenge(challenge_id).await {
    match chal.kind {
      ChallengeKind::ExactZh => {
        if let Some(next) = next_char_from_prefix(&chal.zh, current) {
          let py = state.char_pinyin.get(&next).copied().unwrap_or("");
          return (next.to_string(), py.to_string(), "Language model continuation with challenge constraint.".into());
        } else {
          return ("".into(), "".into(), "Already complete or no valid continuation.".into());
        }
      }
      ChallengeKind::FreeformZh => {
        return ("".into(), "".into(), "Not applicable to freeform tasks.".into());
      }
    }
  }
  ("".into(), "".into(), "Unknown challenge; cannot continue.".into())
}

// -------- Local fallbacks & utilities --------

#[instrument(level = "debug", skip(state, answer), fields(%challenge_id, answer_len = answer.len()))]
async fn check_answer_local(state: &AppState, challenge_id: &str, answer: &str) -> (bool, String, String) {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    let expected = ch.zh.clone();
    let correct = normalize(answer) == normalize(&expected);
    let explanation = if correct {
      "Correct! Exact match (ignoring trivial spacing).".to_string()
    } else {
      "Not quite. Check characters and order; punctuation can matter depending on context.".to_string()
    };
    (correct, expected, explanation)
  } else {
    (false, "".into(), format!("Unknown challengeId: {}", challenge_id))
  }
}

#[instrument(level = "debug", skip(state), fields(%challenge_id))]
async fn hint_text_local(state: &AppState, challenge_id: &str) -> String {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    let first_two: String = ch.zh.chars().take(2).collect();
    let pinyin = pinyin_concat_no_space(&state.pinyin_for_text_local(&first_two));
    format!("First word is {} ({}).", first_two, pinyin)
  } else {
    "No hint: unknown challenge.".into()
  }
}

fn freeform_eval_local(ch: &Challenge, answer: &str) -> (bool, f32, String) {
  let mut score = 50.0;
  let mut notes: Vec<String> = vec![];

  if let Some(r) = &ch.rubric {
    if let Some(min_chars) = r.min_chars {
      if answer.chars().count() >= min_chars { score += 15.0; } else { notes.push(format!("Too short (< {})", min_chars)); }
    }
    if let Some(req) = &r.must_include {
      for w in req {
        if answer.contains(w) { score += 5.0; } else { notes.push(format!("Missing '{}'", w)); }
      }
    }
    if let Some(avoid) = &r.avoid {
      for w in avoid {
        if answer.contains(w) { score -= 10.0; notes.push(format!("Avoid '{}' present", w)); }
      }
    }
  }
  if score > 100.0 { score = 100.0; }
  if score < 0.0 { score = 0.0; }
  let correct = score >= 60.0;
  let explanation = if notes.is_empty() { "Looks okay.".into() } else { notes.join("; ") };
  (correct, score, explanation)
}

fn freeform_hint_local(ch: &Challenge) -> String {
  format!("Try simple sequence: 先到公园，然后描述你看到/听到的（3-5句）。任务：{}", ch.instructions)
}

fn translate_stub(text: &str) -> String {
  match text {
    "我想喝咖啡" => "I want to drink coffee.".into(),
    "今天天气很好" => "The weather is great today.".into(),
    "你吃饭了吗？" => "Have you eaten?".into(),
    "他昨天去了北京。" => "He went to Beijing yesterday.".into(),
    "我们一起学习吧！" => "Let's study together!".into(),
    _ => "Translation not available (stub).".into(),
  }
}

/// Pick next char based on a known full sentence and current prefix.
/// If `current` equals the full sentence, returns None.
fn next_char_from_prefix(full: &str, current: &str) -> Option<char> {
  if full.starts_with(current) {
    let want = current.chars().count();
    return full.chars().nth(want);
  }
  if let Some(byte_pos) = full.find(current) {
    let char_pos = full[..byte_pos].chars().count() + current.chars().count();
    return full.chars().nth(char_pos);
  }
  full.chars().next()
}

/// Tiny agent fallback that answers common "了/le" type questions.
fn agent_reply_stub(text: &str) -> String {
  if text.contains('了') || text.to_lowercase().contains("le ") || text.to_lowercase() == "le" {
    "Because it marks a completed action (aspect).".into()
  } else if text.to_lowercase().contains("why") {
    "Short answer: the particle indicates aspect or sentence mood depending on position.".into()
  } else {
    "Try focusing on core patterns (S + V + O). Ask about a specific particle for a deeper explanation."
      .into()
  }
}
