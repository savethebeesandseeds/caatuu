/**
 * Fixed evaluation examples, not a proposed curriculum or publication catalog.
 * Deliberate defects exercise inventory reporting without changing live content.
 * `fixture/` paths identify in-memory inputs; they are not repository files.
 */
const englishCourse = {
  id: 'fixture-en-cs',
  sourceLanguage: { id: 'en', locale: 'en-US' },
  targetLanguage: { id: 'cs', locale: 'cs-CZ' },
  games: ['verb-lab', 'word-net']
};
const spanishCourse = {
  id: 'fixture-es-en',
  sourceLanguage: { id: 'es', locale: 'es-ES' },
  targetLanguage: { id: 'en', locale: 'en-US' },
  games: ['verb-lab', 'word-net']
};

const czechSentences = [
  {
    id: 'fixture-greeting', difficulty: 1, usefulness: 95, complexity: 5,
    topic: 'greetings', englishText: 'Hello!', embeddingText: 'A friendly greeting: hello.',
    targetText: 'Ahoj!', tokens: [{ surface: 'Ahoj', normalized: 'ahoj', tokenIndex: 0, playable: true }],
    learnerBase: null
  },
  {
    id: 'fixture-greeting-formal', difficulty: 3, usefulness: 70, complexity: 90,
    topic: 'greetings', englishText: 'Hello!', embeddingText: 'A friendly greeting: hello.',
    targetText: 'Dobrý den!', tokens: [
      { surface: 'Dobrý', normalized: 'dobrý', tokenIndex: 0, playable: true },
      { surface: 'den', normalized: 'den', tokenIndex: 1, playable: true }
    ], learnerBase: null
  },
  {
    id: 'fixture-missing-translation', difficulty: 2, usefulness: 45, complexity: 45,
    topic: 'travel', englishText: 'Where is the station?', embeddingText: 'Where is the station?',
    targetText: '', tokens: [], learnerBase: null
  }
];

/** Catalog shape consumed by buildEvaluationCorpus(); no I/O or evaluator runs. */
export const fixtureCatalogs = [
  {
    course: englishCourse, resource: 'verbNebulaCatalog', game: 'verb-nebula',
    path: 'fixture/en-cs/verbs.json', document: [
      { id: 'fixture-run', cs: 'běžet', en: 'run', kind: 'V', difficulty: 1, usefulness: 95, complexity: 10, category: 'motion' },
      { id: 'fixture-walk', cs: 'jít', en: 'walk', kind: 'V', difficulty: 3, usefulness: 80, complexity: 95, category: 'motion' },
      // Same English source is deliberately filtered from the playable pair bank.
      { id: 'fixture-run-duplicate', cs: 'utíkat', en: 'run', kind: 'V', difficulty: 2, usefulness: 60, complexity: 45, category: 'motion' },
      // Raw dictionary noun belongs to authoring inventory, not verb exercises.
      { id: 'fixture-noun', cs: 'kočka', en: 'cat', kind: 'N', difficulty: 1, usefulness: 85, complexity: 15, category: 'animals' },
      { id: 'fixture-missing-english', cs: 'spát', en: '', kind: 'V', difficulty: 1, usefulness: 75, complexity: 20 },
      { id: 'fixture-missing-target', cs: '', en: 'swim', kind: 'V', difficulty: 2, usefulness: 50, complexity: 40 },
      // Runtime compatibility defaults must not hide missing authored metadata.
      { id: 'fixture-missing-grades', cs: 'číst', en: 'read', kind: 'V', category: 'learning' }
    ]
  },
  {
    course: spanishCourse, resource: 'verbNebulaCatalog', game: 'verb-nebula',
    path: 'fixture/es-en/verbs.json', document: [
      { id: 'fixture-run', target: 'run', source: 'correr', englishAuditText: 'run', kind: 'verb', difficulty: 2, usefulness: 90, complexity: 30, category: 'motion' },
      { id: 'fixture-eat', target: 'eat', source: 'comer', englishAuditText: 'eat', kind: 'verb', difficulty: 1, usefulness: 90, complexity: 10, category: 'food' }
    ]
  },
  {
    course: englishCourse, resource: 'wordWorldAuthoring', game: 'word-world',
    path: 'fixture/en-cs/word-world.json',
    document: {
      schemaVersion: 'caatuu-word-world-course-content-v1', courseId: englishCourse.id,
      sourceLanguage: 'en-US', targetLanguage: 'cs-CZ', metadata: {}, records: czechSentences
    },
    runtime: {
      kind: 'standard', document: {
        records: czechSentences.map(item => ({
          id: item.id, cs: item.targetText, en: item.englishText,
          difficulty: item.difficulty, usefulness: item.usefulness, complexity: item.complexity,
          topic: item.topic, targets: item.tokens
        }))
      }
    }
  },
  {
    course: spanishCourse, resource: 'wordWorldAuthoring', game: 'word-world',
    path: 'fixture/es-en/word-world.json',
    // No runtime supplied: availability must stay unknown, not be fabricated.
    document: {
      schemaVersion: 'caatuu-word-world-course-content-v1', courseId: spanishCourse.id,
      sourceLanguage: 'es-ES', targetLanguage: 'en-US', metadata: {}, records: [
        {
          id: 'fixture-greeting', difficulty: 1, usefulness: 95, complexity: 5,
          topic: 'greetings', englishText: 'Hello!', embeddingText: 'A friendly greeting: hello.',
          targetText: 'Hello!', tokens: [{ surface: 'Hello', playable: true }],
          learnerBase: { text: '¡Hola!', tokenMeanings: ['hola'] }
        }
      ]
    }
  },
  {
    course: { ...englishCourse, id: 'cz', games: ['case-cosmos'] },
    resource: 'caseCosmosCatalog', game: 'case-cosmos', path: 'fixture/cz/cases.json',
    // Deliberately incomplete bank: exercise nested authoring traversal and
    // structural-parent English absence while the actual game validator rejects
    // playability. A complete bank needs every case and all difficulty levels.
    document: {
      schemaVersion: 'caatuu-case-cosmos-content-v2', courseId: 'cz', contentRevision: 1,
      curriculum: { schemaVersion: 1, objectives: [] }, paradigms: [], contexts: [],
      legacyNouns: [{
        noun: 'Petr', difficulty: 1, usefulness: 80, complexity: 30,
        cases: {
          Nominative: { form: 'Petr', english: 'Petr is reading.', czech: 'Petr čte.', usefulness: 80, complexity: 20 },
          Accusative: { form: 'Petra', english: 'I see Petr.', czech: 'Vidím Petra.', usefulness: 70, complexity: 50 }
        }
      }]
    }
  }
];
