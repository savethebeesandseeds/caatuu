# Vector Quality Notes

Generated: 2026-07-05T14:17:43.995Z

Rows: 5000
Vector DB: `apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite`
Model: `caatuu-local-hash-v0.1`

Caveat: This is a deterministic lexical/curriculum-metadata vector index, not a semantic transformer embedding model.

## Cleanup Uses

- Review near_duplicate_candidates before spending more translation or fine-tuning budget.
- Use top_target_words to rebalance overrepresented vocabulary.
- Use topic_counts and difficulty_counts to keep game planets varied by topic and level.
- Use nearest neighbors to generate distractors that are close but not identical for quiz modes.
- Use exact_duplicate_groups as a hard blocker; exact duplicates should stay at zero.

## Near-Duplicate Candidates

Showing 25 of 200 candidates from `C:\Work\caatuu\tools\caatuu-cz-ml\data\curriculum\core-v0.1\validation\vector-quality.json`.

- cc-001803 / cc-004127 | vector 1 | token 1
  - A mother gives the brother a small toy.
  - A brother gives the mother a small toy.
  - Very close wording; review for duplicate or low-value variation.
- cc-002483 / cc-004362 | vector 1 | token 1
  - A friend gives the father a small drum.
  - A father gives the friend a small drum.
  - Very close wording; review for duplicate or low-value variation.
- cc-003593 / cc-004837 | vector 1 | token 1
  - A sister gives the friend a small box.
  - A friend gives the sister a small box.
  - Very close wording; review for duplicate or low-value variation.
- cc-000941 / cc-002131 | vector 0.9981 | token 1
  - A friend puts the box in the basket.
  - A friend puts the basket in the box.
  - Very close wording; review for duplicate or low-value variation.
- cc-001291 / cc-003897 | vector 0.9977 | token 1
  - Is the picture old?
  - The picture is old.
  - Very close wording; review for duplicate or low-value variation.
- cc-001422 / cc-001431 | vector 0.9976 | token 1
  - The banana is yellow.
  - Is the banana yellow?
  - Very close wording; review for duplicate or low-value variation.
- cc-000721 / cc-000846 | vector 0.9975 | token 1
  - Is the blanket brown?
  - The blanket is brown.
  - Very close wording; review for duplicate or low-value variation.
- cc-000966 / cc-001309 | vector 0.9975 | token 1
  - Is the notebook clean?
  - The notebook is clean.
  - Very close wording; review for duplicate or low-value variation.
- cc-001088 / cc-002299 | vector 0.9975 | token 1
  - Is the ticket small?
  - The ticket is small.
  - Very close wording; review for duplicate or low-value variation.
- cc-004571 / cc-004664 | vector 0.9975 | token 1
  - Is the notebook small?
  - The notebook is small.
  - Very close wording; review for duplicate or low-value variation.
- cc-000034 / cc-003765 | vector 0.9974 | token 1
  - Is the basket small?
  - The basket is small.
  - Very close wording; review for duplicate or low-value variation.
- cc-000091 / cc-001654 | vector 0.9974 | token 1
  - The swing is small.
  - Is the swing small?
  - Very close wording; review for duplicate or low-value variation.
- cc-000246 / cc-003893 | vector 0.9974 | token 1
  - The notebook is new.
  - Is the notebook new?
  - Very close wording; review for duplicate or low-value variation.
- cc-002350 / cc-004950 | vector 0.9974 | token 1
  - The basket is green.
  - Is the basket green?
  - Very close wording; review for duplicate or low-value variation.
- cc-002833 / cc-003276 | vector 0.9974 | token 1
  - Is the water yellow?
  - The water is yellow.
  - Very close wording; review for duplicate or low-value variation.
- cc-002986 / cc-004452 | vector 0.9974 | token 1
  - The picture is clean.
  - Is the picture clean?
  - Very close wording; review for duplicate or low-value variation.
- cc-004446 / cc-004706 | vector 0.9974 | token 1
  - The flower is pretty.
  - Is the flower pretty?
  - Very close wording; review for duplicate or low-value variation.
- cc-000226 / cc-001525 | vector 0.9973 | token 1
  - The spoon is small.
  - Is the spoon small?
  - Very close wording; review for duplicate or low-value variation.
- cc-000506 / cc-002129 | vector 0.9973 | token 1
  - Is the drum yellow?
  - The drum is yellow.
  - Very close wording; review for duplicate or low-value variation.
- cc-000608 / cc-001879 | vector 0.9973 | token 1
  - Is the yogurt cold?
  - The yogurt is cold.
  - Very close wording; review for duplicate or low-value variation.
- cc-000747 / cc-004720 | vector 0.9973 | token 1
  - The jacket is clean.
  - Is the jacket clean?
  - Very close wording; review for duplicate or low-value variation.
- cc-001008 / cc-001491 | vector 0.9973 | token 1
  - The pants are clean.
  - Are the pants clean?
  - Very close wording; review for duplicate or low-value variation.
- cc-001033 / cc-004737 | vector 0.9973 | token 1
  - Is the sock clean?
  - The sock is clean.
  - Very close wording; review for duplicate or low-value variation.
- cc-001207 / cc-001400 | vector 0.9973 | token 1
  - Is the yogurt sweet?
  - The yogurt is sweet.
  - Very close wording; review for duplicate or low-value variation.
- cc-001463 / cc-002314 | vector 0.9973 | token 1
  - Is the plane small?
  - The plane is small.
  - Very close wording; review for duplicate or low-value variation.

## Coverage Hot Spots

Top target words:

- has: 450
- puts: 377
- eats: 270
- some: 269
- friend: 235
- small: 235
- father: 229
- sees: 223
- child: 219
- brother: 213
- student: 212
- teacher: 210
- girl: 208
- touches: 205
- mother: 203

Most common openings:

- can you see: 103
- where is the: 102
- please show me: 62
- do you like: 57
- do you want: 57
- please hold the: 46
- please close the: 43
- please find the: 43
- please open the: 42
- please take the: 42
- a friend has: 36
- a girl has: 35
- a student has: 33
- a friend puts: 32
- a child puts: 31

