package com.lyrelog.reactnative

import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.common.JavascriptException
import com.facebook.react.module.annotations.ReactModule
import com.lyrelog.Configuration
import com.lyrelog.Consent
import com.lyrelog.Level
import com.lyrelog.Lyrelog

/**
 * The JavaScript side's way into the Lyrelog Android SDK. Every call is guarded: nothing here
 * throws into React Native. The SDK does the work (disk queue, batches, retries, crashes, Key
 * Attestation); this only converts values.
 */
@ReactModule(name = LyrelogModule.NAME)
class LyrelogModule(private val context: ReactApplicationContext) : NativeLyrelogSpec(context) {

    override fun getName() = NAME

    override fun start(config: ReadableMap) {
        guarded {
            val configuration = configuration(config) ?: return@guarded
            val beforeLyrelog = Thread.getDefaultUncaughtExceptionHandler()
            // false: already running (the SDK starts once per process), its crash handler is in place.
            val startedNow = Lyrelog.start(context.applicationContext, configuration)
            if (startedNow && configuration.captureCrashes) crashes.install(beforeLyrelog, Thread.getDefaultUncaughtExceptionHandler())
        }
    }

    override fun log(level: String, message: String, category: String?, attrs: ReadableMap?, payload: ReadableMap?) {
        guarded { Lyrelog.log(level(level), message, category, attrs?.let(::toMap), unwrap(payload)) }
    }

    override fun logNow(level: String, message: String, category: String?, attrs: ReadableMap?, payload: ReadableMap?, timeoutMs: Double): Boolean {
        return try {
            val start = SystemClock.elapsedRealtime()
            val total = timeoutMs.toLong().coerceIn(1, 5_000)
            val fields = attrs?.let(::toMap)
            val value = unwrap(payload)
            val record = { guarded { Lyrelog.log(level(level), message, category, fields, value) } }
            // Behind the log calls still waiting on the native modules thread, so the last events
            // before the crash keep their order (a third of the time at most, 500 ms).
            if (context.isOnNativeModulesQueueThread) {
                record()
            } else {
                InOrder.behindQueued(minOf(total / 3, 500), context::runOnNativeModulesQueueThread, record)
            }
            val left = (total - (SystemClock.elapsedRealtime() - start)).coerceAtLeast(1)
            // On the JS thread, never the main one: the SDK's flushes block there.
            crashes.recordFatal(left, Lyrelog::flushToDisk, Lyrelog::flush)
        } catch (e: Throwable) {
            false
        }
    }

    override fun setUser(id: String?) {
        guarded { Lyrelog.setUser(id) }
    }

    override fun setConsent(consent: String) {
        guarded { consent(consent)?.let(Lyrelog::setConsent) }
    }

    override fun screen(name: String, attrs: ReadableMap?) {
        guarded { Lyrelog.screen(name, attrs?.let(::toMap)) }
    }

    override fun flush(promise: Promise) {
        background(promise) { Lyrelog.flush() }
    }

    override fun stop(promise: Promise) {
        background(promise) { Lyrelog.stop() }
    }

    override fun getSessionId(): String? = try {
        Lyrelog.sessionId
    } catch (e: Throwable) {
        null
    }

    private fun background(promise: Promise, work: () -> Unit) {
        try {
            Thread({
                guarded(work)
                promise.resolve(null)
            }, "lyrelog-rn").start()
        } catch (e: Throwable) {
            promise.resolve(null)
        }
    }

