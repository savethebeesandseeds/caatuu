//! Domain models used by the backend: challenge kinds/sources, rubric, and challenge itself.

use serde::{Deserialize, Serialize};

/// What kind of challenge is presented to the user?
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
  /// User must produce the exact expected Chinese sentence (answer = `zh`).
  ExactZh,
  /// User writes freely guided by instructions; evaluated by an LLM or local rubric.
  FreeformZh,
}
impl Default for ChallengeKind {
  fn default() -> Self { ChallengeKind::ExactZh }
}

/// Where did we get the challenge from?
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeSource {
  LocalBank,   // from user-provided TOML bank
  Generated,   // generated via OpenAI and cached in memory
  Seed,  // built-in seeds (last resort)
}

/// Optional rubric used for FreeformZh grading on the server or in the LLM.
#[derive(Clone, Debug, Deserialize, Default, Serialize)]
pub struct Rubric {
  #[serde(default)] pub min_chars: Option<usize>,
  #[serde(default)] pub must_include: Option<Vec<String>>,
  #[serde(default)] pub avoid: Option<Vec<String>>,
  #[serde(default)] pub target_level: Option<String>,
}

/// Core challenge structure persisted in-memory.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Challenge {
  pub id: String,
  pub difficulty: String,   // free-form (e.g., "hsk2", "hsk3")
  pub kind: ChallengeKind,
  pub source: ChallengeSource,

  // Exact-ZH fields (expected answer = zh)
  #[serde(default)] pub zh: String,
  #[serde(default)] pub py: String,
  #[serde(default)] pub en: String,

  // Freeform-ZH fields
  #[serde(default)] pub instructions: String,
  #[serde(default)] pub rubric: Option<Rubric>,
}
