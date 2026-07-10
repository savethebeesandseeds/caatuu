# Vector Quality Notes

Generated: 2026-07-09T17:23:55.633Z

Rows: 5000
Vector DB: `apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite`
Model: `caatuu-local-hash-v0.1`

Caveat: This is a deterministic lexical vector index computed only from english_text, not czech_text or metadata, and not a semantic transformer embedding model.

## Cleanup Uses

- Review near_duplicate_candidates before spending more translation or fine-tuning budget.
- Use top_target_words to rebalance overrepresented vocabulary.
- Use topic_counts and difficulty_counts to keep game planets varied by topic and level.
- Use nearest neighbors to generate distractors that are close but not identical for quiz modes.
- Use exact_duplicate_groups as a hard blocker; exact duplicates should stay at zero.

## Near-Duplicate Candidates

Showing 25 of 200 candidates from `C:\Work\caatuu\tools\caatuu-cz-ml\data\curriculum\core-v0.2\validation\vector-quality.json`.

- cc-003774 / cc-004660 | vector 0.9589 | token 0.8333
  - A father sees the dry boat near the station.
  - A father sees the boat near the station.
  - Very close vector match; likely same learning example shape.
- cc-001333 / cc-004483 | vector 0.9574 | token 0.8333
  - A child sees the plane near the station.
  - A child sees the new plane near the station.
  - Very close vector match; likely same learning example shape.
- cc-001207 / cc-001896 | vector 0.9517 | token 0.8
  - A friend tastes the sweet yogurt with a spoon.
  - A friend tastes the yogurt with a spoon.
  - Very close vector match; likely same learning example shape.
- cc-000034 / cc-003745 | vector 0.9514 | token 0.8
  - A mother carries the small basket to the room.
  - A mother carries the basket to the room.
  - Very close vector match; likely same learning example shape.
- cc-003745 / cc-004950 | vector 0.9514 | token 0.8
  - A mother carries the basket to the room.
  - A mother carries the green basket to the room.
  - Very close vector match; likely same learning example shape.
- cc-003046 / cc-003759 | vector 0.948 | token 0.8
  - A father rides the small bike on the path.
  - A father rides the bike on the path.
  - Very close vector match; likely same learning example shape.
- cc-001042 / cc-004383 | vector 0.9442 | token 0.3333
  - A boy has a ruler.
  - A boy has a basket.
  - Very close vector match; likely same learning example shape.
- cc-003893 / cc-004571 | vector 0.9441 | token 0.8
  - A student opens the new notebook in class.
  - A student opens the notebook in class.
  - Very close vector match; likely same learning example shape.
- cc-000653 / cc-000993 | vector 0.9421 | token 0.6667
  - The bed is in the room.
  - The red bed is in the room.
  - Very close vector match; likely same learning example shape.
- cc-001047 / cc-001317 | vector 0.942 | token 0.8333
  - A child eats the hot pasta after lunch.
  - A child eats the pasta after lunch.
  - Very close vector match; likely same learning example shape.
- cc-002892 / cc-003477 | vector 0.9389 | token 0.5
  - A grandpa likes a potato.
  - A grandpa likes a story.
  - Very close vector match; likely same learning example shape.
- cc-000653 / cc-002157 | vector 0.9364 | token 0.6667
  - The bed is in the room.
  - The soft bed is in the room.
  - Very close vector match; likely same learning example shape.
- cc-000675 / cc-002816 | vector 0.9361 | token 0.3333
  - Do you want a ball?
  - Do you want a pencil?
  - Very close vector match; likely same learning example shape.
- cc-001750 / cc-004203 | vector 0.9361 | token 0.3333
  - Do you want a castle?
  - Do you want a cake?
  - Very close vector match; likely same learning example shape.
- cc-001091 / cc-001377 | vector 0.9356 | token 0.5
  - A neighbor carries the ruler.
  - A neighbor carries the basket.
  - Very close vector match; likely same learning example shape.
- cc-002792 / cc-003581 | vector 0.9269 | token 0.3333
  - The cake is wet.
  - Is the castle wet?
  - Very close vector match; likely same learning example shape.
- cc-000204 / cc-000418 | vector 0.9262 | token 0.3333
  - The pencil is small.
  - The ball is small.
  - Very close vector match; likely same learning example shape.
- cc-000809 / cc-001431 | vector 0.9251 | token 0.8333
  - A friend eats the banana after lunch.
  - A friend eats the yellow banana after lunch.
  - Very close vector match; likely same learning example shape.
- cc-000956 / cc-001809 | vector 0.9165 | token 0.6
  - Please put the bag on the table.
  - Please put the spoon on the table.
  - Very close vector match; likely same learning example shape.
- cc-001262 / cc-003765 | vector 0.9129 | token 0.3333
  - The ruler is small.
  - The basket is small.
  - Very close vector match; likely same learning example shape.
- cc-002624 / cc-003025 | vector 0.9129 | token 0.3333
  - The potato is small.
  - The story is small.
  - Very close vector match; likely same learning example shape.
- cc-003766 / cc-004052 | vector 0.9129 | token 0.3333
  - The ruler is brown.
  - The basket is brown.
  - Very close vector match; likely same learning example shape.
- cc-000290 / cc-000364 | vector 0.9117 | token 0.6667
  - Please put the cup on the table for me.
  - Please put the box on the table for me.
  - Very close vector match; likely same learning example shape.
- cc-001083 / cc-002585 | vector 0.9116 | token 0.6
  - A brother puts the basket in the box.
  - A brother puts the basket in the bag.
  - Very close vector match; likely same learning example shape.
- cc-000956 / cc-003985 | vector 0.9114 | token 0.6
  - Please put the bag on the table.
  - Please put the castle on the table.
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

