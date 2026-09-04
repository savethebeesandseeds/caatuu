package com.caatuu.android

import java.io.File
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal data class NativeStorageArtifact(
    val courseId: String,
    val storagePath: String,
    val source: String,
    val declaredPath: String,
    val bytes: Long,
    val sha256: String,
    val artifactKind: String,
    val identityMarker: String,
)

internal object NativeArtifactContract {
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private val storageKeyPattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
    private val fileNamePattern = Regex("^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$")
    private val directionPattern = Regex("^[a-z0-9]+(?:-[a-z0-9]+)+$")
    private val artifactKindPattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
    private val sha256Pattern = Regex("^[a-f0-9]{64}$")

    fun trimmedText(value: String, label: String): String {
        require(value.isNotEmpty() && value == value.trim()) {
            "$label must be nonblank and trimmed."
        }
        return value
    }

    fun storageKey(value: String, label: String): String {
        val key = trimmedText(value, label)
        require(storageKeyPattern.matches(key)) { "$label must be a stable safe storage key." }
        return key
    }

    fun relativePath(value: String, label: String): String {
        val path = trimmedText(value, label)
        require(
                !path.startsWith('/') &&
                !path.contains('\\') &&
                path.split('/').all { segment ->
                    segment != "." && segment != ".." && fileNamePattern.matches(segment)
                },
        ) { "$label path is unsafe." }
        return path
    }

    fun normalizedRelativePath(value: String, label: String): String {
        val path = trimmedText(value, label)
        require(
            !path.startsWith('/') &&
                !path.contains('\\') &&
                path.split('/').all { segment ->
                    segment.isNotEmpty() &&
                        segment != "." &&
                        segment != ".." &&
                        segment.none { character -> character.code < 0x20 || character.code == 0x7f }
                },
        ) { "$label path is unsafe." }
        return path
    }

    fun fileName(value: String, label: String): String {
        val name = trimmedText(value, label)
        require(name != "." && name != ".." && fileNamePattern.matches(name)) {
            "$label must be an exact safe file basename."
        }
        return name
    }

    fun direction(value: String, label: String): String {
        val direction = trimmedText(value, label)
        require(directionPattern.matches(direction)) { "$label is invalid." }
        return direction
    }

    fun artifactKind(value: String, label: String): String {
        val kind = trimmedText(value, label)
        require(artifactKindPattern.matches(kind)) { "$label must be a stable artifact kind." }
        return kind
    }

    fun sha256(value: String, label: String): String {
        val hash = trimmedText(value, label)
        require(sha256Pattern.matches(hash)) { "$label must be a lowercase SHA-256." }
        return hash
    }

    fun positiveSafeByteCount(value: Any?, label: String): Long {
        require(value is Number) { "$label must be a numeric canonical bytes field." }
        val numeric = value.toDouble()
        require(
            numeric.isFinite() &&
                numeric > 0.0 &&
                numeric <= MAX_SAFE_INTEGER.toDouble() &&
                numeric == kotlin.math.floor(numeric),
        ) { "$label must be a positive safe integer byte count." }
        val bytes = value.toLong()
        require(bytes.toDouble() == numeric) { "$label must be an exact positive safe integer byte count." }
        return bytes
    }

    fun httpsUrl(value: String, label: String): String {
        val rawUrl = trimmedText(value, label)
        val url = runCatching { URL(rawUrl) }.getOrElse {
            throw IllegalArgumentException("$label must be an absolute HTTPS URL.", it)
        }
        require(url.protocol.equals("https", ignoreCase = true) && url.host.isNotBlank()) {
            "$label must use HTTPS."
        }
        require(url.userInfo == null) { "$label must not contain credentials." }
        require(rawUrl.none(Char::isWhitespace)) { "$label must not contain whitespace." }
        return rawUrl
    }

