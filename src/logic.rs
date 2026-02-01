//! Core behaviors shared by both HTTP and WebSocket handlers.
//!
//! This includes:
//!   - Evaluating answers (freeform only; supports seed+challenge or instructions+rubric)
//!   - Generating hints (freeform vocab/pattern suggestions)
//!   - Calling translation/pinyin/agent helpers
//!   - Next-character logic (not applicable for freeform)

use tracing::{error, debug, instrument};

use crate::domain::Challenge;
use crate::protocol::ChallengeOut;
use crate::state::AppState;
use crate::pinyin::to_pinyin_diacritics;
use crate::util::is_cjk;

pub fn _to_out(c: &Challenge) -> ChallengeOut {
  crate::protocol::to_out(c)
}

#[instrument(level = "info", skip(state, answer), fields(%challenge_id, answer_len = answer.len()))]
pub async fn evaluate_answer(state: &AppState, challenge_id: &str, answer: &str) -> (bool, f32, String, String) {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    let has_seed_challenge = !ch.seed_zh.is_empty() && !ch.challenge_zh.is_empty();
    if has_seed_challenge {
      if let Some(oa) = &state.openai {
        match oa.validate_challenge(&state.prompts, &ch.seed_zh, &ch.challenge_zh, answer).await {
          Ok((ok, score, exp)) => (ok, score, String::new(), exp),
          Err(e) => {
            error!(target: "challenge", id = %ch.id, error = %e, "OpenAI validate_challenge failed; using local rubric.");
            let (ok, score, exp) = freeform_eval_local(&ch, answer);
            (ok, score, String::new(), format!("(local) score={:.0}: {}", score, exp))
          }
        }
      } else {
        let (ok, score, exp) = freeform_eval_local(&ch, answer);
        (ok, score, String::new(), format!("(local) score={:.0}: {}", score, exp))
      }
    } else if !ch.instructions.is_empty() {
      let rubric_json = ch.rubric.as_ref().and_then(|r| serde_json::to_string(r).ok()).unwrap_or("{}".into());
      if let Some(oa) = &state.openai {
        match oa.freeform_eval(&state.prompts, &ch.instructions, &rubric_json, answer).await {
          Ok((ok, score, exp)) => (ok, score, String::new(), format!("score={:.0}: {}", score, exp)),
          Err(e) => {
            error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_eval failed; using local rubric.");
            let (ok, score, exp) = freeform_eval_local(&ch, answer);
            (ok, score, String::new(), format!("(local) score={:.0}: {}", score, exp))
          }
        }
      } else {
        let (ok, score, exp) = freeform_eval_local(&ch, answer);
        (ok, score, String::new(), format!("(local) score={:.0}: {}", score, exp))
      }
    } else {
      (false, 0.0, String::new(), "No evaluation path: challenge is missing seed+challenge and instructions.".into())
    }
  } else {
    (false, 0.0, "".into(), format!("Unknown challengeId: {}", challenge_id))
  }
}

#[instrument(level = "info", skip(state), fields(%challenge_id))]
pub async fn get_hint_text(state: &AppState, challenge_id: &str) -> String {
  if let Some(ch) = state.get_challenge(challenge_id).await {
    let instr = if !ch.challenge_zh.is_empty() {
      format!("Seed: {}\nChallenge: {}", ch.seed_zh, ch.challenge_zh)
    } else if !ch.instructions.is_empty() {
      ch.instructions.clone()
    } else {
      "写一段短文：先说时间和地点，再用一个表态/计划的动词提出行动。".to_string()
    };

    if let Some(oa) = &state.openai {
      match oa.freeform_hint(&state.prompts, &instr).await {
        Ok(t) => t,
        Err(e) => {
          error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_hint failed; using local hint.");
          freeform_hint_local(&ch)
        }
      }
    } else {
      freeform_hint_local(&ch)
    }
  } else {
    "No hint: unknown challenge.".into()
  }
}

