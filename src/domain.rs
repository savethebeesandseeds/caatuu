//! Domain models used by the backend: challenge kinds/sources, rubric, and challenge itself.

use serde::{Deserialize, Serialize};

/// What kind of challenge is presented to the user?
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
  /// Only freeform tasks remain. May be (a) instructions-driven or (b) seed+challenge driven.
  FreeformZh,
}
impl Default for ChallengeKind {
  fn default() -> Self { ChallengeKind::FreeformZh }
}

/// Where did we get the challenge from?
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeSource {
  LocalBank,   // from user-provided TOML bank
  Generated,   // generated via OpenAI and cached in memory
  Seed,        // built-in seeds (last resort)
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

  // New "seed + challenge" fields (used for runtime-generated tasks)
  #[serde(default)] pub seed_zh: String,
  #[serde(default)] pub seed_en: String,
  #[serde(default)] pub challenge_zh: String,
  #[serde(default)] pub challenge_en: String,
  #[serde(default)] pub summary_en: String,

  // Freeform (instructions-driven) fields
  #[serde(default)] pub instructions: String,
  #[serde(default)] pub rubric: Option<Rubric>,
}
