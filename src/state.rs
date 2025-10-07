//! Application state: in-memory stores, prompts, OpenAI client, and selection logic.
//!
//! This module owns:
//!   - challenge stores (by id, by difficulty, last-by-difficulty)
//!   - the tiny pinyin dictionary
//!   - the prompts struct (from TOML or defaults)
//!   - optional OpenAI client
//!
//! The selection policy favors local content, then generated cache, then seeds,
//! with a simple "avoid immediate repeat" heuristic per difficulty.

use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tracing::{info, error, debug, warn, instrument};

use crate::config::{load_agent_config_from_env, Prompts};
use crate::domain::{Challenge, ChallengeKind, ChallengeSource};
use crate::openai::{OpenAI};
use crate::seeds::{seed_challenges, seed_pinyin_map, hard_fallback_challenge};
use uuid::{Uuid};

// Keep a small per-difficulty pool of generated items to avoid repeats
const GEN_POOL_TARGET: usize = 3;

#[derive(Clone)]
pub struct AppState {
  pub by_id: Arc<RwLock<HashMap<String, Challenge>>>,
  pub by_diff: Arc<RwLock<HashMap<String, Vec<String>>>>,
  pub last_by_diff: Arc<RwLock<HashMap<String, String>>>,
  pub char_pinyin: HashMap<char, &'static str>,
  pub openai: Option<OpenAI>,
  pub prompts: Prompts,
}

impl AppState {
  /// Build state from env: load config, seed challenges, build indices, init OpenAI.
  #[instrument(level = "info", skip_all)]
  pub fn new() -> Self {
    // Load TOML config if provided (prompts + optional local bank).
    let cfg_opt = load_agent_config_from_env();
    let prompts = cfg_opt.as_ref().map(|c| c.prompts.clone()).unwrap_or_default();

    let mut id_map = HashMap::<String, Challenge>::new();
    let mut diff_map = HashMap::<String, Vec<String>>::new();

    // Insert config-based challenges (if any).
    if let Some(cfg) = &cfg_opt {
      for cc in &cfg.challenges {
        let kind = cc.kind.clone().unwrap_or(ChallengeKind::ExactZh);
        let id = cc.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let diff = cc.difficulty.clone();

        let ch = match kind {
          ChallengeKind::ExactZh => {
            let (zh, py, en) = match (&cc.zh, &cc.py, &cc.en) {
              (Some(zh), Some(py), Some(en)) => (zh, py, en),
              _ => {
                error!(target: "challenge", %id, %diff, "Skipping exact_zh: missing zh/py/en.");
                continue;
              }
            };
            Challenge {
              id: id.clone(),
              difficulty: diff.clone(),
              kind,
              source: ChallengeSource::LocalBank,
              zh: zh.clone(),
              py: py.clone(),
              en: en.clone(),
              instructions: String::new(),
              rubric: None,
            }
          }
          ChallengeKind::FreeformZh => {
            let instructions = match &cc.instructions {
              Some(s) if !s.is_empty() => s.clone(),
              _ => {
                error!(target: "challenge", %id, %diff, "Skipping freeform_zh: missing instructions.");
                continue;
              }
            };
            Challenge {
              id: id.clone(),
              difficulty: diff.clone(),
              kind,
              source: ChallengeSource::LocalBank,
              zh: String::new(),
              py: String::new(),
              en: String::new(),
              instructions,
              rubric: cc.rubric.clone(),
            }
          }
        };
        diff_map.entry(diff.clone()).or_default().push(id.clone());
        id_map.insert(id, ch);
      }
    }

    // Always insert built-in seeds, but don't overwrite existing ids.
    for c in seed_challenges() {
      let id = c.id.clone();
      diff_map.entry(c.difficulty.clone()).or_default().push(id.clone());
      id_map.entry(id).or_insert(c);
    }

    // Inventory summary by difficulty/source.
    let mut count_by_diff: HashMap<String, (usize, usize, usize)> = HashMap::new();
    for ch in id_map.values() {
      let entry = count_by_diff.entry(ch.difficulty.clone()).or_insert((0, 0, 0));
      match ch.source {
        ChallengeSource::LocalBank => entry.0 += 1,
        ChallengeSource::Generated => entry.1 += 1,
        ChallengeSource::Seed => entry.2 += 1,
      }
    }
    for (diff, (bank, gen, seed)) in count_by_diff {
      info!(target: "challenge", %diff, local_bank = bank, generated = gen, seed = seed, "Startup challenge inventory");
    }

    // Build optional OpenAI client (if API key present).
    let openai = OpenAI::from_env();
    if let Some(oa) = &openai {
      info!(target: "caatuu_backend", base_url = %oa.base_url, fast_model = %oa.fast_model, strong_model = %oa.strong_model, "OpenAI enabled.");
    } else {
      info!(target: "caatuu_backend", "OpenAI disabled (no OPENAI_API_KEY). Using local/seed logic.");
    }

    Self {
      by_id: Arc::new(RwLock::new(id_map)),
      by_diff: Arc::new(RwLock::new(diff_map)),
      last_by_diff: Arc::new(RwLock::new(HashMap::new())),
      char_pinyin: seed_pinyin_map(),
      openai,
      prompts,
    }
  }

