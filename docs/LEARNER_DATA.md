# Learner data

Last reviewed: 29 October 2026

Caatuu keeps language progress on the device. There is no account. This note
is the list of records that count as the person. A downloadable export file is
not built yet. When it is, the file will be this record and nothing else.

## Record

The registry is `apps/language-runtime/static/data/learner-record-registry.json`.
`apps/language-runtime/static/source/learner-record.mjs` builds it from each
`course.json` storage block. A test fails when the manifest and the registry
disagree, and when a new storage literal in the language runtime has no
classification.

Shared once: the streak, appearance, speech pace, mute, volume, autoplay,
music choice, selected home course, and setup source.

Each course, from its namespace: learning preferences, goal, game settings,
scores, practice, familiarity, the older familiarity copy, the reset
generation, and the semantic progress epoch. Verb Lab memory and Word World
resume records are included when that course has them, including the older
Word World history. Czech chat settings stay on Czech because Czech is the
course with chat. The semantic database contributes attempts, ledger,
receipts, evidence, and meta. Attempts still waiting in local storage are
copied with that course. Calculated embedding vectors are left out.

Word World mode and recent sentences use the same names on every course:
`word-world.translation-mode` and `word-world.recent-sentences.v1`. An older
`wordNet` copy is moved once and then removed. Verb Lab does the same with an
older `verb-memory.v2` file: it moves that study into `verb-memory.v3` and
removes the old file. A replace removes those older keys and writes the
snapshot's older familiarity and history copies, so a previous learner's
leftovers are not copied back.

Translation caches, music position, service-worker data, repair copies, and
progress locks are not part of the record.

Actual progress means a score, a familiarity bank, practice beyond the empty
set, a semantic attempt or evidence row, an attempt still waiting to be
saved, verb-memory study, recent sentences or a Word World history, a pending
practice queue, or a streak earned from practice. Theme, difficulty, voice,
and goal by themselves are not actual progress. A list of known verb pairs,
with no study recorded, is not actual progress either.

A record that is unreadable, marked damaged, or saved by a newer schema makes
the snapshot fail. It does not return a partial copy.

## Replace and backup

`prepareLearnerReplace` reads the snapshot. When the device has no actual
progress, it does not write a backup. When progress exists, it writes one
snapshot to IndexedDB `caatuu.learner-backup.v1`. If that write fails, the
replace must not start. `restoreLearnerBackup` puts that one snapshot back.
A later prepare replaces the slot. There is not a history of backups.

The backup stays on the device. It is not uploaded.

Settings can save the record as one file, `caatuu-progress.caatuu`. The
contents are JSON, with the snapshot and a checksum. The `.caatuu` extension
is what the import picker filters on. Caatuu does not upload that file.
Bringing a file in checks the checksum, saves the one local backup when the
device has actual progress, asks before replacing, and then reloads. The
control that puts the backup back is shown only when that backup exists.
