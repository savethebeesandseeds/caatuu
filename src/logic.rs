//! Core behaviors shared by both HTTP and WebSocket handlers.
//!
//! This includes:
//!   - Evaluating answers (freeform only; supports seed+challenge or instructions+rubric)
//!   - Generating hints (freeform vocab/pattern suggestions)
//!   - Calling translation/pinyin/agent helpers
//!   - Next-character logic (not applicable for freeform)

use base64::Engine;
use tracing::{debug, error, instrument};

use crate::coreplus::evaluate_core_plus_core_answer;
use crate::domain::Challenge;
use crate::pinyin::to_pinyin_diacritics;
use crate::protocol::ChallengeOut;
use crate::state::AppState;
use crate::util::is_cjk;

pub fn _to_out(c: &Challenge) -> ChallengeOut {
    crate::protocol::to_out(c)
}

#[instrument(level = "info", skip(state, answer), fields(%challenge_id, answer_len = answer.len()))]
pub async fn evaluate_answer(
    state: &AppState,
    challenge_id: &str,
    answer: &str,
) -> (bool, f32, String, String) {
    if let Some(ch) = state.get_challenge(challenge_id).await {
        let (ok, score, expected, explanation) = if let Some(spec) = &ch.core_plus_spec {
            let (mut ok, mut score, exp) = evaluate_core_plus_core_answer(spec, answer);
            if !ok && answer_has_context_signal(&ch.seed_zh, &ch.challenge_zh, answer) {
                ok = true;
                score = score.max(62.0);
                (
                    ok,
                    score,
                    String::new(),
                    format!("Lenient pass for intent/context. {exp}"),
                )
            } else {
                (ok, score, String::new(), exp)
            }
        } else {
            let has_seed_challenge = !ch.seed_zh.is_empty() && !ch.challenge_zh.is_empty();
            if has_seed_challenge {
                let has_rubric = ch.rubric.is_some();
                let contextual_soft_pass =
                    answer_has_context_signal(&ch.seed_zh, &ch.challenge_zh, answer);
                let (local_ok, local_score, local_exp, local_is_marker_eval) = if has_rubric {
                    let (ok, score, exp) = freeform_eval_local(&ch, answer);
                    (ok, score, exp, false)
                } else {
                    let (ok, score, exp) =
                        seed_challenge_eval_local(&ch.seed_zh, &ch.challenge_zh, answer);
                    (ok, score, exp, true)
                };

                if let Some(oa) = &state.openai {
                    match oa
                        .validate_challenge(&state.prompts, &ch.seed_zh, &ch.challenge_zh, answer)
                        .await
                    {
                        Ok((ok, score, exp)) => {
                            // Strongly permissive override for marker-based tasks:
                            // if local checks/context see the intent, pass it.
                            if !ok && local_is_marker_eval && (local_ok || contextual_soft_pass) {
                                let bumped = score.max(local_score).max(62.0);
                                if local_ok {
                                    (
                                        true,
                                        bumped,
                                        String::new(),
                                        format!("Lenient pass: {local_exp}"),
                                    )
                                } else {
                                    (
                    true,
                    bumped,
                    String::new(),
                    "Lenient pass: intent and context are clear; creative variation is accepted.".into(),
                  )
                                }
                            } else {
                                (ok, score, String::new(), exp)
                            }
                        }
                        Err(e) => {
                            error!(target: "challenge", id = %ch.id, error = %e, "OpenAI validate_challenge failed; using local checks.");
                            if local_is_marker_eval && !local_ok && contextual_soft_pass {
                                (
                                    true,
                                    local_score.max(62.0),
                                    String::new(),
                                    "Lenient pass: local contextual check accepted this answer."
                                        .into(),
                                )
                            } else if local_is_marker_eval {
                                (
                                    local_ok,
                                    local_score,
                                    String::new(),
                                    format!("(local) {local_exp}"),
                                )
                            } else {
                                (
                                    local_ok,
                                    local_score,
                                    String::new(),
                                    format!("(local) score={local_score:.0}: {local_exp}"),
                                )
                            }
                        }
                    }
                } else if local_is_marker_eval && !local_ok && contextual_soft_pass {
                    (
                        true,
                        local_score.max(62.0),
                        String::new(),
                        "Lenient pass: contextual intent is good enough for this challenge.".into(),
                    )
                } else if local_is_marker_eval {
                    (
                        local_ok,
                        local_score,
                        String::new(),
                        format!("(local) {local_exp}"),
                    )
                } else {
                    (
                        local_ok,
                        local_score,
                        String::new(),
                        format!("(local) score={local_score:.0}: {local_exp}"),
                    )
                }
            } else if !ch.instructions.is_empty() {
                let rubric_json = ch
                    .rubric
                    .as_ref()
                    .and_then(|r| serde_json::to_string(r).ok())
                    .unwrap_or("{}".into());
                if let Some(oa) = &state.openai {
                    match oa
                        .freeform_eval(&state.prompts, &ch.instructions, &rubric_json, answer)
                        .await
                    {
                        Ok((ok, score, exp)) => {
                            if !ok
                                && answer_has_context_signal(&ch.seed_zh, &ch.instructions, answer)
                                && !answer.trim().is_empty()
                            {
                                (
                  true,
                  score.max(62.0),
                  String::new(),
                  "Lenient pass: answer is relevant to the task and creative enough.".into(),
                )
                            } else {
                                (ok, score, String::new(), format!("score={score:.0}: {exp}"))
                            }
                        }
                        Err(e) => {
                            error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_eval failed; using local rubric.");
                            let (ok, score, exp) = freeform_eval_local(&ch, answer);
                            (
                                ok,
                                score,
                                String::new(),
                                format!("(local) score={score:.0}: {exp}"),
                            )
                        }
                    }
                } else {
                    let (ok, score, exp) = freeform_eval_local(&ch, answer);
                    (
                        ok,
                        score,
                        String::new(),
                        format!("(local) score={score:.0}: {exp}"),
                    )
                }
            } else {
                (
                    false,
                    0.0,
                    String::new(),
                    "No evaluation path: challenge is missing seed+challenge and instructions."
                        .into(),
                )
            }
        };

        let explanation = normalize_explanation_text(
            &explanation,
            ok,
            &ch.seed_zh,
            &ch.challenge_zh,
            &ch.instructions,
            answer,
        );
        (ok, score, expected, explanation)
    } else {
        (
            false,
            0.0,
            "".into(),
            format!("Unknown challengeId: {}", challenge_id),
        )
    }
}

