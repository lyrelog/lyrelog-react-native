package com.lyrelog.reactnative

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * React Native runs a TurboModule's void calls (`log`, `screen`, `setUser`) later, on the native
 * modules thread, and a call that returns a value (`logNow`) at once, on the JS thread. A fatal
 * error's event would overtake the logs JavaScript sent just before it, so it is put behind them.
 *
 * No React Native types here, so the unit tests can drive it.
 */
internal object InOrder {
    /**
     * Runs `work` on the queue `post` feeds, behind every call already there, and waits for it
     * (at most `timeoutMillis`). If the queue doesn't get to it in time (or refuses it), runs it
     * here instead. Either way exactly once, and done when this returns.
     */
    fun behindQueued(timeoutMillis: Long, post: (Runnable) -> Unit, work: () -> Unit) {
        val claimed = AtomicBoolean(false)
        val done = CountDownLatch(1)
        val posted = try {
            post(Runnable {
                try {
                    if (claimed.compareAndSet(false, true)) work()
                } finally {
                    done.countDown()
                }
            })
            true
        } catch (e: Throwable) {
            false
        }
        if (posted && done.await(timeoutMillis.coerceAtLeast(1), TimeUnit.MILLISECONDS)) return
        if (claimed.compareAndSet(false, true)) {
            work()
        } else {
            // The queue took it just now: let it finish (logging is quick).
            done.await(timeoutMillis.coerceAtLeast(1), TimeUnit.MILLISECONDS)
        }
    }
}
