//! Seed data and small utilities related to default content.

use std::collections::HashMap;
use uuid::Uuid;

use crate::domain::{Challenge, ChallengeKind, ChallengeSource, Rubric};

/// Minimal set of built-in challenges for the new seed+challenge freeform flow.
/// Guarantees usefulness even without external config or OpenAI.
pub fn seed_challenges() -> Vec<Challenge> {
  vec![
    Challenge {
      id: "c3001".into(),
      difficulty: "hsk3".into(),
      kind: ChallengeKind::FreeformZh,
      source: ChallengeSource::Seed,

      seed_zh: "周末我在家休息。".into(),
      seed_en: "On weekends I rest at home.".into(),
      challenge_zh: "把句子改为去一个具体的地方，并使用一个表示计划的动词；把主语改成“她”；加上下午三点。".into(),
      challenge_en: "Change it to going to a specific place; use a planning verb; switch subject to 'she'; add 3 p.m.".into(),
      summary_en: "Seed about resting at home; challenge: planning verb + place + subject swap + time.".into(),
      reference_answer_zh: String::new(),
      core_plus_spec: None,

      instructions: String::new(),
      rubric: Some(Rubric {
        min_chars: Some(10),
        must_include: Some(vec!["她".into()]),
        avoid: None,
        target_level: Some("hsk3".into()),
      }),
    },
    Challenge {
      id: "c3002".into(),
      difficulty: "hsk2".into(),
      kind: ChallengeKind::FreeformZh,
      source: ChallengeSource::Seed,

      seed_zh: "我们晚上在家做饭。".into(),
      seed_en: "We cook dinner at home in the evening.".into(),
      challenge_zh: "用“想/要/喜欢”里选一个态度动词，把句子改为在公园做别的活动；把主语改成“他们”。".into(),
      challenge_en: "Pick one attitude verb (想/要/喜欢), change to doing a different activity in the park; switch subject to 'they'.".into(),
      summary_en: "Seed about cooking at home; challenge: attitude verb + place change + subject swap.".into(),
      reference_answer_zh: String::new(),
      core_plus_spec: None,

      instructions: String::new(),
      rubric: Some(Rubric {
        min_chars: Some(8),
        must_include: Some(vec!["他们".into(), "公园".into()]),
        avoid: None,
        target_level: Some("hsk2".into()),
      }),
    },
  ]
}

/// Absolute last-resort fallback: if all generation fails, we inject this.
pub fn hard_fallback_challenge(difficulty: String) -> Challenge {
  Challenge {
    id: Uuid::new_v4().to_string(),
    difficulty,
    kind: ChallengeKind::FreeformZh,
    source: ChallengeSource::Seed,

    seed_zh: "我今天在学校上课。".into(),
    seed_en: "I have class at school today.".into(),
    challenge_zh: "把主语改为“他”，并加上你选择的一个表示态度/计划的动词；换一个具体的地点。".into(),
    challenge_en: "Change subject to 'he', add one stance/planning verb of your choice; switch to a specific place.".into(),
    summary_en: "Seed about having class; challenge: stance/planning verb + subject swap + place change.".into(),
    reference_answer_zh: String::new(),
    core_plus_spec: None,

    instructions: String::new(),
    rubric: None,
  }
}

/// A tiny, hand-curated map of char -> pinyin (with tone marks).
/// Used to provide pinyin locally when OpenAI isn't available.
pub fn seed_pinyin_map() -> HashMap<char, &'static str> {
  use std::iter::FromIterator;
  HashMap::from_iter([
    ('今', "jīn"), ('天', "tiān"), ('气', "qì"), ('很', "hěn"), ('好', "hǎo"),
    ('我', "wǒ"), ('想', "xiǎng"), ('喝', "hē"), ('咖', "kā"), ('啡', "fēi"),
    ('你', "nǐ"), ('吃', "chī"), ('饭', "fàn"), ('了', "le"), ('吗', "ma"),
    ('他', "tā"), ('昨', "zuó"), ('去', "qù"), ('北', "běi"), ('京', "jīng"),
    ('们', "men"), ('一', "yī"), ('起', "qǐ"), ('学', "xué"), ('习', "xí"),
    ('吧', "ba"), ('。', "."), ('，', ","), ('？', "?"), ('！', "!"),
  ])
}
