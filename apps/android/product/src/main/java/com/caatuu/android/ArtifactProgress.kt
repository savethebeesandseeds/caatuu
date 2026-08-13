package com.caatuu.android

data class ArtifactProgress(
    val bytesRead: Long,
    val totalBytes: Long,
)

// The existing safe artifact managers use this source-level name. A type alias
// keeps those shared sources unchanged without creating a generation class in
// the product DEX.
typealias ModelProgress = ArtifactProgress
