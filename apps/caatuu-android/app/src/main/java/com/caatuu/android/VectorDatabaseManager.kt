package com.caatuu.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import kotlin.math.sqrt
import kotlin.coroutines.coroutineContext

interface CaatuuEmbeddingRuntime {
    suspend fun embedText(text: String): FloatArray
}

data class VectorDatabaseSpec(
    val key: String,
    val label: String,
    val shortLabel: String,
    val artifactKind: String,
    val runtime: String,
    val format: String,
    val intendedUse: String,
    val modelFile: String,
    val manifestFile: String,
    val fileName: String,
    val url: String,
    val bytes: Long,
    val sha256: String,
    val schemaName: String,
    val schemaVersion: Int,
    val embeddingDimension: Int,
    val embeddingTextField: String,
    val embeddingInputPolicy: String,
    val trainable: Boolean,
)

data class VectorDatabaseCatalog(
    val defaultModelKey: String,
    val baseUrl: String,
    val models: List<VectorDatabaseSpec>,
)

class LocalHashEmbeddingRuntime : CaatuuEmbeddingRuntime {
    override suspend fun embedText(text: String): FloatArray =
        VectorDatabaseManager.localHashEmbedding(text)
}

data class VectorSearchResult(
    val chunkId: String,
    val documentId: String,
    val text: String,
    val sourceKind: String,
    val sourceId: String,
    val locale: String,
    val title: String?,
    val score: Float,
    val chunkMetadataJson: String,
    val documentMetadataJson: String,
)

