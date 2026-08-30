package com.caatuu.android

/**
 * Runtime view of the course capabilities generated into BuildConfig.
 *
 * The input is a flat JSON object whose values must be literal booleans. Any
 * malformed input disables every capability, and missing or unknown names are
 * always treated as disabled. This keeps optional native managers fail-closed
 * even if a generated BuildConfig value is damaged or unexpectedly changed.
 */
class CourseCapabilities private constructor(
    private val values: Map<String, Boolean>,
) {
    fun isEnabled(name: String): Boolean =
        name in KNOWN_CAPABILITIES && values[name] == true

    fun <T> createIfEnabled(name: String, factory: () -> T): T? =
        if (isEnabled(name)) factory() else null

    companion object {
        private val KNOWN_CAPABILITIES = setOf(
            "chat",
            "llm",
            "generation",
            "godot",
            "embeddings",
            "semanticSearch",
            "imageLookup",
            "stats",
            "dictionary",
            "memory",
            "verbs",
            "wordWorld",
            "conjugationComet",
            "offlineModels",
            "speech",
            "pronunciationGuides",
            "wordWorldStandardOnly",
        )

        fun fromJson(rawJson: String): CourseCapabilities =
            CourseCapabilities(FlatBooleanJsonParser(rawJson).parse() ?: emptyMap())

        internal fun fromMap(values: Map<String, Boolean>): CourseCapabilities =
            CourseCapabilities(values.filterKeys(KNOWN_CAPABILITIES::contains))
    }
}

/** Strict parser for the generated flat string-to-boolean capability object. */
private class FlatBooleanJsonParser(private val source: String) {
    private var cursor = 0

    fun parse(): Map<String, Boolean>? {
        skipWhitespace()
        if (!consume('{')) return null
        skipWhitespace()
        if (consume('}')) return finish(emptyMap())

        val result = linkedMapOf<String, Boolean>()
        while (true) {
            skipWhitespace()
            val key = parseKey() ?: return null
            if (key in result) return null
            skipWhitespace()
            if (!consume(':')) return null
            skipWhitespace()
            val value = parseBoolean() ?: return null
            result[key] = value
            skipWhitespace()
            when {
                consume('}') -> return finish(result)
                consume(',') -> continue
                else -> return null
            }
        }
    }

    private fun finish(result: Map<String, Boolean>): Map<String, Boolean>? {
        skipWhitespace()
        return result.takeIf { cursor == source.length }
    }

    private fun parseKey(): String? {
        if (!consume('"')) return null
        val start = cursor
        while (cursor < source.length && source[cursor] != '"') {
            val character = source[cursor]
            if (!character.isLetterOrDigit() || (cursor == start && !character.isLetter())) return null
            cursor += 1
        }
        if (cursor == start || !consume('"')) return null
        return source.substring(start, cursor - 1)
    }

    private fun parseBoolean(): Boolean? =
        when {
            consumeLiteral("true") -> true
            consumeLiteral("false") -> false
            else -> null
        }

    private fun consumeLiteral(value: String): Boolean {
        if (!source.regionMatches(cursor, value, 0, value.length)) return false
        cursor += value.length
        return true
    }

    private fun consume(expected: Char): Boolean {
        if (cursor >= source.length || source[cursor] != expected) return false
        cursor += 1
        return true
    }

    private fun skipWhitespace() {
        while (cursor < source.length && source[cursor].isWhitespace()) cursor += 1
    }
}