#[instrument(level = "info", skip(state), fields(%challenge_id))]
pub async fn get_hint_text(state: &AppState, challenge_id: &str) -> String {
    if let Some(ch) = state.get_challenge(challenge_id).await {
        if let Some(spec) = &ch.core_plus_spec {
            return format!(
                "围绕“{}”，只写两句：用“{}”和“{}”。",
                spec.seed, spec.step1.markers_zh, spec.step2.markers_zh
            );
        }

        let instr = if !ch.challenge_zh.is_empty() {
            format!("Seed: {}\nChallenge: {}", ch.seed_zh, ch.challenge_zh)
        } else if !ch.instructions.is_empty() {
            ch.instructions.clone()
        } else {
            "写一段短文：先说时间和地点，再用一个表态/计划的动词提出行动。".to_string()
        };

        if let Some(oa) = &state.openai {
            match oa.freeform_hint(&state.prompts, &instr).await {
                Ok(t) => t,
                Err(e) => {
                    error!(target: "challenge", id = %ch.id, error = %e, "OpenAI freeform_hint failed; using local hint.");
                    freeform_hint_local(&ch)
                }
            }
        } else {
            freeform_hint_local(&ch)
        }
    } else {
        "No hint: unknown challenge.".into()
    }
}

#[instrument(level = "info", skip(_state, text), fields(text_len = text.len()))]
pub async fn do_pinyin(_state: &AppState, text: &str) -> String {
    let p = to_pinyin_diacritics(text);
    debug!(target: "caatuu_backend", text, p, "pinying translation.");
    p
}

#[instrument(level = "info", skip(state, text), fields(text_len = text.len()))]
pub async fn do_translate(state: &AppState, text: &str) -> String {
    if let Some(oa) = &state.openai {
        match oa.translate_to_en(&state.prompts, text).await {
            Ok(t) => return t,
            Err(e) => {
                tracing::error!(target: "caatuu_backend", error = %e, "OpenAI translate failed; using stub fallback.")
            }
        }
    }
    translate_stub(text)
}