  /// Insert challenge into stores (by_id and by_diff).
  #[instrument(level = "debug", skip(self))]
  pub async fn insert_challenge(&self, c: Challenge) {
    let mut by_id = self.by_id.write().await;
    let mut by_diff = self.by_diff.write().await;
    let id = c.id.clone();
    let diff = c.difficulty.clone();
    by_id.insert(id.clone(), c);
    by_diff.entry(diff).or_default().push(id);
  }

  /// Ensure a challenge is present by id (idempotent).
  #[instrument(level = "debug", skip(self, c), fields(id = %c.id))]
  pub async fn ensure_present(&self, c: &Challenge) {
    let exists = { self.by_id.read().await.contains_key(&c.id) };
    if !exists {
      self.insert_challenge(c.clone()).await;
    }
  }

  /// Selection policy (simplified):
  /// Always generate a fresh challenge via OpenAI (high temperature) and store it,
  /// so subsequent steps (hint/validate) can look it up by ID. If OpenAI is
  /// unavailable or fails, fall back to a tiny built-in hard challenge.
  #[instrument(level = "info", skip(self), fields(%difficulty))]
  pub async fn choose_challenge(&self, difficulty: &str) -> (Challenge, &'static str) {
    if let Some(oa) = &self.openai {
      match oa.generate_challenge_exact(&self.prompts, difficulty).await {
        Ok(mut c) => {
          c.source = ChallengeSource::Generated;
          let id = c.id.clone();
          self.insert_challenge(c.clone()).await;
          self.last_by_diff.write().await.insert(difficulty.to_string(), id.clone());
          info!(target: "challenge", %difficulty, chosen = %id, source = "openai_generated_new", "Generated fresh challenge");
          return (c, "openai_generated_new");
        }
        Err(e) => {
          error!(target: "challenge", %difficulty, error = %e, "OpenAI generation failed; using hard fallback");
        }
      }
    } else {
      error!(target: "challenge", %difficulty, "OPENAI_API_KEY not set; using hard fallback");
    }

    let c = hard_fallback_challenge(difficulty.to_string());
    let id = c.id.clone();
    self.insert_challenge(c.clone()).await;
    self.last_by_diff.write().await.insert(difficulty.to_string(), id.clone());
    warn!(target: "challenge", %difficulty, chosen = %id, source = "hard_fallback", "Inserted hard fallback challenge");
    (c, "hard_fallback")
  }

  /// Read-only access to a challenge by id.
  #[instrument(level = "debug", skip(self), fields(%id))]
  pub async fn get_challenge(&self, id: &str) -> Option<Challenge> {
    let by_id = self.by_id.read().await;
    by_id.get(id).cloned()
  }

  /// Local pinyin conversion using the tiny built-in dictionary + minimal spacing rules.
  #[instrument(level = "debug", skip(self, text), fields(text_len = text.len()))]
  pub fn pinyin_for_text_local(&self, text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
      if let Some(py) = self.char_pinyin.get(&ch) {
        if !out.is_empty() && !out.ends_with(' ') {
          out.push(' ');
        }
        out.push_str(py);
      } else {
        if ch.is_ascii_punctuation() || ch.is_whitespace() {
          out.push(ch);
        } else {
          if !out.is_empty() && !out.ends_with(' ') && crate::util::is_cjk(ch) {
            out.push(' ');
          }
          out.push(ch);
        }
      }
    }
    out.trim().to_string()
  }
}
