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
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale
import kotlin.coroutines.coroutineContext

data class DictionarySpec(
    val key: String,
    val label: String,
    val direction: String,
    val databaseFile: String,
    val downloadUrl: String,
    val bytes: Long,
    val sha256: String,
    val entryCount: Int,
    val senseCount: Int,
    val formCount: Int,
)

class DictionaryManager(context: Context) {
    private data class Candidate(
        val id: Long,
        val lemma: String,
        val pos: String,
        val sourceUrl: String,
        val matchedBy: String,
        val matchedTerm: String,
    )

    private data class SenseRow(
        val id: Long,
        val json: JSONObject,
    )

    private val appContext = context.applicationContext
    private val spec = loadSpec()

    fun statusJson(): JSONObject {
        val file = databaseFile()
        val verified = isVerified(file)
        return JSONObject()
            .put("available", verified)
            .put("downloadRequired", !verified)
            .put("key", spec.key)
            .put("label", spec.label)
            .put("direction", spec.direction)
            .put("bytes", file.takeIf { it.isFile }?.length() ?: 0L)
            .put("expectedBytes", spec.bytes)
            .put("entryCount", spec.entryCount)
            .put("senseCount", spec.senseCount)
            .put("formCount", spec.formCount)
            .put("storageScope", "app-private filesDir/dictionaries")
            .put("deletedOnUninstall", true)
    }