// Grammar correction
#[instrument(level = "info", skip(state, text), fields(text_len = text.len()))]
pub async fn do_grammar(state: &AppState, text: &str) -> String {
    if let Some(oa) = &state.openai {
        match oa.grammar_correct(&state.prompts, text).await {
            Ok(t) => return t,
            Err(e) => {
                tracing::error!(target: "caatuu_backend", error = %e, "OpenAI grammar_correct failed; using stub fallback.")
            }
        }
    }
    grammar_stub(text)
}

#[instrument(level = "info", skip(state, audio_base64), fields(mime = mime, base64_len = audio_base64.len()))]
pub async fn do_speech_to_text(
    state: &AppState,
    audio_base64: &str,
    mime: &str,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| format!("Invalid audio payload: {e}"))?;
    if bytes.is_empty() {
        return Err("Audio payload is empty.".into());
    }

    let oa = state
        .openai
        .as_ref()
        .ok_or_else(|| "Speech-to-text unavailable: OPENAI_API_KEY not set.".to_string())?;
    oa.transcribe_audio(mime, &bytes).await
}

#[instrument(level = "info", skip(state, question), fields(%challenge_id, question_len = question.len()))]
pub async fn do_agent_reply(state: &AppState, challenge_id: &str, question: &str) -> String {
    let ctx: Option<String> = state
        .get_challenge(challenge_id)
        .await
        .map(|c| {
            let mut parts: Vec<String> = vec![];
            if !c.seed_zh.is_empty() {
                parts.push(format!("Seed (zh): {}", c.seed_zh));
            }
            if !c.challenge_zh.is_empty() {
                parts.push(format!("Challenge (zh): {}", c.challenge_zh));
            }
            if !c.seed_en.is_empty() {
                parts.push(format!("Seed (en): {}", c.seed_en));
            }
            if !c.challenge_en.is_empty() {
                parts.push(format!("Challenge (en): {}", c.challenge_en));
            }
            if !c.instructions.is_empty() {
                parts.push(format!("Instructions: {}", c.instructions));
            }
            parts.join("\n")
        })
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });

    if let Some(oa) = &state.openai {
        match oa
            .agent_reply(&state.prompts, question, ctx.as_deref())
            .await
        {
            Ok(t) => {
                debug!(target: "caatuu_backend", %challenge_id, has_context = ctx.is_some(), "Agent reply via OpenAI.");
                t
            }
            Err(e) => {
                tracing::error!(target: "caatuu_backend", %challenge_id, error = %e, "Agent reply failed; using stub.");
                agent_reply_stub(question)
            }
        }
    } else {
        debug!(target: "caatuu_backend", %challenge_id, "Agent reply via stub.");
        agent_reply_stub(question)
    }
}

#[instrument(level = "info", skip(_state, _current), fields(%_challenge_id, prefix_len = _current.len()))]
pub async fn next_char_logic(
    _state: &AppState,
    _challenge_id: &str,
    _current: &str,
) -> (String, String, String) {
    (
        "".into(),
        "".into(),
        "Not applicable to freeform tasks.".into(),
    )
}

// -------- Local fallbacks & utilities --------

