//! Loading agent configuration (prompts + optional challenge bank) from TOML.
//!
//! See `AgentConfig` and `Prompts` for expected schema.

use serde::Deserialize;
use tracing::{info, error};

use crate::domain::{ChallengeKind, Rubric};

#[derive(Clone, Debug, Deserialize, Default)]
pub struct AgentConfig {
  #[serde(default)]
  pub prompts: Prompts,
  #[serde(default)]
  pub challenges: Vec<ChallengeCfg>,
}

/// Challenge entry accepted in TOML configuration.
/// Only one of the branches (exact vs freeform) should be filled as appropriate.
#[derive(Clone, Debug, Deserialize)]
pub struct ChallengeCfg {
  #[serde(default)] pub id: Option<String>,
  #[serde(default)] pub kind: Option<ChallengeKind>,
  pub difficulty: String,
  // exact_zh
  #[serde(default)] pub zh: Option<String>,
  #[serde(default)] pub py: Option<String>,
  #[serde(default)] pub en: Option<String>,
  // freeform_zh
  #[serde(default)] pub instructions: Option<String>,
  #[serde(default)] pub rubric: Option<Rubric>,
}

/// Prompts used by the OpenAI client. Defaults are sensible for Chinese training.
/// You can override them in TOML if you need to tune tone/structure.
#[derive(Clone, Debug, Deserialize)]
pub struct Prompts {
  // Exact-ZH generation
  pub challenge_system: String,
  pub challenge_user_template: String,
  // Exact-ZH validation
  pub validation_system: String,
  pub validation_user_template: String,
  // Exact-ZH hint
  pub hint_system: String,
  pub hint_user_template: String,
  // Fast path helpers
  pub translate_system: String,
  pub pinyin_system: String,
  pub agent_reply_system: String,
  // Freeform
  pub freeform_eval_system: String,
  pub freeform_eval_user_template: String,
  pub freeform_hint_system: String,
  pub freeform_hint_user_template: String,
}

impl Default for Prompts {
  fn default() -> Self {
    Self {
      challenge_system: "You are a Chinese learning content generator. Respond ONLY with strict JSON.".into(),
      challenge_user_template: "Generate one sentence challenge at difficulty '{difficulty}'. Return JSON with fields: zh, py, en. Pinyin MUST include tone diacritics and be space-separated. Keep it short and natural.".into(),
      validation_system: "You are a strict Chinese sentence validator. Reply as compact JSON.".into(),
      validation_user_template: "Expected zh: {expected}\nUser answer: {answer}\nReturn JSON {\"correct\": boolean, \"explanation\": string}. Accept minor punctuation/spacing differences; require correct characters & order; ignore tones.".into(),
      hint_system: "You are a Chinese learning coach. Keep hints short and do NOT reveal the full answer.".into(),
      hint_user_template: "Sentence (zh): {zh}\nEnglish: {en}\nGive ONE concise hint (< 20 words), e.g., first word and why.".into(),
      translate_system: "Translate the user's text to natural English. Output ONLY the translation text.".into(),
      pinyin_system: "Convert Chinese text to Hanyu Pinyin with tone diacritics, space-separated. Output ONLY pinyin for Han characters; copy non-Chinese as-is.".into(),
      agent_reply_system: "You answer Chinese grammar questions concisely in 1–2 sentences.".into(),
      freeform_eval_system: "You are a strict Chinese writing evaluator. Be concise. Output JSON only.".into(),
      freeform_eval_user_template: "Instructions: {instructions}\nRubric (JSON): {rubric_json}\nUser answer: {answer}\n\nReturn JSON: {\"correct\": boolean, \"score\": number, \"explanation\": string}\nScoring: 0-100. 'correct' = true if score >= 60.".into(),
      freeform_hint_system: "Suggest 5 concise vocab items (Chinese + pinyin) and one useful pattern for the task. Keep it short.".into(),
      freeform_hint_user_template: "Provide vocab/patterns to help with: {instructions}".into(),
    }
  }
}

/// Attempt to load `AgentConfig` from AGENT_CONFIG_PATH. On any parsing/IO error, returns None.
pub fn load_agent_config_from_env() -> Option<AgentConfig> {
  let path = std::env::var("AGENT_CONFIG_PATH").ok()?;
  match std::fs::read_to_string(&path) {
    Ok(s) => match toml::from_str::<AgentConfig>(&s) {
      Ok(cfg) => {
        info!(target: "caatuu_backend", %path, "Loaded agent config (TOML)");
        Some(cfg)
      }
      Err(e) => {
        error!(target: "caatuu_backend", %path, error = %e, "Failed to parse TOML config");
        None
      }
    },
    Err(e) => {
      error!(target: "caatuu_backend", %path, error = %e, "Failed to read TOML config file");
      None
    }
  }
}
