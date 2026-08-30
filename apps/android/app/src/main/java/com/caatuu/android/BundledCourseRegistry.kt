package com.caatuu.android

import android.content.Context
import java.net.URI

data class BundledLanguage(
    val id: String,
    val label: String,
    val locale: String,
    val speechLocale: String = "",
)

data class BundledCatalogProvider(
    val implementation: String,
    val catalogAsset: String,
)

data class BundledSpeechProvider(
    val implementation: String,
    val locale: String,
)

data class BundledNativeProviders(
    val schemaVersion: Int,
    val embeddings: BundledCatalogProvider? = null,
    val dictionary: BundledCatalogProvider? = null,
    val speech: BundledSpeechProvider? = null,
)

data class BundledCourse(
    val id: String,
    val routePrefix: String,
    val entryPath: String,
    val assetPrefix: String,
    val sourceLanguage: BundledLanguage,
    val targetLanguage: BundledLanguage,
    val capabilities: CourseCapabilities,
    val nativeProviders: BundledNativeProviders,
)

data class BundledAssetResolution(
    val assetPath: String,
    val course: BundledCourse? = null,
    val courseRelativePath: String? = null,
)

/**
 * Fail-closed registry for the courses physically present in an Android APK.
 *
 * Browser course profiles remain responsible for presentation. This registry
 * is the native package boundary: only routes and providers declared in the
 * generated bundle can be reached through the WebView or JavaScript bridge.
 */
