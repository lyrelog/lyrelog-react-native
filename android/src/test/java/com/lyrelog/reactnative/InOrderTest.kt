package com.lyrelog.reactnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * React Native runs a TurboModule's void calls (`log`, `screen`, `setUser`) later, on the native
 * modules thread, and `logNow` (it returns a value) at once on the JS thread. The fatal event
 * must not overtake the logs JavaScript sent before it.
 */
class InOrderTest {
    @Test
    fun theFatalEventGoesBehindLogsStillQueued() {
        val queue = Executors.newSingleThreadExecutor()
        val seen = Collections.synchronizedList(mutableListOf<String>())
        val gate = CountDownLatch(1)
        // The native modules thread is still busy with earlier calls when the fatal error comes.
        queue.execute { gate.await() }
        queue.execute { seen += "before the crash" }
        Thread { Thread.sleep(50); gate.countDown() }.start()

        InOrder.behindQueued(1_000, post = { queue.execute(it) }) { seen += "app_crashed" }

        assertEquals(listOf("before the crash", "app_crashed"), seen.toList())
        queue.shutdownNow()
    }

    @Test
    fun aStuckQueueStillGetsTheFatalEventInTimeAndOnlyOnce() {
        val queue = Executors.newSingleThreadExecutor()
        val seen = Collections.synchronizedList(mutableListOf<String>())
        val gate = CountDownLatch(1)
        queue.execute { gate.await() }

        val start = System.nanoTime()
        InOrder.behindQueued(100, post = { queue.execute(it) }) { seen += "app_crashed" }
        val waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)

        assertEquals(listOf("app_crashed"), seen.toList())
        assertTrue("waited $waited ms", waited < 1_000)
        gate.countDown()
        queue.shutdown()
        queue.awaitTermination(1, TimeUnit.SECONDS)
        assertEquals(listOf("app_crashed"), seen.toList()) // the queued copy didn't log it again
    }

    @Test
    fun aQueueThatRefusesWorkStillGetsTheFatalEvent() {
        val seen = mutableListOf<String>()
        InOrder.behindQueued(100, post = { throw IllegalStateException("gone") }) { seen += "app_crashed" }
        assertEquals(listOf("app_crashed"), seen)
    }
}