    suspend fun ensureDatabase(onProgress: (ModelProgress) -> Unit): File =
        withContext(Dispatchers.IO) {
            val file = databaseFile()
            val marker = markerFile()
            file.parentFile?.mkdirs()

            if (isVerified(file)) {
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }
            if (file.isFile && file.length() == spec.bytes && sha256(file) == spec.sha256) {
                marker.writeText(spec.sha256)
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }

            if (file.isFile) file.delete()
            marker.delete()
            val temporaryFile = File(file.parentFile, "${file.name}.download")
            if (temporaryFile.isFile && temporaryFile.length() > spec.bytes) temporaryFile.delete()

            var downloaded = false
            var lastError: Exception? = null
            for (attempt in 1..DOWNLOAD_ATTEMPTS) {
                coroutineContext.ensureActive()
                val resumeBytes = temporaryFile
                    .takeIf { it.isFile }
                    ?.length()
                    ?.takeIf { it in 1 until spec.bytes }
                    ?: 0L
                val connection = (URL(spec.downloadUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    instanceFollowRedirects = true
                    if (resumeBytes > 0L) setRequestProperty("Range", "bytes=$resumeBytes-")
                }

                try {
                    connection.connect()
                    val statusCode = connection.responseCode
                    if (statusCode !in 200..299) {
                        throw IOException("Dictionary download failed with HTTP $statusCode")
                    }
                    val append = resumeBytes > 0L && statusCode == HttpURLConnection.HTTP_PARTIAL
                    if (!append) temporaryFile.delete()
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var bytesRead = if (append) resumeBytes else 0L
                    connection.inputStream.use { input ->
                        FileOutputStream(temporaryFile, append).use { output ->
                            while (true) {
                                coroutineContext.ensureActive()
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                bytesRead += read
                                onProgress(ModelProgress(bytesRead, spec.bytes))
                            }
                            output.fd.sync()
                        }
                    }
                    downloaded = temporaryFile.length() == spec.bytes
                    if (!downloaded) {
                        lastError = IOException(
                            "Dictionary download stopped at ${temporaryFile.length()} of ${spec.bytes} bytes",
                        )
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    lastError = error
                } finally {
                    connection.disconnect()
                }

                if (downloaded) break
                if (attempt < DOWNLOAD_ATTEMPTS) delay(RETRY_DELAY_MS * attempt)
            }

            if (!downloaded) throw lastError ?: IOException("Dictionary download failed.")
            val actualSha = sha256(temporaryFile)
            if (actualSha != spec.sha256) {
                temporaryFile.delete()
                throw IOException("Dictionary checksum did not match the catalog.")
            }

            if (!temporaryFile.renameTo(file)) {
                temporaryFile.copyTo(file, overwrite = true)
                temporaryFile.delete()
            }
            marker.writeText(spec.sha256)
            onProgress(ModelProgress(spec.bytes, spec.bytes))
            file
        }

    suspend fun search(rawQuery: String, requestedLimit: Int): JSONObject =
        withContext(Dispatchers.IO) {
            val query = rawQuery.trim()
            val normalized = normalizeCzech(query)
            require(normalized.isNotBlank()) { "A Czech search term is required." }
            require(normalized.length <= 80) { "The search term is too long." }
            val limit = requestedLimit.coerceIn(1, MAX_LIMIT)
            val file = databaseFile()
            check(isVerified(file)) { "The full dictionary has not been downloaded on this device." }

            val database = SQLiteDatabase.openDatabase(
                file.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY,
            )
            try {
                val candidates = queryCandidates(database, normalized, limit)
                val results = JSONArray()
                candidates.forEach { candidate -> results.put(loadEntry(database, candidate)) }
                JSONObject()
                    .put("query", query)
                    .put("normalizedQuery", normalized)
                    .put("direction", spec.direction)
                    .put("returned", candidates.size)
                    .put("limit", limit)
                    .put("results", results)
            } finally {
                database.close()
            }
        }

    suspend fun deleteLocalDatabase(): JSONObject =
        withContext(Dispatchers.IO) {
            val root = rootDir()
            val bytesDeleted = directorySize(root)
            val deleted = !root.exists() || root.deleteRecursively()
            JSONObject()
                .put("storageScope", "app-private filesDir/dictionaries")
                .put("deletedOnUninstall", true)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted)
                .put("status", statusJson())
        }

    private fun queryCandidates(database: SQLiteDatabase, normalized: String, limit: Int): List<Candidate> {
        val prefixUpperBound = normalized + "\uDBFF\uDFFF"
        val candidateLimit = (limit * 12).coerceAtMost(MAX_LIMIT * 12)
        val candidates = mutableListOf<Candidate>()
        val seen = mutableSetOf<Long>()
        database.rawQuery(
            """
            SELECT
              entries.id,
              entries.lemma,
              entries.pos,
              entries.source_url,
              search_terms.kind,
              search_terms.term,
              CASE
                WHEN search_terms.kind = 'lemma' AND search_terms.normalized = ? THEN 0
                WHEN search_terms.kind = 'form' AND search_terms.normalized = ? THEN 1
                WHEN search_terms.kind = 'lemma' THEN 2
                WHEN search_terms.kind = 'form' THEN 3
                ELSE 4
              END AS lexical_rank,
              CASE WHEN NOT EXISTS (
                SELECT 1
                FROM senses
                WHERE senses.entry_id = entries.id
                  AND senses.tags_json NOT LIKE '%"form-of"%'
              ) THEN 1 ELSE 0 END AS form_only
            FROM search_terms
            JOIN entries ON entries.id = search_terms.entry_id
            WHERE search_terms.normalized >= ?
              AND search_terms.normalized < ?
            ORDER BY lexical_rank + form_only * 2,
                     lexical_rank,
                     length(search_terms.normalized),
                     entries.lemma,
                     entries.pos,
                     entries.id
            LIMIT ?
            """.trimIndent(),
            arrayOf(
                normalized,
                normalized,
                normalized,
                prefixUpperBound,
                candidateLimit.toString(),
            ),
        ).use { cursor ->
            while (cursor.moveToNext() && candidates.size < limit) {
                val id = cursor.getLong(0)
                if (!seen.add(id)) continue
                candidates += Candidate(
                    id = id,
                    lemma = cursor.getString(1),
                    pos = cursor.getString(2),
                    sourceUrl = cursor.getString(3),
                    matchedBy = cursor.getString(4),
                    matchedTerm = cursor.getString(5),
                )
            }
        }
        return candidates
    }

    private fun loadEntry(database: SQLiteDatabase, candidate: Candidate): JSONObject {
        val forms = JSONArray()
        database.rawQuery(
            "SELECT form, tags_json FROM forms WHERE entry_id = ? ORDER BY form_normalized, form LIMIT 24",
            arrayOf(candidate.id.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                forms.put(
                    JSONObject()
                        .put("form", cursor.getString(0))
                        .put("tags", jsonArray(cursor.getString(1))),
                )
            }
        }

        val senseRows = mutableListOf<SenseRow>()
        database.rawQuery(
            """
            SELECT id, source_sense_id, position, gloss, raw_gloss,
                   tags_json, topics_json, synonyms_json, antonyms_json
            FROM senses
            WHERE entry_id = ?
            ORDER BY position, id
            LIMIT 12
            """.trimIndent(),
            arrayOf(candidate.id.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                senseRows += SenseRow(
                    id = cursor.getLong(0),
                    json = JSONObject()
                        .put("sourceSenseId", cursor.getString(1))
                        .put("position", cursor.getLong(2))
                        .put("gloss", cursor.getString(3))
                        .put("rawGloss", cursor.getString(4))
                        .put("tags", jsonArray(cursor.getString(5)))
                        .put("topics", jsonArray(cursor.getString(6)))
                        .put("synonyms", jsonArray(cursor.getString(7)))
                        .put("antonyms", jsonArray(cursor.getString(8))),
                )
            }
        }

        val senses = JSONArray()
        senseRows.forEach { sense ->
            val examples = JSONArray()
            database.rawQuery(
                "SELECT text, english, tags_json FROM examples WHERE sense_id = ? ORDER BY id LIMIT 3",
                arrayOf(sense.id.toString()),
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    examples.put(
                        JSONObject()
                            .put("text", cursor.getString(0))
                            .put("english", cursor.getString(1))
                            .put("tags", jsonArray(cursor.getString(2))),
                    )
                }
            }
            senses.put(sense.json.put("examples", examples))
        }

        return JSONObject()
            .put("id", candidate.id)
            .put("lemma", candidate.lemma)
            .put("pos", candidate.pos)
            .put("sourceUrl", candidate.sourceUrl)
            .put("matchedBy", candidate.matchedBy)
            .put("matchedTerm", candidate.matchedTerm)
            .put("forms", forms)
            .put("senses", senses)
    }