    fun artifactIdentityMarker(
        kindValue: String,
        source: String,
        declaredPath: String,
        bytes: Long,
        sha256Value: String,
    ): String {
        val fields = listOf(
            artifactKind(kindValue, "Artifact identity kind"),
            httpsUrl(source, "Artifact identity source"),
            normalizedRelativePath(declaredPath, "Artifact identity declared path"),
            positiveSafeByteCount(bytes, "Artifact identity bytes").toString(),
            sha256(sha256Value, "Artifact identity SHA-256"),
        )
        val digest = MessageDigest.getInstance("SHA-256")
        fields.forEach { field ->
            val value = field.toByteArray(StandardCharsets.UTF_8)
            digest.update(value.size.toString().toByteArray(StandardCharsets.US_ASCII))
            digest.update(':'.code.toByte())
            digest.update(value)
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    fun storageArtifact(
        courseId: String,
        storagePath: String,
        source: String,
        declaredPath: String,
        bytes: Long,
        sha256Value: String,
        artifactKindValue: String,
    ): NativeStorageArtifact {
        val normalizedCourseId = storageKey(courseId, "Native storage course ID")
        val normalizedStoragePath = normalizedRelativePath(storagePath, "Native storage path")
        val normalizedSource = httpsUrl(source, "Native storage source")
        val normalizedDeclaredPath = normalizedRelativePath(declaredPath, "Native storage declared path")
        val normalizedBytes = positiveSafeByteCount(bytes, "Native storage bytes")
        val normalizedSha256 = sha256(sha256Value, "Native storage SHA-256")
        val normalizedKind = artifactKind(artifactKindValue, "Native storage artifact kind")
        return NativeStorageArtifact(
            courseId = normalizedCourseId,
            storagePath = normalizedStoragePath,
            source = normalizedSource,
            declaredPath = normalizedDeclaredPath,
            bytes = normalizedBytes,
            sha256 = normalizedSha256,
            artifactKind = normalizedKind,
            identityMarker = artifactIdentityMarker(
                normalizedKind,
                normalizedSource,
                normalizedDeclaredPath,
                normalizedBytes,
                normalizedSha256,
            ),
        )
    }

    fun requireCompatibleSharedStorage(artifacts: List<NativeStorageArtifact>) {
        val ownerByPath = mutableMapOf<String, NativeStorageArtifact>()
        artifacts.forEach { artifact ->
            val existing = ownerByPath[artifact.storagePath]
            if (existing != null) {
                val mismatch = listOf(
                    "source" to (existing.source == artifact.source),
                    "declaredPath" to (existing.declaredPath == artifact.declaredPath),
                    "bytes" to (existing.bytes == artifact.bytes),
                    "sha256" to (existing.sha256 == artifact.sha256),
                    "artifactKind" to (existing.artifactKind == artifact.artifactKind),
                ).firstOrNull { (_, matches) -> !matches }?.first
                require(mismatch == null) {
                    "Android shared storage path ${artifact.storagePath} has conflicting $mismatch for " +
                        "courses ${existing.courseId} and ${artifact.courseId}."
                }
            }
            if (existing == null) ownerByPath[artifact.storagePath] = artifact
        }
    }

    fun canonicalDescendant(parent: File, relativePath: String, label: String): File {
        val safePath = normalizedRelativePath(relativePath, label)
        val canonicalParent = parent.canonicalFile
        val candidate = File(canonicalParent, safePath.replace('/', File.separatorChar)).canonicalFile
        require(candidate != canonicalParent && candidate.toPath().startsWith(canonicalParent.toPath())) {
            "$label must remain a canonical descendant of ${canonicalParent.absolutePath}."
        }
        return candidate
    }

    fun canonicalChild(parent: File, childName: String, label: String): File {
        val safeName = fileName(childName, label)
        val canonicalParent = parent.canonicalFile
        val candidate = canonicalDescendant(canonicalParent, safeName, label)
        require(candidate != canonicalParent && candidate.parentFile == canonicalParent) {
            "$label must remain a canonical child of ${canonicalParent.absolutePath}."
        }
        return candidate
    }
}
