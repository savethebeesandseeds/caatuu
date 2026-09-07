# Image retrieval and course databases

Semantic artwork lookups for the games below use the shared English image service in
[english-image-search.mjs](../apps/language-runtime/static/source/english-image-search.mjs).
Verb Nebula searches Macaw actions; Word World and Grammar Gravity noun
illustrations search the visual vocabulary catalog. Developer image search
uses the same service. Game rounds, scoring, difficulty, learner content, and
saved progress are independent of image retrieval.

## Shared artwork index

The shared [image index](../apps/language-runtime/static/data/image-embeddings/minilm-v1.json)
stores normalized MiniLM vectors for the English descriptions in the two
authoritative image keymaps. It lives under the language runtime, has one
shared Android asset mapping, and is included in all browser course caches.
The service uses the live catalog to restrict results to available, allowed
artwork. A changed description cannot silently reuse an old vector.

These are text embeddings of artwork descriptions, not embeddings of pixels.
The intended result is the nearest available semantic association by embedding
distance. It need not depict the sentence literally. Missing an exact scene is
not a defect and does not require generating one image per sentence, forcing
particular results, or changing relevance thresholds. Finished shared artwork
belongs in `apps/launcher/static/assets/visual-vocabulary/`.

Each new query requires only its English vector; artwork vectors are computed
ahead of time. Model inference is queued across same-origin game frames.
The service caches the index and recent query vectors, and reports `mode`
and an explanatory `reason` if an unavailable model or stale index requires
keyword fallback. A queue timeout does not launch overlapping inference.
Word World no longer picks unrelated fallback images by hashing record IDs.

The index is generated directly from the shared keymaps and the pinned shared
MiniLM runtime, without reading or modifying a Czech database. Run from the
canonical checkout with the established container:

```powershell
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs --check
```

Regenerate after changing image descriptions or catalog membership. The builder
checks the pinned model bytes; validation checks model identity, source hashes,
exact row coverage, dimensions and normalized finite vectors. Refresh the
course setup manifests after source/index changes using the existing
`apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses` workflow.

## Course-owned data

| Data | Owner and current use |
| --- | --- |
| Czech MiniLM curriculum SQLite | Czech curriculum retrieval; historical artwork tables retained for compatibility |
| Czech local-hash SQLite | Retained older index for comparison/recovery |
| Czech–English dictionary SQLite | Full Czech dictionary and inflected-form lookup |
| Mandarin, Spanish and English-from-Spanish JSON catalogs | Reviewed course content and shared-English concept realizations; use the shared model for semantic ranking |
| Shared image index | Current game/developer artwork retrieval for every course |

The newer courses have no equivalent full dictionary database and declare
`dictionary: false`. Their JSON content is intentional; an empty SQLite file
would not supply missing dictionary coverage. This repair neither fabricates
dictionary entries nor enables an unsupported dictionary capability. All
three existing Czech SQLite files and their contents are preserved.

The index establishes a consistent retrieval path and avoids recalculating
hundreds of artwork vectors during play. It does not certify every nearest
image as a good teaching illustration or change the fixed content-quality rubric.

## Repair verification — 2026-09-07

- 87 focused runtime tests passed, including retrieval deadlines, index integrity,
  Verb Nebula behavior, noun visuals, multilingual Word World, and the Czech
  Word World UI/controls baseline. Eight Android source asset tests passed;
  they verify one shared setup-delivered index and exact packaged-image coverage.
- All four browser setup manifests include the index. Repository file policy,
  Markdown links, and whitespace checks passed.
- Live browser image search reported `English MiniLM similarity`. Czech and
  English-from-Spanish Word World displayed decoded artwork. On the reported
  English Verb Nebula board, listen, work, speak and remember all displayed
  decoded images; the existing two matched answers and rewards were preserved.
- All three Czech SQLite files have the same SHA-256 hashes as before this repair.
  No APK was built and nothing was deployed.

The live check returned a nursery illustration for “Tomorrow is Tuesday.” The
initial review called the lack of a calendar a coverage defect. The user
subsequently clarified that approximate semantic associations are intentional;
that earlier interpretation is superseded. The approved calendar can extend the
shared visual vocabulary, but it must compete through the same embedding ranking
as every other image. No sentence-to-image mapping is required. Retrieval
integrity and truthful image descriptions remain independently verifiable.
