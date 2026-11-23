package com.lyrelog.reactnative

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class JavascriptCrashesTest {
    private class JsCrash : RuntimeException("js")

    private var clock = 1_000_000L
    private lateinit var original: Thread.UncaughtExceptionHandler
    private val seen = mutableListOf<String>()

    @Before
    fun setUp() {
        original = Thread.getDefaultUncaughtExceptionHandler() ?: Thread.UncaughtExceptionHandler { _, _ -> }
    }

    @After
    fun tearDown() {
        Thread.setDefaultUncaughtExceptionHandler(original)
    }

    private fun crashes() = JavascriptCrashes(isJavascript = { it is JsCrash }, now = { clock })

    /** Like the SDK's CrashRecorder: installs once per process, around what was there. */
    private fun lyrelogStart(installed: BooleanArray) {
        if (installed[0]) return
        installed[0] = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            seen += "lyrelog"
            previous?.uncaughtException(t, e)
        }
    }

    @Test
    fun aSlowNetworkStillMarksTheFatalErrorRecorded() {
        val crashes = crashes()
        Thread.setDefaultUncaughtExceptionHandler { _, _ -> seen += "app" }
        val installed = booleanArrayOf(false)
        val before = Thread.getDefaultUncaughtExceptionHandler()
        lyrelogStart(installed)
        crashes.install(before, Thread.getDefaultUncaughtExceptionHandler())

        var uploadWaited = 0L
        val onDisk = crashes.recordFatal(1_500, flushToDisk = { true }, flush = { uploadWaited = it; false })
        assertTrue(onDisk)
        assertEquals(1_500L, uploadWaited)

        Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), JsCrash())
        assertEquals(listOf("app"), seen) // not recorded a second time by the SDK
    }

    @Test
    fun closeThenInitWrapsNothingAgain() {
        val crashes = crashes()
        Thread.setDefaultUncaughtExceptionHandler { _, _ -> seen += "app" }
        val installed = booleanArrayOf(false)
        repeat(3) {
            // Each first start: init after close().
            val before = Thread.getDefaultUncaughtExceptionHandler()
            lyrelogStart(installed)
            crashes.install(before, Thread.getDefaultUncaughtExceptionHandler())
        }
        Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), IllegalStateException("native"))
        assertEquals(listOf("lyrelog", "app"), seen)
    }

    @Test
    fun aJavascriptCrashNotOnDiskGoesThroughLyrelog() {
        val crashes = crashes()
        Thread.setDefaultUncaughtExceptionHandler { _, _ -> seen += "app" }
        val before = Thread.getDefaultUncaughtExceptionHandler()
        lyrelogStart(booleanArrayOf(false))
        crashes.install(before, Thread.getDefaultUncaughtExceptionHandler())
        crashes.recordFatal(1_500, flushToDisk = { false }, flush = { true })
        Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), JsCrash())
        assertEquals(listOf("lyrelog", "app"), seen)
    }
}
