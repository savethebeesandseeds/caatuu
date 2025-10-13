//! Minimal OpenAI client for our use-cases.
//!
//! We only call chat.completions and request either plain text or a strict JSON object.
//! Calls are instrumented and log model names, latencies, and response sizes (not contents).
//!
//! NOTE: We never log the API key and we keep payload truncations short to avoid PII leaks.

use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use tracing::{instrument, info, error};

use crate::config::Prompts;
use crate::domain::{Challenge, ChallengeKind, ChallengeSource};
use crate::util::fill_template;
use uuid::Uuid;

#[derive(Clone)]
pub struct OpenAI {
  pub client: reqwest::Client,
  pub api_key: String,
  pub base_url: String,
  pub fast_model: String,
  pub strong_model: String,
}

#[derive(Deserialize)]
struct Gen {
  seed_zh: String,
  seed_en: String,
  challenge_zh: String,
  challenge_en: String,
  summary_en: String,
}

impl OpenAI {
  /// Construct the client if we find OPENAI_API_KEY; otherwise return None.
  pub fn from_env() -> Option<Self> {
    let api_key = std::env::var("OPENAI_API_KEY").ok()?;
    let base_url =
      std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".into());
    let fast_model =
      std::env::var("OPENAI_FAST_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into());
    let strong_model =
      std::env::var("OPENAI_STRONG_MODEL").unwrap_or_else(|_| "gpt-4o".into());

    let client = reqwest::Client::builder()
      .timeout(Duration::from_secs(20))
      .build()
      .ok()?;

    Some(Self { client, api_key, base_url, fast_model, strong_model })
  }

  /// Plain-text chat completion. Used for translate/pinyin/hints/agent replies.
  #[instrument(level = "info", skip(self, system, user), fields(model = %model))]
  async fn chat_plain(
    &self,
    model: &str,
    system: &str,
    user: &str,
    temperature: f32,
  ) -> Result<String, String> {
    let url = format!("{}/chat/completions", self.base_url);
    let req = ChatCompletionRequest {
      model: model.to_string(),
      messages: vec![
        ChatMessageReq { role: "system".into(), content: system.into() },
        ChatMessageReq { role: "user".into(), content: user.into() },
      ],
      temperature,
      response_format: None,
      max_tokens: None,
    };

    let res = self.client.post(&url)
      .header(USER_AGENT, "caatuu-backend/0.1")
      .header(CONTENT_TYPE, "application/json")
      .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
      .json(&req).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
      let status = res.status();
      let body = res.text().await.unwrap_or_default();
      let msg = extract_openai_error(&body).unwrap_or_else(|| body);
      return Err(format!("OpenAI HTTP {}: {}", status, msg));
    }

    let body: ChatCompletionResponse = res.json().await.map_err(|e| e.to_string())?;
    if let Some(usage) = &body.usage {
      info!(prompt_tokens = ?usage.prompt_tokens, completion_tokens = ?usage.completion_tokens, total_tokens = ?usage.total_tokens, "OpenAI usage");
    }
    let text = body.choices.get(0)
      .and_then(|c| c.message.content.clone())
      .unwrap_or_default().trim().to_string();

    Ok(text)
  }

