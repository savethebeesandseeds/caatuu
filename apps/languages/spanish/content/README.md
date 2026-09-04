# Spanish course content

This directory contains fresh European Spanish (`es-ES`) learner content
for an English-base course. It is one language pack consumed by the shared
Caatuu application; it does not fork game layouts or runtime behavior.

## English concept authority

Word World uses
`apps/languages/shared/english-concepts/word-world-starter-v1.json` as its
stable concept authority. The Spanish realization pack covers all 250 concepts
in exactly that order. Retrieval and content auditing remain English-based:
only each shared concept's authored `embeddingText` may enter the English
embedding pipeline. Spanish learner text and token glosses must never replace
that English retrieval input.

The eight Mandarin-oriented concepts already present in the shared starter
catalog remain semantically intact. Their European Spanish realizations still
refer to Lin, Chinese, pinyin, Chinese characters, the `jin` unit, Li Ming,
and one year of learning Mandarin Chinese; changing those details here would
break the shared English audit contract.

## Authored Spanish realization policy

The pack selects `spanish-spain-v1`, declares `es-ES` speech and the Latin
script, and uses `authored-word-tokens`. Each sentence has explicit word
boundaries, contextual English token glosses, and at least one playable token.
Sentence and token pronunciation fields are deliberately `null`: ordinary
Spanish orthography and platform speech may be used, but no reviewed phonetic
guide is claimed.

This is a machine-assisted first-party development draft. Its language gate is
`native-review-required`; `reviewer` and `reviewedAt` remain null until a
qualified European Spanish reviewer approves it. Its target-content license is
honestly `release-review-required`, with SPDX expression, source reference,
reviewer, and review date all unset. The separately governed shared English
concept catalog is release-cleared, but that status does not clear this Spanish
translation pack. No external dictionary or corpus was copied into these files.

## Game content and limits

Word World receives the 250 authored realizations. Verb Lab receives 180 common
Spanish infinitives and infinitive phrases in
`static/data/games/verb-nebula/core-vocabulary.json`, divided into difficulty
blocks of 60, 70, and 50. Every verb record has a stable `es.verb.*` ID, an
English audit cue, and `native-review-required` status.

Those contextual token glosses and verb cues are course content, not a
dictionary. This repository does not contain the provenance, reference
dictionaries, provider contract, or licensed full lexical dataset needed to
claim Spanish dictionary support. Dictionary-dependent planets must therefore
remain disabled. The shared app may initially expose Word World and Verb Lab,
with Campaign derived from the same catalog-driven progression; language-
specific rendering must continue through the Spanish adapter rather than a
Spanish copy of any game.

Runtime Word World files are projections of the authored pack and must be
regenerated through the catalog-driven language-content projector. Do not edit
projected runtime records as an independent Spanish source of truth.