class BundledCourseRegistry private constructor(
    val defaultCourseId: String,
    courses: List<BundledCourse>,
) {
    private val coursesById = courses.associateBy(BundledCourse::id)
    private val coursesByRoute = courses.associateBy(BundledCourse::routePrefix)

    val courses: List<BundledCourse> = courses.toList()
    val defaultCourse: BundledCourse = checkNotNull(coursesById[defaultCourseId]) {
        "The default Android course is not bundled."
    }
    val startUrl: String = "$APP_ORIGIN${defaultCourse.entryPath}"

    init {
        check(courses.isNotEmpty()) { "The Android course bundle is empty." }
        check(coursesById.size == courses.size) { "Android course IDs must be unique." }
        check(coursesByRoute.size == courses.size) { "Android course routes must be unique." }
    }

    fun isBundled(courseId: String): Boolean = coursesById.containsKey(courseId.trim())

    fun course(courseId: String): BundledCourse? = coursesById[courseId.trim()]

    fun courseForPath(path: String): BundledCourse? {
        val normalizedPath = normalizedRequestPath(path) ?: return null
        return coursesByRoute.values.firstOrNull { course ->
            normalizedPath == course.routePrefix || normalizedPath.startsWith("${course.routePrefix}/")
        }
    }

    fun courseForTrustedUrl(url: String?): BundledCourse? {
        val uri = runCatching { URI(url.orEmpty()) }.getOrNull() ?: return null
        if (uri.scheme != "https" || uri.host != APP_HOST || (uri.port != -1 && uri.port != 443)) return null
        return courseForPath(uri.path.orEmpty())
    }

    fun resolveAsset(path: String): BundledAssetResolution? {
        val normalizedPath = normalizedRequestPath(path) ?: return null
        if (normalizedPath.startsWith(SHARED_LANGUAGE_RUNTIME_ROUTE_PREFIX)) {
            return BundledAssetResolution(normalizedPath.trimStart('/'))
        }
        if (normalizedPath.startsWith(SHARED_ASSET_ROUTE_PREFIX)) {
            return BundledAssetResolution(normalizedPath.trimStart('/'))
        }

        val course = courseForPath(normalizedPath) ?: return null
        val relativePath = normalizedPath
            .removePrefix(course.routePrefix)
            .trimStart('/')
            .ifBlank { "index.html" }
        if (!isSafeRelativePath(relativePath)) return null
        val assetPath = if (normalizedPath == course.entryPath || relativePath == "index.html") {
            "index.html"
        } else if (course.assetPrefix.isBlank()) {
            relativePath
        } else {
            "${course.assetPrefix}/$relativePath"
        }
        return BundledAssetResolution(
            assetPath = assetPath,
            course = course,
            courseRelativePath = relativePath,
        )
    }

    companion object {
        const val APP_HOST = "caatuu.local"
        const val APP_ORIGIN = "https://$APP_HOST"
        const val DEFAULT_BUNDLE_ASSET = "caatuu-course-bundle.json"
        private const val SHARED_LANGUAGE_RUNTIME_ROUTE_PREFIX = "/language-runtime/"
        private const val SHARED_ASSET_ROUTE_PREFIX = "/assets/"
        private val COURSE_ID_PATTERN = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
        private val ROUTE_PATTERN = Regex("^/[a-z0-9]+(?:-[a-z0-9]+)*$")
        private val LOCALE_PATTERN = Regex("^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")

        fun load(context: Context, assetPath: String = DEFAULT_BUNDLE_ASSET): BundledCourseRegistry {
            require(isSafeRelativePath(assetPath)) { "Android course bundle asset path is unsafe." }
            val rawJson = context.assets.open(assetPath).bufferedReader().use { it.readText() }
            return fromJson(rawJson)
        }

        fun fromJson(rawJson: String): BundledCourseRegistry {
            val root = StrictJsonParser(rawJson).parseObject()
                ?: throw IllegalStateException("Android course bundle JSON is malformed.")
            check(root.requiredInt("schemaVersion") == 1) {
                "Android course bundle schemaVersion must be 1."
            }
            val defaultCourseId = root.requiredString("defaultCourseId")
            val courseValues = root.requiredArray("courses")
            val courses = courseValues.mapIndexed { index, value ->
                parseCourse(value.asObject("courses[$index]"), index)
            }
            return BundledCourseRegistry(defaultCourseId, courses)
        }

        fun singleLegacy(
            id: String,
            routePrefix: String,
            entryPath: String,
            sourceLanguageLabel: String,
            targetLanguageLabel: String,
            targetLanguageLocale: String,
            speechLocale: String,
            capabilities: CourseCapabilities,
        ): BundledCourseRegistry {
            val course = BundledCourse(
                id = id,
                routePrefix = normalizedCourseRoute(routePrefix),
                entryPath = normalizedEntryPath(entryPath, normalizedCourseRoute(routePrefix)),
                assetPrefix = "",
                sourceLanguage = BundledLanguage("en", sourceLanguageLabel, "en"),
                targetLanguage = BundledLanguage(id, targetLanguageLabel, targetLanguageLocale, speechLocale),
                capabilities = capabilities,
                nativeProviders = BundledNativeProviders(schemaVersion = 1),
            )
            return BundledCourseRegistry(id, listOf(course))
        }

        private fun parseCourse(value: JsonObjectValue, index: Int): BundledCourse {
            val label = "courses[$index]"
            val id = value.requiredString("id")
            check(COURSE_ID_PATTERN.matches(id)) { "$label.id is invalid." }
            val routePrefix = normalizedCourseRoute(value.requiredString("routePrefix"))
            val entryPath = normalizedEntryPath(value.requiredString("entryPath"), routePrefix)
            val assetPrefix = value.requiredString("assetPrefix")
            check(assetPrefix == "courses/$id" && isSafeRelativePath(assetPrefix)) {
                "$label.assetPrefix must be courses/$id."
            }
            val sourceLanguage = parseLanguage(value.requiredObject("sourceLanguage"), "$label.sourceLanguage", false)
            val targetLanguage = parseLanguage(value.requiredObject("targetLanguage"), "$label.targetLanguage", true)
            val capabilities = parseCapabilities(value.requiredObject("capabilities"), "$label.capabilities")
            val providers = parseNativeProviders(value.requiredObject("nativeProviders"), "$label.nativeProviders")

            check(capabilities.isEnabled("embeddings") == (providers.embeddings != null)) {
                "$label embedding provider does not match its capability."
            }
            check(capabilities.isEnabled("dictionary") == (providers.dictionary != null)) {
                "$label dictionary provider does not match its capability."
            }
            check(capabilities.isEnabled("speech") == (providers.speech != null)) {
                "$label speech provider does not match its capability."
            }
            providers.speech?.let { provider ->
                check(provider.locale == targetLanguage.speechLocale) {
                    "$label speech provider locale does not match targetLanguage.speechLocale."
                }
            }

            return BundledCourse(
                id = id,
                routePrefix = routePrefix,
                entryPath = entryPath,
                assetPrefix = assetPrefix,
                sourceLanguage = sourceLanguage,
                targetLanguage = targetLanguage,
                capabilities = capabilities,
                nativeProviders = providers,
            )
        }

        private fun parseLanguage(
            value: JsonObjectValue,
            label: String,
            requireSpeechLocale: Boolean,
        ): BundledLanguage {
            val id = value.requiredString("id")
            val languageLabel = value.requiredString("label")
            val locale = value.requiredString("locale")
            check(LOCALE_PATTERN.matches(locale)) { "$label.locale is invalid." }
            val speechLocale = value.optionalString("speechLocale").orEmpty()
            if (requireSpeechLocale) {
                check(LOCALE_PATTERN.matches(speechLocale)) { "$label.speechLocale is invalid." }
            }
            return BundledLanguage(id, languageLabel, locale, speechLocale)
        }

        private fun parseCapabilities(value: JsonObjectValue, label: String): CourseCapabilities {
            val capabilities = linkedMapOf<String, Boolean>()
            value.values.forEach { (name, rawValue) ->
                val enabled = (rawValue as? JsonBooleanValue)?.value
                    ?: throw IllegalStateException("$label.$name must be boolean.")
                capabilities[name] = enabled
            }
            return CourseCapabilities.fromMap(capabilities)
        }

        private fun parseNativeProviders(value: JsonObjectValue, label: String): BundledNativeProviders {
            val schemaVersion = value.requiredInt("schemaVersion")
            check(schemaVersion == 1) { "$label.schemaVersion must be 1." }
            val providers = value.requiredObject("providers")
            val unexpected = providers.values.keys - setOf("embeddings", "dictionary", "speech")
            check(unexpected.isEmpty()) { "$label.providers contains unsupported providers: $unexpected" }
            return BundledNativeProviders(
                schemaVersion = schemaVersion,
                embeddings = providers.optionalObject("embeddings")?.let { provider ->
                    parseCatalogProvider(provider, "$label.providers.embeddings")
                },
                dictionary = providers.optionalObject("dictionary")?.let { provider ->
                    parseCatalogProvider(provider, "$label.providers.dictionary")
                },
                speech = providers.optionalObject("speech")?.let { provider ->
                    val implementation = provider.requiredString("implementation")
                    val locale = provider.requiredString("locale")
                    check(LOCALE_PATTERN.matches(locale)) { "$label.providers.speech.locale is invalid." }
                    BundledSpeechProvider(implementation, locale)
                },
            )
        }

        private fun parseCatalogProvider(value: JsonObjectValue, label: String): BundledCatalogProvider {
            val implementation = value.requiredString("implementation")
            val catalogAsset = value.requiredString("catalogAsset")
            check(isSafeRelativePath(catalogAsset)) { "$label.catalogAsset is unsafe." }
            return BundledCatalogProvider(implementation, catalogAsset)
        }

        private fun normalizedCourseRoute(value: String): String {
            val route = value.trim().trimEnd('/')
            check(ROUTE_PATTERN.matches(route)) { "Android course route is invalid: $value" }
            return route
        }

        private fun normalizedEntryPath(value: String, routePrefix: String): String {
            val entryPath = value.trim()
            check(entryPath.startsWith("$routePrefix/") && normalizedRequestPath(entryPath) == entryPath) {
                "Android course entry path must stay inside its route."
            }
            return entryPath
        }

        private fun normalizedRequestPath(value: String): String? {
            if (!value.startsWith('/') || value.contains('\\') || value.contains('?') || value.contains('#')) return null
            val segments = value.split('/').drop(1)
            if (segments.any { it == "." || it == ".." }) return null
            if (segments.withIndex().any { (index, segment) -> segment.isEmpty() && index != segments.lastIndex }) return null
            return value
        }

        private fun isSafeRelativePath(value: String): Boolean =
            value.isNotEmpty() &&
                !value.startsWith('/') &&
                !value.contains('\\') &&
                value.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    }
}