  /// JSON-object chat completion. Generic over the target type T.
  #[instrument(level = "info", skip(self, system, user), fields(model = %model))]
  async fn chat_json<T: for<'a> Deserialize<'a>>(
    &self,
    model: &str,
    system: &str,
    user: &str,
    temperature: f32,
  ) -> Result<T, String> {
    let url = format!("{}/chat/completions", self.base_url);
    let req = ChatCompletionRequest {
      model: model.to_string(),
      messages: vec![
        ChatMessageReq { role: "system".into(), content: system.into() },
        ChatMessageReq { role: "user".into(), content: user.into() },
      ],
      temperature,
      response_format: Some(ResponseFormat { r#type: "json_object".into() }),
      max_tokens: None,
    };

    let res = self.client.post(&url)
      .header(USER_AGENT, "caatuu-backend/0.1")
      .header(CONTENT_TYPE, "application/json")
      .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
      .json(&req).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
      let status = res.status();
      let body = res.text().await.unwrap_or_default();
      let msg = extract_openai_error(&body).unwrap_or_else(|| body);
      return Err(format!("OpenAI HTTP {}: {}", status, msg));
    }

    let body: ChatCompletionResponse = res.json().await.map_err(|e| e.to_string())?;
    if let Some(usage) = &body.usage {
      info!(prompt_tokens = ?usage.prompt_tokens, completion_tokens = ?usage.completion_tokens, total_tokens = ?usage.total_tokens, "OpenAI usage");
    }
    let text = body.choices.get(0)
      .and_then(|c| c.message.content.clone())
      .unwrap_or_default();

    serde_json::from_str::<T>(&text).map_err(|e| format!("JSON parse error: {}", e))
  }

  // --- High-level helpers (domain-specialized) ---

  /// Generate a new seed+challenge freeform task.
  #[instrument(
    level = "info",
    skip(self, prompts, difficulty),
    fields(%difficulty, model = %self.strong_model, cfg_len = prompts.challenge_user_template.len())
  )]
  pub async fn generate_challenge_freeform(
    &self,
    prompts: &Prompts,
    difficulty: &str,
  ) -> Result<Challenge, String> {
    let system = fill_template(&prompts.challenge_system, &[("difficulty", difficulty)]);
    let variables = fill_template(&prompts.challenge_user_template, &[("difficulty", difficulty)]);
    let start = std::time::Instant::now();
    let result = self.chat_json::<Gen>(&self.strong_model, &system, &variables, 0.95).await;
    let elapsed = start.elapsed();

    match &result {
      Ok(_) => info!(?elapsed, "Model response received successfully"),
      Err(e) => {
        error!(?elapsed, error = %e, "Model call failed during challenge generation");
        return Err(format!("Model generation failed: {e}"));
      }
    }

    let gen = result?;
    let ch = Challenge {
      id: Uuid::new_v4().to_string(),
      difficulty: difficulty.to_string(),
      kind: ChallengeKind::FreeformZh,
      source: ChallengeSource::Generated,
      seed_zh: gen.seed_zh,
      seed_en: gen.seed_en,
      challenge_zh: gen.challenge_zh,
      challenge_en: gen.challenge_en,
      summary_en: gen.summary_en,
      instructions: String::new(),
      rubric: None,
    };

    info!(
      challenge_id = %ch.id,
      zh_preview = %ch.challenge_zh.chars().take(30).collect::<String>(),
      en_preview = %ch.challenge_en.chars().take(40).collect::<String>(),
      "Freeform challenge successfully generated"
    );

    Ok(ch)
  }

  // seed_zh + challenge_zh validator (now returns a score too)
  #[instrument(level = "info", skip(self, prompts, seed_zh, challenge_zh, user_answer),
               fields(seed_len = seed_zh.len(), challenge_len = challenge_zh.len(), ans_len = user_answer.len()))]
  pub async fn validate_challenge(
    &self,
    prompts: &Prompts,
    seed_zh: &str,
    challenge_zh: &str,
    user_answer: &str,
  ) -> Result<(bool, f32, String), String> {
    #[derive(Deserialize)]
    struct Val { correct: bool, score: f32, explanation: String }

    let system = &prompts.validation_system;
    let user = crate::util::fill_template(
      &prompts.validation_user_template,
      &[
        ("seed_zh",       seed_zh),
        ("challenge_zh",  challenge_zh),
        ("user_answer",   user_answer),
      ],
    );

    let v: Val = self.chat_json(&self.strong_model, system, &user, 0.0).await?;
    Ok((v.correct, v.score, v.explanation))
  }

  #[instrument(level = "info", skip(self, prompts, text), fields(text_len = text.len()))]
  pub async fn translate_to_en(&self, prompts: &Prompts, text: &str) -> Result<String, String> {
    self.chat_plain(&self.fast_model, &prompts.translate_system, text, 0.0).await
  }

  #[instrument(level = "info", skip(self, prompts, text), fields(text_len = text.len()))]
  pub async fn pinyin_for_text(&self, prompts: &Prompts, text: &str) -> Result<String, String> {
    self.chat_plain(&self.fast_model, &prompts.pinyin_system, text, 0.0).await
  }

  #[instrument(level = "info", skip(self, prompts, instructions), fields(instr_len = instructions.len()))]
  pub async fn freeform_hint(
    &self,
    prompts: &Prompts,
    instructions: &str,
  ) -> Result<String, String> {
    let system = &prompts.freeform_hint_system;
    let user = fill_template(&prompts.freeform_hint_user_template, &[("instructions", instructions)]);
    self.chat_plain(&self.fast_model, system, &user, 0.2).await
  }

  #[instrument(level = "info", skip(self, prompts, question, context_zh), fields(question_len = question.len(), has_context = context_zh.is_some()))]
  pub async fn agent_reply(&self, prompts: &Prompts, question: &str, context_zh: Option<&str>) -> Result<String, String> {
    let system = &prompts.agent_reply_system;
    let user = if let Some(zh) = context_zh {
      format!("Question: {}\nRelated sentence: {}", question, zh)
    } else {
      format!("Question: {}", question)
    };
    self.chat_plain(&self.fast_model, system, &user, 0.2).await
  }

  #[instrument(level = "info", skip(self, prompts, instructions, rubric_json, answer), fields(instr_len = instructions.len(), rubric_len = rubric_json.len(), answer_len = answer.len()))]
  pub async fn freeform_eval(
    &self,
    prompts: &Prompts,
    instructions: &str,
    rubric_json: &str,
    answer: &str,
  ) -> Result<(bool, f32, String), String> {
    #[derive(Deserialize)]
    struct Eval { correct: bool, score: f32, explanation: String }

    let system = &prompts.freeform_eval_system;
    let user = fill_template(
      &prompts.freeform_eval_user_template,
      &[("instructions", instructions), ("rubric_json", rubric_json), ("answer", answer)],
    );
    let e: Eval = self.chat_json(&self.strong_model, system, &user, 0.0).await?;
    Ok((e.correct, e.score, e.explanation))
  }

  // Grammar correction (Chinese)
  #[instrument(level = "info", skip(self, prompts, text), fields(text_len = text.len()))]
  pub async fn grammar_correct(
    &self,
    prompts: &Prompts,
    text: &str,
  ) -> Result<String, String> {
    self.chat_plain(&self.fast_model, &prompts.grammar_system, text, 0.0).await
  }
}

