//! Core+Core challenge sampling and deterministic validation.
//!
//! Flow:
//! 1) App samples a compact SPEC from large tables (relations/patterns/chains/scenes).
//! 2) SPEC is sent to the model with a strict JSON-only prompt.
//! 3) Model returns `seed_zh`, `challenge_zh`, `reference_answer_zh`, `meta`.
//! 4) App validates structure deterministically before accepting.

use std::collections::HashSet;

use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};

const VERSION: &str = "core_plus_core.zh.v2";
const LANGUAGE: &str = "zh";
const MODE: &str = "core_plus_core";

const REL_ADDITION: &str = "ADDITION";
const REL_CHOICE: &str = "CHOICE";
const REL_CONTRAST: &str = "CONTRAST";
const REL_CAUSE: &str = "CAUSE";
const REL_RESULT: &str = "RESULT";
const REL_CONDITION: &str = "CONDITION";
const REL_TIME: &str = "TIME";
const REL_PURPOSE: &str = "PURPOSE";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CorePlusSpec {
  pub version: String,
  pub language: String,
  pub mode: String,

  pub chain_id: String,
  pub chain_step1_relation: String,
  pub chain_step2_relation: String,
  pub scene_id: String,
  pub scene_schema: String,

  pub step1: CorePlusSpecStep,
  pub step2: CorePlusSpecStep,

  pub seed: String,
  pub props: CorePlusProps,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CorePlusSpecStep {
  pub relation: String,
  pub pattern_id: String,
  pub pattern_tpl: String,
  pub markers_zh: String,
  pub kind: String,
  pub level: u8,
  pub check_regex: String,
  pub strong_markers: Vec<String>,
  pub weak_markers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CorePlusProps {
  #[serde(rename = "P1")]
  pub p1: String,
  #[serde(rename = "P2")]
  pub p2: String,
  #[serde(rename = "P3")]
  pub p3: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CorePlusGeneratedItem {
  pub seed_zh: String,
  #[serde(rename = "challenge_zh")]
  pub _challenge_zh: String,
  pub reference_answer_zh: String,
  #[serde(default, rename = "meta")]
  pub _meta: serde_json::Value,
}

pub const CORE_PLUS_CORE_SYSTEM_PROMPT: &str = r#"
You are a Chinese learning item generator.
You MUST follow the provided SPEC exactly.

Return ONLY strict JSON with keys:
  seed_zh, challenge_zh, reference_answer_zh, meta

Rules:
- Use SPEC.seed as seed_zh verbatim.
- Do NOT add any new facts. Use ONLY P1, P2, P3 from SPEC.props.
- Use P1, P2, P3 verbatim (no paraphrasing / no synonym replacement).
- The learner must rewrite using TWO patterns:
  - Sentence 1 must connect P1 and P2 using SPEC.step1.pattern_tpl
  - Sentence 2 must connect P2 and P3 using SPEC.step2.pattern_tpl
- reference_answer_zh format must be EXACTLY two sentences separated by ONE '。'
  - Sentence1 = apply step1 template with (A=P1, B=P2)
  - Sentence2 = apply step2 template with (A=P2, B=P3)
  - Output: "<Sentence1>。<Sentence2>"  (NO extra '。' at the end)
- challenge_zh must clearly instruct:
  - which TWO connector patterns to use, by showing SPEC.step1.markers_zh and SPEC.step2.markers_zh
  - "只写两句" (two sentences only)
- meta must include at minimum:
  chain_id, scene_id, step1.pattern_id, step2.pattern_id, step1.relation, step2.relation, version
"#;

pub fn build_core_plus_core_user_message(spec: &CorePlusSpec) -> Result<String, String> {
  let spec_json = serde_json::to_string(spec).map_err(|e| format!("Failed to serialize SPEC: {e}"))?;
  Ok(format!("SPEC_JSON:\n{spec_json}"))
}

pub fn build_expected_reference_answer(spec: &CorePlusSpec) -> String {
  let s1 = render_template_ab(&spec.step1.pattern_tpl, &spec.props.p1, &spec.props.p2);
  let s2 = render_template_ab(&spec.step2.pattern_tpl, &spec.props.p2, &spec.props.p3);
  format!("{}。{}", trim_sentence_trailing_punct(&s1), trim_sentence_trailing_punct(&s2))
}

pub fn build_compact_challenge_zh(spec: &CorePlusSpec) -> String {
  format!(
    "用“{}”和“{}”，只写两句。",
    spec.step1.markers_zh, spec.step2.markers_zh
  )
}

pub fn sample_core_plus_core_spec(difficulty: &str, max_tries: usize) -> Result<CorePlusSpec, String> {
  let mut rng = rand::thread_rng();
  let target_level_max = difficulty_to_target_level(difficulty);

  for _ in 0..max_tries {
    let chain = CHAIN_PATTERNS
      .choose(&mut rng)
      .ok_or_else(|| "No chain patterns configured".to_string())?;
    if !chain_matches_difficulty(chain, target_level_max) {
      continue;
    }

    let step1_pool: Vec<&PatternDef> = patterns_for_relation(chain.step1)
      .iter()
      .filter(|p| p.level <= target_level_max)
      .collect();
    let step2_pool: Vec<&PatternDef> = patterns_for_relation(chain.step2)
      .iter()
      .filter(|p| p.level <= target_level_max)
      .collect();
    if step1_pool.is_empty() || step2_pool.is_empty() {
      continue;
    }

    let step1_pat = step1_pool.choose(&mut rng).copied().unwrap_or(step1_pool[0]);
    let step2_pat = step2_pool.choose(&mut rng).copied().unwrap_or(step2_pool[0]);

    let scene_pool: Vec<&SceneDef> = SCENES
      .iter()
      .filter(|s| s.schema == chain.scene_schema)
      .collect();
    if scene_pool.is_empty() {
      continue;
    }
    let scene = scene_pool.choose(&mut rng).copied().unwrap_or(scene_pool[0]);

    let p1 = scene.slots[0].to_string();
    let p2 = scene.slots[1].to_string();
    let p3 = scene.slots[2].to_string();
    if !scene_matches_difficulty(&p1, &p2, &p3, target_level_max) {
      continue;
    }
    let seed_text = p1.clone();

    let banned: HashSet<&str> = step1_pat
      .seed_banned
      .iter()
      .chain(step2_pat.seed_banned.iter())
      .copied()
      .collect();
    if contains_any(&seed_text, &banned) {
      continue;
    }

    return Ok(CorePlusSpec {
      version: VERSION.to_string(),
      language: LANGUAGE.to_string(),
      mode: MODE.to_string(),
      chain_id: chain.id.to_string(),
      chain_step1_relation: chain.step1.to_string(),
      chain_step2_relation: chain.step2.to_string(),
      scene_id: scene.id.to_string(),
      scene_schema: scene.schema.to_string(),
      step1: to_spec_step(chain.step1, step1_pat),
      step2: to_spec_step(chain.step2, step2_pat),
      seed: seed_text,
      props: CorePlusProps { p1, p2, p3 },
    });
  }

  Err("SAMPLE_COREPLUSCORE_SPEC: failed to sample a valid SPEC within max_tries".into())
}

pub fn validate_generated_item(spec: &CorePlusSpec, item: &CorePlusGeneratedItem) -> Result<(), String> {
  if item.seed_zh.trim() != spec.seed.trim() {
    return Err("seed_zh does not match SPEC.seed exactly".into());
  }

  let expected_ref = build_expected_reference_answer(spec);
  let (got_s1, got_s2) = split_two_sentences(&item.reference_answer_zh)
    .ok_or_else(|| "reference_answer_zh must contain exactly two sentences".to_string())?;
  let (exp_s1, exp_s2) = split_two_sentences(&expected_ref)
    .ok_or_else(|| "Internal error: expected reference split failed".to_string())?;

  if normalize_for_compare(&got_s1) != normalize_for_compare(&exp_s1)
    || normalize_for_compare(&got_s2) != normalize_for_compare(&exp_s2)
  {
    return Err("reference_answer_zh did not apply templates exactly to P1/P2/P3".into());
  }

  validate_sentence(&spec.step1, &got_s1, &spec.props.p1, &spec.props.p2)
    .map_err(|e| format!("reference sentence1 invalid: {e}"))?;
  validate_sentence(&spec.step2, &got_s2, &spec.props.p2, &spec.props.p3)
    .map_err(|e| format!("reference sentence2 invalid: {e}"))?;

  Ok(())
}

pub fn evaluate_core_plus_core_answer(spec: &CorePlusSpec, user_answer: &str) -> (bool, f32, String) {
  let answer = user_answer.trim();
  if answer.is_empty() {
    return (false, 0.0, "答案为空。请按要求只写两句。".into());
  }

  let mut score = 100.0_f32;
  let mut notes: Vec<String> = vec![];

  let (s1, s2) = match split_two_sentences(answer) {
    Some(v) => v,
    None => {
      score -= 40.0;
      notes.push("格式错误：需要正好两句（用句号分隔）".into());
      let fallback = answer.to_string();
      (fallback.clone(), fallback)
    }
  };

  if let Err(e) = validate_sentence_pattern_only(&spec.step1, &s1) {
    score -= 25.0;
    notes.push(format!("第1句不符合要求：{e}"));
  }
  if let Err(e) = validate_sentence_pattern_only(&spec.step2, &s2) {
    score -= 25.0;
    notes.push(format!("第2句不符合要求：{e}"));
  }

  let seed_phrase = trim_sentence_trailing_punct(&spec.seed);
  if !seed_phrase.is_empty() && !answer.contains(&seed_phrase) {
    score -= 15.0;
    notes.push("内容未围绕种子短语".into());
  }

  if contains_any_marker(&s1, &spec.step2.strong_markers) {
    score -= 8.0;
    notes.push("第1句混入了第2步连接标记".into());
  }
  if contains_any_marker(&s2, &spec.step1.strong_markers) {
    score -= 8.0;
    notes.push("第2句混入了第1步连接标记".into());
  }

  if score < 0.0 {
    score = 0.0;
  }
  if score > 100.0 {
    score = 100.0;
  }
  let correct = score >= 60.0;

  let explanation = if notes.is_empty() {
    "结构正确：两句都满足连接词模式，并围绕种子短语展开。".to_string()
  } else {
    format!("{}。", notes.join("；"))
  };

  (correct, score, explanation)
}

fn validate_sentence(step: &CorePlusSpecStep, sentence: &str, expected_a: &str, expected_b: &str) -> Result<(), String> {
  if !sentence.contains(expected_a) {
    return Err(format!("缺少命题片段A：'{expected_a}'"));
  }
  if !sentence.contains(expected_b) {
    return Err(format!("缺少命题片段B：'{expected_b}'"));
  }
  for marker in &step.strong_markers {
    if !marker.is_empty() && !sentence.contains(marker) {
      return Err(format!("缺少强标记：'{marker}'"));
    }
  }

  if !simple_regex_like_match(&step.check_regex, sentence) {
    return Err(format!("句式不匹配模式 {}", step.markers_zh));
  }

  Ok(())
}

fn validate_sentence_pattern_only(step: &CorePlusSpecStep, sentence: &str) -> Result<(), String> {
  for marker in &step.strong_markers {
    if !marker.is_empty() && !sentence.contains(marker) {
      return Err(format!("缺少强标记：'{marker}'"));
    }
  }

  if !simple_regex_like_match(&step.check_regex, sentence) {
    return Err(format!("句式不匹配模式 {}", step.markers_zh));
  }

  Ok(())
}

fn split_two_sentences(text: &str) -> Option<(String, String)> {
  let canonical = text
    .trim()
    .chars()
    .map(|c| match c {
      '!' | '！' | '?' | '？' => '。',
      _ => c,
    })
    .collect::<String>();

  let without_tail = canonical
    .trim_end_matches(|c: char| c == '。' || c == '.' || c == '!' || c == '！' || c == '?' || c == '？')
    .trim()
    .to_string();

  let parts: Vec<String> = without_tail
    .split('。')
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .collect();

  if parts.len() != 2 {
    return None;
  }
  Some((parts[0].clone(), parts[1].clone()))
}

fn normalize_for_compare(s: &str) -> String {
  s.chars().filter(|c| !c.is_whitespace()).collect::<String>()
}

fn trim_sentence_trailing_punct(s: &str) -> String {
  s.trim()
    .trim_end_matches(|c: char| c == '。' || c == '.' || c == '!' || c == '！' || c == '?' || c == '？')
    .trim()
    .to_string()
}

fn render_template_ab(tpl: &str, a: &str, b: &str) -> String {
  tpl.replace("{A}", a).replace("{B}", b)
}

// The pattern table uses only a tiny regex subset:
// - optional ^ and $
// - one or more `.+` wildcards between literal chunks
fn simple_regex_like_match(pattern: &str, text: &str) -> bool {
  let mut p = pattern.trim();
  let anchored_start = p.starts_with('^');
  let anchored_end = p.ends_with('$');
  if anchored_start {
    p = &p[1..];
  }
  if anchored_end && !p.is_empty() {
    p = &p[..p.len() - 1];
  }

  let starts_with_wild = p.starts_with(".+");
  let ends_with_wild = p.ends_with(".+");
  let parts: Vec<&str> = p.split(".+").collect();

  if parts.iter().all(|x| x.is_empty()) {
    return !text.is_empty();
  }

  let mut search_from = 0usize;
  let mut first_literal_seen = false;
  let mut last_match_end = 0usize;

  for part in &parts {
    if part.is_empty() {
      continue;
    }

    if !first_literal_seen {
      first_literal_seen = true;
      if anchored_start && !starts_with_wild {
        if !text[search_from..].starts_with(part) {
          return false;
        }
        last_match_end = search_from + part.len();
        search_from = last_match_end;
        continue;
      }
    }

    if let Some(found_at) = text[search_from..].find(part) {
      let absolute = search_from + found_at;
      last_match_end = absolute + part.len();
      search_from = last_match_end;
    } else {
      return false;
    }
  }

  if anchored_end && !ends_with_wild {
    return last_match_end == text.len();
  }
  true
}

fn contains_any(text: &str, tokens: &HashSet<&str>) -> bool {
  tokens.iter().any(|t| !t.is_empty() && text.contains(*t))
}

fn contains_any_marker(text: &str, markers: &[String]) -> bool {
  markers.iter().any(|m| !m.is_empty() && text.contains(m))
}

fn to_spec_step(relation: &str, p: &PatternDef) -> CorePlusSpecStep {
  CorePlusSpecStep {
    relation: relation.to_string(),
    pattern_id: p.id.to_string(),
    pattern_tpl: p.tpl.to_string(),
    markers_zh: p.markers_zh.to_string(),
    kind: p.kind.to_string(),
    level: p.level,
    check_regex: p.check_regex.to_string(),
    strong_markers: p.strong_markers.iter().map(|s| (*s).to_string()).collect(),
    weak_markers: p.weak_markers.iter().map(|s| (*s).to_string()).collect(),
  }
}

fn difficulty_to_target_level(difficulty: &str) -> u8 {
  let norm = difficulty.trim().to_lowercase();
  let n = norm
    .strip_prefix("hsk")
    .and_then(|v| v.parse::<u8>().ok())
    .unwrap_or(3);
  match n {
    0..=2 => 1,
    3..=4 => 2,
    _ => 3,
  }
}

fn chain_matches_difficulty(chain: &ChainPatternDef, target_level_max: u8) -> bool {
  if target_level_max <= 1 {
    return matches!(
      chain.scene_schema,
      "reason_outcome_followup"
        | "condition_outcome_followup"
        | "time_event_outcome"
        | "fact1_fact2_inference"
        | "action_goal_effect"
    );
  }
  if target_level_max == 2 {
    return !matches!(chain.scene_schema, "condition_expected_surprise");
  }
  true
}

fn scene_matches_difficulty(p1: &str, p2: &str, p3: &str, target_level_max: u8) -> bool {
  let c1 = p1.chars().count();
  let c2 = p2.chars().count();
  let c3 = p3.chars().count();
  let total = c1 + c2 + c3;
  let joined = format!("{p1}{p2}{p3}");
  let level3_plus_tokens = [
    "预算", "关键", "缓存", "样品", "实验", "汇报", "沟通", "效率", "截止", "省电模式", "热点",
    "发车时间", "提纲", "数据", "分析", "资料", "被迫", "偏偏", "狼狈", "越来越熟练",
  ];
  let level2_plus_tokens = [
    "整理", "路线", "静音", "消息提醒", "待办", "拖到明天", "几乎没有休息时间", "后面的安排",
    "干脆", "省了不少时间", "只好",
  ];

  if target_level_max <= 1 {
    if c1 > 12 || c2 > 12 || c3 > 12 || total > 32 {
      return false;
    }
    if level3_plus_tokens.iter().any(|t| joined.contains(t)) {
      return false;
    }
    if level2_plus_tokens.iter().any(|t| joined.contains(t)) {
      return false;
    }
  } else if target_level_max == 2 {
    if c1 > 16 || c2 > 16 || c3 > 16 || total > 44 {
      return false;
    }
    if level3_plus_tokens.iter().any(|t| joined.contains(t)) {
      return false;
    }
  }

  true
}

fn patterns_for_relation(relation: &str) -> &'static [PatternDef] {
  match relation {
    REL_CAUSE => PATTERNS_CAUSE,
    REL_RESULT => PATTERNS_RESULT,
    REL_CONDITION => PATTERNS_CONDITION,
    REL_CONTRAST => PATTERNS_CONTRAST,
    REL_TIME => PATTERNS_TIME,
    REL_PURPOSE => PATTERNS_PURPOSE,
    REL_ADDITION => PATTERNS_ADDITION,
    REL_CHOICE => PATTERNS_CHOICE,
    _ => &[],
  }
}

#[derive(Clone, Copy)]
struct PatternDef {
  id: &'static str,
  level: u8,
  kind: &'static str, // "PAIR" | "SINGLE"
  tpl: &'static str,
  markers_zh: &'static str,
  strong_markers: &'static [&'static str],
  weak_markers: &'static [&'static str],
  seed_banned: &'static [&'static str],
  check_regex: &'static str,
}