private sealed interface JsonValue

private data class JsonObjectValue(val values: Map<String, JsonValue>) : JsonValue {
    fun requiredString(name: String): String =
        (values[name] as? JsonStringValue)?.value?.takeIf(String::isNotBlank)
            ?: throw IllegalStateException("$name must be a nonblank string.")

    fun optionalString(name: String): String? = (values[name] as? JsonStringValue)?.value

    fun requiredInt(name: String): Int =
        (values[name] as? JsonNumberValue)?.value?.toIntOrNull()
            ?: throw IllegalStateException("$name must be an integer.")

    fun requiredObject(name: String): JsonObjectValue =
        values[name].asObject(name)

    fun optionalObject(name: String): JsonObjectValue? = when (val value = values[name]) {
        null -> null
        is JsonObjectValue -> value
        else -> throw IllegalStateException("$name must be an object.")
    }

    fun requiredArray(name: String): List<JsonValue> =
        (values[name] as? JsonArrayValue)?.values
            ?: throw IllegalStateException("$name must be an array.")
}

private data class JsonArrayValue(val values: List<JsonValue>) : JsonValue
private data class JsonStringValue(val value: String) : JsonValue
private data class JsonNumberValue(val value: String) : JsonValue
private data class JsonBooleanValue(val value: Boolean) : JsonValue
private data object JsonNullValue : JsonValue

