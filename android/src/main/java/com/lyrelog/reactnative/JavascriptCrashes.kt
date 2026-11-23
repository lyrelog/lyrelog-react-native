package com.lyrelog.reactnative

import android.os.SystemClock

/**
 * A fatal JavaScript error ends a release build with a `JavascriptException` on the JS thread.
 * The JavaScript side has already recorded it as `app_crashed`, with its JavaScript stack, and
 * waited for the disk (`logNow`), so the SDK's own crash recorder would only add a second report
 * of the same crash with Java frames. In that case alone the handler that was there before
 * Lyrelog gets it directly; any other crash goes through Lyrelog as usual.
 *
 * No React Native types here, so the unit tests can drive it.
 */
internal class JavascriptCrashes(
    private val isJavascript: (Throwable) -> Boolean,
    private val now: () -> Long = SystemClock::elapsedRealtime,
) {
    @Volatile
    private var fatalAt = Long.MIN_VALUE / 2

    @Volatile
    private var wrapper: Thread.UncaughtExceptionHandler? = null

    /**
     * Records a fatal JavaScript error: on disk within `timeoutMillis` marks it recorded (the
     * upload is only tried after, in what's left). A slow network no longer leaves it unmarked,
     * which recorded the crash twice. True when the event is on disk.
     */
    fun recordFatal(timeoutMillis: Long, flushToDisk: (Long) -> Boolean, flush: (Long) -> Boolean): Boolean {
        val start = now()
        val total = timeoutMillis.coerceIn(1, 5_000)
        val onDisk = flushToDisk(minOf(total, 1_000))
        if (onDisk) fatalAt = now()
        val left = total - (now() - start)
        if (onDisk && left > 0) flush(left)
        return onDisk
    }

    /**
     * Installs the handler once per process, around the one Lyrelog's recorder set. Called on each
     * first start (a `close()` then `init()` is one too): the second time, the current handler is
     * already ours (or the app's, around ours), so nothing is wrapped again.
     */
    @Synchronized
    fun install(beforeLyrelog: Thread.UncaughtExceptionHandler?, lyrelogHandler: Thread.UncaughtExceptionHandler?) {
        if (wrapper != null) return
        if (lyrelogHandler == null || lyrelogHandler === beforeLyrelog || beforeLyrelog == null) return
        val installed = Thread.UncaughtExceptionHandler { thread, error ->
            val recorded = now() - fatalAt < RECENT_MS && isJavascript(error)
            if (recorded) beforeLyrelog.uncaughtException(thread, error) else lyrelogHandler.uncaughtException(thread, error)
        }
        wrapper = installed
        Thread.setDefaultUncaughtExceptionHandler(installed)
    }

    companion object {
        const val RECENT_MS = 10_000L
    }
}
