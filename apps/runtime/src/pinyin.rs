//! Hanzi → Hanyu Pinyin (tone diacritics, space-separated), copy non-Chinese as-is.
//!
//! Example:
//!   输入: "中国人计划 2025！"
//!   输出: "zhōng guó rén jì huà 2025！"
use pinyin::ToPinyin;

/// Convert Chinese text into Hanyu Pinyin with tone diacritics, space-separated.
/// Non-Chinese characters are copied as-is.
///
/// This is intentionally simple: it converts per-character (no word segmentation),
/// so some polyphonic characters may use a default reading.
///
pub fn to_pinyin_diacritics(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);

    // Track whether the previous emitted token was a Hanzi→pinyin token,
    // so we can insert spaces between consecutive Hanzi syllables.
    let mut last_was_hanzi = false;

    for ch in text.chars() {
        if let Some(py) = ch.to_pinyin() {
            let syllable = py.with_tone().to_string();

            if last_was_hanzi {
                out.push(' ');
            }
            out.push_str(&syllable);
            last_was_hanzi = true;
        } else {
            // Any non-Hanzi: copy as-is and reset spacing state.
            out.push(ch);
            last_was_hanzi = false;
        }
    }

    out
}
