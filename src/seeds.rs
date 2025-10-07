//! Seed data and small utilities related to default content.

use std::collections::HashMap;
use uuid::Uuid;

use crate::domain::{Challenge, ChallengeKind, ChallengeSource};

/// Minimal set of built-in challenges that guarantee the app
/// is useful even without external config or OpenAI.
pub fn seed_challenges() -> Vec<Challenge> {
  vec![
    Challenge {
      id: "c123".into(),
      difficulty: "hsk3".into(),
      kind: ChallengeKind::ExactZh,
      source: ChallengeSource::Seed,
      zh: "今天天气很好".into(),
      py: "jīn tiān tiān qì hěn hǎo".into(),
      en: "The weather is great today.".into(),
      instructions: String::new(),
      rubric: None,
    },
    Challenge {
      id: "c124".into(),
      difficulty: "hsk2".into(),
      kind: ChallengeKind::ExactZh,
      source: ChallengeSource::Seed,
      zh: "我想喝咖啡".into(),
      py: "wǒ xiǎng hē kā fēi".into(),
      en: "I want to drink coffee.".into(),
      instructions: String::new(),
      rubric: None,
    },
  ]
}

/// Absolute last-resort fallback: if all stores are empty, we inject this.
pub fn hard_fallback_challenge(difficulty: String) -> Challenge {
  Challenge {
    id: Uuid::new_v4().to_string(),
    difficulty,
    kind: ChallengeKind::ExactZh,
    source: ChallengeSource::Seed,
    zh: "他是老师。".into(),
    py: "tā shì lǎo shī 。".into(),
    en: "He is a teacher.".into(),
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
