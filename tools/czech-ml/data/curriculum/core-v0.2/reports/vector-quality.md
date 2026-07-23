# Vector Quality Notes

Generated: 2026-07-22T05:42:32.369Z

Rows: 5000
Vector DB: `apps/languages/czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite`
Model: `all-minilm-l6-v2-qint8-v0.1`

Caveat: This semantic vector index is computed only from english_text (or manual English image descriptions), never from czech_text or metadata. Retrieval quality is measured separately by the human-curated image benchmark.

## Cleanup Uses

- Review near_duplicate_candidates before spending more translation or fine-tuning budget.
- Use top_target_words to rebalance overrepresented vocabulary.
- Use topic_counts and difficulty_counts to keep game planets varied by topic and level.
- Use nearest neighbors to generate distractors that are close but not identical for quiz modes.
- Use exact_duplicate_groups as a hard blocker; exact duplicates should stay at zero.

## Near-Duplicate Candidates

Showing 25 of 200 candidates from `/workspace/tools/czech-ml/data/curriculum/core-v0.2/validation/vector-quality.json`.

- cc-000751 / cc-004608 | vector 0.9862 | token 1
  - A child puts the toy in the box.
  - A child puts the toy in a box.
  - Very close wording; review for duplicate or low-value variation.
- cc-002068 / cc-003657 | vector 0.9854 | token 0.6667
  - A teacher wears a shoe.
  - A teacher has a shoe.
  - Very close vector match; likely same learning example shape.
- cc-003702 / cc-003919 | vector 0.9836 | token 0.6667
  - A sister wears a shoe.
  - A sister has a shoe.
  - Very close vector match; likely same learning example shape.
- cc-002800 / cc-003431 | vector 0.9796 | token 0.6667
  - A girl has a hat.
  - A girl wears a hat.
  - Very close vector match; likely same learning example shape.
- cc-002480 / cc-004227 | vector 0.9788 | token 0.6667
  - A mother wears a skirt.
  - A mother has a skirt.
  - Very close vector match; likely same learning example shape.
- cc-001641 / cc-004699 | vector 0.9787 | token 0.6667
  - A mother has a shoe.
  - A mother wears a shoe.
  - Very close vector match; likely same learning example shape.
- cc-001871 / cc-004482 | vector 0.9784 | token 0.6667
  - A grandpa wears a glove.
  - A grandpa has a glove.
  - Very close vector match; likely same learning example shape.
- cc-000040 / cc-003130 | vector 0.9774 | token 0.6667
  - A boy has a coat.
  - A boy wears a coat.
  - Very close vector match; likely same learning example shape.
- cc-003682 / cc-004070 | vector 0.9772 | token 0.6667
  - A mother has a sock.
  - A mother wears a sock.
  - Very close vector match; likely same learning example shape.
- cc-000717 / cc-001244 | vector 0.9762 | token 0.75
  - A father has some soup.
  - A father likes some soup.
  - Very close vector match; likely same learning example shape.
- cc-000161 / cc-004658 | vector 0.9756 | token 0.6667
  - A teacher wears a scarf.
  - A teacher has a scarf.
  - Very close vector match; likely same learning example shape.
- cc-003507 / cc-004049 | vector 0.9755 | token 0.6667
  - A child wears a dress.
  - A child has a dress.
  - Very close vector match; likely same learning example shape.
- cc-003481 / cc-003692 | vector 0.9748 | token 0.6667
  - A mother wears a hat.
  - A mother has a hat.
  - Very close vector match; likely same learning example shape.
- cc-000659 / cc-004251 | vector 0.9744 | token 0.6667
  - The pear is green.
  - The pear is very green.
  - Very close vector match; likely same learning example shape.
- cc-002956 / cc-004344 | vector 0.9741 | token 0.6667
  - A grandpa likes a paper.
  - A grandpa has a paper.
  - Very close vector match; likely same learning example shape.
- cc-000139 / cc-001160 | vector 0.9738 | token 0.6667
  - The egg is small.
  - The egg is very small.
  - Very close vector match; likely same learning example shape.
- cc-001227 / cc-003284 | vector 0.9724 | token 0.6667
  - A student has a rope.
  - A student needs a rope.
  - Very close vector match; likely same learning example shape.
- cc-001097 / cc-004508 | vector 0.9704 | token 0.6667
  - The sand is dry.
  - The sand is very dry.
  - Very close vector match; likely same learning example shape.
- cc-002444 / cc-002600 | vector 0.97 | token 0.6667
  - A grandma wears a boot.
  - A grandma has a boot.
  - Very close vector match; likely same learning example shape.
- cc-001130 / cc-003437 | vector 0.9699 | token 0.6667
  - A student likes a drum.
  - A student has a drum.
  - Very close vector match; likely same learning example shape.
- cc-004272 / cc-004689 | vector 0.9694 | token 0.6667
  - A student has a notebook.
  - A student likes a notebook.
  - Very close vector match; likely same learning example shape.
- cc-001576 / cc-004482 | vector 0.9691 | token 0.6667
  - A grandpa needs a glove.
  - A grandpa has a glove.
  - Very close vector match; likely same learning example shape.
- cc-001308 / cc-004895 | vector 0.969 | token 0.6667
  - The potato is hot.
  - The potato is very hot.
  - Very close vector match; likely same learning example shape.
- cc-001722 / cc-002538 | vector 0.9686 | token 0.6667
  - A neighbor likes a coat.
  - A neighbor has a coat.
  - Very close vector match; likely same learning example shape.
- cc-001851 / cc-004048 | vector 0.9684 | token 0.6667
  - A baby needs a pen.
  - A baby has a pen.
  - Very close vector match; likely same learning example shape.

## Coverage Hot Spots

Top target words:

- has: 431
- puts: 382
- eats: 288
- some: 269
- friend: 258
- child: 247
- father: 240
- sees: 232
- small: 228
- brother: 225
- teacher: 224
- mother: 223
- student: 223
- girl: 208
- finds: 204

Most common openings:

- where is the: 98
- can you see: 97
- please show me: 57
- do you like: 55
- do you want: 55
- please hold the: 44
- please find the: 41
- please take the: 40
- please close the: 39
- please open the: 37
- a child puts: 35
- a friend puts: 35
- a friend has: 34
- a girl has: 33
- a student has: 33