#[derive(Clone, Copy)]
struct ChainPatternDef {
  id: &'static str,
  step1: &'static str,
  step2: &'static str,
  scene_schema: &'static str,
}

#[derive(Clone, Copy)]
struct SceneDef {
  id: &'static str,
  schema: &'static str,
  slots: [&'static str; 3],
}

macro_rules! pat {
  ($id:expr, $level:expr, $kind:expr, $tpl:expr, $markers:expr, $strong:expr, $weak:expr, $banned:expr, $regex:expr) => {
    PatternDef {
      id: $id,
      level: $level,
      kind: $kind,
      tpl: $tpl,
      markers_zh: $markers,
      strong_markers: $strong,
      weak_markers: $weak,
      seed_banned: $banned,
      check_regex: $regex,
    }
  };
}

macro_rules! scene {
  ($id:expr, $schema:expr, $p1:expr, $p2:expr, $p3:expr) => {
    SceneDef {
      id: $id,
      schema: $schema,
      slots: [$p1, $p2, $p3],
    }
  };
}

const PATTERNS_CAUSE: &[PatternDef] = &[
  pat!("zh_pat__cause__yinwei_suoyi__pair__l1", 1, "PAIR", "因为{A}，所以{B}", "因为…所以…", &["因为", "所以"], &[], &["因为", "所以"], r"^因为.+，所以.+$"),
  pat!("zh_pat__cause__youyu_yinci__pair__l2", 2, "PAIR", "由于{A}，因此{B}", "由于…因此…", &["由于", "因此"], &[], &["由于", "因此"], r"^由于.+，因此.+$"),
  pat!("zh_pat__cause__jiran_jiu__pair__l2", 2, "PAIR", "既然{A}，就{B}", "既然…就…", &["既然"], &["就"], &["既然"], r"^既然.+，就.+$"),
  pat!("zh_pat__cause__yinwei_only__single__l1", 1, "SINGLE", "因为{A}，{B}", "因为…", &["因为"], &[], &["因为"], r"^因为.+，.+$"),
  pat!("zh_pat__cause__youyu_only__single__l2", 2, "SINGLE", "由于{A}，{B}", "由于…", &["由于"], &[], &["由于"], r"^由于.+，.+$"),
  pat!("zh_pat__cause__zhengyinwei__single__l3", 3, "SINGLE", "正因为{A}，{B}", "正因为…", &["正因为"], &[], &["正因为"], r"^正因为.+，.+$"),
  pat!("zh_pat__cause__b_shiyinwei_a__single__l2", 2, "SINGLE", "{B}，是因为{A}", "…是因为…", &["是因为"], &[], &["是因为"], r"^.+，是因为.+$"),
  pat!("zh_pat__cause__zhisuoyi_shiyinwei__pair__l2", 2, "PAIR", "之所以{B}，是因为{A}", "之所以…是因为…", &["之所以", "是因为"], &[], &["之所以", "是因为"], r"^之所以.+，是因为.+$"),
  pat!("zh_pat__cause__yuanyin_zaiyu__single__l3", 3, "SINGLE", "{B}的原因在于{A}", "…的原因在于…", &["原因在于"], &[], &["原因在于"], r"^.+的原因在于.+$"),
  pat!("zh_pat__cause__daozhi__single__l2", 2, "SINGLE", "{A}，导致{B}", "导致…", &["导致"], &[], &["导致"], r"^.+，导致.+$"),
  pat!("zh_pat__cause__shide__single__l2", 2, "SINGLE", "{A}，使得{B}", "使得…", &["使得"], &[], &["使得"], r"^.+，使得.+$"),
];

const PATTERNS_RESULT: &[PatternDef] = &[
  pat!("zh_pat__result__suoyi__single__l1", 1, "SINGLE", "{A}，所以{B}", "所以…", &["所以"], &[], &["所以"], r"^.+，所以.+$"),
  pat!("zh_pat__result__yinci__single__l1", 1, "SINGLE", "{A}，因此{B}", "因此…", &["因此"], &[], &["因此"], r"^.+，因此.+$"),
  pat!("zh_pat__result__yiner__single__l2", 2, "SINGLE", "{A}，因而{B}", "因而…", &["因而"], &[], &["因而"], r"^.+，因而.+$"),
  pat!("zh_pat__result__yushi__single__l1", 1, "SINGLE", "{A}，于是{B}", "于是…", &["于是"], &[], &["于是"], r"^.+，于是.+$"),
  pat!("zh_pat__result__jieguo__single__l1", 1, "SINGLE", "{A}，结果{B}", "结果…", &["结果"], &[], &["结果"], r"^.+，结果.+$"),
  pat!("zh_pat__result__jieguo_shi__single__l2", 2, "SINGLE", "{A}，结果是{B}", "结果是…", &["结果是"], &[], &["结果是"], r"^.+，结果是.+$"),
  pat!("zh_pat__result__conger__single__l3", 3, "SINGLE", "{A}，从而{B}", "从而…", &["从而"], &[], &["从而"], r"^.+，从而.+$"),
  pat!("zh_pat__result__jin_er__single__l3", 3, "SINGLE", "{A}，进而{B}", "进而…", &["进而"], &[], &["进而"], r"^.+，进而.+$"),
  pat!("zh_pat__result__yizhiyu__single__l3", 3, "SINGLE", "{A}，以至于{B}", "以至于…", &["以至于"], &[], &["以至于"], r"^.+，以至于.+$"),
];

const PATTERNS_CONDITION: &[PatternDef] = &[
  pat!("zh_pat__cond__ruguo_jiu__pair__l1", 1, "PAIR", "如果{A}，就{B}", "如果…就…", &["如果"], &["就"], &["如果"], r"^如果.+，就.+$"),
  pat!("zh_pat__cond__yaoshi_jiu__pair__l1", 1, "PAIR", "要是{A}，就{B}", "要是…就…", &["要是"], &["就"], &["要是"], r"^要是.+，就.+$"),
  pat!("zh_pat__cond__jiaru_jiu__pair__l2", 2, "PAIR", "假如{A}，就{B}", "假如…就…", &["假如"], &["就"], &["假如"], r"^假如.+，就.+$"),
  pat!("zh_pat__cond__zhiyao_jiu__pair__l1", 1, "PAIR", "只要{A}，就{B}", "只要…就…", &["只要"], &["就"], &["只要"], r"^只要.+，就.+$"),
  pat!("zh_pat__cond__zhiyou_cai__pair__l2", 2, "PAIR", "只有{A}，才{B}", "只有…才…", &["只有"], &["才"], &["只有"], r"^只有.+，才.+$"),
  pat!("zh_pat__cond__chufei_fouze__pair__l2", 2, "PAIR", "除非{A}，否则{B}", "除非…否则…", &["除非", "否则"], &[], &["除非", "否则"], r"^除非.+，否则.+$"),
  pat!("zh_pat__cond__a_dehua_b__single__l2", 2, "SINGLE", "{A}的话，{B}", "…的话…", &["的话"], &[], &["的话"], r"^.+的话，.+$"),
  pat!("zh_pat__cond__fouze__single__l2", 2, "SINGLE", "{A}，否则{B}", "否则…", &["否则"], &[], &["否则"], r"^.+，否则.+$"),
  pat!("zh_pat__cond__qingkuangxia__single__l3", 3, "SINGLE", "在{A}的情况下，{B}", "在…的情况下…", &["情况下"], &[], &["情况下"], r"^在.+的情况下，.+$"),
];

const PATTERNS_CONTRAST: &[PatternDef] = &[
  pat!("zh_pat__contrast__suiran_danshi__pair__l1", 1, "PAIR", "虽然{A}，但是{B}", "虽然…但是…", &["虽然", "但是"], &[], &["虽然", "但是"], r"^虽然.+，但是.+$"),
  pat!("zh_pat__contrast__suiran_dan__pair__l2", 2, "PAIR", "虽然{A}，但{B}", "虽然…但…", &["虽然"], &["但"], &["虽然"], r"^虽然.+，但.+$"),
  pat!("zh_pat__contrast__jinguan_dan__pair__l2", 2, "PAIR", "尽管{A}，但{B}", "尽管…但…", &["尽管"], &["但"], &["尽管"], r"^尽管.+，但.+$"),
  pat!("zh_pat__contrast__jinguan_rengran__pair__l3", 3, "PAIR", "尽管{A}，仍然{B}", "尽管…仍然…", &["尽管", "仍然"], &[], &["尽管", "仍然"], r"^尽管.+，仍然.+$"),
  pat!("zh_pat__contrast__a_buguo_b__single__l1", 1, "SINGLE", "{A}，不过{B}", "不过…", &["不过"], &[], &["不过"], r"^.+，不过.+$"),
  pat!("zh_pat__contrast__a_keshi_b__single__l1", 1, "SINGLE", "{A}，可是{B}", "可是…", &["可是"], &[], &["可是"], r"^.+，可是.+$"),
  pat!("zh_pat__contrast__a_ran'er_b__single__l2", 2, "SINGLE", "{A}，然而{B}", "然而…", &["然而"], &[], &["然而"], r"^.+，然而.+$"),
  pat!("zh_pat__contrast__a_que_b__single__l2", 2, "SINGLE", "{A}，却{B}", "却…", &["却"], &[], &["却"], r"^.+，却.+$"),
  pat!("zh_pat__contrast__a_faner_b__single__l3", 3, "SINGLE", "{A}，反而{B}", "反而…", &["反而"], &[], &["反而"], r"^.+，反而.+$"),
  pat!("zh_pat__contrast__biaomianshang_qishi__pair__l3", 3, "PAIR", "表面上{A}，其实{B}", "表面上…其实…", &["表面上", "其实"], &[], &["表面上", "其实"], r"^表面上.+，其实.+$"),
  pat!("zh_pat__contrast__yifangmian_lingyifangmian__pair__l3", 3, "PAIR", "一方面{A}，另一方面{B}", "一方面…另一方面…", &["一方面", "另一方面"], &[], &["一方面", "另一方面"], r"^一方面.+，另一方面.+$"),
];

const PATTERNS_TIME: &[PatternDef] = &[
  pat!("zh_pat__time__dang_shi__single__l1", 1, "SINGLE", "当{A}的时候，{B}", "当…的时候…", &["当"], &[], &["当"], r"^当.+的时候，.+$"),
  pat!("zh_pat__time__zai_shi__single__l2", 2, "SINGLE", "在{A}的时候，{B}", "在…的时候…", &["在"], &[], &[], r"^在.+的时候，.+$"),
  pat!("zh_pat__time__a_yihou_b__single__l1", 1, "SINGLE", "{A}以后，{B}", "…以后…", &["以后"], &[], &["以后"], r"^.+以后，.+$"),
  pat!("zh_pat__time__a_zhihou_b__single__l1", 1, "SINGLE", "{A}之后，{B}", "…之后…", &["之后"], &[], &["之后"], r"^.+之后，.+$"),
  pat!("zh_pat__time__a_zhiqian_b__single__l1", 1, "SINGLE", "{A}之前，{B}", "…之前…", &["之前"], &[], &["之前"], r"^.+之前，.+$"),
  pat!("zh_pat__time__cong_kaishi__single__l2", 2, "SINGLE", "从{A}开始，{B}", "从…开始…", &["开始"], &[], &["开始"], r"^从.+开始，.+$"),
  pat!("zh_pat__time__zicong_yihou__single__l3", 3, "SINGLE", "自从{A}以后，{B}", "自从…以后…", &["自从", "以后"], &[], &["自从", "以后"], r"^自从.+以后，.+$"),
  pat!("zh_pat__time__suizhe__single__l3", 3, "SINGLE", "随着{A}，{B}", "随着…", &["随着"], &[], &["随着"], r"^随着.+，.+$"),
  pat!("zh_pat__time__meidang__single__l3", 3, "SINGLE", "每当{A}，{B}", "每当…", &["每当"], &[], &["每当"], r"^每当.+，.+$"),
];

const PATTERNS_PURPOSE: &[PatternDef] = &[
  pat!("zh_pat__purpose__weile__single__l1", 1, "SINGLE", "为了{B}，{A}", "为了…", &["为了"], &[], &["为了"], r"^为了.+，.+$"),
  pat!("zh_pat__purpose__a_weile_b__single__l1", 1, "SINGLE", "{A}，为了{B}", "…为了…", &["为了"], &[], &["为了"], r"^.+，为了.+$"),
  pat!("zh_pat__purpose__yibian__single__l2", 2, "SINGLE", "{A}，以便{B}", "以便…", &["以便"], &[], &["以便"], r"^.+，以便.+$"),
  pat!("zh_pat__purpose__haorang__single__l2", 2, "SINGLE", "{A}，好让{B}", "好让…", &["好让"], &[], &["好让"], r"^.+，好让.+$"),
  pat!("zh_pat__purpose__weideshi__single__l2", 2, "SINGLE", "{A}，为的是{B}", "为的是…", &["为的是"], &[], &["为的是"], r"^.+，为的是.+$"),
  pat!("zh_pat__purpose__mian_de__single__l3", 3, "SINGLE", "{A}，免得{B}", "免得…", &["免得"], &[], &["免得"], r"^.+，免得.+$"),
  pat!("zh_pat__purpose__yimian__single__l3", 3, "SINGLE", "{A}，以免{B}", "以免…", &["以免"], &[], &["以免"], r"^.+，以免.+$"),
  pat!("zh_pat__purpose__weib_qijian__single__l3", 3, "SINGLE", "为{B}起见，{A}", "为…起见…", &["起见"], &[], &["起见"], r"^为.+起见，.+$"),
];

const PATTERNS_ADDITION: &[PatternDef] = &[
  pat!("zh_pat__add__budan_erqie__pair__l2", 2, "PAIR", "不但{A}，而且{B}", "不但…而且…", &["不但", "而且"], &[], &["不但", "而且"], r"^不但.+，而且.+$"),
  pat!("zh_pat__add__buji_hai__pair__l1", 1, "PAIR", "不仅{A}，还{B}", "不仅…还…", &["不仅"], &["还"], &["不仅"], r"^不仅.+，还.+$"),
  pat!("zh_pat__add__a_erqie_b__single__l1", 1, "SINGLE", "{A}，而且{B}", "而且…", &["而且"], &[], &["而且"], r"^.+，而且.+$"),
  pat!("zh_pat__add__a_bingqie_b__single__l2", 2, "SINGLE", "{A}，并且{B}", "并且…", &["并且"], &[], &["并且"], r"^.+，并且.+$"),
  pat!("zh_pat__add__a_tongshi_b__single__l2", 2, "SINGLE", "{A}，同时{B}", "同时…", &["同时"], &[], &["同时"], r"^.+，同时.+$"),
  pat!("zh_pat__add__a_yebing_b__single__l1", 1, "SINGLE", "{A}，也{B}", "也…", &[], &["也"], &[], r"^.+，也.+$"),
  pat!("zh_pat__add__chule_hai__pair__l3", 3, "PAIR", "除了{A}以外，还{B}", "除了…以外，还…", &["除了"], &["还"], &["除了"], r"^除了.+以外，还.+$"),
];

const PATTERNS_CHOICE: &[PatternDef] = &[
  pat!("zh_pat__choice__yaome_yaome__pair__l1", 1, "PAIR", "要么{A}，要么{B}", "要么…要么…", &["要么"], &[], &["要么"], r"^要么.+，要么.+$"),
  pat!("zh_pat__choice__huozhe_huozhe__pair__l2", 2, "PAIR", "或者{A}，或者{B}", "或者…或者…", &["或者"], &[], &["或者"], r"^或者.+，或者.+$"),
  pat!("zh_pat__choice__bushi_jiushi__pair__l2", 2, "PAIR", "不是{A}，就是{B}", "不是…就是…", &["不是", "就是"], &[], &["不是", "就是"], r"^不是.+，就是.+$"),
  pat!("zh_pat__choice__a_huozhe_b__single__l1", 1, "SINGLE", "{A}，或者{B}", "或者…", &["或者"], &[], &["或者"], r"^.+，或者.+$"),
  pat!("zh_pat__choice__yuqi_buru__pair__l3", 3, "PAIR", "与其{A}，不如{B}", "与其…不如…", &["与其", "不如"], &[], &["与其", "不如"], r"^与其.+，不如.+$"),
  pat!("zh_pat__choice__ningke_yebu__pair__l3", 3, "PAIR", "宁可{A}，也不{B}", "宁可…也不…", &["宁可"], &["也不"], &["宁可"], r"^宁可.+，也不.+$"),
];

const CHAIN_PATTERNS: &[ChainPatternDef] = &[
  ChainPatternDef { id: "zh_chain__cause_to_result__v1", step1: REL_CAUSE, step2: REL_RESULT, scene_schema: "reason_outcome_followup" },
  ChainPatternDef { id: "zh_chain__condition_to_result__v1", step1: REL_CONDITION, step2: REL_RESULT, scene_schema: "condition_outcome_followup" },
  ChainPatternDef { id: "zh_chain__time_to_result__v1", step1: REL_TIME, step2: REL_RESULT, scene_schema: "time_event_outcome" },
  ChainPatternDef { id: "zh_chain__contrast_to_result__v1", step1: REL_CONTRAST, step2: REL_RESULT, scene_schema: "expectation_actual_consequence" },
  ChainPatternDef { id: "zh_chain__choice_to_condition__v1", step1: REL_CHOICE, step2: REL_CONDITION, scene_schema: "optionA_optionB_then_rule" },
  ChainPatternDef { id: "zh_chain__addition_to_result__v1", step1: REL_ADDITION, step2: REL_RESULT, scene_schema: "fact1_fact2_inference" },
  ChainPatternDef { id: "zh_chain__purpose_to_result__v1", step1: REL_PURPOSE, step2: REL_RESULT, scene_schema: "action_goal_effect" },
  ChainPatternDef { id: "zh_chain__time_to_contrast__v1", step1: REL_TIME, step2: REL_CONTRAST, scene_schema: "time_then_now_contrast" },
  ChainPatternDef { id: "zh_chain__condition_to_contrast__v1", step1: REL_CONDITION, step2: REL_CONTRAST, scene_schema: "condition_expected_surprise" },
];

const SCENES: &[SceneDef] = &[
  scene!("zh_scene__study_sleep__v1", "reason_outcome_followup", "我没睡够", "我还是把笔记整理完了", "第二天上课更轻松了"),
  scene!("zh_scene__work_wifi__v1", "reason_outcome_followup", "网速不稳", "会议一直断线", "我改用手机热点才顺利讲完"),
  scene!("zh_scene__travel_rain__v1", "reason_outcome_followup", "下雨了", "我没去远处", "我就在附近的小店慢慢逛"),
  scene!("zh_scene__lab_sample__v1", "reason_outcome_followup", "样品太湿", "读数不稳定", "我先烘干再重新测了一次"),
  scene!("zh_scene__daily_no_umbrella__v1", "reason_outcome_followup", "我忘带伞", "衣服被淋湿了", "回家后我立刻换了衣服"),
  scene!("zh_scene__tech_update_lag__v1", "reason_outcome_followup", "系统更新后卡顿", "我打开应用变慢了", "我清理缓存后顺畅很多"),
  scene!("zh_scene__kitchen_salt__v1", "reason_outcome_followup", "我盐放多了", "汤太咸了", "我加了点水才勉强能喝"),
  scene!("zh_scene__bus_traffic__v1", "reason_outcome_followup", "路上堵车", "我到得有点晚", "我下次会早点出门"),
  scene!("zh_scene__printer_paper__v1", "reason_outcome_followup", "打印机卡纸", "文件没打印出来", "我把纸重新放好再试了一次"),
  scene!("zh_scene__phone_low_battery__v1", "reason_outcome_followup", "手机电量太低", "导航一直提醒省电模式", "我找了个地方先充电"),

  scene!("zh_scene__alarm__v1", "condition_outcome_followup", "我不设闹钟", "早上就起不来", "我只好一路小跑赶时间"),
  scene!("zh_scene__backup__v1", "condition_outcome_followup", "我不备份文件", "电脑一出问题就会丢资料", "我现在每周都备份一次"),
  scene!("zh_scene__umbrella__v1", "condition_outcome_followup", "我出门不带伞", "遇到下雨就会很狼狈", "我开始把伞放在包里"),
  scene!("zh_scene__practice__v1", "condition_outcome_followup", "我不提前练习", "上台就容易紧张", "我后来每天都练十分钟"),
  scene!("zh_scene__sleep_early__v1", "condition_outcome_followup", "我晚上早点睡", "第二天精神就更好", "我效率也提高了"),
  scene!("zh_scene__save_password__v1", "condition_outcome_followup", "我不保存密码", "每次登录都要重输", "我干脆用密码管理器"),
  scene!("zh_scene__check_weather__v1", "condition_outcome_followup", "我不看天气预报", "行程就容易被打乱", "我现在出门前都会看一眼"),
  scene!("zh_scene__write_plan__v1", "condition_outcome_followup", "我不列计划", "事情就会越堆越多", "我开始每天写待办清单"),

  scene!("zh_scene__after_class__v1", "time_event_outcome", "我下课了", "我去图书馆复习", "学习效率提高了"),
  scene!("zh_scene__arrive_home__v1", "time_event_outcome", "我到家了", "我先洗个澡", "整个人放松多了"),
  scene!("zh_scene__finish_meeting__v1", "time_event_outcome", "会议结束了", "我把要点整理成文档", "同事更容易跟进"),
  scene!("zh_scene__finish_experiment__v1", "time_event_outcome", "实验做完了", "我马上记录数据", "后面分析更顺利"),
  scene!("zh_scene__lunch_time__v1", "time_event_outcome", "中午到了", "我出去吃点东西", "下午不那么饿了"),
  scene!("zh_scene__weekend_start__v1", "time_event_outcome", "周末开始了", "我把房间收拾了一下", "住起来更舒服了"),
  scene!("zh_scene__project_deadline__v1", "time_event_outcome", "截止日期到了", "我把最后一版提交上去", "我终于松了口气"),
  scene!("zh_scene__rain_stop__v1", "time_event_outcome", "雨停了", "我出去走走", "心情好了一点"),

  scene!("zh_scene__expect_easy_but_hard__v1", "expectation_actual_consequence", "我以为今天会很顺利", "事情却特别多", "我忙到很晚才结束"),
  scene!("zh_scene__expect_fast_but_slow__v1", "expectation_actual_consequence", "我以为十分钟就能搞定", "过程却拖了很久", "我后面的安排被迫改了"),
  scene!("zh_scene__expect_quiet_but_noisy__v1", "expectation_actual_consequence", "我以为咖啡店会很安静", "里面却很吵", "我只好换个地方"),
  scene!("zh_scene__expect_cheaper_but_expensive__v1", "expectation_actual_consequence", "我以为修理不会太贵", "费用却超出预算", "我只能先做最必要的部分"),
  scene!("zh_scene__expect_ready_but_missing__v1", "expectation_actual_consequence", "我以为资料都准备好了", "关键文件却找不到", "我只好重新整理一遍"),
  scene!("zh_scene__expect_good_weather_but_rain__v1", "expectation_actual_consequence", "我以为今天不会下雨", "外面却突然变天", "我被淋得有点狼狈"),

  scene!("zh_scene__option_cook_or_takeout__v1", "optionA_optionB_then_rule", "我可以自己做饭", "我也可以点外卖", "如果我点外卖，就要多等一会儿"),
  scene!("zh_scene__option_walk_or_bus__v1", "optionA_optionB_then_rule", "我可以走路过去", "我也可以坐公交", "如果我坐公交，就得看发车时间"),
  scene!("zh_scene__option_train_or_taxi__v1", "optionA_optionB_then_rule", "我可以坐地铁", "我也可以打车", "如果我打车，就会多花一些钱"),
  scene!("zh_scene__option_now_or_later__v1", "optionA_optionB_then_rule", "我可以现在就开始", "我也可以拖到明天", "如果我拖到明天，就会更赶"),

  scene!("zh_scene__two_facts_tired__v1", "fact1_fact2_inference", "我昨晚睡得很晚", "今天还要早起", "我整天都很困"),
  scene!("zh_scene__two_facts_busy__v1", "fact1_fact2_inference", "我这周任务很多", "每天还要开好几场会", "我几乎没有休息时间"),
  scene!("zh_scene__two_facts_save_time__v1", "fact1_fact2_inference", "我把路线提前查好了", "出门前也准备齐东西", "路上省了不少时间"),
  scene!("zh_scene__two_facts_more_focus__v1", "fact1_fact2_inference", "我把手机调成静音", "我还关掉了消息提醒", "我更能专心做事"),
  scene!("zh_scene__two_facts_cost__v1", "fact1_fact2_inference", "我买了不少食材", "还买了很多零食", "这个月开销变大了"),

  scene!("zh_scene__leave_early__v1", "action_goal_effect", "我提前半小时出门", "赶上早班车", "我没有迟到"),
  scene!("zh_scene__write_outline__v1", "action_goal_effect", "我先写了提纲", "讲清楚重点", "汇报更有条理"),
  scene!("zh_scene__dry_sample__v1", "action_goal_effect", "我先把样品烘干", "读数更稳定", "数据更可靠"),
  scene!("zh_scene__clear_cache__v1", "action_goal_effect", "我清理了缓存", "系统运行更顺畅", "应用打开更快"),
  scene!("zh_scene__prepare_questions__v1", "action_goal_effect", "我提前准备了问题清单", "沟通更高效", "会议时间缩短了"),

  scene!("zh_scene__then_now_study__v1", "time_then_now_contrast", "以前我复习很随意", "我经常记不住重点", "现在我却更有方法了"),
  scene!("zh_scene__then_now_sleep__v1", "time_then_now_contrast", "以前我总是熬夜", "我白天很没精神", "现在我反而睡得更规律"),
  scene!("zh_scene__then_now_workflow__v1", "time_then_now_contrast", "刚开始我不太会用这个工具", "我做事很慢", "后来我却越来越熟练"),

  scene!("zh_scene__prepared_but_mistake__v1", "condition_expected_surprise", "我提前准备了", "事情本来应该很顺利", "结果却还是出了差错"),
  scene!("zh_scene__leave_early_but_late__v1", "condition_expected_surprise", "我出门很早", "我本来应该不会迟到", "路上却偏偏堵得厉害"),
  scene!("zh_scene__practice_but_nervous__v1", "condition_expected_surprise", "我练习了很多次", "我本来应该很自信", "上台却还是有点紧张"),
];

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sample_and_reference_should_be_well_formed() {
    let spec = sample_core_plus_core_spec("hsk3", 100).expect("spec");
    assert_eq!(spec.version, VERSION);
    assert!(!spec.seed.trim().is_empty());
    let ref_ans = build_expected_reference_answer(&spec);
    let (s1, s2) = split_two_sentences(&ref_ans).expect("two sentences");
    assert!(!s1.is_empty() && !s2.is_empty());
  }

  #[test]
  fn deterministic_eval_accepts_expected_reference() {
    let spec = sample_core_plus_core_spec("hsk4", 100).expect("spec");
    let answer = build_expected_reference_answer(&spec);
    let (ok, score, _exp) = evaluate_core_plus_core_answer(&spec, &answer);
    assert!(ok, "answer should pass, score={score}");
    assert!(score >= 60.0);
  }

  #[test]
  fn hsk1_sampling_stays_simple() {
    for _ in 0..15 {
      let spec = sample_core_plus_core_spec("hsk1", 400).expect("spec");
      let p1 = spec.props.p1.chars().count();
      let p2 = spec.props.p2.chars().count();
      let p3 = spec.props.p3.chars().count();
      assert!(p1 <= 12 && p2 <= 12 && p3 <= 12, "segments too long: {p1}/{p2}/{p3}");
    }
  }
}
