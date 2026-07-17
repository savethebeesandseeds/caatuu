# Full Czech to English dictionary attribution

The full dictionary contains Czech dictionary data extracted from
the English-language Wiktionary by Wiktextract and distributed in
machine-readable form by Kaikki.org.

- Source page: <https://kaikki.org/dictionary/Czech/index.html>
- Original project: <https://en.wiktionary.org/>
- Extractor: <https://github.com/tatuylonen/wiktextract>
- License: CC BY-SA 4.0 and GFDL; Caatuu redistributes this dictionary pack
  under CC BY-SA 4.0.
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/>
- GFDL: <https://www.gnu.org/licenses/fdl-1.3.html>

The exact Wiktionary dump date, Kaikki extraction date, source checksum,
database checksum, counts, and extractor source URL are recorded in the
versioned dictionary manifest.

## Caatuu modifications

- Czech lemmas, Czech inflected forms, English glosses, parts of speech,
  labels, relations, and eligible usage examples are normalized into SQLite.
- Search indexes Czech lemmas and forms. English glosses are output meanings,
  not an English-to-Czech search index.
- Published quotations and citation-like examples are excluded. Only
  editor-written usage examples without citation metadata may be retained.
- Large source categories, templates, sound metadata, and other fields not
  needed by Caatuu dictionary and learning-game features are omitted.
- The curated Caatuu Core dictionary remains a separate project-local file in
  its original learner order.

The generated dictionary pack is marked `app_and_games` for dictionary and
learning-game features throughout Caatuu. It is not included in fine-tuning
corpora.