class VectorDatabaseManager(
    context: Context,
    private val embeddingRuntime: CaatuuEmbeddingRuntime? = null,
) {
    private val appContext = context.applicationContext
    private val databasesDir = File(appContext.filesDir, "vector-dbs")
    private val vectorCatalog = loadVectorDatabaseCatalog()
    private val defaultSpec = vectorCatalog.models.first { it.key == vectorCatalog.defaultModelKey }
    private var database: SQLiteDatabase? = null
    private var openPath: String? = null

    fun defaultSpec(): VectorDatabaseSpec = defaultSpec

    suspend fun ensureDatabase(spec: VectorDatabaseSpec, onProgress: (ModelProgress) -> Unit): File =
        withContext(Dispatchers.IO) {
            databasesDir.mkdirs()
            val file = File(databasesDir, spec.fileName)
            val marker = File(databasesDir, "${spec.fileName}.sha256")
            if (file.isFile && marker.isFile && marker.readText().trim() == spec.sha256 && file.length() == spec.bytes) {
                return@withContext file
            }
            if (file.isFile && file.length() == spec.bytes && sha256(file) == spec.sha256) {
                marker.writeText(spec.sha256)
                return@withContext file
            }

            close()
            file.delete()
            marker.delete()
            val tmpFile = File(databasesDir, "${spec.fileName}.download")
            tmpFile.delete()

            var downloaded = false
            var lastError: Exception? = null
            for (attempt in 1..DATABASE_DOWNLOAD_ATTEMPTS) {
                coroutineContext.ensureActive()
                if (downloaded) break
                if (tmpFile.isFile && tmpFile.length() > spec.bytes) tmpFile.delete()

                val resumeBytes = tmpFile
                    .takeIf { it.isFile }
                    ?.length()
                    ?.takeIf { it in 1 until spec.bytes }
                    ?: 0L

                val connection = (URL(spec.url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = DATABASE_CONNECT_TIMEOUT_MS
                    readTimeout = DATABASE_READ_TIMEOUT_MS
                    instanceFollowRedirects = true
                    if (resumeBytes > 0L) {
                        setRequestProperty("Range", "bytes=$resumeBytes-")
                    }
                }

                try {
                    connection.connect()
                    val statusCode = connection.responseCode
                    if (statusCode !in 200..299) {
                        throw IOException("Vector database download failed with HTTP $statusCode")
                    }

                    val append = resumeBytes > 0L && statusCode == HttpURLConnection.HTTP_PARTIAL
                    if (!append) tmpFile.delete()

                    val totalBytes = if (append) {
                        spec.bytes
                    } else {
                        connection.contentLengthLong.takeIf { it > 0L } ?: spec.bytes
                    }
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var bytesRead = if (append) resumeBytes else 0L

                    connection.inputStream.use { input ->
                        FileOutputStream(tmpFile, append).use { output ->
                            while (true) {
                                coroutineContext.ensureActive()
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                bytesRead += read
                                onProgress(ModelProgress(bytesRead, totalBytes))
                            }
                        }
                    }

                    downloaded = tmpFile.length() == spec.bytes
                    if (!downloaded) {
                        lastError = IOException("Vector database download stopped at ${tmpFile.length()} of ${spec.bytes} bytes")
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    lastError = error
                } finally {
                    connection.disconnect()
                }

                if (!downloaded && attempt < DATABASE_DOWNLOAD_ATTEMPTS) {
                    delay(DATABASE_RETRY_DELAY_MS * attempt)
                }
            }

            if (!downloaded) {
                val detail = lastError?.message ?: "unknown network error"
                throw IOException("Vector database download failed after $DATABASE_DOWNLOAD_ATTEMPTS attempts: $detail", lastError)
            }

            val actualSha = sha256(tmpFile)
            require(actualSha == spec.sha256) {
                "Vector database SHA-256 mismatch: expected ${spec.sha256}, got $actualSha"
            }

            if (!tmpFile.renameTo(file)) {
                tmpFile.copyTo(file, overwrite = true)
                tmpFile.delete()
            }
            marker.writeText(spec.sha256)
            file
        }

    fun openReadOnly(spec: VectorDatabaseSpec = defaultSpec): SQLiteDatabase {
        val file = File(databasesDir, spec.fileName)
        require(file.isFile) { "Vector database is missing: ${file.absolutePath}" }
        val existing = database
        if (existing?.isOpen == true && openPath == file.absolutePath) return existing

        close()
        val opened = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        try {
            assertCompatibleSchema(opened, spec)
        } catch (error: Exception) {
            opened.close()
            throw error
        }
        database = opened
        openPath = file.absolutePath
        return opened
    }

    suspend fun embedText(text: String): FloatArray {
        val runtime = embeddingRuntime ?: throw IllegalStateException(
            "Semantic text embedding runs in the shared browser/WebView ONNX runtime. " +
                "Use CaatuuRuntime.vector.search() or provide an explicit native semantic runtime.",
        )
        return normalizeVector(runtime.embedText(text))
    }

    suspend fun searchText(
        text: String,
        limit: Int = 10,
        spec: VectorDatabaseSpec = defaultSpec,
        sourceKinds: Set<String> = emptySet(),
    ): List<VectorSearchResult> {
        val queryVector = embedText(text)
        return searchVector(queryVector, limit, spec, sourceKinds)
    }

    suspend fun searchVector(
        queryVector: FloatArray,
        limit: Int = 10,
        spec: VectorDatabaseSpec = defaultSpec,
        sourceKinds: Set<String> = emptySet(),
    ): List<VectorSearchResult> =
        withContext(Dispatchers.Default) {
            require(queryVector.size == spec.embeddingDimension) {
                "Expected ${spec.embeddingDimension} dimensions, got ${queryVector.size}."
            }
            val db = database?.takeIf { it.isOpen } ?: openReadOnly(spec)
            val normalizedQuery = normalizeVector(queryVector)
            val sourceKindFilters = sourceKinds.map { it.trim() }.filter { it.isNotBlank() }.distinct()
            val sourceKindClause = if (sourceKindFilters.isEmpty()) {
                ""
            } else {
                " AND documents.source_kind IN (${sourceKindFilters.joinToString(",") { "?" }})"
            }
            val queryArgs = mutableListOf(spec.key, spec.embeddingDimension.toString()).also { args ->
                args.addAll(sourceKindFilters)
            }.toTypedArray()
            val rows = mutableListOf<VectorSearchResult>()
            db.rawQuery(
                """
                SELECT
                  chunks.id AS chunk_id,
                  chunks.document_id,
                  chunks.text,
                  chunks.metadata_json AS chunk_metadata_json,
                  documents.source_kind,
                  documents.source_id,
                  documents.locale,
                  documents.title,
                  documents.metadata_json AS document_metadata_json,
                  embeddings.vector
                FROM embeddings
                JOIN chunks ON chunks.id = embeddings.chunk_id
                JOIN documents ON documents.id = chunks.document_id
                WHERE embeddings.model_id = ?
                  AND embeddings.dimension = ?
                  $sourceKindClause
                """.trimIndent(),
                queryArgs,
            ).use { cursor ->
                val chunkId = cursor.getColumnIndexOrThrow("chunk_id")
                val documentId = cursor.getColumnIndexOrThrow("document_id")
                val text = cursor.getColumnIndexOrThrow("text")
                val chunkMetadata = cursor.getColumnIndexOrThrow("chunk_metadata_json")
                val sourceKind = cursor.getColumnIndexOrThrow("source_kind")
                val sourceId = cursor.getColumnIndexOrThrow("source_id")
                val locale = cursor.getColumnIndexOrThrow("locale")
                val title = cursor.getColumnIndexOrThrow("title")
                val documentMetadata = cursor.getColumnIndexOrThrow("document_metadata_json")
                val vector = cursor.getColumnIndexOrThrow("vector")

                while (cursor.moveToNext()) {
                    val candidate = decodeFloat32Vector(cursor.getBlob(vector))
                    rows += VectorSearchResult(
                        chunkId = cursor.getString(chunkId),
                        documentId = cursor.getString(documentId),
                        text = cursor.getString(text),
                        sourceKind = cursor.getString(sourceKind),
                        sourceId = cursor.getString(sourceId),
                        locale = cursor.getString(locale),
                        title = cursor.getString(title),
                        score = dotProduct(normalizedQuery, candidate),
                        chunkMetadataJson = cursor.getString(chunkMetadata),
                        documentMetadataJson = cursor.getString(documentMetadata),
                    )
                }
            }
            rows.sortedByDescending { it.score }.take(limit.coerceIn(1, 100))
        }

    fun statusJson(spec: VectorDatabaseSpec = defaultSpec): JSONObject {
        val file = File(databasesDir, spec.fileName)
        val marker = File(databasesDir, "${spec.fileName}.sha256")
        val db = database?.takeIf { it.isOpen && openPath == file.absolutePath }
        val bytes = file.takeIf { it.isFile }?.length() ?: 0L
        val verified = file.isFile &&
            marker.isFile &&
            marker.readText().trim() == spec.sha256 &&
            bytes == spec.bytes
        return JSONObject()
            .put("schemaName", spec.schemaName)
            .put("schemaVersion", spec.schemaVersion)
            .put("modelKey", spec.key)
            .put("embeddingModel", spec.key)
            .put("label", spec.label)
            .put("shortLabel", spec.shortLabel)
            .put("artifactKind", spec.artifactKind)
            .put("runtime", spec.runtime)
            .put("format", spec.format)
            .put("intendedUse", spec.intendedUse)
            .put("trainable", spec.trainable)
            .put("embeddingDimension", spec.embeddingDimension)
            .put("embeddingTextField", spec.embeddingTextField)
            .put("embeddingInputPolicy", spec.embeddingInputPolicy)
            .put("databaseFile", spec.fileName)
            .put("databaseUrl", spec.url)
            .put("expectedBytes", spec.bytes)
            .put("sha256", spec.sha256)
            .put("path", file.absolutePath)
            .put("downloaded", file.isFile && bytes == spec.bytes)
            .put("verified", verified)
            .put("partial", file.isFile && bytes != spec.bytes)
            .put("bytes", bytes)
            .put("open", db != null)
            .put("documentCount", db?.count("documents") ?: 0)
            .put("chunkCount", db?.count("chunks") ?: 0)
            .put("embeddingCount", db?.count("embeddings") ?: 0)
            .put("models", embeddingModelCatalogJson())
    }

    suspend fun deleteLocalDatabases(): JSONObject =
        withContext(Dispatchers.IO) {
            close()
            val bytesDeleted = directorySize(databasesDir)
            val deleted = !databasesDir.exists() || databasesDir.deleteRecursively()
            JSONObject()
                .put("storageScope", "app-private filesDir/vector-dbs")
                .put("deletedOnUninstall", true)
                .put("path", databasesDir.absolutePath)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted)
                .put("status", statusJson())
        }

    fun close() {
        database?.close()
        database = null
        openPath = null
    }

    private fun assertCompatibleSchema(db: SQLiteDatabase, spec: VectorDatabaseSpec) {
        val schemaName = db.metaValue("schema_name")
        val schemaVersion = db.metaValue("schema_version")?.toIntOrNull()
        val defaultModel = db.metaValue("default_embedding_model")
        val embeddingTextField = db.metaValue("embedding_text_field")
        val embeddingInputPolicy = db.metaValue("embedding_input_policy")
        require(schemaName == spec.schemaName && schemaVersion == spec.schemaVersion) {
            "Unsupported vector database schema ${schemaName ?: "unknown"} v${schemaVersion ?: "unknown"}."
        }
        require(defaultModel == spec.key) {
            "Unsupported default embedding model ${defaultModel ?: "unknown"}."
        }
        require(embeddingTextField == spec.embeddingTextField) {
            "Unsupported embedding text field ${embeddingTextField ?: "unknown"}."
        }
        require(embeddingInputPolicy == spec.embeddingInputPolicy) {
            "Unsupported embedding input policy ${embeddingInputPolicy ?: "unknown"}."
        }
    }

    private fun embeddingModelCatalogJson(): JSONArray =
        JSONArray().also { array ->
            vectorCatalog.models.forEach { spec ->
                array.put(
                    JSONObject()
                        .put("key", spec.key)
                        .put("model_id", spec.key)
                        .put("label", spec.label)
                        .put("short_label", spec.shortLabel)
                        .put("status", "active")
                        .put("artifact_kind", spec.artifactKind)
                        .put("runtime", spec.runtime)
                        .put("format", spec.format)
                        .put("intended_use", spec.intendedUse)
                        .put("embedding_dimension", spec.embeddingDimension)
                        .put("embedding_text_field", spec.embeddingTextField)
                        .put("embedding_input_policy", spec.embeddingInputPolicy)
                        .put("model_file", spec.modelFile)
                        .put("manifest_file", spec.manifestFile)
                        .put("url", spec.url)
                        .put("bytes", spec.bytes)
                        .put("sha256", spec.sha256)
                        .put("trainable", spec.trainable),
                )
            }
        }

    private fun SQLiteDatabase.metaValue(key: String): String? =
        rawQuery("SELECT value FROM schema_meta WHERE key = ?", arrayOf(key)).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    private fun SQLiteDatabase.count(table: String): Long =
        rawQuery("SELECT COUNT(*) FROM $table", emptyArray()).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun loadVectorDatabaseCatalog(): VectorDatabaseCatalog {
        val catalog = appContext.assets.open(EMBEDDING_CATALOG_ASSET).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val baseUrl = catalog.getString("base_url").trimEnd('/')
        val modelsJson = catalog.getJSONArray("models")
        val specs = mutableListOf<VectorDatabaseSpec>()
        for (index in 0 until modelsJson.length()) {
            specs += parseVectorDatabaseSpec(modelsJson.getJSONObject(index), baseUrl)
        }
        if (specs.isEmpty()) throw IllegalStateException("$EMBEDDING_CATALOG_ASSET does not define any embedding models.")

        val requestedDefault = catalog.optString("default_model", specs.first().key)
        val resolvedDefault = requestedDefault.takeIf { key -> specs.any { it.key == key } } ?: specs.first().key
        return VectorDatabaseCatalog(
            defaultModelKey = resolvedDefault,
            baseUrl = baseUrl,
            models = specs,
        )
    }

    private fun parseVectorDatabaseSpec(item: JSONObject, baseUrl: String): VectorDatabaseSpec {
        val key = item.getString("key")
        val label = item.optString("label", key)
        val modelFile = item.getString("model_file").trimStart('/')
        val manifestFile = item.optString("manifest_file", "$key/manifest.json").trimStart('/')
        val manifest = appContext.assets.open(resolveEmbeddingAssetPath(manifestFile)).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val fileName = manifest.optString("file", modelFile.substringAfterLast('/'))
        val url = resolveDownloadUrl(baseUrl, manifest.optString("url", modelFile))
        return VectorDatabaseSpec(
            key = key,
            label = label,
            shortLabel = item.optString("short_label", label),
            artifactKind = item.optString("artifact_kind", "embedding-vector-db"),
            runtime = item.optString("runtime", "SQLite vector database with local hash embedder"),
            format = item.optString("format", "sqlite"),
            intendedUse = item.optString("intended_use", ""),
            modelFile = modelFile,
            manifestFile = manifestFile,
            fileName = fileName,
            url = url,
            bytes = manifest.optLong("bytes", item.getLong("bytes")),
            sha256 = manifest.optString("sha256", item.getString("sha256")),
            schemaName = manifest.optString("schema_name", SCHEMA_NAME),
            schemaVersion = manifest.optInt("schema_version", SCHEMA_VERSION),
            embeddingDimension = manifest.optInt("embedding_dimension", item.optInt("embedding_dimension", EMBEDDING_DIMENSION)),
            embeddingTextField = manifest.optString(
                "embedding_text_field",
                item.optString("embedding_text_field", EMBEDDING_TEXT_FIELD),
            ),
            embeddingInputPolicy = manifest.optString(
                "embedding_input_policy",
                item.optString("embedding_input_policy", EMBEDDING_INPUT_POLICY),
            ),
            trainable = item.optBoolean("trainable", false),
        )
    }

    private fun resolveEmbeddingAssetPath(path: String): String {
        val normalized = path.replace('\\', '/').trimStart('/')
        return if (normalized.startsWith("data/embeddings/")) normalized else "data/embeddings/$normalized"
    }

    private fun resolveDownloadUrl(baseUrl: String, urlOrPath: String): String {
        val value = urlOrPath.trim()
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        if (value.startsWith("/")) return "https://caatuu.waajacu.com$value"
        val relative = value.removePrefix("data/embeddings/").trimStart('/')
        return "$baseUrl/$relative"
    }

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    companion object {
        const val SCHEMA_NAME = "caatuu-cz-vector-db"
        const val SCHEMA_VERSION = 1
        const val EMBEDDING_DIMENSION = 384
        const val EMBEDDING_TEXT_FIELD = "english_text"
        const val EMBEDDING_INPUT_POLICY = "english_text_only"
        private const val EMBEDDING_CATALOG_ASSET = "data/embeddings/models.json"
        private const val DATABASE_CONNECT_TIMEOUT_MS = 30_000
        private const val DATABASE_READ_TIMEOUT_MS = 120_000
        private const val DATABASE_DOWNLOAD_ATTEMPTS = 4
        private const val DATABASE_RETRY_DELAY_MS = 1_500L
        private const val FNV_OFFSET_BASIS = -3750763034362895579L
        private const val FNV_PRIME = 1099511628211L

        fun localHashEmbedding(text: String): FloatArray {
            val tokens = tokenize(text)
            val features = if (tokens.isEmpty()) listOf("__blank__") else tokens
            val vector = FloatArray(EMBEDDING_DIMENSION)
            for (token in features) {
                addHashFeature(vector, token, 1f)
                addCharNgrams(vector, token, 3, 0.35f)
            }
            return normalizeVector(vector)
        }

        private fun tokenize(text: String): List<String> {
            val tokens = mutableListOf<String>()
            val current = StringBuilder()
            for (char in text.lowercase()) {
                if (char.isLetterOrDigit()) {
                    current.append(char)
                } else if (current.isNotEmpty()) {
                    tokens += current.toString()
                    current.clear()
                }
            }
            if (current.isNotEmpty()) tokens += current.toString()
            return tokens
        }

        private fun addCharNgrams(vector: FloatArray, token: String, size: Int, weight: Float) {
            if (token.length < size) return
            for (index in 0..(token.length - size)) {
                addHashFeature(vector, "ngram:${token.substring(index, index + size)}", weight)
            }
        }

        private fun addHashFeature(vector: FloatArray, feature: String, weight: Float) {
            val hash = stableHash(feature)
            val index = java.lang.Long.remainderUnsigned(hash, vector.size.toLong()).toInt()
            val sign = if (hash < 0) -1f else 1f
            vector[index] += sign * weight
        }

        private fun stableHash(value: String): Long {
            var hash = FNV_OFFSET_BASIS
            for (byte in value.toByteArray(StandardCharsets.UTF_8)) {
                hash = hash xor (byte.toLong() and 0xffL)
                hash *= FNV_PRIME
            }
            return hash
        }

        fun decodeFloat32Vector(bytes: ByteArray): FloatArray {
            require(bytes.size == EMBEDDING_DIMENSION * 4) {
                "Expected ${EMBEDDING_DIMENSION * 4} vector bytes, got ${bytes.size}."
            }
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            return FloatArray(EMBEDDING_DIMENSION) { buffer.float }
        }

        fun normalizeVector(vector: FloatArray): FloatArray {
            require(vector.size == EMBEDDING_DIMENSION) {
                "Expected $EMBEDDING_DIMENSION dimensions, got ${vector.size}."
            }
            var norm = 0.0
            for (value in vector) norm += value.toDouble() * value.toDouble()
            val length = sqrt(norm).toFloat()
            require(length.isFinite() && length > 0f) { "Embedding vector has zero or invalid norm." }
            return FloatArray(vector.size) { index -> vector[index] / length }
        }

        fun dotProduct(left: FloatArray, right: FloatArray): Float {
            require(left.size == right.size) { "Vector dimension mismatch." }
            var score = 0f
            for (index in left.indices) score += left[index] * right[index]
            return score
        }
    }
}
