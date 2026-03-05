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

use rand::seq::SliceRandom;
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

fn hsk_level(difficulty: &str) -> u8 {
    let norm = difficulty.trim().to_lowercase();
    let n = norm
        .strip_prefix("hsk")
        .and_then(|v| v.parse::<u8>().ok())
        .unwrap_or(3);
    n.clamp(1, 6)
}

fn tail_chars(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.trim().to_string();
    }
    chars[chars.len().saturating_sub(max_chars)..]
        .iter()
        .collect::<String>()
        .trim()
        .to_string()
}

fn extract_recent_topic(context_zh: &str) -> String {
    let ctx = context_zh.trim();
    if ctx.is_empty() {
        return String::new();
    }
    let seg = ctx
        .split(|c| matches!(c, '。' | '！' | '？' | '.' | '!' | '?' | '\n' | '；' | ';'))
        .rev()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or("");
    let compact = seg
        .chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '“' && *c != '”')
        .collect::<String>();
    // Keep just a short tail so the guide follows context without overfitting details.
    tail_chars(&compact, 10)
}

fn build_mild_writing_seed(difficulty: &str, context_zh: &str) -> String {
    let level = hsk_level(difficulty);
    let topic = extract_recent_topic(context_zh);
    let mut rng = rand::thread_rng();

    let seed = if topic.is_empty() {
        let options_lvl1 = [
            "可以继续写一个轻松的小场景，发生一件好玩的事。",
            "顺着现在的内容写下去，加一点开心的小变化。",
            "不妨往下写：有个小意外，让气氛更有趣。",
        ];
        let options_lvl2 = [
            "可以继续这个语境，写一个简单又有趣的小情况。",
            "顺着当前内容往下写，让场景更轻松一点。",
            "不妨补一个小变化，让故事更自然。",
        ];
        let options_lvl3 = [
            "可沿着当前语境继续，加入一个轻松有趣的小情境。",
            "顺着现有叙述推进一点，让后文出现自然的小变化。",
            "不妨补一处日常里的小趣味，让文本更生动。",
        ];
        let options_lvl4 = [
            "可以延续现在的语境，加入一个贴近日常的小转折。",
            "顺着当前叙述往下写，让情境多一点画面感。",
            "不妨补一个轻微变化，让后文更顺更有趣。",
        ];
        let options_lvl5 = [
            "可在当前语境里推进一步，加入一个温和而有趣的细节。",
            "顺着叙述继续，让场景自然出现一处小反差。",
            "不妨补一段轻松情境，让文本层次更清楚。",
        ];
        let options_lvl6 = [
            "可延展当前语境，加入一处克制但有趣的情境变化。",
            "顺着现有叙述推进，让后文出现细微而自然的转折。",
            "不妨补一个日常中的巧妙细节，增强整体连贯感。",
        ];
        match level {
            1 => options_lvl1
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl1[0]),
            2 => options_lvl2
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl2[0]),
            3 => options_lvl3
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl3[0]),
            4 => options_lvl4
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl4[0]),
            5 => options_lvl5
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl5[0]),
            _ => options_lvl6
                .choose(&mut rng)
                .copied()
                .unwrap_or(options_lvl6[0]),
        }
        .to_string()
    } else {
        let options_lvl1 = [
            format!("可以接着“{}”写，发生一件轻松的小趣事。", topic),
            format!("顺着“{}”继续，加一点简单又好玩的变化。", topic),
            format!("围绕“{}”往下写，让气氛更开心一点。", topic),
        ];
        let options_lvl2 = [
            format!("可以沿着“{}”继续，加入一个简单的小趣味情境。", topic),
            format!("顺着“{}”写下去，补一个自然的小变化。", topic),
            format!("围绕“{}”推进一点，让后文更顺。", topic),
        ];
        let options_lvl3 = [
            format!("可沿着“{}”继续，加入一个温和有趣的情境发展。", topic),
            format!("顺着“{}”推进后文，补一处轻巧的日常趣味。", topic),
            format!("围绕“{}”延展一小步，让文本更生动。", topic),
        ];
        let options_lvl4 = [
            format!("可以沿着“{}”继续，加入一个贴近日常的小转折。", topic),
            format!("顺着“{}”推进后文，补一点自然的情境变化。", topic),
            format!("围绕“{}”展开一层，让画面更具体。", topic),
        ];
        let options_lvl5 = [
            format!("可围绕“{}”继续，加入一处温和而有趣的细节推进。", topic),
            format!("顺着“{}”往下写，让后文出现轻微但自然的反差。", topic),
            format!("沿着“{}”延展一小段，使语境更完整。", topic),
        ];
        let options_lvl6 = [
            format!("可围绕“{}”继续，加入克制且有趣的情境演进。", topic),
            format!("顺着“{}”推进后文，补一处细微而有效的转折。", topic),
            format!("沿着“{}”延展层次，让表达更连贯也更灵动。", topic),
        ];
        match level {
            1 => options_lvl1
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl1[0].clone()),
            2 => options_lvl2
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl2[0].clone()),
            3 => options_lvl3
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl3[0].clone()),
            4 => options_lvl4
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl4[0].clone()),
            5 => options_lvl5
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl5[0].clone()),
            _ => options_lvl6
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| options_lvl6[0].clone()),
        }
    };

    if seed.ends_with('。') || seed.ends_with('！') || seed.ends_with('？') {
        seed
    } else {
        format!("{seed}。")
    }
}

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
            info!(target: "caatuu_backend", base_url = %oa.base_url, fast_model = %oa.fast_model, writing_model = %oa.writing_model, strong_model = %oa.strong_model, sequence_model = %oa.sequence_model, transcribe_model = %oa.transcribe_model, "OpenAI enabled.");
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

    /// Writing mode guide generation:
    /// produce a mild, context-following seed without strict task constraints.
    #[instrument(
        level = "info",
        skip(self, context_zh),
        fields(%difficulty, context_len = context_zh.len())
    )]
    pub async fn choose_writing_guide(
        &self,
        difficulty: &str,
        context_zh: &str,
    ) -> (Challenge, &'static str) {
        let seed_zh = build_mild_writing_seed(difficulty, context_zh);
        let challenge = Challenge {
            id: Uuid::new_v4().to_string(),
            difficulty: difficulty.to_string(),
            kind: ChallengeKind::FreeformZh,
            source: ChallengeSource::Generated,
            seed_zh: seed_zh.clone(),
            seed_en: String::new(),
            challenge_zh: String::new(),
            challenge_en: String::new(),
            summary_en: "Mild writing guide based on your current text.".to_string(),
            reference_answer_zh: String::new(),
            core_plus_spec: None,
            instructions: format!(
                "Writing guide (difficulty={}): {} Continue the learner text naturally and playfully.",
                difficulty, seed_zh
            ),
            rubric: None,
        };

        // Keep writing guides addressable by id for hints, but don't pollute per-difficulty pools.
        self.by_id
            .write()
            .await
            .insert(challenge.id.clone(), challenge.clone());

        info!(
            target: "challenge",
            %difficulty,
            id = %challenge.id,
            seed_preview = %challenge.seed_zh.chars().take(36).collect::<String>(),
            "Generated writing guide seed"
        );
        (challenge, "writing_guide_local")
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