    companion object {
        const val NAME = "Lyrelog"
        /** This package's version, named in `resource.sdk` before the Android SDK's (package.json). */
        const val WRAPPER_VERSION = "1.1.1"
        private const val TAG = "Lyrelog"

        /** One per process, like the SDK's crash recorder (a reload makes a new module). */
        private val crashes = JavascriptCrashes(isJavascript = ::isJavascript)

        private fun isJavascript(error: Throwable): Boolean {
            var current: Throwable? = error
            var depth = 0
            while (current != null && depth < 8) {
                if (current is JavascriptException) return true
                current = current.cause
                depth += 1
            }
            return false
        }

        private inline fun guarded(work: () -> Unit) {
            try {
                work()
            } catch (e: Throwable) {
                Log.d(TAG, "lyrelog: a React Native call failed (${e.javaClass.name})")
            }
        }

        fun level(name: String): Level = Level.entries.firstOrNull { it.wireName == name } ?: Level.INFO

        fun consent(name: String?): Consent? = when (name) {
            "granted" -> Consent.GRANTED
            "pending" -> Consent.PENDING
            "denied" -> Consent.DENIED
            else -> null
        }

        /** Only what JavaScript set; the rest keeps the SDK's defaults. */
        fun configuration(map: ReadableMap): Configuration? {
            val apiKey = map.string("apiKey") ?: return null
            return Configuration(apiKey) {
                map.string("endpoint")?.let { endpoint = it }
                consent(map.string("consent"))?.let { consent = it }
                map.string("minimumLevel")?.let { minimumLevel = level(it) }
                map.string("environment")?.let { environment = it }
                map.string("platform")?.let { platform = it }
                map.number("flushIntervalMs")?.let { flushIntervalMillis = it.toLong() }
                map.number("sessionTimeoutMs")?.let { sessionTimeoutMillis = it.toLong() }
                map.number("maxDiskBytes")?.let { maxDiskBytes = it.toLong() }
                map.strings("redactKeys")?.let { redactedKeys = it }
                map.bool("captureCrashes")?.let { captureCrashes = it }
                map.bool("attachScreen")?.let { attachScreen = it }
                map.bool("attest")?.let { attest = it }
                map.bool("mirrorToNativeLog")?.let { mirrorToLogcat = it }
                wrapper = "lyrelog-react-native/$WRAPPER_VERSION"
            }
        }

        private fun ReadableMap.string(key: String): String? =
            if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

        private fun ReadableMap.number(key: String): Double? =
            if (hasKey(key) && getType(key) == ReadableType.Number) getDouble(key) else null

        private fun ReadableMap.bool(key: String): Boolean? =
            if (hasKey(key) && getType(key) == ReadableType.Boolean) getBoolean(key) else null

        private fun ReadableMap.strings(key: String): List<String>? {
            if (!hasKey(key) || getType(key) != ReadableType.Array) return null
            val array = getArray(key) ?: return null
            return (0 until array.size()).mapNotNull { if (array.getType(it) == ReadableType.String) array.getString(it) else null }
        }

        /** The payload crosses as `{ value }` so any JSON value fits. */
        fun unwrap(payload: ReadableMap?): Any? {
            if (payload == null || !payload.hasKey("value")) return null
            return value(payload, "value")
        }

        fun toMap(map: ReadableMap): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            val keys = map.keySetIterator()
            while (keys.hasNextKey()) {
                val key = keys.nextKey()
                out[key] = value(map, key)
            }
            return out
        }

        private fun value(map: ReadableMap, key: String): Any? = when (map.getType(key)) {
            ReadableType.Null -> null
            ReadableType.Boolean -> map.getBoolean(key)
            ReadableType.Number -> number(map.getDouble(key))
            ReadableType.String -> map.getString(key)
            ReadableType.Map -> map.getMap(key)?.let(::toMap)
            ReadableType.Array -> map.getArray(key)?.let(::toList)
        }

        private fun toList(array: ReadableArray): List<Any?> = (0 until array.size()).map { i ->
            when (array.getType(i)) {
                ReadableType.Null -> null
                ReadableType.Boolean -> array.getBoolean(i)
                ReadableType.Number -> number(array.getDouble(i))
                ReadableType.String -> array.getString(i)
                ReadableType.Map -> array.getMap(i)?.let(::toMap)
                ReadableType.Array -> array.getArray(i)?.let(::toList)
            }
        }

        /** JavaScript has only doubles: a whole number goes as an integer (`3`, not `3.0`). */
        private fun number(value: Double): Any =
            if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 9.007199254740992E15) value.toLong() else value
    }
}