fn extract_marker_value(s: &str, marker_prefix: &str) -> Option<String> {
    let i = s.find(marker_prefix)?;
    let rest = &s[i + marker_prefix.len()..];
    let j = rest.find('」')?;
    let v = rest[..j].trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

fn shared_cjk_chars(a: &str, b: &str, stop_at: usize) -> usize {
    let mut shared = 0usize;
    for ch in a.chars() {
        if crate::util::is_cjk(ch) && b.contains(ch) {
            shared += 1;
        }
        if shared >= stop_at {
            break;
        }
    }
    shared
}

fn answer_has_context_signal(seed_zh: &str, challenge_zh: &str, answer: &str) -> bool {
    let ans = answer.trim();
    if ans.is_empty() {
        return false;
    }

    let cjk_count = ans.chars().filter(|c| crate::util::is_cjk(*c)).count();
    if cjk_count < 2 {
        return false;
    }

    if let Some(v) = extract_marker_value(challenge_zh, "立场动词「") {
        if ans.contains(&v) {
            return true;
        }
    }
    if let Some(p) = extract_marker_value(challenge_zh, "地点「") {
        if ans.contains(&p) {
            return true;
        }
    }

    if shared_cjk_chars(seed_zh, ans, 1) >= 1 {
        return true;
    }
    if shared_cjk_chars(challenge_zh, ans, 2) >= 2 {
        return true;
    }

    let relation_tokens = [
        "去", "到", "往", "因为", "所以", "如果", "就", "但是", "却", "然后",
    ];
    relation_tokens
        .iter()
        .any(|t| ans.contains(*t) && (seed_zh.contains(*t) || challenge_zh.contains(*t)))
}

fn push_kw(out: &mut Vec<String>, token: impl Into<String>) {
    let t = token.into();
    let t = t.trim();
    if t.is_empty() {
        return;
    }
    if !out.iter().any(|x| x == t) {
        out.push(t.to_string());
    }
}

fn collect_cn_keywords(
    seed_zh: &str,
    challenge_zh: &str,
    instructions: &str,
    answer: &str,
) -> Vec<String> {
    let mut out: Vec<String> = vec![];

    if let Some(v) = extract_marker_value(challenge_zh, "立场动词「") {
        push_kw(&mut out, v);
    }
    if let Some(p) = extract_marker_value(challenge_zh, "地点「") {
        push_kw(&mut out, p);
    }

    for tok in [
        "去", "到", "往", "因为", "所以", "如果", "就", "但是", "却", "然后", "想", "觉得", "希望",
        "打算", "计划",
    ] {
        if answer.contains(tok)
            || challenge_zh.contains(tok)
            || seed_zh.contains(tok)
            || instructions.contains(tok)
        {
            push_kw(&mut out, tok);
        }
        if out.len() >= 6 {
            return out;
        }
    }

    for source in [answer, challenge_zh, seed_zh, instructions] {
        for seg in source.split(|c: char| {
            c.is_ascii_whitespace() || "，。！？；：,.!?;:()（）【】[]".contains(c)
        }) {
            let snippet: String = seg
                .chars()
                .filter(|c| crate::util::is_cjk(*c))
                .take(4)
                .collect();
            if snippet.chars().count() >= 2 {
                push_kw(&mut out, snippet);
            }
            if out.len() >= 6 {
                return out;
            }
        }
    }

    if out.is_empty() {
        out.push("语义".into());
        out.push("创意".into());
    }
    out.truncate(6);
    out
}

fn normalize_explanation_text(
    raw: &str,
    ok: bool,
    seed_zh: &str,
    challenge_zh: &str,
    instructions: &str,
    answer: &str,
) -> String {
    let base = raw.trim();
    let has_ascii_letters = base.chars().any(|c| c.is_ascii_alphabetic());
    let has_cjk = base.chars().any(crate::util::is_cjk);
    let mut english = if has_ascii_letters {
        base.to_string()
    } else if ok {
        "Pass: the attempt fits the challenge intent, and creative phrasing is welcome.".to_string()
    } else {
        "Close: the intent is understandable; add one clearer challenge cue and keep going."
            .to_string()
    };

    if !has_ascii_letters && has_cjk && !base.is_empty() {
        if !english.ends_with('.') && !english.ends_with('!') && !english.ends_with('?') {
            english.push('.');
        }
        english.push(' ');
        english.push_str("Original note (中文): ");
        english.push_str(base);
        if !english.ends_with('。') {
            english.push('。');
        }
    } else if english.is_empty() {
        english = if ok {
            "Pass: nice creative attempt.".into()
        } else {
            "Close: revise with one clearer required cue.".into()
        };
    }

    if english.contains("Keywords(中文):") || english.contains("关键词") {
        return english;
    }

    let kws = collect_cn_keywords(seed_zh, challenge_zh, instructions, answer);
    if !english.ends_with('.')
        && !english.ends_with('!')
        && !english.ends_with('?')
        && !english.ends_with('。')
    {
        english.push('.');
    }
    english.push_str(" Keywords(中文): ");
    english.push_str(&kws.join(" / "));
    english
}

fn seed_challenge_eval_local(
    seed_zh: &str,
    challenge_zh: &str,
    answer: &str,
) -> (bool, f32, String) {
    let ans = answer.trim();
    if ans.is_empty() {
        return (
            false,
            0.0,
            "Empty answer. Write one sentence with the required verb + destination.".into(),
        );
    }

    // Best case: generated challenges include explicit markers.
    let req_verb = extract_marker_value(challenge_zh, "立场动词「");
    let req_place = extract_marker_value(challenge_zh, "地点「");

    // Heuristic fallback for older challenges (no markers).
    const STANCE_VERBS: [&str; 18] = [
        "想", "要", "喜欢", "爱", "怕", "需要", "觉得", "希望", "打算", "决定", "担心", "害怕",
        "同意", "反对", "关心", "讨厌", "愿意", "计划",
    ];
    const PLACES: [&str; 15] = [
        "家",
        "学校",
        "商店",
        "饭店",
        "医院",
        "公园",
        "图书馆",
        "机场",
        "火车站",
        "公司",
        "超市",
        "电影院",
        "体育馆",
        "银行",
        "博物馆",
    ];

    // --- Stance verb check (very forgiving) ---
    let verb_ok = if let Some(v) = &req_verb {
        if ans.contains(v) {
            true
        } else if v == "想要" && ans.contains("想") {
            true
        }
        // allow close variant
        else {
            false
        }
    } else {
        STANCE_VERBS.iter().any(|v| ans.contains(*v))
    };

    // --- Destination / place check ---
    let place_used = if let Some(p) = &req_place {
        if ans.contains(p) {
            Some(p.clone())
        } else {
            None
        }
    } else {
        PLACES
            .iter()
            .find(|p| ans.contains(**p))
            .map(|p| (*p).to_string())
    };

    // Motion pattern: allow 去/到/往 anywhere before the place token.
    let motion_ok = if let Some(place) = &place_used {
        let place_idx = ans.find(place).unwrap_or(usize::MAX);
        ["去", "到", "往"]
            .iter()
            .any(|m| ans.find(*m).map(|i| i < place_idx).unwrap_or(false))
    } else {
        false
    };

    let meaning_bonus =
        shared_cjk_chars(seed_zh, ans, 2) >= 1 || shared_cjk_chars(challenge_zh, ans, 2) >= 2;
    let creativity_bonus = ans.chars().count() >= seed_zh.chars().count().saturating_add(3);

    // Very permissive scoring: reward intent and context more than strict form.
    let mut score = 35.0;
    if verb_ok {
        score += 18.0;
    }
    if place_used.is_some() {
        score += 14.0;
    }
    if motion_ok {
        score += 8.0;
    }
    if meaning_bonus {
        score += 15.0;
    }
    if creativity_bonus {
        score += 8.0;
    }

    let ends_ok = ans
        .chars()
        .last()
        .map(|c| matches!(c, '。' | '！' | '？' | '.' | '!' | '?'))
        .unwrap_or(false);
    if ends_ok {
        score += 2.0;
    }

    if score > 100.0 {
        score = 100.0;
    }
    let correct = score >= 52.0;

    let mut missing = vec![];
    if !verb_ok {
        if let Some(v) = &req_verb {
            missing.push(format!("missing stance verb '{}'", v));
        } else {
            missing.push("missing a stance verb (e.g., 想/觉得/希望/打算)".into());
        }
    }
    if place_used.is_none() {
        if let Some(p) = &req_place {
            missing.push(format!("missing destination '{}'", p));
        } else {
            missing.push("missing a concrete destination place".into());
        }
    }
    if place_used.is_some() && !motion_ok {
        missing.push("missing a go-to pattern (去/到/往 + place)".into());
    }

    let explanation = if missing.is_empty() {
        "Pass: good intent and relevant challenge cues are present.".into()
    } else {
        format!(
            "Close: {}. Tip: keep seed meaning and include at least one clear motion/place cue.",
            missing.join(", ")
        )
    };

    (correct, score, explanation)
}
fn freeform_eval_local(ch: &Challenge, answer: &str) -> (bool, f32, String) {
    let mut score = 65.0;
    let mut notes = vec![];

    if let Some(r) = &ch.rubric {
        if let Some(min_chars) = r.min_chars {
            if answer.chars().count() >= min_chars {
                score += 10.0;
            } else {
                score -= 4.0;
                notes.push(format!("A little short (< {min_chars})"));
            }
        }
        if let Some(req) = &r.must_include {
            for w in req {
                if answer.contains(w) {
                    score += 4.0;
                } else {
                    score -= 3.0;
                    notes.push(format!("Could include '{w}'"));
                }
            }
        }
        if let Some(avoid) = &r.avoid {
            for w in avoid {
                if answer.contains(w) {
                    score -= 4.0;
                    notes.push(format!("Try less '{w}'"));
                }
            }
        }
    }

    if answer.chars().count() >= 12 {
        score += 6.0;
    }
    if score > 100.0 {
        score = 100.0;
    }
    if score < 0.0 {
        score = 0.0;
    }
    let correct = score >= 52.0;
    let mut explanation = if notes.is_empty() {
        "Pass: response is on-task and creative.".into()
    } else if correct {
        format!("Pass: {}", notes.join("; "))
    } else {
        format!("Close: {}", notes.join("; "))
    };
    explanation.push_str(&format!(" (Score: {:.1}/100)", score));
    (correct, score, explanation)
}

fn freeform_hint_local(ch: &Challenge) -> String {
    if !ch.challenge_zh.is_empty() {
        format!(
            "聚焦：主语改写 + 计划类动词 + 具体地点 + 时间。任务：{}",
            ch.challenge_zh
        )
    } else if !ch.instructions.is_empty() {
        format!(
            "先定时间/地点，再完成任务要点（3-5句）。任务：{}",
            ch.instructions
        )
    } else {
        "先说谁、什么时候、在哪里，然后做什么（加一个态度/计划动词）。".into()
    }
}

fn translate_stub(text: &str) -> String {
    let s = text.trim();
    if s.is_empty() {
        return String::new();
    }

    let has_cjk = s.chars().any(is_cjk);
    if has_cjk {
        return match s {
            "我想喝咖啡" => "I want to drink coffee.".into(),
            "今天天气很好" => "The weather is great today.".into(),
            "你吃饭了吗？" => "Have you eaten?".into(),
            "他昨天去了北京。" => "He went to Beijing yesterday.".into(),
            "我们一起学习吧！" => "Let's study together!".into(),
            _ => "Translation not available (stub).".into(),
        };
    }

    let lower = s.to_lowercase();
    match lower.as_str() {
        "i want to drink coffee" | "i want to drink coffee." => "我想喝咖啡。".into(),
        "the weather is great today" | "the weather is great today." => "今天天气很好。".into(),
        "have you eaten" | "have you eaten?" => "你吃饭了吗？".into(),
        "he went to beijing yesterday" | "he went to beijing yesterday." => {
            "他昨天去了北京。".into()
        }
        "let's study together" | "let's study together!" | "lets study together" => {
            "我们一起学习吧！".into()
        }
        _ => "Translation not available (stub).".into(),
    }
}

// Tiny grammar stub: ensure ending punctuation; otherwise return input
fn grammar_stub(text: &str) -> String {
    let s = text.trim();
    if s.is_empty() {
        return s.to_string();
    }
    let last = s.chars().last().unwrap_or(' ');
    let is_punct = matches!(last, '。' | '！' | '？' | '.' | '!' | '?');
    if is_punct {
        return s.to_string();
    }
    let has_cjk = s.chars().any(is_cjk);
    if has_cjk {
        format!("{}。", s)
    } else {
        format!("{}.", s)
    }
}

/// Tiny agent fallback that answers common "了/le" type questions.
fn agent_reply_stub(text: &str) -> String {
    if text.contains('了') || text.to_lowercase().contains("le ") || text.to_lowercase() == "le" {
        "Because it marks a completed action (aspect).".into()
    } else if text.to_lowercase().contains("why") {
        "Short answer: the particle indicates aspect or sentence mood depending on position.".into()
    } else {
        "Try focusing on core patterns (S + V + O). Ask about a specific particle for a deeper explanation."
      .into()
    }
}
