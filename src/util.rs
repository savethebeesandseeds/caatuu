//! Small utility helpers used across modules.

/// Very small and safe string templating.
/// Replaces occurrences of `{key}` in the template with provided values.
/// This is intentionally simple (no nested/conditional logic).
pub fn fill_template(tpl: &str, pairs: &[(&str, &str)]) -> String {
  let mut out = tpl.to_string();
  for (k, v) in pairs {
    let needle = format!("{{{}}}", k);
    out = out.replace(&needle, v);
  }
  out
}

/// True if unicode char belongs to CJK ranges.
/// Useful for deciding whether to insert spacing when mixing Han + ASCII.
pub fn is_cjk(ch: char) -> bool {
  (ch >= '\u{4E00}' && ch <= '\u{9FFF}')
    || (ch >= '\u{3400}' && ch <= '\u{4DBF}')
    || (ch >= '\u{20000}' && ch <= '\u{2A6DF}')
    || (ch >= '\u{2A700}' && ch <= '\u{2B73F}')
    || (ch >= '\u{2B740}' && ch <= '\u{2B81F}')
    || (ch >= '\u{2B820}' && ch <= '\u{2CEAF}')
    || (ch >= '\u{F900}' && ch <= '\u{FAFF}')
}

/// Normalize a sentence by removing all whitespace.
/// Used for simple equality checks that ignore spacing.
#[allow(dead_code)]
pub fn normalize(s: &str) -> String {
  s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Remove spaces inside a pinyin string.
/// Handy for hints showing "first word" where we want a compact look.
#[allow(dead_code)]
pub fn pinyin_concat_no_space(pinyin_with_spaces: &str) -> String {
  pinyin_with_spaces.replace(' ', "")
}

/// Log-safe truncation for large strings.
/// Avoids spamming logs with huge request/response payloads.
#[allow(dead_code)]
pub fn trunc_for_log(s: &str, max: usize) -> String {
  if s.len() <= max { s.to_string() } else { format!("{}… ({} bytes total)", &s[..max], s.len()) }
}
