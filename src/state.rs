//! Application state: in-memory stores, prompts, OpenAI client, and selection logic.
//!
//! This module owns:
//!   - challenge stores (by id, by difficulty, last-by-difficulty)
//!   - the tiny pinyin dictionary
//!   - the prompts struct (from TOML or defaults)
//!   - optional OpenAI client
//!
//! The selection policy now generates seed+challenge freeform tasks by default.
//! If OpenAI is unavailable, we fall back to built-in seeds or a hard fallback.

use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tracing::{error, info, instrument, warn};

use crate::config::{load_agent_config_from_env, Prompts};
use crate::domain::{Challenge, ChallengeKind, ChallengeSource};
use crate::openai::OpenAI;
use crate::seeds::{hard_fallback_challenge, seed_challenges, seed_pinyin_map};
use uuid::Uuid;

// Keep a small per-difficulty pool of generated items to avoid repeats
#[allow(dead_code)]
const GEN_POOL_TARGET: usize = 3;

#[derive(Clone)]
pub struct AppState {
    pub by_id: Arc<RwLock<HashMap<String, Challenge>>>,
    pub by_diff: Arc<RwLock<HashMap<String, Vec<String>>>>,
    pub last_by_diff: Arc<RwLock<HashMap<String, String>>>,
    #[allow(dead_code)]
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
        let prompts = cfg_opt
            .as_ref()
            .map(|c| c.prompts.clone())
            .unwrap_or_default();

        let mut id_map = HashMap::<String, Challenge>::new();
        let mut diff_map = HashMap::<String, Vec<String>>::new();

        // Insert config-based challenges (if any) – freeform, instructions-driven.
        if let Some(cfg) = &cfg_opt {
            for cc in &cfg.challenges {
                let id = cc.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
                let diff = cc.difficulty.clone();

                let instructions = match &cc.instructions {
                    Some(s) if !s.is_empty() => s.clone(),
                    _ => {
                        // Instructions are optional overall (runtime generation may supply seed+challenge),
                        // but for config-bank entries we require them to be non-empty.
                        error!(target: "challenge", %id, %diff, "Skipping bank item: missing instructions.");
                        continue;
                    }
                };
                let ch = Challenge {
                    id: id.clone(),
                    difficulty: diff.clone(),
                    kind: ChallengeKind::FreeformZh,
                    source: ChallengeSource::LocalBank,

                    seed_zh: String::new(),
                    seed_en: String::new(),
                    challenge_zh: String::new(),
                    challenge_en: String::new(),
                    summary_en: String::new(),
                    reference_answer_zh: String::new(),
                    core_plus_spec: None,

                    instructions,
                    rubric: cc.rubric.clone(),
                };
                diff_map.entry(diff.clone()).or_default().push(id.clone());
                id_map.insert(id, ch);
            }
        }

        // Always insert built-in seeds, but don't overwrite existing ids.
        for c in seed_challenges() {
            let id = c.id.clone();
            diff_map
                .entry(c.difficulty.clone())
                .or_default()
                .push(id.clone());
            id_map.entry(id).or_insert(c);
        }

        // Inventory summary by difficulty/source.
        let mut count_by_diff: HashMap<String, (usize, usize, usize)> = HashMap::new();
        for ch in id_map.values() {
            let entry = count_by_diff
                .entry(ch.difficulty.clone())
                .or_insert((0, 0, 0));
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
            info!(target: "caatuu_backend", base_url = %oa.base_url, fast_model = %oa.fast_model, strong_model = %oa.strong_model, transcribe_model = %oa.transcribe_model, "OpenAI enabled.");
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
    #[allow(dead_code)]
    #[instrument(level = "debug", skip(self, c), fields(id = %c.id))]
    pub async fn ensure_present(&self, c: &Challenge) {
        let exists = { self.by_id.read().await.contains_key(&c.id) };
        if !exists {
            self.insert_challenge(c.clone()).await;
        }
    }

    /// Selection policy:
    /// Generate a fresh seed+challenge freeform via OpenAI when available.
    /// Otherwise, insert a hard fallback.
    #[instrument(level = "info", skip(self), fields(%difficulty))]
    pub async fn choose_challenge(&self, difficulty: &str) -> (Challenge, &'static str) {
        if let Some(oa) = &self.openai {
            match oa
                .generate_challenge_freeform(&self.prompts, difficulty)
                .await
            {
                Ok(mut c) => {
                    c.source = ChallengeSource::Generated;
                    let id = c.id.clone();
                    self.insert_challenge(c.clone()).await;
                    self.last_by_diff
                        .write()
                        .await
                        .insert(difficulty.to_string(), id.clone());
                    info!(target: "challenge", %difficulty, chosen = %id, source = "openai_generated_new", "Generated fresh challenge");
                    return (c, "openai_generated_new");
                }
                Err(e) => {
                    error!(target: "challenge", %difficulty, error = %e, "OpenAI generation failed; using hard fallback");
                }
            }
        } else {
            error!(target: "challenge", %difficulty, "OPENAI_API_KEY not set; trying existing pool then hard fallback");
        }

        // 2) If we already have challenges for this difficulty (local bank or built-in seeds),
        // serve one of them before creating a new hard fallback.
        if let Some(ids) = { self.by_diff.read().await.get(difficulty).cloned() } {
            if !ids.is_empty() {
                let last = { self.last_by_diff.read().await.get(difficulty).cloned() };
                let chosen_id = if ids.len() == 1 {
                    ids[0].clone()
                } else if let Some(last_id) = last {
                    ids.iter()
                        .find(|id| *id != &last_id)
                        .cloned()
                        .unwrap_or_else(|| ids[0].clone())
                } else {
                    ids[0].clone()
                };

                if let Some(ch) = { self.by_id.read().await.get(&chosen_id).cloned() } {
                    self.last_by_diff
                        .write()
                        .await
                        .insert(difficulty.to_string(), chosen_id.clone());
                    warn!(target: "challenge", %difficulty, chosen = %chosen_id, source = "existing_pool", "Serving existing challenge");
                    return (ch, "existing_pool");
                }
            }
        }

        // 3) Absolute last resort: hard fallback.
        let c = hard_fallback_challenge(difficulty.to_string());
        let id = c.id.clone();
        self.insert_challenge(c.clone()).await;
        self.last_by_diff
            .write()
            .await
            .insert(difficulty.to_string(), id.clone());
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
    #[allow(dead_code)]
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
