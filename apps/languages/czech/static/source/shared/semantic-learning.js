(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before semantic learning.");

  const databaseName = course.storage.semanticLearningDatabase
    || `${course.storage.namespace || `caatuu-${course.id}`}.semantic-learning`;
  const databaseVersion = 2;
  const defaultEmbeddingModelId = "all-minilm-l6-v2-qint8-v0.1";
  const embeddingDimension = 384;
  const maximumProjectionAxes = 12;
  const embeddingInputPolicy = "english_text_only";
  const storeNames = Object.freeze({
    attempts: "attempts",
    ledger: "ledger",
    receipts: "receipts",
    evidence: "evidence",
    embeddings: "embeddings",
    meta: "meta"
  });
  let coreModule = null;
  const corePromise = import("./semantic-learning-core.mjs?v=semantic-learning-core-5").then((core) => {
    coreModule = core;
    return core;
  });
  const storedAttemptNormalization = Object.freeze({
    enforceStorageLimits: false,
    allowDerivedConceptId: true
  });
  let databasePromise = null;
  let operationQueue = Promise.resolve();
  let lastError = "";
  let semanticWorkGeneration = 0;
  const pendingPrefix = `${databaseName}.pending-attempt.v1.`;
  const progressEpochStorageKey = `${databaseName}.progress-epoch.v1`;
  const initialProgressEpoch = "semantic-progress-epoch-0";
  const pendingLimit = 128;
  const pendingAttempts = new Map();
  const durablePendingIds = new Set();
  const blockedPendingKeys = new Set();
  let progressEpoch = initialProgressEpoch;
  let progressEpochUnpersisted = false;
  let progressResetGeneration = 0;
  const semanticChangeChannel = typeof window.BroadcastChannel === "function"
    ? new window.BroadcastChannel(`${databaseName}.changes`)
    : null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    if (!window.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = (event) => upgradeDatabase(request.result, request.transaction, event.oldVersion);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error(`Could not open ${databaseName}.`));
      request.onblocked = () => reject(new Error(`Opening ${databaseName} was blocked by another tab.`));
    }).catch((error) => {
      databasePromise = null;
      lastError = error?.message || String(error);
      throw error;
    });
    return databasePromise;
  }

  function upgradeDatabase(database, transaction, oldVersion = 0) {
    const attempts = database.objectStoreNames.contains(storeNames.attempts)
      ? transaction.objectStore(storeNames.attempts)
      : database.createObjectStore(storeNames.attempts, { keyPath: "id" });
    ensureIndex(attempts, "occurredAtMs", "occurredAtMs");
    ensureIndex(attempts, "activityId", "activityId");
    ensureIndex(attempts, "itemId", "itemId");

    const ledger = database.objectStoreNames.contains(storeNames.ledger)
      ? transaction.objectStore(storeNames.ledger)
      : database.createObjectStore(storeNames.ledger, { keyPath: "statementKey" });
    ensureIndex(ledger, "kind", "kind");
    ensureIndex(ledger, "lastOccurredAtMs", "lastOccurredAtMs");

    const receipts = database.objectStoreNames.contains(storeNames.receipts)
      ? transaction.objectStore(storeNames.receipts)
      : database.createObjectStore(storeNames.receipts, { keyPath: "id" });
    ensureIndex(receipts, "compactedAtMs", "compactedAtMs");

    const evidence = database.objectStoreNames.contains(storeNames.evidence)
      ? transaction.objectStore(storeNames.evidence)
      : database.createObjectStore(storeNames.evidence, { keyPath: "statementKey" });
    ensureIndex(evidence, "kind", "kind");
    ensureIndex(evidence, "lastOccurredAtMs", "lastOccurredAtMs");

    const embeddings = database.objectStoreNames.contains(storeNames.embeddings)
      ? transaction.objectStore(storeNames.embeddings)
      : database.createObjectStore(storeNames.embeddings, { keyPath: "key" });
    ensureIndex(embeddings, "modelId", "modelId");
    ensureIndex(embeddings, "textHash", "textHash");
    ensureIndex(embeddings, "createdAtMs", "createdAtMs");
    if (oldVersion > 0 && oldVersion < 2) embeddings.clear();

    if (!database.objectStoreNames.contains(storeNames.meta)) {
      database.createObjectStore(storeNames.meta, { keyPath: "key" });
    }
  }

  function ensureIndex(store, name, keyPath, options = {}) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionFinished(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    });
  }

  function enqueueOperation(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result.catch((error) => {
      lastError = error?.message || String(error);
      throw error;
    });
  }

  function newAttemptId() {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    return `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function newWorkEpochToken() {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    return `semantic-work-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function reportSaveFailure(key, error) {
    lastError = error?.message || String(error);
    window.CaatuuLearning?.reportSaveFailure?.(key, error);
  }

  function clearSaveFailure(key) {
    window.CaatuuLearning?.clearSaveFailure?.(key);
  }

  const pendingKey = (id) => `${pendingPrefix}${encodeURIComponent(id)}`;
  const pendingCommitKey = (id) => `pending-attempt-commit:${id}`;

  function readProgressEpoch() {
    if (progressEpochUnpersisted) return progressEpoch;
    try {
      progressEpoch = window.localStorage.getItem(progressEpochStorageKey) || initialProgressEpoch;
    } catch (error) {
      reportSaveFailure(progressEpochStorageKey, error);
    }
    return progressEpoch;
  }

  function rememberProgressEpoch(token) {
    progressEpoch = token;
    try {
      window.localStorage.setItem(progressEpochStorageKey, token);
      progressEpochUnpersisted = false;
      clearSaveFailure(progressEpochStorageKey);
    } catch (error) {
      progressEpochUnpersisted = true;
      reportSaveFailure(progressEpochStorageKey, error);
    }
  }

  function persistPending(row) {
    const key = pendingKey(row.attempt.id);
    try {
      const existing = window.localStorage.getItem(key);
      if (existing !== null && existing !== JSON.stringify(row)) {
        const stored = JSON.parse(existing);
        if (!coreModule || stored.progressEpoch !== row.progressEpoch || !coreModule.semanticAttemptsEqual(stored.attempt, row.attempt)) {
          blockedPendingKeys.add(key);
          throw new Error("A different pending learning record already uses this id.");
        }
      }
      if (existing === null) window.localStorage.setItem(key, JSON.stringify(row));
      durablePendingIds.add(row.attempt.id);
      return true;
    } catch (error) {
      // Keep the exact event in memory even if its durable fallback cannot be written.
      reportSaveFailure(key, error);
      return false;
    }
  }

  function removePending(row) {
    const key = pendingKey(row.attempt.id);
    try {
      window.localStorage.removeItem(key);
      pendingAttempts.delete(row.attempt.id);
      durablePendingIds.delete(row.attempt.id);
      blockedPendingKeys.delete(key);
      clearSaveFailure(key);
      return true;
    } catch (error) {
      reportSaveFailure(key, error);
      return false;
    }
  }

  async function loadPendingAttempts() {
    const core = await corePromise;
    const keys = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(pendingPrefix)) keys.push(key);
      }
      clearSaveFailure(pendingPrefix);
    } catch (error) {
      reportSaveFailure(pendingPrefix, error);
      return;
    }
    for (const key of keys) {
      if (blockedPendingKeys.has(key)) continue;
      let raw;
      try { raw = window.localStorage.getItem(key); } catch (error) {
        reportSaveFailure(key, error);
        continue;
      }
      if (raw === null) {
        clearSaveFailure(key);
        continue;
      }
      try {
        const row = JSON.parse(raw);
        if (row?.schemaVersion !== 1 || typeof row.progressEpoch !== "string") {
          throw new Error("The pending learning record has an unsupported format.");
        }
        const attempt = core.normalizeSemanticAttempt(row.attempt);
        if (key !== pendingKey(attempt.id)) throw new Error("The pending learning record id does not match its key.");
        if (!pendingAttempts.has(attempt.id) && pendingAttempts.size >= pendingLimit) {
          reportSaveFailure(pendingPrefix, new Error("The pending learning queue is full. Retry saving before continuing."));
          break;
        }
        if (!pendingAttempts.has(attempt.id)) pendingAttempts.set(attempt.id, { ...row, attempt });
        durablePendingIds.add(attempt.id);
      } catch (error) {
        // Preserve malformed records for recovery, but never continuously retry them.
        blockedPendingKeys.add(key);
        reportSaveFailure(key, error);
      }
    }
  }

  async function finishPending(row) {
    const key = pendingKey(row.attempt.id);
    if (blockedPendingKeys.has(key)) throw new Error("This pending learning record needs repair before it can be retried.");
    // A different tab may already have committed and removed a durable row. Never
    // recreate its stale in-memory copy; check its presence inside the IDB transaction.
    if (!durablePendingIds.has(row.attempt.id)) persistPending(row);
    if (blockedPendingKeys.has(key)) throw new Error("This pending learning record needs repair before it can be retried.");
    try {
      const result = await writeAttempt(row.attempt, {
        progressEpoch: row.progressEpoch,
        requirePendingEntry: durablePendingIds.has(row.attempt.id)
      });
      if (removePending(row)) {
        // The transactional receipt prevents replay after a crash or failed localStorage cleanup,
        // even after ordinary compacted attempt receipts have expired.
        try {
          const database = await openDatabase();
          const transaction = database.transaction(storeNames.meta, "readwrite");
          const finished = transactionFinished(transaction);
          await requestResult(transaction.objectStore(storeNames.meta).delete(pendingCommitKey(row.attempt.id)));
          await finished;
        } catch (error) {
          // The learning event is already committed. Receipt housekeeping must not unscore it.
          reportSaveFailure(pendingPrefix, error);
        }
      }
      return result;
    } catch (error) {
      if (error?.name === "StaleProgressError") {
        removePending(row);
      } else {
        if (error?.name === "InvalidAttemptError") blockedPendingKeys.add(key);
        reportSaveFailure(key, error);
      }
      throw error;
    }
  }

  function retryPendingAttempts() {
    return enqueueOperation(async () => {
      await loadPendingAttempts();
      try {
        const database = await openDatabase();
        const transaction = database.transaction(storeNames.meta, "readwrite");
        const finished = transactionFinished(transaction);
        const meta = transaction.objectStore(storeNames.meta);
        const stored = await requestResult(meta.get("semantic-progress-epoch"));
        const rows = await requestResult(meta.getAll());
        for (const row of rows) {
          if (!row.key?.startsWith("pending-attempt-commit:")) continue;
          const id = row.key.slice("pending-attempt-commit:".length);
          try {
            if (!pendingAttempts.has(id) && window.localStorage.getItem(pendingKey(id)) === null) {
              await requestResult(meta.delete(row.key));
            }
          } catch (error) {
            reportSaveFailure(pendingPrefix, error);
          }
        }
        await finished;
        rememberProgressEpoch(stored?.token || initialProgressEpoch);
      } catch (error) {
        if (pendingAttempts.size) reportSaveFailure(pendingPrefix, error);
      }
      const failures = [];
      for (const row of [...pendingAttempts.values()]) {
        if (blockedPendingKeys.has(pendingKey(row.attempt.id))) continue;
        try { await finishPending(row); } catch (error) {
          if (error?.name !== "StaleProgressError") failures.push(error);
        }
      }
      if (failures.length) throw failures[0];
      return { pendingCount: pendingAttempts.size };
    });
  }

  function invalidateSemanticWork() {
    semanticWorkGeneration += 1;
    return semanticWorkGeneration;
  }

  function staleSemanticWorkError() {
    const error = new Error("Semantic projection was superseded by a cache clear or progress reset.");
    error.name = "AbortError";
    return error;
  }

  function cancelledProjectionError(reason) {
    const error = new Error("Semantic projection was cancelled.");
    error.name = "AbortError";
    if (reason !== undefined) error.cause = reason;
    return error;
  }

  function assertSemanticWorkCurrent(generation) {
    if (generation !== semanticWorkGeneration) throw staleSemanticWorkError();
  }

  function assertProjectionCurrent(generation, signal) {
    assertSemanticWorkCurrent(generation);
    if (signal?.aborted) throw cancelledProjectionError(signal.reason);
  }

  function persistedWorkEpoch(row) {
    return String(row?.token || "semantic-work-epoch-0");
  }

  function emitChange(reason, detail = {}) {
    if (typeof window.CustomEvent !== "function" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new window.CustomEvent("caatuu:semantic-learning-change", {
      detail: { reason, ...detail }
    }));
  }

  function announceChange(reason, detail = {}) {
    emitChange(reason, detail);
    semanticChangeChannel?.postMessage({ reason, detail });
  }

  semanticChangeChannel?.addEventListener("message", (event) => {
    const reason = String(event?.data?.reason || "remote-change");
    if (reason === "progress-reset" || reason === "embedding-cache-reset") invalidateSemanticWork();
    if (reason === "progress-reset") {
      progressResetGeneration += 1;
      readProgressEpoch();
    }
    emitChange(reason, { ...(event?.data?.detail || {}), remote: true });
  });

  async function rebuildEvidenceInTransaction(transaction, core, metadata = {}) {
    const attempts = await requestResult(transaction.objectStore(storeNames.attempts).getAll());
    const ledger = await requestResult(transaction.objectStore(storeNames.ledger).getAll());
    const rebuilt = core.rebuildSemanticEvidence(attempts, {
      baseline: ledger,
      normalizeOptions: storedAttemptNormalization
    });
    const evidence = transaction.objectStore(storeNames.evidence);
    await requestResult(evidence.clear());
    for (const node of rebuilt) await requestResult(evidence.put(node));
    await requestResult(transaction.objectStore(storeNames.meta).put({
      key: "evidence-state",
      reducerVersion: core.semanticLearningSchema.evidenceReducerVersion,
      ledgerVersion: core.semanticLearningSchema.historyLedgerVersion,
      updatedAt: new Date().toISOString(),
      rebuiltFromAttempts: attempts.length,
      rebuiltFromLedger: ledger.length,
      ...metadata
    }));
    return { attempts, ledger, rebuilt };
  }

  async function migrateLedgerInTransaction(transaction, core, fromVersion) {
    const ledgerStore = transaction.objectStore(storeNames.ledger);
    const rows = await requestResult(ledgerStore.getAll());
    if (fromVersion === core.semanticLearningSchema.historyLedgerVersion) {
      return { migrated: false, rows };
    }
    const migrated = core.migrateSemanticLedger(rows, fromVersion);
    await requestResult(ledgerStore.clear());
    for (const row of migrated) await requestResult(ledgerStore.put(row));
    if (migrated.length) {
      const meta = transaction.objectStore(storeNames.meta);
      const previousHistory = await requestResult(meta.get("history-state"));
      await requestResult(meta.put({
        ...(previousHistory || {}),
        key: "history-state",
        truthFormat: "compact-ledger-v2",
        policyVersion: core.boundedSemanticHistoryPolicy.version,
        ledgerVersion: core.semanticLearningSchema.historyLedgerVersion,
        temporalSummaryVersion: core.semanticLearningSchema.temporalSummaryVersion,
        temporalHistoryExactAfterMigration: false,
        migratedAt: new Date().toISOString()
      }));
    }
    return { migrated: true, rows: migrated, previousCount: rows.length };
  }

  async function ensureEvidenceReducerCurrentInTransaction(transaction, core) {
    const targetVersion = core.semanticLearningSchema.evidenceReducerVersion;
    const state = await requestResult(transaction.objectStore(storeNames.meta).get("evidence-state"));
    const targetLedgerVersion = core.semanticLearningSchema.historyLedgerVersion;
    if (
      Number(state?.reducerVersion) === targetVersion
      && Number(state?.ledgerVersion) === targetLedgerVersion
    ) {
      return { rebuilt: false, reducerVersion: targetVersion };
    }
    const previousVersion = Number(state?.reducerVersion) || 0;
    const previousLedgerVersion = Number(state?.ledgerVersion) || 0;
    const ledgerMigration = await migrateLedgerInTransaction(
      transaction,
      core,
      previousLedgerVersion
    );
    const { attempts, ledger, rebuilt } = await rebuildEvidenceInTransaction(transaction, core, {
      migratedFromReducerVersion: previousVersion,
      migratedFromLedgerVersion: previousLedgerVersion,
      ledgerRowsMigrated: ledgerMigration.migrated ? ledgerMigration.previousCount : 0
    });
    return {
      rebuilt: true,
      previousVersion,
      previousLedgerVersion,
      reducerVersion: targetVersion,
      ledgerVersion: targetLedgerVersion,
      attemptCount: attempts.length,
      ledgerCount: ledger.length,
      evidenceCount: rebuilt.length
    };
  }

  function announceEvidenceMigration(migration) {
    if (!migration?.rebuilt) return;
    announceChange("evidence-migrated", migration);
  }

  function announceHistoryCompaction(compaction) {
    if (!compaction?.compacted) return;
    announceChange("history-compacted", compaction);
  }

  async function compactHistoryInTransaction(transaction, core, { force = false } = {}) {
    const policy = core.boundedSemanticHistoryPolicy;
    const attempts = transaction.objectStore(storeNames.attempts);
    const retainedCount = await requestResult(attempts.count());
    const shouldCompact = force
      ? retainedCount > policy.rawAttemptTarget
      : retainedCount > policy.rawAttemptLimit;
    if (!shouldCompact) {
      return { compacted: false, compactedCount: 0, retainedCount };
    }

    const compactedCount = retainedCount - policy.rawAttemptTarget;
    const orderedAttempts = await requestResult(attempts.index("occurredAtMs").getAll());
    orderedAttempts.sort((left, right) => (
      left.occurredAtMs - right.occurredAtMs || left.id.localeCompare(right.id)
    ));
    const compactedAttempts = orderedAttempts.slice(0, compactedCount);
    const ledgerStore = transaction.objectStore(storeNames.ledger);
    const ledgerRows = await requestResult(ledgerStore.getAll());
    const ledgerByStatement = new Map(ledgerRows.map((node) => [node.statementKey, node]));
    const changedStatements = new Set();

    for (const attemptInput of compactedAttempts) {
      const attempt = core.normalizeSemanticAttempt(attemptInput, storedAttemptNormalization);
      for (const signal of attempt.signals) {
        const next = core.applyAttemptToEvidence(ledgerByStatement.get(signal.statementKey), attempt, signal);
        ledgerByStatement.set(signal.statementKey, {
          ...next,
          ledgerVersion: core.semanticLearningSchema.historyLedgerVersion
        });
        changedStatements.add(signal.statementKey);
      }
    }
    for (const statementKey of changedStatements) {
      await requestResult(ledgerStore.put(ledgerByStatement.get(statementKey)));
    }

    const receipts = transaction.objectStore(storeNames.receipts);
    const compactedAtMs = Date.now();
    for (const attempt of compactedAttempts) {
      await requestResult(receipts.put({
        id: attempt.id,
        fingerprint: core.semanticAttemptFingerprint(attempt, storedAttemptNormalization),
        fingerprintVersion: 1,
        occurredAtMs: attempt.occurredAtMs,
        compactedAtMs
      }));
      await requestResult(attempts.delete(attempt.id));
    }

    let receiptCount = await requestResult(receipts.count());
    if (receiptCount > policy.compactedReceiptLimit) {
      const receiptKeys = await requestResult(receipts.index("compactedAtMs").getAllKeys());
      const excess = receiptCount - policy.compactedReceiptLimit;
      for (const key of receiptKeys.slice(0, excess)) await requestResult(receipts.delete(key));
      receiptCount -= excess;
    }

    const meta = transaction.objectStore(storeNames.meta);
    const previousState = await requestResult(meta.get("history-state"));
    const nextState = {
      key: "history-state",
      truthFormat: "compact-ledger-v2",
      policyVersion: policy.version,
      ledgerVersion: core.semanticLearningSchema.historyLedgerVersion,
      temporalSummaryVersion: core.semanticLearningSchema.temporalSummaryVersion,
      compactedAttemptCount: (Number(previousState?.compactedAttemptCount) || 0) + compactedAttempts.length,
      compactionCount: (Number(previousState?.compactionCount) || 0) + 1,
      retainedAttemptCount: retainedCount - compactedAttempts.length,
      receiptCount,
      lastCompactedAt: new Date(compactedAtMs).toISOString(),
      lastCompactedAtMs: compactedAtMs
    };
    await requestResult(meta.put(nextState));
    return {
      compacted: true,
      compactedCount: compactedAttempts.length,
      retainedCount: nextState.retainedAttemptCount,
      receiptCount,
      lifetimeCompactedCount: nextState.compactedAttemptCount
    };
  }

  async function writeAttempt(input, options = {}) {
    const core = await corePromise;
    const suppliedId = input?.id === undefined || input?.id === null ? "" : String(input.id).trim();
    if (suppliedId && !String(input?.occurredAt || "").trim()) {
      throw new Error("Semantic attempts with a caller-supplied id must include occurredAt for idempotent retries.");
    }
    const attempt = core.normalizeSemanticAttempt({
      ...input,
      id: suppliedId || newAttemptId()
    });
    const database = await openDatabase();
    const transaction = database.transaction(
      [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.evidence, storeNames.meta],
      "readwrite"
    );
    const finished = transactionFinished(transaction);
    try {
      const meta = transaction.objectStore(storeNames.meta);
      if (options.progressEpoch !== undefined) {
        const epoch = await requestResult(meta.get("semantic-progress-epoch"));
        if (options.progressEpoch !== (epoch?.token || initialProgressEpoch)) {
          const error = new Error("This pending attempt belongs to progress that was explicitly reset.");
          error.name = "StaleProgressError";
          throw error;
        }
        if (options.requirePendingEntry && window.localStorage.getItem(pendingKey(attempt.id)) === null) {
          const error = new Error("This pending attempt was already removed by another page.");
          error.name = "StaleProgressError";
          throw error;
        }
        const commitKey = pendingCommitKey(attempt.id);
        const fingerprint = core.semanticAttemptFingerprint(attempt, storedAttemptNormalization);
        const committed = await requestResult(meta.get(commitKey));
        if (committed && committed.fingerprint !== fingerprint) {
          const error = new Error(`Attempt id ${attempt.id} refers to a different immutable event.`);
          error.name = "InvalidAttemptError";
          throw error;
        }
        if (committed) {
          await finished;
          return { duplicate: true, attempt };
        }
        await requestResult(meta.put({ key: commitKey, fingerprint }));
      }
      const migration = await ensureEvidenceReducerCurrentInTransaction(transaction, core);
      const attempts = transaction.objectStore(storeNames.attempts);
      const existing = await requestResult(attempts.get(attempt.id));
      if (existing) {
        if (!core.semanticAttemptsEqual(existing, attempt, storedAttemptNormalization)) {
          const error = new Error(`Attempt id ${attempt.id} refers to a different immutable event.`);
          error.name = "InvalidAttemptError";
          throw error;
        }
        const compaction = await compactHistoryInTransaction(transaction, core);
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        return { duplicate: true, attempt: existing };
      }
      const receipt = await requestResult(transaction.objectStore(storeNames.receipts).get(attempt.id));
      if (receipt) {
        if (receipt.fingerprint !== core.semanticAttemptFingerprint(attempt, storedAttemptNormalization)) {
          const error = new Error(`Attempt id ${attempt.id} refers to a different compacted event.`);
          error.name = "InvalidAttemptError";
          throw error;
        }
        const compaction = await compactHistoryInTransaction(transaction, core);
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        return { duplicate: true, compacted: true, attempt };
      }

      const evidence = transaction.objectStore(storeNames.evidence);
      const currentByStatement = new Map();
      for (const signal of attempt.signals) {
        currentByStatement.set(signal.statementKey, await requestResult(evidence.get(signal.statementKey)));
      }
      const evidenceCount = await requestResult(evidence.count());
      const newStatementCount = [...currentByStatement.values()].filter((node) => !node).length;
      const maximumStatementKeys = core.boundedSemanticHistoryPolicy.maximumStatementKeys;
      if (newStatementCount > 0 && evidenceCount + newStatementCount > Math.max(maximumStatementKeys, evidenceCount)) {
        const error = new Error(
          `Semantic capability limit reached (${maximumStatementKeys}). Add new course capabilities through an explicit ledger migration.`
        );
        error.name = "InvalidAttemptError";
        throw error;
      }

      await requestResult(attempts.add(attempt));
      for (const signal of attempt.signals) {
        const current = currentByStatement.get(signal.statementKey);
        const next = core.applyAttemptToEvidence(current, attempt, signal);
        await requestResult(evidence.put(next));
      }
      await requestResult(transaction.objectStore(storeNames.meta).put({
        key: "evidence-state",
        reducerVersion: core.semanticLearningSchema.evidenceReducerVersion,
        ledgerVersion: core.semanticLearningSchema.historyLedgerVersion,
        updatedAt: new Date().toISOString(),
        lastAttemptId: attempt.id
      }));
      const compaction = await compactHistoryInTransaction(transaction, core);
      await finished;
      announceEvidenceMigration(migration);
      announceHistoryCompaction(compaction);
      announceChange("attempt", { attemptId: attempt.id, statementKeys: attempt.signals.map((signal) => signal.statementKey) });
      return { duplicate: false, attempt, compaction };
    } catch (error) {
      try {
        transaction.abort();
      } catch (_) {
        // The transaction may already have failed or completed.
      }
      await finished.catch(() => {});
      throw error;
    }
  }

  function recordAttempt(input = {}) {
    const generation = progressResetGeneration;
    const capturedEpoch = readProgressEpoch();
    let captured;
    let row;
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Semantic attempt must be an object.");
      const suppliedId = input?.id === undefined || input?.id === null ? "" : String(input.id).trim();
      if (suppliedId && !String(input?.occurredAt || "").trim()) {
        throw new Error("Semantic attempts with a caller-supplied id must include occurredAt for idempotent retries.");
      }
      captured = JSON.parse(JSON.stringify({ ...input, id: suppliedId || newAttemptId(), occurredAt: input.occurredAt || new Date().toISOString() }));
      if (JSON.stringify(captured).length > 16384) throw new Error("Semantic attempt is too large to retain safely.");
      const key = pendingKey(captured.id);
      row = pendingAttempts.get(captured.id);
      if (!row) {
        let stored = null;
        let readable = true;
        try { stored = window.localStorage.getItem(key); } catch (error) {
          readable = false;
          reportSaveFailure(key, error);
        }
        if (stored !== null) {
          try {
            row = JSON.parse(stored);
            if (row?.schemaVersion !== 1 || row.attempt?.id !== captured.id || typeof row.progressEpoch !== "string") {
              throw new Error("The existing pending learning record has an unsupported format.");
            }
            durablePendingIds.add(captured.id);
          } catch (error) {
            blockedPendingKeys.add(key);
            reportSaveFailure(key, error);
            throw error;
          }
        }
        if (pendingAttempts.size >= pendingLimit) throw new Error("The pending learning queue is full. Retry saving before continuing.");
        row ||= { schemaVersion: 1, progressEpoch: capturedEpoch, attempt: captured };
        pendingAttempts.set(captured.id, row);
        // Capture before any Promise or IndexedDB work: closing the page immediately
        // after an answer must still leave its immutable event available for recovery.
        if (!durablePendingIds.has(captured.id) && readable) persistPending(row);
      }
    } catch (error) {
      reportSaveFailure(pendingPrefix, error);
      return Promise.reject(error);
    }
    return enqueueOperation(async () => {
      if (generation !== progressResetGeneration) throw staleSemanticWorkError();
      const core = await corePromise;
      let attempt;
      try { attempt = core.normalizeSemanticAttempt(captured); } catch (error) {
        blockedPendingKeys.add(pendingKey(captured.id));
        reportSaveFailure(pendingKey(captured.id), error);
        throw error;
      }
      if (!core.semanticAttemptsEqual(row.attempt, attempt)) {
        const error = new Error(`Attempt id ${attempt.id} refers to a different pending event.`);
        reportSaveFailure(pendingKey(attempt.id), error);
        throw error;
      }
      row.attempt = attempt;
      return finishPending(row);
    });
  }

  function readEvidence() {
    return enqueueOperation(async () => {
      const core = await corePromise;
      const database = await openDatabase();
      const transaction = database.transaction(
        [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.evidence, storeNames.meta],
        "readwrite"
      );
      const finished = transactionFinished(transaction);
      try {
        const migration = await ensureEvidenceReducerCurrentInTransaction(transaction, core);
        const compaction = await compactHistoryInTransaction(transaction, core);
        const rows = await requestResult(transaction.objectStore(storeNames.evidence).getAll());
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        return rows.sort((left, right) => String(left.statementKey).localeCompare(String(right.statementKey)));
      } catch (error) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have failed or completed.
        }
        await finished.catch(() => {});
        throw error;
      }
    });
  }

  function readAttempts() {
    return enqueueOperation(async () => {
      const core = await corePromise;
      const database = await openDatabase();
      const transaction = database.transaction(
        [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.evidence, storeNames.meta],
        "readwrite"
      );
      const finished = transactionFinished(transaction);
      try {
        const migration = await ensureEvidenceReducerCurrentInTransaction(transaction, core);
        const compaction = await compactHistoryInTransaction(transaction, core);
        const rows = await requestResult(transaction.objectStore(storeNames.attempts).getAll());
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        return rows.sort((left, right) => (
          left.occurredAtMs - right.occurredAtMs || left.id.localeCompare(right.id)
        ));
      } catch (error) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have failed or completed.
        }
        await finished.catch(() => {});
        throw error;
      }
    });
  }

  function rebuildEvidence() {
    return enqueueOperation(async () => {
      const core = await corePromise;
      const database = await openDatabase();
      const transaction = database.transaction(
        [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.evidence, storeNames.meta],
        "readwrite"
      );
      const finished = transactionFinished(transaction);
      try {
        const migration = await ensureEvidenceReducerCurrentInTransaction(transaction, core);
        const { attempts, ledger, rebuilt } = await rebuildEvidenceInTransaction(transaction, core);
        const compaction = await compactHistoryInTransaction(transaction, core);
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        announceChange("evidence-rebuilt", {
          retainedAttemptCount: attempts.length,
          ledgerCount: ledger.length,
          evidenceCount: rebuilt.length
        });
        return rebuilt;
      } catch (error) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have failed or completed.
        }
        await finished.catch(() => {});
        throw error;
      }
    });
  }

  function compactHistory() {
    return enqueueOperation(async () => {
      const core = await corePromise;
      const database = await openDatabase();
      const transaction = database.transaction(
        [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.evidence, storeNames.meta],
        "readwrite"
      );
      const finished = transactionFinished(transaction);
      try {
        const migration = await ensureEvidenceReducerCurrentInTransaction(transaction, core);
        const compaction = await compactHistoryInTransaction(transaction, core, { force: true });
        await finished;
        announceEvidenceMigration(migration);
        announceHistoryCompaction(compaction);
        return compaction;
      } catch (error) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have failed or completed.
        }
        await finished.catch(() => {});
        throw error;
      }
    });
  }

  function clearStores(names, reason, workEpochToken = "", resetEpochToken = "") {
    return enqueueOperation(async () => {
      const database = await openDatabase();
      const transactionNames = [...new Set([
        ...names,
        ...(workEpochToken ? [storeNames.meta] : [])
      ])];
      const transaction = database.transaction(transactionNames, "readwrite");
      const finished = transactionFinished(transaction);
      await Promise.all(names.map((name) => requestResult(transaction.objectStore(name).clear())));
      if (workEpochToken) {
        await requestResult(transaction.objectStore(storeNames.meta).put({
          key: "semantic-work-epoch",
          token: workEpochToken,
          changedAt: new Date().toISOString(),
          reason
        }));
      }
      if (resetEpochToken) {
        await requestResult(transaction.objectStore(storeNames.meta).put({
          key: "semantic-progress-epoch", token: resetEpochToken
        }));
      }
      await finished;
      if (resetEpochToken) rememberProgressEpoch(resetEpochToken);
      announceChange(reason, { workEpochToken });
      return { cleared: [...names], workEpochToken };
    });
  }

  function resetProgress() {
    invalidateSemanticWork();
    progressResetGeneration += 1;
    const token = newWorkEpochToken();
    rememberProgressEpoch(token);
    for (const row of pendingAttempts.values()) removePending(row);
    try {
      const keys = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(pendingPrefix)) keys.push(key);
      }
      for (const key of keys) {
        try {
          window.localStorage.removeItem(key);
          blockedPendingKeys.delete(key);
          clearSaveFailure(key);
        } catch (error) { reportSaveFailure(key, error); }
      }
    } catch (error) { reportSaveFailure(pendingPrefix, error); }
    return clearStores(Object.values(storeNames), "progress-reset", newWorkEpochToken(), token);
  }

  function clearEmbeddingCache() {
    invalidateSemanticWork();
    return clearStores([storeNames.embeddings], "embedding-cache-reset", newWorkEpochToken());
  }

  function embeddingKey(modelId, textHash) {
    return `${modelId}:${embeddingInputPolicy}:${textHash}`;
  }

  async function readWorkEpoch() {
    const database = await openDatabase();
    const transaction = database.transaction(storeNames.meta, "readonly");
    const finished = transactionFinished(transaction);
    const row = await requestResult(transaction.objectStore(storeNames.meta).get("semantic-work-epoch"));
    await finished;
    return persistedWorkEpoch(row);
  }

  async function assertPersistedWorkEpoch(expectedToken) {
    const currentToken = await readWorkEpoch();
    if (currentToken !== expectedToken) throw staleSemanticWorkError();
  }

  async function cachedEmbedding(modelId, text, textHash, generation, workEpochToken) {
    await operationQueue;
    assertSemanticWorkCurrent(generation);
    const database = await openDatabase();
    const transaction = database.transaction([storeNames.embeddings, storeNames.meta], "readwrite");
    const finished = transactionFinished(transaction);
    try {
      const currentEpoch = persistedWorkEpoch(
        await requestResult(transaction.objectStore(storeNames.meta).get("semantic-work-epoch"))
      );
      if (currentEpoch !== workEpochToken) throw staleSemanticWorkError();
      assertSemanticWorkCurrent(generation);
      const embeddings = transaction.objectStore(storeNames.embeddings);
      const key = embeddingKey(modelId, textHash);
      const row = await requestResult(embeddings.get(key));
      const valid = row
        && row.modelId === modelId
        && row.text === text
        && row.dimension === embeddingDimension
        && ArrayBuffer.isView(row.vector)
        && row.vector.length === embeddingDimension;
      if (!valid) {
        if (row) await requestResult(embeddings.delete(key));
        await finished;
        return null;
      }
      const accessedAtMs = Date.now();
      await requestResult(embeddings.put({
        ...row,
        lastAccessedAt: new Date(accessedAtMs).toISOString(),
        lastAccessedAtMs: accessedAtMs,
        createdAtMs: accessedAtMs
      }));
      await finished;
      assertSemanticWorkCurrent(generation);
      return Float32Array.from(row.vector);
    } catch (error) {
      try {
        transaction.abort();
      } catch (_) {
        // The transaction may already have failed or completed.
      }
      await finished.catch(() => {});
      throw error;
    }
  }

  async function cachedEmbeddingBatch(requests, modelId, generation, workEpochToken) {
    await operationQueue;
    assertSemanticWorkCurrent(generation);
    const requestedByKey = new Map(
      requests.map((request) => [request.key, request])
    );
    if (!requestedByKey.size) return new Map();
    const database = await openDatabase();
    const transaction = database.transaction([storeNames.embeddings, storeNames.meta], "readonly");
    const finished = transactionFinished(transaction);
    try {
      const currentEpoch = persistedWorkEpoch(
        await requestResult(transaction.objectStore(storeNames.meta).get("semantic-work-epoch"))
      );
      if (currentEpoch !== workEpochToken) throw staleSemanticWorkError();
      const rows = await requestResult(transaction.objectStore(storeNames.embeddings).getAll());
      await finished;
      assertSemanticWorkCurrent(generation);
      const cached = new Map();
      for (const row of rows) {
        const request = requestedByKey.get(row?.key);
        if (!request) continue;
        const valid = row.modelId === modelId
          && row.text === request.text
          && row.dimension === embeddingDimension
          && ArrayBuffer.isView(row.vector)
          && row.vector.length === embeddingDimension;
        if (valid) cached.set(row.key, {
          text: row.text,
          vector: Float32Array.from(row.vector)
        });
      }
      return cached;
    } catch (error) {
      await finished.catch(() => {});
      throw error;
    }
  }

  function storeEmbedding(
    row,
    generation,
    workEpochToken,
    assertCurrent = () => assertSemanticWorkCurrent(generation)
  ) {
    return enqueueOperation(async () => {
      assertCurrent();
      const core = await corePromise;
      assertCurrent();
      const policy = core.boundedSemanticHistoryPolicy;
      const database = await openDatabase();
      assertCurrent();
      const transaction = database.transaction([storeNames.embeddings, storeNames.meta], "readwrite");
      const finished = transactionFinished(transaction);
      try {
        const currentEpoch = persistedWorkEpoch(
          await requestResult(transaction.objectStore(storeNames.meta).get("semantic-work-epoch"))
        );
        if (currentEpoch !== workEpochToken) throw staleSemanticWorkError();
        assertCurrent();
        const embeddings = transaction.objectStore(storeNames.embeddings);
        assertCurrent();
        await requestResult(embeddings.put(row));
        assertCurrent();
        const embeddingCount = await requestResult(embeddings.count());
        if (embeddingCount > policy.embeddingLimit) {
          const keys = await requestResult(embeddings.index("createdAtMs").getAllKeys());
          const excess = embeddingCount - policy.embeddingTarget;
          for (const key of keys.slice(0, excess)) await requestResult(embeddings.delete(key));
        }
        await finished;
        assertCurrent();
        return row;
      } catch (error) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have failed or completed.
        }
        await finished.catch(() => {});
        throw error;
      }
    });
  }

  async function materializeEmbedding(text, modelId, generation, workEpochToken, options = {}) {
    const assertCurrent = typeof options.assertCurrent === "function"
      ? options.assertCurrent
      : () => assertSemanticWorkCurrent(generation);
    assertCurrent();
    const core = await corePromise;
    assertCurrent();
    const normalizedText = String(text || "").trim();
    if (!normalizedText) throw new Error("Semantic embedding text is required.");
    if (normalizedText.length > core.boundedSemanticHistoryPolicy.maximumEmbeddingTextCharacters) {
      throw new Error("Semantic embedding text is too large to cache safely.");
    }
    const textHash = core.semanticTextHash(normalizedText);
    if (!options.skipCacheLookup) {
      const cached = await cachedEmbedding(
        modelId,
        normalizedText,
        textHash,
        generation,
        workEpochToken
      );
      assertCurrent();
      if (cached) return { vector: cached, cached: true };
    }

    const embed = window.CaatuuRuntime?.vector?.embed;
    if (typeof embed !== "function") throw new Error("The semantic embedding runtime is unavailable.");
    const result = await embed(normalizedText, { modelId });
    assertCurrent();
    if (result.modelId !== modelId) {
      throw new Error(`Embedding model mismatch: requested ${modelId}, received ${result.modelId || "unknown"}.`);
    }
    const vector = Float32Array.from(result.vector || []);
    if (vector.length !== embeddingDimension) {
      throw new Error(`Expected ${embeddingDimension} embedding dimensions, received ${vector.length}.`);
    }
    const createdAtMs = Date.now();
    await storeEmbedding({
      key: embeddingKey(modelId, textHash),
      modelId,
      textHash,
      text: normalizedText,
      locale: "en",
      inputPolicy: embeddingInputPolicy,
      dimension: embeddingDimension,
      normalized: true,
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      lastAccessedAt: new Date(createdAtMs).toISOString(),
      lastAccessedAtMs: createdAtMs,
      vector
    }, generation, workEpochToken, assertCurrent);
    assertCurrent();
    return { vector, cached: false };
  }

  async function project(axisPack, options = {}) {
    const generation = semanticWorkGeneration;
    const signal = options.signal;
    const assertCurrent = () => assertProjectionCurrent(generation, signal);
    const core = await corePromise;
    assertCurrent();
    const workEpochToken = await readWorkEpoch();
    assertCurrent();
    const modelId = String(axisPack?.modelId || options.modelId || defaultEmbeddingModelId);
    if (modelId !== defaultEmbeddingModelId) {
      throw new Error(`Unsupported semantic embedding model ${modelId}.`);
    }
    const axes = Array.isArray(axisPack?.axes) ? axisPack.axes : [];
    if (!axes.length) throw new Error("Axis pack must contain at least one axis.");
    if (axes.length > maximumProjectionAxes) {
      throw new Error(`Axis pack cannot contain more than ${maximumProjectionAxes} axes.`);
    }
    const axisIds = new Set();
    const axisDefinitions = axes.map((axis) => {
      const id = String(axis?.id || "").trim();
      if (!id) throw new Error("Every semantic axis must include an id.");
      if (axisIds.has(id)) throw new Error(`Axis pack contains duplicate axis id ${id}.`);
      axisIds.add(id);
      const probe = typeof axis?.probe === "object" && axis.probe
        ? axis.probe
        : { locale: "en", text: axis?.text, revision: "1" };
      if ((probe.locale || "en") !== "en") throw new Error(`Axis ${id} must use an English probe.`);
      return { ...axis, id, probe };
    });
    const evidence = (await readEvidence()).filter((node) => node.locale === "en");
    assertCurrent();
    await assertPersistedWorkEpoch(workEpochToken);
    assertCurrent();

    const embeddingRequest = (text) => {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) throw new Error("Semantic embedding text is required.");
      if (normalizedText.length > core.boundedSemanticHistoryPolicy.maximumEmbeddingTextCharacters) {
        throw new Error("Semantic embedding text is too large to cache safely.");
      }
      const textHash = core.semanticTextHash(normalizedText);
      return {
        key: embeddingKey(modelId, textHash),
        text: normalizedText
      };
    };
    const evidenceRequests = evidence.map((node) => embeddingRequest(node.text));
    const axisRequests = axisDefinitions.map((axis) => embeddingRequest(axis.probe.text));
    const cachedVectors = await cachedEmbeddingBatch(
      [...evidenceRequests, ...axisRequests],
      modelId,
      generation,
      workEpochToken
    );
    assertCurrent();

    const total = evidence.length + axisDefinitions.length;
    let completed = 0;
    const yieldProjectionTurn = async () => {
      if (typeof window.scheduler?.yield === "function") {
        await window.scheduler.yield();
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    };
    const withProgress = async (request, kind, id) => {
      assertCurrent();
      const cached = cachedVectors.get(request.key);
      const embedded = cached?.text === request.text
        ? { vector: cached.vector, cached: true }
        : await materializeEmbedding(
          request.text,
          modelId,
          generation,
          workEpochToken,
          { skipCacheLookup: true, assertCurrent }
        );
      assertCurrent();
      cachedVectors.set(request.key, { text: request.text, vector: embedded.vector });
      completed += 1;
      options.onProgress?.({ phase: "embedding", kind, id, completed, total, cached: embedded.cached });
      if (completed < total && completed % 4 === 0) await yieldProjectionTurn();
      assertCurrent();
      return embedded.vector;
    };

    const projectedEvidence = [];
    for (let index = 0; index < evidence.length; index += 1) {
      const node = evidence[index];
      projectedEvidence.push({
        ...node,
        vector: await withProgress(evidenceRequests[index], "evidence", node.statementKey)
      });
    }

    const projectedAxes = [];
    for (let index = 0; index < axisDefinitions.length; index += 1) {
      const axis = axisDefinitions[index];
      projectedAxes.push({
        ...axis,
        vector: await withProgress(axisRequests[index], "axis", axis.id)
      });
    }

    assertCurrent();
    await assertPersistedWorkEpoch(workEpochToken);
    assertCurrent();
    await yieldProjectionTurn();
    assertCurrent();
    const projection = {
      ...core.projectSemanticEvidence(projectedEvidence, {
        ...axisPack,
        modelId,
        axes: projectedAxes
      }, options),
      generatedAt: new Date().toISOString(),
      evidenceReducerVersion: core.semanticLearningSchema.evidenceReducerVersion,
      embeddingModel: {
        id: modelId,
        dimension: embeddingDimension,
        inputPolicy: embeddingInputPolicy,
        normalized: true
      }
    };
    assertCurrent();
    return projection;
  }

  async function snapshot() {
    const core = await corePromise;
    const evidence = await readEvidence();
    await operationQueue;
    const database = await openDatabase();
    const transaction = database.transaction(
      [storeNames.attempts, storeNames.ledger, storeNames.receipts, storeNames.embeddings, storeNames.meta],
      "readonly"
    );
    const finished = transactionFinished(transaction);
    const retainedAttemptCount = await requestResult(transaction.objectStore(storeNames.attempts).count());
    const ledgerCount = await requestResult(transaction.objectStore(storeNames.ledger).count());
    const receiptCount = await requestResult(transaction.objectStore(storeNames.receipts).count());
    const embeddingCount = await requestResult(transaction.objectStore(storeNames.embeddings).count());
    const historyState = await requestResult(transaction.objectStore(storeNames.meta).get("history-state"));
    await finished;
    const compactedAttemptCount = Number(historyState?.compactedAttemptCount) || 0;
    return {
      schemaVersion: databaseVersion,
      databaseName,
      attemptCount: compactedAttemptCount + retainedAttemptCount,
      retainedAttemptCount,
      compactedAttemptCount,
      ledgerCount,
      receiptCount,
      embeddingCount,
      evidenceCount: evidence.length,
      truthFormat: historyState?.truthFormat || "raw-attempts-v1",
      historyPolicy: { ...core.boundedSemanticHistoryPolicy },
      temporalSummary: {
        version: core.semanticLearningSchema.temporalSummaryVersion,
        dailyPeriods: core.boundedSemanticHistoryPolicy.temporalBucketSlots,
        weeklyPeriods: core.boundedSemanticHistoryPolicy.temporalBucketSlots,
        monthlyPeriods: core.boundedSemanticHistoryPolicy.temporalBucketSlots
      },
      idempotency: {
        mode: "bounded-retry-window",
        lifetimeExact: false,
        rawAttemptLimit: core.boundedSemanticHistoryPolicy.rawAttemptLimit,
        compactedReceiptLimit: core.boundedSemanticHistoryPolicy.compactedReceiptLimit
      },
      lastError
    };
  }

  function whenIdle() {
    return operationQueue;
  }

  window.addEventListener?.("caatuu:learning-change", (event) => {
    if (event?.detail?.reason !== "progress-reset") return;
    void resetProgress().catch(() => {});
  });

  window.CaatuuSemanticLearning = Object.freeze({
    schemaVersion: databaseVersion,
    databaseName,
    storage: Object.freeze({ databaseName, databaseVersion, ...storeNames }),
    recordAttempt,
    retryPendingAttempts,
    readAttempts,
    readEvidence,
    rebuildEvidence,
    compactHistory,
    project,
    projectRadar: project,
    clearEmbeddingCache,
    resetProgress,
    snapshot,
    whenIdle
  });
  readProgressEpoch();
  window.CaatuuLearning?.registerSaveRetry?.(retryPendingAttempts);
  void retryPendingAttempts().catch(() => {});
})();
