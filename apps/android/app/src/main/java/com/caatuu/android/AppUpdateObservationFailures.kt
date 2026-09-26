package com.caatuu.android

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineExceptionHandler

/** A detached observer failure must become a recoverable UI status, never an uncaught app crash. */
internal class AppUpdateObservationFailures {
    private val pending = AtomicBoolean(false)
    val handler = CoroutineExceptionHandler { _, _ -> pending.set(true) }
    fun consume(): Boolean = pending.getAndSet(false)
    fun hasPending(): Boolean = pending.get()
}