// --- Chat DTOs ---

#[derive(Serialize)]
struct ChatCompletionRequest {
  model: String,
  messages: Vec<ChatMessageReq>,
  temperature: f32,
  #[serde(skip_serializing_if = "Option::is_none")]
  response_format: Option<ResponseFormat>,
  #[serde(skip_serializing_if = "Option::is_none")]
  max_tokens: Option<u32>,
}
#[derive(Serialize)]
struct ChatMessageReq { role: String, content: String }
#[derive(Serialize)]
struct ResponseFormat { #[serde(rename = "type")] r#type: String }

#[derive(Deserialize)]
struct ChatCompletionResponse {
  choices: Vec<ChatChoice>,
  #[serde(default)] usage: Option<Usage>,
}
#[derive(Deserialize)]
struct ChatChoice { message: ChatMessageResp }
#[derive(Deserialize)]
struct ChatMessageResp { role: String, content: Option<String> }
#[derive(Deserialize)]
struct Usage {
  #[serde(default)] prompt_tokens: Option<u32>,
  #[serde(default)] completion_tokens: Option<u32>,
  #[serde(default)] total_tokens: Option<u32>,
}

/// Try to extract a clean error message from OpenAI error body.
fn extract_openai_error(body: &str) -> Option<String> {
  #[derive(Deserialize)]
  struct EWrap { error: EObj }
  #[derive(Deserialize)]
  struct EObj { message: String }
  match serde_json::from_str::<EWrap>(body) {
    Ok(w) => Some(w.error.message),
    Err(_) => None,
  }
}