#[instrument(level = "info", skip(_state, text), fields(text_len = text.len()))]
pub async fn do_pinyin(_state: &AppState, text: &str) -> String {
  let p = to_pinyin_diacritics(text);
  debug!(target: "caatuu_backend", text, p, "pinying translation.");
  p
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

// Grammar correction
#[instrument(level = "info", skip(state, text), fields(text_len = text.len()))]
pub async fn do_grammar(state: &AppState, text: &str) -> String {
  if let Some(oa) = &state.openai {
    match oa.grammar_correct(&state.prompts, text).await {
      Ok(t) => return t,
      Err(e) => tracing::error!(target: "caatuu_backend", error = %e, "OpenAI grammar_correct failed; using stub fallback."),
    }
  }
  grammar_stub(text)
}

#[instrument(level = "info", skip(state, question), fields(%challenge_id, question_len = question.len()))]
pub async fn do_agent_reply(state: &AppState, challenge_id: &str, question: &str) -> String {
  let ctx: Option<String> = state
    .get_challenge(challenge_id)
    .await
    .map(|c| {
      let mut parts: Vec<String> = vec![];
      if !c.seed_zh.is_empty()      { parts.push(format!("Seed (zh): {}", c.seed_zh)); }
      if !c.challenge_zh.is_empty() { parts.push(format!("Challenge (zh): {}", c.challenge_zh)); }
      if !c.seed_en.is_empty()      { parts.push(format!("Seed (en): {}", c.seed_en)); }
      if !c.challenge_en.is_empty() { parts.push(format!("Challenge (en): {}", c.challenge_en)); }
      if !c.instructions.is_empty() { parts.push(format!("Instructions: {}", c.instructions)); }
      parts.join("\n")
    })
    .and_then(|s| {
      let t = s.trim().to_string();
      if t.is_empty() { None } else { Some(t) }
    });

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

#[instrument(level = "info", skip(_state, _current), fields(%_challenge_id, prefix_len = _current.len()))]
pub async fn next_char_logic(_state: &AppState, _challenge_id: &str, _current: &str) -> (String, String, String) {
  ("".into(), "".into(), "Not applicable to freeform tasks.".into())
}

// -------- Local fallbacks & utilities --------

fn freeform_eval_local(ch: &Challenge, answer: &str) -> (bool, f32, String) {
  let mut score = 50.0;
  let mut notes = vec![];

  if let Some(r) = &ch.rubric {
    if let Some(min_chars) = r.min_chars {
      if answer.chars().count() >= min_chars { score += 15.0; }
      else { notes.push(format!("Too short (< {})", min_chars)); }
    }
    if let Some(req) = &r.must_include {
      for w in req {
        if answer.contains(w) { score += 5.0; }
        else { notes.push(format!("Missing '{}'", w)); }
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
  let mut explanation = if notes.is_empty() { "Looks okay.".into() } else { notes.join("; ") };
  explanation.push_str(&format!(" (Score: {:.1}/100)", score));
  (correct, score, explanation)
}

fn freeform_hint_local(ch: &Challenge) -> String {
  if !ch.challenge_zh.is_empty() {
    format!("聚焦：主语改写 + 计划类动词 + 具体地点 + 时间。任务：{}", ch.challenge_zh)
  } else if !ch.instructions.is_empty() {
    format!("先定时间/地点，再完成任务要点（3-5句）。任务：{}", ch.instructions)
  } else {
    "先说谁、什么时候、在哪里，然后做什么（加一个态度/计划动词）。".into()
  }
}

fn translate_stub(text: &str) -> String {
  let s = text.trim();
  if s.is_empty() { return String::new(); }

  let has_cjk = s.chars().any(is_cjk);
  if has_cjk {
    return match s {
      "我想喝咖啡" => "I want to drink coffee.".into(),
      "今天天气很好" => "The weather is great today.".into(),
      "你吃饭了吗？" => "Have you eaten?".into(),
      "他昨天去了北京。" => "He went to Beijing yesterday.".into(),
      "我们一起学习吧！" => "Let's study together!".into(),
      _ => "Translation not available (stub).".into(),
    };
  }

  let lower = s.to_lowercase();
  match lower.as_str() {
    "i want to drink coffee" | "i want to drink coffee." =>
      "我想喝咖啡。".into(),
    "the weather is great today" | "the weather is great today." =>
      "今天天气很好。".into(),
    "have you eaten" | "have you eaten?" =>
      "你吃饭了吗？".into(),
    "he went to beijing yesterday" | "he went to beijing yesterday." =>
      "他昨天去了北京。".into(),
    "let's study together" | "let's study together!" | "lets study together" =>
      "我们一起学习吧！".into(),
    _ => "Translation not available (stub).".into(),
  }
}

// Tiny grammar stub: ensure ending punctuation; otherwise return input
fn grammar_stub(text: &str) -> String {
  let s = text.trim();
  if s.is_empty() { return s.to_string(); }
  let last = s.chars().last().unwrap_or(' ');
  let is_punct = matches!(last, '。' | '！' | '？' | '.' | '!' | '?');
  if is_punct { return s.to_string(); }
  let has_cjk = s.chars().any(is_cjk);
  if has_cjk { format!("{}。", s) } else { format!("{}.", s) }
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