private fun JsonValue?.asObject(label: String): JsonObjectValue =
    this as? JsonObjectValue ?: throw IllegalStateException("$label must be an object.")

/** Small strict JSON parser kept pure so the package boundary has JVM tests. */
private class StrictJsonParser(private val source: String) {
    private var cursor = 0

    fun parseObject(): JsonObjectValue? {
        val value = parseValue() as? JsonObjectValue ?: return null
        skipWhitespace()
        return value.takeIf { cursor == source.length }
    }

    private fun parseValue(): JsonValue? {
        skipWhitespace()
        return when (peek()) {
            '{' -> parseObjectValue()
            '[' -> parseArrayValue()
            '"' -> parseString()?.let(::JsonStringValue)
            't' -> if (consumeLiteral("true")) JsonBooleanValue(true) else null
            'f' -> if (consumeLiteral("false")) JsonBooleanValue(false) else null
            'n' -> if (consumeLiteral("null")) JsonNullValue else null
            '-', in '0'..'9' -> parseNumber()?.let(::JsonNumberValue)
            else -> null
        }
    }

    private fun parseObjectValue(): JsonObjectValue? {
        if (!consume('{')) return null
        skipWhitespace()
        if (consume('}')) return JsonObjectValue(emptyMap())
        val result = linkedMapOf<String, JsonValue>()
        while (true) {
            skipWhitespace()
            val key = parseString() ?: return null
            if (result.containsKey(key)) return null
            skipWhitespace()
            if (!consume(':')) return null
            val value = parseValue() ?: return null
            result[key] = value
            skipWhitespace()
            when {
                consume('}') -> return JsonObjectValue(result)
                consume(',') -> continue
                else -> return null
            }
        }
    }

    private fun parseArrayValue(): JsonArrayValue? {
        if (!consume('[')) return null
        skipWhitespace()
        if (consume(']')) return JsonArrayValue(emptyList())
        val result = mutableListOf<JsonValue>()
        while (true) {
            result += parseValue() ?: return null
            skipWhitespace()
            when {
                consume(']') -> return JsonArrayValue(result)
                consume(',') -> continue
                else -> return null
            }
        }
    }

    private fun parseString(): String? {
        if (!consume('"')) return null
        val result = StringBuilder()
        while (cursor < source.length) {
            val character = source[cursor++]
            when {
                character == '"' -> return result.toString()
                character == '\\' -> {
                    if (cursor >= source.length) return null
                    when (val escaped = source[cursor++]) {
                        '"', '\\', '/' -> result.append(escaped)
                        'b' -> result.append('\b')
                        'f' -> result.append('\u000C')
                        'n' -> result.append('\n')
                        'r' -> result.append('\r')
                        't' -> result.append('\t')
                        'u' -> {
                            if (cursor + 4 > source.length) return null
                            val code = source.substring(cursor, cursor + 4).toIntOrNull(16) ?: return null
                            result.append(code.toChar())
                            cursor += 4
                        }
                        else -> return null
                    }
                }
                character.code < 0x20 -> return null
                else -> result.append(character)
            }
        }
        return null
    }

    private fun parseNumber(): String? {
        val start = cursor
        consume('-')
        when {
            consume('0') -> Unit
            peek() in '1'..'9' -> while (peek() in '0'..'9') cursor += 1
            else -> return null
        }
        if (consume('.')) {
            if (peek() !in '0'..'9') return null
            while (peek() in '0'..'9') cursor += 1
        }
        if (peek() == 'e' || peek() == 'E') {
            cursor += 1
            if (peek() == '+' || peek() == '-') cursor += 1
            if (peek() !in '0'..'9') return null
            while (peek() in '0'..'9') cursor += 1
        }
        return source.substring(start, cursor)
    }

    private fun consumeLiteral(value: String): Boolean {
        if (!source.regionMatches(cursor, value, 0, value.length)) return false
        cursor += value.length
        return true
    }

    private fun consume(expected: Char): Boolean {
        if (peek() != expected) return false
        cursor += 1
        return true
    }

    private fun peek(): Char = source.getOrNull(cursor) ?: '\u0000'

    private fun skipWhitespace() {
        while (peek().isWhitespace()) cursor += 1
    }
}
