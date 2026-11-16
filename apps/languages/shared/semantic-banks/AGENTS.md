# Game semantic banks

These files are the master English list. One bank per game. Each course that has the game has one `content.json` derived from this bank. Do not edit a bank except to add a new row with the next free id. A game reads the course `content.json`. An empty target there means untranslated and not playable. Filling a translation is a later hand edit.

Do not add a command that regenerates these files. A generator would erase hand edits.

## Files

| File | What it lists |
| --- | --- |
| `word-net.json` | Word Net sentences for all ten courses |
| `verb-lab.json` | Playable Verb Lab glosses that already have a difficulty |
| `memory-moon.json` | Memory Moon scene lines for all ten courses |
| `conjugation-comet.json` | Verb meanings for every course that has Conjugation Comet |
| `grammar-gravity.json` | Grammar example lines for every course that has Grammar Gravity |
| `naturalization-nucleus.json` | Reading glosses for Mandarin and Arabic |
| `case-cosmos.json` | Czech noun-case sentences and lesson contexts |

Sounds Quasar has no file here. Its listening bank is rebuilt from that course's Verb Lab pairs and Word World sentences. Campaign has no content bank. Grammar Gravity's noun bank and the Case Cosmos paradigm tables stay in the course files.

The junction guide `.tmp/caatu_junctions_child_friendly.json` is a reference for patterns. It is not a semantic bank and it is not a course file.

## Row

Each file is a JSON array sorted by `englishText`. Write UTF-8, two-space indentation, and a final newline.

```json
{
  "id": "sb.word-net.000042",
  "englishText": "The book is on the table.",
  "difficulty": 0,
  "usefulness": 90
}
```

- `id` is the permanent key for a later translation in a course content JSON. Shape: `sb.<game>.<six digits>`, as in `sb.word-net.000042`. It is assigned once. Never renumber a row, and never reuse an id after a row is removed. A new row takes the next free number in that bank.
- `englishText` is one natural English line. A child can say it.
- `difficulty` is an integer from 0 to 3. Keep the line's current difficulty unless it fights the line's real complexity.
- `usefulness` is an integer from 1 to 100. Everyday things a child says stay high.

A row has those four fields. It carries no course list, translation, tokens, readings, pronunciation, or complexity. The course file keeps the translation. The bank id is how a later edit finds the matching course line.

## Guardrails

Keep the material gentle, kind, practical, and intellectually honest. A child should meet curiosity, compassion, and independent judgment. Leave out propaganda, indoctrination, stereotypes, and aggressive vocabulary.

- Say the thing a child would say. Audit tags stay out of the line. That includes "(to a woman)", "(to a man)", "(formal or plural)", "(male)", and "(female)".
- In Word Net and Memory Moon, a bare noun or verb such as "water" or "eat" should be a short sentence when one already exists, or when the word has no communicative job on its own. "I want some water." is the line to keep. Do not invent a sentence for every leftover word.
- Keep real one-word replies: "Hello!", "Yes.", "No.", "Please.", "Help!", "Sorry!", "Goodbye!", "Stop!", and the counting answers "one" through "five".
- Verb Lab glosses, Conjugation labels, Naturalization readings, letter names, and Grammar agreement phrases stay as short as their job requires. "warm bread" can be the grammar item. "to eat" can be the verb.
- Most lines are examples of a child junction, such as "X is on Y" or "X wants Y". Letter names and script labels may stay; they are not junctions.
- Junctions do not share one difficulty. Do not stamp one level onto every example of a pattern unless the user asks for that revision.
- When two lines contrast a relation, reuse a familiar noun and verb. "The book is on the table." and "The book is under the table." teach the relation. A new rare noun does not.
- A situation such as the airport, home, or school should give the child something to ask, answer, or do. A pile of isolated true sentences is not enough.
- Repeated copies of one sentence keep a few familiar nouns. Stone, wood, water, glass, ball, and stick are enough for a physics pattern. Drop the extra metals and instruments.
- Drop a frame that cannot be said, such as "to dance a ticket."
- Drop a non-English gloss that leaked into the English list, such as "gatear."
- Drop "kill" and "hate" from this list.
- English-from-Spanish Verb Lab stores Spanish in `source` and English in `target` and `englishAuditText`. The English line comes from those English fields. A Spanish infinitive such as "abrazar" does not belong in `englishText`.
- Case Cosmos difficulty follows the Czech form being practiced. "I am giving the dog water." can stay easier than "I am giving the kitten water." because `pes` and `kotě` are different declensions. Do not equalize them from the English alone.
- A copied textbook frame, such as "A definition is assigned to the acceleration," is noise. Remove the frame. Do not keep it by swapping in "time" or "length." "Although the time changes, the rule remains valid" is still that frame.
- "I have time for reading" and "I do not have time for playing" are real. A grid that pairs "I devote time to" with every hobby is not.
- One child name is enough for a repeated action. Keep "Dani buys a ticket." Drop the same sentence under David, Leah, Maya, and the rest of that name list.
- Keep a place question a child would ask: "Where is the airport?", "Where is the bathroom?", "Where is the book?" Drop "The athlete is here" when it is only one more noun in a copied list.
- Verb Lab place grids are noise when the action cannot happen there. Drop "to answer at the sea" and "to dance at the office." "to dance at home" and "to dance in the garden" can stay. "to open in the evening" and "to count in the morning" are the same kind of grid.
- "The man next door buys a ticket" repeats "Dani buys a ticket." Keep Dani. Drop the next-door copy.
- "quantity of matter" and "surface area" are the same textbook frame as "acceleration." Remove those leftovers too.
- Repair a food line that lost its grammar: "Do you have apple?" becomes "Do you have an apple?", and "I like the beans because it is tasty" becomes "I like the beans because they are tasty." Keep apple, bread, and beans across have, eat, buy, and like.
- In Grammar Gravity, "The big book is here" and "The big books are here" are a number contrast. "a happy female doctor" and "a happy male doctor" are a gender contrast. Extra jobs such as engineer, hiker, and carpenter, on the same pattern, are only more vocabulary.
- Case Cosmos names such as Anna, Karel, and Eva are different case forms. Keep them. Letter lists stay too.
- Conjugation labels such as "place (present passive)" and Mandarin glosses such as "walk; work; be acceptable" keep a real distinction. Leave them.
- A file that parses is not yet good teaching material. Read the lines.
- Change a bad line in place when the line is still worth keeping. Remove it when it is noise. Leave a good line alone.

## Checks before handing the folder back

- The seven files above are the only semantic banks.
- Every row has `id`, `englishText`, `difficulty`, and `usefulness`. The id matches `sb.<game>.<six digits>`, difficulty is 0–3, and usefulness is 1–100. Ids are unique inside the bank.
- Rows are sorted by `englishText`, and each English line appears once in its file.
- Course JSON files are unchanged unless the user explicitly asked for those edits.
- No manifest, runtime loader, or Android asset list points at this folder.
