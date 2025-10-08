//! Loading agent configuration (prompts + optional challenge bank) from TOML.
//!
//! See `AgentConfig` and `Prompts` for expected schema.

use serde::Deserialize;
use tracing::{info, error};

use crate::domain::Rubric;

#[derive(Clone, Debug, Deserialize, Default)]
pub struct AgentConfig {
  #[serde(default)]
  pub prompts: Prompts,
  #[serde(default)]
  pub challenges: Vec<ChallengeCfg>,
}

/// Challenge entry accepted in TOML configuration (freeform only).
#[derive(Clone, Debug, Deserialize)]
pub struct ChallengeCfg {
  #[serde(default)] pub id: Option<String>,
  pub difficulty: String,
  // Freeform (instructions-driven) – optional, because runtime can generate seed+challenge instead.
  #[serde(default)] pub instructions: Option<String>,
  #[serde(default)] pub rubric: Option<Rubric>,
}

/// Prompts used by the OpenAI client. Defaults target the new "seed + challenge" freeform flow.
/// You can override them in TOML if you need to tune tone/structure.
#[derive(Clone, Debug, Deserialize)]
pub struct Prompts {
  // Challenge generation (seed + challenge text)
  pub challenge_system: String,
  pub challenge_user_template: String,
  // Flexible validation (seed_zh + challenge_zh + user_answer)
  pub validation_system: String,
  pub validation_user_template: String,
  // (Legacy) hint – kept in case you still want seed hints; not used by default path.
  pub hint_system: String,
  pub hint_user_template: String,
  // Fast path helpers
  pub translate_system: String,
  pub pinyin_system: String,
  pub agent_reply_system: String,
  // Freeform utilities (instructions-driven evaluation and hints)
  pub freeform_eval_system: String,
  pub freeform_eval_user_template: String,
  pub freeform_hint_system: String,
  pub freeform_hint_user_template: String,
}

impl Default for Prompts {
  fn default() -> Self {
    Self {
      // --- CHALLENGE (seed + challenge) ---
      challenge_system: r#"
You are a Chinese learning content generator. Respond ONLY with strict JSON (no markdown, no comments).
Return EXACTLY these top-level keys and nothing else: seed_zh, seed_en, challenge_zh, challenge_en, summary_en.

Objective
- Create natural Chinese SEED sentence, that sets the scene.
- Append a verb challenge that tells the learner which verb to add.
- Append a place challenge that challenges the learner to construct the sentence to a place.
- Append a subject challenge that challenges the learner to rephrase the seed for another subject.

Output format
{
  "seed_zh": "<seed sentence in Chinese>",
  "seed_en": "<seed sentence in English>",
  "challenge_zh": "<whole challenge in Chinese>",
  "challenge_en": "<whole challenge in English>",
  "summary_en": "<seed + challenge summary in English>"
}

Global rules
- Use Simplified Chinese.
- Keep vocabulary within the requested HSK band.
- When the dificulty is high consider adding multiple verbs, places or subjects.
- The seed must NOT semantically entail or already include the chosen challenges.
- Make the challenges fun. 

Give priority to some of these stance verbs — choose ONE (at random), appropriate to the requested difficulty or the provided glue_en

HSK1–2 (volition/attitude basics):
  想, 要, 喜欢, 爱, 怕, 需要, ... others
HSK2–3 (basic stance & planning):
  觉得, 希望, 打算, 想要, 决定, 担心, 害怕, 同意, 反对, 关心, 讨厌, ... others
HSK3–4 (willingness/planning/feeling):
  相信, 愿意, 乐意, 选择, 计划, 安排, 考虑, 试着, 尝试, 想念, 渴望, 感到, 感觉, ... others
HSK5–6 — 认知/判断:
  认为, 以为, 怀疑, 估计, 猜想, 猜测, 推测, 确信, 坚信, 发现, 设想, 想象, ... others
HSK5–6 — 意愿/立场:
  期望, 期待, 盼望, 向往, 憧憬, 宁愿, 宁可, 情愿, 甘愿, 拒绝, 答应, 承诺, 保证, ... others
HSK5–6 — 情感/态度:
  热爱, 喜爱, 厌恶, 反感, 担忧, 忧虑, 后悔, 遗憾, 庆幸, 赞成, 认同, 支持, 主张, ... others
"#.into(),
      challenge_user_template: r#"
difficulty="{difficulty}"
"#.into(),

      // --- CHALLENGE VALIDATION (stateless, robust) ---
      validation_system: r#"
You are a stateless validator for a 'challenge' task. Ignore any prior messages.
Reply ONLY with strict JSON: {"correct": boolean, "explanation": string}.

You receive:
- seed_zh: Original seed sentence
- challenge_zh: Challenge in Chinese
- user_answer: learner's (user) Chinese sentence

Mark correct = true if:
   (a) If user_answer resolves the challenge_zh in the seed_zh context.
   (b) user_answer preserves the seed’s topic/meaning (allow added subject/time/aspect; light reordering), AND
   (c) grammar is natural.
   (d) creativity is encouraged, is positive that the user adds new characters and new forms of formulating the topic. 

If incorrect: explanation must name the expected glue, what was found (if any), and give a one-sentence fix.
"#.into(),
      validation_user_template: r#"
seed_zh: {seed_zh}
challenge_zh: {challenge_zh}
user_answer: {user_answer}
"#.into(),

      // Hints (kept; not used by default, but available)
      hint_system: "You are a Chinese learning coach. Keep hints short and do NOT reveal the full answer.".into(),
      hint_user_template: "Sentence (zh): {zh}\nEnglish: {en}\nGive ONE concise hint (< 20 words), e.g., first word and why.".into(),

      // Helpers
      translate_system: "Translate the user's text to natural English. Output ONLY the translation text.".into(),
      pinyin_system: "Convert Chinese text to Hanyu Pinyin with tone diacritics, space-separated. Output ONLY pinyin for Han characters; copy non-Chinese as-is.".into(),
      agent_reply_system: "You answer questions concisely, always in English, and Chinese (include pinyin).".into(),

      // Freeform utilities (instructions-driven)
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