    private fun loadSpec(): DictionarySpec {
        val catalog = appContext.assets.open(CATALOG_ASSET).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val defaultKey = catalog.getString("default_dictionary")
        val dictionaries = catalog.getJSONArray("dictionaries")
        val item = (0 until dictionaries.length())
            .map { index -> dictionaries.getJSONObject(index) }
            .firstOrNull { entry -> entry.optString("key") == defaultKey }
            ?: throw IllegalStateException("Dictionary catalog has no item for $defaultKey.")
        val databaseFile = item.getString("database_file")
        val catalogBase = catalog.optString("base_url", "data/dictionaries").trim('/')
        val downloadUrl = item.optString("download_url").ifBlank {
            "$LANGUAGE_BASE_URL/$catalogBase/$databaseFile"
        }.let { value ->
            if (value.startsWith("http://") || value.startsWith("https://")) value
            else "$PUBLIC_BASE_URL/${value.trimStart('/')}"
        }
        return DictionarySpec(
            key = item.getString("key"),
            label = item.optString("label", "Full Czech to English Dictionary"),
            direction = item.optString("direction", "cs-en"),
            databaseFile = databaseFile,
            downloadUrl = downloadUrl,
            bytes = item.getLong("bytes"),
            sha256 = item.getString("sha256"),
            entryCount = item.optInt("entry_count"),
            senseCount = item.optInt("sense_count"),
            formCount = item.optInt("form_count"),
        )
    }

    private fun isVerified(file: File): Boolean =
        file.isFile &&
            file.length() == spec.bytes &&
            markerFile().isFile &&
            markerFile().readText().trim() == spec.sha256

    private fun rootDir(): File = File(appContext.filesDir, "dictionaries/${spec.key}")

    private fun databaseFile(): File = File(rootDir(), spec.databaseFile.substringAfterLast('/'))

    private fun markerFile(): File = File(rootDir(), "${databaseFile().name}.sha256")

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
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf(::directorySize) ?: 0L
    }

    private fun jsonArray(value: String?): JSONArray =
        runCatching { JSONArray(value.orEmpty()) }.getOrElse { JSONArray() }

    private fun normalizeCzech(value: String): String =
        Normalizer.normalize(value.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .filterNot { character -> Character.getType(character) == Character.NON_SPACING_MARK.toInt() }
            .replace(Regex("\\s+"), " ")

    companion object {
        private const val CATALOG_ASSET = "data/dictionaries/catalog.json"
        private const val PUBLIC_BASE_URL = "https://caatuu.waajacu.com"
        private val LANGUAGE_BASE_URL =
            "$PUBLIC_BASE_URL/${BuildConfig.CAATUU_LANGUAGE_ROUTE_PREFIX.trim('/')}"
        private const val DOWNLOAD_ATTEMPTS = 4
        private const val CONNECT_TIMEOUT_MS = 30_000
        private const val READ_TIMEOUT_MS = 120_000
        private const val RETRY_DELAY_MS = 1_000L
        private const val MAX_LIMIT = 60
    }
}
